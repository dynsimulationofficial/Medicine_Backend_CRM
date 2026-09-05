import { Request, Response } from "express";
import * as yup from "yup";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";
import path from "path";
import fs from "fs";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.AWS_S3_BUCKET_NAME || "";

// Helper to get presigned URL for medicine image if stored in S3
const getMedicineImageUrl = async (imagePath: string | null | undefined): Promise<string | null> => {
  if (!imagePath) return null;
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) return imagePath;

  if (BUCKET && (imagePath.startsWith("medicines/") || !imagePath.startsWith("/uploads"))) {
    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: imagePath,
      });
      return await getSignedUrl(s3Client, command, { expiresIn: 86400 }); // 24 hours
    } catch (err) {
      console.warn("Failed to generate presigned URL for medicine image:", err);
      return imagePath;
    }
  }

  return imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
};

// ==================== VALIDATION SCHEMA ====================
const medicineSchema = yup.object({
  name: yup.string().trim().required("Medicine name is required").max(255),
  description: yup.string().nullable().optional(),
});

// ==================== 1. CREATE MEDICINE ====================
export const createMedicine = async (req: Request, res: Response) => {
  try {
    const validatedData = await medicineSchema.validate(req.body, { abortEarly: false });
    const name = validatedData.name.trim();
    const description = req.body?.description?.trim() || null;

    // Check duplicate
    const dupRows: any[] = await db.sequelize.query(
      `SELECT id FROM public.master_medicines WHERE deleted_at IS NULL AND LOWER(name) = LOWER(:name) LIMIT 1`,
      { replacements: { name }, type: QueryTypes.SELECT }
    );

    if (dupRows.length > 0) {
      return res.status(409).json({ success: false, message: "A medicine with this name already exists" });
    }

    const id = uuidv4();
    let imageUrl: string | null = null;

    // Handle Image Upload if provided
    if (req.file) {
      const file = req.file;
      const fileNameClean = (file.originalname || "image").replace(/[^\w.\-() ]+/g, "_");
      const key = `medicines/${id}/${Date.now()}-${fileNameClean}`;

      if (BUCKET) {
        try {
          const upload = new Upload({
            client: s3Client,
            params: {
              Bucket: BUCKET,
              Key: key,
              Body: file.buffer,
              ContentType: file.mimetype,
              ACL: "private",
            },
          });
          await upload.done();
          imageUrl = key;
        } catch (s3Err) {
          console.warn("S3 medicine image upload fallback to local:", s3Err);
          const uploadDir = path.join(process.cwd(), "public", "uploads", "medicines", id);
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          fs.writeFileSync(path.join(uploadDir, `${Date.now()}-${fileNameClean}`), file.buffer);
          imageUrl = `/uploads/medicines/${id}/${Date.now()}-${fileNameClean}`;
        }
      } else {
        const uploadDir = path.join(process.cwd(), "public", "uploads", "medicines", id);
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, `${Date.now()}-${fileNameClean}`), file.buffer);
        imageUrl = `/uploads/medicines/${id}/${Date.now()}-${fileNameClean}`;
      }
    }

    const now = new Date();

    const query = `
      INSERT INTO public.master_medicines (id, name, description, image_url, created_at, updated_at)
      VALUES (:id, :name, :description, :image_url, :created_at, :updated_at)
      RETURNING *
    `;

    const result: any[] = await db.sequelize.query(query, {
      replacements: { id, name, description, image_url: imageUrl, created_at: now, updated_at: now },
      type: QueryTypes.SELECT,
    });

    const row = result[0];
    if (row && row.image_url) {
      row.image_url = await getMedicineImageUrl(row.image_url);
    }

    return res.status(201).json({ success: true, data: row });
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
      `SELECT id, name, description, image_url, created_at, updated_at
       FROM public.master_medicines
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    // Enrich rows with presigned image URLs
    const enrichedData = await Promise.all(
      dataResult.map(async (row) => ({
        ...row,
        image_url: await getMedicineImageUrl(row.image_url),
      }))
    );

    return res.status(200).json({
      success: true,
      data: enrichedData,
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
      `SELECT id, name, description, image_url, created_at, updated_at FROM public.master_medicines WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Medicine record not found" });
    }

    const row = result[0];
    if (row.image_url) {
      row.image_url = await getMedicineImageUrl(row.image_url);
    }

    return res.status(200).json({ success: true, data: row });
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
    const name = validatedData.name.trim();
    const description = req.body?.description !== undefined ? (req.body.description?.trim() || null) : undefined;
    const now = new Date();

    // Check if new image uploaded
    let newImageUrl: string | undefined = undefined;
    if (req.file) {
      const file = req.file;
      const fileNameClean = (file.originalname || "image").replace(/[^\w.\-() ]+/g, "_");
      const key = `medicines/${id}/${Date.now()}-${fileNameClean}`;

      if (BUCKET) {
        try {
          const upload = new Upload({
            client: s3Client,
            params: {
              Bucket: BUCKET,
              Key: key,
              Body: file.buffer,
              ContentType: file.mimetype,
              ACL: "private",
            },
          });
          await upload.done();
          newImageUrl = key;
        } catch (s3Err) {
          console.warn("S3 medicine image upload fallback to local:", s3Err);
          const uploadDir = path.join(process.cwd(), "public", "uploads", "medicines", id);
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          fs.writeFileSync(path.join(uploadDir, `${Date.now()}-${fileNameClean}`), file.buffer);
          newImageUrl = `/uploads/medicines/${id}/${Date.now()}-${fileNameClean}`;
        }
      } else {
        const uploadDir = path.join(process.cwd(), "public", "uploads", "medicines", id);
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, `${Date.now()}-${fileNameClean}`), file.buffer);
        newImageUrl = `/uploads/medicines/${id}/${Date.now()}-${fileNameClean}`;
      }
    }

    const setClauses: string[] = ["name = :name", "updated_at = :updated_at"];
    const replacements: any = { id, name, updated_at: now };

    if (description !== undefined) {
      setClauses.push("description = :description");
      replacements.description = description;
    }

    if (newImageUrl !== undefined) {
      setClauses.push("image_url = :image_url");
      replacements.image_url = newImageUrl;
    }

    const query = `
      UPDATE public.master_medicines SET
        ${setClauses.join(", ")}
      WHERE id = :id AND deleted_at IS NULL
      RETURNING *
    `;

    const result: any[] = await db.sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Medicine record not found" });
    }

    const row = result[0];
    if (row && row.image_url) {
      row.image_url = await getMedicineImageUrl(row.image_url);
    }

    return res.status(200).json({ success: true, data: row });
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

