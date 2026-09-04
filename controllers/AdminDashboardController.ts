import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { DateTime } from "luxon";
import db from "../models";

// ==========================================
// 🔐 HELPER: AUTH & ADMIN ROLE CHECK
// ==========================================
const isAdmin = async (systemUserId: string): Promise<boolean> => {
  try {
    const rows: any[] = await db.sequelize.query(
      `SELECT 1 
       FROM public.user_role ur 
       JOIN public.roles r ON r.id = ur.role_id 
       WHERE ur.system_user_id = :uid AND LOWER(TRIM(r.name)) = 'admin' 
       LIMIT 1`,
      { replacements: { uid: systemUserId }, type: QueryTypes.SELECT }
    );
    return rows.length > 0;
  } catch {
    return false;
  }
};

// Date Format Helpers
const formatDate = (d: any): string | null => {
  if (!d) return null;
  const dt = DateTime.fromJSDate(new Date(d));
  return dt.isValid ? dt.toFormat("MM-dd-yyyy") : null;
};

const formatDateTime = (d: any): string | null => {
  if (!d) return null;
  const dt = DateTime.fromJSDate(new Date(d));
  return dt.isValid ? dt.toFormat("MM-dd-yyyy hh:mm a") : null;
};

// ==========================================
// 1. API: GET ADMIN KPI CARDS
// POST /api/v1/managelead/leads/admin/dashboard/cards
// ==========================================
export const getAdminCards = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const systemUserId = auth?.system_user_id || auth?.id;
    if (!systemUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const isUserAdmin = await isAdmin(String(systemUserId));
    if (!isUserAdmin) {
      return res.status(403).json({ success: false, message: "Forbidden - Admin access required" });
    }

    const now = DateTime.now();
    const todayStart = now.startOf("day");
    const todayEnd = now.endOf("day");

    const nowUtcISO = now.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayStartUTC = todayStart.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayEndUTC = todayEnd.toUTC().toISO({ suppressMilliseconds: true })!;

    const [teamCards]: any[] = await db.sequelize.query(
      `WITH norm AS (
          SELECT t.id, t.start_at, t.end_at, COALESCE(t.end_at, t.start_at) AS effective_due, t.updated_at, 
                 CASE WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done' 
                      WHEN LOWER(t.status::text) IN ('cancelled','canceled') THEN 'cancelled' 
                      ELSE 'pending' 
                 END AS s 
          FROM public.lead_tasks t 
          JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL 
          WHERE t.deleted_at IS NULL
      ), 
      today_base AS (
          SELECT id, s, effective_due FROM norm WHERE start_at >= :start_utc AND start_at <= :end_utc
      ), 
      done_marked_today AS (
          SELECT id FROM norm WHERE s = 'done' AND updated_at >= :start_utc AND updated_at <= :end_utc
      ), 
      done_today_union AS (
          SELECT id FROM today_base WHERE s = 'done' UNION SELECT id FROM done_marked_today
      ) 
      SELECT 
          (SELECT COUNT(*) FROM today_base) AS total_today, 
          (SELECT COUNT(*) FROM today_base WHERE s='pending' AND effective_due >= :now_utc) AS pending_today, 
          (SELECT COUNT(*) FROM done_today_union) AS done_today, 
          (SELECT COUNT(*) FROM today_base WHERE s='cancelled') AS cancelled_today, 
          (SELECT COUNT(*) FROM norm WHERE effective_due < :now_utc AND s = 'pending') AS overdue_all`,
      {
        replacements: { start_utc: todayStartUTC, end_utc: todayEndUTC, now_utc: nowUtcISO },
        type: QueryTypes.SELECT,
      }
    );

    const cardsData = {
      total_today: Number(teamCards?.total_today ?? 0),
      pending_today: Number(teamCards?.pending_today ?? 0),
      done_today: Number(teamCards?.done_today ?? 0),
      cancelled_today: Number(teamCards?.cancelled_today ?? 0),
      overdue_all: Number(teamCards?.overdue_all ?? 0),
      today: todayStart.toFormat("MM-dd-yyyy"),
      today_ca: todayStart.toFormat("MM-dd-yyyy"),
    };

    return res.status(200).json({
      success: true,
      message: "Admin cards fetched successfully",
      data: cardsData,
    });
  } catch (error: any) {
    console.error("getAdminCards error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 2. API: GET CAMPAIGN & LEAD SOURCE PERFORMANCE (THIS MONTH)
// POST /api/v1/managelead/leads/admin/dashboard/campaigns
// ==========================================
export const getCampaignPerformance = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const systemUserId = auth?.system_user_id || auth?.id;
    if (!systemUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const isUserAdmin = await isAdmin(String(systemUserId));
    if (!isUserAdmin) {
      return res.status(403).json({ success: false, message: "Forbidden - Admin access required" });
    }

    const now = DateTime.now();
    const fromDate = now.startOf("month").toUTC().toISO({ suppressMilliseconds: true })!;
    const toDate = now.endOf("month").toUTC().toISO({ suppressMilliseconds: true })!;

    // Total leads this month
    const [totalRow]: any[] = await db.sequelize.query(
      `SELECT COUNT(id) AS total_leads 
       FROM public.leads 
       WHERE deleted_at IS NULL AND created_at >= :fromDate AND created_at <= :toDate`,
      { replacements: { fromDate, toDate }, type: QueryTypes.SELECT }
    );
    const totalLeads = Number(totalRow?.total_leads || 0);

    // Campaign & Lead Source Rankings
    const campaignRows: any[] = await db.sequelize.query(
      `SELECT
          COALESCE(ls.name, 'Direct / Unknown') AS source_name,
          COALESCE(c.name, 'No Campaign / Direct') AS campaign_name,
          COUNT(l.id) AS leads_count,
          COUNT(CASE WHEN l.lead_status = 'Converted' OR ord_conv.has_order = 1 THEN 1 END) AS converted_count
       FROM public.leads l
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns c ON c.id = l.campaign_id
       LEFT JOIN (
          SELECT DISTINCT lead_id, 1 AS has_order
          FROM public.lead_orders
          WHERE deleted_at IS NULL
            AND order_status IN ('Confirmed', 'Shipped', 'Delivered')
       ) ord_conv ON ord_conv.lead_id = l.id
       WHERE l.deleted_at IS NULL
         AND l.created_at >= :fromDate AND l.created_at <= :toDate
       GROUP BY ls.name, c.name
       ORDER BY leads_count DESC`,
      { replacements: { fromDate, toDate }, type: QueryTypes.SELECT }
    );

    const rankings = campaignRows.map((row) => {
      const leads = Number(row.leads_count || 0);
      const converted = Number(row.converted_count || 0);
      const percentage = totalLeads > 0 ? Number(((leads / totalLeads) * 100).toFixed(1)) : 0;
      const conversionRate = leads > 0 ? Number(((converted / leads) * 100).toFixed(1)) : 0;
      return {
        source_name: row.source_name,
        campaign_name: row.campaign_name,
        leads_count: leads,
        percentage,
        converted_count: converted,
        conversion_rate: conversionRate,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Campaign performance fetched successfully",
      data: {
        total_leads: totalLeads,
        rankings,
      },
    });
  } catch (error: any) {
    console.error("getCampaignPerformance error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 3. API: GET TEAM TASKS BY AGENT
// POST /api/v1/managelead/leads/admin/dashboard/team-tasks
// ==========================================
export const getTeamTasks = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const systemUserId = auth?.system_user_id || auth?.id;
    if (!systemUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const isUserAdmin = await isAdmin(String(systemUserId));
    if (!isUserAdmin) {
      return res.status(403).json({ success: false, message: "Forbidden - Admin access required" });
    }

    const now = DateTime.now();
    const todayStart = now.startOf("day");
    const todayEnd = now.endOf("day");

    const nowUtcISO = now.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayStartUTC = todayStart.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayEndUTC = todayEnd.toUTC().toISO({ suppressMilliseconds: true })!;

    const teamByAgent: any[] = await db.sequelize.query(
      `WITH active_agents AS (
          SELECT su.id, su.name 
          FROM public.system_users su 
          JOIN public.user_role ur ON ur.system_user_id = su.id 
          JOIN public.roles r ON r.id = ur.role_id 
          WHERE su.deleted_at IS NULL AND (su.is_blocked = FALSE OR su.is_blocked IS NULL) AND TRIM(LOWER(r.name)) = 'agent'
      ), 
      lead_counts AS (
          SELECT l.agent_id, COUNT(*)::int AS total_assigned_leads, 
                 SUM((l.lead_status = 'New' OR l.lead_status IS NULL)::int)::int AS new_leads, 
                 SUM((l.lead_status = 'Converted')::int)::int AS converted_leads 
          FROM public.leads l 
          WHERE l.deleted_at IS NULL AND l.agent_id IS NOT NULL 
          GROUP BY l.agent_id
      ), 
      norm AS (
          SELECT t.id, t.assigned_agent_id, t.start_at, t.end_at, COALESCE(t.end_at, t.start_at) AS effective_due, t.updated_at, 
                 CASE WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done' 
                      WHEN LOWER(t.status::text) IN ('cancelled','canceled') THEN 'cancelled' 
                      ELSE 'pending' 
                 END AS s 
          FROM public.lead_tasks t 
          JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL 
          WHERE t.deleted_at IS NULL
      ), 
      today_base AS (
          SELECT assigned_agent_id, id, s, effective_due FROM norm WHERE start_at >= :start_utc AND start_at <= :end_utc
      ), 
      done_marked_today AS (
          SELECT assigned_agent_id, id FROM norm WHERE s = 'done' AND updated_at >= :start_utc AND updated_at <= :end_utc
      ), 
      done_today_union AS (
          SELECT assigned_agent_id, id FROM today_base WHERE s='done' UNION SELECT assigned_agent_id, id FROM done_marked_today
      ), 
      overdue_now AS (
          SELECT assigned_agent_id, COUNT(*)::int AS overdue 
          FROM norm 
          WHERE effective_due < :now_utc AND s = 'pending' 
          GROUP BY assigned_agent_id
      ), 
      today_counts AS (
          SELECT tb.assigned_agent_id, COUNT(*)::int AS total_today, 
                 SUM((tb.s='pending' AND tb.effective_due >= :now_utc)::int)::int AS pending_today 
          FROM today_base tb 
          GROUP BY tb.assigned_agent_id
      ), 
      done_counts AS (
          SELECT assigned_agent_id, COUNT(*)::int AS done_today 
          FROM done_today_union 
          GROUP BY assigned_agent_id
      ) 
      SELECT aa.id AS agent_id, aa.name AS agent_name, 
             COALESCE(lc.total_assigned_leads, 0) AS total_assigned_leads, 
             COALESCE(lc.new_leads, 0) AS new_leads, 
             COALESCE(lc.converted_leads, 0) AS converted_leads, 
             COALESCE(tc.total_today, 0) AS total_today, 
             COALESCE(dc.done_today, 0) AS done_today, 
             COALESCE(tc.pending_today, 0) AS pending_today, 
             COALESCE(onow.overdue, 0) AS overdue 
      FROM active_agents aa 
      LEFT JOIN lead_counts lc ON CAST(lc.agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      LEFT JOIN today_counts tc ON CAST(tc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      LEFT JOIN done_counts dc ON CAST(dc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      LEFT JOIN overdue_now onow ON CAST(onow.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      ORDER BY total_assigned_leads DESC, overdue DESC, agent_name ASC`,
      {
        replacements: { start_utc: todayStartUTC, end_utc: todayEndUTC, now_utc: nowUtcISO },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Team tasks by agent fetched successfully",
      data: teamByAgent,
    });
  } catch (error: any) {
    console.error("getTeamTasks error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 4. API: GET TASKS LIST (TODAY & OVERDUE)
// POST /api/v1/managelead/leads/admin/dashboard/tasks-list
// ==========================================
export const getTasksList = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const systemUserId = auth?.system_user_id || auth?.id;
    if (!systemUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const isUserAdmin = await isAdmin(String(systemUserId));
    if (!isUserAdmin) {
      return res.status(403).json({ success: false, message: "Forbidden - Admin access required" });
    }

    const now = DateTime.now();
    const todayStart = now.startOf("day");
    const todayEnd = now.endOf("day");

    const listTasksRaw: any[] = await db.sequelize.query(
      `SELECT t.id AS task_id, t.assigned_agent_id AS agent_id, su.name AS agent_name, 
              t.lead_id, l.full_name AS lead_name, l.phone AS lead_phone, 
              t.subject, t.location, t.task_type, t.status, t.start_at, t.end_at 
       FROM public.lead_tasks t 
       JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL 
       JOIN public.system_users su ON su.id = t.assigned_agent_id 
       WHERE t.deleted_at IS NULL AND su.deleted_at IS NULL AND (su.is_blocked = FALSE OR su.is_blocked IS NULL) 
       ORDER BY t.start_at ASC`,
      { type: QueryTypes.SELECT }
    );

    const todayTasksByAgent: Record<string, any> = {};
    const overdueTasksByAgent: Record<string, any> = {};

    listTasksRaw.forEach((t) => {
      const agentKey = t.agent_id;
      const startDt = DateTime.fromJSDate(new Date(t.start_at));
      const endDt = t.end_at ? DateTime.fromJSDate(new Date(t.end_at)) : null;
      const dueTime = endDt || startDt;

      const isDone = ["completed", "complete", "done"].includes(t.status?.toLowerCase());
      const isCancelled = ["cancelled", "canceled"].includes(t.status?.toLowerCase());
      const isPending = !isDone && !isCancelled;
      const isOverdue = isPending && dueTime < now;
      const isToday = startDt >= todayStart && startDt <= todayEnd;

      const formattedDueDate = formatDate(t.end_at ?? t.start_at);
      const formattedStartTime = formatDateTime(t.start_at);
      const formattedEndTime = t.end_at ? formatDateTime(t.end_at) : null;

      const taskItem = {
        task_id: t.task_id,
        lead_id: t.lead_id,
        lead_name: t.lead_name,
        lead_phone: t.lead_phone,
        subject: t.subject || "Follow-up",
        location: t.location || "Online",
        task_type: t.task_type || "followup",
        status: isDone ? "done" : isOverdue ? "overdue" : "pending",
        due_date: formattedDueDate,
        start_at: formattedStartTime,
        end_at: formattedEndTime,
        start_at_ca: formattedStartTime,
        end_at_ca: formattedEndTime,
      };

      if ((isDone && isToday) || (isPending && isToday && !isOverdue)) {
        if (!todayTasksByAgent[agentKey]) {
          todayTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
        }
        todayTasksByAgent[agentKey].tasks.push(taskItem);
      }

      if (isOverdue) {
        if (!overdueTasksByAgent[agentKey]) {
          overdueTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
        }
        overdueTasksByAgent[agentKey].tasks.push(taskItem);
      }
    });

    return res.status(200).json({
      success: true,
      message: "Tasks list fetched successfully",
      data: {
        today_tasks_by_agent: Object.values(todayTasksByAgent),
        overdue_tasks_by_agent: Object.values(overdueTasksByAgent),
      },
    });
  } catch (error: any) {
    console.error("getTasksList error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 5. UNIFIED API: GET ALL ADMIN DASHBOARD DATA
// POST /api/v1/managelead/leads/admin/dashboard
// ==========================================
export const getAdminDashboard = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const systemUserId = auth?.system_user_id || auth?.id;
    if (!systemUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const isUserAdmin = await isAdmin(String(systemUserId));
    if (!isUserAdmin) {
      return res.status(403).json({ success: false, message: "Forbidden - Admin access required" });
    }

    const now = DateTime.now();
    const todayStart = now.startOf("day");
    const todayEnd = now.endOf("day");

    const nowUtcISO = now.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayStartUTC = todayStart.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayEndUTC = todayEnd.toUTC().toISO({ suppressMilliseconds: true })!;
    const fromDateMonth = now.startOf("month").toUTC().toISO({ suppressMilliseconds: true })!;
    const toDateMonth = now.endOf("month").toUTC().toISO({ suppressMilliseconds: true })!;

    // 1. Cards
    const [teamCards]: any[] = await db.sequelize.query(
      `WITH norm AS (
          SELECT t.id, t.start_at, t.end_at, COALESCE(t.end_at, t.start_at) AS effective_due, t.updated_at, 
                 CASE WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done' 
                      WHEN LOWER(t.status::text) IN ('cancelled','canceled') THEN 'cancelled' 
                      ELSE 'pending' 
                 END AS s 
          FROM public.lead_tasks t 
          JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL 
          WHERE t.deleted_at IS NULL
      ), 
      today_base AS (
          SELECT id, s, effective_due FROM norm WHERE start_at >= :start_utc AND start_at <= :end_utc
      ), 
      done_marked_today AS (
          SELECT id FROM norm WHERE s = 'done' AND updated_at >= :start_utc AND updated_at <= :end_utc
      ), 
      done_today_union AS (
          SELECT id FROM today_base WHERE s = 'done' UNION SELECT id FROM done_marked_today
      ) 
      SELECT 
          (SELECT COUNT(*) FROM today_base) AS total_today, 
          (SELECT COUNT(*) FROM today_base WHERE s='pending' AND effective_due >= :now_utc) AS pending_today, 
          (SELECT COUNT(*) FROM done_today_union) AS done_today, 
          (SELECT COUNT(*) FROM today_base WHERE s='cancelled') AS cancelled_today, 
          (SELECT COUNT(*) FROM norm WHERE effective_due < :now_utc AND s = 'pending') AS overdue_all`,
      { replacements: { start_utc: todayStartUTC, end_utc: todayEndUTC, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
    );

    // 2. Team by Agent
    const teamByAgent: any[] = await db.sequelize.query(
      `WITH active_agents AS (
          SELECT su.id, su.name 
          FROM public.system_users su 
          JOIN public.user_role ur ON ur.system_user_id = su.id 
          JOIN public.roles r ON r.id = ur.role_id 
          WHERE su.deleted_at IS NULL AND (su.is_blocked = FALSE OR su.is_blocked IS NULL) AND TRIM(LOWER(r.name)) = 'agent'
      ), 
      lead_counts AS (
          SELECT l.agent_id, COUNT(*)::int AS total_assigned_leads, 
                 SUM((l.lead_status = 'New' OR l.lead_status IS NULL)::int)::int AS new_leads, 
                 SUM((l.lead_status = 'Converted')::int)::int AS converted_leads 
          FROM public.leads l 
          WHERE l.deleted_at IS NULL AND l.agent_id IS NOT NULL 
          GROUP BY l.agent_id
      ), 
      norm AS (
          SELECT t.id, t.assigned_agent_id, t.start_at, t.end_at, COALESCE(t.end_at, t.start_at) AS effective_due, t.updated_at, 
                 CASE WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done' 
                      WHEN LOWER(t.status::text) IN ('cancelled','canceled') THEN 'cancelled' 
                      ELSE 'pending' 
                 END AS s 
          FROM public.lead_tasks t 
          JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL 
          WHERE t.deleted_at IS NULL
      ), 
      today_base AS (
          SELECT assigned_agent_id, id, s, effective_due FROM norm WHERE start_at >= :start_utc AND start_at <= :end_utc
      ), 
      done_marked_today AS (
          SELECT assigned_agent_id, id FROM norm WHERE s = 'done' AND updated_at >= :start_utc AND updated_at <= :end_utc
      ), 
      done_today_union AS (
          SELECT assigned_agent_id, id FROM today_base WHERE s='done' UNION SELECT assigned_agent_id, id FROM done_marked_today
      ), 
      overdue_now AS (
          SELECT assigned_agent_id, COUNT(*)::int AS overdue 
          FROM norm 
          WHERE effective_due < :now_utc AND s = 'pending' 
          GROUP BY assigned_agent_id
      ), 
      today_counts AS (
          SELECT tb.assigned_agent_id, COUNT(*)::int AS total_today, 
                 SUM((tb.s='pending' AND tb.effective_due >= :now_utc)::int)::int AS pending_today 
          FROM today_base tb 
          GROUP BY tb.assigned_agent_id
      ), 
      done_counts AS (
          SELECT assigned_agent_id, COUNT(*)::int AS done_today 
          FROM done_today_union 
          GROUP BY assigned_agent_id
      ) 
      SELECT aa.id AS agent_id, aa.name AS agent_name, 
             COALESCE(lc.total_assigned_leads, 0) AS total_assigned_leads, 
             COALESCE(lc.new_leads, 0) AS new_leads, 
             COALESCE(lc.converted_leads, 0) AS converted_leads, 
             COALESCE(tc.total_today, 0) AS total_today, 
             COALESCE(dc.done_today, 0) AS done_today, 
             COALESCE(tc.pending_today, 0) AS pending_today, 
             COALESCE(onow.overdue, 0) AS overdue 
      FROM active_agents aa 
      LEFT JOIN lead_counts lc ON CAST(lc.agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      LEFT JOIN today_counts tc ON CAST(tc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      LEFT JOIN done_counts dc ON CAST(dc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      LEFT JOIN overdue_now onow ON CAST(onow.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT) 
      ORDER BY total_assigned_leads DESC, overdue DESC, agent_name ASC`,
      { replacements: { start_utc: todayStartUTC, end_utc: todayEndUTC, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
    );

    // 3. Campaign rankings
    const [totalRow]: any[] = await db.sequelize.query(
      `SELECT COUNT(id) AS total_leads 
       FROM public.leads 
       WHERE deleted_at IS NULL AND created_at >= :fromDateMonth AND created_at <= :toDateMonth`,
      { replacements: { fromDateMonth, toDateMonth }, type: QueryTypes.SELECT }
    );
    const totalLeads = Number(totalRow?.total_leads || 0);

    const campaignRows: any[] = await db.sequelize.query(
      `SELECT
          COALESCE(ls.name, 'Direct / Unknown') AS source_name,
          COALESCE(c.name, 'No Campaign / Direct') AS campaign_name,
          COUNT(l.id) AS leads_count,
          COUNT(CASE WHEN l.lead_status = 'Converted' OR ord_conv.has_order = 1 THEN 1 END) AS converted_count
       FROM public.leads l
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns c ON c.id = l.campaign_id
       LEFT JOIN (
          SELECT DISTINCT lead_id, 1 AS has_order
          FROM public.lead_orders
          WHERE deleted_at IS NULL
            AND order_status IN ('Confirmed', 'Shipped', 'Delivered')
       ) ord_conv ON ord_conv.lead_id = l.id
       WHERE l.deleted_at IS NULL
         AND l.created_at >= :fromDateMonth AND l.created_at <= :toDateMonth
       GROUP BY ls.name, c.name
       ORDER BY leads_count DESC`,
      { replacements: { fromDateMonth, toDateMonth }, type: QueryTypes.SELECT }
    );

    const campaignRankings = campaignRows.map((row) => {
      const leads = Number(row.leads_count || 0);
      const converted = Number(row.converted_count || 0);
      const percentage = totalLeads > 0 ? Number(((leads / totalLeads) * 100).toFixed(1)) : 0;
      const conversionRate = leads > 0 ? Number(((converted / leads) * 100).toFixed(1)) : 0;
      return {
        source_name: row.source_name,
        campaign_name: row.campaign_name,
        leads_count: leads,
        percentage,
        converted_count: converted,
        conversion_rate: conversionRate,
      };
    });

    // 4. Task Lists
    const listTasksRaw: any[] = await db.sequelize.query(
      `SELECT t.id AS task_id, t.assigned_agent_id AS agent_id, su.name AS agent_name, 
              t.lead_id, l.full_name AS lead_name, l.phone AS lead_phone, 
              t.subject, t.location, t.task_type, t.status, t.start_at, t.end_at 
       FROM public.lead_tasks t 
       JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL 
       JOIN public.system_users su ON su.id = t.assigned_agent_id 
       WHERE t.deleted_at IS NULL AND su.deleted_at IS NULL AND (su.is_blocked = FALSE OR su.is_blocked IS NULL) 
       ORDER BY t.start_at ASC`,
      { type: QueryTypes.SELECT }
    );

    const todayTasksByAgent: Record<string, any> = {};
    const overdueTasksByAgent: Record<string, any> = {};

    listTasksRaw.forEach((t) => {
      const agentKey = t.agent_id;
      const startDt = DateTime.fromJSDate(new Date(t.start_at));
      const endDt = t.end_at ? DateTime.fromJSDate(new Date(t.end_at)) : null;
      const dueTime = endDt || startDt;

      const isDone = ["completed", "complete", "done"].includes(t.status?.toLowerCase());
      const isCancelled = ["cancelled", "canceled"].includes(t.status?.toLowerCase());
      const isPending = !isDone && !isCancelled;
      const isOverdue = isPending && dueTime < now;
      const isToday = startDt >= todayStart && startDt <= todayEnd;

      const formattedDueDate = formatDate(t.end_at ?? t.start_at);
      const formattedStartTime = formatDateTime(t.start_at);
      const formattedEndTime = t.end_at ? formatDateTime(t.end_at) : null;

      const taskItem = {
        task_id: t.task_id,
        lead_id: t.lead_id,
        lead_name: t.lead_name,
        lead_phone: t.lead_phone,
        subject: t.subject || "Follow-up",
        location: t.location || "Online",
        task_type: t.task_type || "followup",
        status: isDone ? "done" : isOverdue ? "overdue" : "pending",
        due_date: formattedDueDate,
        start_at: formattedStartTime,
        end_at: formattedEndTime,
        start_at_ca: formattedStartTime,
        end_at_ca: formattedEndTime,
      };

      if ((isDone && isToday) || (isPending && isToday && !isOverdue)) {
        if (!todayTasksByAgent[agentKey]) {
          todayTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
        }
        todayTasksByAgent[agentKey].tasks.push(taskItem);
      }

      if (isOverdue) {
        if (!overdueTasksByAgent[agentKey]) {
          overdueTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
        }
        overdueTasksByAgent[agentKey].tasks.push(taskItem);
      }
    });

    return res.status(200).json({
      success: true,
      message: "Admin dashboard fetched successfully",
      data: {
        cards: {
          team_tasks: {
            total_today: Number(teamCards?.total_today ?? 0),
            pending_today: Number(teamCards?.pending_today ?? 0),
            done_today: Number(teamCards?.done_today ?? 0),
            cancelled_today: Number(teamCards?.cancelled_today ?? 0),
            overdue_all: Number(teamCards?.overdue_all ?? 0),
            today: todayStart.toFormat("MM-dd-yyyy"),
            today_ca: todayStart.toFormat("MM-dd-yyyy"),
          },
        },
        campaign_performance: {
          total_leads: totalLeads,
          rankings: campaignRankings,
        },
        tables: {
          team_tasks_by_agent: teamByAgent,
        },
        lists: {
          today_tasks_by_agent: Object.values(todayTasksByAgent),
          overdue_tasks_by_agent: Object.values(overdueTasksByAgent),
        },
      },
    });
  } catch (error: any) {
    console.error("getAdminDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// ==========================================
// DEFAULT EXPORT
// ==========================================
export default {
  getAdminCards,
  getCampaignPerformance,
  getTeamTasks,
  getTasksList,
  getAdminDashboard,
};