import { Request, Response } from "express";
import * as yup from "yup";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";
import cloudTalkService from "../service/CloudTalkService";

// ==================== VALIDATION SCHEMAS ====================
const leadActivitySchema = yup.object({
  lead_id: yup.string().uuid("Invalid lead ID").required("Lead ID is required"),
  disposition_id: yup.string().uuid("Invalid disposition ID").required("Disposition is required"),
  conversation: yup.string().trim().required("Conversation note is required"),
});

const updateLeadActivitySchema = yup.object({
  id: yup.string().uuid("Invalid activity ID").required("Activity ID is required"),
  disposition_id: yup.string().uuid("Invalid disposition ID").optional(),
  conversation: yup.string().trim().optional(),
});

// ==================== 1. CREATE ACTIVITY ====================
export const createActivity = async (req: Request, res: Response) => {
  try {
    const validatedData = await leadActivitySchema.validate(req.body, { abortEarly: false });
    const id = uuidv4();
    const now = new Date();

    let callId: string | null = req.body?.call_id || null;
    let recordingUrl: string | null = req.body?.recording_url || (callId ? `/cloudtalk/recordings/${callId}` : null);
    let durationSeconds: number | null = req.body?.duration_seconds ? Number(req.body.duration_seconds) : null;

    // If callId is not provided, and disposition is a connected call ("Phone Conversation"),
    // check if there's a fresh unlinked recording on CloudTalk for this lead's phone
    if (!callId) {
      try {
        const [dispRow]: any[] = await db.sequelize.query(
          `SELECT name FROM public.lead_dispositions WHERE id = :disposition_id LIMIT 1`,
          { replacements: { disposition_id: validatedData.disposition_id }, type: QueryTypes.SELECT }
        );
        const dispName = String(dispRow?.name || "").trim().toLowerCase();
        if (dispName.includes("phone") || dispName.includes("call")) {
          const [lead]: any[] = await db.sequelize.query(
            `SELECT phone, whatsapp_number FROM public.leads WHERE id = :lead_id LIMIT 1`,
            { replacements: { lead_id: validatedData.lead_id }, type: QueryTypes.SELECT }
          );
          const targetPhone = lead?.phone || lead?.whatsapp_number;
          if (targetPhone) {
            const recordings = await cloudTalkService.getRecentRecordingsForPhone(targetPhone, 5);
            if (recordings.length > 0) {
              const usedRows: any[] = await db.sequelize.query(
                `SELECT call_id FROM public.lead_activity_history WHERE call_id IS NOT NULL AND deleted_at IS NULL`,
                { type: QueryTypes.SELECT }
              );
              const usedSet = new Set((usedRows || []).map((r: any) => String(r.call_id)));
              const freshRec = recordings.find(
                (r) => !usedSet.has(String(r.callId)) && r.durationSeconds > 0
              );
              if (freshRec) {
                callId = freshRec.callId;
                recordingUrl = freshRec.recordingUrl;
                durationSeconds = durationSeconds || freshRec.durationSeconds;
              }
            }
          }
        }
      } catch {}
    }

    const result: any[] = await db.sequelize.query(
      `INSERT INTO public.lead_activity_history (
         id, lead_id, disposition_id, conversation, call_id, recording_url, duration_seconds, occurred_at, created_at, updated_at
       ) VALUES (
         :id, :lead_id, :disposition_id, :conversation, :call_id, :recording_url, :duration_seconds, :now, :now, :now
       )
       RETURNING *`,
      {
        replacements: {
          id,
          lead_id: validatedData.lead_id,
          disposition_id: validatedData.disposition_id,
          conversation: validatedData.conversation.trim(),
          call_id: callId,
          recording_url: recordingUrl,
          duration_seconds: durationSeconds,
          now,
        },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(201).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 2. GET ALL ACTIVITIES ====================
export const getAllActivities = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id || req.query?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    // If there is a recent connected call activity (Phone Conversation) without a call recording,
    // sync it once CloudTalk has finished processing the recording
    try {
      const [pendingActivity]: any[] = await db.sequelize.query(
        `SELECT ah.id, ah.lead_id
         FROM public.lead_activity_history ah
         JOIN public.lead_dispositions d ON d.id = ah.disposition_id
         WHERE ah.lead_id = :lead_id
           AND ah.deleted_at IS NULL
           AND (ah.call_id IS NULL OR ah.call_id = '')
           AND LOWER(d.name) LIKE '%phone%'
           AND ah.created_at >= NOW() - INTERVAL '15 minutes'
         ORDER BY ah.created_at DESC
         LIMIT 1`,
        { replacements: { lead_id }, type: QueryTypes.SELECT }
      );

      if (pendingActivity) {
        const [lead]: any[] = await db.sequelize.query(
          `SELECT phone, whatsapp_number FROM public.leads WHERE id = :lead_id LIMIT 1`,
          { replacements: { lead_id }, type: QueryTypes.SELECT }
        );
        const targetPhone = lead?.phone || lead?.whatsapp_number;
        if (targetPhone) {
          const recordings = await cloudTalkService.getRecentRecordingsForPhone(targetPhone, 5);
          if (recordings.length > 0) {
            const usedRows: any[] = await db.sequelize.query(
              `SELECT call_id FROM public.lead_activity_history WHERE call_id IS NOT NULL AND deleted_at IS NULL`,
              { type: QueryTypes.SELECT }
            );
            const usedSet = new Set((usedRows || []).map((r: any) => String(r.call_id)));
            const freshRec = recordings.find(
              (r) => !usedSet.has(String(r.callId)) && r.durationSeconds > 0
            );
            if (freshRec) {
              await db.sequelize.query(
                `UPDATE public.lead_activity_history
                 SET call_id = :callId,
                     recording_url = :recordingUrl,
                     duration_seconds = COALESCE(duration_seconds, :durationSeconds),
                     updated_at = NOW()
                 WHERE id = :activityId`,
                {
                  replacements: {
                    activityId: pendingActivity.id,
                    callId: freshRec.callId,
                    recordingUrl: freshRec.recordingUrl,
                    durationSeconds: freshRec.durationSeconds,
                  },
                  type: QueryTypes.UPDATE,
                }
              );
            }
          }
        }
      }
    } catch (syncErr) {
      console.warn("Sync pending call recording warning:", syncErr);
    }

    const result: any[] = await db.sequelize.query(
      `SELECT
         ah.id,
         d.name AS disposition,
         ah.disposition_id,
         ah.conversation,
         COALESCE(ah.recording_url, CASE WHEN ah.call_id IS NOT NULL AND TRIM(ah.call_id) != '' THEN CONCAT('/cloudtalk/recordings/', ah.call_id) ELSE NULL END) AS recording_url,
         ah.duration_seconds,
         ah.call_id,
         ah.occurred_at,
         ah.created_at,
         ah.updated_at,
         ah.is_edited
       FROM public.lead_activity_history ah
       JOIN public.lead_dispositions d ON d.id = ah.disposition_id
       WHERE ah.lead_id = :lead_id
         AND ah.deleted_at IS NULL
       ORDER BY ah.created_at DESC`,
      { replacements: { lead_id }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 3. GET ALL DISPOSITIONS ====================
export const getAllDispositions = async (req: Request, res: Response) => {
  try {
    const result: any[] = await db.sequelize.query(
      `SELECT id, name, description, is_active, created_at
       FROM public.lead_dispositions
       WHERE is_active = TRUE
       ORDER BY name ASC`,
      { type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 4. UPDATE ACTIVITY ====================
export const updateActivity = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Activity ID is required" });
    }

    const validatedData = await updateLeadActivitySchema.validate(req.body, { abortEarly: false });
    const now = new Date();

    const result: any[] = await db.sequelize.query(
      `UPDATE public.lead_activity_history
       SET disposition_id = COALESCE(:disposition_id, disposition_id),
           conversation = COALESCE(:conversation, conversation),
           is_edited = TRUE,
           updated_at = :now
       WHERE id = :id AND deleted_at IS NULL
       RETURNING *`,
      {
        replacements: {
          id,
          disposition_id: validatedData.disposition_id || null,
          conversation: validatedData.conversation ? validatedData.conversation.trim() : null,
          now,
        },
        type: QueryTypes.SELECT,
      }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Activity record not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. DELETE ACTIVITY ====================
export const deleteActivity = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Activity ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `UPDATE public.lead_activity_history SET deleted_at = NOW(), updated_at = NOW() WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Activity record not found" });
    }

    return res.status(200).json({ success: true, message: "Activity deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  createActivity,
  getAllActivities,
  getAllDispositions,
  updateActivity,
  deleteActivity,
};
