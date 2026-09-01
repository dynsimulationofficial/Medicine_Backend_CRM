import { Request, Response } from "express";
import * as yup from "yup";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";

// ==================== VALIDATION SCHEMA ====================
const medicineSchema = yup.object({
  name: yup.string().trim().required("Medicine name is required").max(255),
});

// ==================== 1. CREATE MEDICINE ====================
export const createMedicine = async (req: Request, res: Response) => {
  try {
    const validatedData = await medicineSchema.validate(req.body, { abortEarly: false });
    const name = validatedData.name.trim();

    // Check duplicate
    const dupRows: any[] = await db.sequelize.query(
      `SELECT id FROM public.master_medicines WHERE deleted_at IS NULL AND LOWER(name) = LOWER(:name) LIMIT 1`,
      { replacements: { name }, type: QueryTypes.SELECT }
    );

    if (dupRows.length > 0) {
      return res.status(409).json({ success: false, message: "A medicine with this name already exists" });
    }

    const id = uuidv4();
    const now = new Date();

    const query = `
      INSERT INTO public.master_medicines (id, name, created_at, updated_at)
      VALUES (:id, :name, :created_at, :updated_at)
      RETURNING *
    `;

    const result: any[] = await db.sequelize.query(query, {
      replacements: { id, name, created_at: now, updated_at: now },
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

// ==================== 2. GET ALL MEDICINES ====================
export const getAllMedicines = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit || req.query.pageSize) || 50;
    const offset = (page - 1) * limit;
    const search = (req.query.search || req.query.q || "").toString().trim();

    let whereClause = "WHERE deleted_at IS NULL";
    const replacements: any = { limit, offset };

    if (search) {
      whereClause += " AND name ILIKE :search";
      replacements.search = `%${search}%`;
    }

    const countResult: any[] = await db.sequelize.query(
      `SELECT COUNT(*) as total FROM public.master_medicines ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countResult[0]?.total || "0");

    const dataResult: any[] = await db.sequelize.query(
      `SELECT id, name, created_at, updated_at
       FROM public.master_medicines
       ${whereClause}
       ORDER BY created_at DESC
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

// ==================== 3. GET MEDICINE BY ID ====================
export const getMedicineById = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id || req.params?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Medicine ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `SELECT id, name, created_at, updated_at FROM public.master_medicines WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Medicine record not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 4. UPDATE MEDICINE ====================
export const updateMedicine = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id || req.params?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Medicine ID is required" });
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

    const result: any[] = await db.sequelize.query(query, {
      replacements: {
        id,
        name: validatedData.name.trim(),
        updated_at: now,
      },
      type: QueryTypes.SELECT,
    });

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Medicine record not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. DELETE MEDICINE ====================
export const deleteMedicine = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id || req.params?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Medicine ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `UPDATE public.master_medicines SET deleted_at = NOW(), updated_at = NOW() WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Medicine record not found" });
    }

    return res.status(200).json({ success: true, message: "Medicine deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  createMedicine,
  getAllMedicines,
  getMedicineById,
  updateMedicine,
  deleteMedicine,
};
