import { Request, Response } from "express";
import * as yup from "yup";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";

// ==================== VALIDATION SCHEMAS ====================
const leadActivitySchema = yup.object({
  lead_id: yup.string().uuid("Invalid lead ID").required("Lead ID is required"),
  disposition_id: yup
    .string()
    .uuid("Invalid disposition ID")
    .required("Disposition is required"),
  conversation: yup.string().trim().required("Conversation note is required"),
  agent_id: yup.string().uuid("Invalid agent ID").nullable().optional(),
});

const updateLeadActivitySchema = yup.object({
  id: yup
    .string()
    .uuid("Invalid activity ID")
    .required("Activity ID is required"),
  disposition_id: yup.string().uuid("Invalid disposition ID").optional(),
  conversation: yup.string().trim().optional(),
});

// ==================== 1. CREATE ACTIVITY ====================
export const addActivity = async (req: Request, res: Response) => {
  try {
    const validatedData = await leadActivitySchema.validate(req.body, {
      abortEarly: false,
    });

    let agent_id = validatedData.agent_id || null;
    if (!agent_id) {
      const leadRows: any[] = await db.sequelize.query(
        `SELECT agent_id FROM public.leads WHERE id = :lead_id LIMIT 1`,
        {
          replacements: { lead_id: validatedData.lead_id },
          type: QueryTypes.SELECT,
        },
      );
      agent_id = leadRows[0]?.agent_id || null;
    }

    const id = uuidv4();
    const now = new Date();

    const query = `
      WITH ins AS (
        INSERT INTO public.lead_activity_history (
          id, lead_id, agent_id, disposition_id, conversation, occurred_at, created_at, updated_at
        ) VALUES (
          :id, :lead_id, :agent_id, :disposition_id, :conversation, :now, :now, :now
        )
        RETURNING *
      )
      SELECT
        ins.*,
        d.name AS disposition,
        su.name AS agent_name
      FROM ins
      JOIN public.lead_dispositions d ON d.id = ins.disposition_id
      LEFT JOIN public.system_users su ON su.id = ins.agent_id
    `;

    const result: any[] = await db.sequelize.query(query, {
      replacements: {
        id,
        lead_id: validatedData.lead_id,
        agent_id,
        disposition_id: validatedData.disposition_id,
        conversation: validatedData.conversation.trim(),
        now,
      },
      type: QueryTypes.SELECT,
    });

    return res.status(201).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 2. GET ALL ACTIVITIES FOR LEAD ====================
export const listActivities = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id || req.query?.lead_id;
    if (!lead_id) {
      return res
        .status(400)
        .json({ success: false, message: "Lead ID is required" });
    }

    const activities: any[] = await db.sequelize.query(
      `SELECT
         ah.id,
         d.name AS disposition,
         ah.disposition_id,
         ah.conversation,
         ah.occurred_at,
         ah.created_at,
         ah.updated_at,
         ah.is_edited,
         su.name AS agent_name,
         ah.agent_id
       FROM public.lead_activity_history ah
       JOIN public.lead_dispositions d ON d.id = ah.disposition_id
       LEFT JOIN public.system_users su ON su.id = ah.agent_id
       WHERE ah.lead_id = :lead_id
         AND ah.deleted_at IS NULL
       ORDER BY ah.created_at DESC`,
      { replacements: { lead_id }, type: QueryTypes.SELECT },
    );

    return res.status(200).json({ success: true, data: { activities } });
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
      { type: QueryTypes.SELECT },
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
      return res
        .status(400)
        .json({ success: false, message: "Activity ID is required" });
    }

    const validatedData = await updateLeadActivitySchema.validate(req.body, {
      abortEarly: false,
    });
    const now = new Date();

    const query = `
      WITH upd AS (
        UPDATE public.lead_activity_history SET
          disposition_id = COALESCE(:disposition_id, disposition_id),
          conversation = COALESCE(:conversation, conversation),
          is_edited = TRUE,
          updated_at = :now
        WHERE id = :id AND deleted_at IS NULL
        RETURNING *
      )
      SELECT
        upd.*,
        d.name AS disposition,
        su.name AS agent_name
      FROM upd
      JOIN public.lead_dispositions d ON d.id = upd.disposition_id
      LEFT JOIN public.system_users su ON su.id = upd.agent_id
    `;

    const result: any[] = await db.sequelize.query(query, {
      replacements: {
        id,
        disposition_id: validatedData.disposition_id || null,
        conversation: validatedData.conversation
          ? validatedData.conversation.trim()
          : null,
        now,
      },
      type: QueryTypes.SELECT,
    });

    if (result.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Activity record not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. DELETE ACTIVITY (SOFT DELETE) ====================
export const softDeleteActivity = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Activity ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `UPDATE public.lead_activity_history SET deleted_at = NOW(), updated_at = NOW() WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );

    if (result.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Activity record not found" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Activity deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  addActivity,
  listActivities,
  getAllDispositions,
  updateActivity,
  softDeleteActivity,
};
