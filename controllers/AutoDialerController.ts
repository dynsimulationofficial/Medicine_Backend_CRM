import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import db from "../models";
import cloudTalkService from "../service/CloudTalkService";

export class AutoDialerController {
  // In-memory active call state for instantaneous agent screen-pop (0 DB overhead)
  private activeCall: {
    lead_id: string;
    lead_number?: string;
    full_name?: string;
    phone?: string;
    is_connected?: boolean;
    timestamp: number;
    campaign_id?: string | null;
  } | null = null;

  public activeParallelCampaign: {
    campaign_id: string;
    cloudtalk_campaign_id: string;
    tag_name: string;
    tag_id: number;
    total_leads: number;
    status: string;
    started_at: number;
  } | null = null;

  private stoppedAt: number = 0;

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
        // If agent (non-admin), only show leads assigned to this agent (unless browsing a campaign queue)
        if (!isAdmin && authUserId && !campaign_id) {
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

          // Default: only fetch pending leads that have NOT been dialed / assigned yet (anti-spam)
          const reDial = (req.query as any)?.re_dial === "true";
          if (!reDial) {
            whereConditions.push(`(l.agent_id IS NULL AND LOWER(COALESCE(l.lead_status, 'new')) = 'new')`);
          }
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
        `SELECT id, lead_number, full_name, phone, whatsapp_number, agent_id, lead_status, campaign_id 
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

      // Track active call in memory for instantaneous agent screen-pop
      this.activeCall = {
        lead_id: lead.id,
        lead_number: lead.lead_number,
        full_name: lead.full_name,
        phone: targetPhone,
        is_connected: true,
        timestamp: Date.now(),
        campaign_id: lead.campaign_id || null,
      };

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

      // Update lead status and automatically assign lead to the agent who handled the call
      if (authUserId) {
        const [userExists]: any[] = await db.sequelize.query(
          `SELECT id FROM public.system_users WHERE id = :authUserId LIMIT 1`,
          { replacements: { authUserId }, type: QueryTypes.SELECT }
        );
        if (userExists) {
          await db.sequelize.query(
            `UPDATE public.leads 
             SET agent_id = :authUserId,
                 lead_status = COALESCE(:lead_status, lead_status),
                 updated_at = NOW() 
             WHERE id = :lead_id`,
            {
              replacements: {
                lead_id,
                authUserId,
                lead_status: lead_status || null,
              },
              type: QueryTypes.UPDATE,
            }
          );
        } else if (lead_status) {
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
      } else if (lead_status) {
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

      // Clear active call state since disposition is completed
      if (this.activeCall?.lead_id === lead_id) {
        this.activeCall = null;
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

  /**
   * 3.1 POST /leads/dialer/save-and-advance
   * Saves disposition outcome and notes for the finished call, and immediately dials
   * the NEXT lead in the campaign/queue in ONE atomic server-side operation.
   * Eliminates client-side multi-step race conditions across Admin and Agent PCs.
   */
  public saveAndAdvance = async (req: Request, res: Response) => {
    try {
      const {
        lead_id,
        disposition_id,
        conversation,
        lead_status,
        campaign_id,
        call_id,
        recording_url,
        duration_seconds,
        activity_id,
      } = req.body;

      if (!lead_id) {
        return res.status(400).json({ success: false, message: "lead_id is required" });
      }

      const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

      // 1. Fetch current lead details from DB
      const [currentLeadRow]: any[] = await db.sequelize.query(
        `SELECT id, lead_number, full_name, phone, whatsapp_number, campaign_id, agent_id, lead_status
         FROM public.leads 
         WHERE id = :lead_id AND deleted_at IS NULL 
         LIMIT 1`,
        { replacements: { lead_id }, type: QueryTypes.SELECT }
      );

      if (!currentLeadRow) {
        return res.status(404).json({ success: false, message: "Lead not found" });
      }

      const resolvedCampaignId = campaign_id || currentLeadRow.campaign_id || null;

      // 2. Validate agent_id against system_users foreign key
      let validAgentId: string | null = null;
      if (authUserId) {
        const [user]: any[] = await db.sequelize.query(
          `SELECT id FROM public.system_users WHERE id = :authUserId LIMIT 1`,
          { replacements: { authUserId }, type: QueryTypes.SELECT }
        );
        if (user) validAgentId = user.id;
      }

      // 3. Resolve disposition
      let finalDispId = disposition_id;
      if (!finalDispId) {
        const [dispRow]: any[] = await db.sequelize.query(
          `SELECT id FROM public.lead_dispositions WHERE name ILIKE '%Phone Conversation%' LIMIT 1`,
          { type: QueryTypes.SELECT }
        );
        finalDispId = dispRow?.id || "fbc5af04-3f2c-41d1-8b65-7c65e84b95a1";
      }

      // 4. Save Activity History
      let finalCallId = call_id || null;
      let finalRecordingUrl = recording_url || (finalCallId ? "/cloudtalk/recordings/" + finalCallId : null);
      let finalDuration = duration_seconds ? Number(duration_seconds) : null;

      if (activity_id) {
        await db.sequelize.query(
          `UPDATE public.lead_activity_history 
           SET disposition_id = COALESCE(:finalDispId, disposition_id),
               conversation = COALESCE(:conversation, conversation),
               call_id = COALESCE(:finalCallId, call_id),
               recording_url = COALESCE(:finalRecordingUrl, recording_url),
               duration_seconds = COALESCE(:finalDuration, duration_seconds),
               updated_at = NOW()
           WHERE id = :activity_id`,
          {
            replacements: {
              activity_id,
              finalDispId,
              conversation: conversation || null,
              finalCallId,
              finalRecordingUrl,
              finalDuration,
            },
            type: QueryTypes.UPDATE,
          }
        );
      } else {
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
              agent_id: validAgentId,
              disposition_id: finalDispId,
              conversation: conversation || "Auto-dialer call wrap-up note",
              call_id: finalCallId,
              recording_url: finalRecordingUrl,
              duration_seconds: finalDuration,
            },
            type: QueryTypes.INSERT,
          }
        );
      }

      // 5. Update Current Lead Status & Agent
      await db.sequelize.query(
        `UPDATE public.leads 
         SET agent_id = COALESCE(:agent_id, agent_id),
             lead_status = COALESCE(:lead_status, 'Contacted'),
             updated_at = NOW() 
         WHERE id = :lead_id`,
        {
          replacements: {
            lead_id,
            agent_id: validAgentId,
            lead_status: lead_status || "Contacted",
          },
          type: QueryTypes.UPDATE,
        }
      );

      // 6. Find NEXT pending lead in queue
      let nextLead: any = null;

      if (resolvedCampaignId) {
        // Find next pending uncalled lead in this campaign
        const [nextRow]: any[] = await db.sequelize.query(
          `SELECT id, lead_number, full_name, phone, whatsapp_number, email, city, state, country, note, campaign_id
           FROM public.leads
           WHERE campaign_id = :campaign_id
             AND id != :lead_id
             AND agent_id IS NULL
             AND LOWER(COALESCE(lead_status, 'new')) = 'new'
             AND deleted_at IS NULL
             AND (phone IS NOT NULL AND TRIM(phone) != '')
           ORDER BY created_at DESC
           LIMIT 1`,
          { replacements: { campaign_id: resolvedCampaignId, lead_id }, type: QueryTypes.SELECT }
        );
        nextLead = nextRow || null;
      } else if (validAgentId) {
        // Individual assigned leads queue
        const [nextRow]: any[] = await db.sequelize.query(
          `SELECT id, lead_number, full_name, phone, whatsapp_number, email, city, state, country, note, campaign_id
           FROM public.leads
           WHERE agent_id = :agent_id
             AND id != :lead_id
             AND LOWER(COALESCE(lead_status, '')) NOT IN ('won', 'lost', 'closed', 'junk')
             AND deleted_at IS NULL
             AND (phone IS NOT NULL AND TRIM(phone) != '')
           ORDER BY created_at DESC
           LIMIT 1`,
          { replacements: { agent_id: validAgentId, lead_id }, type: QueryTypes.SELECT }
        );
        nextLead = nextRow || null;
      }

      // 7. If no more leads, campaign/queue is complete
      if (!nextLead) {
        this.activeCall = null;
        return res.status(200).json({
          success: true,
          has_next: false,
          completed: true,
          message: "All leads in queue have been completed!",
        });
      }

      // 8. Next lead found: Immediately initiate CloudTalk outbound call!
      const targetPhone = nextLead.phone || nextLead.whatsapp_number;
      const callResult = await cloudTalkService.makeCall({
        calleeNumber: targetPhone,
        callerNumber: process.env.CLOUDTALK_CALLER_NUMBER || "+12393290248",
      });

      const nextCallId =
        callResult.callId ||
        String(
          callResult.data?.responseData?.data?.id ||
          callResult.data?.responseData?.id ||
          callResult.data?.data?.id ||
          callResult.data?.id ||
          ""
        ).trim();
      const nextRecordingUrl = nextCallId ? "/cloudtalk/recordings/" + nextCallId : null;

      // Update activeCall in-memory state for instant screen-pop sync across all tabs/PCs
      this.activeCall = {
        lead_id: nextLead.id,
        lead_number: nextLead.lead_number,
        full_name: nextLead.full_name,
        phone: targetPhone,
        is_connected: true,
        timestamp: Date.now(),
        campaign_id: resolvedCampaignId,
      };

      return res.status(200).json({
        success: true,
        has_next: true,
        dialed: callResult.success,
        message: "Calling next lead: " + (nextLead.full_name || targetPhone) + "...",
        data: {
          next_lead: {
            id: nextLead.id,
            lead_number: nextLead.lead_number,
            full_name: nextLead.full_name,
            phone: targetPhone,
            whatsapp_number: nextLead.whatsapp_number,
            email: nextLead.email,
            campaign_id: resolvedCampaignId,
            call_id: nextCallId || null,
            recording_url: nextRecordingUrl,
            dialLink: callResult.dialLink,
            fallbackTel: callResult.fallbackTel,
          },
          cloudtalk: callResult,
        },
      });
    } catch (error: any) {
      console.error("saveAndAdvance error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to save disposition and advance to next lead",
      });
    }
  };

  /**
   * 4. POST /leads/dialer/auto-skip-timeout
   * Automatically logs "No Answer" disposition when a call is not answered within timeout (18s)
   * and returns success so the dialer smoothly advances without manual clicks.
   */
  public autoSkipTimeout = async (req: Request, res: Response) => {
    try {
      const { lead_id, campaign_id } = req.body;
      if (!lead_id) {
        return res.status(400).json({ success: false, message: "lead_id is required" });
      }
      const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

      // Find "No Answer" disposition ID
      const [dispRow]: any[] = await db.sequelize.query(
        `SELECT id FROM public.lead_dispositions WHERE name ILIKE '%No Answer%' LIMIT 1`,
        { type: QueryTypes.SELECT }
      );
      const noAnswerDispId = dispRow?.id || "fbc5af04-3f2c-41d1-8b65-7c65e84b95a1";

      // Log Activity with NO recording and NO duration
      await db.sequelize.query(
        `INSERT INTO public.lead_activity_history (
           id, lead_id, agent_id, disposition_id, conversation, call_id, recording_url, duration_seconds, occurred_at, created_at, updated_at
         ) VALUES (
           :id, :lead_id, :agent_id, :disposition_id, :conversation, NULL, NULL, NULL, NOW(), NOW(), NOW()
         )`,
        {
          replacements: {
            id: uuidv4(),
            lead_id,
            agent_id: authUserId,
            disposition_id: noAnswerDispId,
            conversation: "Auto-dialer: Ring timeout / No answer (Auto-skipped)",
          },
          type: QueryTypes.INSERT,
        }
      );

      // Update lead status to 'No Answer' if not won/converted/closed
      await db.sequelize.query(
        `UPDATE public.leads 
         SET lead_status = COALESCE(NULLIF(lead_status, ''), 'No Answer'), updated_at = NOW() 
         WHERE id = :lead_id AND LOWER(COALESCE(lead_status, '')) NOT IN ('won', 'converted', 'closed')`,
        {
          replacements: { lead_id },
          type: QueryTypes.UPDATE,
        }
      );

      // Clear active call since it was dropped / unanswered
      if (this.activeCall?.lead_id === lead_id) {
        this.activeCall = null;
      }

      return res.status(200).json({
        success: true,
        message: "Lead auto-skipped due to ring timeout",
      });
    } catch (error: any) {
      console.error("autoSkipTimeout error:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to auto-skip lead" });
    }
  };

  /**
   * 5. POST /leads/dialer/call-connected
   * Marks current call as answered/connected by customer, triggering screen-pop
   */
  public markCallConnected = async (req: Request, res: Response) => {
    try {
      const { lead_id } = req.body;
      if (this.activeCall && (!lead_id || this.activeCall.lead_id === lead_id)) {
        this.activeCall.is_connected = true;
        this.activeCall.timestamp = Date.now();
      } else if (lead_id) {
        const [lead]: any[] = await db.sequelize.query(
          `SELECT id, lead_number, full_name, phone FROM public.leads WHERE id = :lead_id LIMIT 1`,
          { replacements: { lead_id }, type: QueryTypes.SELECT }
        );
        if (lead) {
          this.activeCall = {
            lead_id: lead.id,
            lead_number: lead.lead_number,
            full_name: lead.full_name,
            phone: lead.phone,
            is_connected: true,
            timestamp: Date.now(),
          };
        }
      }
      return res.status(200).json({ success: true, data: this.activeCall });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };

  /**
   * 6. GET /leads/dialer/campaign-stats
   * Returns live calling stats for a specific campaign
   */
  public getCampaignDialerStats = async (req: Request, res: Response) => {
    try {
      const { campaign_id } = req.query as any;
      if (!campaign_id) {
        return res.status(400).json({ success: false, message: "campaign_id is required" });
      }

      // Total leads in campaign
      const [totalRow]: any[] = await db.sequelize.query(
        `SELECT COUNT(*) as total FROM public.leads WHERE campaign_id = :campaign_id AND deleted_at IS NULL`,
        { replacements: { campaign_id }, type: QueryTypes.SELECT }
      );
      const total = parseInt(totalRow?.total || "0");

      // Leads that have at least one activity recorded
      const [dialedRow]: any[] = await db.sequelize.query(
        `SELECT COUNT(DISTINCT l.id) as dialed 
         FROM public.leads l
         JOIN public.lead_activity_history lah ON l.id = lah.lead_id
         WHERE l.campaign_id = :campaign_id AND l.deleted_at IS NULL AND lah.deleted_at IS NULL`,
        { replacements: { campaign_id }, type: QueryTypes.SELECT }
      );
      const dialed = parseInt(dialedRow?.dialed || "0");

      // Connected leads (activities with duration > 0 or recording attached or interested/order status)
      const [connectedRow]: any[] = await db.sequelize.query(
        `SELECT COUNT(DISTINCT l.id) as connected
         FROM public.leads l
         JOIN public.lead_activity_history lah ON l.id = lah.lead_id
         LEFT JOIN public.lead_dispositions ld ON lah.disposition_id = ld.id
         WHERE l.campaign_id = :campaign_id 
           AND l.deleted_at IS NULL 
           AND lah.deleted_at IS NULL
           AND (lah.duration_seconds > 0 OR lah.recording_url IS NOT NULL OR LOWER(COALESCE(ld.name, '')) NOT IN ('no answer', 'busy', 'ringing', 'switch off', 'switched off', 'not reachable', 'wrong number', 'dnd'))`,
        { replacements: { campaign_id }, type: QueryTypes.SELECT }
      );
      const connected = parseInt(connectedRow?.connected || "0");

      // Dropped / No answer count
      const dropped = Math.max(0, dialed - connected);
      const pending = Math.max(0, total - dialed);

      return res.status(200).json({
        success: true,
        data: {
          campaign_id,
          total,
          dialed,
          connected,
          dropped,
          pending,
        },
      });
    } catch (error: any) {
      console.error("getCampaignDialerStats error:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to fetch stats" });
    }
  };

  /**
   * 7. GET /leads/dialer/active-call
   * Returns current active connected call for agent screen-pop (< 1ms, 0 DB load)
   * In Parallel Mode, detects live answered calls delivered by CloudTalk to Shakeel
   */
  public getActiveCall = async (_req: Request, res: Response) => {
    // Expire active call after 15 minutes if not completed
    if (this.activeCall && Date.now() - this.activeCall.timestamp > 900000) {
      this.activeCall = null;
    }

    // In Parallel Zero-Waste Mode: if memory call is empty, check CloudTalk live calls for agent Shakeel
    // (Only if not explicitly stopped within the last 30 seconds)
    if (!this.activeCall && Date.now() - this.stoppedAt > 30000) {
      try {
        const liveCall = await cloudTalkService.getActiveCallForAgent("588998");
        if (liveCall && liveCall.phone) {
          const searchTail = liveCall.phone.replace(/\D/g, "").slice(-10);
          if (searchTail.length >= 7) {
            const [matchedLead]: any[] = await db.sequelize.query(
              `SELECT id, lead_number, full_name, phone, whatsapp_number, campaign_id 
               FROM public.leads 
               WHERE deleted_at IS NULL 
                 AND (
                   REGEXP_REPLACE(phone, '\\D', '', 'g') LIKE :tail 
                   OR REGEXP_REPLACE(whatsapp_number, '\\D', '', 'g') LIKE :tail
                 )
               LIMIT 1`,
              { replacements: { tail: `%${searchTail}%` }, type: QueryTypes.SELECT }
            );

            if (matchedLead) {
              this.activeCall = {
                lead_id: matchedLead.id,
                lead_number: matchedLead.lead_number,
                full_name: matchedLead.full_name,
                phone: matchedLead.phone || liveCall.phone,
                is_connected: true,
                timestamp: Date.now(),
                campaign_id: matchedLead.campaign_id || null,
              };
            }
          }
        }
      } catch (err) {
        console.error("getActiveCall live check error:", err);
      }
    }

    return res.status(200).json({
      success: true,
      data: this.activeCall,
    });
  };

  /**
   * 8. GET /leads/dialer/call-status
   * Checks real-time status of the current active call via CloudTalk API & activity history
   */
  public checkCallStatus = async (req: Request, res: Response) => {
    try {
      const callId = req.query.call_id as string | undefined;
      const phone = (req.query.phone as string | undefined) || this.activeCall?.phone;
      const since = req.query.since ? Number(req.query.since) : this.activeCall?.timestamp;
      const targetLeadId = (req.query.lead_id as string) || this.activeCall?.lead_id;

      const status = await cloudTalkService.getLatestCallStatus({
        callId,
        phone,
        since,
      });

      // Check if disposition / activity was saved by the agent for this lead
      let dispositionSaved = false;
      if (targetLeadId) {
        const [recentAct]: any[] = await db.sequelize.query(
          `SELECT id FROM public.lead_activity_history 
           WHERE lead_id = :targetLeadId 
             AND created_at >= :sinceDate 
           LIMIT 1`,
          {
            replacements: {
              targetLeadId,
              sinceDate: new Date((this.activeCall?.timestamp || Date.now()) - 10000),
            },
            type: QueryTypes.SELECT,
          }
        );
        if (recentAct) dispositionSaved = true;
      }

      // If answered in CloudTalk, mark activeCall as connected
      if (status.isAnswered && this.activeCall) {
        this.activeCall.is_connected = true;
      }

      // Only mark completed if disposition was saved by the agent, or if an answered conversation ended
      const isCompleted = Boolean(dispositionSaved || (status.isAnswered && status.isEnded));
      if (dispositionSaved && this.activeCall) {
        this.activeCall = null;
      }

      return res.status(200).json({
        success: true,
        data: {
          ...status,
          dispositionSaved,
          isCompleted,
          activeCall: this.activeCall,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };

  /**
   * 9. GET /leads/dialer/agent-status
   * Returns current CloudTalk agent online status
   */
  public getAgentStatus = async (_req: Request, res: Response) => {
    try {
      const result = await cloudTalkService.getAgentStatus();
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      return res.status(200).json({
        success: true,
        data: { isOnline: true, status: "unknown", agentName: "Shakeel Ahmed" },
      });
    }
  };

  /**
   * 10. POST /leads/dialer/start-parallel
   * Starts True Zero-Waste CloudTalk Parallel Campaign (Agent hears 0s ringing)
   */
  public startParallelCampaign = async (req: Request, res: Response) => {
    try {
      const { campaign_id } = req.body;
      if (!campaign_id) {
        return res.status(400).json({ success: false, message: "campaign_id is required" });
      }

      // 1. Verify agent Shakeel is Online in CloudTalk
      const agentStatus = await cloudTalkService.getAgentStatus();
      if (!agentStatus.isOnline) {
        return res.status(400).json({
          success: false,
          isOffline: true,
          message: `Agent ${agentStatus.agentName} is currently Offline in CloudTalk Phone app. Please ask the agent to set status to Online (Green).`,
        });
      }

      // 2. Fetch Campaign details
      const [campaign]: any[] = await db.sequelize.query(
        `SELECT id, name FROM public.campaigns WHERE id = :campaign_id LIMIT 1`,
        { replacements: { campaign_id }, type: QueryTypes.SELECT }
      );
      if (!campaign) {
        return res.status(404).json({ success: false, message: "Campaign not found" });
      }

      // 3. Fetch all pending unassigned leads
      const pendingLeads: any[] = await db.sequelize.query(
        `SELECT id, full_name, phone, whatsapp_number 
         FROM public.leads 
         WHERE campaign_id = :campaign_id 
           AND agent_id IS NULL 
           AND LOWER(COALESCE(lead_status, 'new')) = 'new'
           AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        { replacements: { campaign_id }, type: QueryTypes.SELECT }
      );

      if (!pendingLeads || pendingLeads.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No pending unassigned leads in this campaign to dial.",
        });
      }

      // 4. Create or ensure Tag in CloudTalk for this campaign
      const safeCampName = String(campaign.name || "Campaign").replace(/[^a-zA-Z0-9_-]/g, "_");
      const tagName = `CRM_${safeCampName}_${String(campaign.id).substring(0, 8)}`;
      const tagId = await cloudTalkService.getOrCreateTag(tagName);

      // 5. Sync pending leads to CloudTalk with this Tag
      const contactList = pendingLeads.map((l: any) => ({
        name: l.full_name || "Lead",
        phone: l.phone || l.whatsapp_number,
      }));
      await cloudTalkService.syncLeadsToCloudTalk(tagName, contactList);

      // 6. Ensure CloudTalk Parallel Campaign exists with Tag + Group + Agent
      const { campaignId: cloudTalkCampId } = await cloudTalkService.ensureParallelCampaign(
        campaign.name,
        tagId
      );

      // 7. Activate the CloudTalk Parallel Campaign
      if (cloudTalkCampId) {
        await cloudTalkService.setParallelCampaignStatus(cloudTalkCampId, "active");
      }

      this.activeParallelCampaign = {
        campaign_id,
        cloudtalk_campaign_id: cloudTalkCampId,
        tag_name: tagName,
        tag_id: tagId,
        total_leads: pendingLeads.length,
        status: "active",
        started_at: Date.now(),
      };
      this.stoppedAt = 0;

      return res.status(200).json({
        success: true,
        message: `Zero-Waste Parallel Campaign started! CloudTalk will dial in background and connect to Shakeel only when customer answers.`,
        data: this.activeParallelCampaign,
      });
    } catch (err: any) {
      console.error("startParallelCampaign error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  };

  /**
   * 11. POST /leads/dialer/stop-parallel
   * Stops/pauses the active CloudTalk Parallel Campaign
   */
  public stopParallelCampaign = async (req: Request, res: Response) => {
    try {
      const { cloudtalk_campaign_id } = req.body;
      const targetCampId = cloudtalk_campaign_id || this.activeParallelCampaign?.cloudtalk_campaign_id;

      if (targetCampId) {
        await cloudTalkService.setParallelCampaignStatus(targetCampId, "inactive");
      }

      this.activeParallelCampaign = null;
      this.activeCall = null;
      this.stoppedAt = Date.now();

      return res.status(200).json({
        success: true,
        message: "Campaign calling stopped successfully.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };

  /**
   * 12. GET /leads/dialer/parallel-status
   * Returns live status of active parallel campaign
   */
  public getParallelCampaignStatus = async (req: Request, res: Response) => {
    const { campaign_id } = req.query as any;
    const isCurrent =
      !campaign_id || (this.activeParallelCampaign && this.activeParallelCampaign.campaign_id === campaign_id);

    return res.status(200).json({
      success: true,
      data: isCurrent ? this.activeParallelCampaign : null,
    });
  };
}

export const autoDialerController = new AutoDialerController();
export default autoDialerController;

