import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import db from "../models";
import cloudTalkService from "../service/CloudTalkService";

// ==================== 1. INITIATE CLICK-TO-CALL ====================
export const initiateClickToCall = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id || req.query?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

    // Fetch lead details
    const [lead]: any[] = await db.sequelize.query(
      `SELECT id, full_name, phone, whatsapp_number, agent_id FROM public.leads WHERE id = :lead_id AND deleted_at IS NULL LIMIT 1`,
      { replacements: { lead_id }, type: QueryTypes.SELECT }
    );

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const targetPhone = lead.phone || lead.whatsapp_number;
    if (!targetPhone) {
      return res.status(400).json({ success: false, message: "Lead has no phone number" });
    }

    // Trigger call via CloudTalk REST API
    const callResult = await cloudTalkService.makeCall({
      calleeNumber: targetPhone,
      callerNumber: process.env.CLOUDTALK_CALLER_NUMBER || "+12393290248",
    });

    // Check if CloudTalk failed to initiate call (e.g. Agent is offline)
    if (!callResult.success) {
      const isOffline =
        callResult.status === 403 ||
        String(callResult.message || "").toLowerCase().includes("online");

      return res.status(400).json({
        success: false,
        isOffline,
        message: isOffline
          ? "CloudTalk Agent is currently Offline. Please open and login to CloudTalk Phone (phone.cloudtalk.io) so calls can be connected."
          : (callResult.message || "Failed to initiate call via CloudTalk"),
        data: {
          lead_id: lead.id,
          phone: targetPhone,
          dialLink: callResult.dialLink,
          fallbackTel: callResult.fallbackTel,
          cloudtalkPhoneUrl: "https://phone.cloudtalk.io",
          cloudtalk: callResult,
        },
      });
    }

    // Lookup default "Phone Conversation" disposition
    const [disp]: any[] = await db.sequelize.query(
      `SELECT id FROM public.lead_dispositions WHERE name ILIKE '%Phone Conversation%' LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    const dispositionId = disp?.id || "fbc5af04-3f2c-41d1-8b65-7c65e84b95a1";

    // Validate agent_id against system_users foreign key
    let resolvedAgentId: string | null = null;
    const candidateAgentId = authUserId || lead.agent_id;
    if (candidateAgentId) {
      const [userExists]: any[] = await db.sequelize.query(
        `SELECT id FROM public.system_users WHERE id = :candidateAgentId LIMIT 1`,
        { replacements: { candidateAgentId }, type: QueryTypes.SELECT }
      );
      if (userExists) {
        resolvedAgentId = userExists.id;
      }
    }

    // Initial activity log (only on successful call dispatch)
    const activityId = uuidv4();
    await db.sequelize.query(
      `INSERT INTO public.lead_activity_history (
         id, lead_id, agent_id, disposition_id, conversation, occurred_at, created_at, updated_at
       ) VALUES (
         :id, :lead_id, :agent_id, :disposition_id, :conversation, NOW(), NOW(), NOW()
       )`,
      {
        replacements: {
          id: activityId,
          lead_id: lead.id,
          agent_id: resolvedAgentId,
          disposition_id: dispositionId,
          conversation: `Outbound Call initiated to ${targetPhone} via CloudTalk`,
        },
        type: QueryTypes.INSERT,
      }
    );

    return res.status(200).json({
      success: true,
      message: `Calling ${lead.full_name || targetPhone}...`,
      data: {
        lead_id: lead.id,
        phone: targetPhone,
        dialLink: callResult.dialLink,
        fallbackTel: callResult.fallbackTel,
        activity_id: activityId,
        cloudtalk: callResult,
      },
    });
  } catch (error: any) {
    console.error("initiateClickToCall error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to initiate call" });
  }
};

// ==================== 2. HANDLE CLOUDTALK WEBHOOK ====================
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const payload = req.body || {};
    console.log("CloudTalk Webhook received:", JSON.stringify(payload));

    const event = payload.event || payload.action || "";
    const callData = payload.call || payload.data || payload;

    const callId = String(callData.call_id || callData.id || "");
    const callerNumber = String(callData.caller_number || callData.from || callData.caller || "");
    const calleeNumber = String(callData.callee_number || callData.to || callData.callee || "");
    const direction = (callData.direction || (callerNumber.includes("2393290248") ? "outbound" : "inbound")).toLowerCase();

    // Duration in seconds
    const durationSeconds = Number(callData.talking_time ?? callData.duration ?? 0);
    const status = String(callData.status || callData.call_status || "completed").toLowerCase();
    const recordingUrl = callData.recording_url || callData.recording || callData.record_url || null;

    // Detect target phone (the customer/lead phone)
    const customerPhone = direction === "inbound" ? callerNumber : calleeNumber;
    const phoneDigits = customerPhone.replace(/\D/g, "");

    if (phoneDigits.length >= 7) {
      // Find matching lead
      const searchTail = phoneDigits.slice(-10); // match last 10 digits
      const [lead]: any[] = await db.sequelize.query(
        `SELECT id, full_name, agent_id FROM public.leads
         WHERE deleted_at IS NULL
           AND (
             REGEXP_REPLACE(phone, '\\D', '', 'g') LIKE :tail
             OR REGEXP_REPLACE(whatsapp_number, '\\D', '', 'g') LIKE :tail
           )
         LIMIT 1`,
        { replacements: { tail: `%${searchTail}%` }, type: QueryTypes.SELECT }
      );

      if (lead) {
        // Determine appropriate disposition
        let dispositionName = "Phone Conversation";
        if (status.includes("miss") || status.includes("no_answer") || durationSeconds === 0) {
          dispositionName = "No Answer";
        } else if (status.includes("voicemail")) {
          dispositionName = "Left A Voice Mail";
        }

        const [disp]: any[] = await db.sequelize.query(
          `SELECT id FROM public.lead_dispositions WHERE name ILIKE :dName LIMIT 1`,
          { replacements: { dName: `%${dispositionName}%` }, type: QueryTypes.SELECT }
        );
        const dispositionId = disp?.id || "fbc5af04-3f2c-41d1-8b65-7c65e84b95a1";

        const dirLabel = direction === "inbound" ? "Inbound Call (Customer called)" : "Outbound Call";
        const durationLabel = cloudTalkService.formatDuration(durationSeconds);
        const conversationNote = `${dirLabel} - Status: ${status.toUpperCase()} (Duration: ${durationLabel})`;

        // Check if activity already exists for this call_id
        if (callId) {
          const [existingActivity]: any[] = await db.sequelize.query(
            `SELECT id FROM public.lead_activity_history WHERE call_id = :callId LIMIT 1`,
            { replacements: { callId }, type: QueryTypes.SELECT }
          );

          if (existingActivity) {
            await db.sequelize.query(
              `UPDATE public.lead_activity_history
               SET conversation = :conversationNote,
                   recording_url = COALESCE(:recordingUrl, recording_url),
                   duration_seconds = :durationSeconds,
                   disposition_id = :dispositionId,
                   updated_at = NOW()
               WHERE id = :id`,
              {
                replacements: {
                  id: existingActivity.id,
                  conversationNote,
                  recordingUrl,
                  durationSeconds,
                  dispositionId,
                },
                type: QueryTypes.UPDATE,
              }
            );
            return res.status(200).json({ success: true, message: "Activity updated from webhook" });
          }
        }

        // Resolve valid system_users ID if present to satisfy foreign key constraint
        let resolvedAgentId: string | null = null;
        if (lead.agent_id) {
          const [userExists]: any[] = await db.sequelize.query(
            `SELECT id FROM public.system_users WHERE id = :agentId LIMIT 1`,
            { replacements: { agentId: lead.agent_id }, type: QueryTypes.SELECT }
          );
          if (userExists) {
            resolvedAgentId = userExists.id;
          }
        }

        // Insert fresh activity
        await db.sequelize.query(
          `INSERT INTO public.lead_activity_history (
             id, lead_id, agent_id, disposition_id, conversation, recording_url, duration_seconds, call_id, occurred_at, created_at, updated_at
           ) VALUES (
             :id, :lead_id, :agent_id, :disposition_id, :conversationNote, :recordingUrl, :durationSeconds, :callId, NOW(), NOW(), NOW()
           )`,
          {
            replacements: {
              id: uuidv4(),
              lead_id: lead.id,
              agent_id: resolvedAgentId,
              disposition_id: dispositionId,
              conversationNote,
              recordingUrl,
              durationSeconds,
              callId: callId || null,
            },
            type: QueryTypes.INSERT,
          }
        );
      }
    }

    return res.status(200).json({ success: true, message: "Webhook processed" });
  } catch (error: any) {
    console.error("CloudTalk webhook error:", error);
    return res.status(200).json({ success: true, warning: error.message });
  }
};

export default {
  initiateClickToCall,
  handleWebhook,
};
