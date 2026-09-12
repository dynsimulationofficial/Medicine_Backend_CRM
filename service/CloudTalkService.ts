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
    const normalizedCallee = params.calleeNumber.startsWith("+")
      ? params.calleeNumber
      : `+${params.calleeNumber.replace(/\D/g, "")}`;

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
}

export const cloudTalkService = new CloudTalkService();
export default cloudTalkService;
