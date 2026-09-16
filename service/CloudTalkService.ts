export interface InitiateCallParams {
  calleeNumber: string;
  callerNumber?: string;
  agentId?: string;
}

export class CloudTalkService {
  private apiId: string;
  private apiSecret: string;
  private defaultCallerNumber: string;
  private defaultAgentId: string;
  private baseUrl = "https://my.cloudtalk.io/api";

  constructor() {
    this.apiId = process.env.CLOUDTALK_API_ID || "22Y7ST4CCOCMQQQ5T2BYH";
    this.apiSecret = process.env.CLOUDTALK_API_SECRET || "wjmPHw36tL81z0+d!IK563siFJQFGt2rJpcW3RXf5h";
    this.defaultCallerNumber = process.env.CLOUDTALK_CALLER_NUMBER || "+12393290248";
    this.defaultAgentId = process.env.CLOUDTALK_AGENT_ID || "588998";
  }

  private getAuthHeader(): string {
    const credentials = `${this.apiId}:${this.apiSecret}`;
    return `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  /**
   * Initiate an outbound call via CloudTalk REST API
   */
  public async makeCall(params: InitiateCallParams): Promise<any> {
    const callerNumber = params.callerNumber || this.defaultCallerNumber;
    const agentId = params.agentId || this.defaultAgentId;
    const rawDigits = params.calleeNumber.replace(/\D/g, "");
    let normalizedCallee = params.calleeNumber.trim();
    if (!normalizedCallee.startsWith("+")) {
      if (rawDigits.length === 10) {
        normalizedCallee = `+91${rawDigits}`;
      } else {
        normalizedCallee = `+${rawDigits}`;
      }
    }

    const payload = {
      callee_number: normalizedCallee,
      caller_id: callerNumber,
      agent_id: agentId,
    };

    try {
      const response = await fetch(`${this.baseUrl}/calls/create.json`, {
        method: "POST",
        headers: {
          Authorization: this.getAuthHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as any;
      if (!response.ok) {
        console.warn("CloudTalk makeCall response not ok:", data);
        // Fallback info for client dialer
        return {
          success: false,
          status: response.status,
          message: data?.message || data?.responseData?.message || "Failed to trigger automated call",
          dialLink: `cloudtalk://dial/${encodeURIComponent(normalizedCallee)}`,
          fallbackTel: `tel:${encodeURIComponent(normalizedCallee)}`,
        };
      }

      const callId = String(
        data?.responseData?.data?.id ||
        data?.responseData?.id ||
        data?.data?.id ||
        data?.id ||
        ""
      ).trim();

      return {
        success: true,
        data,
        callId: callId || undefined,
        dialLink: `cloudtalk://dial/${encodeURIComponent(normalizedCallee)}`,
        fallbackTel: `tel:${encodeURIComponent(normalizedCallee)}`,
      };
    } catch (error: any) {
      console.error("CloudTalk makeCall error:", error);
      return {
        success: false,
        message: error.message,
        dialLink: `cloudtalk://dial/${encodeURIComponent(normalizedCallee)}`,
        fallbackTel: `tel:${encodeURIComponent(normalizedCallee)}`,
      };
    }
  }

  /**
   * Fetch latest call status from CloudTalk to check if current call is answered / ended
   */
  public async getLatestCallStatus(options?: {
    callId?: string;
    phone?: string;
    since?: number;
  }): Promise<{
    callId?: string;
    isAnswered: boolean;
    isEnded: boolean;
    talkingTime: number;
    cdr?: any;
  }> {
    try {
      const callId = options?.callId;
      const phone = options?.phone;
      const since = options?.since || 0;

      let url = `${this.baseUrl}/calls/index.json?limit=5`;
      if (callId) {
        url = `${this.baseUrl}/calls/index.json?id=${encodeURIComponent(callId)}`;
      } else if (phone) {
        const cleanPhone = phone.replace(/\D/g, "");
        if (cleanPhone.length >= 7) {
          url = `${this.baseUrl}/calls/index.json?public_external=${encodeURIComponent("+" + cleanPhone)}&limit=5`;
        }
      }

      const response = await fetch(url, {
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return { isAnswered: false, isEnded: false, talkingTime: 0 };
      }

      const json = (await response.json()) as any;
      const calls: any[] = json?.responseData?.data || [];
      if (!calls || calls.length === 0) {
        return { isAnswered: false, isEnded: false, talkingTime: 0 };
      }

      let matchedCdr: any = null;
      for (const item of calls) {
        const cdr = item.Cdr || item;
        if (!cdr) continue;

        // If phone is provided, match by phone number
        if (phone) {
          const searchTail = phone.replace(/\D/g, "").slice(-10);
          const external = String(cdr.public_external || cdr.caller || cdr.callee || "").replace(/\D/g, "");
          if (!external.includes(searchTail)) {
            continue;
          }
        }

        // If 'since' is provided, strictly ignore any calls started before this dialing session
        if (since > 0 && cdr.started_at) {
          const callStartTime = new Date(cdr.started_at).getTime();
          if (callStartTime < since - 20000) {
            // Old call from earlier session!
            continue;
          }
        }

        matchedCdr = cdr;
        break;
      }

      if (!matchedCdr) {
        // No call in CloudTalk yet for this new dial
        return { isAnswered: false, isEnded: false, talkingTime: 0 };
      }

      // True answered status: answered_at exists and either talking_time > 0 or not immediately ended at same second
      const isAnswered = Boolean(
        matchedCdr.answered_at &&
        (Number(matchedCdr.talking_time || 0) > 0 || matchedCdr.answered_at !== matchedCdr.ended_at)
      );
      const isEnded = Boolean(matchedCdr.ended_at);
      const talkingTime = Number(matchedCdr.talking_time || matchedCdr.billsec || 0);

      return {
        callId: matchedCdr.id,
        isAnswered,
        isEnded,
        talkingTime,
        cdr: matchedCdr,
      };
    } catch (error) {
      console.error("CloudTalk getLatestCallStatus error:", error);
      return { isAnswered: false, isEnded: false, talkingTime: 0 };
    }
  }

  /**
   * Fetch call details by call ID
   */
  public async getCallDetails(callId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/calls/show/${callId}.json`, {
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;
      const json = (await response.json()) as any;
      return json?.responseData?.data || json?.responseData || null;
    } catch (error) {
      console.error("CloudTalk getCallDetails error:", error);
      return null;
    }
  }

  /**
   * Fetch call audio recording binary from CloudTalk API
   */
  public async getRecording(callId: string): Promise<{
    ok: boolean;
    status: number;
    contentType?: string;
    buffer?: Buffer;
    message?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/calls/recording/${callId}.json`, {
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        let msg = "Recording not found or not ready yet";
        try {
          const json = (await response.json()) as any;
          msg = json?.responseData?.message || json?.message || msg;
        } catch {}
        return { ok: false, status: response.status, message: msg };
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return {
        ok: true,
        status: 200,
        contentType: response.headers.get("content-type") || "audio/wav",
        buffer,
      };
    } catch (error: any) {
      console.error("CloudTalk getRecording error:", error);
      return { ok: false, status: 500, message: error.message };
    }
  }

  /**
   * Helper to format seconds to human-readable string (e.g. 2m 45s)
   */
  public formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  /**
   * Find recent call recordings for a target phone number
   */
  public async getRecentRecordingsForPhone(phone: string, limit = 25): Promise<Array<{
    callId: string;
    durationSeconds: number;
    startedAt: string;
    recordingUrl: string;
  }>> {
    try {
      const cleanPhone = phone.replace(/\D/g, "");
      if (cleanPhone.length < 7) return [];
      const searchTail = cleanPhone.slice(-10); // match last 10 digits

      const response = await fetch(`${this.baseUrl}/calls/index.json?limit=${limit}`, {
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
        },
      });

      if (!response.ok) return [];
      const json = (await response.json()) as any;
      const calls: any[] = json?.responseData?.data || [];

      const matchedRecordings: Array<{
        callId: string;
        durationSeconds: number;
        startedAt: string;
        recordingUrl: string;
      }> = [];

      for (const item of calls) {
        const cdr = item.Cdr || item;
        const external = String(cdr.public_external || cdr.caller || cdr.callee || "").replace(/\D/g, "");
        const recorded = Boolean(cdr.recorded);
        const callId = String(cdr.id || "");

        if (callId && recorded && external.includes(searchTail)) {
          matchedRecordings.push({
            callId,
            durationSeconds: Number(cdr.talking_time || cdr.billsec || 0),
            startedAt: cdr.started_at,
            recordingUrl: `/cloudtalk/recordings/${callId}`,
          });
        }
      }

      return matchedRecordings;
    } catch (err) {
      console.error("getRecentRecordingsForPhone error:", err);
      return [];
    }
  }

  /**
   * Check if configured agent is online in CloudTalk
   */
  public async getAgentStatus(agentId?: string): Promise<{
    agentId: string;
    agentName: string;
    status: string;
    isOnline: boolean;
  }> {
    const targetAgentId = agentId || this.defaultAgentId;
    try {
      const response = await fetch(`${this.baseUrl}/agents/index.json`, {
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        return { agentId: targetAgentId, agentName: "Shakeel Ahmed", status: "online", isOnline: true };
      }
      const json = (await response.json()) as any;
      const list: any[] = json?.responseData?.data || [];
      const matched = list.find((item: any) => {
        const ag = item.Agent || item;
        return String(ag.id) === String(targetAgentId) || ag.extension === "1001";
      });
      const ag = matched?.Agent || matched;
      const status = ag?.availability_status || "offline";
      const isOnline = status === "online" || status === "idle" || status === "talking";
      const agentName = ag ? `${ag.firstname || ""} ${ag.lastname || ""}`.trim() : "Shakeel Ahmed";
      return {
        agentId: ag?.id || targetAgentId,
        agentName: agentName || "Shakeel Ahmed",
        status,
        isOnline,
      };
    } catch {
      return { agentId: targetAgentId, agentName: "Shakeel Ahmed", status: "online", isOnline: true };
    }
  }

  /**
   * Get or create a tag for campaign membership
   */
  public async getOrCreateTag(name: string): Promise<number> {
    try {
      const res = await fetch(`${this.baseUrl}/tags/index.json`, {
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
        },
      });
      const data = (await res.json()) as any;
      const list: any[] = data?.responseData?.data || [];
      const found = list.find((t: any) => t.Tag?.name === name);
      if (found?.Tag?.id) {
        return Number(found.Tag.id);
      }

      const addRes = await fetch(`${this.baseUrl}/tags/add.json`, {
        method: "PUT",
        headers: {
          Authorization: this.getAuthHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const addData = (await addRes.json()) as any;
      return Number(addData?.responseData?.data?.id);
    } catch (err) {
      console.error("getOrCreateTag error:", err);
      return 0;
    }
  }

  /**
   * Sync campaign leads to CloudTalk with campaign tag
   */
  public async syncLeadsToCloudTalk(
    tagName: string,
    leads: Array<{ name: string; phone: string }>
  ): Promise<void> {
    for (const lead of leads) {
      if (!lead.phone) continue;
      const rawDigits = lead.phone.replace(/\D/g, "");
      let normalized = lead.phone.trim();
      if (!normalized.startsWith("+")) {
        normalized = rawDigits.length === 10 ? `+91${rawDigits}` : `+${rawDigits}`;
      }

      try {
        await fetch(`${this.baseUrl}/contacts/add.json`, {
          method: "PUT",
          headers: {
            Authorization: this.getAuthHeader(),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name: lead.name || "Campaign Lead",
            ContactNumber: [{ public_number: normalized }],
            ContactsTag: [{ name: tagName }],
          }),
        });
      } catch (e) {
        console.error("syncLeadsToCloudTalk item error:", e);
      }
    }
  }

  /**
   * Create or ensure an active Parallel Dialer campaign on CloudTalk
   */
  public async ensureParallelCampaign(
    campaignName: string,
    tagId: number,
    queueGroupId = 304558,
    agentId = 588998
  ): Promise<{ campaignId: string }> {
    try {
      // 1. Check existing campaigns on dialer v1 API
      const listRes = await fetch("https://api.cloudtalk.io/v1/dialer/campaigns", {
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
        },
      });
      const listJson = (await listRes.json()) as any;
      const campaigns: any[] = listJson?.data || [];
      let matched = campaigns.find(
        (c: any) => c.name === campaignName && c.mode === "parallel" && c.status !== "deleted"
      );

      let campaignId: string = matched?.id;

      if (!campaignId) {
        // Create new parallel campaign
        const createRes = await fetch("https://api.cloudtalk.io/v1/dialer/campaigns", {
          method: "POST",
          headers: {
            Authorization: this.getAuthHeader(),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name: campaignName,
            mode: "parallel",
            calling_policy: {
              recording: true,
              answer_wait: 18,
              parallel_calls: 1,
              outbound_number_id: 113403,
            },
          }),
        });
        const createJson = (await createRes.json()) as any;
        campaignId = String(createJson?.id || "");
      }

      if (campaignId) {
        // Update associations: Tag + Group + Agent
        await fetch(`https://api.cloudtalk.io/v1/dialer/campaigns/${campaignId}/associations`, {
          method: "PUT",
          headers: {
            Authorization: this.getAuthHeader(),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            target_tag: [{ ref_id: Number(tagId) }],
            queue_group: [queueGroupId],
            agent: [agentId],
          }),
        });
      }

      return { campaignId };
    } catch (err: any) {
      console.error("ensureParallelCampaign error:", err);
      return { campaignId: "" };
    }
  }

  /**
   * Set status of Parallel Dialer campaign (active or inactive)
   */
  public async setParallelCampaignStatus(
    campaignId: string,
    status: "active" | "inactive"
  ): Promise<boolean> {
    try {
      const res = await fetch(`https://api.cloudtalk.io/v1/dialer/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: {
          Authorization: this.getAuthHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ status }),
      });
      return res.ok;
    } catch (err) {
      console.error("setParallelCampaignStatus error:", err);
      return false;
    }
  }

  /**
   * Check if CloudTalk currently has an answered live call connected to an agent
   */
  public async getActiveCallForAgent(targetAgentId = "588998"): Promise<{
    phone?: string;
    callId?: string;
    duration?: number;
    isTalking: boolean;
  } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/calls/index.json?limit=3`, {
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: "application/json",
        },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as any;
      const list: any[] = json?.responseData?.data || [];

      for (const item of list) {
        const cdr = item.Cdr || item;
        if (!cdr) continue;
        const agentId = String(cdr.user_id || item.Agent?.id || "");
        if (agentId !== String(targetAgentId)) continue;

        const isEnded = Boolean(cdr.ended_at) || cdr.status === "ended" || cdr.status === "completed" || cdr.status === "missed";
        const external = String(cdr.public_external || cdr.callee || cdr.caller || "").trim();

        // Only return true live ongoing calls that have NOT ended
        if (external && !isEnded) {
          return {
            phone: external,
            callId: String(cdr.id || ""),
            duration: Number(cdr.talking_time || 0),
            isTalking: true,
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const cloudTalkService = new CloudTalkService();
export default cloudTalkService;
