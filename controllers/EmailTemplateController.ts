import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import * as Yup from "yup";
import fs from "fs";
import path from "path";
import BaseController from "./BaseController";
import db, { SystemUserActivity } from "../models";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";

const { EmailTemplate } = db;
// Initialize the S3 client
const s3Client = new S3Client({
    region: process.env.AWS_REGION!, // from .env
});
const BASE_URL = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com`; // Assuming your app runs on port 8003
const SMTP_HOST = process.env.SMTP_HOST || "mail.dynsimulation.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "webmaster@dynsimulation.com";
const SMTP_PASS = process.env.SMTP_PASS || "dynsimulation@321";
const SMTP_FROM = process.env.SMTP_FROM || "LeadCRM <webmaster@dynsimulation.com>";

const transporter = nodemailer.createTransport({
    service: "smtp",
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
});




interface TemplateAttachment {
    path: string;
    name: string;
    type: string;
}




export default class EmailTemplateController extends BaseController {

    // Function to compress and upload files to S3
    private async saveFilesToS3(files?: Express.Multer.File[]): Promise<TemplateAttachment[]> {
        if (!files || !Array.isArray(files)) return [];

        const attachments: TemplateAttachment[] = [];

        for (let file of files) {
            const fileName = `${Date.now()}-${file.originalname}`;
            const filePath = path.join(process.cwd(), "uploads", "email-templates", fileName);

            // Compress image using sharp (only if the file is an image)
            if (file.mimetype.startsWith("image/")) {
                await sharp(file.buffer)
                    .resize(800) // Resize the image to a maximum width of 800px
                    .toFormat("jpeg", { quality: 80 }) // Compress to JPEG format with 80% quality
                    .toFile(filePath); // Save the compressed image to disk
            } else {
                // If it's not an image, save it as is
                fs.writeFileSync(filePath, file.buffer);
            }

            // Upload to S3
            const key = `email-templates/${fileName}`;
            await new Upload({
                client: s3Client,
                params: {
                    Bucket: process.env.AWS_S3_BUCKET_NAME!,
                    Key: key,
                    Body: fs.createReadStream(filePath),
                    ContentType: file.mimetype,
                    ACL: "private",
                },
            }).done();

            // Add attachment info
            attachments.push({
                path: key,
                name: file.originalname,
                type: file.mimetype,
            });

            // Delete the file from local disk after uploading to S3
            fs.unlinkSync(filePath);
        }

        return attachments;
    }


    /** POST /admin/email-template/upload */
    public uploadTemplate = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                title: Yup.string().required(),
                subject: Yup.string().required(),
                body: Yup.string().required(),
            });
            const body = await schema.validate(req.body, { abortEarly: false });

            // Save files to S3 and get attachment metadata
            const attachments = await this.saveFilesToS3(req.files as Express.Multer.File[]);

            const template = await EmailTemplate.create({
                id: uuidv4(),
                title: body.title,
                subject: body.subject,
                body: body.body,
                attachments // Save attachments in DB as JSON
            });

            // Log user activity
            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,
                    user_activity: `Uploaded email template ${template.title}`,
                    module: "email_templates",
                    type: "create",
                });
            }

            return this.sendSuccess(res, template, "Email template uploaded successfully");

        } catch (err: any) {
            console.error("uploadTemplate error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    /** POST /admin/email-template/send-to-email */
    public sendTemplateToEmail = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                templateId: Yup.string().uuid().required(),
                recipientEmail: Yup.string().email().required(),
            });
            const { templateId, recipientEmail } = await schema.validate(req.body, { abortEarly: false });

            const template = await EmailTemplate.findByPk(templateId);
            if (!template) return this.sendError(res, {}, "Email Template not found", 404);

            const attachments: TemplateAttachment[] = template.attachments || [];

            // Send email with attachments
            const mailOptions = {
                from: SMTP_FROM,
                to: recipientEmail,
                subject: template.subject,
                html: template.body,
                attachments: attachments.map((a: TemplateAttachment) => ({
                    filename: a.name,
                    path: `${BASE_URL}/${a.path.replace(/^\/+/, "")}`, // Full URL for attachments
                })),
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error("Error sending email:", error);
                    return this.sendError(res, error, "Error sending email", 500);
                }
                return this.sendSuccess(res, { messageId: info.messageId }, "Email sent successfully!");
            });

        } catch (err) {
            console.error("sendTemplateToEmail error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
      


    public getTemplate = async (req: Request, res: Response) => {
        const { id } = req.body; 
        try {
            const template = await EmailTemplate.findByPk(id);
            if (!template || template.deleted_at)
                return this.sendError(res, {}, "Email Template not found", 404);

            // Map attachments to include full URL
            const attachments = (template.attachments || []).map((a: any) => ({
                ...a,
                url: `${BASE_URL.replace(/\/$/, "")}/${a.path.replace(/^\/+/, "")}`,
            }));

            return this.sendSuccess(res, {
                ...template.dataValues,
                attachments, // Array of attachments with URLs
            }, "Email template fetched successfully");
        } catch (err) {
            console.error("getTemplate error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public getAllTemplates = async (req: Request, res: Response) => {
        try {
            const templates = await EmailTemplate.findAll({
                where: { deleted_at: null },
                order: [["created_at", "DESC"]],
            });

            const templatesWithAttachments = templates.map((t: any) => {
                const attachments = (t.attachments || []).map((a: any) => ({
                    ...a,
                    url: `${BASE_URL.replace(/\/$/, "")}/${a.path.replace(/^\/+/, "")}`,
                }));
                return {
                    ...t.dataValues,
                    attachments,
                };
            });

            return this.sendSuccess(res, templatesWithAttachments, "Email templates fetched successfully");
        } catch (err) {
            console.error("getAllTemplates error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };




    /** PUT /admin/email-template/:id/update */
    public updateTemplate = async (req: Request, res: Response) => {
        const { id } = req.body;
        try {
            const template = await EmailTemplate.findByPk(id);
            if (!template) return this.sendError(res, {}, "Email Template not found", 404);

            const schema = Yup.object({
                title: Yup.string().optional(),
                subject: Yup.string().optional(),
                body: Yup.string().optional(),
            });
            const body = await schema.validate(req.body, { abortEarly: false });

            let attachments: TemplateAttachment[] = template.attachments || [];

            if (req.files && Array.isArray(req.files) && req.files.length > 0) {
                // Delete old files from disk or S3
                attachments.forEach(a => {
                    const filePath = path.join(process.cwd(), "uploads", a.path);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                });

                // Save new files (await the promise)
                attachments = await this.saveFilesToS3(req.files as Express.Multer.File[]); // Add `await` here to resolve the Promise
            }

            // Update template fields
            template.title = body.title ?? template.title;
            template.subject = body.subject ?? template.subject;
            template.body = body.body ?? template.body;
            template.attachments = attachments;

            await template.save();

            // Return attachments with full URL
            const attachmentsWithUrl = attachments.map(a => ({
                ...a,
                url: `${BASE_URL.replace(/\/$/, "")}/uploads/${a.path.replace(/^\/+/, "")}`,
            }));

            return this.sendSuccess(
                res,
                { ...template.dataValues, attachments: attachmentsWithUrl },
                "Email template updated successfully"
            );
        } catch (err) {
            console.error("updateTemplate error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };



    /** DELETE /admin/email-template/:id */
    /** DELETE /admin/email-template/:id */
    public deleteTemplate = async (req: Request, res: Response) => {
        const { id } = req.body;

        try {
            const template = await EmailTemplate.findByPk(id);
            if (!template) return this.sendError(res, {}, "Email Template not found", 404);

            // Soft delete: set deleted_at timestamp
            template.deleted_at = new Date();
            await template.save();

            return this.sendSuccess(res, {}, "Email template soft-deleted successfully");
        } catch (err) {
            console.error("deleteTemplate error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

}
