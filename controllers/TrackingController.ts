import { Request, Response } from "express";
import * as yup from "yup";
import { QueryTypes } from "sequelize";
import db from "../models";
import trackingService from "../service/TrackingService";

// ==================== RESPONSE HELPERS ====================
const sendSuccess = (res: Response, data: any, message: string = "Success", code = 200) => {
  return res.status(code).json({ success: true, msg: message, message, data });
};

const sendError = (res: Response, data: any = {}, message: string = "Error", code = 400) => {
  return res.status(code).json({ success: false, msg: message, message, data });
};

// ==================== VALIDATION SCHEMAS ====================
const syncTrackingSchema = yup.object({
  order_id: yup.string().uuid("Invalid order ID").optional().nullable(),
  id: yup.string().uuid("Invalid order ID").optional().nullable(),
  tracking_number: yup.string().optional().nullable(),
});

// ==================== 1. SYNC TRACKING ON-DEMAND ====================
/**
 * POST /api/v1/managelead/tracking/sync
 * Synchronizes tracking on-demand for a single order or queries carrier directly by tracking number
 */
export const syncTracking = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = await syncTrackingSchema.validate(req.body, { abortEarly: false });
    const orderId = body.order_id || body.id;

    if (orderId) {
      const trackingResult = await trackingService.syncOrderTracking(orderId);
      if (!trackingResult) {
        sendError(res, {}, "Order has no tracking number or not found", 404);
        return;
      }
      sendSuccess(res, trackingResult, "Tracking synced successfully");
      return;
    }

    if (body.tracking_number) {
      const trackingResult = await trackingService.fetchTrackingInfo(body.tracking_number);
      sendSuccess(res, trackingResult, "Tracking info fetched successfully");
      return;
    }

    sendError(res, {}, "order_id or tracking_number is required", 400);
  } catch (err: any) {
    console.error("syncTracking error:", err);
    if (err instanceof yup.ValidationError) {
      sendError(res, {}, err.errors.join(", "), 400);
      return;
    }
    sendError(res, {}, err?.message || "Internal server error", 500);
  }
};

// ==================== 2. GET TRACKING HISTORY & TIMELINE ====================
/**
 * GET /api/v1/managelead/tracking/history/:order_id
 * POST /api/v1/managelead/tracking/history
 * Returns complete checkpoint history and order info for visual timeline drawer
 */
export const getTrackingHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const orderId = req.params?.order_id || req.body?.order_id || req.body?.id;
    if (!orderId) {
      sendError(res, {}, "order_id is required", 400);
      return;
    }

    const [order]: any[] = await db.sequelize.query(
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
      sendError(res, {}, "Order not found", 404);
      return;
    }

    if (!order.tracking_number) {
      sendSuccess(
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
      return;
    }

    // Fetch logged checkpoints from database
    const logs: any[] = await db.sequelize.query(
      `SELECT id, status, sub_status, location, details, checkpoint_time, created_at
       FROM public.order_tracking_logs
       WHERE order_id = :orderId
       ORDER BY checkpoint_time DESC, created_at DESC`,
      { replacements: { orderId }, type: QueryTypes.SELECT }
    );

    // If no logs saved in database yet, auto-sync on the fly
    if (logs.length === 0) {
      const liveResult = await trackingService.syncOrderTracking(orderId);
      sendSuccess(
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
      return;
    }

    const latestLog = logs[0];

    sendSuccess(
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
    sendError(res, {}, err?.message || "Internal server error", 500);
  }
};

// ==================== 3. RUN CRON BATCH SYNC ====================
/**
 * POST /api/v1/managelead/tracking/cron-sync
 * Runs batch synchronization for all active in-transit orders
 */
export const runCronBatchSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeOrders: any[] = await db.sequelize.query(
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

    sendSuccess(
      res,
      {
        total_active_orders: activeOrders.length,
        synced_count: syncedCount,
      },
      `Batch tracking sync completed. ${syncedCount} orders updated.`
    );
  } catch (err: any) {
    console.error("runCronBatchSync error:", err);
    sendError(res, {}, err?.message || "Internal server error", 500);
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  syncTracking,
  getTrackingHistory,
  runCronBatchSync,
};
