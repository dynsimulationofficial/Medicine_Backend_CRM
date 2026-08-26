import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";

export default class LeadTaskController extends BaseController {
    db_services: DBServices = new DBServices();

    /* ---------------------------------------------------------------------- */
    /* 1. CREATE TASK (RAW SQL)                                               */
    /* ---------------------------------------------------------------------- */
    public createTask = async (req: Request, res: Response): Promise<void> => {
        try {
            const tokenUser = (req as any)?.user ?? {};
            const authUserId: string | undefined = tokenUser.system_user_id || tokenUser.id;
            const authUserName: string | undefined = tokenUser.name || tokenUser.full_name;

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                assigned_agent_id: Yup.string().nullable().optional(),
                task_type: Yup.string().oneOf(["meeting", "phonecall", "followup"]).default("followup"),
                subject: Yup.string().trim().max(255).optional(),
                details: Yup.string().optional().default(""),
                location: Yup.string().trim().max(255).optional().default(""),
                start_at_text: Yup.string().trim().optional(),
                end_at_text: Yup.string().trim().optional(),
                start_at: Yup.date().optional(),
                end_at: Yup.date().optional(),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, details, task_type, location } = body;
            const finalAgentId = body.assigned_agent_id || authUserId || null;

            // Fetch lead details via raw SQL
            const leadRow: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT full_name FROM public.leads WHERE id = :lead_id LIMIT 1`,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );
            if (!leadRow.length) return this.sendError(res, {}, "Lead not found", 404);
            const leadFullName: string = leadRow[0].full_name || "Lead";

            const typeLabel = (t: string) =>
                t === "meeting" ? "Meeting" : t === "phonecall" ? "Phone Call" : "Follow Up";
            const subject = body.subject?.length ? body.subject : `${typeLabel(task_type)}: ${leadFullName}`;

            const startAt = body.start_at || (body.start_at_text ? new Date(body.start_at_text) : new Date());
            const endAt = body.end_at || (body.end_at_text ? new Date(body.end_at_text) : new Date(startAt.getTime() + 30 * 60000));

            const [row]: any[] = await this.db_services.sequelizeWriter.query(
                `WITH ins AS (
                   INSERT INTO public.lead_tasks
                     (id, lead_id, assigned_agent_id, details, task_type, subject, location,
                      timer_minutes, timer_hours, due_at, start_at, end_at,
                      status, created_at, updated_at)
                   VALUES
                     (:id, :lead_id, :assigned_agent_id, :details, :task_type, :subject, :location,
                      0, 0, :due_at, :start_at, :end_at,
                      'pending', NOW(), NOW())
                   RETURNING id, lead_id, assigned_agent_id, details, task_type, subject, location,
                             timer_hours, timer_minutes, start_at, end_at, status, created_at, updated_at
                 )
                 SELECT i.*,
                        COALESCE(su.name, :fallback_agent_name) AS agent_name,
                        l.full_name,
                        split_part(l.full_name, ' ', 1) AS lead_first_name,
                        CASE WHEN strpos(l.full_name,' ') > 0
                             THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                             ELSE NULL END AS lead_last_name
                   FROM ins i
              LEFT JOIN public.system_users su ON su.id = i.assigned_agent_id
                   JOIN public.leads l ON l.id = i.lead_id
                  LIMIT 1`,
                {
                    replacements: {
                        id: uuidv4(),
                        lead_id,
                        assigned_agent_id: finalAgentId,
                        details,
                        task_type,
                        subject,
                        location,
                        due_at: startAt,
                        start_at: startAt,
                        end_at: endAt,
                        fallback_agent_name: authUserName ?? null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            // Log activity via raw SQL
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
                            user_activity: `Created task for lead ${lead_id}`,
                            module: "task_management",
                            type: "create",
                        },
                        type: QueryTypes.INSERT,
                    }
                );
            }

            return this.sendSuccess(res, {
                id: row.id,
                type: row.task_type,
                subject: row.subject,
                details: row.details,
                location: row.location,
                status: row.status,
                start_at: row.start_at,
                start_at_ca: row.start_at ? new Date(row.start_at).toLocaleString() : "-",
                end_at: row.end_at,
                end_at_ca: row.end_at ? new Date(row.end_at).toLocaleString() : "-",
                owner_name: row.agent_name,
                organizer_name: row.agent_name,
                associated_lead: {
                    id: row.lead_id,
                    first_name: row.lead_first_name,
                    last_name: row.lead_last_name,
                    full_name: row.full_name,
                },
                timer_hours: row.timer_hours,
                timer_minutes: row.timer_minutes,
                created_at: row.created_at,
                updated_at: row.updated_at,
            }, "Task created", 200);
        } catch (err: any) {
            console.error("createTask error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 2. LIST TASKS (RAW SQL)                                                */
    /* ---------------------------------------------------------------------- */
    public listTasks = async (req: Request, res: Response): Promise<void> => {
        try {
            const tokenUser = (req as any)?.user ?? {};
            const fallbackAgentName: string | undefined = tokenUser.name || tokenUser.full_name || undefined;

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                order: Yup.string()
                    .oneOf(["start_desc", "start_asc", "created_desc", "created_asc"])
                    .default("created_desc"),
            });

            const qp = await schema.validate(req.body, { abortEarly: false });
            const { lead_id } = qp;

            const orderMap: Record<string, string> = {
                start_desc: "t.start_at DESC,  t.created_at DESC",
                start_asc: "t.start_at ASC,   t.created_at DESC",
                created_desc: "t.created_at DESC, t.start_at DESC",
                created_asc: "t.created_at ASC,  t.start_at DESC",
            };
            const orderSql = `ORDER BY ${orderMap[qp.order] ?? orderMap.created_desc}`;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id, t.task_type, t.subject, t.details, t.location,
                        t.status, t.timer_hours, t.timer_minutes,
                        t.start_at, t.end_at,
                        t.assigned_agent_id,
                        COALESCE(su.name, :fallback_agent_name) AS agent_name,
                        t.created_at, t.updated_at,
                        l.id AS lead_id, l.full_name,
                        split_part(l.full_name, ' ', 1) AS lead_first_name,
                        CASE WHEN strpos(l.full_name,' ') > 0
                             THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                             ELSE NULL END AS lead_last_name
                   FROM public.lead_tasks t
              LEFT JOIN public.system_users su ON su.id = t.assigned_agent_id
                   JOIN public.leads l ON l.id = t.lead_id
                  WHERE t.lead_id = :lead_id AND t.deleted_at IS NULL
                  ${orderSql}`,
                {
                    replacements: {
                        lead_id,
                        fallback_agent_name: fallbackAgentName ?? null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            const task = rows.map((r) => ({
                id: r.id,
                type: r.task_type,
                subject: r.subject,
                details: r.details,
                location: r.location,
                status: r.status,
                start_at: r.start_at,
                start_at_ca: r.start_at ? new Date(r.start_at).toLocaleString() : "-",
                end_at: r.end_at,
                end_at_ca: r.end_at ? new Date(r.end_at).toLocaleString() : "-",
                owner_name: r.agent_name ?? null,
                organizer_name: r.agent_name ?? null,
                associated_lead: {
                    id: r.lead_id,
                    first_name: r.lead_first_name,
                    last_name: r.lead_last_name,
                    full_name: r.full_name,
                },
                assigned_agent_id: r.assigned_agent_id,
                timer_hours: r.timer_hours,
                timer_minutes: r.timer_minutes,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }));

            return this.sendSuccess(res, { task }, "Tasks fetched successfully", 200);
        } catch (err: any) {
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 3. FILTER TASKS (RAW SQL)                                              */
    /* ---------------------------------------------------------------------- */
    public filterTasks = async (req: Request, res: Response): Promise<void> => {
        try {
            const tokenUser = (req as any)?.user ?? {};
            const fallbackAgentName: string | undefined = tokenUser.name || tokenUser.full_name || undefined;

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                assigned_agent_id: Yup.string().optional(),
                status: Yup.string().trim().max(30).optional(),
                task_type: Yup.string().optional(),
                subject: Yup.string().trim().max(255).optional(),
                details: Yup.string().trim().max(500).optional(),
                location: Yup.string().trim().max(255).optional(),
                order: Yup.string().oneOf(["start_desc", "start_asc", "created_desc", "created_asc"]).default("start_desc"),
            });

            const qp = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, assigned_agent_id, status, task_type, subject, details, location } = qp;

            const where: string[] = ["t.lead_id = :lead_id", "t.deleted_at IS NULL"];
            const repl: Record<string, any> = { lead_id };

            if (assigned_agent_id) { where.push("t.assigned_agent_id = :assigned_agent_id"); repl.assigned_agent_id = assigned_agent_id; }
            if (status) { where.push("t.status = :status"); repl.status = status; }
            if (task_type) { where.push("t.task_type = :task_type"); repl.task_type = task_type; }
            if (subject) { where.push("t.subject ILIKE :subject"); repl.subject = `%${subject}%`; }
            if (details) { where.push("t.details ILIKE :details_text"); repl.details_text = `%${details}%`; }
            if (location) { where.push("t.location ILIKE :location"); repl.location = `%${location}%`; }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id, t.task_type, t.subject, t.details, t.location,
                        t.status, t.timer_hours, t.timer_minutes,
                        t.start_at, t.end_at,
                        t.assigned_agent_id,
                        CASE WHEN t.assigned_agent_id IS NULL THEN :fallback_agent_name ELSE su.name END AS agent_name,
                        t.created_at, t.updated_at,
                        l.id AS lead_id, l.full_name,
                        split_part(l.full_name, ' ', 1) AS lead_first_name,
                        CASE WHEN strpos(l.full_name,' ') > 0
                             THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                             ELSE NULL END AS lead_last_name
                   FROM public.lead_tasks t
              LEFT JOIN public.system_users su ON su.id = t.assigned_agent_id
                   JOIN public.leads l ON l.id = t.lead_id
                  ${whereSql}
                 ORDER BY t.created_at DESC`,
                {
                    replacements: { ...repl, fallback_agent_name: fallbackAgentName ?? null },
                    type: QueryTypes.SELECT,
                }
            );

            const task = rows.map((r) => ({
                id: r.id,
                type: r.task_type,
                subject: r.subject,
                details: r.details,
                location: r.location,
                status: r.status,
                start_at: r.start_at,
                start_at_ca: r.start_at ? new Date(r.start_at).toLocaleString() : "-",
                end_at: r.end_at,
                end_at_ca: r.end_at ? new Date(r.end_at).toLocaleString() : "-",
                owner_name: r.agent_name ?? null,
                organizer_name: r.agent_name ?? null,
                associated_lead: {
                    id: r.lead_id,
                    first_name: r.lead_first_name,
                    last_name: r.lead_last_name,
                    full_name: r.full_name,
                },
                assigned_agent_id: r.assigned_agent_id,
                timer_hours: r.timer_hours,
                timer_minutes: r.timer_minutes,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }));

            return this.sendSuccess(res, { task }, "Tasks filtered successfully", 200);
        } catch (err: any) {
            console.error("filterTasks error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 4. EDIT TASK (RAW SQL)                                                 */
    /* ---------------------------------------------------------------------- */
    public editTask = async (req: Request, res: Response): Promise<void> => {
        const t = await this.db_services.sequelizeWriter.transaction();
        try {
            const auth = (req as any)?.user;
            const authUserId = auth?.system_user_id ? String(auth.system_user_id) : undefined;
            const fallbackAgentName = auth?.name || auth?.full_name || undefined;

            const schema = Yup.object({
                task_id: Yup.string().uuid().required("task_id is required"),
                lead_id: Yup.string().uuid().optional(),
                assigned_agent_id: Yup.string().uuid().optional(),
                details: Yup.string().optional(),
                task_type: Yup.string().oneOf(["meeting", "phonecall", "followup"]).optional(),
                subject: Yup.string().trim().max(255).optional(),
                location: Yup.string().trim().max(255).optional(),
                start_at_text: Yup.string().trim().optional(),
                end_at_text: Yup.string().trim().optional(),
                start_at: Yup.date().optional(),
                end_at: Yup.date().optional(),
                status: Yup.string().oneOf(["pending", "done"]).optional(),
            });

            const body = await schema.validate(req.body, { abortEarly: false });

            // Check existence via raw SQL
            const current: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.* FROM public.lead_tasks t WHERE t.id = :id AND t.deleted_at IS NULL LIMIT 1`,
                { replacements: { id: body.task_id }, type: QueryTypes.SELECT, transaction: t }
            );
            if (!current.length) {
                await t.rollback();
                return this.sendError(res, {}, "Task not found", 404);
            }

            const sets: string[] = [];
            const repl: any = { id: body.task_id };

            if (body.lead_id) { sets.push("lead_id = :lead_id"); repl.lead_id = body.lead_id; }
            if (body.assigned_agent_id) { sets.push("assigned_agent_id = :assigned_agent_id"); repl.assigned_agent_id = body.assigned_agent_id; }
            if (body.details !== undefined) { sets.push("details = :details"); repl.details = body.details; }
            if (body.task_type) { sets.push("task_type = :task_type"); repl.task_type = body.task_type; }
            if (body.subject !== undefined) { sets.push("subject = :subject"); repl.subject = body.subject; }
            if (body.location !== undefined) { sets.push("location = :location"); repl.location = body.location; }
            if (body.status) { sets.push("status = :status"); repl.status = body.status; }

            const startAt = body.start_at || (body.start_at_text ? new Date(body.start_at_text) : undefined);
            const endAt = body.end_at || (body.end_at_text ? new Date(body.end_at_text) : undefined);

            if (startAt) { sets.push("start_at = :start_at, due_at = :start_at"); repl.start_at = startAt; }
            if (endAt) { sets.push("end_at = :end_at"); repl.end_at = endAt; }

            if (!sets.length) {
                await t.rollback();
                return this.sendError(res, {}, "Nothing to update", 400);
            }

            sets.push("updated_at = NOW()");

            const updated: any[] = await this.db_services.sequelizeWriter.query(
                `WITH upd AS (
                     UPDATE public.lead_tasks
                        SET ${sets.join(", ")}
                      WHERE id = :id
                    RETURNING *
                 )
                 SELECT u.*,
                        COALESCE(su.name, :fallback_agent_name) AS agent_name,
                        l.full_name,
                        split_part(l.full_name, ' ', 1) AS lead_first_name,
                        CASE WHEN strpos(l.full_name,' ') > 0
                             THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                             ELSE NULL END AS lead_last_name
                   FROM upd u
              LEFT JOIN public.system_users su ON su.id = u.assigned_agent_id
                   JOIN public.leads l ON l.id = u.lead_id
                  LIMIT 1`,
                {
                    replacements: { ...repl, fallback_agent_name: fallbackAgentName ?? null },
                    type: QueryTypes.SELECT,
                    transaction: t,
                }
            );

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
                            user_activity: `Updated task ${body.task_id}`,
                            module: "task_management",
                            type: "update",
                        },
                        type: QueryTypes.INSERT,
                        transaction: t,
                    }
                );
            }

            await t.commit();
            const rec = updated[0];

            return this.sendSuccess(res, {
                id: rec.id,
                type: rec.task_type,
                subject: rec.subject,
                details: rec.details,
                location: rec.location,
                status: rec.status,
                start_at: rec.start_at,
                start_at_ca: rec.start_at ? new Date(rec.start_at).toLocaleString() : "-",
                end_at: rec.end_at,
                end_at_ca: rec.end_at ? new Date(rec.end_at).toLocaleString() : "-",
                owner_name: rec.agent_name,
                organizer_name: rec.agent_name,
                associated_lead: {
                    id: rec.lead_id,
                    first_name: rec.lead_first_name,
                    last_name: rec.lead_last_name,
                    full_name: rec.full_name,
                },
                timer_hours: rec.timer_hours,
                timer_minutes: rec.timer_minutes,
                created_at: rec.created_at,
                updated_at: rec.updated_at,
            }, "Task updated", 200);
        } catch (err: any) {
            try { await t.rollback(); } catch { }
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 5. COMPLETE TASK (RAW SQL)                                             */
    /* ---------------------------------------------------------------------- */
    public completeTask = async (req: Request, res: Response): Promise<void> => {
        try {
            const auth = (req as any)?.user;
            const authUserId = auth?.system_user_id ? String(auth.system_user_id) : undefined;

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                task_id: Yup.string().uuid().required("task_id is required"),
            });

            await schema.validate(req.body, { abortEarly: false });
            const { lead_id, task_id } = req.body;

            await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_tasks
                 SET status='done', updated_at=NOW()
                 WHERE id = :task_id AND lead_id = :lead_id`,
                { replacements: { lead_id, task_id }, type: QueryTypes.UPDATE }
            );

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
                            user_activity: `Completed task ${task_id} for lead ${lead_id}`,
                            module: "task_management",
                            type: "update",
                        },
                        type: QueryTypes.INSERT,
                    }
                );
            }

            return this.sendSuccess(res, { task_id, status: "done" }, "Task marked as completed");
        } catch (err: any) {
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 6. SOFT DELETE TASK (RAW SQL)                                          */
    /* ---------------------------------------------------------------------- */
    public softDeleteTask = async (req: Request, res: Response): Promise<void> => {
        const tx = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
            });

            const { id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_tasks AS t
                 SET deleted_at = NOW(),
                     updated_at = NOW()
                 WHERE t.id = :id AND t.deleted_at IS NULL
                 RETURNING t.id, t.lead_id, t.deleted_at`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction: tx }
            );

            if (!rows.length) {
                await tx.rollback();
                return this.sendError(res, {}, "Task not found or already deleted.", 404);
            }

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
                            user_activity: `Deleted task ${rows[0].id} for lead ${rows[0].lead_id}`,
                            module: "task_management",
                            type: "delete",
                        },
                        type: QueryTypes.INSERT,
                        transaction: tx,
                    }
                );
            }

            await tx.commit();
            return this.sendSuccess(res, { count: 1, item: rows[0] }, "Task deleted successfully");
        } catch (err: any) {
            try { await tx.rollback(); } catch { }
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            console.error("Error in softDeleteTask:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
}
