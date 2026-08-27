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
      CREATE TABLE IF NOT EXISTS public.lead_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_sources_name ON public.lead_sources (name);
      CREATE INDEX IF NOT EXISTS idx_lead_sources_deleted ON public.lead_sources (deleted_at);
    `);
  } catch (e) {
    console.error("Error ensuring lead_sources table:", e);
  }
};
ensureTableExists();

// ==================== VALIDATION SCHEMA ====================
const leadSourceSchema = yup.object({
  name: yup.string().trim().required("Lead source name is required").max(255),
});

// ==================== CREATE ====================
export const createLeadSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = await leadSourceSchema.validate(req.body, { abortEarly: false });
    const id = uuidv4();
    const now = new Date();

    const query = `
      INSERT INTO public.lead_sources (id, name, created_at, updated_at)
      VALUES (:id, :name, :created_at, :updated_at)
      RETURNING *
    `;

    const result: any[] = await dbServices.sequelizeWriter.query(query, {
      replacements: {
        id,
        name: validatedData.name.trim(),
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
export const getAllLeadSources = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const q = (req.query.search || req.query.q || "").toString().trim();

    let whereClause = "WHERE deleted_at IS NULL";
    const replacements: any = { limit, offset };

    if (q) {
      whereClause += " AND name ILIKE :search";
      replacements.search = `%${q}%`;
    }

    const countResult: any[] = await dbServices.sequelizeWriter.query(
      `SELECT COUNT(*) as total FROM public.lead_sources ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0", 10);

    const dataResult: any[] = await dbServices.sequelizeWriter.query(
      `SELECT id, name, created_at, updated_at FROM public.lead_sources ${whereClause} ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
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
export const searchLeadSources = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, search } = req.query;
    const queryStr = (q || search || "").toString().trim();

    if (!queryStr) {
      res.status(400).json({ success: false, message: "Search query is required" });
      return;
    }

    const searchString = `%${queryStr}%`;
    const query = `SELECT id, name, created_at, updated_at FROM public.lead_sources WHERE deleted_at IS NULL AND name ILIKE :search ORDER BY created_at DESC`;

    const result = await dbServices.sequelizeWriter.query(query, {
      replacements: { search: searchString },
      type: QueryTypes.SELECT,
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET ONE ====================
export const getLeadSourceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const result: any[] = await dbServices.sequelizeWriter.query(
      `SELECT id, name, created_at, updated_at FROM public.lead_sources WHERE id = :id AND deleted_at IS NULL`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Lead source not found" });
      return;
    }

    res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== UPDATE ====================
export const updateLeadSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id || req.body.id;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const validatedData = await leadSourceSchema.validate(req.body, { abortEarly: false });
    const now = new Date();

    const query = `
      UPDATE public.lead_sources SET
        name = :name,
        updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL
      RETURNING *
    `;

    const result: any[] = await dbServices.sequelizeWriter.query(query, {
      replacements: {
        id,
        name: validatedData.name.trim(),
        updated_at: now,
      },
      type: QueryTypes.SELECT,
    });

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Lead source not found" });
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
export const deleteLeadSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id || req.body.id;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const now = new Date();
    const result: any[] = await dbServices.sequelizeWriter.query(
      `UPDATE public.lead_sources SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id, now }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Lead source not found or already deleted" });
      return;
    }

    res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  createLeadSource,
  getAllLeadSources,
  searchLeadSources,
  getLeadSourceById,
  updateLeadSource,
  deleteLeadSource,
};
