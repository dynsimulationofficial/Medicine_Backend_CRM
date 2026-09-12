import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import db from "../models";
import cloudTalkService from "../service/CloudTalkService";

export class AutoDialerController {
  /**
   * Helper to check if the current user is Admin
   */
  private async checkIsAdmin(userId: string | null): Promise<boolean> {
    if (!userId) return false;
    try {
      const rows: any[] = await db.sequelize.query(
        `SELECT r.name FROM public.user_role ur JOIN public.roles r ON ur.role_id = r.id WHERE ur.system_user_id = :userId LIMIT 1`,
        { replacements: { userId }, type: QueryTypes.SELECT }
      );
      return rows.length > 0 && rows[0]?.name?.toLowerCase() === "admin";
    } catch {
      return false;
    }
  }

  /**
   * 1. GET /leads/dialer/queue
   * Fetches the queued list of leads for the active agent / admin to auto-dial
   */
  public getDialerQueue = async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;
      const isAdmin = await this.checkIsAdmin(authUserId);

      const {
        lead_ids,
        status,
        campaign_id,
        lead_source_id,
        limit = 100,
      } = req.query as any;

      let whereConditions = [`l.deleted_at IS NULL`, `(l.phone IS NOT NULL AND TRIM(l.phone) != '')`];
      const replacements: any = {};

      // If specific selected lead IDs are passed (e.g. from checkboxes)
      if (lead_ids) {
        const idList = Array.isArray(lead_ids)
          ? lead_ids
          : String(lead_ids).split(",").map((id) => id.trim()).filter(Boolean);

        if (idList.length > 0) {
          whereConditions.push(`l.id IN (:idList)`);
          replacements.idList = idList;
        }
      } else {
        // If agent (non-admin), only show leads assigned to this agent
        if (!isAdmin && authUserId) {
          whereConditions.push(`l.agent_id = :authUserId`);
          replacements.authUserId = authUserId;
        }

        // Optional status filter
        if (status) {
          whereConditions.push(`l.lead_status = :status`);
          replacements.status = status;
        } else {
          // By default, exclude won/lost/closed leads if not specified
          whereConditions.push(`LOWER(COALESCE(l.lead_status, '')) NOT IN ('won', 'lost', 'closed', 'junk', 'invalid')`);
        }

        // Campaign filter
        if (campaign_id) {
          whereConditions.push(`l.campaign_id = :campaign_id`);
          replacements.campaign_id = campaign_id;
        }

        // Lead source filter
        if (lead_source_id) {
          whereConditions.push(`l.lead_source_id = :lead_source_id`);
          replacements.lead_source_id = lead_source_id;
        }
      }

      const whereClause = whereConditions.join(" AND ");
      const maxLimit = Math.min(Number(limit) || 100, 500);

      const query = `
        SELECT 
          l.id,
          l.lead_number,
          l.full_name,
          l.phone,
          l.email,
          l.whatsapp_number,
          l.lead_status,
          l.city,
          l.state,
          l.country,
          l.best_time_to_call,
          l.note,
          l.created_at,
          ls.name AS lead_source_name,
          c.name AS campaign_name,
          su.name AS agent_name,
          (
            SELECT json_build_object(
              'id', lah.id,
              'disposition', ld.name,
              'conversation', lah.conversation,
              'duration_seconds', lah.duration_seconds,
              'recording_url', lah.recording_url,
              'occurred_at', lah.occurred_at
            )
            FROM public.lead_activity_history lah
            LEFT JOIN public.lead_dispositions ld ON lah.disposition_id = ld.id
            WHERE lah.lead_id = l.id
            ORDER BY lah.created_at DESC
            LIMIT 1
          ) AS latest_activity
        FROM public.leads l
        LEFT JOIN public.lead_sources ls ON l.lead_source_id = ls.id
        LEFT JOIN public.campaigns c ON l.campaign_id = c.id
        LEFT JOIN public.system_users su ON l.agent_id = su.id
        WHERE ${whereClause}
        ORDER BY l.created_at DESC
        LIMIT ${maxLimit};
      `;

      const leads: any[] = await db.sequelize.query(query, {
        replacements,
        type: QueryTypes.SELECT,
      });

      return res.status(200).json({
        success: true,
        message: `Fetched ${leads.length} leads in auto-dialer queue`,
        data: {
          total: leads.length,
          leads,
        },
      });
    } catch (error: any) {
      console.error("getDialerQueue error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to load auto-dialer queue",
      });
    }
  };

  /**
   * 2. POST /leads/dialer/call-next
   * Initiates outbound call to the target lead via CloudTalk
   */
  public callNextLead = async (req: Request, res: Response) => {
    try {
      const { lead_id } = req.body;
      if (!lead_id) {
        return res.status(400).json({ success: false, message: "lead_id is required" });
      }

      const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

      // Fetch lead details
      const [lead]: any[] = await db.sequelize.query(
        `SELECT id, lead_number, full_name, phone, whatsapp_number, agent_id, lead_status 
         FROM public.leads 
         WHERE id = :lead_id AND deleted_at IS NULL 
         LIMIT 1`,
        { replacements: { lead_id }, type: QueryTypes.SELECT }
      );

      if (!lead) {
        return res.status(404).json({ success: false, message: "Lead not found" });
      }

      const targetPhone = lead.phone || lead.whatsapp_number;
      if (!targetPhone) {
        return res.status(400).json({ success: false, message: "Lead has no valid phone number" });
      }

      // Trigger CloudTalk API call
      const callResult = await cloudTalkService.makeCall({
        calleeNumber: targetPhone,
        callerNumber: process.env.CLOUDTALK_CALLER_NUMBER || "+12393290248",
      });

      if (!callResult.success) {
        const isOffline =
          callResult.status === 403 ||
          String(callResult.message || "").toLowerCase().includes("online");

        return res.status(400).json({
          success: false,
          isOffline,
          message: isOffline
            ? "CloudTalk Agent is currently Offline. Please open phone.cloudtalk.io to connect calls."
            : (callResult.message || "Failed to initiate call via CloudTalk"),
          data: {
            lead_id: lead.id,
            phone: targetPhone,
            dialLink: callResult.dialLink,
            fallbackTel: callResult.fallbackTel,
            cloudtalkPhoneUrl: "https://phone.cloudtalk.io",
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

      // Extract Call ID from CloudTalk response
      const callId =
        callResult.callId ||
        String(
          callResult.data?.responseData?.data?.id ||
          callResult.data?.responseData?.id ||
          callResult.data?.data?.id ||
          callResult.data?.id ||
          ""
        ).trim();
      const recordingUrl = callId ? `/cloudtalk/recordings/${callId}` : null;

      return res.status(200).json({
        success: true,
        message: `Auto-Dialer calling ${lead.full_name || targetPhone}...`,
        data: {
          lead_id: lead.id,
          lead_number: lead.lead_number,
          full_name: lead.full_name,
          phone: targetPhone,
          dialLink: callResult.dialLink,
          fallbackTel: callResult.fallbackTel,
          call_id: callId || null,
          recording_url: recordingUrl,
          cloudtalk: callResult,
        },
      });
    } catch (error: any) {
      console.error("callNextLead error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to initiate call for next lead",
      });
    }
  };

  /**
   * 3. POST /leads/dialer/quick-disposition
   * Saves disposition outcome, notes, recording URL, and optionally updates lead status during wrap-up
   */
  public saveQuickDisposition = async (req: Request, res: Response) => {
    try {
      const {
        lead_id,
        disposition_id,
        conversation,
        lead_status,
        activity_id,
        call_id,
        recording_url,
        duration_seconds,
      } = req.body;

      if (!lead_id) {
        return res.status(400).json({ success: false, message: "lead_id is required" });
      }

      const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

      let finalCallId = call_id || null;
      let finalRecordingUrl = recording_url || (finalCallId ? `/cloudtalk/recordings/${finalCallId}` : null);
      let finalDuration = duration_seconds ? Number(duration_seconds) : null;

      // 1. Check if the chosen disposition represents an unanswered / non-connected call
      let isNonConnectedDisp = false;
      if (disposition_id) {
        const [dispRow]: any[] = await db.sequelize.query(
          `SELECT name FROM public.lead_dispositions WHERE id = :disposition_id LIMIT 1`,
          { replacements: { disposition_id }, type: QueryTypes.SELECT }
        );
        const dispName = String(dispRow?.name || "").trim().toLowerCase();
        const nonConnectedList = [
          "no answer",
          "blank call",
          "dnd",
          "do not disturb",
          "busy",
          "ringing",
          "switch off",
          "switched off",
          "not reachable",
          "wrong number",
          "voice mail full",
          "voice mail not set",
          "sms conversation",
          "email conversation",
          "whatsapp conversation",
        ];
        isNonConnectedDisp = nonConnectedList.some(
          (k) => dispName === k || dispName.includes(k)
        );
      }

      // If call was not answered or rejected/cut, NEVER attach a call recording or talk duration
      if (isNonConnectedDisp) {
        finalCallId = null;
        finalRecordingUrl = null;
        finalDuration = null;
      } else {
        // If finalCallId was passed, verify it is NOT already linked to another activity
        if (finalCallId) {
          const [alreadyUsed]: any[] = await db.sequelize.query(
            `SELECT id FROM public.lead_activity_history 
             WHERE call_id = :finalCallId 
               AND deleted_at IS NULL 
               ${activity_id ? "AND id != :activity_id" : ""} 
             LIMIT 1`,
            {
              replacements: { finalCallId, activity_id: activity_id || null },
              type: QueryTypes.SELECT,
            }
          );
          if (alreadyUsed) {
            finalCallId = null;
            finalRecordingUrl = null;
          }
        }

        // Auto-lookup recent CloudTalk recording if not passed, but ONLY if not already used in DB
        if (!finalCallId) {
          try {
            const [lead]: any[] = await db.sequelize.query(
              `SELECT phone, whatsapp_number FROM public.leads WHERE id = :lead_id LIMIT 1`,
              { replacements: { lead_id }, type: QueryTypes.SELECT }
            );
            const targetPhone = lead?.phone || lead?.whatsapp_number;
            if (targetPhone) {
              const recordings = await cloudTalkService.getRecentRecordingsForPhone(targetPhone, 5);
              if (recordings.length > 0) {
                // Fetch all call_ids already linked to existing activities
                const usedCallRows: any[] = await db.sequelize.query(
                  `SELECT call_id FROM public.lead_activity_history WHERE call_id IS NOT NULL AND deleted_at IS NULL`,
                  { type: QueryTypes.SELECT }
                );
                const usedSet = new Set((usedCallRows || []).map((r: any) => String(r.call_id)));
                // Only pick a fresh recording that was actually recorded and never linked to another activity
                const freshRec = recordings.find(
                  (r) => !usedSet.has(String(r.callId)) && r.durationSeconds > 0
                );
                if (freshRec) {
                  finalCallId = freshRec.callId;
                  finalRecordingUrl = freshRec.recordingUrl;
                  finalDuration = freshRec.durationSeconds || finalDuration;
                }
              }
            }
          } catch {}
        }
      }

      // Update existing or insert new activity note
      if (activity_id) {
        await db.sequelize.query(
          `UPDATE public.lead_activity_history 
           SET disposition_id = COALESCE(:disposition_id, disposition_id),
               conversation = COALESCE(:conversation, conversation),
               call_id = COALESCE(:finalCallId, call_id),
               recording_url = COALESCE(:finalRecordingUrl, recording_url),
               duration_seconds = COALESCE(:finalDuration, duration_seconds),
               updated_at = NOW()
           WHERE id = :activity_id`,
          {
            replacements: {
              activity_id,
              disposition_id: disposition_id || null,
              conversation: conversation || null,
              finalCallId,
              finalRecordingUrl,
              finalDuration,
            },
            type: QueryTypes.UPDATE,
          }
        );
      } else if (conversation || disposition_id) {
        // Create new activity row on Save & Advance
        await db.sequelize.query(
          `INSERT INTO public.lead_activity_history (
             id, lead_id, agent_id, disposition_id, conversation, call_id, recording_url, duration_seconds, occurred_at, created_at, updated_at
           ) VALUES (
             :id, :lead_id, :agent_id, :disposition_id, :conversation, :call_id, :recording_url, :duration_seconds, NOW(), NOW(), NOW()
           )`,
          {
            replacements: {
              id: uuidv4(),
              lead_id,
              agent_id: authUserId,
              disposition_id: disposition_id || "fbc5af04-3f2c-41d1-8b65-7c65e84b95a1",
              conversation: conversation || "Auto-dialer call wrap-up note",
              call_id: finalCallId,
              recording_url: finalRecordingUrl,
              duration_seconds: finalDuration,
            },
            type: QueryTypes.INSERT,
          }
        );
      }

      // Update lead status if provided
      if (lead_status) {
        await db.sequelize.query(
          `UPDATE public.leads 
           SET lead_status = :lead_status, updated_at = NOW() 
           WHERE id = :lead_id`,
          {
            replacements: { lead_id, lead_status },
            type: QueryTypes.UPDATE,
          }
        );
      }

      return res.status(200).json({
        success: true,
        message: "Disposition and notes updated successfully",
      });
    } catch (error: any) {
      console.error("saveQuickDisposition error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update disposition",
      });
    }
  };
}

export const autoDialerController = new AutoDialerController();
export default autoDialerController;
