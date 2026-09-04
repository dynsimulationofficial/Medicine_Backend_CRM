import { Request, Response } from "express";
import * as yup from "yup";
import { QueryTypes } from "sequelize";
import db from "../models";
import trackingService from "../service/TrackingService";

// ==================== VALIDATION SCHEMAS ====================
const syncTrackingSchema = yup.object({
  order_id: yup.string().uuid("Invalid order ID").optional().nullable(),
  id: yup.string().uuid("Invalid order ID").optional().nullable(),
  tracking_number: yup.string().optional().nullable(),
});

// ==================== 1. SYNC TRACKING ON-DEMAND ====================
export const syncTracking = async (req: Request, res: Response) => {
  try {
    const body = await syncTrackingSchema.validate(req.body, { abortEarly: false });
    const orderId = body.order_id || body.id;

    if (orderId) {
      const trackingResult = await trackingService.syncOrderTracking(orderId);
      if (!trackingResult) {
        return res.status(404).json({
          success: false,
          message: "Order has no tracking number or not found",
        });
      }
      return res.status(200).json({
        success: true,
        message: "Tracking synced successfully",
        data: trackingResult,
      });
    }

    if (body.tracking_number) {
      const trackingResult = await trackingService.fetchTrackingInfo(body.tracking_number);
      return res.status(200).json({
        success: true,
        message: "Tracking info fetched successfully",
        data: trackingResult,
      });
    }

    return res.status(400).json({
      success: false,
      message: "order_id or tracking_number is required",
    });
  } catch (error: any) {
    console.error("syncTracking error:", error);
    if (error instanceof yup.ValidationError) {
      return res.status(400).json({
        success: false,
        message: error.errors.join(", "),
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// ==================== 2. GET TRACKING HISTORY & TIMELINE ====================
export const getTrackingHistory = async (req: Request, res: Response) => {
  try {
    const orderId = req.params?.order_id || req.body?.order_id || req.body?.id;
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "order_id is required",
      });
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
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (!order.tracking_number) {
      return res.status(200).json({
        success: true,
        message: "Order has no tracking number assigned yet",
        data: {
          order,
          tracking_number: null,
          courier_name: order.courier_name,
          status: order.order_status || "Pending",
          events: [],
        },
      });
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
      return res.status(200).json({
        success: true,
        message: "Tracking history fetched",
        data: {
          order,
          tracking_number: order.tracking_number,
          courier_name: order.courier_name || "India Post",
          status: liveResult?.status || "In Transit",
          latest_location: liveResult?.latest_location,
          latest_event: liveResult?.latest_event,
          events: liveResult?.events || [],
        },
      });
    }

    const latestLog = logs[0];

    return res.status(200).json({
      success: true,
      message: "Tracking history retrieved successfully",
      data: {
        order,
        tracking_number: order.tracking_number,
        courier_name: order.courier_name || "India Post",
        status: latestLog?.status || "In Transit",
        latest_location: latestLog?.location,
        latest_event: latestLog?.details,
        events: logs,
      },
    });
  } catch (error: any) {
    console.error("getTrackingHistory error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// ==================== 3. RUN CRON BATCH SYNC ====================
export const runCronBatchSync = async (req: Request, res: Response) => {
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

    return res.status(200).json({
      success: true,
      message: `Batch tracking sync completed. ${syncedCount} orders updated.`,
      data: {
        total_active_orders: activeOrders.length,
        synced_count: syncedCount,
      },
    });
  } catch (error: any) {
    console.error("runCronBatchSync error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  syncTracking,
  getTrackingHistory,
  runCronBatchSync,
};
