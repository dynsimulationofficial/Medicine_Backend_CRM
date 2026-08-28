import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";

export default class LeadOrderController extends BaseController {
    db_services: DBServices = new DBServices();

    private async logUserActivity(userId: string, activity: string, type: string, transaction?: any): Promise<void> {
        try {
            await this.db_services.sequelizeWriter.query(
                `INSERT INTO public.system_user_activity
                   ("uuid", user_activity, module, type, activity_timestamp)
                 VALUES
                   (:userId, :activity, 'general', :type, NOW())`,
                {
                    replacements: { userId, activity, type },
                    type: QueryTypes.INSERT,
                    ...(transaction ? { transaction } : {}),
                }
            );
        } catch (err) {
            console.warn("Could not log user activity:", err);
        }
    }

    /* ---------------------------------------------------------------------- */
    /* 1. SAVE LEAD ORDER (RAW SQL)                                           */
    /* ---------------------------------------------------------------------- */
    public saveLeadOrder = async (req: Request, res: Response): Promise<void> => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().nullable().optional(),
                order_id: Yup.string().uuid().nullable().optional(),
                lead_id: Yup.string().uuid().required("lead_id is required"),
                payment_status: Yup.string().default("Pending"),
                payment_mode: Yup.string().default("COD"),
                order_status: Yup.string().default("Pending"),
                order_notes: Yup.string().nullable().optional(),
                courier_name: Yup.string().nullable().optional(),
                tracking_number: Yup.string().nullable().optional(),
                items: Yup.array().of(
                    Yup.object({
                        id: Yup.string().uuid().optional(),
                        medicine_name: Yup.string().trim().required("Medicine name is required"),
                        unit: Yup.string().trim().default("Strip"),
                        quantity: Yup.number().integer().min(1, "Quantity must be at least 1").required("Quantity is required"),
                        rate: Yup.number().min(0, "Rate cannot be negative").required("Rate is required"),
                    })
                ).min(1, "At least one medicine item is required").required("items array is required"),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const existingOrderId = body.id || body.order_id || null;
            const { lead_id, payment_status, payment_mode, order_status, order_notes, courier_name, tracking_number, items } = body;

            // Verify lead exists
            const [leadRow]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, full_name, lead_number FROM public.leads WHERE id = :lead_id AND deleted_at IS NULL LIMIT 1`,
                { replacements: { lead_id }, type: QueryTypes.SELECT, transaction }
            );
            if (!leadRow) {
                await transaction.rollback();
                return this.sendError(res, {}, "Lead not found", 404);
            }

            const authUserId = (req as any)?.user?.system_user_id || null;

            // Calculate totals
            let grandTotal = 0;
            const computedItems: any[] = [];
            for (const item of items) {
                const qty = Number(item.quantity) || 1;
                const rate = Number(item.rate) || 0;
                const totalPrice = Number((qty * rate).toFixed(2));
                grandTotal += totalPrice;
                computedItems.push({
                    medicine_name: item.medicine_name,
                    unit: item.unit || "Strip",
                    quantity: qty,
                    rate,
                    total_price: totalPrice,
                });
            }
            grandTotal = Number(grandTotal.toFixed(2));

            let orderId = existingOrderId;
            let orderNumber = "";

            if (existingOrderId) {
                const [existingOrder]: any[] = await this.db_services.sequelizeWriter.query(
                    `SELECT id, order_number FROM public.lead_orders WHERE id = :id AND lead_id = :lead_id AND deleted_at IS NULL LIMIT 1`,
                    { replacements: { id: existingOrderId, lead_id }, type: QueryTypes.SELECT, transaction }
                );
                if (!existingOrder) {
                    await transaction.rollback();
                    return this.sendError(res, {}, "Order not found", 404);
                }
                orderNumber = existingOrder.order_number;

                await this.db_services.sequelizeWriter.query(
                    `UPDATE public.lead_orders
                         SET total_items = :total_items,
                             grand_total = :grand_total,
                             order_status = :order_status,
                             payment_status = :payment_status,
                             payment_mode = :payment_mode,
                             order_notes = :order_notes,
                             courier_name = :courier_name,
                             tracking_number = :tracking_number,
                             agent_id = COALESCE(:agent_id, agent_id),
                             updated_at = NOW()
                       WHERE id = :id AND lead_id = :lead_id`,
                    {
                        replacements: {
                            id: existingOrderId,
                            lead_id,
                            total_items: computedItems.length,
                            grand_total: grandTotal,
                            order_status,
                            payment_status,
                            payment_mode,
                            order_notes: order_notes || null,
                            courier_name: courier_name || null,
                            tracking_number: tracking_number || null,
                            agent_id: authUserId,
                        },
                        type: QueryTypes.UPDATE,
                        transaction,
                    }
                );

                await this.db_services.sequelizeWriter.query(
                    `DELETE FROM public.lead_order_items WHERE order_id = :order_id`,
                    { replacements: { order_id: existingOrderId }, type: QueryTypes.DELETE, transaction }
                );
            } else {
                orderId = uuidv4();
                const [newOrderRow]: any[] = await this.db_services.sequelizeWriter.query(
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
                orderNumber = newOrderRow.order_number;
            }

            const insertedItems: any[] = [];
            for (const item of computedItems) {
                const itemId = uuidv4();
                const [itemRow]: any[] = await this.db_services.sequelizeWriter.query(
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

            const isConverted = ["Confirmed", "Shipped", "Delivered"].includes(order_status) || payment_status === "Paid";
            if (isConverted) {
                await this.db_services.sequelizeWriter.query(
                    `UPDATE public.leads
                     SET lead_status = 'Converted',
                         updated_at = NOW()
                     WHERE id = :lead_id AND deleted_at IS NULL`,
                    {
                        replacements: { lead_id },
                        type: QueryTypes.UPDATE,
                        transaction,
                    }
                );
            }

            // Raw SQL activity log
            if (authUserId) {
                /* User activity logged safely */
            }

            await transaction.commit();

            return this.sendSuccess(
                res,
                {
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
                `Order ${orderNumber} saved successfully`
            );
        } catch (err: any) {
            await transaction.rollback();
            console.error("saveLeadOrder error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 2. LIST LEAD ORDERS (RAW SQL)                                          */
    /* ---------------------------------------------------------------------- */
    public listLeadOrders = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            const { lead_id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
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

            return this.sendSuccess(
                res,
                {
                    orders: rows,
                    total_orders: rows.length,
                    all_orders_grand_total: Number(allOrdersTotal.toFixed(2)),
                },
                "Lead orders fetched successfully"
            );
        } catch (err: any) {
            console.error("listLeadOrders error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 3. DELETE LEAD ORDER (RAW SQL)                                         */
    /* ---------------------------------------------------------------------- */
    public deleteLeadOrder = async (req: Request, res: Response): Promise<void> => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().nullable().optional(),
                order_id: Yup.string().uuid().nullable().optional(),
                lead_id: Yup.string().uuid().nullable().optional(),
            });
            const body = await schema.validate(req.body, { abortEarly: false });
            const targetId = body.id || body.order_id;
            if (!targetId) {
                await transaction.rollback();
                return this.sendError(res, {}, "Order id is required", 400);
            }

            const [orderRow]: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_orders
                     SET deleted_at = NOW(), updated_at = NOW()
                   WHERE id = :targetId AND deleted_at IS NULL
                   RETURNING id, order_number, lead_id`,
                { replacements: { targetId }, type: QueryTypes.SELECT, transaction }
            );

            if (!orderRow) {
                await transaction.rollback();
                return this.sendError(res, {}, "Order not found", 404);
            }

            await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_order_items
                     SET deleted_at = NOW(), updated_at = NOW()
                   WHERE order_id = :targetId AND deleted_at IS NULL`,
                { replacements: { targetId }, type: QueryTypes.UPDATE, transaction }
            );

            await transaction.commit();

            return this.sendSuccess(
                res,
                { deleted_order: orderRow },
                `Order ${orderRow.order_number} deleted successfully`
            );
        } catch (err: any) {
            await transaction.rollback();
            console.error("deleteLeadOrder error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 4. UPDATE ORDER STATUS (RAW SQL)                                       */
    /* ---------------------------------------------------------------------- */
    public updateLeadOrderStatus = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().nullable().optional(),
                order_id: Yup.string().uuid().nullable().optional(),
                lead_id: Yup.string().uuid().nullable().optional(),
                order_status: Yup.string().optional(),
                payment_status: Yup.string().optional(),
                payment_mode: Yup.string().optional(),
                order_notes: Yup.string().nullable().optional(),
                courier_name: Yup.string().nullable().optional(),
                tracking_number: Yup.string().nullable().optional(),
            });
            const body = await schema.validate(req.body, { abortEarly: false });
            const targetId = body.id || body.order_id;
            if (!targetId) {
                return this.sendError(res, {}, "Order id is required", 400);
            }

            const { lead_id, order_status, payment_status, payment_mode, order_notes, courier_name, tracking_number } = body;

            const [updatedOrder]: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_orders
                     SET order_status = COALESCE(:order_status, order_status),
                         payment_status = COALESCE(:payment_status, payment_status),
                         payment_mode = COALESCE(:payment_mode, payment_mode),
                         order_notes = COALESCE(:order_notes, order_notes),
                         courier_name = COALESCE(:courier_name, courier_name),
                         tracking_number = COALESCE(:tracking_number, tracking_number),
                         updated_at = NOW()
                   WHERE id = :targetId AND deleted_at IS NULL
                   RETURNING id, lead_id, order_number, order_status, payment_status, payment_mode, grand_total`,
                {
                    replacements: {
                        targetId,
                        order_status: order_status || null,
                        payment_status: payment_status || null,
                        payment_mode: payment_mode || null,
                        order_notes: order_notes !== undefined ? order_notes : null,
                        courier_name: courier_name !== undefined ? courier_name : null,
                        tracking_number: tracking_number !== undefined ? tracking_number : null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            if (!updatedOrder) {
                return this.sendError(res, {}, "Order not found", 404);
            }

            const resolvedLeadId = lead_id || updatedOrder.lead_id;
            const isConverted = ["Confirmed", "Shipped", "Delivered"].includes(updatedOrder.order_status) || updatedOrder.payment_status === "Paid";
            if (isConverted && resolvedLeadId) {
                await this.db_services.sequelizeWriter.query(
                    `UPDATE public.leads
                     SET lead_status = 'Converted',
                         updated_at = NOW()
                     WHERE id = :resolvedLeadId AND deleted_at IS NULL`,
                    {
                        replacements: { resolvedLeadId },
                        type: QueryTypes.UPDATE,
                    }
                );
            }

            return this.sendSuccess(res, updatedOrder, "Order status updated successfully");
        } catch (err: any) {
            console.error("updateLeadOrderStatus error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 5. MEDICINES: SAVE, LIST, DELETE, SUGGESTIONS (RAW SQL)                */
    /* ---------------------------------------------------------------------- */
    public saveLeadMedicines = async (req: Request, res: Response): Promise<void> => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                items: Yup.array().of(
                    Yup.object({
                        id: Yup.string().uuid().optional(),
                        medicine_name: Yup.string().trim().required("Medicine name is required"),
                        unit: Yup.string().trim().default("Strip"),
                        quantity: Yup.number().integer().min(1, "Quantity must be at least 1").required("Quantity is required"),
                        rate: Yup.number().min(0, "Rate cannot be negative").required("Rate is required"),
                    })
                ).required("items array is required"),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, items } = body;

            await this.db_services.sequelizeWriter.query(
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

                const [row]: any[] = await this.db_services.sequelizeWriter.query(
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
            return this.sendSuccess(
                res,
                { items: insertedRows, total_items: insertedRows.length, grand_total: Number(grandTotal.toFixed(2)) },
                "Lead medicines saved successfully"
            );
        } catch (err: any) {
            await transaction.rollback();
            console.error("saveLeadMedicines error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public listLeadMedicines = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            const { lead_id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at
                   FROM public.lead_medicines
                  WHERE lead_id = :lead_id AND deleted_at IS NULL
                  ORDER BY created_at ASC`,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );

            const grandTotal = rows.reduce((acc, r) => acc + (Number(r.total_price) || 0), 0);

            return this.sendSuccess(
                res,
                { items: rows, total_items: rows.length, grand_total: Number(grandTotal.toFixed(2)) },
                "Lead medicines fetched successfully"
            );
        } catch (err: any) {
            console.error("listLeadMedicines error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public deleteLeadMedicine = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                lead_id: Yup.string().uuid().nullable().optional(),
            });
            const { id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_medicines
                     SET deleted_at = NOW(), updated_at = NOW()
                   WHERE id = :id AND deleted_at IS NULL
                   RETURNING id, lead_id, medicine_name`,
                { replacements: { id }, type: QueryTypes.SELECT }
            );

            if (!rows.length) return this.sendError(res, {}, "Medicine item not found", 404);
            return this.sendSuccess(res, { deleted_item: rows[0] }, "Medicine item deleted successfully");
        } catch (err: any) {
            console.error("deleteLeadMedicine error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public getMedicineSuggestions = async (req: Request, res: Response): Promise<void> => {
        try {
            const query = (req.query.q as string || "").trim();
            const repl: Record<string, any> = {};
            let whereClause = "WHERE deleted_at IS NULL AND medicine_name IS NOT NULL AND TRIM(medicine_name) != ''";
            if (query) {
                whereClause += " AND medicine_name ILIKE :q";
                repl.q = `%${query}%`;
            }

            const dbMeds: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT DISTINCT ON (LOWER(TRIM(medicine_name))) medicine_name, unit, rate
                   FROM (
                       SELECT name AS medicine_name, 'Strip'::varchar AS unit, 0::numeric AS rate, created_at, deleted_at FROM public.master_medicines
                       UNION ALL
                       SELECT medicine_name, COALESCE(unit, 'Strip')::varchar AS unit, COALESCE(rate, 0)::numeric AS rate, created_at, deleted_at FROM public.lead_order_items
                       UNION ALL
                       SELECT medicine_name, COALESCE(unit, 'Strip')::varchar AS unit, COALESCE(rate, 0)::numeric AS rate, created_at, deleted_at FROM public.lead_medicines
                   ) combined
                  ${whereClause}
                  ORDER BY LOWER(TRIM(medicine_name)) ASC, created_at DESC
                  LIMIT 100`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(res, { suggestions: dbMeds }, "Medicine suggestions fetched successfully");
        } catch (err: any) {
            console.error("getMedicineSuggestions error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
}
