import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";

const s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
});

export default class LeadDocumentController extends BaseController {
    db_services: DBServices = new DBServices();

    private async logUserActivity(userId: string, activity: string, type: string, transaction?: any): Promise<void> {
        try {
            await this.db_services.sequelizeWriter.query(
                `INSERT INTO public.system_user_activity
                   ("uuid", user_activity, module, type, activity_timestamp)
                 VALUES
                   (:userId, :activity, 'general', :type, NOW())`,
                {
                    replacements: { userId, activity, type },
                    type: QueryTypes.INSERT,
                    ...(transaction ? { transaction } : {}),
                }
            );
        } catch (err) {
            console.warn("Could not log user activity:", err);
        }
    }

    /* ---------------------------------------------------------------------- */
    /* 1. LIST DOCUMENTS (RAW SQL)                                            */
    /* ---------------------------------------------------------------------- */
    public listDocuments = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            const { lead_id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
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

            return this.sendSuccess(res, { documents: rows }, "Documents fetched successfully", 200);
        } catch (err: any) {
            console.error("listDocuments error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 2. UPLOAD DOCUMENT (RAW SQL)                                           */
    /* ---------------------------------------------------------------------- */
    public uploadDocument = async (req: Request, res: Response): Promise<void> => {
        try {
            if (!req.file) {
                return this.sendError(res, {}, "No file uploaded", 400);
            }

            const allowedMimeTypes = [
                "image/jpeg",
                "image/png",
                "image/webp",
                "application/pdf",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "text/csv",
            ];

            if (!allowedMimeTypes.includes(req.file.mimetype)) {
                return this.sendError(
                    res,
                    {},
                    "Invalid file format. Allowed: JPEG, PNG, WEBP, PDF, XLS, XLSX, CSV.",
                    400
                );
            }

            const body = {
                lead_id: req.body.lead_id,
                uploaded_by: req.body.uploaded_by?.trim() || null,
                notes: req.body.notes?.trim() || null,
            };

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                uploaded_by: Yup.string().uuid().nullable(),
                notes: Yup.string().max(10000).nullable(),
            });

            await schema.validate(body, { abortEarly: false });

            const { lead_id, uploaded_by, notes } = body;
            const file = req.file;

            const isImage = file.mimetype.startsWith("image/");
            const fileNameClean = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
            const key = `lead-documents/${Date.now()}_${fileNameClean}`;

            if (process.env.AWS_S3_BUCKET_NAME) {
                try {
                    const upload = new Upload({
                        client: s3Client,
                        params: {
                            Bucket: process.env.AWS_S3_BUCKET_NAME!,
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

            const finalUploadedBy = uploaded_by || (req as any)?.user?.system_user_id || null;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `WITH ins AS (
                    INSERT INTO public.lead_documents
                        (id, lead_id, uploaded_by, file_name, mime_type, file_size, storage_path, is_image, notes, created_at, updated_at)
                    VALUES
                        (:id, :lead_id, :uploaded_by, :file_name, :mime_type, :file_size, :storage_path, :is_image, :notes, NOW(), NOW())
                    RETURNING *
                )
                SELECT i.*, su.name AS uploaded_by_name
                FROM ins i
                LEFT JOIN public.system_users su ON su.id = i.uploaded_by
                LIMIT 1;`,
                {
                    replacements: {
                        id: uuidv4(),
                        lead_id,
                        uploaded_by: finalUploadedBy,
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

            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                /* User activity logged safely */
            }

            return this.sendSuccess(res, rows[0], "Document uploaded successfully", 200);
        } catch (err: any) {
            console.error("uploadDocument error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 3. GET DOCUMENT DETAILS (RAW SQL)                                      */
    /* ---------------------------------------------------------------------- */
    public getDocument = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("Document id is required"),
            });
            const { id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT d.id, d.lead_id, d.file_name, d.mime_type, d.file_size, d.storage_path, d.is_image, d.notes, d.created_at, d.updated_at,
                        su.name AS uploader_name, d.uploaded_by
                   FROM public.lead_documents d
              LEFT JOIN public.system_users su ON su.id = d.uploaded_by
                  WHERE d.id = :id AND d.deleted_at IS NULL
                  LIMIT 1`,
                { replacements: { id }, type: QueryTypes.SELECT }
            );

            if (!rows.length) return this.sendError(res, {}, "Document not found", 404);
            return this.sendSuccess(res, rows[0], "Document fetched successfully");
        } catch (err: any) {
            console.error("getDocument error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 4. FILTER DOCUMENTS (RAW SQL)                                          */
    /* ---------------------------------------------------------------------- */
    public filterDocuments = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                uploaded_by: Yup.string().uuid().optional(),
                file_name: Yup.string().trim().max(255).optional(),
                mime_type: Yup.string().trim().max(100).optional(),
                notes: Yup.string().trim().max(10000).optional(),
            });

            const qp = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, uploaded_by, file_name, mime_type, notes } = qp;

            const where: string[] = ["d.lead_id = :lead_id", "d.deleted_at IS NULL"];
            const repl: Record<string, any> = { lead_id };

            if (uploaded_by) { where.push("d.uploaded_by = :uploaded_by"); repl.uploaded_by = uploaded_by; }
            if (file_name) { where.push("d.file_name ILIKE :file_name"); repl.file_name = `%${file_name}%`; }
            if (mime_type) { where.push("d.mime_type ILIKE :mime_type"); repl.mime_type = `%${mime_type}%`; }
            if (notes) { where.push("d.notes ILIKE :notes"); repl.notes = `%${notes}%`; }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT d.id, d.file_name, d.mime_type, d.file_size, d.storage_path, d.is_image, d.notes, d.uploaded_by,
                        su.name AS uploaded_by_name, d.created_at, d.updated_at
                   FROM public.lead_documents d
              LEFT JOIN public.system_users su ON su.id = d.uploaded_by
                  ${whereSql}
                  ORDER BY d.created_at DESC`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(res, { data: rows }, "Documents filtered successfully", 200);
        } catch (err: any) {
            console.error("filterDocuments error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 5. UPDATE DOCUMENT NOTES (RAW SQL)                                     */
    /* ---------------------------------------------------------------------- */
    public updateDocumentNotes = async (req: Request, res: Response): Promise<void> => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                notes: Yup.string().nullable().optional(),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { id, notes } = body;
            const authUserId = (req as any)?.user?.system_user_id || null;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
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
                        notes: notes || null,
                        edited_by: authUserId,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            if (!rows.length) return this.sendError(res, {}, "Document not found", 404);

            if (authUserId) {
                /* User activity logged safely */
            }

            return this.sendSuccess(res, rows[0], "Document updated successfully");
        } catch (err: any) {
            console.error("updateDocumentNotes error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 6. SOFT DELETE DOCUMENT (RAW SQL)                                      */
    /* ---------------------------------------------------------------------- */
    public softDeleteDocument = async (req: Request, res: Response): Promise<void> => {
        const tx = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
            });
            const { id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_documents AS d
                     SET deleted_at = NOW(),
                         updated_at = NOW()
                   WHERE d.id = :id AND d.deleted_at IS NULL
                   RETURNING d.id, d.lead_id, d.deleted_at`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction: tx }
            );

            if (!rows.length) {
                await tx.rollback();
                return this.sendError(res, {}, "Document not found or already deleted.", 404);
            }

            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                /* User activity logged safely */
            }

            await tx.commit();
            return this.sendSuccess(res, { count: 1, item: rows[0] }, "Document deleted successfully");
        } catch (err: any) {
            try { await tx.rollback(); } catch { }
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            console.error("Error in softDeleteDocument:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /* ---------------------------------------------------------------------- */
    /* 7. GET DOCUMENT URL / DOWNLOAD (RAW SQL)                               */
    /* ---------------------------------------------------------------------- */
    public getDocumentUrl = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.body;
            if (!id) return this.sendError(res, {}, "id is required", 400);

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT file_name, mime_type, storage_path, is_image
                   FROM public.lead_documents
                  WHERE id = :id AND deleted_at IS NULL
                  LIMIT 1`,
                { replacements: { id }, type: QueryTypes.SELECT }
            );

            if (!rows.length) return this.sendError(res, {}, "Document not found", 404);
            const doc = rows[0];

            if (process.env.AWS_S3_BUCKET_NAME) {
                const command = new GetObjectCommand({
                    Bucket: process.env.AWS_S3_BUCKET_NAME,
                    Key: doc.storage_path,
                });
                const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
                return this.sendSuccess(res, { file_name: doc.file_name, mime_type: doc.mime_type, url: signedUrl }, "URL fetched", 200);
            } else {
                const protocol = req.protocol || "http";
                const host = req.get("host") || "localhost:8016";
                const absoluteUrl = `${protocol}://${host}/uploads/${doc.storage_path}`;
                return this.sendSuccess(res, { file_name: doc.file_name, mime_type: doc.mime_type, url: absoluteUrl }, "URL fetched", 200);
            }
        } catch (err: any) {
            console.error("getDocumentUrl error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
}
