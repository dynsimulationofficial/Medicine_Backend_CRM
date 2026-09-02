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
        country: validatedData.country || null,
        lead_score: validatedData.lead_score || 0,
        lead_quality: validatedData.lead_quality || null,
        best_time_to_call: validatedData.best_time_to_call || null,
        agent_id: validatedData.agent_id || null,
        lead_source_id: validatedData.lead_source_id || null,
        campaign_id: validatedData.campaign_id || null,
        currency: validatedData.currency || "USD",
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
    const limit = Number(req.query.limit || req.query.pageSize) || 50;
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
    const limit = Number(req.query.limit || req.query.pageSize) || 50;
    const offset = (page - 1) * limit;

    const countResult: any[] = await db.sequelize.query(
      `SELECT COUNT(*) as total FROM public.leads WHERE deleted_at IS NULL AND agent_id IS NOT NULL`,
      { type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0");

    const dataResult: any[] = await db.sequelize.query(
      `SELECT
         l.*,
         su.name AS agent_name,
         ls.name AS lead_source_name,
         camp.name AS campaign_name
       FROM public.leads l
       LEFT JOIN public.system_users su ON su.id = l.agent_id
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns camp ON camp.id = l.campaign_id
       WHERE l.deleted_at IS NULL AND l.agent_id IS NOT NULL
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
         camp.name AS campaign_name
       FROM public.leads l
       LEFT JOIN public.system_users su ON su.id = l.agent_id
       LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
       LEFT JOIN public.campaigns camp ON camp.id = l.campaign_id
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
    const { lead_ids, id } = req.body;
    const ids: string[] = lead_ids || (id ? [id] : []);

    if (!ids.length) {
      return res.status(400).json({ success: false, message: "Lead ID(s) required" });
    }

    await db.sequelize.query(
      `UPDATE public.leads SET deleted_at = NOW(), updated_at = NOW() WHERE id = ANY(ARRAY[:ids]::uuid[])`,
      { replacements: { ids }, type: QueryTypes.UPDATE }
    );

    return res.status(200).json({ success: true, message: "Lead(s) deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
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

// ==================== 9. FILTER / SEARCH LEADS ====================
export const searchLeads = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.body?.page || req.query?.page) || 1);
    const limit = Number(req.body?.limit || req.body?.pageSize || req.query?.limit || req.query?.pageSize) || 50;
    const offset = (page - 1) * limit;

    const { q, search, full_name, email, phone, city, lead_source_id } = { ...req.query, ...req.body };
    const queryStr = (q || search || full_name || email || phone || city || "").toString().trim();

    let whereClause = "WHERE l.deleted_at IS NULL";
    const replacements: any = { limit, offset };

    if (queryStr) {
      whereClause += " AND (l.full_name ILIKE :search OR l.email ILIKE :search OR l.phone ILIKE :search OR l.city ILIKE :search)";
      replacements.search = `%${queryStr}%`;
    }
    if (lead_source_id) {
      whereClause += " AND l.lead_source_id = :lead_source_id";
      replacements.lead_source_id = lead_source_id;
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
         camp.name AS campaign_name
       FROM public.leads l
       LEFT JOIN public.system_users su ON su.id = l.agent_id
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
      return res.status(404).json({ success: false, message: "No unassigned leads found" });
    }

    return res.status(200).json({ success: true, data: rows[0] });
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

    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rawRows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!rawRows.length) {
      return res.status(400).json({ success: false, message: "Excel sheet is empty" });
    }

    let inserted = 0;
    const now = new Date();

    for (const row of rawRows) {
      const full_name = row["Full Name"] || row["name"] || row["Name"] || "";
      const phone = String(row["Phone"] || row["phone"] || row["Mobile"] || "").trim();
      const email = String(row["Email"] || row["email"] || "").trim().toLowerCase();

      if (!full_name || !phone) continue;

      const id = uuidv4();
      await db.sequelize.query(
        `INSERT INTO public.leads (
           id, full_name, email, phone, address_line1, city, state, country,
           lead_status, currency, created_at, updated_at
         ) VALUES (
           :id, :full_name, :email, :phone, :address_line1, :city, :state, :country,
           'New', 'USD', :created_at, :updated_at
         )`,
        {
          replacements: {
            id,
            full_name,
            email: email || `${phone}@placeholder.com`,
            phone,
            address_line1: row["Address"] || row["address"] || null,
            city: row["City"] || row["city"] || null,
            state: row["State"] || row["state"] || null,
            country: row["Country"] || row["country"] || null,
            created_at: now,
            updated_at: now,
          },
          type: QueryTypes.INSERT,
        }
      );
      inserted++;
    }

    return res.status(200).json({ success: true, message: `Successfully imported ${inserted} leads` });
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
  getAllAgents,
  updateLead,
  assignLeadToAgent,
  searchLeads,
  softDeleteLeads,
  getLeadSources,
  bulkUploadFromFile,
  getAssignedLeadNotifications,
};
