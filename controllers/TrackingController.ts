import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes } from "sequelize";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";
import trackingService from "../service/TrackingService";

export class TrackingController extends BaseController {
  private db_services: DBServices;

  constructor() {
    super();
    this.db_services = new DBServices();
  }

  /**
   * POST /api/v1/managelead/tracking/sync
   * Synchronizes tracking on-demand for a single order
   */
  public syncTracking = async (req: Request, res: Response): Promise<void> => {
    try {
      const schema = Yup.object({
        order_id: Yup.string().uuid().optional(),
        id: Yup.string().uuid().optional(),
        tracking_number: Yup.string().optional(),
      });

      const body = await schema.validate(req.body, { abortEarly: false });
      const orderId = body.order_id || body.id;

      if (orderId) {
        const trackingResult = await trackingService.syncOrderTracking(orderId);
        if (!trackingResult) {
          return this.sendError(res, {}, "Order has no tracking number or not found", 404);
        }
        return this.sendSuccess(res, trackingResult, "Tracking synced successfully");
      }

      if (body.tracking_number) {
        const trackingResult = await trackingService.fetchTrackingInfo(body.tracking_number);
        return this.sendSuccess(res, trackingResult, "Tracking info fetched successfully");
      }

      return this.sendError(res, {}, "order_id or tracking_number is required", 400);
    } catch (err: any) {
      console.error("syncTracking error:", err);
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      return this.sendError(res, {}, err?.message || "Internal server error", 500);
    }
  };

  /**
   * GET /api/v1/managelead/tracking/history/:order_id
   * (Also supports POST /api/v1/managelead/tracking/history)
   * Returns complete checkpoint history and order info for visual timeline
   */
  public getTrackingHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const orderId = req.params?.order_id || req.body?.order_id || req.body?.id;
      if (!orderId) {
        return this.sendError(res, {}, "order_id is required", 400);
      }

      const [order]: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            o.id,
            o.order_number,
            o.lead_id,
            l.full_name AS lead_name,
            l.phone AS lead_phone,
            l.country AS lead_country,
            o.order_status,
            o.courier_name,
            o.tracking_number,
            o.created_at,
            o.updated_at
         FROM public.lead_orders o
         JOIN public.leads l ON l.id = o.lead_id
         WHERE o.id = :orderId AND o.deleted_at IS NULL
         LIMIT 1`,
        { replacements: { orderId }, type: QueryTypes.SELECT }
      );

      if (!order) {
        return this.sendError(res, {}, "Order not found", 404);
      }

      if (!order.tracking_number) {
        return this.sendSuccess(
          res,
          {
            order,
            tracking_number: null,
            courier_name: order.courier_name,
            status: order.order_status || "Pending",
            events: [],
          },
          "Order has no tracking number assigned yet"
        );
      }

      // Fetch logged checkpoints from database
      const logs: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT id, status, sub_status, location, details, checkpoint_time, created_at
         FROM public.order_tracking_logs
         WHERE order_id = :orderId
         ORDER BY checkpoint_time DESC, created_at DESC`,
        { replacements: { orderId }, type: QueryTypes.SELECT }
      );

      // If no logs saved in database yet, auto-sync on the fly
      if (logs.length === 0) {
        const liveResult = await trackingService.syncOrderTracking(orderId);
        return this.sendSuccess(
          res,
          {
            order,
            tracking_number: order.tracking_number,
            courier_name: order.courier_name || "India Post",
            status: liveResult?.status || "In Transit",
            latest_location: liveResult?.latest_location,
            latest_event: liveResult?.latest_event,
            events: liveResult?.events || [],
          },
          "Tracking history fetched"
        );
      }

      const latestLog = logs[0];

      return this.sendSuccess(
        res,
        {
          order,
          tracking_number: order.tracking_number,
          courier_name: order.courier_name || "India Post",
          status: latestLog?.status || "In Transit",
          latest_location: latestLog?.location,
          latest_event: latestLog?.details,
          events: logs,
        },
        "Tracking history retrieved successfully"
      );
    } catch (err: any) {
      console.error("getTrackingHistory error:", err);
      return this.sendError(res, {}, err?.message || "Internal server error", 500);
    }
  };

  /**
   * POST /api/v1/managelead/tracking/cron-sync
   * Runs batch synchronization for all active in-transit orders
   */
  public runCronBatchSync = async (req: Request, res: Response): Promise<void> => {
    try {
      const activeOrders: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT id, order_number, tracking_number, courier_name
         FROM public.lead_orders
         WHERE deleted_at IS NULL
           AND tracking_number IS NOT NULL
           AND TRIM(tracking_number) != ''
           AND order_status NOT IN ('Delivered', 'Cancelled')
         LIMIT 50`,
        { type: QueryTypes.SELECT }
      );

      let syncedCount = 0;
      for (const ord of activeOrders) {
        try {
          await trackingService.syncOrderTracking(ord.id);
          syncedCount++;
        } catch (e) {
          console.warn(`Failed to sync order ${ord.order_number}:`, e);
        }
      }

      return this.sendSuccess(
        res,
        {
          total_active_orders: activeOrders.length,
          synced_count: syncedCount,
        },
        `Batch tracking sync completed. ${syncedCount} orders updated.`
      );
    } catch (err: any) {
      console.error("runCronBatchSync error:", err);
      return this.sendError(res, {}, err?.message || "Internal server error", 500);
    }
  };
}

export default new TrackingController();
