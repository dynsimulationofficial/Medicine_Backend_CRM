import { Request, Response } from "express";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";
import { QueryTypes } from "sequelize";
import * as Yup from "yup";
import { DateTime } from "luxon";

export class ReportController extends BaseController {
  private db_services: DBServices;

  constructor() {
    super();
    this.db_services = new DBServices();
  }

  /**
   * POST /api/v1/managelead/reports/kpi
   * Aggregates KPI metrics, order status distribution, payment breakdown,
   * lead sources, and agent performance for given date range and filters.
   */
  public getKpiAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      const schema = Yup.object({
        startDate: Yup.string().nullable().optional(),
        endDate: Yup.string().nullable().optional(),
        agent_id: Yup.string().uuid().nullable().optional(),
        order_status: Yup.string().nullable().optional(),
      });

      const body = await schema.validate(req.body, { abortEarly: false });
      const { startDate, endDate, agent_id, order_status } = body;

      // Determine date boundaries in UTC (default: start of current month to now)
      const now = DateTime.now().setZone("Asia/Kolkata");
      const fromDate = startDate
        ? DateTime.fromISO(startDate, { zone: "Asia/Kolkata" }).startOf("day").toUTC().toISO()
        : now.startOf("month").toUTC().toISO();
      const toDate = endDate
        ? DateTime.fromISO(endDate, { zone: "Asia/Kolkata" }).endOf("day").toUTC().toISO()
        : now.endOf("day").toUTC().toISO();

      const replacements: Record<string, any> = {
        fromDate,
        toDate,
      };

      let agentFilterLeads = "";
      let agentFilterOrders = "";
      if (agent_id) {
        agentFilterLeads = " AND l.agent_id = :agent_id";
        agentFilterOrders = " AND o.agent_id = :agent_id";
        replacements.agent_id = agent_id;
      }

      let statusFilterOrders = "";
      if (order_status && order_status !== "All") {
        statusFilterOrders = " AND o.order_status = :order_status";
        replacements.order_status = order_status;
      }

      // 1. Leads Summary & Conversion Metrics
      const [leadsStats]: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            COUNT(l.id) AS total_leads,
            COUNT(CASE WHEN l.lead_status = 'Converted' OR ord_conv.has_order = 1 THEN 1 END) AS converted_leads,
            COUNT(CASE WHEN l.agent_id IS NULL THEN 1 END) AS unassigned_leads,
            COUNT(CASE WHEN l.agent_id IS NOT NULL THEN 1 END) AS assigned_leads
         FROM public.leads l
         LEFT JOIN (
            SELECT DISTINCT lead_id, 1 AS has_order
            FROM public.lead_orders
            WHERE deleted_at IS NULL
              AND order_status IN ('Confirmed', 'Shipped', 'Delivered')
         ) ord_conv ON ord_conv.lead_id = l.id
         WHERE l.deleted_at IS NULL
           AND l.created_at >= :fromDate AND l.created_at <= :toDate
           ${agentFilterLeads}`,
        { replacements, type: QueryTypes.SELECT }
      );

      const totalLeads = Number(leadsStats?.total_leads || 0);
      const convertedLeads = Number(leadsStats?.converted_leads || 0);
      const unassignedLeads = Number(leadsStats?.unassigned_leads || 0);
      const assignedLeads = Number(leadsStats?.assigned_leads || 0);
      const conversionRate = totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0;

      // 2. Orders & Sales Summary Metrics (3 Currencies: INR, USD, GBP)
      const [ordersStats]: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            COUNT(o.id) AS total_orders,
            COALESCE(SUM(CASE WHEN o.order_status != 'Cancelled' THEN o.grand_total ELSE 0 END), 0) AS total_revenue,
            COALESCE(SUM(CASE WHEN o.order_status != 'Cancelled' AND (l.phone LIKE '+44%' OR l.phone LIKE '44%' OR (l.phone NOT LIKE '+1%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%UK%' OR l.country ILIKE '%United Kingdom%'))) THEN o.grand_total ELSE 0 END), 0) AS revenue_gbp,
            COALESCE(SUM(CASE WHEN o.order_status != 'Cancelled' AND (l.phone LIKE '+1%' OR (l.phone LIKE '1%' AND LENGTH(l.phone) >= 11) OR (l.phone NOT LIKE '+44%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%USA%' OR l.country ILIKE '%United States%'))) THEN o.grand_total ELSE 0 END), 0) AS revenue_usd,
            COALESCE(SUM(CASE WHEN o.order_status != 'Cancelled' AND NOT (l.phone LIKE '+44%' OR l.phone LIKE '44%' OR (l.phone NOT LIKE '+1%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%UK%' OR l.country ILIKE '%United Kingdom%'))) AND NOT (l.phone LIKE '+1%' OR (l.phone LIKE '1%' AND LENGTH(l.phone) >= 11) OR (l.phone NOT LIKE '+44%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%USA%' OR l.country ILIKE '%United States%'))) THEN o.grand_total ELSE 0 END), 0) AS revenue_inr,
            COUNT(CASE WHEN o.order_status = 'Delivered' THEN 1 END) AS delivered_orders,
            COALESCE(SUM(CASE WHEN o.order_status = 'Delivered' THEN o.grand_total ELSE 0 END), 0) AS delivered_revenue,
            COUNT(CASE WHEN o.order_status = 'Pending' THEN 1 END) AS pending_orders,
            COUNT(CASE WHEN o.order_status = 'Shipped' THEN 1 END) AS shipped_orders,
            COUNT(CASE WHEN o.order_status = 'Confirmed' THEN 1 END) AS confirmed_orders,
            COUNT(CASE WHEN o.order_status = 'Cancelled' THEN 1 END) AS cancelled_orders,
            COUNT(CASE WHEN o.payment_status = 'Paid' THEN 1 END) AS paid_orders,
            COUNT(CASE WHEN o.payment_status = 'Pending' THEN 1 END) AS unpaid_orders
         FROM public.lead_orders o
         JOIN public.leads l ON l.id = o.lead_id
         WHERE o.deleted_at IS NULL
           AND o.created_at >= :fromDate AND o.created_at <= :toDate
           ${agentFilterOrders}
           ${statusFilterOrders}`,
        { replacements, type: QueryTypes.SELECT }
      );

      const totalOrders = Number(ordersStats?.total_orders || 0);
      const totalRevenue = Number(ordersStats?.total_revenue || 0);
      const revenueInr = Number(ordersStats?.revenue_inr || 0);
      const revenueUsd = Number(ordersStats?.revenue_usd || 0);
      const revenueGbp = Number(ordersStats?.revenue_gbp || 0);
      const deliveredOrders = Number(ordersStats?.delivered_orders || 0);
      const deliveredRevenue = Number(ordersStats?.delivered_revenue || 0);
      const pendingOrders = Number(ordersStats?.pending_orders || 0);
      const shippedOrders = Number(ordersStats?.shipped_orders || 0);
      const confirmedOrders = Number(ordersStats?.confirmed_orders || 0);
      const cancelledOrders = Number(ordersStats?.cancelled_orders || 0);
      const deliverySuccessRate = totalOrders > 0 ? Number(((deliveredOrders / totalOrders) * 100).toFixed(1)) : 0;
      const avgOrderValue = totalOrders > 0 ? Number((totalRevenue / (totalOrders - cancelledOrders || 1)).toFixed(2)) : 0;

      // 3. Order Status Breakdown
      const statusBreakdown: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            COALESCE(o.order_status, 'Pending') AS status,
            COUNT(o.id) AS count,
            COALESCE(SUM(o.grand_total), 0) AS total_amount
         FROM public.lead_orders o
         WHERE o.deleted_at IS NULL
           AND o.created_at >= :fromDate AND o.created_at <= :toDate
           ${agentFilterOrders}
         GROUP BY o.order_status
         ORDER BY count DESC`,
        { replacements, type: QueryTypes.SELECT }
      );

      const formattedStatusBreakdown = statusBreakdown.map((item) => ({
        status: item.status,
        count: Number(item.count),
        total_amount: Number(item.total_amount),
        percentage: totalOrders > 0 ? Number(((Number(item.count) / totalOrders) * 100).toFixed(1)) : 0,
      }));

      // 4. Payment Modes Breakdown
      const paymentBreakdown: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            COALESCE(o.payment_mode, 'COD') AS payment_mode,
            COUNT(o.id) AS count,
            COALESCE(SUM(o.grand_total), 0) AS total_amount
         FROM public.lead_orders o
         WHERE o.deleted_at IS NULL
           AND o.created_at >= :fromDate AND o.created_at <= :toDate
           ${agentFilterOrders}
         GROUP BY o.payment_mode
         ORDER BY count DESC`,
        { replacements, type: QueryTypes.SELECT }
      );

      const formattedPaymentBreakdown = paymentBreakdown.map((item) => ({
        payment_mode: item.payment_mode,
        count: Number(item.count),
        total_amount: Number(item.total_amount),
        percentage: totalOrders > 0 ? Number(((Number(item.count) / totalOrders) * 100).toFixed(1)) : 0,
      }));

      // 5. Lead Source & Campaign Percentage Distribution Breakdown
      const sourceCampaignRows: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            COALESCE(ls.id::text, 'unspecified') AS source_id,
            COALESCE(ls.name, 'Direct / Unknown') AS source_name,
            COALESCE(c.id::text, 'no_campaign') AS campaign_id,
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
           ${agentFilterLeads}
         GROUP BY ls.id, ls.name, c.id, c.name
         ORDER BY ls.name ASC, leads_count DESC`,
        { replacements, type: QueryTypes.SELECT }
      );

      // Group rows by Lead Source
      const sourceMap: Record<string, {
        source_id: string;
        source_name: string;
        leads_count: number;
        converted_count: number;
        campaigns: Array<{
          campaign_id: string;
          campaign_name: string;
          leads_count: number;
          converted_count: number;
        }>;
      }> = {};

      for (const row of sourceCampaignRows) {
        const sKey = row.source_name;
        if (!sourceMap[sKey]) {
          sourceMap[sKey] = {
            source_id: row.source_id,
            source_name: row.source_name,
            leads_count: 0,
            converted_count: 0,
            campaigns: [],
          };
        }
        const lCount = Number(row.leads_count || 0);
        const cCount = Number(row.converted_count || 0);
        sourceMap[sKey].leads_count += lCount;
        sourceMap[sKey].converted_count += cCount;
        sourceMap[sKey].campaigns.push({
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name,
          leads_count: lCount,
          converted_count: cCount,
        });
      }

      // Format Source & Campaign Distribution with Percentages
      const formattedSourceBreakdown = Object.values(sourceMap)
        .map((src) => {
          const sLeads = src.leads_count;
          const sConverted = src.converted_count;
          const sourcePercentage = totalLeads > 0 ? Number(((sLeads / totalLeads) * 100).toFixed(1)) : 0;
          const sourceConvRate = sLeads > 0 ? Number(((sConverted / sLeads) * 100).toFixed(1)) : 0;

          const formattedCampaigns = src.campaigns
            .map((cmp) => {
              const cmpLeads = cmp.leads_count;
              const cmpConverted = cmp.converted_count;
              const cmpSourcePct = sLeads > 0 ? Number(((cmpLeads / sLeads) * 100).toFixed(1)) : 0;
              const cmpTotalPct = totalLeads > 0 ? Number(((cmpLeads / totalLeads) * 100).toFixed(1)) : 0;
              const cmpConvRate = cmpLeads > 0 ? Number(((cmpConverted / cmpLeads) * 100).toFixed(1)) : 0;

              return {
                campaign_id: cmp.campaign_id,
                campaign_name: cmp.campaign_name,
                leads_count: cmpLeads,
                converted_count: cmpConverted,
                source_percentage: cmpSourcePct, // % within this source
                total_percentage: cmpTotalPct,   // % of all CRM leads
                conversion_rate: cmpConvRate,
              };
            })
            .sort((a, b) => b.leads_count - a.leads_count);

          return {
            source_id: src.source_id,
            source_name: src.source_name,
            leads_count: sLeads,
            converted_count: sConverted,
            percentage: sourcePercentage, // % of all CRM leads
            conversion_rate: sourceConvRate,
            campaigns: formattedCampaigns,
          };
        })
        .sort((a, b) => b.leads_count - a.leads_count);

      // Generate Direct Campaign Ranking List sorted by highest Leads Count & %
      const allCampaignsFlat: Array<{
        campaign_id: string;
        campaign_name: string;
        source_name: string;
        leads_count: number;
        converted_count: number;
        percentage: number;
        conversion_rate: number;
      }> = [];

      for (const src of formattedSourceBreakdown) {
        for (const cmp of src.campaigns) {
          allCampaignsFlat.push({
            campaign_id: cmp.campaign_id,
            campaign_name: cmp.campaign_name,
            source_name: src.source_name,
            leads_count: cmp.leads_count,
            converted_count: cmp.converted_count,
            percentage: cmp.total_percentage, // % of all CRM leads
            conversion_rate: cmp.conversion_rate,
          });
        }
      }

      const campaignRanking = allCampaignsFlat
        .sort((a, b) => b.leads_count - a.leads_count)
        .map((item, idx) => ({
          rank: idx + 1,
          ...item,
        }));

      // 6. Agent Performance Leaderboard
      const agentLeaderboard: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            u.id AS agent_id,
            u.name AS agent_name,
            u.email AS agent_email,
            COALESCE(lead_agg.assigned_count, 0) AS assigned_leads,
            COALESCE(lead_agg.converted_count, 0) AS converted_leads,
            COALESCE(ord_agg.total_orders, 0) AS total_orders,
            COALESCE(ord_agg.total_revenue, 0) AS total_revenue,
            COALESCE(ord_agg.revenue_inr, 0) AS revenue_inr,
            COALESCE(ord_agg.revenue_usd, 0) AS revenue_usd,
            COALESCE(ord_agg.revenue_gbp, 0) AS revenue_gbp,
            COALESCE(ord_agg.delivered_orders, 0) AS delivered_orders
         FROM public.system_users u
         JOIN public.user_role ur ON ur.system_user_id = u.id
         JOIN public.roles r ON r.id = ur.role_id AND LOWER(r.name) = 'agent'
         LEFT JOIN (
            SELECT
                l.agent_id,
                COUNT(l.id) AS assigned_count,
                COUNT(CASE WHEN l.lead_status = 'Converted' OR conv.has_order = 1 THEN 1 END) AS converted_count
            FROM public.leads l
            LEFT JOIN (
                SELECT DISTINCT lead_id, 1 AS has_order
                FROM public.lead_orders
                WHERE deleted_at IS NULL
                  AND order_status IN ('Confirmed', 'Shipped', 'Delivered')
            ) conv ON conv.lead_id = l.id
            WHERE l.deleted_at IS NULL
              AND l.created_at >= :fromDate AND l.created_at <= :toDate
            GROUP BY l.agent_id
         ) lead_agg ON lead_agg.agent_id = u.id
         LEFT JOIN (
            SELECT
                o.agent_id,
                COUNT(o.id) AS total_orders,
                SUM(CASE WHEN o.order_status != 'Cancelled' THEN o.grand_total ELSE 0 END) AS total_revenue,
                COALESCE(SUM(CASE WHEN o.order_status != 'Cancelled' AND (l.phone LIKE '+44%' OR l.phone LIKE '44%' OR (l.phone NOT LIKE '+1%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%UK%' OR l.country ILIKE '%United Kingdom%'))) THEN o.grand_total ELSE 0 END), 0) AS revenue_gbp,
                COALESCE(SUM(CASE WHEN o.order_status != 'Cancelled' AND (l.phone LIKE '+1%' OR (l.phone LIKE '1%' AND LENGTH(l.phone) >= 11) OR (l.phone NOT LIKE '+44%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%USA%' OR l.country ILIKE '%United States%'))) THEN o.grand_total ELSE 0 END), 0) AS revenue_usd,
                COALESCE(SUM(CASE WHEN o.order_status != 'Cancelled' AND NOT (l.phone LIKE '+44%' OR l.phone LIKE '44%' OR (l.phone NOT LIKE '+1%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%UK%' OR l.country ILIKE '%United Kingdom%'))) AND NOT (l.phone LIKE '+1%' OR (l.phone LIKE '1%' AND LENGTH(l.phone) >= 11) OR (l.phone NOT LIKE '+44%' AND l.phone NOT LIKE '+91%' AND (l.country ILIKE '%USA%' OR l.country ILIKE '%United States%'))) THEN o.grand_total ELSE 0 END), 0) AS revenue_inr,
                COUNT(CASE WHEN o.order_status = 'Delivered' THEN 1 END) AS delivered_orders
            FROM public.lead_orders o
            JOIN public.leads l ON l.id = o.lead_id
            WHERE o.deleted_at IS NULL
              AND o.created_at >= :fromDate AND o.created_at <= :toDate
            GROUP BY o.agent_id
         ) ord_agg ON ord_agg.agent_id = u.id
         WHERE u.deleted_at IS NULL
         ORDER BY total_revenue DESC, total_orders DESC, assigned_leads DESC`,
        { replacements, type: QueryTypes.SELECT }
      );

      const formattedLeaderboard = agentLeaderboard.map((item, index) => {
        const aLeads = Number(item.assigned_leads);
        const cLeads = Number(item.converted_leads);
        const convRate = aLeads > 0 ? Number(((cLeads / aLeads) * 100).toFixed(1)) : 0;
        return {
          rank: index + 1,
          agent_id: item.agent_id,
          agent_name: item.agent_name || "Unknown Agent",
          agent_email: item.agent_email,
          assigned_leads: aLeads,
          converted_leads: cLeads,
          total_orders: Number(item.total_orders),
          total_revenue: Number(item.total_revenue),
          revenue_inr: Number(item.revenue_inr || 0),
          revenue_usd: Number(item.revenue_usd || 0),
          revenue_gbp: Number(item.revenue_gbp || 0),
          delivered_orders: Number(item.delivered_orders),
          conversion_rate: convRate,
        };
      });

      // 7. Recent Orders in selected period
      const recentOrders: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT
            o.id,
            o.order_number,
            o.grand_total,
            o.total_items,
            o.order_status,
            o.payment_status,
            o.payment_mode,
            o.courier_name,
            o.tracking_number,
            o.created_at,
            CASE
                WHEN l.phone LIKE '+44%' OR l.phone LIKE '44%' OR l.country ILIKE '%UK%' OR l.country ILIKE '%United Kingdom%' THEN 'GBP'
                WHEN l.phone LIKE '+1%' OR (l.phone LIKE '1%' AND LENGTH(l.phone) >= 11) OR l.country ILIKE '%USA%' OR l.country ILIKE '%United States%' THEN 'USD'
                ELSE 'INR'
            END AS currency,
            l.country AS customer_country,
            l.full_name AS customer_name,
            l.phone AS customer_phone,
            u.name AS agent_name
         FROM public.lead_orders o
         JOIN public.leads l ON l.id = o.lead_id
         LEFT JOIN public.system_users u ON u.id = o.agent_id
         WHERE o.deleted_at IS NULL
           AND o.created_at >= :fromDate AND o.created_at <= :toDate
           ${agentFilterOrders}
           ${statusFilterOrders}
         ORDER BY o.created_at DESC
         LIMIT 20`,
        { replacements, type: QueryTypes.SELECT }
      );

      const data = {
        date_range: {
          start_date: startDate || now.startOf("month").toFormat("yyyy-MM-dd"),
          end_date: endDate || now.toFormat("yyyy-MM-dd"),
        },
        summary: {
          total_leads: totalLeads,
          converted_leads: convertedLeads,
          unassigned_leads: unassignedLeads,
          assigned_leads: assignedLeads,
          conversion_rate: conversionRate,
          total_orders: totalOrders,
          total_revenue: totalRevenue,
          revenue_inr: revenueInr,
          revenue_usd: revenueUsd,
          revenue_gbp: revenueGbp,
          delivered_orders: deliveredOrders,
          delivered_revenue: deliveredRevenue,
          pending_orders: pendingOrders,
          shipped_orders: shippedOrders,
          confirmed_orders: confirmedOrders,
          cancelled_orders: cancelledOrders,
          delivery_success_rate: deliverySuccessRate,
          avg_order_value: avgOrderValue,
        },
        status_breakdown: formattedStatusBreakdown,
        payment_breakdown: formattedPaymentBreakdown,
        source_breakdown: formattedSourceBreakdown,
        campaign_ranking: campaignRanking,
        agent_leaderboard: formattedLeaderboard,
        recent_orders: recentOrders,
      };

      return this.sendSuccess(res, data, "KPI analytics retrieved successfully");
    } catch (err: any) {
      console.error("getKpiAnalytics error:", err);
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      return this.sendError(res, {}, err?.message || "Internal server error", 500);
    }
  };
}

export default new ReportController();
