import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import * as Yup from "yup";
import { DateTime } from "luxon";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";

class AgentDashboardController extends BaseController {
    private db_services: DBServices;

    constructor() {
        super();
        this.db_services = new DBServices();
    }

    private async isAdmin(systemUserId: string): Promise<boolean> {
        try {
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT 1 FROM public.user_role ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.system_user_id = :uid AND LOWER(TRIM(r.name)) = 'admin' LIMIT 1`,
                { replacements: { uid: systemUserId }, type: QueryTypes.SELECT }
            );
            return rows.length > 0;
        } catch {
            return false;
        }
    }

    // ==========================================
    // 🔍 SEARCH LEADS FOR DASHBOARD
    // ==========================================
    public searchLeadsForDashboard = async (req: Request, res: Response) => {
        try {
            const query = (req.query.q as string) || "";
            const phoneQuery = (req.query.phone as string) || "";
            const emailQuery = (req.query.email as string) || "";

            if (!query && !phoneQuery && !emailQuery) {
                return this.sendError(res, {}, "Search query cannot be empty", 400);
            }

            const where: string[] = ["l.deleted_at IS NULL"];
            const repl: any = {};

            if (query) {
                where.push(`(l.full_name ILIKE :q_like OR l.email ILIKE :q_like OR regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') LIKE :q_digits OR regexp_replace(COALESCE(l.whatsapp_number, ''), '\\D', '', 'g') LIKE :q_digits)`);
                repl.q_like = `%${query.trim()}%`;
                repl.q_digits = `%${query.replace(/\D/g, "")}%`;
            }

            if (phoneQuery) {
                where.push(`(regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') LIKE :p_digits OR regexp_replace(COALESCE(l.whatsapp_number, ''), '\\D', '', 'g') LIKE :p_digits)`);
                repl.p_digits = `%${phoneQuery.replace(/\D/g, "")}%`;
            }

            if (emailQuery) {
                where.push(`regexp_replace(LOWER(TRIM(l.email)), '\\s+', '', 'g') LIKE :e_like`);
                repl.e_like = `%${emailQuery.trim().toLowerCase()}%`;
            }

            const sql = `
                SELECT
                    l.id,
                    l.full_name,
                    l.email,
                    l.phone,
                    l.whatsapp_number,
                    l.created_at,
                    u.name AS agent_name
                FROM leads l
                LEFT JOIN system_users u ON u.id = l.agent_id
                WHERE ${where.join(" AND ")}
                ORDER BY l.created_at DESC
                LIMIT 50
            `;

            const leads = await this.db_services.sequelizeWriter.query(sql, {
                replacements: repl,
                type: QueryTypes.SELECT,
            });

            return this.sendSuccess(res, { leads }, "Leads fetched successfully");
        } catch (err: any) {
            console.error("searchLeadsForDashboard error:", err);
            return this.sendError(res, {}, "Something went wrong", 500);
        }
    };

    // ==========================================
    // 📊 AGENT TASKS DASHBOARD
    // ==========================================
    public getAgentTasksDashboard = async (req: Request, res: Response) => {
        try {
            const auth = (req as any)?.user;
            if (!auth?.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }
            const me = String(auth.system_user_id);
            const isAdmin = await this.isAdmin(me);

            const schema = Yup.object({
                agent_id: Yup.string().uuid().optional(),
                days: Yup.number().integer().min(1).max(31).default(7),
            });
            const qp = await schema.validate(req.query, { abortEarly: false });
            const targetAgentId = isAdmin && qp.agent_id ? qp.agent_id : me;
            const windowDays = Number(qp.days ?? 7);

            const ZONE = "Asia/Kolkata";
            const DATE_FMT = "MM-dd-yyyy";
            const DATETIME_FMT = "MM-dd-yyyy hh:mm a";

            const nowEST = DateTime.now().setZone(ZONE);
            const todayStartEST = nowEST.startOf("day");
            const todayEndEST = nowEST.endOf("day");
            const nowUtcISO = nowEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayStartUTC = todayStartEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayEndUTC = todayEndEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const rangeStartEST = todayStartEST.minus({ days: windowDays - 1 });
            const rangeStartUTC = rangeStartEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const rangeEndUTC = todayEndUTC;

            const toESTString = (d: any): string | null =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATETIME_FMT) : null;
            const toESTDate = (d: any): string | null =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATE_FMT) : null;

            const baseWhere = `
            FROM public.lead_tasks t
            JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL
            WHERE t.deleted_at IS NULL
            AND t.assigned_agent_id = :aid
            `;

            const [pendingTodayRow]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS pending_today ${baseWhere} AND t.start_at >= :start_utc AND t.start_at <= :end_utc AND CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END = 'pending'`,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const [cancelledTodayRow]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS cancelled_today ${baseWhere} AND t.start_at >= :start_utc AND t.start_at <= :end_utc AND CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END = 'cancelled'`,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const [completedTodayRow]: any[] = await this.db_services.sequelizeWriter.query(
                `WITH norm AS (SELECT t.id, t.start_at, t.updated_at, CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END AS s ${baseWhere}), today_start_done AS (SELECT id FROM norm WHERE s = 'done' AND start_at IS NOT NULL AND start_at >= :start_utc AND start_at <= :end_utc), marked_done_today AS (SELECT id FROM norm WHERE s = 'done' AND updated_at IS NOT NULL AND updated_at >= :start_utc AND updated_at <= :end_utc) SELECT COUNT(DISTINCT id)::int AS completed_today FROM (SELECT id FROM today_start_done UNION SELECT id FROM marked_done_today) u`,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const [dueRow]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT SUM( (t.end_at < :now_utc AND (CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END) = 'pending')::int )::int AS overdue, SUM( (t.start_at >= :now_utc AND (CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END) = 'pending')::int )::int AS upcoming ${baseWhere}`,
                { replacements: { aid: targetAgentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            const byTypeToday: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.task_type, COUNT(*)::int AS c ${baseWhere} AND t.start_at >= :start_utc AND t.start_at <= :end_utc AND CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END = 'pending' GROUP BY 1`,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const lastNDaysRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT (t.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS day_est, COUNT(*)::int AS c ${baseWhere} AND t.start_at >= :start_utc AND t.start_at <= :end_utc GROUP BY 1 ORDER BY 1 ASC`,
                { replacements: { aid: targetAgentId, start_utc: rangeStartUTC, end_utc: rangeEndUTC }, type: QueryTypes.SELECT }
            );

            const barMap = new Map<string, number>();
            for (const r of lastNDaysRows) {
                const key = DateTime.fromJSDate(new Date(r.day_est)).setZone(ZONE).toFormat(DATE_FMT);
                barMap.set(key, r.c);
            }
            const tasksBar: Array<{ date: string; count: number }> = [];
            for (let i = 0; i < windowDays; i++) {
                const d = rangeStartEST.plus({ days: i }).toFormat(DATE_FMT);
                tasksBar.push({ date: d, count: barMap.get(d) ?? 0 });
            }

            const statusTodayRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END AS status, COUNT(*)::int AS count ${baseWhere} AND t.start_at >= :start_utc AND t.start_at <= :end_utc GROUP BY 1`,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const upcomingRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id, t.task_type, t.subject, 'pending'::text AS status, t.start_at, l.full_name, l.id AS lead_id FROM public.lead_tasks t JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL WHERE t.deleted_at IS NULL AND t.assigned_agent_id = :aid AND t.start_at >= :now_utc AND CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END = 'pending' ORDER BY t.start_at ASC LIMIT 20`,
                { replacements: { aid: targetAgentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            const overdueRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id, t.task_type, t.subject, 'pending'::text AS status, t.start_at, t.end_at, l.full_name, l.id AS lead_id FROM public.lead_tasks t JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL WHERE t.deleted_at IS NULL AND t.assigned_agent_id = :aid AND t.end_at < :now_utc AND CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END = 'pending' ORDER BY t.end_at DESC LIMIT 20`,
                { replacements: { aid: targetAgentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            const doneTodayRows: any[] = await this.db_services.sequelizeWriter.query(
                `WITH norm AS (SELECT t.id, t.lead_id, t.task_type, t.subject, t.start_at, t.updated_at, l.full_name, CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END AS s FROM public.lead_tasks t JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL WHERE t.deleted_at IS NULL AND t.assigned_agent_id = :aid), today_start_done AS (SELECT id FROM norm WHERE s = 'done' AND start_at IS NOT NULL AND start_at >= :start_utc AND start_at <= :end_utc), marked_done_today AS (SELECT id FROM norm WHERE s = 'done' AND updated_at IS NOT NULL AND updated_at >= :start_utc AND updated_at <= :end_utc), union_ids AS (SELECT id FROM today_start_done UNION SELECT id FROM marked_done_today) SELECT n.id, n.lead_id, n.task_type, n.subject, 'done'::text AS status, n.start_at, n.full_name FROM union_ids u JOIN norm n ON n.id = u.id ORDER BY COALESCE(n.start_at, n.updated_at) DESC LIMIT 20`,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const pendingTodayRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id, t.lead_id, t.task_type, t.subject, 'pending'::text AS status, t.start_at, l.full_name FROM public.lead_tasks t JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL WHERE t.deleted_at IS NULL AND t.assigned_agent_id = :aid AND t.start_at >= :start_utc AND t.start_at <= :end_utc AND CASE WHEN t.status::text IN ('completed','complete','done') THEN 'done' WHEN t.status::text IN ('cancelled','canceled') THEN 'cancelled' ELSE 'pending' END = 'pending' ORDER BY t.start_at ASC LIMIT 20`,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const mapList = (rows: any[]) =>
                rows.map(r => ({
                    id: r.id,
                    lead_id: r.lead_id,
                    type: r.task_type,
                    subject: r.subject,
                    status: r.status,
                    start_at: r.start_at,
                    start_at_est: toESTString(r.start_at),
                    end_at_est: toESTString(r.end_at),
                    start_date_est: toESTDate(r.start_at),
                    lead_name: r.full_name,
                }));

            return this.sendSuccess(
                res,
                {
                    scope: { agent_id: targetAgentId, is_admin_view: isAdmin && targetAgentId !== me },
                    cards: {
                        today: {
                            total: Number(pendingTodayRow?.pending_today ?? 0),
                            pending: Number(pendingTodayRow?.pending_today ?? 0),
                            completed: Number(completedTodayRow?.completed_today ?? 0),
                            cancelled: Number(cancelledTodayRow?.cancelled_today ?? 0),
                            today_est: todayStartEST.toFormat(DATE_FMT),
                        },
                        overdue: Number(dueRow?.overdue ?? 0),
                        upcoming: Number(dueRow?.upcoming ?? 0),
                        today_by_type: byTypeToday.map((x: any) => ({ type: x.task_type, count: x.c })),
                    },
                    series: {
                        tasks_bar_last_n_days: tasksBar,
                        today_status_pie: statusTodayRows.map((x: any) => ({ status: x.status, count: x.count })),
                    },
                    lists: {
                        upcoming: mapList(upcomingRows),
                        overdue: mapList(overdueRows),
                        done_today: mapList(doneTodayRows),
                        pending_today: mapList(pendingTodayRows),
                    },
                    window_days: windowDays,
                    today_est: todayStartEST.toFormat(DATE_FMT),
                    now_est: nowEST.toFormat(DATETIME_FMT),
                },
                "Agent tasks dashboard"
            );
        } catch (err: any) {
            console.error("getAgentTasksDashboard error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
}

export default new AgentDashboardController();