import { Request, Response } from "express";
import * as yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import DBServices from "../database/DBService";

const dbServices = new DBServices();

// Ensure Table & Indexes
const ensureTableExists = async () => {
  try {
    await dbServices.sequelizeWriter.query(`
      CREATE TABLE IF NOT EXISTS public.campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        lead_source_id UUID NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE NULL
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_name ON public.campaigns (name);
      CREATE INDEX IF NOT EXISTS idx_campaigns_source ON public.campaigns (lead_source_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_deleted ON public.campaigns (deleted_at);
    `);
  } catch (e) {
    console.error("Error ensuring campaigns table:", e);
  }
};
ensureTableExists();

// ==================== VALIDATION SCHEMA ====================
const campaignSchema = yup.object({
  name: yup.string().trim().required("Campaign name is required").max(255),
  lead_source_id: yup.string().nullable().optional(),
});

// ==================== CREATE ====================
export const createCampaign = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = await campaignSchema.validate(req.body, { abortEarly: false });
    const id = uuidv4();
    const now = new Date();
    const lead_source_id = validatedData.lead_source_id && validatedData.lead_source_id.trim().length > 0
      ? validatedData.lead_source_id.trim()
      : null;

    const query = `
      WITH ins AS (
        INSERT INTO public.campaigns (id, name, lead_source_id, created_at, updated_at)
        VALUES (:id, :name, :lead_source_id, :created_at, :updated_at)
        RETURNING *
      )
      SELECT ins.*, ls.name as lead_source_name
      FROM ins
      LEFT JOIN public.lead_sources ls ON ls.id = ins.lead_source_id
    `;

    const result: any[] = await dbServices.sequelizeWriter.query(query, {
      replacements: {
        id,
        name: validatedData.name.trim(),
        lead_source_id,
        created_at: now,
        updated_at: now,
      },
      type: QueryTypes.SELECT,
    });

    res.status(201).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      res.status(400).json({ success: false, errors: error.errors });
      return;
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET ALL (WITH PAGINATION & SEARCH) ====================
export const getAllCampaigns = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const q = (req.query.search || req.query.q || "").toString().trim();
    const sourceId = (req.query.lead_source_id || req.query.source_id || "").toString().trim();

    let whereClause = "WHERE c.deleted_at IS NULL";
    const replacements: any = { limit, offset };

    if (q) {
      whereClause += " AND (c.name ILIKE :search OR ls.name ILIKE :search)";
      replacements.search = `%${q}%`;
    }

    if (sourceId) {
      whereClause += " AND c.lead_source_id = :sourceId";
      replacements.sourceId = sourceId;
    }

    const countResult: any[] = await dbServices.sequelizeWriter.query(
      `SELECT COUNT(*) as total FROM public.campaigns c LEFT JOIN public.lead_sources ls ON ls.id = c.lead_source_id ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0", 10);

    const dataResult: any[] = await dbServices.sequelizeWriter.query(
      `SELECT c.id, c.name, c.lead_source_id, ls.name as lead_source_name, c.created_at, c.updated_at 
       FROM public.campaigns c 
       LEFT JOIN public.lead_sources ls ON ls.id = c.lead_source_id 
       ${whereClause} 
       ORDER BY c.created_at DESC 
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    res.status(200).json({
      success: true,
      data: dataResult,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== SEARCH ====================
export const searchCampaigns = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, search } = req.query;
    const queryStr = (q || search || "").toString().trim();

    if (!queryStr) {
      res.status(400).json({ success: false, message: "Search query is required" });
      return;
    }

    const searchString = `%${queryStr}%`;
    const query = `
      SELECT c.id, c.name, c.lead_source_id, ls.name as lead_source_name, c.created_at, c.updated_at 
      FROM public.campaigns c 
      LEFT JOIN public.lead_sources ls ON ls.id = c.lead_source_id 
      WHERE c.deleted_at IS NULL AND (c.name ILIKE :search OR ls.name ILIKE :search) 
      ORDER BY c.created_at DESC
    `;

    const result = await dbServices.sequelizeWriter.query(query, {
      replacements: { search: searchString },
      type: QueryTypes.SELECT,
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET BY SOURCE (FOR LEAD DROPDOWNS) ====================
export const getCampaignsBySource = async (req: Request, res: Response): Promise<void> => {
  try {
    const sourceId = (req.query.lead_source_id || req.query.source_id || req.params.source_id || "").toString().trim();
    let query = `SELECT id, name, lead_source_id FROM public.campaigns WHERE deleted_at IS NULL`;
    const replacements: any = {};

    if (sourceId) {
      query += ` AND lead_source_id = :sourceId`;
      replacements.sourceId = sourceId;
    }
    query += ` ORDER BY name ASC`;

    const result = await dbServices.sequelizeWriter.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET ONE ====================
export const getCampaignById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const result: any[] = await dbServices.sequelizeWriter.query(
      `SELECT c.id, c.name, c.lead_source_id, ls.name as lead_source_name, c.created_at, c.updated_at 
       FROM public.campaigns c 
       LEFT JOIN public.lead_sources ls ON ls.id = c.lead_source_id 
       WHERE c.id = :id AND c.deleted_at IS NULL`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Campaign not found" });
      return;
    }

    res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== UPDATE ====================
export const updateCampaign = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id || req.body.id;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const validatedData = await campaignSchema.validate(req.body, { abortEarly: false });
    const now = new Date();
    const lead_source_id = validatedData.lead_source_id && validatedData.lead_source_id.trim().length > 0
      ? validatedData.lead_source_id.trim()
      : null;

    const query = `
      WITH upd AS (
        UPDATE public.campaigns SET
          name = :name,
          lead_source_id = :lead_source_id,
          updated_at = :updated_at
        WHERE id = :id AND deleted_at IS NULL
        RETURNING *
      )
      SELECT upd.*, ls.name as lead_source_name
      FROM upd
      LEFT JOIN public.lead_sources ls ON ls.id = upd.lead_source_id
    `;

    const result: any[] = await dbServices.sequelizeWriter.query(query, {
      replacements: {
        id,
        name: validatedData.name.trim(),
        lead_source_id,
        updated_at: now,
      },
      type: QueryTypes.SELECT,
    });

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Campaign not found" });
      return;
    }

    res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      res.status(400).json({ success: false, errors: error.errors });
      return;
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DELETE ====================
export const deleteCampaign = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id || req.body.id;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const now = new Date();
    const result: any[] = await dbServices.sequelizeWriter.query(
      `UPDATE public.campaigns SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id, now }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Campaign not found or already deleted" });
      return;
    }

    res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  createCampaign,
  getAllCampaigns,
  searchCampaigns,
  getCampaignsBySource,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
};
