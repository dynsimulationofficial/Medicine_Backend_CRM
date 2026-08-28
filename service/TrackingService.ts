import axios from "axios";
import DBServices from "../database/DBService";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";

export interface NormalizedTrackingEvent {
  status: string; // "Booked" | "In Transit" | "Customs Cleared" | "Out for Delivery" | "Delivered" | "Exception"
  sub_status?: string;
  location?: string;
  details: string;
  checkpoint_time: Date;
}

export interface TrackingResult {
  tracking_number: string;
  courier_name: string;
  status: string; // "Pending" | "Booked" | "In Transit" | "Customs Cleared" | "Out for Delivery" | "Delivered" | "Exception"
  delivery_status: string;
  latest_location?: string;
  latest_event?: string;
  last_updated: Date;
  events: NormalizedTrackingEvent[];
}

export class TrackingService {
  private apiKey: string;
  private baseUrl: string = "https://api.17track.net/track/v2.4";
  private dbServices: DBServices;

  constructor() {
    this.apiKey = process.env.TRACKING_17TRACK_KEY || "EED2D48C733C5F21FDE53CFE26A452CB";
    this.dbServices = new DBServices();
  }

  /**
   * Helper to detect carrier code for 17TRACK if helpful
   * 100084 = India Post, 100184 = Emirates Post, 100001 = DHL, 100003 = FedEx
   */
  private detectCarrierCode(courierName?: string | null, trackingNumber?: string): number | undefined {
    if (!courierName && trackingNumber) {
      if (trackingNumber.endsWith("IN")) return 100084;
      if (trackingNumber.endsWith("AE")) return 100184;
    }
    if (courierName) {
      const lower = courierName.toLowerCase();
      if (lower.includes("india post") || lower.includes("speed post")) return 100084;
      if (lower.includes("uae") || lower.includes("emirates")) return 100184;
      if (lower.includes("dhl")) return 100001;
      if (lower.includes("fedex")) return 100003;
      if (lower.includes("aramex")) return 100014;
    }
    return undefined;
  }

  /**
   * Register tracking number with 17TRACK API
   */
  public async registerTrackingNumber(trackingNumber: string, courierName?: string | null): Promise<boolean> {
    try {
      if (!this.apiKey || trackingNumber.startsWith("17TEST") || trackingNumber.startsWith("MOCK")) {
        return true;
      }

      const carrierCode = this.detectCarrierCode(courierName, trackingNumber);
      const registerPayload: any = [{ number: trackingNumber.trim() }];
      if (carrierCode) registerPayload[0].carrier = carrierCode;

      const response = await axios.post(`${this.baseUrl}/register`, registerPayload, {
        headers: {
          "17token": this.apiKey,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      const resCode = response.data?.code;
      // code 0 = success, 4031 = already registered
      return resCode === 0 || resCode === 4031;
    } catch (err: any) {
      console.warn("17TRACK register error (non-fatal):", err?.response?.data || err?.message);
      return false;
    }
  }

  /**
   * Query tracking info from 17TRACK API (or mock generator for test numbers)
   */
  public async fetchTrackingInfo(
    trackingNumber: string,
    courierName: string = "India Post"
  ): Promise<TrackingResult> {
    const cleanNumber = trackingNumber.trim().toUpperCase();

    // Check if test or mock number
    if (cleanNumber.startsWith("17TEST") || cleanNumber.startsWith("MOCK") || !this.apiKey) {
      return this.generateMockTrackingData(cleanNumber, courierName);
    }

    try {
      // 1. Try registering first
      await this.registerTrackingNumber(cleanNumber, courierName);

      // 2. Query info
      const response = await axios.post(
        `${this.baseUrl}/gettrackinfo`,
        [{ number: cleanNumber }],
        {
          headers: {
            "17token": this.apiKey,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      const accepted = response.data?.data?.accepted || [];
      if (accepted.length > 0 && accepted[0]?.track_info) {
        return this.parse17TrackResponse(accepted[0], courierName);
      }

      // If API returns no info yet, return pending/in transit placeholder
      return this.generateInitialTrackingData(cleanNumber, courierName);
    } catch (err: any) {
      console.error("17TRACK fetch error:", err?.response?.data || err?.message);
      return this.generateInitialTrackingData(cleanNumber, courierName);
    }
  }

  /**
   * Parse 17TRACK official JSON response into standard CRM structure
   */
  private parse17TrackResponse(trackData: any, courierName: string): TrackingResult {
    const trackInfo = trackData.track_info || {};
    const trackingNumber = trackData.number || "";
    const rawStatus = trackInfo.latest_status?.status || "InTransit";

    let normalizedStatus = "In Transit";
    if (rawStatus === "Delivered") normalizedStatus = "Delivered";
    else if (rawStatus === "OutForDelivery") normalizedStatus = "Out for Delivery";
    else if (rawStatus === "AvailableForPickup") normalizedStatus = "Out for Delivery";
    else if (rawStatus === "InfoReceived") normalizedStatus = "Booked";
    else if (rawStatus === "DeliveryFailure" || rawStatus === "Exception") normalizedStatus = "Exception";

    const rawEvents: any[] = [];
    const providers = trackInfo.tracking?.providers || [];
    for (const provider of providers) {
      if (Array.isArray(provider.events)) {
        rawEvents.push(...provider.events);
      }
    }

    // Sort events newest first
    rawEvents.sort((a, b) => new Date(b.time_utc || 0).getTime() - new Date(a.time_utc || 0).getTime());

    const events: NormalizedTrackingEvent[] = rawEvents.map((ev) => {
      let stageStatus = "In Transit";
      const desc = ev.description || "";
      const lower = desc.toLowerCase();

      if (lower.includes("delivered") || lower.includes("item delivered")) stageStatus = "Delivered";
      else if (lower.includes("out for delivery") || lower.includes("with delivery courier")) stageStatus = "Out for Delivery";
      else if (lower.includes("customs") || lower.includes("custom clearance") || lower.includes("cleared")) stageStatus = "Customs Cleared";
      else if (lower.includes("booked") || lower.includes("item booked") || lower.includes("received at facility")) stageStatus = "Booked";

      return {
        status: stageStatus,
        sub_status: ev.stage || undefined,
        location: ev.location || [ev.city, ev.country].filter(Boolean).join(", ") || undefined,
        details: desc,
        checkpoint_time: ev.time_utc ? new Date(ev.time_utc) : new Date(),
      };
    });

    const latestEvent = events.length > 0 ? events[0] : null;

    return {
      tracking_number: trackingNumber,
      courier_name: courierName,
      status: normalizedStatus,
      delivery_status: normalizedStatus,
      latest_location: latestEvent?.location || "In Transit",
      latest_event: latestEvent?.details || "Package is in transit",
      last_updated: new Date(),
      events,
    };
  }

  /**
   * Sync and persist tracking checkpoints in database
   */
  public async syncOrderTracking(orderId: string): Promise<TrackingResult | null> {
    const [order]: any[] = await this.dbServices.sequelizeWriter.query(
      `SELECT id, order_number, tracking_number, courier_name, order_status
       FROM public.lead_orders
       WHERE id = :orderId AND deleted_at IS NULL LIMIT 1`,
      { replacements: { orderId }, type: QueryTypes.SELECT }
    );

    if (!order || !order.tracking_number) {
      return null;
    }

    const trackingResult = await this.fetchTrackingInfo(order.tracking_number, order.courier_name || "India Post");

    // Save/Update checkpoints in order_tracking_logs
    if (trackingResult.events && trackingResult.events.length > 0) {
      for (const ev of trackingResult.events) {
        const [existing]: any[] = await this.dbServices.sequelizeWriter.query(
          `SELECT id FROM public.order_tracking_logs
           WHERE order_id = :orderId
             AND details = :details
             AND checkpoint_time = :checkpointTime
           LIMIT 1`,
          {
            replacements: {
              orderId,
              details: ev.details,
              checkpointTime: ev.checkpoint_time,
            },
            type: QueryTypes.SELECT,
          }
        );

        if (!existing) {
          await this.dbServices.sequelizeWriter.query(
            `INSERT INTO public.order_tracking_logs
               (id, order_id, tracking_number, courier_name, status, sub_status, location, details, checkpoint_time, created_at, updated_at)
             VALUES
               (:id, :orderId, :trackingNumber, :courierName, :status, :subStatus, :location, :details, :checkpointTime, NOW(), NOW())`,
            {
              replacements: {
                id: uuidv4(),
                orderId,
                trackingNumber: order.tracking_number,
                courierName: order.courier_name || "India Post",
                status: ev.status,
                subStatus: ev.sub_status || null,
                location: ev.location || null,
                details: ev.details,
                checkpointTime: ev.checkpoint_time,
              },
              type: QueryTypes.INSERT,
            }
          );
        }
      }
    }

    // Auto-update order_status to 'Delivered' if tracking says Delivered
    if (trackingResult.status === "Delivered" && order.order_status !== "Delivered") {
      await this.dbServices.sequelizeWriter.query(
        `UPDATE public.lead_orders
         SET order_status = 'Delivered', updated_at = NOW()
         WHERE id = :orderId`,
        { replacements: { orderId }, type: QueryTypes.UPDATE }
      );
    }

    return trackingResult;
  }

  /**
   * Generate realistic mock tracking data for test tracking numbers (e.g. 17TEST..., EM...IN)
   */
  private generateMockTrackingData(trackingNumber: string, courierName: string): TrackingResult {
    const isDelivered = trackingNumber.includes("0002") || trackingNumber.endsWith("DEL");
    const isOutForDelivery = trackingNumber.includes("0003");
    const now = new Date();

    const events: NormalizedTrackingEvent[] = [
      {
        status: "Booked",
        location: "Mumbai GPO, Maharashtra, India",
        details: "Consignment booked at Mumbai Speed Post Hub",
        checkpoint_time: new Date(now.getTime() - 4 * 86400000),
      },
      {
        status: "In Transit",
        location: "Mumbai International Air Mail Sorting Center, India",
        details: "Item dispatched on international flight to UAE",
        checkpoint_time: new Date(now.getTime() - 3 * 86400000),
      },
      {
        status: "In Transit",
        location: "Dubai International Airport (DXB), UAE",
        details: "Arrived at Dubai Air Mail Center Hub",
        checkpoint_time: new Date(now.getTime() - 2 * 86400000),
      },
      {
        status: "Customs Cleared",
        location: "Dubai Customs Airport Terminal, UAE",
        details: "Customs clearance completed successfully, handed over to Emirates Post",
        checkpoint_time: new Date(now.getTime() - 1 * 86400000),
      },
    ];

    let currentStatus = "In Transit";

    if (isDelivered) {
      currentStatus = "Delivered";
      events.push(
        {
          status: "Out for Delivery",
          location: "Deira Delivery Facility, Dubai, UAE",
          details: "Out for delivery with Emirates Post courier agent",
          checkpoint_time: new Date(now.getTime() - 4 * 3600000),
        },
        {
          status: "Delivered",
          location: "Dubai, United Arab Emirates",
          details: "Item successfully delivered to consignee. Signed by customer.",
          checkpoint_time: new Date(now.getTime() - 1 * 3600000),
        }
      );
    } else if (isOutForDelivery) {
      currentStatus = "Out for Delivery";
      events.push({
        status: "Out for Delivery",
        location: "Deira Delivery Facility, Dubai, UAE",
        details: "Out for delivery with Emirates Post courier agent",
        checkpoint_time: new Date(now.getTime() - 2 * 3600000),
      });
    }

    // Sort newest first
    events.sort((a, b) => b.checkpoint_time.getTime() - a.checkpoint_time.getTime());

    return {
      tracking_number: trackingNumber,
      courier_name: courierName,
      status: currentStatus,
      delivery_status: currentStatus,
      latest_location: events[0]?.location,
      latest_event: events[0]?.details,
      last_updated: new Date(),
      events,
    };
  }

  private generateInitialTrackingData(trackingNumber: string, courierName: string): TrackingResult {
    const events: NormalizedTrackingEvent[] = [
      {
        status: "Booked",
        location: courierName.includes("UAE") ? "Dubai Hub, UAE" : "India Post Sorting Hub",
        details: `Package consignment registered with ${courierName}. In transit.`,
        checkpoint_time: new Date(),
      },
    ];

    return {
      tracking_number: trackingNumber,
      courier_name: courierName,
      status: "In Transit",
      delivery_status: "In Transit",
      latest_location: events[0].location,
      latest_event: events[0].details,
      last_updated: new Date(),
      events,
    };
  }
}

export default new TrackingService();
