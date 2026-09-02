import { Request, Response } from "express";
import * as yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import db from "../models";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];

// ==================== 1. GET ALL DOCUMENTS ====================
export const getAllDocuments = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id || req.query?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const rows: any[] = await db.sequelize.query(
      `SELECT d.id,
              d.file_name,
              d.mime_type,
              d.file_size,
              d.storage_path,
              d.is_image,
              d.notes,
              d.uploaded_by,
              u1.name AS uploaded_by_name,
              d.is_edited,
              d.edited_by,
              u2.name AS edited_by_name,
              d.created_at,
              d.updated_at
         FROM public.lead_documents d
    LEFT JOIN public.system_users u1 ON u1.id = d.uploaded_by
    LEFT JOIN public.system_users u2 ON u2.id = d.edited_by
        WHERE d.lead_id = :lead_id AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC`,
      { replacements: { lead_id }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, data: { documents: rows } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 2. UPLOAD DOCUMENT ====================
export const uploadDocument = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file format. Allowed: JPEG, PNG, WEBP, PDF, XLS, XLSX, CSV.",
      });
    }

    const lead_id = req.body?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const file = req.file;
    const notes = req.body?.notes?.trim() || null;
    const uploaded_by = req.body?.uploaded_by || (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

    const isImage = file.mimetype.startsWith("image/");
    const fileNameClean = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `lead-documents/${Date.now()}_${fileNameClean}`;

    if (process.env.AWS_S3_BUCKET_NAME) {
      try {
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: "private",
          },
        });
        await upload.done();
      } catch (s3Err) {
        console.warn("S3 upload fallback to local storage:", s3Err);
        const uploadDir = path.join(process.cwd(), "uploads", "lead-documents");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, path.basename(key)), file.buffer);
      }
    } else {
      const uploadDir = path.join(process.cwd(), "uploads", "lead-documents");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, path.basename(key)), file.buffer);
    }

    const id = uuidv4();
    const rows: any[] = await db.sequelize.query(
      `INSERT INTO public.lead_documents (
         id, lead_id, uploaded_by, file_name, mime_type, file_size, storage_path, is_image, notes, created_at, updated_at
       ) VALUES (
         :id, :lead_id, :uploaded_by, :file_name, :mime_type, :file_size, :storage_path, :is_image, :notes, NOW(), NOW()
       )
       RETURNING *`,
      {
        replacements: {
          id,
          lead_id,
          uploaded_by,
          file_name: file.originalname,
          mime_type: file.mimetype,
          file_size: file.size,
          storage_path: key,
          is_image: isImage,
          notes,
        },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(201).json({ success: true, message: "Document uploaded successfully", data: rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 3. GET DOCUMENT DOWNLOAD URL ====================
export const getDocumentUrl = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Document ID is required" });
    }

    const rows: any[] = await db.sequelize.query(
      `SELECT file_name, mime_type, storage_path, is_image
       FROM public.lead_documents
       WHERE id = :id AND deleted_at IS NULL
       LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    const doc = rows[0];
    if (process.env.AWS_S3_BUCKET_NAME) {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: doc.storage_path,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(doc.file_name)}"`,
      });
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      return res.status(200).json({ success: true, data: { file_name: doc.file_name, mime_type: doc.mime_type, url: signedUrl } });
    } else {
      const protocol = req.protocol || "http";
      const host = req.get("host") || "localhost:8016";
      const absoluteUrl = `${protocol}://${host}/uploads/${doc.storage_path}`;
      return res.status(200).json({ success: true, data: { file_name: doc.file_name, mime_type: doc.mime_type, url: absoluteUrl } });
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 4. UPDATE DOCUMENT NOTES ====================
export const updateDocument = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Document ID is required" });
    }

    const notes = req.body?.notes !== undefined ? req.body.notes : null;
    const authUserId = (req as any)?.user?.system_user_id || (req as any)?.user?.id || null;

    const rows: any[] = await db.sequelize.query(
      `UPDATE public.lead_documents
       SET notes = :notes,
           is_edited = TRUE,
           edited_by = :edited_by,
           updated_at = NOW()
       WHERE id = :id AND deleted_at IS NULL
       RETURNING *`,
      {
        replacements: {
          id,
          notes,
          edited_by: authUserId,
        },
        type: QueryTypes.SELECT,
      }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    return res.status(200).json({ success: true, message: "Document updated successfully", data: rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. DELETE DOCUMENT (SOFT DELETE) ====================
export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Document ID is required" });
    }

    const rows: any[] = await db.sequelize.query(
      `UPDATE public.lead_documents
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = :id AND deleted_at IS NULL
       RETURNING id, lead_id, deleted_at`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Document not found or already deleted." });
    }

    return res.status(200).json({ success: true, message: "Document deleted successfully", data: rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  getAllDocuments,
  listDocuments: getAllDocuments,
  uploadDocument,
  getDocumentUrl,
  updateDocument,
  updateDocumentNotes: updateDocument,
  deleteDocument,
  softDeleteDocument: deleteDocument,
};
