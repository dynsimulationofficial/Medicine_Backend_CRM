import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";

export default class LeadActivityHistoryController extends BaseController {
    db_services: DBServices = new DBServices();

    /* ---------------------------------------------------------------------- */
    /* 1. GET ALL DISPOSITIONS (RAW SQL)                                      */
    /* ---------------------------------------------------------------------- */
    public getAllDispositions = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),
                search: Yup.string().trim().max(200).optional(),
                is_active: Yup.mixed<boolean>()
                    .transform((v) => (v === "true" ? true : v === "false" ? false : v))
                    .optional(),
            });
            const qp = await schema.validate(req.query, { abortEarly: false });
            const page = Number(qp.page);
            const pageSize = Number(qp.pageSize);
            const offset = (page - 1) * pageSize;
            const search = (qp.search as string | undefined)?.trim();
            const isActiveFilter = qp.is_active as boolean | undefined;

            const where: string[] = [];
            const repl: Record<string, any> = {};

            if (typeof isActiveFilter === "boolean") {
                where.push("ld.is_active = :is_active");
                repl.is_active = isActiveFilter;
            }

            if (search) {
                where.push("(ld.name ILIKE :q OR ld.description ILIKE :q)");
                repl.q = `%${search}%`;
            }

            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total FROM public.lead_dispositions ld ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ld.id, ld.name, ld.description, ld.is_active, ld.created_at
                   FROM public.lead_dispositions ld
                  ${whereSql}
                  ORDER BY ld.name ASC
                  LIMIT :limit OFFSET :offset`,
                {
                    replacements: { ...repl, limit: pageSize, offset },
                    type: QueryTypes.SELECT,
                }
            );

            const totalPages = Math.ceil(Number(total) / pageSize) || 1;

            return this.sendSuccess(
                res,
                {
                    items: rows,
                    pagination: { page, pageSize, total: Number(total), totalPages },
                },
                "Dispositions fetched"
            );
        } catch (err: any) {
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 2. GET DISPOSITION BY ID (RAW SQL)                                     */
    /* ---------------------------------------------------------------------- */
    public getDispositionById = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                disposition_id: Yup.string().uuid().required("disposition_id is required"),
            });
            const { disposition_id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ld.id, ld.name, ld.description, ld.is_active, ld.created_at
                   FROM public.lead_dispositions ld
                  WHERE ld.id = :id
                  LIMIT 1`,
                {
                    replacements: { id: disposition_id },
                    type: QueryTypes.SELECT,
                }
            );

            if (!rows.length) return this.sendError(res, {}, "Disposition not found", 404);
            return this.sendSuccess(res, rows[0], "Disposition");
        } catch (err: any) {
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 3. ADD ACTIVITY (RAW SQL)                                              */
    /* ---------------------------------------------------------------------- */
    public addActivity = async (req: Request, res: Response): Promise<void> => {
        try {
            const authUser = (req as any)?.user;
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                disposition_id: Yup.string().uuid().required("disposition_id is required"),
                conversation: Yup.string().required("conversation is required"),
                agent_id: Yup.string().nullable().optional(),
                occurred_at: Yup.date().nullable().optional(),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, disposition_id, conversation } = body;
            const finalAgentId = body.agent_id || authUser?.system_user_id || null;

            // Validate disposition via raw SQL
            const disp: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id FROM public.lead_dispositions WHERE id = :id AND is_active = TRUE`,
                { replacements: { id: disposition_id }, type: QueryTypes.SELECT }
            );
            if (!disp.length) return this.sendError(res, {}, "Invalid disposition_id", 400);

            // Raw SQL INSERT for activity
            const [row]: any[] = await this.db_services.sequelizeWriter.query(
                `INSERT INTO public.lead_activity_history
                   (id, lead_id, agent_id, disposition_id, conversation, occurred_at, created_at, updated_at)
                 VALUES
                   (:id, :lead_id, :agent_id, :disposition_id, :conversation, COALESCE(:occurred_at, NOW()), NOW(), NOW())
                 RETURNING id, lead_id, agent_id, disposition_id, conversation, occurred_at, created_at, updated_at`,
                {
                    replacements: {
                        id: uuidv4(),
                        lead_id,
                        agent_id: finalAgentId,
                        disposition_id,
                        conversation,
                        occurred_at: body.occurred_at || null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            // Raw SQL log for system_user_activities
            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                await this.db_services.sequelizeWriter.query(
                    `INSERT INTO public.system_user_activities
                       (id, system_user_id, user_activity, module, type, created_at, updated_at)
                     VALUES
                       (:id, :system_user_id, :user_activity, :module, :type, NOW(), NOW())`,
                    {
                        replacements: {
                            id: uuidv4(),
                            system_user_id: authUserId,
                            user_activity: `Added activity for lead ${lead_id}`,
                            module: "activity_management",
                            type: "create",
                        },
                        type: QueryTypes.INSERT,
                    }
                );
            }

            return this.sendSuccess(res, row, "Activity added successfully");
        } catch (err: any) {
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            console.error("Error in addActivity:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 4. UPDATE ACTIVITY (RAW SQL)                                           */
    /* ---------------------------------------------------------------------- */
    public updateActivity = async (req: Request, res: Response): Promise<void> => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("activity id is required"),
                disposition_id: Yup.string().uuid().optional(),
                conversation: Yup.string().optional(),
                agent_id: Yup.string().uuid().optional(),
                occurred_at: Yup.date().optional(),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { id, disposition_id, conversation, agent_id, occurred_at } = body;

            // Check existence via raw SQL
            const exists: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, lead_id FROM public.lead_activity_history WHERE id = :id AND deleted_at IS NULL`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction }
            );
            if (!exists.length) {
                await transaction.rollback();
                return this.sendError(res, {}, "Activity not found", 404);
            }

            if (disposition_id) {
                const disp: any[] = await this.db_services.sequelizeWriter.query(
                    `SELECT id FROM public.lead_dispositions WHERE id = :id AND is_active = TRUE`,
                    { replacements: { id: disposition_id }, type: QueryTypes.SELECT, transaction }
                );
                if (!disp.length) {
                    await transaction.rollback();
                    return this.sendError(res, {}, "Invalid disposition_id", 400);
                }
            }

            const updates: string[] = [];
            const repl: Record<string, any> = { id };

            if (disposition_id) { updates.push("disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
            if (conversation !== undefined) { updates.push("conversation = :conversation"); repl.conversation = conversation; }
            if (agent_id !== undefined) { updates.push("agent_id = :agent_id"); repl.agent_id = agent_id; }
            if (occurred_at !== undefined) { updates.push("occurred_at = :occurred_at"); repl.occurred_at = occurred_at; }

            if (!updates.length) {
                await transaction.rollback();
                return this.sendError(res, {}, "No fields to update", 400);
            }

            updates.push("updated_at = NOW()");
            updates.push("is_edited = TRUE");

            // Raw SQL UPDATE
            await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_activity_history
                 SET ${updates.join(", ")}
                 WHERE id = :id`,
                { replacements: repl, type: QueryTypes.UPDATE, transaction }
            );

            // Raw SQL SELECT updated row
            const [result]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ah.id,
                        d.name AS disposition,
                        ah.disposition_id,
                        ah.conversation,
                        ah.occurred_at,
                        ah.created_at,
                        ah.updated_at,
                        su.name AS agent_name,
                        ah.agent_id
                 FROM public.lead_activity_history ah
                 LEFT JOIN public.lead_dispositions d ON d.id = ah.disposition_id
                 LEFT JOIN public.system_users su ON su.id = ah.agent_id
                 WHERE ah.id = :id`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction }
            );

            // Raw SQL log in system_user_activities
            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                await this.db_services.sequelizeWriter.query(
                    `INSERT INTO public.system_user_activities
                       (id, system_user_id, user_activity, module, type, created_at, updated_at)
                     VALUES
                       (:id, :system_user_id, :user_activity, :module, :type, NOW(), NOW())`,
                    {
                        replacements: {
                            id: uuidv4(),
                            system_user_id: authUserId,
                            user_activity: `Updated activity ID ${result.id}`,
                            module: "activity_management",
                            type: "update",
                        },
                        type: QueryTypes.INSERT,
                        transaction,
                    }
                );
            }

            await transaction.commit();
            return this.sendSuccess(res, result, "Activity updated successfully");
        } catch (err: any) {
            try { await transaction.rollback(); } catch { }
            console.error("Error in updateActivity:", err);
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 5. LIST ACTIVITIES (RAW SQL)                                           */
    /* ---------------------------------------------------------------------- */
    public listActivities = async (req: Request, res: Response): Promise<void> => {
        try {
            const src: any = { ...req.query, ...req.body, ...req.params };
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                disposition_id: Yup.string().uuid().optional(),
                agent_id: Yup.string().uuid().optional(),
                conversation: Yup.string().trim().max(500).optional(),
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),
            });

            const body = await schema.validate(src, { abortEarly: false });
            const { lead_id, disposition_id, agent_id, conversation } = body;
            const page = Number(body.page);
            const pageSize = Number(body.pageSize);
            const offset = (page - 1) * pageSize;

            const where: string[] = ["ah.lead_id = :lead_id", "ah.deleted_at IS NULL"];
            const repl: Record<string, any> = { lead_id, limit: pageSize, offset };

            if (disposition_id) { where.push("ah.disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
            if (agent_id) { where.push("ah.agent_id = :agent_id"); repl.agent_id = agent_id; }
            if (conversation) { where.push("ah.conversation ILIKE :conv"); repl.conv = `%${conversation}%`; }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total
                   FROM public.lead_activity_history ah
                   JOIN public.lead_dispositions d ON d.id = ah.disposition_id
              LEFT JOIN public.system_users su ON su.id = ah.agent_id
                  ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            const activities: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ah.id,
                        d.name AS disposition,
                        ah.disposition_id,
                        ah.conversation,
                        ah.occurred_at,
                        ah.created_at,
                        ah.updated_at,
                        ah.is_edited,
                        su.name AS agent_name,
                        ah.agent_id
                   FROM public.lead_activity_history ah
                   JOIN public.lead_dispositions d ON d.id = ah.disposition_id
              LEFT JOIN public.system_users su ON su.id = ah.agent_id
                  ${whereSql}
                 ORDER BY ah.created_at DESC
                 LIMIT :limit OFFSET :offset`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(res, {
                activities,
                pagination: { page, pageSize, totalPages: Math.ceil(total / pageSize), total },
            }, "Activity history fetched successfully");
        } catch (err: any) {
            console.error("Error in listActivities:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 6. FILTER ACTIVITIES (RAW SQL)                                         */
    /* ---------------------------------------------------------------------- */
    public filterlistActivities = async (req: Request, res: Response): Promise<void> => {
        try {
            const src: any = { ...req.query, ...req.body };

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                disposition_id: Yup.string().optional(),
                agent_id: Yup.string().optional(),
                conversation: Yup.string().trim().max(500).optional(),
            });

            const body = await schema.validate(src, { abortEarly: false });
            const { lead_id, disposition_id, agent_id, conversation } = body;

            const repl: Record<string, any> = { lead_id };
            const where: string[] = ["ah.lead_id = :lead_id", "ah.deleted_at IS NULL"];

            if (disposition_id) { where.push("ah.disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
            if (agent_id) { where.push("ah.agent_id = :agent_id"); repl.agent_id = agent_id; }
            if (conversation) { where.push("ah.conversation ILIKE :conv"); repl.conv = `%${conversation}%`; }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            const activities: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ah.id,
                        d.name AS disposition,
                        ah.disposition_id,
                        ah.conversation,
                        ah.occurred_at,
                        ah.created_at,
                        ah.updated_at,
                        su.name AS agent_name,
                        ah.agent_id
                   FROM public.lead_activity_history ah
                   JOIN public.lead_dispositions d ON d.id = ah.disposition_id
              LEFT JOIN public.system_users su ON su.id = ah.agent_id
                  ${whereSql}
                 ORDER BY ah.created_at DESC`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(res, { activities }, "Activity history fetched successfully");
        } catch (err: any) {
            console.error("Error in filterlistActivities:", err);
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 7. SOFT DELETE ACTIVITY (RAW SQL)                                      */
    /* ---------------------------------------------------------------------- */
    public softDeleteActivity = async (req: Request, res: Response): Promise<void> => {
        const tx = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
            });

            const { id } = await schema.validate(req.body, { abortEarly: false });

            // Raw SQL UPDATE
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_activity_history AS ah
                 SET deleted_at = NOW(),
                     updated_at = NOW()
                 WHERE ah.id = :id AND ah.deleted_at IS NULL
                 RETURNING ah.id, ah.lead_id, ah.disposition_id, ah.deleted_at`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction: tx }
            );

            if (!rows.length) {
                await tx.rollback();
                return this.sendError(res, {}, "Activity not found or already deleted.", 404);
            }

            // Raw SQL insert for log
            const adminUserId = (req as any)?.user?.system_user_id;
            if (adminUserId) {
                await this.db_services.sequelizeWriter.query(
                    `INSERT INTO public.system_user_activities
                       (id, system_user_id, user_activity, module, type, created_at, updated_at)
                     VALUES
                       (:id, :system_user_id, :user_activity, :module, :type, NOW(), NOW())`,
                    {
                        replacements: {
                            id: uuidv4(),
                            system_user_id: adminUserId,
                            user_activity: `Deleted activity for lead ${rows[0].lead_id}`,
                            module: "activity_management",
                            type: "delete",
                        },
                        type: QueryTypes.INSERT,
                        transaction: tx,
                    }
                );
            }

            await tx.commit();
            return this.sendSuccess(res, { count: 1, item: rows[0] }, "Activity deleted successfully");
        } catch (err: any) {
            try { await tx.rollback(); } catch { }
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            console.error("Error in softDeleteActivity:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 8. GET ACTIVITY BY ID (RAW SQL)                                        */
    /* ---------------------------------------------------------------------- */
    public getActivityById = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                activity_id: Yup.string().uuid().required("activity_id is required"),
            });
            await schema.validate(req.body, { abortEarly: false });
            const { activity_id } = req.body;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT lah.id,
                        lah.lead_id,
                        lah.conversation,
                        lah.occurred_at,
                        lah.created_at,
                        su.name AS agent_name,
                        d.name AS disposition
                   FROM public.lead_activity_history lah
              LEFT JOIN public.system_users su ON su.id = lah.agent_id
              LEFT JOIN public.lead_dispositions d ON d.id = lah.disposition_id
                  WHERE lah.id = :activity_id`,
                { replacements: { activity_id }, type: QueryTypes.SELECT }
            );

            if (!rows.length) {
                return this.sendError(res, {}, "Activity not found", 404);
            }

            return this.sendSuccess(res, rows[0], "Activity fetched successfully");
        } catch (err: any) {
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
}
