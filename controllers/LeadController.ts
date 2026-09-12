import { Request, Response } from "express";
import * as yup from "yup";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";
import * as XLSX from "xlsx";

// ==================== VALIDATION SCHEMAS ====================
const emptyStringToNull = (val: any) => (val === "" ? null : val);

const leadSchema = yup.object({
  full_name: yup.string().required("Full name is required").trim(),
  phone: yup.string().required("Phone is required").trim(),
  email: yup.string().email("Invalid email").required("Email is required").trim(),
  whatsapp_number: yup.string().transform(emptyStringToNull).nullable().optional(),
  address_line1: yup.string().transform(emptyStringToNull).nullable().optional(),
  address_line2: yup.string().transform(emptyStringToNull).nullable().optional(),
  city: yup.string().transform(emptyStringToNull).nullable().optional(),
  state: yup.string().transform(emptyStringToNull).nullable().optional(),
  postal_code: yup.string().transform(emptyStringToNull).nullable().optional(),
  country: yup.string().transform(emptyStringToNull).nullable().optional(),
  lead_score: yup.number().integer().nullable().optional(),
  lead_quality: yup.string().transform(emptyStringToNull).nullable().optional(),
  best_time_to_call: yup.string().transform(emptyStringToNull).nullable().optional(),
  agent_id: yup.string().transform(emptyStringToNull).uuid("agent_id must be a valid UUID").nullable().optional(),
  lead_source_id: yup.string().transform(emptyStringToNull).uuid("lead_source_id must be a valid UUID").nullable().optional(),
  campaign_id: yup.string().transform(emptyStringToNull).uuid("campaign_id must be a valid UUID").nullable().optional(),
  currency: yup.string().transform(emptyStringToNull).nullable().optional(),
  lead_status: yup.string().transform(emptyStringToNull).nullable().optional(),
  note: yup.string().transform(emptyStringToNull).nullable().optional(),
});

const updateLeadSchema = yup.object({
  full_name: yup.string().trim().max(120).optional(),
  phone: yup.string().trim().max(30).optional(),
  email: yup.string().email("Invalid email format").trim().max(255).optional(),
  whatsapp_number: yup.string().transform(emptyStringToNull).nullable().optional(),
  address_line1: yup.string().transform(emptyStringToNull).nullable().optional(),
  address_line2: yup.string().transform(emptyStringToNull).nullable().optional(),
  city: yup.string().transform(emptyStringToNull).nullable().optional(),
  state: yup.string().transform(emptyStringToNull).nullable().optional(),
  postal_code: yup.string().transform(emptyStringToNull).nullable().optional(),
  country: yup.string().transform(emptyStringToNull).nullable().optional(),
  lead_score: yup.number().integer().nullable().optional(),
  lead_quality: yup.string().transform(emptyStringToNull).nullable().optional(),
  best_time_to_call: yup.string().transform(emptyStringToNull).nullable().optional(),
  agent_id: yup.string().transform(emptyStringToNull).uuid("agent_id must be a valid UUID").nullable().optional(),
  lead_source_id: yup.string().transform(emptyStringToNull).uuid("lead_source_id must be a valid UUID").nullable().optional(),
  campaign_id: yup.string().transform(emptyStringToNull).uuid("campaign_id must be a valid UUID").nullable().optional(),
  currency: yup.string().transform(emptyStringToNull).nullable().optional(),
  lead_status: yup.string().transform(emptyStringToNull).nullable().optional(),
  note: yup.string().transform(emptyStringToNull).nullable().optional(),
});

const checkIsAdmin = async (userId: string | null): Promise<boolean> => {
  if (!userId) return false;
  try {
    const rows: any[] = await db.sequelize.query(
      `SELECT r.name FROM public.user_role ur JOIN public.roles r ON ur.role_id = r.id WHERE ur.system_user_id = :userId LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    return rows.length > 0 && rows[0].name?.toLowerCase() === "admin";
  } catch {
    return false;
  }
};

export const detectCountryAndCurrency = (
  phone?: string | null,
  country?: string | null,
  currency?: string | null
): { country: string; currency: string } => {
  let detectedCountry = country ? country.trim() : null;
  let detectedCurrency = currency ? currency.trim().toUpperCase() : null;

  if (phone) {
    const cleanP = phone.replace(/[\s\-\(\)]/g, "");
    if (cleanP.startsWith("+91") || cleanP.startsWith("0091") || (cleanP.startsWith("91") && cleanP.length === 12)) {
      if (!detectedCountry) detectedCountry = "India";
      if (!detectedCurrency) detectedCurrency = "INR";
    } else if (cleanP.startsWith("+44") || cleanP.startsWith("0044") || (cleanP.startsWith("44") && cleanP.length >= 12)) {
      if (!detectedCountry) detectedCountry = "UK";
      if (!detectedCurrency) detectedCurrency = "GBP";
    } else if (cleanP.startsWith("+1") || cleanP.startsWith("001") || (cleanP.startsWith("1") && cleanP.length === 11) || cleanP.length === 10) {
      if (!detectedCountry) detectedCountry = "USA";
      if (!detectedCurrency) detectedCurrency = "USD";
    }
  }

  if (detectedCountry && !detectedCurrency) {
    const cLow = detectedCountry.toLowerCase();
    if (cLow === "india" || cLow === "in") detectedCurrency = "INR";
    else if (cLow === "uk" || cLow === "united kingdom" || cLow === "gb") detectedCurrency = "GBP";
    else if (cLow === "usa" || cLow === "us" || cLow === "united states") detectedCurrency = "USD";
  }

  return { country: detectedCountry || "USA", currency: detectedCurrency || "USD" };
};

// ==================== 1. CREATE LEAD ====================
export const createLead = async (req: Request, res: Response) => {
  try {
    const validatedData = await leadSchema.validate(req.body, { abortEarly: false });
    const emailNorm = validatedData.email.toLowerCase().trim();
    const phoneNorm = validatedData.phone.replace(/(?!^\+)[^0-9]/g, "");

    // Check duplicate phone or email
    const dupRows: any[] = await db.sequelize.query(
      `SELECT id, email, phone FROM public.leads
       WHERE deleted_at IS NULL AND (LOWER(email) = :email OR REGEXP_REPLACE(phone, '\\D', '', 'g') = :phone) LIMIT 1`,
      { replacements: { email: emailNorm, phone: phoneNorm }, type: QueryTypes.SELECT }
    );

    if (dupRows.length > 0) {
      return res.status(409).json({ success: false, message: "A lead with this email or phone already exists" });
    }

    const id = uuidv4();
    const now = new Date();

    // Auto-detect country and currency from phone if not explicitly provided
    const { country: detectedCountry, currency: detectedCurrency } = detectCountryAndCurrency(
      validatedData.phone,
      validatedData.country,
      validatedData.currency
    );

    const query = `
      INSERT INTO public.leads (
        id, full_name, email, phone, whatsapp_number,
        address_line1, address_line2, city, state, postal_code, country,
        lead_score, lead_quality, best_time_to_call, agent_id, lead_source_id, campaign_id,
        currency, lead_status, note, created_at, updated_at
      ) VALUES (
        :id, :full_name, :email, :phone, :whatsapp_number,
        :address_line1, :address_line2, :city, :state, :postal_code, :country,
        COALESCE(:lead_score, 0), :lead_quality, :best_time_to_call, :agent_id, :lead_source_id, :campaign_id,
        COALESCE(:currency, 'USD'), COALESCE(:lead_status, 'New'), :note, :created_at, :updated_at
      )
      RETURNING *
    `;

    const result: any[] = await db.sequelize.query(query, {
      replacements: {
        id,
        full_name: validatedData.full_name,
        email: emailNorm,
        phone: validatedData.phone,
        whatsapp_number: validatedData.whatsapp_number || null,
        address_line1: validatedData.address_line1 || null,
        address_line2: validatedData.address_line2 || null,
        city: validatedData.city || null,
        state: validatedData.state || null,
        postal_code: validatedData.postal_code || null,
        country: detectedCountry,
        lead_score: validatedData.lead_score || 0,
        lead_quality: validatedData.lead_quality || null,
        best_time_to_call: validatedData.best_time_to_call || null,
        agent_id: validatedData.agent_id || null,
        lead_source_id: validatedData.lead_source_id || null,
        campaign_id: validatedData.campaign_id || null,
        currency: detectedCurrency || "USD",
        lead_status: validatedData.lead_status || "New",
        note: validatedData.note || null,
        created_at: now,
        updated_at: now,
      },
      type: QueryTypes.SELECT,
    });

    return res.status(201).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 2. GET UNASSIGNED LEADS ====================
export const getUnassignedLeads = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit || req.query.pageSize) || 500;
    const offset = (page - 1) * limit;

    const countResult: any[] = await db.sequelize.query(
      `SELECT COUNT(*) as total FROM public.leads WHERE deleted_at IS NULL AND agent_id IS NULL`,
      { type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0");

    const dataResult: any[] = await db.sequelize.query(
      `SELECT
         l.*,
         ls.name AS lead_source_name,
         camp.name AS campaign_name
       FROM public.leads l
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns camp ON camp.id = l.campaign_id
       WHERE l.deleted_at IS NULL AND l.agent_id IS NULL
       ORDER BY l.created_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: { limit, offset }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      data: dataResult,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 3. GET ASSIGNED LEADS ====================
export const getAssignedLeads = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit || req.query.pageSize) || 500;
    const offset = (page - 1) * limit;

    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;
    const userIsAdmin = await checkIsAdmin(authUserId);
    const agentFilter = (req.query.agent_id as string) || (!userIsAdmin && authUserId ? authUserId : null);

    const repl: Record<string, any> = { limit, offset };
    let whereClause = "WHERE l.deleted_at IS NULL AND l.agent_id IS NOT NULL";
    if (agentFilter) {
      whereClause += " AND l.agent_id = :agentFilter";
      repl.agentFilter = agentFilter;
    }

    const countResult: any[] = await db.sequelize.query(
      `SELECT COUNT(*) as total FROM public.leads l ${whereClause}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0");

    const dataResult: any[] = await db.sequelize.query(
      `SELECT
         l.*,
         su.name AS agent_name,
         ls.name AS lead_source_name,
         camp.name AS campaign_name,
         COALESCE(ord.order_count, 0)::int AS order_count,
         COALESCE(ord.total_order_amount, 0)::numeric AS total_order_amount,
         ord.latest_order_status,
         ord.latest_order_number
       FROM public.leads l
       LEFT JOIN public.system_users su ON su.id = l.agent_id
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns camp ON camp.id = l.campaign_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(o.id)::int AS order_count,
           COALESCE(SUM(o.grand_total), 0)::numeric AS total_order_amount,
           (ARRAY_AGG(o.order_status ORDER BY o.created_at DESC))[1] AS latest_order_status,
           (ARRAY_AGG(o.order_number ORDER BY o.created_at DESC))[1] AS latest_order_number
         FROM public.lead_orders o
         WHERE o.lead_id = l.id AND o.deleted_at IS NULL
       ) ord ON true
       ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      data: dataResult,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 4. GET SINGLE LEAD ====================
export const getLead = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id || req.params?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `SELECT
         l.*,
         su.name AS agent_name,
         ls.name AS lead_source_name,
         camp.name AS campaign_name,
         COALESCE(ord.order_count, 0)::int AS order_count,
         COALESCE(ord.total_order_amount, 0)::numeric AS total_order_amount,
         ord.latest_order_status,
         ord.latest_order_number
       FROM public.leads l
       LEFT JOIN public.system_users su ON su.id = l.agent_id
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns camp ON camp.id = l.campaign_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(o.id)::int AS order_count,
           COALESCE(SUM(o.grand_total), 0)::numeric AS total_order_amount,
           (ARRAY_AGG(o.order_status ORDER BY o.created_at DESC))[1] AS latest_order_status,
           (ARRAY_AGG(o.order_number ORDER BY o.created_at DESC))[1] AS latest_order_number
         FROM public.lead_orders o
         WHERE o.lead_id = l.id AND o.deleted_at IS NULL
       ) ord ON true
       WHERE l.id = :id AND l.deleted_at IS NULL LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. UPDATE LEAD ====================
export const updateLead = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const validatedData = await updateLeadSchema.validate(req.body, { abortEarly: false });
    const now = new Date();

    const query = `
      UPDATE public.leads SET
        full_name = COALESCE(:full_name, full_name),
        email = COALESCE(:email, email),
        phone = COALESCE(:phone, phone),
        whatsapp_number = COALESCE(:whatsapp_number, whatsapp_number),
        address_line1 = COALESCE(:address_line1, address_line1),
        address_line2 = COALESCE(:address_line2, address_line2),
        city = COALESCE(:city, city),
        state = COALESCE(:state, state),
        postal_code = COALESCE(:postal_code, postal_code),
        country = COALESCE(:country, country),
        lead_score = COALESCE(:lead_score, lead_score),
        lead_quality = COALESCE(:lead_quality, lead_quality),
        best_time_to_call = COALESCE(:best_time_to_call, best_time_to_call),
        agent_id = COALESCE(:agent_id, agent_id),
        lead_source_id = COALESCE(:lead_source_id, lead_source_id),
        campaign_id = COALESCE(:campaign_id, campaign_id),
        currency = COALESCE(:currency, currency),
        lead_status = COALESCE(:lead_status, lead_status),
        note = COALESCE(:note, note),
        updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL
      RETURNING *
    `;

    const result: any[] = await db.sequelize.query(query, {
      replacements: {
        id,
        full_name: validatedData.full_name || null,
        email: validatedData.email ? validatedData.email.toLowerCase().trim() : null,
        phone: validatedData.phone || null,
        whatsapp_number: validatedData.whatsapp_number || null,
        address_line1: validatedData.address_line1 || null,
        address_line2: validatedData.address_line2 || null,
        city: validatedData.city || null,
        state: validatedData.state || null,
        postal_code: validatedData.postal_code || null,
        country: validatedData.country || null,
        lead_score: validatedData.lead_score != null ? validatedData.lead_score : null,
        lead_quality: validatedData.lead_quality || null,
        best_time_to_call: validatedData.best_time_to_call || null,
        agent_id: validatedData.agent_id || null,
        lead_source_id: validatedData.lead_source_id || null,
        campaign_id: validatedData.campaign_id || null,
        currency: validatedData.currency || null,
        lead_status: validatedData.lead_status || null,
        note: validatedData.note || null,
        updated_at: now,
      },
      type: QueryTypes.SELECT,
    });

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 6. DELETE / SOFT DELETE LEADS ====================
export const softDeleteLeads = async (req: Request, res: Response) => {
  try {
    const rawIds =
      req.body.lead_ids ||
      req.body.ids ||
      req.body.lead_id ||
      req.body.id ||
      req.query.lead_id ||
      req.query.id ||
      req.params.id;

    let ids: string[] = [];
    if (Array.isArray(rawIds)) {
      ids = rawIds.map(String).filter(Boolean);
    } else if (typeof rawIds === "string" && rawIds.trim()) {
      ids = rawIds.includes(",")
        ? rawIds.split(",").map((s) => s.trim()).filter(Boolean)
        : [rawIds.trim()];
    }

    if (!ids.length) {
      return res.status(400).json({ success: false, message: "Lead ID(s) required", msg: "Lead ID(s) required" });
    }

    await db.sequelize.query(
      `UPDATE public.leads SET deleted_at = NOW(), updated_at = NOW() WHERE id = ANY(ARRAY[:ids]::uuid[])`,
      { replacements: { ids }, type: QueryTypes.UPDATE }
    );

    return res.status(200).json({
      success: true,
      message: "Lead(s) deleted successfully",
      msg: "Successfully Deleted",
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message, msg: error.message });
  }
};

// ==================== 7. ASSIGN LEAD TO AGENT ====================
export const assignLeadToAgent = async (req: Request, res: Response) => {
  try {
    const { lead_id, agent_id } = req.body;
    if (!lead_id || !agent_id) {
      return res.status(400).json({ success: false, message: "lead_id and agent_id are required" });
    }

    const result: any[] = await db.sequelize.query(
      `UPDATE public.leads SET agent_id = :agent_id, updated_at = NOW() WHERE id = :lead_id AND deleted_at IS NULL RETURNING *`,
      { replacements: { lead_id, agent_id }, type: QueryTypes.SELECT }
    );

    if (!result.length) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // In-App Notification
    try {
      await db.sequelize.query(
        `INSERT INTO public.assigned_lead_notifications (id, recipient_user_id, title, body, data, created_at, updated_at)
         VALUES (:id, :recipient_user_id, :title, :body, :data::jsonb, NOW(), NOW())`,
        {
          replacements: {
            id: uuidv4(),
            recipient_user_id: agent_id,
            title: "New Lead Assigned",
            body: `Lead ${result[0].full_name || result[0].lead_number || ""} has been assigned to you.`,
            data: JSON.stringify({ lead_id }),
          },
          type: QueryTypes.INSERT,
        }
      );
    } catch (notifErr) {
      console.error("Failed to insert assigned lead notification:", notifErr);
    }

    return res.status(200).json({ success: true, data: result[0], message: "Lead assigned successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 8. BULK ASSIGN LEADS ====================
export const bulkAssignLeads = async (req: Request, res: Response) => {
  try {
    const { lead_ids, agent_id } = req.body;
    if (!Array.isArray(lead_ids) || !lead_ids.length || !agent_id) {
      return res.status(400).json({ success: false, message: "lead_ids array and agent_id are required" });
    }

    await db.sequelize.query(
      `UPDATE public.leads SET agent_id = :agent_id, updated_at = NOW() WHERE id = ANY(ARRAY[:lead_ids]::uuid[]) AND deleted_at IS NULL`,
      { replacements: { lead_ids, agent_id }, type: QueryTypes.UPDATE }
    );

    // In-App Notification
    try {
      await db.sequelize.query(
        `INSERT INTO public.assigned_lead_notifications (id, recipient_user_id, title, body, data, created_at, updated_at)
         VALUES (:id, :recipient_user_id, :title, :body, :data::jsonb, NOW(), NOW())`,
        {
          replacements: {
            id: uuidv4(),
            recipient_user_id: agent_id,
            title: "Bulk Leads Assigned",
            body: `${lead_ids.length} new leads have been assigned to you.`,
            data: JSON.stringify({ lead_ids, lead_id: lead_ids[0] }),
          },
          type: QueryTypes.INSERT,
        }
      );
    } catch (notifErr) {
      console.error("Failed to insert bulk assigned lead notification:", notifErr);
    }

    return res.status(200).json({ success: true, message: `${lead_ids.length} leads assigned successfully` });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 9. FILTER / SEARCH ASSIGNED LEADS ====================
export const searchLeads = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.body?.page || req.query?.page) || 1);
    const limit = Number(req.body?.limit || req.body?.pageSize || req.query?.limit || req.query?.pageSize) || 500;
    const offset = (page - 1) * limit;

    const {
      q,
      search,
      full_name,
      email,
      phone,
      lead_number,
      city,
      lead_source_id,
      agent_ids,
      agent_id,
    } = { ...req.query, ...req.body };

    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;
    const userIsAdmin = await checkIsAdmin(authUserId);

    let whereClause = "WHERE l.deleted_at IS NULL AND l.agent_id IS NOT NULL";
    const replacements: any = { limit, offset };

    // Role-based access: agents can ONLY search their own assigned leads
    if (!userIsAdmin && authUserId) {
      whereClause += " AND l.agent_id = :authUserId";
      replacements.authUserId = authUserId;
    } else {
      // Admin filter by agent(s)
      if (Array.isArray(agent_ids) && agent_ids.length > 0) {
        whereClause += " AND l.agent_id = ANY(ARRAY[:agent_ids]::uuid[])";
        replacements.agent_ids = agent_ids;
      } else if (agent_id && String(agent_id).trim()) {
        whereClause += " AND l.agent_id = :agent_id";
        replacements.agent_id = String(agent_id).trim();
      }
    }

    if (full_name && String(full_name).trim()) {
      whereClause += " AND l.full_name ILIKE :full_name";
      replacements.full_name = `%${String(full_name).trim()}%`;
    }
    if (email && String(email).trim()) {
      whereClause += " AND l.email ILIKE :email";
      replacements.email = `%${String(email).trim()}%`;
    }
    if (phone && String(phone).trim()) {
      whereClause += " AND l.phone ILIKE :phone";
      replacements.phone = `%${String(phone).trim()}%`;
    }
    if (lead_number && String(lead_number).trim()) {
      whereClause += " AND l.lead_number ILIKE :lead_number";
      replacements.lead_number = `%${String(lead_number).trim()}%`;
    }
    if (city && String(city).trim()) {
      whereClause += " AND l.city ILIKE :city";
      replacements.city = `%${String(city).trim()}%`;
    }
    if (lead_source_id && String(lead_source_id).trim()) {
      whereClause += " AND l.lead_source_id = :lead_source_id";
      replacements.lead_source_id = String(lead_source_id).trim();
    }

    const generalSearch = (q || search || "").toString().trim();
    if (generalSearch) {
      whereClause += " AND (l.full_name ILIKE :generalSearch OR l.email ILIKE :generalSearch OR l.phone ILIKE :generalSearch OR l.city ILIKE :generalSearch OR l.lead_number ILIKE :generalSearch)";
      replacements.generalSearch = `%${generalSearch}%`;
    }

    const countResult: any[] = await db.sequelize.query(
      `SELECT COUNT(*) as total FROM public.leads l ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0");

    const dataResult: any[] = await db.sequelize.query(
      `SELECT
         l.*,
         su.name AS agent_name,
         ls.name AS lead_source_name,
         camp.name AS campaign_name,
         COALESCE(ord.order_count, 0)::int AS order_count,
         COALESCE(ord.total_order_amount, 0)::numeric AS total_order_amount,
         ord.latest_order_status,
         ord.latest_order_number
       FROM public.leads l
       LEFT JOIN public.system_users su ON su.id = l.agent_id
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns camp ON camp.id = l.campaign_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(o.id)::int AS order_count,
           COALESCE(SUM(o.grand_total), 0)::numeric AS total_order_amount,
           (ARRAY_AGG(o.order_status ORDER BY o.created_at DESC))[1] AS latest_order_status,
           (ARRAY_AGG(o.order_number ORDER BY o.created_at DESC))[1] AS latest_order_number
         FROM public.lead_orders o
         WHERE o.lead_id = l.id AND o.deleted_at IS NULL
       ) ord ON true
       ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      data: dataResult,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== FILTER / SEARCH UNASSIGNED LEADS ====================
export const filterUnassignedLeads = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.body?.page || req.query?.page) || 1);
    const limit = Number(req.body?.limit || req.body?.pageSize || req.query?.limit || req.query?.pageSize) || 500;
    const offset = (page - 1) * limit;

    const {
      q,
      search,
      full_name,
      email,
      phone,
      lead_number,
      city,
      lead_source_id,
    } = { ...req.query, ...req.body };

    let whereClause = "WHERE l.deleted_at IS NULL AND l.agent_id IS NULL";
    const replacements: any = { limit, offset };

    if (full_name && String(full_name).trim()) {
      whereClause += " AND l.full_name ILIKE :full_name";
      replacements.full_name = `%${String(full_name).trim()}%`;
    }
    if (email && String(email).trim()) {
      whereClause += " AND l.email ILIKE :email";
      replacements.email = `%${String(email).trim()}%`;
    }
    if (phone && String(phone).trim()) {
      whereClause += " AND l.phone ILIKE :phone";
      replacements.phone = `%${String(phone).trim()}%`;
    }
    if (lead_number && String(lead_number).trim()) {
      whereClause += " AND l.lead_number ILIKE :lead_number";
      replacements.lead_number = `%${String(lead_number).trim()}%`;
    }
    if (city && String(city).trim()) {
      whereClause += " AND l.city ILIKE :city";
      replacements.city = `%${String(city).trim()}%`;
    }
    if (lead_source_id && String(lead_source_id).trim()) {
      whereClause += " AND l.lead_source_id = :lead_source_id";
      replacements.lead_source_id = String(lead_source_id).trim();
    }

    const generalSearch = (q || search || "").toString().trim();
    if (generalSearch) {
      whereClause += " AND (l.full_name ILIKE :generalSearch OR l.email ILIKE :generalSearch OR l.phone ILIKE :generalSearch OR l.city ILIKE :generalSearch OR l.lead_number ILIKE :generalSearch)";
      replacements.generalSearch = `%${generalSearch}%`;
    }

    const countResult: any[] = await db.sequelize.query(
      `SELECT COUNT(*) as total FROM public.leads l ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0");

    const dataResult: any[] = await db.sequelize.query(
      `SELECT
         l.*,
         ls.name AS lead_source_name,
         camp.name AS campaign_name
       FROM public.leads l
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns camp ON camp.id = l.campaign_id
       ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      data: dataResult,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 10. GET ALL AGENTS ====================
export const getAllAgents = async (req: Request, res: Response) => {
  try {
    const rows: any[] = await db.sequelize.query(
      `SELECT su.id, su.name, su.email
       FROM public.system_users su
       JOIN public.user_role ur ON ur.system_user_id = su.id
       JOIN public.roles r ON r.id = ur.role_id
       WHERE su.deleted_at IS NULL AND LOWER(r.name) = 'agent'
       ORDER BY su.name ASC`,
      { type: QueryTypes.SELECT }
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 11. GET LEAD SOURCES ====================
export const getLeadSources = async (req: Request, res: Response) => {
  try {
    const rows: any[] = await db.sequelize.query(
      `SELECT id, name FROM public.lead_sources WHERE deleted_at IS NULL ORDER BY name ASC`,
      { type: QueryTypes.SELECT }
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 12. GET NEXT UNASSIGNED LEAD ====================
export const getNextUnassignedLead = async (req: Request, res: Response) => {
  try {
    const rows: any[] = await db.sequelize.query(
      `SELECT * FROM public.leads WHERE agent_id IS NULL AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      { type: QueryTypes.SELECT }
    );

    if (rows.length === 0) {
      return res.status(200).json({ success: true, data: null, message: "No unassigned leads found" });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 12.1. GET NEXT ASSIGNED LEAD ====================
export const getNextAssignedLead = async (req: Request, res: Response) => {
  try {
    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;
    const currentLeadId = (req.query.current_lead_id as string) || (req.query.lead_id as string) || null;
    const userIsAdmin = await checkIsAdmin(authUserId);
    const agentId = (req.query.agent_id as string) || (!userIsAdmin && authUserId ? authUserId : null);

    let nextLead: any = null;
    let isLoop = false;

    // Filter by agent if specified, or if non-admin agent logged in
    const agentFilter = agentId
      ? `AND l.agent_id = :agentId`
      : authUserId && !userIsAdmin
      ? `AND l.agent_id = :authUserId`
      : ``;
    const replacements: any = { agentId, authUserId, currentLeadId };

    if (currentLeadId) {
      const currentRows: any[] = await db.sequelize.query(
        `SELECT id, created_at FROM public.leads WHERE id = :currentLeadId AND deleted_at IS NULL LIMIT 1`,
        { replacements: { currentLeadId }, type: QueryTypes.SELECT }
      );

      if (currentRows.length > 0) {
        const currentCreatedAt = currentRows[0].created_at;
        replacements.currentCreatedAt = currentCreatedAt;
        // Find next assigned lead down the list (created_at < current OR same created_at with id < current)
        const nextRows: any[] = await db.sequelize.query(
          `SELECT l.* FROM public.leads l
           WHERE l.deleted_at IS NULL 
             ${agentFilter}
             AND (l.created_at < :currentCreatedAt OR (l.created_at = :currentCreatedAt AND l.id < :currentLeadId))
           ORDER BY l.created_at DESC, l.id DESC 
           LIMIT 1`,
          { replacements, type: QueryTypes.SELECT }
        );

        if (nextRows.length > 0) {
          nextLead = nextRows[0];
          isLoop = false;
        }
      }
    }

    // If reached the end or no currentLeadId provided, loop back to the first assigned lead (newest on top)
    if (!nextLead) {
      const firstRows: any[] = await db.sequelize.query(
        `SELECT l.* FROM public.leads l
         WHERE l.deleted_at IS NULL 
           ${agentFilter}
           ${currentLeadId ? "AND l.id != :currentLeadId" : ""}
         ORDER BY l.created_at DESC, l.id DESC 
         LIMIT 1`,
        { replacements, type: QueryTypes.SELECT }
      );

      if (firstRows.length > 0) {
        nextLead = firstRows[0];
        isLoop = Boolean(currentLeadId);
      }
    }

    if (!nextLead) {
      return res.status(200).json({ success: true, data: null, message: "No other assigned leads found" });
    }

    return res.status(200).json({ success: true, data: nextLead, is_loop: isLoop });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 13. BULK UPLOAD FROM FILE ====================
export const bulkUploadFromFile = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No Excel file uploaded" });
    }

    const { lead_source_id, campaign_id, agent_id } = req.body;

    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rawRows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: "" });

    if (!rawRows.length) {
      return res.status(400).json({ success: false, message: "Excel sheet is empty" });
    }

    let inserted = 0;
    let skipped = 0;
    let duplicateFound = false;
    const now = new Date();
    const seenPhonesInSheet = new Set<string>();
    const seenEmailsInSheet = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];

      const full_name = String(
        row["Full Name"] ||
        row["full_name"] ||
        row["FullName"] ||
        row["Name"] ||
        row["name"] ||
        row["Client Name"] ||
        row["Customer Name"] ||
        ""
      ).trim();

      const rawPhone = String(
        row["Phone"] ||
        row["phone"] ||
        row["Mobile"] ||
        row["mobile"] ||
        row["Phone Number"] ||
        row["Contact"] ||
        row["Contact Number"] ||
        ""
      ).trim();

      const email = String(
        row["Email"] ||
        row["email"] ||
        row["Email ID"] ||
        row["E-mail"] ||
        ""
      ).trim().toLowerCase();

      if (!full_name || !rawPhone) {
        skipped++;
        continue;
      }

      const phoneDigits = rawPhone.replace(/\D/g, "");

      if (phoneDigits.length < 5) {
        skipped++;
        continue;
      }

      // Check duplicates in current file
      if (seenPhonesInSheet.has(phoneDigits) || (email && seenEmailsInSheet.has(email))) {
        skipped++;
        duplicateFound = true;
        continue;
      }

      // Ensure exact country code format: +1 for USA 10-digit / 11-digit numbers
      let phone = rawPhone.replace(/[^\d+]/g, ""); // keep + and digits
      if (!phone.startsWith("+")) {
        if (phoneDigits.length === 11 && phoneDigits.startsWith("1")) {
          phone = `+${phoneDigits}`;
        } else if (phoneDigits.length === 10) {
          phone = `+1${phoneDigits}`;
        } else {
          phone = `+${phoneDigits}`;
        }
      }

      // Check duplicate phone or email in database
      const existing: any[] = await db.sequelize.query(
        `SELECT id FROM public.leads WHERE deleted_at IS NULL AND (REGEXP_REPLACE(phone, '\\D', '', 'g') = :phoneDigits ${email ? 'OR LOWER(email) = :email' : ''}) LIMIT 1`,
        { replacements: { phoneDigits, email }, type: QueryTypes.SELECT }
      );

      if (existing.length > 0) {
        skipped++;
        duplicateFound = true;
        continue;
      }

      seenPhonesInSheet.add(phoneDigits);
      if (email) seenEmailsInSheet.add(email);

      const rawCountry = row["Country"] || row["country"] || null;
      const { country: detectedCountry, currency: detectedCurrency } = detectCountryAndCurrency(phone, rawCountry, null);

      const id = uuidv4();
      const whatsapp_number = row["WhatsApp Number"] || row["WhatsApp"] || row["whatsapp"] || row["whatsapp_number"] || null;
      const address_line1 = row["Address"] || row["address"] || row["Address Line 1"] || row["address_line1"] || null;
      const address_line2 = row["Address Line 2"] || row["address_line2"] || row["Address 2"] || row["address2"] || null;
      const city = row["City"] || row["city"] || null;
      const state = row["State"] || row["state"] || null;
      const postal_code = row["Postal Code"] || row["postal_code"] || row["Zip Code"] || row["Zip"] || row["Pincode"] || null;
      const note = row["Note"] || row["note"] || row["Remarks"] || row["remarks"] || null;

      await db.sequelize.query(
        `INSERT INTO public.leads (
           id, full_name, email, phone, whatsapp_number, address_line1, address_line2, city, state, postal_code, country,
           lead_source_id, campaign_id, agent_id, lead_status, currency, note, created_at, updated_at
         ) VALUES (
           :id, :full_name, :email, :phone, :whatsapp_number, :address_line1, :address_line2, :city, :state, :postal_code, :country,
           :lead_source_id, :campaign_id, :agent_id, 'New', :currency, :note, :created_at, :updated_at
         )`,
        {
          replacements: {
            id,
            full_name,
            email: email || `${phoneDigits || Date.now()}@placeholder.com`,
            phone,
            whatsapp_number,
            address_line1,
            address_line2,
            city,
            state,
            postal_code,
            country: detectedCountry,
            lead_source_id: lead_source_id || null,
            campaign_id: campaign_id || null,
            agent_id: agent_id || null,
            currency: detectedCurrency || "USD",
            note,
            created_at: now,
            updated_at: now,
          },
          type: QueryTypes.INSERT,
        }
      );

      // Optional: Auto-create order if Product is present in the row
      const rawProduct = (
        row["Product"] ||
        row["product"] ||
        row["Medicine"] ||
        row["medicine"] ||
        row["Medicine Name"] ||
        row["medicine_name"] ||
        ""
      )
        .toString()
        .trim();

      if (rawProduct) {
        const rawQuantity = row["Quantity"] || row["quantity"] || row["Qty"] || row["qty"];
        const rawPrice =
          row["Price"] ||
          row["price"] ||
          row["Amount"] ||
          row["amount"] ||
          row["Total Price"] ||
          row["total_price"];

        const quantity = Math.max(1, parseInt(String(rawQuantity || "1").replace(/\D/g, "")) || 1);
        const price = parseFloat(String(rawPrice || "0").replace(/[^\d.]/g, "")) || 0;

        const orderId = uuidv4();
        const orderItemId = uuidv4();

        // 1. Insert into lead_orders
        await db.sequelize.query(
          `INSERT INTO public.lead_orders (
             id, lead_id, agent_id, total_items, grand_total,
             order_status, payment_status, payment_mode, order_notes, created_at, updated_at
           ) VALUES (
             :orderId, :leadId, :agentId, 1, :grandTotal,
             'Delivered', 'Paid', 'Prepaid', 'Previous purchase imported via bulk upload', :createdAt, :updatedAt
           )`,
          {
            replacements: {
              orderId,
              leadId: id,
              agentId: agent_id || null,
              grandTotal: price,
              createdAt: now,
              updatedAt: now,
            },
            type: QueryTypes.INSERT,
          }
        );

        // 2. Insert into lead_order_items (Direct mapping, no division)
        await db.sequelize.query(
          `INSERT INTO public.lead_order_items (
             id, order_id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at
           ) VALUES (
             :itemId, :orderId, :leadId, :medicineName, 'Pcs', :quantity, :rate, :totalPrice, :createdAt, :updatedAt
           )`,
          {
            replacements: {
              itemId: orderItemId,
              orderId,
              leadId: id,
              medicineName: rawProduct,
              quantity,
              rate: price,
              totalPrice: price,
              createdAt: now,
              updatedAt: now,
            },
            type: QueryTypes.INSERT,
          }
        );
      }

      inserted++;
    }

    if (inserted === 0) {
      const errorMsg = duplicateFound
        ? "Lead already exists (Phone number or Email ID already exists)"
        : "No leads imported. Please check your Excel file.";
      return res.status(400).json({
        success: false,
        message: errorMsg,
        data: { inserted: 0, skipped },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully imported ${inserted} leads${skipped > 0 ? " (Some leads skipped: Phone number or Email ID already exists)" : ""}!`,
      data: { inserted, skipped },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 14. DOWNLOAD SAMPLE EXCEL TEMPLATE ====================
export const downloadSampleLeadExcel = async (req: Request, res: Response) => {
  try {
    const sampleData = [
      {
        "Full Name": "Ronald E Wilcox",
        "Phone": "+16027692922",
        "Email": "ronwilcox@cox.net",
        "Address Line 1": "120 W ALMERIA RD",
        "Address Line 2": "Suite 100",
        "City": "Phoenix",
        "State": "AZ",
        "Zip Code": "85003-1139",
        "Product": "Cenforce 100mg",
        "Quantity": 2,
        "Price": 100,
      },
      {
        "Full Name": "John Smith",
        "Phone": "+14155552671",
        "Email": "john.smith@example.com",
        "Address Line 1": "742 Evergreen Terrace",
        "Address Line 2": "Apt 4B",
        "City": "Springfield",
        "State": "OR",
        "Zip Code": "97477",
        "Product": "Modafinil 200mg",
        "Quantity": 1,
        "Price": 120,
      },
      {
        "Full Name": "David Wilson",
        "Phone": "+447911123456",
        "Email": "david.wilson@example.co.uk",
        "Address Line 1": "10 Downing Street",
        "Address Line 2": "Westminster",
        "City": "London",
        "State": "Greater London",
        "Zip Code": "SW1A 2AA",
        "Product": "Kamagra Oral Jelly",
        "Quantity": 5,
        "Price": 150,
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    worksheet["!cols"] = [
      { wch: 20 },
      { wch: 18 },
      { wch: 30 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 10 },
      { wch: 15 },
      { wch: 22 },
      { wch: 10 },
      { wch: 12 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leads_Template");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", 'attachment; filename="sample_leads_template.xlsx"');
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 14. GET ASSIGNED NOTIFICATIONS ====================
export const getAssignedLeadNotifications = async (req: Request, res: Response) => {
  try {
    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id;

    let whereClause = "";
    const replacements: any = {};
    if (authUserId) {
      const [roleRow]: any[] = await db.sequelize.query(
        `SELECT r.name FROM public.user_role ur JOIN public.roles r ON ur.role_id = r.id WHERE ur.system_user_id = :authUserId LIMIT 1`,
        { replacements: { authUserId }, type: QueryTypes.SELECT }
      );
      if (roleRow && roleRow.name?.toLowerCase() !== "admin") {
        whereClause = "WHERE recipient_user_id = :authUserId";
        replacements.authUserId = authUserId;
      }
    }

    const rows: any[] = await db.sequelize.query(
      `SELECT 
         id, 
         recipient_user_id, 
         title, 
         body, 
         COALESCE(data->>'lead_id', null) AS lead_id, 
         data, 
         created_at, 
         updated_at 
       FROM public.assigned_lead_notifications 
       ${whereClause} 
       ORDER BY created_at DESC LIMIT 50`,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  createLead,
  getLead,
  getAssignedLeads,
  bulkAssignLeads,
  getUnassignedLeads,
  getNextUnassignedLead,
  getNextAssignedLead,
  getAllAgents,
  updateLead,
  assignLeadToAgent,
  searchLeads,
  filterUnassignedLeads,
  softDeleteLeads,
  getLeadSources,
  bulkUploadFromFile,
  downloadSampleLeadExcel,
  getAssignedLeadNotifications,
};
