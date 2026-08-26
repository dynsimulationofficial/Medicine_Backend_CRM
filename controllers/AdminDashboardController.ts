import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import * as Yup from "yup";
import { DateTime } from "luxon";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";

class AdminDashboardController extends BaseController {
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
    // 👑 ADMIN DASHBOARD
    // ==========================================
    public getAdminDashboard = async (req: Request, res: Response) => {
        try {
            const auth = (req as any)?.user;
            if (!auth?.system_user_id) return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            const me = String(auth.system_user_id);
            const isAdmin = await this.isAdmin(me);
            if (!isAdmin) return this.sendError(res, {}, "Forbidden", 403);

            const ZONE = "Asia/Kolkata";
            const DATE_FMT = "MM-dd-yyyy";
            const DATETIME_FMT = "MM-dd-yyyy hh:mm a";

            const nowCA = DateTime.now().setZone(ZONE);
            const todayStartCA = nowCA.startOf("day");
            const todayEndCA = nowCA.endOf("day");
            const nowUtcISO = nowCA.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayStartUTC = todayStartCA.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayEndUTC = todayEndCA.toUTC().toISO({ suppressMilliseconds: true })!;

            const toCAString = (d: any) =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATETIME_FMT) : null;
            const toCADate = (d: any) =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATE_FMT) : null;

            const [teamCards]: any[] = await this.db_services.sequelizeWriter.query(
                `WITH norm AS (SELECT t.id, t.start_at, t.end_at, t.updated_at, CASE WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done' WHEN LOWER(t.status::text) IN ('cancelled','canceled') THEN 'cancelled' WHEN LOWER(t.status::text) = 'pending' THEN 'pending' ELSE NULL END AS s FROM public.lead_tasks t JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL WHERE t.deleted_at IS NULL), today_base AS (SELECT id, s FROM norm WHERE start_at >= :start_utc AND start_at <= :end_utc), done_marked_today AS (SELECT id FROM norm WHERE s = 'done' AND updated_at >= :start_utc AND updated_at <= :end_utc), done_today_union AS (SELECT id FROM today_base WHERE s = 'done' UNION SELECT id FROM done_marked_today) SELECT (SELECT COUNT(*) FROM today_base) AS total_today, (SELECT COUNT(*) FROM today_base WHERE s='pending') AS pending_today, (SELECT COUNT(*) FROM done_today_union) AS done_today, (SELECT COUNT(*) FROM today_base WHERE s='cancelled') AS cancelled_today, (SELECT COUNT(*) FROM norm WHERE end_at IS NOT NULL AND s = 'pending' AND end_at < :now_utc) AS overdue_all`,
                { replacements: { start_utc: todayStartUTC, end_utc: todayEndUTC, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            const teamByAgent: any[] = await this.db_services.sequelizeWriter.query(
                `WITH active_agents AS (SELECT su.id, su.name FROM public.system_users su JOIN public.user_role ur ON ur.system_user_id = su.id JOIN public.roles r ON r.id = ur.role_id WHERE su.deleted_at IS NULL AND (su.is_blocked = FALSE OR su.is_blocked IS NULL) AND TRIM(LOWER(r.name)) = 'agent'), lead_counts AS (SELECT l.agent_id, COUNT(*)::int AS total_assigned_leads, SUM((l.lead_status = 'New' OR l.lead_status IS NULL)::int)::int AS new_leads, SUM((l.lead_status = 'Converted')::int)::int AS converted_leads FROM public.leads l WHERE l.deleted_at IS NULL AND l.agent_id IS NOT NULL GROUP BY l.agent_id), norm AS (SELECT t.id, t.assigned_agent_id, t.start_at, t.end_at, t.updated_at, CASE WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done' WHEN LOWER(t.status::text) IN ('cancelled','canceled') THEN 'cancelled' WHEN LOWER(t.status::text) = 'pending' THEN 'pending' ELSE NULL END AS s FROM public.lead_tasks t JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL WHERE t.deleted_at IS NULL), today_base AS (SELECT assigned_agent_id, id, s FROM norm WHERE start_at >= :start_utc AND start_at <= :end_utc), done_marked_today AS (SELECT assigned_agent_id, id FROM norm WHERE s = 'done' AND updated_at >= :start_utc AND updated_at <= :end_utc), done_today_union AS (SELECT assigned_agent_id, id FROM today_base WHERE s='done' UNION SELECT assigned_agent_id, id FROM done_marked_today), overdue_now AS (SELECT assigned_agent_id, COUNT(*)::int AS overdue FROM norm WHERE end_at IS NOT NULL AND s = 'pending' AND end_at < :now_utc GROUP BY assigned_agent_id), today_counts AS (SELECT tb.assigned_agent_id, COUNT(*)::int AS total_today, SUM((tb.s='pending')::int)::int AS pending_today FROM today_base tb GROUP BY tb.assigned_agent_id), done_counts AS (SELECT assigned_agent_id, COUNT(*)::int AS done_today FROM done_today_union GROUP BY assigned_agent_id) SELECT aa.id AS agent_id, aa.name AS agent_name, COALESCE(lc.total_assigned_leads, 0) AS total_assigned_leads, COALESCE(lc.new_leads, 0) AS new_leads, COALESCE(lc.converted_leads, 0) AS converted_leads, COALESCE(tc.total_today, 0) AS total_today, COALESCE(dc.done_today, 0) AS done_today, COALESCE(tc.pending_today, 0) AS pending_today, COALESCE(onow.overdue, 0) AS overdue FROM active_agents aa LEFT JOIN lead_counts lc ON CAST(lc.agent_id AS TEXT) = CAST(aa.id AS TEXT) LEFT JOIN today_counts tc ON CAST(tc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) LEFT JOIN done_counts dc ON CAST(dc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) LEFT JOIN overdue_now onow ON CAST(onow.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) ORDER BY total_assigned_leads DESC, overdue DESC, agent_name ASC`,
                { replacements: { start_utc: todayStartUTC, end_utc: todayEndUTC, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            const listTasksRaw: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id AS task_id, t.assigned_agent_id AS agent_id, su.name AS agent_name, t.lead_id, l.full_name AS lead_name, t.status, t.start_at, t.end_at FROM public.lead_tasks t JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL JOIN public.system_users su ON su.id = t.assigned_agent_id WHERE t.deleted_at IS NULL AND su.deleted_at IS NULL AND su.is_blocked = FALSE ORDER BY t.start_at ASC`,
                { type: QueryTypes.SELECT }
            );

            const todayTasksByAgent: Record<string, any> = {};
            const overdueTasksByAgent: Record<string, any> = {};

            listTasksRaw.forEach(t => {
                const agentKey = t.agent_id;
                const startCA = DateTime.fromJSDate(new Date(t.start_at), { zone: "utc" }).setZone(ZONE);
                const endCA = t.end_at ? DateTime.fromJSDate(new Date(t.end_at), { zone: "utc" }).setZone(ZONE) : null;

                if (startCA >= todayStartCA && startCA <= todayEndCA && ['completed', 'complete', 'done'].includes(t.status)) {
                    if (!todayTasksByAgent[agentKey]) todayTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
                    todayTasksByAgent[agentKey].tasks.push({
                        task_id: t.task_id,
                        lead_id: t.lead_id,
                        lead_name: t.lead_name,
                        status: 'done',
                        due_date: toCADate(t.end_at ?? t.start_at),
                        start_at_ca: toCAString(t.start_at),
                        end_at_ca: t.end_at ? toCAString(t.end_at) : null,
                    });
                }

                if (startCA >= todayStartCA && startCA <= todayEndCA && t.status === 'pending') {
                    if (!todayTasksByAgent[agentKey]) todayTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
                    todayTasksByAgent[agentKey].tasks.push({
                        task_id: t.task_id,
                        lead_id: t.lead_id,
                        lead_name: t.lead_name,
                        status: 'pending',
                        due_date: toCADate(t.end_at ?? t.start_at),
                        start_at_ca: toCAString(t.start_at),
                        end_at_ca: t.end_at ? toCAString(t.end_at) : null,
                    });
                }

                if (endCA && endCA < nowCA && t.status === 'pending') {
                    if (!overdueTasksByAgent[agentKey]) overdueTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
                    overdueTasksByAgent[agentKey].tasks.push({
                        task_id: t.task_id,
                        lead_id: t.lead_id,
                        lead_name: t.lead_name,
                        status: 'overdue',
                        due_date: toCADate(t.end_at),
                        start_at_ca: toCAString(t.start_at),
                        end_at_ca: toCAString(t.end_at),
                    });
                }
            });

            return this.sendSuccess(
                res,
                {
                    cards: {
                        team_tasks: {
                            total_today: Number(teamCards?.total_today ?? 0),
                            pending_today: Number(teamCards?.pending_today ?? 0),
                            done_today: Number(teamCards?.done_today ?? 0),
                            cancelled_today: Number(teamCards?.cancelled_today ?? 0),
                            overdue_all: Number(teamCards?.overdue_all ?? 0),
                            today_ca: todayStartCA.toFormat(DATE_FMT),
                        },
                    },
                    tables: {
                        team_tasks_by_agent: teamByAgent,
                    },
                    lists: {
                        today_tasks_by_agent: Object.values(todayTasksByAgent),
                        overdue_tasks_by_agent: Object.values(overdueTasksByAgent),
                    },
                },
                "Admin dashboard"
            );
        } catch (err: any) {
            console.error("getAdminDashboard error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
}

export default new AdminDashboardController();