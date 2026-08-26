import { Request, Response } from "express";
import * as yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import DBServices from "../database/DBService";

const dbServices = new DBServices();

// Ensure Table Exists
const ensureTableExists = async () => {
  try {
    await dbServices.sequelizeWriter.query(`
      CREATE TABLE IF NOT EXISTS public.master_medicines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE NULL
      );
      CREATE INDEX IF NOT EXISTS idx_master_med_name ON public.master_medicines (name);
      CREATE INDEX IF NOT EXISTS idx_master_med_deleted ON public.master_medicines (deleted_at);
    `);
  } catch (e) {
    console.error("Error creating master_medicines table:", e);
  }
};
ensureTableExists();

// ==================== VALIDATION SCHEMA ====================
const medicineSchema = yup.object({
  name: yup.string().trim().required("Medicine name is required").max(255),
});

// ==================== CREATE ====================
export const createMedicine = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = await medicineSchema.validate(req.body, { abortEarly: false });
    const id = uuidv4();
    const now = new Date();

    const query = `
      INSERT INTO public.master_medicines (id, name, created_at, updated_at)
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

// ==================== GET ALL (PAGINATION) ====================
export const getAllMedicines = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const countResult: any[] = await dbServices.sequelizeWriter.query(
      `SELECT COUNT(*) as total FROM public.master_medicines WHERE deleted_at IS NULL`,
      { type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0", 10);

    const dataResult: any[] = await dbServices.sequelizeWriter.query(
      `SELECT id, name, created_at, updated_at FROM public.master_medicines WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
      { replacements: { limit, offset }, type: QueryTypes.SELECT }
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

// ==================== GET ONE ====================
export const getMedicineById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const result: any[] = await dbServices.sequelizeWriter.query(
      `SELECT id, name, created_at, updated_at FROM public.master_medicines WHERE id = :id AND deleted_at IS NULL`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Medicine record not found" });
      return;
    }

    res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== UPDATE ====================
export const updateMedicine = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const validatedData = await medicineSchema.validate(req.body, { abortEarly: false });
    const now = new Date();

    const query = `
      UPDATE public.master_medicines SET
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
      res.status(404).json({ success: false, message: "Medicine record not found" });
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
export const deleteMedicine = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const result: any[] = await dbServices.sequelizeWriter.query(
      `UPDATE public.master_medicines SET deleted_at = NOW(), updated_at = NOW() WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      res.status(404).json({ success: false, message: "Medicine record not found" });
      return;
    }

    res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  createMedicine,
  getAllMedicines,
  getMedicineById,
  updateMedicine,
  deleteMedicine,
};
