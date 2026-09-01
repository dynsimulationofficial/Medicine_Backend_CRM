import { Request, Response } from "express";
import * as yup from "yup";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";

// ==================== VALIDATION SCHEMA ====================
const campaignSchema = yup.object({
  name: yup.string().trim().required("Campaign name is required").max(255),
  lead_source_id: yup.string().uuid().nullable().optional(),
});

// ==================== 1. CREATE CAMPAIGN ====================
export const createCampaign = async (req: Request, res: Response) => {
  try {
    const validatedData = await campaignSchema.validate(req.body, { abortEarly: false });
    const name = validatedData.name.trim();
    const lead_source_id = validatedData.lead_source_id || null;

    // Check duplicate
    const dupRows: any[] = await db.sequelize.query(
      `SELECT id FROM public.campaigns WHERE deleted_at IS NULL AND LOWER(name) = LOWER(:name) LIMIT 1`,
      { replacements: { name }, type: QueryTypes.SELECT }
    );

    if (dupRows.length > 0) {
      return res.status(409).json({ success: false, message: "A campaign with this name already exists" });
    }

    const id = uuidv4();
    const now = new Date();

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

    const result: any[] = await db.sequelize.query(query, {
      replacements: { id, name, lead_source_id, created_at: now, updated_at: now },
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

// ==================== 2. GET ALL CAMPAIGNS ====================
export const getAllCampaigns = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit || req.query.pageSize) || 50;
    const offset = (page - 1) * limit;
    const search = (req.query.search || req.query.q || "").toString().trim();
    const lead_source_id = req.query.lead_source_id as string | undefined;

    let whereClause = "WHERE c.deleted_at IS NULL";
    const replacements: any = { limit, offset };

    if (search) {
      whereClause += " AND c.name ILIKE :search";
      replacements.search = `%${search}%`;
    }
    if (lead_source_id) {
      whereClause += " AND c.lead_source_id = :lead_source_id";
      replacements.lead_source_id = lead_source_id;
    }

    const countResult: any[] = await db.sequelize.query(
      `SELECT COUNT(*) as total FROM public.campaigns c ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0");

    const dataResult: any[] = await db.sequelize.query(
      `SELECT
         c.id,
         c.name,
         c.lead_source_id,
         c.created_at,
         c.updated_at,
         ls.name as lead_source_name
       FROM public.campaigns c
       LEFT JOIN public.lead_sources ls ON ls.id = c.lead_source_id
       ${whereClause}
       ORDER BY c.created_at DESC
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

// ==================== 3. GET CAMPAIGNS BY SOURCE ====================
export const getCampaignsBySource = async (req: Request, res: Response) => {
  try {
    const lead_source_id = req.query.lead_source_id || req.params.lead_source_id || req.body?.lead_source_id;
    if (!lead_source_id) {
      return res.status(400).json({ success: false, message: "lead_source_id is required" });
    }

    const result: any[] = await db.sequelize.query(
      `SELECT
         c.id,
         c.name,
         c.lead_source_id,
         c.created_at,
         c.updated_at,
         ls.name as lead_source_name
       FROM public.campaigns c
       LEFT JOIN public.lead_sources ls ON ls.id = c.lead_source_id
       WHERE c.deleted_at IS NULL AND c.lead_source_id = :lead_source_id
       ORDER BY c.name ASC`,
      { replacements: { lead_source_id }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 4. GET CAMPAIGN BY ID ====================
export const getCampaignById = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id || req.params?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Campaign ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `SELECT
         c.id,
         c.name,
         c.lead_source_id,
         c.created_at,
         c.updated_at,
         ls.name as lead_source_name
       FROM public.campaigns c
       LEFT JOIN public.lead_sources ls ON ls.id = c.lead_source_id
       WHERE c.id = :id AND c.deleted_at IS NULL LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Campaign record not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. UPDATE CAMPAIGN ====================
export const updateCampaign = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id || req.params?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Campaign ID is required" });
    }

    const validatedData = await campaignSchema.validate(req.body, { abortEarly: false });
    const now = new Date();

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

    const result: any[] = await db.sequelize.query(query, {
      replacements: {
        id,
        name: validatedData.name.trim(),
        lead_source_id: validatedData.lead_source_id || null,
        updated_at: now,
      },
      type: QueryTypes.SELECT,
    });

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Campaign record not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 6. DELETE CAMPAIGN ====================
export const deleteCampaign = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id || req.params?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Campaign ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `UPDATE public.campaigns SET deleted_at = NOW(), updated_at = NOW() WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Campaign record not found" });
    }

    return res.status(200).json({ success: true, message: "Campaign deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  createCampaign,
  getAllCampaigns,
  getCampaignsBySource,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
};
