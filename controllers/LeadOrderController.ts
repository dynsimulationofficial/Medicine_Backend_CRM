import { Request, Response } from "express";
import * as yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import db from "../models";

// ==================== UNIFIED ORDER VALIDATION SCHEMA ====================
const leadOrderSchema = yup.object({
  id: yup.string().uuid("Invalid order ID").nullable().optional(),
  order_id: yup.string().uuid("Invalid order ID").nullable().optional(),
  lead_id: yup.string().uuid("Invalid lead ID").nullable().optional(),
  payment_status: yup.string().default("Pending"),
  payment_mode: yup.string().default("COD"),
  order_status: yup.string().default("Pending"),
  order_notes: yup.string().nullable().optional(),
  courier_name: yup.string().nullable().optional(),
  tracking_number: yup.string().nullable().optional(),
  items: yup
    .array()
    .of(
      yup.object({
        id: yup.string().uuid("Invalid item ID").optional(),
        medicine_name: yup.string().trim().required("Medicine name is required"),
        unit: yup.string().trim().default("Strip"),
        quantity: yup.number().integer().min(1, "Quantity must be at least 1").required("Quantity is required"),
        rate: yup.number().min(0, "Rate cannot be negative").required("Rate is required"),
      })
    )
    .optional(),
});

// ==================== 1. CREATE ORDER ====================
export const createOrder = async (req: Request, res: Response) => {
  const transaction = await db.sequelize.transaction();
  try {
    const body = await leadOrderSchema.validate(req.body, { abortEarly: false });
    const { lead_id, payment_status, payment_mode, order_status, order_notes, courier_name, tracking_number, items } = body;

    if (!lead_id) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    if (!items || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "At least one medicine item is required" });
    }

    // Verify lead exists
    const [leadRow]: any[] = await db.sequelize.query(
      `SELECT id, full_name, lead_number FROM public.leads WHERE id = :lead_id AND deleted_at IS NULL LIMIT 1`,
      { replacements: { lead_id }, type: QueryTypes.SELECT, transaction }
    );
    if (!leadRow) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

    // Calculate totals
    let grandTotal = 0;
    const computedItems: any[] = [];
    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      const rate = Number(item.rate) || 0;
      const totalPrice = Number((qty * rate).toFixed(2));
      grandTotal += totalPrice;
      computedItems.push({
        medicine_name: item.medicine_name.trim(),
        unit: item.unit || "Strip",
        quantity: qty,
        rate,
        total_price: totalPrice,
      });
    }
    grandTotal = Number(grandTotal.toFixed(2));

    const orderId = uuidv4();
    const [newOrderRow]: any[] = await db.sequelize.query(
      `INSERT INTO public.lead_orders
          (id, lead_id, agent_id, total_items, grand_total, order_status, payment_status, payment_mode, order_notes, courier_name, tracking_number, created_at, updated_at)
        VALUES
          (:id, :lead_id, :agent_id, :total_items, :grand_total, :order_status, :payment_status, :payment_mode, :order_notes, :courier_name, :tracking_number, NOW(), NOW())
        RETURNING id, order_number, created_at, updated_at`,
      {
        replacements: {
          id: orderId,
          lead_id,
          agent_id: authUserId,
          total_items: computedItems.length,
          grand_total: grandTotal,
          order_status,
          payment_status,
          payment_mode,
          order_notes: order_notes || null,
          courier_name: courier_name || null,
          tracking_number: tracking_number || null,
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    );
    const orderNumber = newOrderRow.order_number;

    // Insert order items
    const insertedItems: any[] = [];
    for (const item of computedItems) {
      const itemId = uuidv4();
      const [itemRow]: any[] = await db.sequelize.query(
        `INSERT INTO public.lead_order_items
            (id, order_id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at)
          VALUES
            (:id, :order_id, :lead_id, :medicine_name, :unit, :quantity, :rate, :total_price, NOW(), NOW())
          RETURNING id, order_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at`,
        {
          replacements: {
            id: itemId,
            order_id: orderId,
            lead_id,
            medicine_name: item.medicine_name,
            unit: item.unit,
            quantity: item.quantity,
            rate: item.rate,
            total_price: item.total_price,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );
      if (itemRow) insertedItems.push(itemRow);
    }

    // Auto convert lead on confirmed/paid status
    const isConverted = ["Confirmed", "Shipped", "Delivered"].includes(order_status) || payment_status === "Paid";
    if (isConverted) {
      await db.sequelize.query(
        `UPDATE public.leads
         SET lead_status = 'Converted',
             updated_at = NOW()
         WHERE id = :lead_id AND deleted_at IS NULL`,
        { replacements: { lead_id }, type: QueryTypes.UPDATE, transaction }
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      msg: `Order ${orderNumber} created successfully`,
      data: {
        id: orderId,
        order_number: orderNumber,
        lead_id,
        total_items: insertedItems.length,
        grand_total: grandTotal,
        order_status,
        payment_status,
        payment_mode,
        courier_name,
        tracking_number,
        items: insertedItems,
      },
    });
  } catch (error: any) {
    await transaction.rollback();
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 2. GET ALL ORDERS ====================
export const getAllOrders = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id || req.query?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const rows: any[] = await db.sequelize.query(
      `SELECT
          o.id,
          o.order_number,
          o.lead_id,
          o.agent_id,
          u.name AS agent_name,
          o.total_items,
          o.grand_total,
          o.order_status,
          o.payment_status,
          o.payment_mode,
          o.order_notes,
          o.courier_name,
          o.tracking_number,
          o.created_at,
          o.updated_at,
          COALESCE(
              JSON_AGG(
                  JSON_BUILD_OBJECT(
                      'id', oi.id,
                      'order_id', oi.order_id,
                      'medicine_name', oi.medicine_name,
                      'unit', oi.unit,
                      'quantity', oi.quantity,
                      'rate', oi.rate,
                      'total_price', oi.total_price
                  ) ORDER BY oi.created_at ASC
              ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json
          ) AS items
       FROM public.lead_orders o
       LEFT JOIN public.system_users u ON o.agent_id = u.id
       LEFT JOIN public.lead_order_items oi ON o.id = oi.order_id AND oi.deleted_at IS NULL
       WHERE o.lead_id = :lead_id AND o.deleted_at IS NULL
       GROUP BY o.id, u.name
       ORDER BY o.created_at DESC`,
      { replacements: { lead_id }, type: QueryTypes.SELECT }
    );

    const allOrdersTotal = rows.reduce((acc, r) => acc + (Number(r.grand_total) || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        orders: rows,
        total_orders: rows.length,
        all_orders_grand_total: Number(allOrdersTotal.toFixed(2)),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 3. DELETE ORDER ====================
export const deleteOrder = async (req: Request, res: Response) => {
  const transaction = await db.sequelize.transaction();
  try {
    const targetId = req.body?.id || req.body?.order_id || req.query?.id || req.query?.order_id;
    if (!targetId) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Order ID is required" });
    }

    const [orderRow]: any[] = await db.sequelize.query(
      `UPDATE public.lead_orders
           SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = :targetId AND deleted_at IS NULL
         RETURNING id, order_number, lead_id`,
      { replacements: { targetId }, type: QueryTypes.SELECT, transaction }
    );

    if (!orderRow) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    await db.sequelize.query(
      `UPDATE public.lead_order_items
           SET deleted_at = NOW(), updated_at = NOW()
         WHERE order_id = :targetId AND deleted_at IS NULL`,
      { replacements: { targetId }, type: QueryTypes.UPDATE, transaction }
    );

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: `Order ${orderRow.order_number} deleted successfully`,
      data: { deleted_order: orderRow },
    });
  } catch (error: any) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 4. UPDATE ORDER ====================
export const updateOrder = async (req: Request, res: Response) => {
  const transaction = await db.sequelize.transaction();
  try {
    const targetId = req.body?.id || req.body?.order_id || req.query?.id || req.query?.order_id;
    if (!targetId) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Order ID is required" });
    }

    const body = await leadOrderSchema.validate(req.body, { abortEarly: false });
    const { lead_id, order_status, payment_status, payment_mode, order_notes, courier_name, tracking_number, items } = body;

    // Verify order exists
    const [existingOrder]: any[] = await db.sequelize.query(
      `SELECT id, lead_id, order_number, order_status, payment_status, payment_mode, order_notes, courier_name, tracking_number, total_items, grand_total, agent_id
         FROM public.lead_orders
        WHERE id = :targetId AND deleted_at IS NULL LIMIT 1`,
      { replacements: { targetId }, type: QueryTypes.SELECT, transaction }
    );
    if (!existingOrder) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const resolvedLeadId = lead_id || existingOrder.lead_id;
    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

    let totalItemsCount = undefined;
    let grandTotal = undefined;
    let updatedItems: any[] = [];

    // If items are provided in edit, recalculate and replace items
    if (Array.isArray(items) && items.length > 0) {
      let sumTotal = 0;
      const computedItems: any[] = [];
      for (const item of items) {
        const qty = Number(item.quantity) || 1;
        const rate = Number(item.rate) || 0;
        const totalPrice = Number((qty * rate).toFixed(2));
        sumTotal += totalPrice;
        computedItems.push({
          medicine_name: item.medicine_name.trim(),
          unit: item.unit || "Strip",
          quantity: qty,
          rate,
          total_price: totalPrice,
        });
      }
      grandTotal = Number(sumTotal.toFixed(2));
      totalItemsCount = computedItems.length;

      // Delete old items and insert updated ones
      await db.sequelize.query(
        `DELETE FROM public.lead_order_items WHERE order_id = :order_id`,
        { replacements: { order_id: targetId }, type: QueryTypes.DELETE, transaction }
      );

      for (const item of computedItems) {
        const itemId = uuidv4();
        const [itemRow]: any[] = await db.sequelize.query(
          `INSERT INTO public.lead_order_items
              (id, order_id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at)
            VALUES
              (:id, :order_id, :lead_id, :medicine_name, :unit, :quantity, :rate, :total_price, NOW(), NOW())
            RETURNING id, order_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at`,
          {
            replacements: {
              id: itemId,
              order_id: targetId,
              lead_id: resolvedLeadId,
              medicine_name: item.medicine_name,
              unit: item.unit,
              quantity: item.quantity,
              rate: item.rate,
              total_price: item.total_price,
            },
            type: QueryTypes.SELECT,
            transaction,
          }
        );
        if (itemRow) updatedItems.push(itemRow);
      }
    }

    // Resolve final values in JS (No COALESCE needed)
    const finalOrderStatus = order_status || existingOrder.order_status;
    const finalPaymentStatus = payment_status || existingOrder.payment_status;
    const finalPaymentMode = payment_mode || existingOrder.payment_mode;
    const finalOrderNotes = order_notes !== undefined ? order_notes : existingOrder.order_notes;
    const finalCourierName = courier_name !== undefined ? courier_name : existingOrder.courier_name;
    const finalTrackingNumber = tracking_number !== undefined ? tracking_number : existingOrder.tracking_number;
    const finalTotalItems = totalItemsCount !== undefined ? totalItemsCount : existingOrder.total_items;
    const finalGrandTotal = grandTotal !== undefined ? grandTotal : existingOrder.grand_total;
    const finalAgentId = authUserId || existingOrder.agent_id;

    // Update main order row with clean SQL
    const [updatedOrder]: any[] = await db.sequelize.query(
      `UPDATE public.lead_orders
           SET order_status = :order_status,
               payment_status = :payment_status,
               payment_mode = :payment_mode,
               order_notes = :order_notes,
               courier_name = :courier_name,
               tracking_number = :tracking_number,
               total_items = :total_items,
               grand_total = :grand_total,
               agent_id = :agent_id,
               updated_at = NOW()
         WHERE id = :targetId AND deleted_at IS NULL
         RETURNING id, lead_id, order_number, order_status, payment_status, payment_mode, total_items, grand_total`,
      {
        replacements: {
          targetId,
          order_status: finalOrderStatus,
          payment_status: finalPaymentStatus,
          payment_mode: finalPaymentMode,
          order_notes: finalOrderNotes,
          courier_name: finalCourierName,
          tracking_number: finalTrackingNumber,
          total_items: finalTotalItems,
          grand_total: finalGrandTotal,
          agent_id: finalAgentId,
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    // Auto convert lead on confirmed/paid status
    const isConverted = ["Confirmed", "Shipped", "Delivered"].includes(updatedOrder.order_status) || updatedOrder.payment_status === "Paid";
    if (isConverted && resolvedLeadId) {
      await db.sequelize.query(
        `UPDATE public.leads
         SET lead_status = 'Converted',
             updated_at = NOW()
         WHERE id = :resolvedLeadId AND deleted_at IS NULL`,
        { replacements: { resolvedLeadId }, type: QueryTypes.UPDATE, transaction }
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      msg: `Order ${existingOrder.order_number} updated successfully`,
      data: {
        ...updatedOrder,
        items: updatedItems.length > 0 ? updatedItems : undefined,
      },
    });
  } catch (error: any) {
    await transaction.rollback();
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. RAW MEDICINES (SAVE, LIST, DELETE) ====================
export const saveLeadMedicines = async (req: Request, res: Response) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { lead_id, items } = req.body;
    if (!lead_id) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Items array is required" });
    }

    await db.sequelize.query(
      `UPDATE public.lead_medicines SET deleted_at = NOW() WHERE lead_id = :lead_id AND deleted_at IS NULL`,
      { replacements: { lead_id }, type: QueryTypes.UPDATE, transaction }
    );

    const insertedRows: any[] = [];
    let grandTotal = 0;

    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      const rate = Number(item.rate) || 0;
      const totalPrice = Number((qty * rate).toFixed(2));
      grandTotal += totalPrice;

      const [row]: any[] = await db.sequelize.query(
        `INSERT INTO public.lead_medicines
            (id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at)
          VALUES
            (:id, :lead_id, :medicine_name, :unit, :quantity, :rate, :total_price, NOW(), NOW())
          RETURNING id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at`,
        {
          replacements: {
            id: uuidv4(),
            lead_id,
            medicine_name: item.medicine_name,
            unit: item.unit || "Strip",
            quantity: qty,
            rate,
            total_price: totalPrice,
          },
          type: QueryTypes.SELECT,
          transaction,
        }
      );
      if (row) insertedRows.push(row);
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Lead medicines saved successfully",
      data: {
        lead_id,
        items: insertedRows,
        total_items: insertedRows.length,
        grand_total: Number(grandTotal.toFixed(2)),
      },
    });
  } catch (error: any) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listLeadMedicines = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id || req.query?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const rows: any[] = await db.sequelize.query(
      `SELECT id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at
         FROM public.lead_medicines
        WHERE lead_id = :lead_id AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      { replacements: { lead_id }, type: QueryTypes.SELECT }
    );

    const grandTotal = rows.reduce((acc, r) => acc + (Number(r.total_price) || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        items: rows,
        total_items: rows.length,
        grand_total: Number(grandTotal.toFixed(2)),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteLeadMedicine = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Medicine ID is required" });
    }

    const rows: any[] = await db.sequelize.query(
      `UPDATE public.lead_medicines
           SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = :id AND deleted_at IS NULL
         RETURNING id, lead_id, medicine_name`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Medicine item not found" });
    }

    return res.status(200).json({ success: true, message: "Medicine item deleted successfully", data: rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 6. MEDICINE AUTOCOMPLETE SUGGESTIONS ====================
export const getMedicineSuggestions = async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string || "").trim();
    const repl: Record<string, any> = {};
    let whereClause = "WHERE deleted_at IS NULL AND name IS NOT NULL AND TRIM(name) != ''";
    if (query) {
      whereClause += " AND name ILIKE :q";
      repl.q = `%${query}%`;
    }

    const dbMeds: any[] = await db.sequelize.query(
      `SELECT name AS medicine_name, 'Strip'::varchar AS unit, 0::numeric AS rate
         FROM public.master_medicines
        ${whereClause}
        ORDER BY LOWER(TRIM(name)) ASC
        LIMIT 100`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, data: { suggestions: dbMeds } });
  } catch (error: any) {
    console.error("getMedicineSuggestions error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  createOrder,
  getAllOrders,
  updateOrder,
  deleteOrder,
  saveLeadMedicines,
  listLeadMedicines,
  deleteLeadMedicine,
  getMedicineSuggestions,
};
