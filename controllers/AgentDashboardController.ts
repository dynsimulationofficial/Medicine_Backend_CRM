import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { DateTime } from "luxon";
import db from "../models";

// ==========================================
// 🕒 DATE FORMAT HELPERS (IST)
// ==========================================
const formatDate = (d: any): string | null => {
  if (!d) return null;
  const dt = DateTime.fromJSDate(new Date(d)).setZone("Asia/Kolkata");
  return dt.isValid ? dt.toFormat("MM-dd-yyyy") : null;
};

const formatDateTime = (d: any): string | null => {
  if (!d) return null;
  const dt = DateTime.fromJSDate(new Date(d)).setZone("Asia/Kolkata");
  return dt.isValid ? dt.toFormat("MM-dd-yyyy hh:mm a") : null;
};

// ==========================================
// 1. API: ASSIGNED LEADS COUNT (Card 1)
// POST /api/v1/managelead/leads/agent/dashboard/assigned-leads-count
// ==========================================
export const getAssignedLeadsCount = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const [row]: any[] = await db.sequelize.query(
      `SELECT COUNT(id)::int AS count 
       FROM public.leads 
       WHERE deleted_at IS NULL AND agent_id = :agentId`,
      { replacements: { agentId }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      message: "Assigned leads count fetched",
      data: { count: Number(row?.count ?? 0) },
    });
  } catch (error: any) {
    console.error("getAssignedLeadsCount error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 2. API: CONVERTED DEALS COUNT (Card 2)
// POST /api/v1/managelead/leads/agent/dashboard/converted-deals-count
// ==========================================
export const getConvertedDealsCount = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const [row]: any[] = await db.sequelize.query(
      `SELECT COUNT(DISTINCT l.id)::int AS count 
       FROM public.leads l 
       LEFT JOIN public.lead_orders o ON o.lead_id = l.id AND o.deleted_at IS NULL
       WHERE l.deleted_at IS NULL 
         AND l.agent_id = :agentId 
         AND (l.lead_status = 'Converted' OR o.id IS NOT NULL)`,
      { replacements: { agentId }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      message: "Converted deals count fetched",
      data: { count: Number(row?.count ?? 0) },
    });
  } catch (error: any) {
    console.error("getConvertedDealsCount error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 3. API: TOTAL ORDERS COUNT (Card 3)
// POST /api/v1/managelead/leads/agent/dashboard/total-orders-count
// ==========================================
export const getTotalOrdersCount = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const [row]: any[] = await db.sequelize.query(
      `SELECT COUNT(o.id)::int AS count 
       FROM public.lead_orders o 
       JOIN public.leads l ON l.id = o.lead_id AND l.deleted_at IS NULL
       WHERE o.deleted_at IS NULL 
         AND (o.agent_id = :agentId OR l.agent_id = :agentId)`,
      { replacements: { agentId }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      message: "Total orders count fetched",
      data: { count: Number(row?.count ?? 0) },
    });
  } catch (error: any) {
    console.error("getTotalOrdersCount error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 4. API: SALES REVENUE BY CURRENCY (Card 4)
// POST /api/v1/managelead/leads/agent/dashboard/sales-revenue
// ==========================================
export const getSalesRevenue = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const [row]: any[] = await db.sequelize.query(
      `SELECT
         COALESCE(SUM(CASE WHEN l.currency = 'INR' OR l.currency IS NULL THEN o.grand_total ELSE 0 END), 0)::float AS inr,
         COALESCE(SUM(CASE WHEN l.currency = 'USD' THEN o.grand_total ELSE 0 END), 0)::float AS usd,
         COALESCE(SUM(CASE WHEN l.currency = 'GBP' THEN o.grand_total ELSE 0 END), 0)::float AS gbp
       FROM public.lead_orders o
       JOIN public.leads l ON l.id = o.lead_id AND l.deleted_at IS NULL
       WHERE o.deleted_at IS NULL 
         AND o.order_status != 'Cancelled'
         AND (o.agent_id = :agentId OR l.agent_id = :agentId)`,
      { replacements: { agentId }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      message: "Sales revenue fetched successfully",
      data: {
        inr: Number(row?.inr ?? 0),
        usd: Number(row?.usd ?? 0),
        gbp: Number(row?.gbp ?? 0),
      },
    });
  } catch (error: any) {
    console.error("getSalesRevenue error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 5. API: TASKS TODAY (Card 5)
// POST /api/v1/managelead/leads/agent/dashboard/tasks-today
// ==========================================
export const getTasksTodayCount = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const now = DateTime.now().setZone("Asia/Kolkata");
    const todayStart = now.startOf("day");
    const todayEnd = now.endOf("day");
    const todayStartUTC = todayStart.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayEndUTC = todayEnd.toUTC().toISO({ suppressMilliseconds: true })!;

    const [row]: any[] = await db.sequelize.query(
      `SELECT
          COUNT(CASE WHEN t.start_at >= :start_utc AND t.start_at <= :end_utc THEN 1 END)::int AS total_today,
          COUNT(CASE WHEN t.start_at >= :start_utc AND t.start_at <= :end_utc 
                     AND LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled') THEN 1 END)::int AS pending_today,
          COUNT(CASE WHEN LOWER(t.status::text) IN ('done', 'completed', 'complete') 
                     AND ((t.start_at >= :start_utc AND t.start_at <= :end_utc) OR (t.updated_at >= :start_utc AND t.updated_at <= :end_utc)) THEN 1 END)::int AS done_today
       FROM public.lead_tasks t
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT)))`,
      {
        replacements: { agentId, start_utc: todayStartUTC, end_utc: todayEndUTC },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Tasks today fetched successfully",
      data: {
        total_today: Number(row?.total_today ?? 0),
        pending_today: Number(row?.pending_today ?? 0),
        done_today: Number(row?.done_today ?? 0),
      },
    });
  } catch (error: any) {
    console.error("getTasksTodayCount error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 6. API: OVERDUE TASKS (Card 6)
// POST /api/v1/managelead/leads/agent/dashboard/overdue-tasks
// ==========================================
export const getOverdueTasksCount = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const now = DateTime.now().setZone("Asia/Kolkata");
    const nowUtcISO = now.toUTC().toISO({ suppressMilliseconds: true })!;

    const [row]: any[] = await db.sequelize.query(
      `SELECT COUNT(t.id)::int AS count 
       FROM public.lead_tasks t 
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL 
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT)))
         AND COALESCE(t.end_at, t.start_at) < :now_utc 
         AND LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled')`,
      { replacements: { agentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      message: "Overdue tasks count fetched",
      data: { count: Number(row?.count ?? 0) },
    });
  } catch (error: any) {
    console.error("getOverdueTasksCount error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 7. API: MY ASSIGNED LEAD QUEUE TABLE (Section 7)
// POST /api/v1/managelead/leads/agent/dashboard/assigned-leads
// ==========================================
export const getAssignedLeadsQueue = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const page = Math.max(1, Number(req.body?.page || req.query?.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.body?.pageSize || req.query?.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    const [countResult]: any[] = await db.sequelize.query(
      `SELECT COUNT(id)::int AS total FROM public.leads WHERE agent_id = :agentId AND deleted_at IS NULL`,
      { replacements: { agentId }, type: QueryTypes.SELECT }
    );
    const total = Number(countResult?.total || 0);

    const leads: any[] = await db.sequelize.query(
      `SELECT 
          l.id,
          l.lead_number,
          l.full_name,
          l.phone,
          l.email,
          l.whatsapp_number,
          l.city,
          l.country,
          l.lead_status,
          l.currency,
          l.created_at,
          l.updated_at,
          COALESCE(ord_summary.order_count, 0)::int AS order_count,
          COALESCE(ord_summary.total_order_amount, 0)::float AS total_order_amount,
          ord_summary.latest_order_status,
          ord_summary.latest_order_number
       FROM public.leads l
       LEFT JOIN LATERAL (
          SELECT 
              COUNT(o.id) AS order_count,
              SUM(o.grand_total) AS total_order_amount,
              (SELECT order_status FROM public.lead_orders WHERE lead_id = l.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) AS latest_order_status,
              (SELECT order_number FROM public.lead_orders WHERE lead_id = l.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) AS latest_order_number
          FROM public.lead_orders o
          WHERE o.lead_id = l.id AND o.deleted_at IS NULL
       ) ord_summary ON true
       WHERE l.agent_id = :agentId AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC
       LIMIT :pageSize OFFSET :offset`,
      {
        replacements: { agentId, pageSize, offset },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Assigned leads queue fetched successfully",
      data: {
        leads,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize) || 1,
        },
      },
    });
  } catch (error: any) {
    console.error("getAssignedLeadsQueue error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 8. API: SEARCH LEADS FOR DASHBOARD
// GET /api/v1/managelead/leads/search/dashboard
// ==========================================
export const searchLeadsForDashboard = async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || "";
    const phoneQuery = (req.query.phone as string) || "";
    const emailQuery = (req.query.email as string) || "";

    if (!query && !phoneQuery && !emailQuery) {
      return res.status(400).json({ success: false, message: "Search query cannot be empty" });
    }

    const where: string[] = ["l.deleted_at IS NULL"];
    const repl: any = {};

    if (query) {
      where.push(
        `(l.full_name ILIKE :q_like OR l.email ILIKE :q_like OR regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') LIKE :q_digits OR regexp_replace(COALESCE(l.whatsapp_number, ''), '\\D', '', 'g') LIKE :q_digits)`
      );
      repl.q_like = `%${query.trim()}%`;
      repl.q_digits = `%${query.replace(/\D/g, "")}%`;
    }

    if (phoneQuery) {
      where.push(
        `(regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') LIKE :p_digits OR regexp_replace(COALESCE(l.whatsapp_number, ''), '\\D', '', 'g') LIKE :p_digits)`
      );
      repl.p_digits = `%${phoneQuery.replace(/\D/g, "")}%`;
    }

    if (emailQuery) {
      where.push(`regexp_replace(LOWER(TRIM(l.email)), '\\s+', '', 'g') LIKE :e_like`);
      repl.e_like = `%${emailQuery.trim().toLowerCase()}%`;
    }

    const leads = await db.sequelize.query(
      `SELECT
        l.id,
        l.full_name,
        l.email,
        l.phone,
        l.whatsapp_number,
        l.created_at,
        u.name AS agent_name
      FROM public.leads l
      LEFT JOIN public.system_users u ON u.id = l.agent_id
      WHERE ${where.join(" AND ")}
      ORDER BY l.created_at DESC
      LIMIT 50`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      message: "Leads fetched successfully",
      data: { leads },
    });
  } catch (error: any) {
    console.error("searchLeadsForDashboard error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// 9. UNIFIED API: GET AGENT TASKS DASHBOARD
// POST /api/v1/managelead/leads/task/agent/dashboard
// ==========================================
export const getAgentTasksDashboard = async (req: Request, res: Response) => {
  try {
    const auth = (req as any)?.user;
    const agentId = auth?.system_user_id || auth?.id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const now = DateTime.now().setZone("Asia/Kolkata");
    const todayStart = now.startOf("day");
    const todayEnd = now.endOf("day");

    const nowUtcISO = now.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayStartUTC = todayStart.toUTC().toISO({ suppressMilliseconds: true })!;
    const todayEndUTC = todayEnd.toUTC().toISO({ suppressMilliseconds: true })!;

    const [cardCounts]: any[] = await db.sequelize.query(
      `SELECT
          COUNT(CASE WHEN t.start_at >= :start_utc AND t.start_at <= :end_utc 
                     AND LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled') THEN 1 END)::int AS pending_today,
          COUNT(CASE WHEN LOWER(t.status::text) IN ('done', 'completed', 'complete') 
                     AND ((t.start_at >= :start_utc AND t.start_at <= :end_utc) OR (t.updated_at >= :start_utc AND t.updated_at <= :end_utc)) THEN 1 END)::int AS completed_today,
          COUNT(CASE WHEN LOWER(t.status::text) IN ('cancelled', 'canceled') 
                     AND t.start_at >= :start_utc AND t.start_at <= :end_utc THEN 1 END)::int AS cancelled_today,
          COUNT(CASE WHEN LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled') 
                     AND COALESCE(t.end_at, t.start_at) < :now_utc THEN 1 END)::int AS overdue,
          COUNT(CASE WHEN LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled') 
                     AND t.start_at >= :now_utc THEN 1 END)::int AS upcoming
       FROM public.lead_tasks t
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT)))`,
      {
        replacements: { agentId, start_utc: todayStartUTC, end_utc: todayEndUTC, now_utc: nowUtcISO },
        type: QueryTypes.SELECT,
      }
    );

    const byTypeRows: any[] = await db.sequelize.query(
      `SELECT t.task_type, COUNT(t.id)::int AS count
       FROM public.lead_tasks t
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT)))
         AND t.start_at >= :start_utc AND t.start_at <= :end_utc
         AND LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled')
       GROUP BY t.task_type`,
      {
        replacements: { agentId, start_utc: todayStartUTC, end_utc: todayEndUTC },
        type: QueryTypes.SELECT,
      }
    );

    const upcomingRows: any[] = await db.sequelize.query(
      `SELECT t.id, t.task_type, t.subject, t.status, t.start_at, t.end_at, l.full_name, l.id AS lead_id 
       FROM public.lead_tasks t 
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL 
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT))) 
         AND t.start_at >= :now_utc 
         AND LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled') 
       ORDER BY t.start_at ASC 
       LIMIT 50`,
      { replacements: { agentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
    );

    const overdueRows: any[] = await db.sequelize.query(
      `SELECT t.id, t.task_type, t.subject, t.status, t.start_at, t.end_at, l.full_name, l.id AS lead_id 
       FROM public.lead_tasks t 
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL 
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT))) 
         AND COALESCE(t.end_at, t.start_at) < :now_utc 
         AND LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled') 
       ORDER BY COALESCE(t.end_at, t.start_at) DESC 
       LIMIT 50`,
      { replacements: { agentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
    );

    const doneTodayRows: any[] = await db.sequelize.query(
      `SELECT t.id, t.task_type, t.subject, 'done'::text AS status, t.start_at, t.end_at, l.full_name, l.id AS lead_id 
       FROM public.lead_tasks t 
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL 
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT))) 
         AND LOWER(t.status::text) IN ('done', 'completed', 'complete') 
         AND ((t.start_at >= :start_utc AND t.start_at <= :end_utc) OR (t.updated_at >= :start_utc AND t.updated_at <= :end_utc)) 
       ORDER BY COALESCE(t.updated_at, t.start_at) DESC 
       LIMIT 50`,
      { replacements: { agentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
    );

    const pendingTodayRows: any[] = await db.sequelize.query(
      `SELECT t.id, t.task_type, t.subject, 'pending'::text AS status, t.start_at, t.end_at, l.full_name, l.id AS lead_id 
       FROM public.lead_tasks t 
       JOIN public.leads l ON CAST(l.id AS TEXT) = CAST(t.lead_id AS TEXT) AND l.deleted_at IS NULL 
       WHERE t.deleted_at IS NULL 
         AND (CAST(t.assigned_agent_id AS TEXT) = CAST(:agentId AS TEXT) OR (t.assigned_agent_id IS NULL AND CAST(l.agent_id AS TEXT) = CAST(:agentId AS TEXT))) 
         AND t.start_at >= :start_utc AND t.start_at <= :end_utc 
         AND LOWER(t.status::text) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled') 
       ORDER BY t.start_at ASC 
       LIMIT 50`,
      { replacements: { agentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
    );

    const mapList = (rows: any[]) =>
      rows.map((r) => ({
        id: r.id,
        lead_id: r.lead_id,
        type: r.task_type,
        subject: r.subject || "Follow-up",
        status: r.status || "pending",
        start_at: formatDateTime(r.start_at),
        end_at: formatDateTime(r.end_at),
        due_date: formatDate(r.end_at ?? r.start_at),
        lead_name: r.full_name,
      }));

    const pendingToday = Number(cardCounts?.pending_today ?? 0);
    const completedToday = Number(cardCounts?.completed_today ?? 0);
    const cancelledToday = Number(cardCounts?.cancelled_today ?? 0);

    return res.status(200).json({
      success: true,
      message: "Agent tasks dashboard fetched successfully",
      data: {
        cards: {
          today: {
            total: pendingToday + completedToday,
            pending: pendingToday,
            completed: completedToday,
            cancelled: cancelledToday,
            today: todayStart.toFormat("MM-dd-yyyy"),
          },
          overdue: Number(cardCounts?.overdue ?? 0),
          upcoming: Number(cardCounts?.upcoming ?? 0),
          today_by_type: byTypeRows.map((x: any) => ({ type: x.task_type, count: x.count })),
        },
        lists: {
          upcoming: mapList(upcomingRows),
          overdue: mapList(overdueRows),
          done_today: mapList(doneTodayRows),
          pending_today: mapList(pendingTodayRows),
        },
      },
    });
  } catch (error: any) {
    console.error("getAgentTasksDashboard error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ==========================================
// DEFAULT EXPORT
// ==========================================
export default {
  getAssignedLeadsCount,
  getConvertedDealsCount,
  getTotalOrdersCount,
  getSalesRevenue,
  getTasksTodayCount,
  getOverdueTasksCount,
  getAssignedLeadsQueue,
  searchLeadsForDashboard,
  getAgentTasksDashboard,
};