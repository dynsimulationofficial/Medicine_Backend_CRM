import { WebPushToken, WebPushNotification } from "../models";
import { messaging } from "../provider/firebase";
import { v4 as uuidv4 } from "uuid";

class FCMService {
  /** Debug token validity - REMOVED TEST NOTIFICATION */
  async debugTokenValidity(token: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // ✅ REMOVED: No test notification sent during validation
      // Just check if we can get token info without sending actual notification
      await messaging.send({
        token: token,
        data: { 
          type: "validation",
          silent: "true" // Silent data-only message
        }
      }, true); // dryRun: true - doesn't actually send notification
      
      console.log(`✅ Token VALID: ${token.substring(0, 30)}...`);
      return { valid: true };
    } catch (error: any) {
      const errorCode = error?.errorInfo?.code || error?.code;
      const errorMessage = error?.errorInfo?.message || error?.message;
      
      console.log(`❌ Token INVALID: ${token.substring(0, 30)}...`);
      console.log(`   Error: ${errorCode} - ${errorMessage}`);
      
      // Mark token as inactive in database
      if (errorCode === 'messaging/registration-token-not-registered' || 
          errorCode === 'messaging/invalid-registration-token') {
        await WebPushToken.update(
          { is_active: false, updated_at: new Date() },
          { where: { fcmtoken: token } }
        );
        console.log(`   🔄 Token marked as inactive in database`);
      }
      
      return { valid: false, error: errorMessage };
    }
  }

  /** Clean up invalid tokens */
  async cleanupInvalidTokens(userId?: string) {
    try {
      const whereClause: any = { is_active: true };
      if (userId) {
        whereClause.system_user_id = userId;
      }

      const allTokens = await WebPushToken.findAll({
        where: whereClause,
        attributes: ['id', 'fcmtoken', 'system_user_id']
      });

      console.log(`🔍 Checking ${allTokens.length} active tokens for validity...`);

      let invalidCount = 0;
      for (const tokenRecord of allTokens) {
        const token = (tokenRecord as any).fcmtoken;
        const validity = await this.debugTokenValidity(token);
        if (!validity.valid) {
          invalidCount++;
        }
      }

      console.log(`✅ Token cleanup completed. Found ${invalidCount} invalid tokens.`);
      
      return { checked: allTokens.length, invalid: invalidCount };
    } catch (error) {
      console.error("❌ Error in cleanupInvalidTokens:", error);
      return { checked: 0, invalid: 0 };
    }
  }

  /** Common FCM sender with logging */
  async sendToMultipleWithLogging(
    tokens: string[],
    ctx: { type: "lead_created" | "lead_assigned" | "bulk_leads_assigned" | "task_assigned"; refId?: string | null; recipientUserId?: string | null },
    title: string,
    body: string,
    data: Record<string, any> = {}
  ) {
    const deduped = [...new Set(tokens.filter(Boolean))];

    // Filter only valid tokens
    const validTokens: string[] = [];
    for (const token of deduped) {
      const validity = await this.debugTokenValidity(token);
      if (validity.valid) {
        validTokens.push(token);
      }
    }

    // Always create at least one in-app notification record for recipient
    if (validTokens.length === 0) {
      if (ctx.recipientUserId) {
        await WebPushNotification.create({
          id: uuidv4(),
          type: ctx.type,
          ref_id: ctx.refId ?? null,
          recipient_user_id: ctx.recipientUserId,
          fcmtoken: "in_app_only",
          title,
          body,
          data,
          status: "sent",
        } as any);
      }
      console.log(`ℹ️ Saved in-app notification for user ${ctx.recipientUserId} (No active FCM push tokens)`);
      return { success: 1, failure: 0, note: "in-app notification created" };
    }

    const pending = validTokens.map((t) => ({
      id: uuidv4(),
      type: ctx.type,
      ref_id: ctx.refId ?? null,
      recipient_user_id: ctx.recipientUserId ?? null,
      fcmtoken: t,
      title,
      body,
      data,
      status: "pending" as const,
    }));
    
    await WebPushNotification.bulkCreate(pending as any);
    const logIds = pending.map((p) => p.id);

    const message = {
      tokens: validTokens,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          typeof v === "string" ? v : JSON.stringify(v),
        ])
      ),
    };

    try {
      const res = await messaging.sendEachForMulticast(message);
      console.log(`📊 FCM Response: ${res.successCount} success, ${res.failureCount} failure`);

      await Promise.all(
        res.responses.map(async (r, i) => {
          const where = { id: logIds[i] };
          if (r.success) {
            await WebPushNotification.update(
              { status: "sent", message_id: r.messageId, updated_at: new Date() },
              { where }
            );
          } else {
            const code = (r.error as any)?.errorInfo?.code || r.error?.code || "unknown";
            const msg = (r.error as any)?.message || String(r.error);
            await WebPushNotification.update(
              { status: "failed", error_message: `${code}: ${msg}`, updated_at: new Date() },
              { where }
            );
          }
        })
      );

      return { success: res.successCount, failure: res.failureCount };
    } catch (error) {
      console.error("❌ FCM send error:", error);
      return { success: 0, failure: validTokens.length };
    }
  }

  /** Notify single agent when a lead is assigned - ONE NOTIFICATION */
  async notifyLeadAssigned(
    agentUserId: string,
    lead: { id: string; lead_number: string; full_name: string }
  ) {
    console.log(`📨 Notifying lead assignment to agent ${agentUserId} for lead ${lead.id}`);
    const tokens = await this.getAgentTokens(agentUserId);

    const title = "New Lead Assigned";
    const body = `${lead.full_name || 'Customer'} (#${lead.lead_number}) was assigned to you.`;

    return this.sendToMultipleWithLogging(
      tokens,
      { type: "lead_assigned", refId: lead.id, recipientUserId: agentUserId },
      title,
      body,
      {
        type: "lead_assigned",
        lead_id: lead.id,
        lead_number: lead.lead_number,
        full_name: lead.full_name,
      }
    );
  }

  /** Notify summary for bulk assigned leads - ONLY ONE NOTIFICATION */
  async notifyBulkLeadsAssigned(
    agentUserId: string,
    leads: Array<{ id: string; lead_number: string; full_name: string }>
  ) {
    console.log(`📨 Notifying bulk lead assignment to agent ${agentUserId} for ${leads.length} leads`);
    const tokens = await this.getAgentTokens(agentUserId);

    const count = leads.length;
    const firstLead = leads[0];

    const title = "New Lead Assigned";
    const body =
      count === 1
        ? `${firstLead.full_name || 'Customer'} (#${firstLead.lead_number}) was assigned to you.`
        : `${count} leads were assigned to you.`;

    // ✅ ONLY ONE NOTIFICATION - no individual notifications created
    const pushResult = await this.sendToMultipleWithLogging(
      tokens,
      { 
        type: "bulk_leads_assigned", 
        refId: firstLead.id,
        recipientUserId: agentUserId 
      },
      title,
      body,
      {
        type: "bulk_leads_assigned",
        count: String(count),
        lead_id: firstLead.id,
        lead_number: firstLead.lead_number,
        full_name: firstLead.full_name,
      }
    );

    console.log(`✅ Sent notification for ${leads.length} assigned leads`);
    return pushResult;
  }

  /** Notify agent when a task/calling reminder is assigned */
  async notifyTaskAssigned(
    agentUserId: string,
    task: {
      id: string;
      lead_id: string;
      lead_name: string;
      subject: string;
      task_type?: string;
      start_at?: any;
    }
  ) {
    console.log(`📨 Notifying task assignment to agent ${agentUserId} for task ${task.id}`);
    const tokens = await this.getAgentTokens(agentUserId);

    const title = `New Task: ${task.task_type || "Follow-up"}`;
    const body = `${task.subject} for ${task.lead_name || "Lead"}`;

    return this.sendToMultipleWithLogging(
      tokens,
      { type: "task_assigned", refId: task.id, recipientUserId: agentUserId },
      title,
      body,
      {
        type: "task_assigned",
        task_id: task.id,
        lead_id: task.lead_id,
        lead_name: task.lead_name,
        subject: task.subject,
        task_type: task.task_type || "Follow-up",
      }
    );
  }

  /** Helper: get all active tokens of an agent */
  async getAgentTokens(agentUserId: string): Promise<string[]> {
    try {
      const rows = await WebPushToken.findAll({
        where: { 
          is_active: true, 
          system_user_id: agentUserId 
        },
        attributes: ["fcmtoken", "id"],
      });
      
      const tokens = rows.map((r: any) => r.fcmtoken).filter(Boolean);
      console.log(`🔍 Found ${tokens.length} active tokens for user ${agentUserId}`);
      return [...new Set(tokens)];
    } catch (error) {
      console.error("❌ Error in getAgentTokens:", error);
      return [];
    }
  }
}

export default new FCMService();