import { Request, Response } from "express";
import BaseController from "./BaseController";
import DBServices from "../database/DBService";
import { literal, Op, QueryTypes } from "sequelize";
import * as Yup from "yup";
import { v4 as uuidv4 } from "uuid";
import { DateTime } from "luxon";
import path from "path";
import * as XLSX from "xlsx";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import { pipeline } from "stream";
import { promisify } from "util";
import { startEndTodayCA, } from "../utils/timeCA";
import FCMService from "../service/FCMService";
import { WebPushToken } from "../models";

// Define the type for the result of the query
interface Document {
    id: string;
    lead_id: string;
    deleted_at: Date;
}
/** POST /leads/activities/soft-delete */
interface Activity {
    id: string;
    lead_id: string;
    disposition_id: string;
    deleted_at: Date;
}
const normEmail = (e?: string | null) =>
    (typeof e === "string" && e.trim() !== "" ? e.trim().toLowerCase() : null);

const normPhone = (p?: string | null) => {
    if (typeof p !== "string") return null;
    const digits = p.replace(/\D+/g, "");
    return digits.length ? digits : null;
};


const normDigits = (v?: string | null) => {
    if (typeof v !== "string") return null;
    const d = v.replace(/\D+/g, "");
    return d.length ? d : null;
};



const toNull = (v: any) => (v === "" || v === undefined ? null : v);
interface Lead {
    id: string;
    lead_number: string;
    deleted_at: Date;
}

const streamPipeline = promisify(pipeline);
import db, { Lead, LeadDebtStatus, LeadSource, SystemUser, SystemUserActivity } from "../models";
// at top of LeadController.ts (or a types file)
interface LeadDocRow {
    file_name: string;
    storage_path: string; // e.g. "/uploads/leads/<leadId>/<file>"
}
// AWS S3 Client


// Multi-Country Timezone Support (India IST, USA EST/PST, UK GMT)
import { getTimezoneForCountry, formatToCountryDateTime, formatToCountryDate, getRemainingMinutes } from "../utils/timeZoneHelper";

// Default timezone set to India (IST)
const ZONE = "Asia/Kolkata";

// Required output formats
const DATE_FMT = "MM-dd-yyyy";
const DATETIME_FMT = "MM-dd-yyyy hh:mm a";

// Accept common input formats in target TZ
const INPUT_FORMATS = [
    "MM-dd-yyyy",          // ✅ allow date only
    "yyyy-MM-dd",          // ✅ ISO-like date only
    "MM-dd-yyyy h:mma",
    "MM-dd-yyyy hh:mma",
    "MM-dd-yyyy h:mm a",
    "MM-dd-yyyy hh:mm a",
    "MM-dd-yyyy HH:mm",
    "yyyy-MM-dd HH:mm",    // keep these two for ISO-ish fallbacks
    "yyyy-MM-dd'T'HH:mm",
];

// Parse user text -> Luxon DateTime in target TZ
function parseInCA(text?: string | null, countryOrZone?: string): DateTime | null {
    if (!text) return null;
    const targetZone = countryOrZone ? getTimezoneForCountry(countryOrZone) : ZONE;
    for (const f of INPUT_FORMATS) {
        const dt = (f === "MM-dd-yyyy" || f === "yyyy-MM-dd")
            ? DateTime.fromFormat(text, f, { zone: targetZone }).startOf("day")
            : DateTime.fromFormat(text, f, { zone: targetZone });
        if (dt.isValid) return dt;
    }
    const iso = DateTime.fromISO(text, { zone: targetZone });
    return iso.isValid ? iso : null;
}

function toCAString(d: any, countryOrZone?: string): string | null {
    return formatToCountryDateTime(d, countryOrZone || ZONE);
}
function toCADate(d: any, countryOrZone?: string): string | null {
    return formatToCountryDate(d, countryOrZone || ZONE);
}
// Remaining minutes from now until a UTC JS Date
function remainingMinutesCA(dueUtc: Date, countryOrZone?: string): number {
    return getRemainingMinutes(dueUtc, countryOrZone || ZONE);
}

// Convert timer pair for display (unchanged logic)
function toDisplayTimerPair(h: number, m: number) {
    return m === 60
        ? { timer_hours: Math.min(h + 1, 12), timer_minutes: 0 }
        : { timer_hours: h, timer_minutes: m };
}



const s3 = new S3Client({ region: process.env.AWS_REGION });
// ✅ Create and reuse ONE S3 client
const s3Client = new S3Client({
    region: process.env.AWS_REGION!, // from .env
    // no need to pass credentials manually if you have AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in env
});

// 2) now in IST
const nowIST = () => DateTime.now().setZone("Asia/Kolkata");






/** returns true if the user has a role named 'admin' (case-insensitive) */
async function isAdmin(sequelize: any, system_user_id: string): Promise<boolean> {
    const rows = await sequelize.query(
        `SELECT 1
         FROM public.user_role ur
         JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.system_user_id = :uid
          AND LOWER(r.name) = 'admin'
        LIMIT 1`,
        { replacements: { uid: system_user_id }, type: QueryTypes.SELECT }
    );
    return rows.length > 0;
}
export default class LeadController extends BaseController {
    db_services: DBServices = new DBServices();


    private bucketName = process.env.AWS_S3_BUCKET_NAME!;
    s3Client: any;



    /** "YYYY-MM-DD hh:mm AM" in IST */
    private toISTString(d: Date | string | null | undefined) {
        if (!d) return null;
        const js = d instanceof Date ? d : new Date(d);
        return DateTime.fromJSDate(js, { zone: "utc" })
            .setZone("Asia/Kolkata")
            .toFormat("yyyy-MM-dd hh:mm a");
    }

    /** Countdown (in minutes) from now(IST) to a UTC instant */
    private remainingMinutesIST(dueAtUtc: Date) {
        const dueIST = DateTime.fromJSDate(dueAtUtc, { zone: "utc" }).setZone("Asia/Kolkata");
        const nowIST = DateTime.now().setZone("Asia/Kolkata");
        return Math.max(0, Math.ceil(dueIST.diff(nowIST, "minutes").minutes));
    }

    /** Display pair: never show 60m (roll to +1h, 0m) */
    private toDisplayTimerPair(h: number, m: number) {
        return m === 60 ? { timer_hours: Math.min(h + 1, 12), timer_minutes: 0 } : { timer_hours: h, timer_minutes: m };
    }

    /** Build UTC range from date OR from/to given in IST; used to overlap with start_at/end_at */
    private buildUtcRange(date?: string, from?: string, to?: string) {
        const Z = "Asia/Kolkata";
        const hasTime = (s: string) => /T|\d{1,2}:\d{2}/.test(s);

        if (date) {
            const start = DateTime.fromISO(`${date}T00:00:00`, { zone: Z });
            const end = start.plus({ days: 1 });
            return { start_ts: start.toUTC().toISO({ suppressMilliseconds: true })!, end_ts: end.toUTC().toISO({ suppressMilliseconds: true })! };
        }
        let start_ts: string | undefined;
        let end_ts: string | undefined;

        if (from) {
            const f = hasTime(from) ? DateTime.fromISO(from, { zone: Z }) : DateTime.fromISO(`${from}T00:00:00`, { zone: Z });
            start_ts = f.toUTC().toISO({ suppressMilliseconds: true })!;
        }
        if (to) {
            const t0 = hasTime(to) ? DateTime.fromISO(to, { zone: Z }) : DateTime.fromISO(`${to}T00:00:00`, { zone: Z }).plus({ days: 1 });
            end_ts = t0.toUTC().toISO({ suppressMilliseconds: true })!;
        }
        return { start_ts, end_ts };
    }



    /** Check if a column exists (public schema). */
    private async columnExists(table: string, column: string): Promise<boolean> {
        const sql = `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=:table AND column_name=:column
        LIMIT 1
      `;
        const rows: any[] = await this.db_services.sequelizeWriter.query(sql, {
            replacements: { table, column },
            type: QueryTypes.SELECT,
        });
        return rows.length > 0;
    }

    /** Is the user an Admin? */
    private async isAdmin(userId: string): Promise<boolean> {
        const rows: any[] = await this.db_services.sequelizeWriter.query(
            `SELECT 1
             FROM public.user_role ur
             JOIN public.roles r ON r.id = ur.role_id
            WHERE ur.system_user_id = :uid
              AND LOWER(r.name) = 'admin'
            LIMIT 1`,
            { replacements: { uid: userId }, type: QueryTypes.SELECT }
        );
        return rows.length > 0;
    }

    public isAgent = async (userId: string): Promise<boolean> => {
        const rows: any[] = await this.db_services.sequelizeWriter.query(
            `SELECT 1
             FROM public.user_role ur
             JOIN public.roles r ON r.id = ur.role_id
            WHERE ur.system_user_id = :uid
              AND LOWER(r.name) = 'agent'
            LIMIT 1`,
            { replacements: { uid: userId }, type: QueryTypes.SELECT }
        );
        return rows.length > 0;
    };









    /** Lookup display name for an ID from a table. */
    private async lookupNameById(
        table: "lead_sources" | "lead_debt_statuses" | "consolidated_credit_statuses",
        id?: string | null
    ): Promise<string | null> {
        if (!id) return null;
        const rows: any[] = await this.db_services.sequelizeWriter.query(
            `SELECT name FROM public.${table} WHERE id = :id LIMIT 1`,
            { replacements: { id }, type: QueryTypes.SELECT }
        );
        return rows[0]?.name ?? null;
    }

    public createLead = async (req: Request, res: Response): Promise<void> => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const authUser = (req as any)?.user;
            if (!authUser?.system_user_id) {
                await transaction.rollback();
                this.sendError(res, {}, "Unauthorized - Please login again", 401);
                return;
            }
            const userId: string = authUser.system_user_id;

            const s = () =>
                Yup.string()
                    .transform((v, o) => (typeof o === "string" ? o.trim() : o))
                    .transform((v) => (v === "" ? undefined : v));

            const schema = Yup.object({
                full_name: s().required("Full name is required"),
                phone: s().required("phone number is required"),
                email: Yup.string().email().required("email is required"),
                whatsapp_number: s().optional(),
                address_line1: s().optional(),
                address_line2: s().optional(),
                city: s().optional(),
                state: s().optional(),
                postal_code: s().optional(),
                country: s().optional(),
                lead_score: Yup.number().integer().min(0).optional(),
                lead_quality: s().optional(),
                best_time_to_call: s().optional(),
                agent_id: s().uuid().optional(), // <- may be provided
                lead_source_id: s().uuid().optional(),
                currency: s().optional(),
                courier_name: s().optional(),
                tracking_number: s().optional(),
                lead_status: s().optional(),
                payment_status: s().optional(),
                delivery_status: s().optional(),
            });

            const input = await schema.validate(req.body, { abortEarly: false });

            if (!input.email && !input.phone && !input.whatsapp_number) {
                await transaction.rollback();
                this.sendError(res, {}, "Provide at least one of email / phone / whatsapp_number", 400);
                return;
            }

            const emailNorm = normEmail(input.email ?? null);
            const phoneNorm = input.phone
                ? input.phone.trim().replace(/(?!^\+)[^0-9]/g, "")
                : null;

            const whatsappNorm = input.whatsapp_number ? input.whatsapp_number.trim().replace(/(?!^\+)[^0-9]/g, "")
                : null;

            const orConds: string[] = [];
            const repl: Record<string, any> = {};
            if (emailNorm) { orConds.push("LOWER(email) = :e"); repl.e = emailNorm; }
            if (phoneNorm) { orConds.push("REGEXP_REPLACE(phone, '\\\\D', '', 'g') = :p"); repl.p = phoneNorm; }
            if (whatsappNorm) { orConds.push("REGEXP_REPLACE(whatsapp_number, '\\\\D', '', 'g') = :w"); repl.w = whatsappNorm; }

            if (orConds.length > 0) {
                const dupSql = `
          SELECT id, email, phone, whatsapp_number
            FROM public.leads
           WHERE deleted_at IS NULL
             AND (${orConds.join(" OR ")})
           LIMIT 1
        `;
                const dupRows: any[] = await this.db_services.sequelizeWriter.query(dupSql, {
                    replacements: repl, type: QueryTypes.SELECT, transaction
                });

                if (dupRows.length) {
                    const r = dupRows[0];
                    const conflicts: string[] = [];
                    if (emailNorm && (r.email || "").toLowerCase() === emailNorm) conflicts.push("email");
                    if (phoneNorm && normDigits(r.phone) === phoneNorm) conflicts.push("phone");
                    if (whatsappNorm && normDigits(r.whatsapp_number) === whatsappNorm) conflicts.push("whatsapp_number");

                    await transaction.rollback();
                    this.sendError(res, { conflicts }, `Lead already exists with this ${conflicts.join(" / ")}`, 409);
                    return;
                }
            }

            const id = uuidv4();
            const cols = [
                "id", "full_name", "email", "phone",
                "address_line1", "address_line2", "city", "state", "postal_code", "country",
                "lead_score", "lead_quality", "best_time_to_call",
                "agent_id", "whatsapp_number", "created_at", "updated_at",
                "lead_source_id", 
                "currency", "courier_name", "tracking_number",
                "lead_status", "payment_status", "delivery_status"
            ];
            const vals = [
                ":id", ":full_name", ":email", ":phone",
                ":address_line1", ":address_line2", ":city", ":state", ":postal_code", ":country",
                "COALESCE(:lead_score,0)", ":lead_quality", ":best_time_to_call",
                ":agent_id", ":whatsapp_number", "NOW()", "NOW()",
                ":lead_source_id", 
                ":currency", ":courier_name", ":tracking_number",
                ":lead_status", ":payment_status", ":delivery_status"
            ];

            const replacements: Record<string, any> = {
                id,
                full_name: input.full_name,
                email: emailNorm,
                phone: phoneNorm,
                address_line1: toNull(input.address_line1),
                address_line2: toNull(input.address_line2),
                city: toNull(input.city),
                state: toNull(input.state),
                postal_code: toNull(input.postal_code),
                country: toNull(input.country),
                lead_score: input.lead_score ?? 0,
                lead_quality: toNull(input.lead_quality),
                best_time_to_call: toNull(input.best_time_to_call),
                agent_id: toNull(input.agent_id),        // <-- if provided, it will be set now
                whatsapp_number: whatsappNorm,
                lead_source_id: toNull(input.lead_source_id),
                currency: toNull(input.currency) ?? "USD",
                courier_name: toNull(input.courier_name),
                tracking_number: toNull(input.tracking_number),
                lead_status: toNull(input.lead_status) ?? "New",
                payment_status: toNull(input.payment_status) ?? "Pending",
                delivery_status: toNull(input.delivery_status) ?? "Pending",
            };

            const insertSql = `
        INSERT INTO public.leads (${cols.join(", ")})
        VALUES (${vals.join(", ")})
        RETURNING id, lead_number, created_at, updated_at, agent_id
      `;
            const [row]: any[] = await this.db_services.sequelizeWriter.query(insertSql, {
                replacements, type: QueryTypes.SELECT, transaction
            });

            await transaction.commit();

            // Audit log (out of txn)
            await SystemUserActivity.create({
                system_user_id: userId,
                user_activity: `Created lead ${row.lead_number}`,
                module: "leads",
                type: "create",
            });

            // ✅ If an agent was selected during creation, notify THAT agent (single push)
            if (row.agent_id) {
                try {
                    await FCMService.notifyLeadAssigned(
                        String(row.agent_id),
                        {
                            id: String(row.id),
                            lead_number: String(row.lead_number),
                            full_name: String(input.full_name),
                        }
                    );
                } catch (pushErr) {
                    console.error("createLead assigned push failed:", pushErr);
                }
            }

            this.sendSuccess(res, {
                id: row.id,
                lead_number: row.lead_number,
                created_at: row.created_at,
                updated_at: row.updated_at,
                created_at_ca: toCAString(row.created_at),
                updated_at_ca: toCAString(row.updated_at),
                created_date_ca: toCADate(row.created_at),
                updated_date_ca: toCADate(row.updated_at),
            }, "Lead created successfully");
        } catch (err: any) {
            try { await transaction.rollback(); } catch { }
            if (err instanceof Yup.ValidationError) {
                this.sendError(res, {}, err.errors.join(", "), 400);
                return;
            }
            console.error("Error in createLead:", err);
            this.sendError(res, err, "Internal server error", 500);
        }
    };




    public softDeleteLeads = async (req: Request, res: Response) => {
        const tx = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                // Optional optimistic concurrency check: pass the last known updated_at
                updated_at: Yup.string().optional(),
            });

            const { id, updated_at } = await schema.validate(req.body, { abortEarly: false });

            const whereParts: string[] = [`l.id = :id`, `l.deleted_at IS NULL`];
            const replacements: any = { id };

            if (updated_at) {
                // rely on PG to cast text -> timestamptz; ensures “no change since I last fetched”
                whereParts.push(`l.updated_at = :updated_at`);
                replacements.updated_at = updated_at;
            }

            const sql = `
            UPDATE public.leads AS l
               SET deleted_at = NOW(),
                   updated_at = NOW()
             WHERE ${whereParts.join(" AND ")}
             RETURNING l.id, l.lead_number, l.deleted_at
        `;

            // Type the result rows to match the Lead interface
            const rows: Lead[] = await this.db_services.sequelizeWriter.query(sql, {
                replacements,
                type: QueryTypes.SELECT,
                transaction: tx,
            });

            // Log activity only if the lead is found and deleted
            if (rows.length) {
                const authUserId = (req as any)?.user?.system_user_id;  // Extract system_user_id from the authenticated user
                if (!authUserId) {
                    await tx.rollback();
                    return this.sendError(res, {}, "Unauthorized - Please login again", 401);
                }

                // Log the activity of the user
                await SystemUserActivity.create({
                    system_user_id: authUserId,  // Use system_user_id from the authenticated user
                    user_activity: `deleted lead for ${rows[0].lead_number}`,  // Describe the activity
                    module: 'leads',  // The module name
                    type: 'delete',  // Activity type
                });

                await tx.commit();

                return this.sendSuccess(
                    res,
                    { count: 1, items: rows },
                    "Lead deleted and activity logged"
                );
            }

            // If no rows found, the lead might already be deleted or there was a concurrency issue
            await tx.commit();
            return this.sendError(
                res,
                {},
                "No matching active lead found (already deleted or concurrency mismatch).",
                404
            );
        } catch (err: any) {
            try { await tx.rollback(); } catch { }
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            console.error("Error in softDeleteLeads:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getUnassignedLeads = async (req: Request, res: Response) => {
        try {
            const authUser = (req as any)?.user;
            if (!authUser || !authUser.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }

            const schema = Yup.object({
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),
                search: Yup.string().trim().max(200).optional(),
            });
            const qp = await schema.validate(req.query, { abortEarly: false });
            const page = Number(qp.page);
            const pageSize = Number(qp.pageSize);
            const offset = (page - 1) * pageSize;
            const search = (qp.search as string | undefined)?.trim();

            // --- WHERE ---
            const where: string[] = [`l.deleted_at IS NULL`, `l.agent_id IS NULL`];
            const repl: Record<string, any> = {};

            if (search && search.length) {
                where.push(`(l.full_name ILIKE :q OR l.email ILIKE :q OR l.phone ILIKE :q OR l.lead_number::text ILIKE :q)`);
                repl.q = `%${search}%`;
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            // --- COUNT ---
            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total FROM public.leads l ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            // --- DATA ---
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                  l.id, l.lead_number,
                  l.first_name, l.last_name, l.full_name,
                  l.email, l.phone,
                  l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                  l.lead_score, l.lead_quality, l.best_time_to_call,
                  l.agent_id, su.name AS agent_name,
                  l.created_at, l.updated_at,
                  ls.name AS lead_source_name,
                  
                  
                  l.whatsapp_number, l.note, l.lead_source_id, l.lead_status, l.payment_status, l.delivery_status, l.currency, l.courier_name, l.tracking_number,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400))::int AS lead_age_days
                FROM public.leads l
                LEFT JOIN public.system_users su ON su.id = l.agent_id
                LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
                
                
                ${whereSql}
                ORDER BY l.created_at DESC
                LIMIT :limit OFFSET :offset
                `,
                { replacements: { ...repl, limit: pageSize, offset }, type: QueryTypes.SELECT }
            );

            const data = rows.map((r) => ({
                id: r.id,
                lead_number: r.lead_number,
                owner_name: r.agent_name,
                best_time_to_call: r.best_time_to_call ?? null,
                lead_source: r.lead_source_name ?? null,
                lead_source_id: r.lead_source_id ?? null,
                lead_status: r.lead_status ?? null,
                payment_status: r.payment_status ?? null,
                delivery_status: r.delivery_status ?? null,
                currency: r.currency ?? null,
                courier_name: r.courier_name ?? null,
                tracking_number: r.tracking_number ?? null,
                
                
                whatsapp_number: r.whatsapp_number ?? null,
                first_name: r.first_name ?? null,
                last_name: r.last_name ?? null,
                full_name: r.full_name,
                email: r.email,
                phone: r.phone,
                note: r.note ?? null,
                address: {
                    line1: r.address_line1, line2: r.address_line2, city: r.city,
                    state: r.state, postal_code: r.postal_code, country: r.country,
                },
                lead_score: r.lead_score,
                lead_quality: r.lead_quality,
                agent: { id: r.agent_id, name: r.agent_name },
                created_at: r.created_at,
                updated_at: r.updated_at,
                // ✅ add formatted strings
                created_at_ca: toCADate(r.created_at),
                updated_at_ca: toCAString(r.updated_at),

                lead_age_days: r.lead_age_days,
                lead_age_label: `${r.lead_age_days} Days`,
            }));


            return this.sendSuccess(res, {
                data,
                pagination: { page, pageSize, totalPages: Math.ceil(total / pageSize), total },
            }, "Unassigned leads fetched successfully");
        } catch (err: any) {
            console.error("Error in getUnassignedLeads:", err);
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getAssignedLeads = async (req: Request, res: Response) => {
        try {
            const authUser = (req as any)?.user;
            if (!authUser || !authUser.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }
            const authUserId = authUser.system_user_id as string;
            const isAdminUser = await this.isAdmin(authUserId);

            const schema = Yup.object({
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),
                search: Yup.string().trim().max(200).optional(),
                agent_id: Yup.string().uuid().optional(),
                order: Yup.string().oneOf(["created_desc", "created_asc"]).default("created_desc"),
            });

            const qp = await schema.validate(req.query, { abortEarly: false });
            const page = Number(qp.page);
            const pageSize = Number(qp.pageSize);
            const offset = (page - 1) * pageSize;
            const search = (qp.search as string | undefined)?.trim();
            const filterAgentId = isAdminUser ? (qp.agent_id as string | undefined) : undefined;

            // --- WHERE ---
            const where: string[] = [`l.deleted_at IS NULL`, `l.agent_id IS NOT NULL`];
            const repl: Record<string, any> = {};

            if (!isAdminUser) {
                where.push(`l.agent_id = :me`);
                repl.me = authUserId;
            } else if (filterAgentId) {
                where.push(`l.agent_id = :filter_agent_id`);
                repl.filter_agent_id = filterAgentId;
            }

            if (search && search.length) {
                where.push(`(l.full_name ILIKE :q OR l.email ILIKE :q OR l.phone ILIKE :q OR l.lead_number::text ILIKE :q)`);
                repl.q = `%${search}%`;
            }

            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const orderSql = qp.order === "created_asc" ? `ORDER BY l.created_at ASC` : `ORDER BY l.created_at DESC`;

            // --- COUNT ---
            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total FROM public.leads l ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            // --- DATA ---
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                  l.id, l.lead_number,
                  l.first_name, l.last_name, l.full_name,
                  l.email, l.phone,
                  l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                  l.lead_score, l.lead_quality, l.best_time_to_call,
                  l.agent_id, su.name AS agent_name,
                  l.created_at, l.updated_at,
                  ls.name AS lead_source_name,
                  
                  
                  l.whatsapp_number, l.note, l.lead_source_id, l.lead_status, l.payment_status, l.delivery_status, l.currency, l.courier_name, l.tracking_number,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400))::int AS lead_age_days
                FROM public.leads l
                LEFT JOIN public.system_users su ON su.id = l.agent_id
                LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
                
                
                ${whereSql}
                ${orderSql}
                LIMIT :limit OFFSET :offset
                `,
                { replacements: { ...repl, limit: pageSize, offset }, type: QueryTypes.SELECT }
            );

            const data = rows.map((r) => ({
                id: r.id,
                lead_number: r.lead_number,
                owner_name: r.agent_name,
                best_time_to_call: r.best_time_to_call ?? null,
                lead_source: r.lead_source_name ?? null,
                lead_source_id: r.lead_source_id ?? null,
                lead_status: r.lead_status ?? null,
                payment_status: r.payment_status ?? null,
                delivery_status: r.delivery_status ?? null,
                currency: r.currency ?? null,
                courier_name: r.courier_name ?? null,
                tracking_number: r.tracking_number ?? null,
                
                
                whatsapp_number: r.whatsapp_number ?? null,
                first_name: r.first_name ?? null,
                last_name: r.last_name ?? null,
                full_name: r.full_name,
                email: r.email,
                phone: r.phone,
                note: r.note ?? null,
                address: {
                    line1: r.address_line1, line2: r.address_line2, city: r.city,
                    state: r.state, postal_code: r.postal_code, country: r.country,
                },
                lead_score: r.lead_score,
                lead_quality: r.lead_quality,
                agent: { id: r.agent_id, name: r.agent_name },
                created_at: r.created_at,
                updated_at: r.updated_at,
                created_at_ca: toCADate(r.created_at),   // ✅
                updated_at_ca: toCAString(r.updated_at), // ✅
                lead_age_days: r.lead_age_days,
                lead_age_label: `${r.lead_age_days} Days`,
            }));

            return this.sendSuccess(
                res,
                { data, pagination: { page, pageSize, totalPages: Math.ceil(total / pageSize), total } },
                "Assigned leads fetched successfully",
                200
            );
        } catch (err: any) {
            console.error("Error in getAssignedLeads:", err);
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public searchLeads = async (req: Request, res: Response) => {
        try {
            const authUser = (req as any)?.user;
            if (!authUser?.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }

            const s = () => Yup.string().trim().transform(v => (v === "" ? undefined : v));

            const schema = Yup.object({
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),
                q: s().max(200).optional(),

                full_name: s().max(240).optional(),
                email: s().max(240).optional(),
                phone: s().max(40).optional(),
                lead_number: s().max(40).optional(),
                city: s().max(120).optional(),
                state: s().max(120).optional(),

                agent_ids: Yup.array().of(s().uuid()).optional(),

                lead_source_id: s().uuid().optional(),
                lead_source: s().max(120).optional(),
                
                
                
                

                created_from: s().optional(),
                created_to: s().optional(),
            }).test(
                "at-least-one-filter",
                "Provide at least one filter field",
                (o) => {
                    if (!o) return false;
                    const {
                        q, full_name, email, phone, lead_number,
                        city, state, agent_ids,
                        lead_source_id, lead_source,
                        created_from, created_to
                    } = o as any;

                    return [
                        q, full_name, email, phone, lead_number,
                        city, state, agent_ids,
                        lead_source_id, lead_source,
                        created_from, created_to
                    ].some(v => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ""));
                }
            );

            const merged = { ...req.query, ...req.body };
            const qp = await schema.validate(merged, { abortEarly: false });

            const page = Number(qp.page);
            const pageSize = Number(qp.pageSize);
            const offset = (page - 1) * pageSize;

            // ----- schema drift checks
            const hasLeadSourceId = await this.columnExists("leads", "lead_source_id");
            const hasLeadSourceText = await this.columnExists("leads", "lead_source");
            
            
            
            

            let selectLeadSource = `NULL::text AS lead_source_name`;
            
            
            const joinExtras: string[] = [];

            if (hasLeadSourceId) {
                selectLeadSource = `ls.name AS lead_source_name`;
                joinExtras.push(`LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id`);
            } else if (hasLeadSourceText) {
                selectLeadSource = `l.lead_source AS lead_source_name`;
            }

            

            

            // ----- WHERE (all assigned leads)
            const where: string[] = [`l.deleted_at IS NULL`, `l.agent_id IS NOT NULL`];
            const repl: Record<string, any> = {};

            // ----- Agent filter (multi-agent)
            if (qp.agent_ids?.length) {
                where.push(`l.agent_id = ANY(ARRAY[:agent_ids]::uuid[])`);
                repl.agent_ids = qp.agent_ids;
            }

            // ----- Other filters
            if (qp.q) {
                where.push(`(l.full_name ILIKE :q OR l.email ILIKE :q OR l.phone ILIKE :q OR l.lead_number::text ILIKE :q)`);
                repl.q = `%${qp.q}%`;
            }
            if (qp.full_name) { where.push(`l.full_name ILIKE :full_name`); repl.full_name = `%${qp.full_name}%`; }
            if (qp.email) { where.push(`l.email ILIKE :email`); repl.email = `%${qp.email}%`; }
            if (qp.phone) { where.push(`l.phone ILIKE :phone`); repl.phone = `%${qp.phone}%`; }
            if (qp.lead_number) { where.push(`l.lead_number::text ILIKE :lead_number`); repl.lead_number = `%${qp.lead_number}%`; }
            if (qp.city) { where.push(`l.city ILIKE :city`); repl.city = `%${qp.city}%`; }
            if (qp.state) { where.push(`l.state ILIKE :state`); repl.state = `%${qp.state}%`; }

            if (qp.lead_source_id && hasLeadSourceId) { where.push(`l.lead_source_id = :lead_source_id`); repl.lead_source_id = qp.lead_source_id; }
            else if (qp.lead_source && hasLeadSourceText) { where.push(`l.lead_source ILIKE :lead_source`); repl.lead_source = `%${qp.lead_source}%`; }

            
            

            
            

            if (qp.created_from) {
                const f = parseInCA(qp.created_from);
                if (!f || !f.isValid) return this.sendError(res, {}, "Invalid created_from", 400);
                where.push(`l.created_at >= :created_from`);
                repl.created_from = f.toUTC().toISO({ suppressMilliseconds: true });
            }
            if (qp.created_to) {
                const t0 = parseInCA(qp.created_to);
                if (!t0 || !t0.isValid) return this.sendError(res, {}, "Invalid created_to", 400);
                const end = /^\d{2}-\d{2}-\d{4}$/.test(qp.created_to) ? t0.plus({ days: 1 }).startOf("day") : t0;
                where.push(`l.created_at < :created_to_plus`);
                repl.created_to_plus = end.toUTC().toISO({ suppressMilliseconds: true });
            }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            // ----- Count
            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total FROM public.leads l ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            // ----- Data
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                  l.id, l.lead_number,
                  l.full_name, l.email, l.phone,
                  l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                  l.lead_score, l.lead_quality, l.best_time_to_call,
                  l.agent_id, su.name AS agent_name,
                  l.created_at, l.updated_at,
                  ${selectLeadSource},
                  
                  
                  l.whatsapp_number, l.lead_source_id, l.lead_status, l.payment_status, l.delivery_status, l.currency, l.courier_name, l.tracking_number,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400))::int AS lead_age_days
                FROM public.leads l
                LEFT JOIN public.system_users su ON su.id = l.agent_id
                ${joinExtras.join("\n")}
                ${whereSql}
                ORDER BY l.created_at DESC
                LIMIT :limit OFFSET :offset
                `,
                { replacements: { ...repl, limit: pageSize, offset }, type: QueryTypes.SELECT }
            );

            const data = rows.map((r) => ({
                id: r.id,
                lead_number: r.lead_number,
                owner_name: r.agent_name,
                best_time_to_call: r.best_time_to_call ?? null,
                lead_source: r.lead_source_name ?? null,
                lead_source_id: r.lead_source_id ?? null,
                lead_status: r.lead_status ?? null,
                payment_status: r.payment_status ?? null,
                delivery_status: r.delivery_status ?? null,
                currency: r.currency ?? null,
                courier_name: r.courier_name ?? null,
                tracking_number: r.tracking_number ?? null,
                
                
                whatsapp_number: r.whatsapp_number ?? null,
                full_name: r.full_name,
                email: r.email,
                phone: r.phone,
                address: {
                    line1: r.address_line1, line2: r.address_line2, city: r.city,
                    state: r.state, postal_code: r.postal_code, country: r.country,
                },
                lead_score: r.lead_score,
                lead_quality: r.lead_quality,
                agent: { id: r.agent_id, name: r.agent_name },
                created_at: r.created_at,
                updated_at: r.updated_at,
                created_at_ca: toCADate(r.created_at),
                updated_at_ca: toCAString(r.updated_at),
                lead_age_days: r.lead_age_days,
                lead_age_label: `${r.lead_age_days} Days`,
            }));

            return this.sendSuccess(
                res,
                {
                    data,
                    pagination: {
                        page,
                        pageSize,
                        totalPages: Math.max(1, Math.ceil(total / pageSize)),
                    },
                },
                "Assigned leads filtered successfully",
                200
            );

        } catch (err: any) {
            console.error("searchLeads error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public bulkUploadFromFile = async (req: Request, res: Response) => {
        try {
          if (!req.file) {
            return this.sendError(res, {}, "No file uploaded (key must be `file`)", 400);
          }
      
          // --- Body-level controls ---
          const { agent_id, lead_source_id } = req.body;
          const UUID36 = /^[0-9a-fA-F-]{36}$/;
      
          // ✅ agent_id now optional
          if (agent_id && !UUID36.test(String(agent_id))) {
            return this.sendError(res, {}, "agent_id must be a valid UUID", 400);
          }
      
          // Optional body defaults (validate only if present)
          if (lead_source_id && !UUID36.test(String(lead_source_id))) {
            return this.sendError(res, {}, "lead_source_id must be a valid UUID", 400);
          }
          
      
          // --- Header normalization map ---
          const HEADER_MAP: Record<string, string> = {
            "full name": "full_name", "fullname": "full_name", "full_name": "full_name",
            "mobile": "phone", "mobile number": "phone", "mobile no": "phone", "phone": "phone",
            "email": "email", "e-mail": "email",
            "whatsapp": "whatsapp_number", "whatsapp number": "whatsapp_number", "whatsapp_number": "whatsapp_number",
            "address line1": "address_line1", "address_line1": "address_line1",
            "address line2": "address_line2", "address_line2": "address_line2",
            "city": "city", "state": "state", "postal code": "postal_code", "postal_code": "postal_code",
            "country": "country",
            "lead score": "lead_score", "lead_score": "lead_score",
            "lead quality": "lead_quality", "lead_quality": "lead_quality",
            "best time to call": "best_time_to_call", "best_time_to_call": "best_time_to_call",
            "agent id": "agent_id", "agent_id": "agent_id",
            "lead source id": "lead_source_id", "lead_source_id": "lead_source_id",
            "debt consolidation status id": "debt_consolidation_status_id",
            "debt_consolidation_status_id": "debt_consolidation_status_id",
            "consolidated credit status id": "consolidated_credit_status_id",
            "consolidated_credit_status_id": "consolidated_credit_status_id",
            "note": "note", "notes": "note"
          };
      
          // --- Row schema (row-level IDs optional, note optional) ---
          const rowSchema = Yup.object({
            full_name: Yup.string().required("full_name is required"),
            email: Yup.string().email("Invalid email").required("email is required"),
            phone: Yup.string().required("phone is required"),
            whatsapp_number: Yup.string().optional(),
            address_line1: Yup.string().optional(),
            address_line2: Yup.string().optional(),
            city: Yup.string().optional(),
            state: Yup.string().optional(),
            postal_code: Yup.string().optional(),
            country: Yup.string().optional(),
            lead_score: Yup.number().integer().min(0).optional(),
            lead_quality: Yup.string().optional(),
            best_time_to_call: Yup.string().optional(),
            note: Yup.string().optional(),
            agent_id: Yup.string().uuid().optional(),
            lead_source_id: Yup.string().uuid().optional(),
          });
      
          // --- Read sheet (Excel/CSV) ---
          const wb = XLSX.read(req.file.buffer, { type: "buffer" });
          const sheetName = wb.SheetNames?.[0];
          if (!sheetName) return this.sendError(res, {}, "No sheet found in file", 400);
          const sheet = wb.Sheets[sheetName];
      
          const raw: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          if (!raw.length) return this.sendError(res, {}, "Uploaded file is empty", 400);
      
          // Normalize headers
          const normalizeRow = (r: any) => {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(r)) {
              const mapped = HEADER_MAP[String(k).trim().toLowerCase()];
              if (mapped) out[mapped] = typeof v === "string" ? v.trim() : v;
            }
            return out;
          };
          const rows = raw.map(normalizeRow);
      
          // In-file duplicate trackers
          const seenEmail = new Map<string, number>();
          const seenPhone = new Map<string, number>();
          const seenWhats = new Map<string, number>();
      
          const clean: Array<{
            idx: number;
            data: any;
            emailNorm: string | null;
            phoneNorm: string | null;
            whatsappNorm: string | null;
          }> = [];
      
          const results: Array<{ index: number; success: boolean; data?: any; error?: string }> = [];
      
          // --- Validate + in-file duplicates ---
          for (let i = 0; i < rows.length; i++) {
            try {
              const v = await rowSchema.validate(rows[i], { abortEarly: false });
      
              const emailNorm = normEmail(v.email ?? null);
              const phoneNorm = normDigits(v.phone ?? null);
              const whatsappNorm = normDigits(v.whatsapp_number ?? null);
      
              if (!emailNorm && !phoneNorm && !whatsappNorm) {
                results.push({ index: i, success: false, error: "Row must include at least one of email/phone/whatsapp_number" });
                continue;
              }
      
              if (emailNorm) {
                if (seenEmail.has(emailNorm)) {
                  results.push({ index: i, success: false, error: `Duplicate email in file (first at row ${seenEmail.get(emailNorm)! + 1})` });
                  continue;
                }
                seenEmail.set(emailNorm, i);
              }
              if (phoneNorm) {
                if (seenPhone.has(phoneNorm)) {
                  results.push({ index: i, success: false, error: `Duplicate phone in file (first at row ${seenPhone.get(phoneNorm)! + 1})` });
                  continue;
                }
                seenPhone.set(phoneNorm, i);
              }
              if (whatsappNorm) {
                if (seenWhats.has(whatsappNorm)) {
                  results.push({ index: i, success: false, error: `Duplicate whatsapp_number in file (first at row ${seenWhats.get(whatsappNorm)! + 1})` });
                  continue;
                }
                seenWhats.set(whatsappNorm, i);
              }
      
              clean.push({ idx: i, data: v, emailNorm, phoneNorm, whatsappNorm });
            } catch (e: any) {
              const msg = Array.isArray(e?.errors) ? e.errors.join(", ") : (e?.message || "Row validation failed");
              results.push({ index: i, success: false, error: msg });
            }
          }
      
          if (!clean.length) {
            return this.sendError(res, { total: results.length, results }, "Bulk upload failed - all rows invalid", 400);
          }
      
          // --- DB duplicate check ---
          const emails = Array.from(new Set(clean.map(c => c.emailNorm).filter(Boolean))) as string[];
          const phones = Array.from(new Set(clean.map(c => c.phoneNorm).filter(Boolean))) as string[];
          const whats = Array.from(new Set(clean.map(c => c.whatsappNorm).filter(Boolean))) as string[];
      
          const rep: Record<string, any> = {};
          const emailParams = emails.map((_, i) => `:e${i}`).join(", ") || "NULL";
          const phoneParams = phones.map((_, i) => `:p${i}`).join(", ") || "NULL";
          const whatsParams = whats.map((_, i) => `:w${i}`).join(", ") || "NULL";
          emails.forEach((e, i) => rep[`e${i}`] = e);
          phones.forEach((p, i) => rep[`p${i}`] = p);
          whats.forEach((w, i) => rep[`w${i}`] = w);
      
          const existing: any[] = await this.db_services.sequelizeWriter.query(
            `
            SELECT id,
                   LOWER(email) AS email_norm,
                   REGEXP_REPLACE(phone, '\\\\D', '', 'g') AS phone_norm,
                   REGEXP_REPLACE(whatsapp_number, '\\\\D', '', 'g') AS whatsapp_norm
              FROM public.leads
             WHERE deleted_at IS NULL
               AND (
                     (email IS NOT NULL AND LOWER(email) IN (${emailParams}))
                  OR (phone IS NOT NULL AND REGEXP_REPLACE(phone, '\\\\D', '', 'g') IN (${phoneParams}))
                  OR (whatsapp_number IS NOT NULL AND REGEXP_REPLACE(whatsapp_number, '\\\\D', '', 'g') IN (${whatsParams}))
               )
            `,
            { replacements: rep, type: QueryTypes.SELECT }
          );
      
          const existEmailSet = new Set((existing || []).map(x => x.email_norm).filter(Boolean));
          const existPhoneSet = new Set((existing || []).map(x => x.phone_norm).filter(Boolean));
          const existWhatsSet = new Set((existing || []).map(x => x.whatsapp_norm).filter(Boolean));
      
          // --- Insert valid non-duplicate rows ---
          for (const c of clean) {
            const dupParts: string[] = [];
            if (c.emailNorm && existEmailSet.has(c.emailNorm)) dupParts.push("email");
            if (c.phoneNorm && existPhoneSet.has(c.phoneNorm)) dupParts.push("phone");
            if (c.whatsappNorm && existWhatsSet.has(c.whatsappNorm)) dupParts.push("whatsapp_number");
            if (dupParts.length) {
              results.push({ index: c.idx, success: false, error: `Duplicate in DB: ${dupParts.join(" & ")}` });
              continue;
            }
      
            try {
              const id = uuidv4();
      
              // ✅ Prefer row-level > body-level > NULL
              const rowAgentId = toNull(c.data.agent_id) ?? toNull(agent_id);
              const rowLeadSourceId = toNull(c.data.lead_source_id) ?? toNull(lead_source_id);
              
      
              const [inserted]: any[] = await this.db_services.sequelizeWriter.query(
                `
                INSERT INTO public.leads
                  (id, full_name, email, phone, whatsapp_number,
                   agent_id,
                   address_line1, address_line2, city, state, postal_code, country,
                   lead_score, lead_quality, best_time_to_call, note,
                   lead_source_id,
                   created_at, updated_at)
                VALUES
                  (:id, :full_name, :email, :phone, :whatsapp_number,
                   :agent_id,
                   :address_line1, :address_line2, :city, :state, :postal_code, :country,
                   COALESCE(:lead_score,0), :lead_quality, :best_time_to_call, :note,
                   :lead_source_id, :debt_consolidation_status_id, :consolidated_credit_status_id,
                   NOW(), NOW())
                RETURNING id, lead_number
                `,
                {
                  replacements: {
                    id,
                    full_name: c.data.full_name,
                    email: c.emailNorm,
                    phone: c.phoneNorm,
                    whatsapp_number: c.whatsappNorm,
                    agent_id: rowAgentId,
                    address_line1: toNull(c.data.address_line1),
                    address_line2: toNull(c.data.address_line2),
                    city: toNull(c.data.city),
                    state: toNull(c.data.state),
                    postal_code: toNull(c.data.postal_code),
                    country: toNull(c.data.country),
                    lead_score: c.data.lead_score ?? 0,
                    lead_quality: toNull(c.data.lead_quality),
                    best_time_to_call: toNull(c.data.best_time_to_call),
                    note: toNull(c.data.note),
                    lead_source_id: rowLeadSourceId,
                  },
                  type: QueryTypes.SELECT,
                }
              );
      
              results.push({ index: c.idx, success: true, data: inserted });
              if (c.emailNorm) existEmailSet.add(c.emailNorm);
              if (c.phoneNorm) existPhoneSet.add(c.phoneNorm);
              if (c.whatsappNorm) existWhatsSet.add(c.whatsappNorm);
            } catch (e: any) {
              const msg = e?.message || "Row insert failed";
              results.push({ index: c.idx, success: false, error: msg });
            }
          }
      
          const anySuccess = results.some(r => r.success);
          if (!anySuccess) {
            return this.sendError(res, { total: results.length, results }, "Bulk upload failed - all rows invalid", 400);
          }
      
          return this.sendSuccess(res, { total: results.length, results }, "Bulk upload processed");
        } catch (err: any) {
          console.error("bulkUploadFromFile error:", err);
          return this.sendError(res, {}, "Internal server error", 500);
        }
      };
      
    public getAssignedLeadNotifications = async (req: Request, res: Response) => {
        try {
          const auth = (req as any)?.user;
      
          if (!auth?.system_user_id) {
            return this.sendError(res, {}, "Unauthorized - Please login again", 401);
          }
      
          const agentUserId = String(auth.system_user_id);
      
          const schema = Yup.object({
            page: Yup.number().integer().min(1).default(1),
            pageSize: Yup.number().integer().min(1).max(200).default(10),
            search: Yup.string().trim().optional(),
          });
      
          const qp = await schema.validate(req.query, { abortEarly: false });
          const page = Number(qp.page);
          const pageSize = Number(qp.pageSize);
          const offset = (page - 1) * pageSize;
          const search = (qp.search as string | undefined)?.trim();
      
          const where: string[] = [
            `wn.recipient_user_id = :agentUserId`,
            `(wn.type = 'lead_assigned' OR wn.type = 'bulk_leads_assigned')`,
            // ✅ COMPLETELY EXCLUDE NOTIFICATIONS FOR DELETED LEADS
            `(wn.ref_id IS NULL OR (wn.ref_id IS NOT NULL AND l.id IS NOT NULL))`
          ];
          const repl: Record<string, any> = { agentUserId };
      
          if (search && search.length) {
            where.push(`(wn.title ILIKE :q OR wn.body ILIKE :q OR l.full_name ILIKE :q OR l.lead_number::text ILIKE :q)`);
            repl.q = `%${search}%`;
          }
      
          const whereSql = where.length ? `AND ${where.join(" AND ")}` : "";
      
          // Count total
          const countQuery = `
            SELECT COUNT(*)::int AS total 
            FROM public.web_push_notifications wn
            LEFT JOIN public.leads l ON wn.ref_id = l.id
            WHERE 1=1 ${whereSql}
          `;
          
          const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
            countQuery,
            { replacements: repl, type: QueryTypes.SELECT }
          );
      
          // Fetch notifications data
          const dataQuery = `
            SELECT 
              wn.id,
              wn.type,
              wn.title,
              wn.body,
              wn.created_at,
              wn.updated_at,
              wn.ref_id AS lead_id,
              l.lead_number,
              l.full_name,
              l.agent_id
            FROM public.web_push_notifications wn
            LEFT JOIN public.leads l ON wn.ref_id = l.id
            WHERE 1=1 ${whereSql}
            ORDER BY wn.created_at DESC
            LIMIT :limit OFFSET :offset
          `;
      
          const rows: any[] = await this.db_services.sequelizeWriter.query(
            dataQuery,
            { replacements: { ...repl, limit: pageSize, offset }, type: QueryTypes.SELECT }
          );
      
          console.log(`📋 Found ${rows.length} notifications for user ${agentUserId}`);
      
          return this.sendSuccess(
            res,
            {
              data: rows,
              pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
              },
            },
            "Assigned lead notifications fetched successfully"
          );
        } catch (err: any) {
          console.error("❌ Error in getAssignedLeadNotifications:", err);
      
          if (err.name === "ValidationError") {
            return this.sendError(res, {}, err.errors.join(", "), 400);
          }
      
          return this.sendError(res, err, "Internal server error", 500);
        }
      };

      
    public getLeadSources = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                search: Yup.string().trim().max(200).optional(),
            });

            const qp = await schema.validate(req.query, { abortEarly: false });
            const search = (qp.search as string | undefined)?.trim();

            // WHERE + replacements
            const where: string[] = [];
            const repl: Record<string, any> = {};

            if (search && search.length) {
                where.push(`(ls.name ILIKE :q)`);
                repl.q = `%${search}%`;
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            // Data
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ls.id, ls.name, ls.created_at, ls.updated_at
                 FROM public.lead_sources ls
                 ${whereSql}
                 ORDER BY ls.created_at ASC`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(res, { data: rows }, "Lead sources fetched successfully");
        } catch (err: any) {
            console.error("Error in getLeadSources:", err);
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
    public getLeadDebtStatuses = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                search: Yup.string().trim().max(200).optional(),
                is_active: Yup.boolean().default(true),
            });

            const qp = await schema.validate(req.query, { abortEarly: false });
            const search = (qp.search as string | undefined)?.trim();
            const isActive = qp.is_active as boolean;

            // WHERE + replacements
            const where: string[] = [];
            const repl: Record<string, any> = {};

            if (typeof isActive === "boolean") {
                where.push(`lds.is_active = :is_active`);
                repl.is_active = isActive;
            }
            if (search && search.length) {
                where.push(`(lds.name ILIKE :q)`);
                repl.q = `%${search}%`;
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            // Data
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT lds.id, lds.name, lds.is_active, lds.created_at, lds.updated_at
                 FROM public.lead_debt_statuses lds
                 ${whereSql}
                 ORDER BY lds.created_at ASC`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(res, { data: rows }, "Lead debt statuses fetched successfully");
        } catch (err: any) {
            console.error("Error in getLeadDebtStatuses:", err);
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
    public getConsolidatedCreditStatuses = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                search: Yup.string().trim().max(200).optional(),
                is_active: Yup.boolean().default(true),
            });

            const qp = await schema.validate(req.query, { abortEarly: false });
            const search = (qp.search as string | undefined)?.trim();
            const isActive = qp.is_active as boolean;

            // WHERE + replacements
            const where: string[] = [];
            const repl: Record<string, any> = {};

            if (typeof isActive === "boolean") {
                where.push(`ccs.is_active = :is_active`);
                repl.is_active = isActive;
            }
            if (search && search.length) {
                where.push(`(ccs.name ILIKE :q)`);
                repl.q = `%${search}%`;
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            // Data
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ccs.id, ccs.name, ccs.is_active, ccs.created_at, ccs.updated_at
                 FROM public.consolidated_credit_statuses ccs
                 ${whereSql}
                 ORDER BY ccs.created_at ASC`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(res, { data: rows }, "Consolidated credit statuses fetched successfully");
        } catch (err: any) {
            console.error("Error in getConsolidatedCreditStatuses:", err);
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
    public updateLead = async (req: Request, res: Response) => {
        const transaction = await this.db_services.sequelizeWriter.transaction();

        // ✅ allow only these fields to be updated
        const ALLOWED_FIELDS = new Set([
            "full_name", "email", "phone",
            "address_line1", "address_line2", "city", "state", "postal_code", "country",
            "lead_score", "lead_quality", "best_time_to_call",
            "agent_id", "lead_source_id",
            "whatsapp_number", "note",
            "currency",
            "courier_name", "tracking_number",
            "lead_status", "payment_status", "delivery_status",
        ]);

        const schema = Yup.object({
            id: Yup.string().uuid().required("Lead ID is required"),
            full_name: Yup.string().trim().optional(),
            email: Yup.string().email().optional(),
            phone: Yup.string().optional(),
            address_line1: Yup.string().optional(),
            address_line2: Yup.string().optional(),
            city: Yup.string().optional(),
            state: Yup.string().optional(),
            postal_code: Yup.string().optional(),
            country: Yup.string().optional(),
            lead_score: Yup.number().integer().min(0).optional(),
            lead_quality: Yup.string().optional(),
            best_time_to_call: Yup.string().optional(),
            agent_id: Yup.string().optional(),
            lead_source_id: Yup.string().optional(),
            whatsapp_number: Yup.string().optional(),
            note: Yup.string().optional(),
            currency: Yup.string().optional(),
            courier_name: Yup.string().optional(),
            tracking_number: Yup.string().optional(),
            lead_status: Yup.string().optional(),
            payment_status: Yup.string().optional(),
            delivery_status: Yup.string().optional(),
        });

        const toNull = (v: any) => (v === "" || v === undefined ? null : v);

        try {
            await schema.validate(req.body, { abortEarly: false });
            const { id, ...rawUpdate } = req.body as Yup.InferType<typeof schema>;

            // ✅ fetch existing lead
            const [existingLead]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT * FROM public.leads WHERE id = :id AND deleted_at IS NULL`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction }
            );
            if (!existingLead) {
                await transaction.rollback();
                return this.sendError(res, {}, "Lead not found", 404);
            }

            // ✅ filter only allowed fields
            const updateData: Record<string, any> = {};
            for (const [k, v] of Object.entries(rawUpdate)) {
                if (ALLOWED_FIELDS.has(k)) updateData[k] = toNull(v);
            }

            if (Object.keys(updateData).length === 0) {
                await transaction.rollback();
                return this.sendError(res, {}, "No fields to update", 400);
            }

            // ✅ build dynamic update query
            const setClauses = Object.keys(updateData).map((k) => `${k} = :${k}`);
            const replacements: any = { id, ...updateData };

            const [updatedLead]: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.leads
               SET ${setClauses.join(", ")}, updated_at = NOW()
             WHERE id = :id
             RETURNING *`,
                { replacements, type: QueryTypes.SELECT, transaction }
            );

            await transaction.commit();
            const payload = {
                ...updatedLead,
                created_at_ca: toCADate(updatedLead?.created_at),
                updated_at_ca: toCAString(updatedLead?.updated_at),
            };

            return this.sendSuccess(res, payload, "Lead updated successfully");
        } catch (err: any) {
            await transaction.rollback();
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getAllAgents = async (req: Request, res: Response) => {
        try {
            // must be logged in
            const authUser = (req as any)?.user;
            if (!authUser || !authUser.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }

            const schema = Yup.object({
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(30),
                search: Yup.string().trim().max(200).optional(),
            });

            const qp = await schema.validate(req.query, { abortEarly: false });
            const page = Number(qp.page);
            const pageSize = Number(qp.pageSize);
            const offset = (page - 1) * pageSize;
            const search = (qp.search as string | undefined)?.trim();

            // WHERE conditions
            const where: string[] = [`su.deleted_at IS NULL`];
            const repl: Record<string, any> = {};

            if (search && search.length) {
                where.push(`(su.name ILIKE :q OR su.email ILIKE :q OR su.mobile_number ILIKE :q)`);
                repl.q = `%${search}%`;
            }

            const whereSql = where.length ? `AND ${where.join(" AND ")}` : "";

            // COUNT
            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT COUNT(*)::int AS total
                  FROM public.system_users su
                 WHERE EXISTS (
                        SELECT 1
                          FROM public.user_role ur
                          JOIN public.roles r ON r.id = ur.role_id
                         WHERE ur.system_user_id = su.id
                           AND LOWER(r.name) = 'agent'
                      )
                   ${whereSql}
                `,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            // DATA
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT su.id,
                       su.name,
                       su.email,
                       su.mobile_number,
                       su.created_at,
                       su.updated_at
                  FROM public.system_users su
                 WHERE EXISTS (
                        SELECT 1
                          FROM public.user_role ur
                          JOIN public.roles r ON r.id = ur.role_id
                         WHERE ur.system_user_id = su.id
                           AND LOWER(r.name) = 'agent'
                      )
                   ${whereSql}
                 ORDER BY su.created_at DESC
                 LIMIT :limit OFFSET :offset
                `,
                { replacements: { ...repl, limit: pageSize, offset }, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(
                res,
                { data: rows, pagination: { page, pageSize, totalPages: Math.ceil(total / pageSize), total } },
                "Agents fetched"
            );
        } catch (err: any) {
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public filterUnassignedLeads = async (req: Request, res: Response) => {
        try {
            const authUser = (req as any)?.user;
            if (!authUser?.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }

            const s = () =>
                Yup.string()
                    .trim()
                    .transform(v => (v === "" ? undefined : v));

            const schema = Yup.object({
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),

                // free text (optional)
                q: s().max(200).optional(),

                // field filters (all optional; at least one required overall)
                full_name: s().max(240).optional(),
                email: s().max(240).optional(),
                phone: s().max(40).optional(),
                lead_number: s().max(40).optional(),
                city: s().max(120).optional(),
                state: s().max(120).optional(),

                lead_source_id: s().uuid().optional(),
                lead_source: s().max(120).optional(),
                
                
                
                

                created_from: Yup.string().trim().optional(),
                created_to: Yup.string().trim().optional(),
            }).test(
                "at-least-one-filter",
                "Provide at least one filter field",
                (o) => {
                    if (!o) return false;
                    const {
                        q,
                        full_name, email, phone, lead_number,
                        city, state,
                        lead_source_id, lead_source,
                        created_from, created_to,
                    } = o as any;
                    return [
                        q,
                        full_name, email, phone, lead_number,
                        city, state,
                        lead_source_id, lead_source,
                        created_from, created_to,
                    ].some(v => v !== undefined && v !== null && String(v).trim() !== "");
                }
            );

            const merged = { ...req.query, ...req.body };
            const qp = await schema.validate(merged, { abortEarly: false });

            const page = Number(qp.page);
            const pageSize = Number(qp.pageSize);
            const offset = (page - 1) * pageSize;


            // ----- schema drift checks
            const hasLeadSourceId = await this.columnExists("leads", "lead_source_id");
            const hasLeadSourceText = await this.columnExists("leads", "lead_source");
            
            
            
            

            let selectLeadSource = `NULL::text AS lead_source_name`;
            
            
            const joinExtras: string[] = [];

            if (hasLeadSourceId) {
                selectLeadSource = `ls.name AS lead_source_name`;
                joinExtras.push(`LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id`);
            } else if (hasLeadSourceText) {
                selectLeadSource = `l.lead_source AS lead_source_name`;
            }

            

            

            // ----- WHERE (always unassigned)
            const where: string[] = [`l.deleted_at IS NULL`, `l.agent_id IS NULL`];
            const repl: Record<string, any> = {};

            if (qp.q) {
                where.push(`(l.full_name ILIKE :q OR l.email ILIKE :q OR l.phone ILIKE :q OR l.lead_number::text ILIKE :q)`);
                repl.q = `%${qp.q}%`;
            }
            if (qp.full_name) { where.push(`l.full_name ILIKE :full_name`); repl.full_name = `%${qp.full_name}%`; }
            if (qp.email) { where.push(`l.email ILIKE :email`); repl.email = `%${qp.email}%`; }
            if (qp.phone) { where.push(`l.phone ILIKE :phone`); repl.phone = `%${qp.phone}%`; }
            if (qp.lead_number) { where.push(`l.lead_number::text ILIKE :lead_number`); repl.lead_number = `%${qp.lead_number}%`; }
            if (qp.city) { where.push(`l.city ILIKE :city`); repl.city = `%${qp.city}%`; }
            if (qp.state) { where.push(`l.state ILIKE :state`); repl.state = `%${qp.state}%`; }

            if (qp.lead_source_id && hasLeadSourceId) { where.push(`l.lead_source_id = :lead_source_id`); repl.lead_source_id = qp.lead_source_id; }
            else if (qp.lead_source && hasLeadSourceText) { where.push(`l.lead_source ILIKE :lead_source`); repl.lead_source = `%${qp.lead_source}%`; }

            
            

            
            

            // inclusive end-of-day for created_to
            if (qp.created_from) {
                const f = parseInCA(qp.created_from);
                if (!f || !f.isValid) return this.sendError(res, {}, "Invalid created_from", 400);
                where.push(`l.created_at >= :created_from`);
                repl.created_from = f.toUTC().toISO({ suppressMilliseconds: true });
            }
            if (qp.created_to) {
                const t0 = parseInCA(qp.created_to);
                if (!t0 || !t0.isValid) return this.sendError(res, {}, "Invalid created_to", 400);
                const end = /^\d{2}-\d{2}-\d{4}$/.test(qp.created_to) ? t0.plus({ days: 1 }).startOf("day") : t0;
                where.push(`l.created_at < :created_to_plus`);
                repl.created_to_plus = end.toUTC().toISO({ suppressMilliseconds: true });
            }


            const whereSql = `WHERE ${where.join(" AND ")}`;

            // ----- Count
            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total FROM public.leads l ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            // ----- Data
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
            SELECT
              l.id, l.lead_number,
              l.full_name, l.email, l.phone,
              l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
              l.lead_score, l.lead_quality, l.best_time_to_call,
              l.agent_id, su.name AS agent_name,
              l.created_at, l.updated_at,
              ${selectLeadSource},
              
              
              l.whatsapp_number, l.lead_source_id, l.lead_status, l.payment_status, l.delivery_status, l.currency, l.courier_name, l.tracking_number,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400))::int AS lead_age_days
            FROM public.leads l
            LEFT JOIN public.system_users su ON su.id = l.agent_id
            ${joinExtras.join("\n")}
            ${whereSql}
            ORDER BY l.created_at DESC
            LIMIT :limit OFFSET :offset
            `,
                { replacements: { ...repl, limit: pageSize, offset }, type: QueryTypes.SELECT }
            );

            const data = rows.map((r) => ({
                id: r.id,
                lead_number: r.lead_number,
                owner_name: r.agent_name, // null for unassigned
                best_time_to_call: r.best_time_to_call ?? null,
                lead_source: r.lead_source_name ?? null,
                lead_source_id: r.lead_source_id ?? null,
                lead_status: r.lead_status ?? null,
                payment_status: r.payment_status ?? null,
                delivery_status: r.delivery_status ?? null,
                currency: r.currency ?? null,
                courier_name: r.courier_name ?? null,
                tracking_number: r.tracking_number ?? null,
                
                
                whatsapp_number: r.whatsapp_number ?? null,
                full_name: r.full_name,
                email: r.email,
                phone: r.phone,
                address: {
                    line1: r.address_line1, line2: r.address_line2, city: r.city,
                    state: r.state, postal_code: r.postal_code, country: r.country,
                },
                lead_score: r.lead_score,
                lead_quality: r.lead_quality,
                agent: { id: r.agent_id, name: r.agent_name },
                created_at: r.created_at,
                updated_at: r.updated_at,
                created_at_ca: toCADate(r.created_at),   // ✅
                updated_at_ca: toCAString(r.updated_at), // ✅
                lead_age_days: r.lead_age_days,
                lead_age_label: `${r.lead_age_days} Days`,
            }));

            return this.sendSuccess(
                res,
                {
                    data,
                    pagination: {
                        page,
                        pageSize,
                        totalPages: Math.max(1, Math.ceil(total / pageSize)),
                    },
                },
                "Unassigned leads filtered successfully",
                200
            );

        } catch (err: any) {
            console.error("filterUnassignedLeads error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getAllDispositions = async (req: Request, res: Response) => {
        try {
            // ---- pagination + filters (from query string) ----
            const schema = Yup.object({
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),
                search: Yup.string().trim().max(200).optional(),
                is_active: Yup.mixed<boolean>()
                    .transform((v) => (v === "true" ? true : v === "false" ? false : v))
                    .optional(), // undefined => include all
            });
            const qp = await schema.validate(req.query, { abortEarly: false });
            const page = Number(qp.page);
            const pageSize = Number(qp.pageSize);
            const offset = (page - 1) * pageSize;
            const search = (qp.search as string | undefined)?.trim();
            const isActiveFilter = qp.is_active as boolean | undefined;

            // ---- discover columns (once) ----
            const [
                hasName,
                hasDescription,
                hasIsActive,
                hasCreatedAt,
                hasUpdatedAt,
                hasId,
            ] = await Promise.all([
                this.columnExists("lead_dispositions", "name"),
                this.columnExists("lead_dispositions", "description"),
                this.columnExists("lead_dispositions", "is_active"),
                this.columnExists("lead_dispositions", "created_at"),
                this.columnExists("lead_dispositions", "updated_at"),
                this.columnExists("lead_dispositions", "id"),
            ]);

            // ---- SELECT list with safe fallbacks ----
            const selectList = [
                hasId ? "ld.id" : "NULL::uuid AS id",
                hasName ? "ld.name AS name" : "NULL::text AS name",
                hasDescription ? "ld.description" : "NULL::text AS description",
                hasIsActive ? "ld.is_active" : "NULL::boolean AS is_active",
                hasCreatedAt ? "ld.created_at" : "NULL::timestamptz AS created_at",
                hasUpdatedAt ? "ld.updated_at" : "NULL::timestamptz AS updated_at",
            ].join(",\n       ");

            // ---- WHERE builder (only on existing cols) ----
            const where: string[] = [];
            const repl: Record<string, any> = {};

            if (typeof isActiveFilter === "boolean" && hasIsActive) {
                where.push("ld.is_active = :is_active");
                repl.is_active = isActiveFilter;
            }

            if (search && search.length) {
                const searchConds: string[] = [];
                if (hasName) searchConds.push("ld.name ILIKE :q");
                if (hasDescription) searchConds.push("ld.description ILIKE :q");
                if (searchConds.length) {
                    where.push(`(${searchConds.join(" OR ")})`);
                    repl.q = `%${search}%`;
                }
            }

            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            // ---- COUNT (same filters) ----
            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `
             SELECT COUNT(*)::int AS total
               FROM public.lead_dispositions ld
              ${whereSql}
             `,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            // ---- DATA ----
            const orderBy = hasName ? "ld.name ASC" : hasId ? "ld.id ASC" : "1";
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
             SELECT ${selectList}
               FROM public.lead_dispositions ld
              ${whereSql}
              ORDER BY ${orderBy}
              LIMIT :limit OFFSET :offset
             `,
                {
                    replacements: { ...repl, limit: pageSize, offset },
                    type: QueryTypes.SELECT,
                }
            );

            return this.sendSuccess(
                res,
                {
                    data: rows,
                    pagination: {
                        page,
                        pageSize,
                        totalPages: Math.ceil(total / pageSize),

                    },
                },
                "Dispositions fetched"
            );
        } catch (err: any) {
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            // include error in data for easier debugging if you prefer
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getLead = async (req: Request, res: Response) => {
        try {
            // 1️⃣ Check if user is authenticated
            const authUser = (req as any)?.user;
            if (!authUser || !authUser.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }

            // 2️⃣ Validate request body
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            await schema.validate(req.body, { abortEarly: false });

            const { lead_id } = req.body;

            // 3️⃣ Build WHERE condition (only filter by lead existence)
            const whereSql = `WHERE l.id = :lead_id AND l.deleted_at IS NULL`;

            // 4️⃣ Run query
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                    l.id,
                    l.lead_number,
                    l.first_name,
                    l.last_name,
                    l.full_name,
                    l.email,
                    l.phone,
                    l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                    l.lead_score, l.lead_quality, l.best_time_to_call,
                    l.agent_id,
                    su.name AS agent_name,
                    l.created_at,
                    l.updated_at,
                    ls.name AS lead_source_name,
                    
                    
                    l.note,
                    l.whatsapp_number, l.lead_source_id, l.lead_status, l.payment_status, l.delivery_status, l.currency, l.courier_name, l.tracking_number,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400))::int AS lead_age_days,
                    last_disp.latest_disposition
                FROM public.leads l
                LEFT JOIN public.system_users su ON su.id = l.agent_id
                LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
                
                
                LEFT JOIN LATERAL (
                    SELECT d."name" AS latest_disposition
                    FROM public.lead_activity_history ah
                    JOIN public.lead_dispositions d ON d.id = ah.disposition_id
                    WHERE ah.lead_id = l.id
                    ORDER BY ah.occurred_at DESC, ah.created_at DESC
                    LIMIT 1
                ) AS last_disp ON TRUE
                ${whereSql}
                `,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );

            if (!rows.length) {
                return this.sendError(res, {}, "Lead not found", 404);
            }

            const raw = rows[0];

            // 5️⃣ Build response
            const result: any = {
                id: raw.id,
                lead_number: raw.lead_number,
                owner_name: raw.agent_name,
                best_time_to_call: raw.best_time_to_call ?? null,
                lead_source: raw.lead_source_name ?? null,
                lead_source_id: raw.lead_source_id ?? null,
                lead_status: raw.lead_status ?? null,
                payment_status: raw.payment_status ?? null,
                delivery_status: raw.delivery_status ?? null,
                currency: raw.currency ?? null,
                courier_name: raw.courier_name ?? null,
                tracking_number: raw.tracking_number ?? null,
                debt_consolidation_status: raw.debt_consolidation_status_name ?? null,
                consolidated_credit_status: raw.consolidated_credit_status_name ?? null,
                whatsapp_number: raw.whatsapp_number ?? null,
                first_name: raw.first_name ?? null,
                last_name: raw.last_name ?? null,
                full_name: raw.full_name,
                email: raw.email,
                phone: raw.phone,
                note: raw.note,
                address: {
                    line1: raw.address_line1,
                    line2: raw.address_line2,
                    city: raw.city,
                    state: raw.state,
                    postal_code: raw.postal_code,
                    country: raw.country,
                },
                lead_score: raw.lead_score,
                lead_quality: raw.lead_quality,
                agent: { id: raw.agent_id, name: raw.agent_name },
                created_at: raw.created_at,
                updated_at: raw.updated_at,
                lead_age_days: raw.lead_age_days,
                lead_age_label: `${raw.lead_age_days} Days`,
            };

            return this.sendSuccess(res, result, "Lead fetched successfully");

        } catch (err: any) {
            console.error("Error in getLead:", err);
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getNextUnassignedLead = async (req: Request, res: Response) => {
        try {
            // 1️⃣ Find ONE random unassigned lead
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                    l.id, l.lead_number,
                    l.first_name, l.last_name, l.full_name,
                    l.email, l.phone,
                    l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                    l.lead_score, l.lead_quality, l.best_time_to_call,
                    l.agent_id, su.name AS agent_name,
                    l.created_at, l.updated_at,
                    ls.name AS lead_source_name,
                    
                    
                    l.whatsapp_number, l.note, l.lead_source_id, l.lead_status, l.payment_status, l.delivery_status, l.currency, l.courier_name, l.tracking_number,
                    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400))::int AS lead_age_days
                FROM public.leads l
                LEFT JOIN public.system_users su ON su.id = l.agent_id
                LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
                
                
                WHERE l.deleted_at IS NULL AND l.agent_id IS NULL
                ORDER BY RANDOM()
                LIMIT 1
                `,
                { type: QueryTypes.SELECT }
            );

            if (!rows.length) {
                return this.sendError(res, {}, "No unassigned leads available", 404);
            }

            const r = rows[0];

            // 2️⃣ Build response
            const data = {
                id: r.id,
                lead_number: r.lead_number,
                owner_name: r.agent_name,
                best_time_to_call: r.best_time_to_call ?? null,
                lead_source: r.lead_source_name ?? null,
                lead_source_id: r.lead_source_id ?? null,
                lead_status: r.lead_status ?? null,
                payment_status: r.payment_status ?? null,
                delivery_status: r.delivery_status ?? null,
                currency: r.currency ?? null,
                courier_name: r.courier_name ?? null,
                tracking_number: r.tracking_number ?? null,
                
                
                whatsapp_number: r.whatsapp_number ?? null,
                first_name: r.first_name ?? null,
                last_name: r.last_name ?? null,
                full_name: r.full_name,
                email: r.email,
                phone: r.phone,
                note: r.note ?? null,
                address: {
                    line1: r.address_line1,
                    line2: r.address_line2,
                    city: r.city,
                    state: r.state,
                    postal_code: r.postal_code,
                    country: r.country,
                },
                lead_score: r.lead_score,
                lead_quality: r.lead_quality,
                agent: { id: r.agent_id, name: r.agent_name },
                created_at: r.created_at,
                updated_at: r.updated_at,
                created_at_ca: toCADate(r.created_at),
                updated_at_ca: toCAString(r.updated_at),
                lead_age_days: r.lead_age_days,
                lead_age_label: `${r.lead_age_days} Days`,
            };

            return this.sendSuccess(res, data, "Next unassigned lead fetched successfully");
        } catch (err: any) {
            console.error("Error in getNextUnassignedLead:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    // controllers/LeadController.ts (inside your class)

    public assignLeadToAgent = async (req: Request, res: Response) => {
        try {
            const auth = (req as any)?.user;
            if (!auth?.system_user_id) return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            const authUserId = String(auth.system_user_id);

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                agent_id: Yup.string().uuid().required("agent_id is required"),
            });
            const { lead_id, agent_id } = await schema.validate(req.body, { abortEarly: false });

            const [admin, agent] = await Promise.all([
                this.isAdmin(authUserId),
                this.isAgent(authUserId),
            ]);
            if (!admin && !agent) return this.sendError(res, {}, "Forbidden", 403);

            const leadExists = await this.db_services.sequelizeWriter.query(
                `SELECT id, lead_number, full_name
           FROM public.leads
          WHERE id = :lid AND deleted_at IS NULL
          LIMIT 1`,
                { replacements: { lid: lead_id }, type: QueryTypes.SELECT }
            );
            if (!(leadExists as any[]).length) return this.sendError(res, {}, "Lead not found", 404);
            const leadRow = (leadExists as any[])[0];

            const targetIsAgent = await this.db_services.sequelizeWriter.query(
                `SELECT 1
           FROM public.system_users su
           JOIN public.user_role ur ON ur.system_user_id = su.id
           JOIN public.roles r ON r.id = ur.role_id
          WHERE su.id = :aid AND LOWER(r.name) = 'agent'
          LIMIT 1`,
                { replacements: { aid: agent_id }, type: QueryTypes.SELECT }
            );
            if (!(targetIsAgent as any[]).length) return this.sendError(res, {}, "agent_id is not a valid Agent", 400);

            const row: any[] = await this.db_services.sequelizeWriter.query(
                `WITH upd AS (
           UPDATE public.leads
              SET agent_id = :aid, updated_at = NOW()
            WHERE id = :lid AND deleted_at IS NULL
          RETURNING id, lead_number, agent_id, full_name
         )
         SELECT u.*, su.name AS agent_name
           FROM upd u
      LEFT JOIN public.system_users su ON su.id = u.agent_id
          LIMIT 1`,
                { replacements: { lid: lead_id, aid: agent_id }, type: QueryTypes.SELECT }
            );

            if (!row.length) return this.sendError(res, {}, "Lead not found or not updated", 404);

            // ✅ Notify ONLY the assigned agent
            try {
                await FCMService.notifyLeadAssigned(
                    String(agent_id),
                    {
                        id: String(row[0].id),
                        lead_number: String(row[0].lead_number),
                        full_name: String(row[0].full_name || leadRow.full_name || ""),
                    }
                );
            } catch (pushErr) {
                console.error("assignLeadToAgent push failed:", pushErr);
                // don't fail the API because of push
            }

            return this.sendSuccess(res, row[0], "Lead assigned");
        } catch (err: any) {
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public bulkAssignLeads = async (req: Request, res: Response) => {
        const t = await this.db_services.sequelizeWriter.transaction();
        try {
          const auth = (req as any)?.user;
          if (!auth?.system_user_id) {
            await t.rollback();
            return this.sendError(res, {}, "Unauthorized - Please login again", 401);
          }
          const authUserId = String(auth.system_user_id);
      
          const schema = Yup.object({
            lead_ids: Yup.array()
              .of(Yup.string().uuid().required())
              .min(1)
              .required("lead_ids is required"),
            agent_id: Yup.string().uuid().required("agent_id is required"),
          });
      
          const validated = await schema.validate(req.body, { abortEarly: false });
      
          const lead_ids: string[] = (validated.lead_ids as string[]).filter(Boolean);
          const agent_id: string = validated.agent_id as string;
      
          console.log(`🔄 Starting bulk assignment of ${lead_ids.length} leads to agent ${agent_id}`);
      
          const [admin, agent] = await Promise.all([
            this.isAdmin(authUserId),
            this.isAgent(authUserId),
          ]);
          if (!admin && !agent) {
            await t.rollback();
            return this.sendError(res, {}, "Forbidden", 403);
          }
      
          // validate target agent is actually an Agent
          const targetIsAgent = await this.db_services.sequelizeWriter.query(
            `SELECT 1
             FROM public.system_users su
             JOIN public.user_role ur ON ur.system_user_id = su.id
             JOIN public.roles r ON r.id = ur.role_id
             WHERE su.id = :aid AND LOWER(r.name) = 'agent'
             LIMIT 1`,
            { replacements: { aid: agent_id }, type: QueryTypes.SELECT, transaction: t }
          );
          if (!(targetIsAgent as any[]).length) {
            await t.rollback();
            return this.sendError(res, {}, "agent_id is not a valid Agent", 400);
          }
      
          // Process each lead assignment
          const results: Array<{ lead_id: string; success: boolean; msg?: string }> = [];
      
          for (const lid of lead_ids) {
            try {
              const updated: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.leads
                 SET agent_id = :aid, updated_at = NOW()
                 WHERE id = :lid AND deleted_at IS NULL
                 RETURNING id`,
                { replacements: { lid, aid: agent_id }, type: QueryTypes.SELECT, transaction: t }
              );
              if (!updated.length) {
                results.push({ lead_id: lid, success: false, msg: "Lead not found" });
              } else {
                results.push({ lead_id: lid, success: true });
              }
            } catch (e: any) {
              results.push({ lead_id: lid, success: false, msg: e?.message || "Failed" });
            }
          }
      
          await t.commit();
          
          // After transaction commit - send notifications
          const okIds = results.filter(r => r.success).map(r => r.lead_id);
          if (okIds.length) {
            try {
              // Fetch lead details for notifications
              const placeholders = okIds.map((_, i) => `:l${i}`).join(", ");
              const repl: Record<string, any> = {};
              okIds.forEach((id, i) => (repl[`l${i}`] = id));
      
              const leadRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, lead_number, full_name
                 FROM public.leads
                 WHERE id IN (${placeholders})
                   AND deleted_at IS NULL`,
                { replacements: repl, type: QueryTypes.SELECT }
              );
      
              const leads = leadRows.map(r => ({
                id: String(r.id),
                lead_number: String(r.lead_number),
                full_name: String(r.full_name || ""),
              }));
      
              console.log(`📨 Sending notifications for ${leads.length} assigned leads to agent ${agent_id}`);
      
              // 🔍 Check token status before sending
              const tokens = await FCMService.getAgentTokens(String(agent_id));
              if (tokens.length === 0) {
                console.log("❌ No valid tokens found. Please register FCM token first.");
              } else {
                console.log(`🔍 Token status check for ${tokens.length} tokens...`);
                for (const token of tokens) {
                  await FCMService.debugTokenValidity(token);
                }
              }
      
              // Send notifications
              const notifRes = await FCMService.notifyBulkLeadsAssigned(String(agent_id), leads);
              console.log("📊 Bulk assign push result:", notifRes);
            } catch (e) {
              console.error("❌ BulkAssignLeads push failed:", e);
            }
          } else {
            console.log("ℹ️ No successful lead assignments to notify");
          }
      
          return this.sendSuccess(res, { assigned_to: agent_id, results }, "Bulk assignment processed");
      
        } catch (err: any) {
          try { await t.rollback(); } catch { }
          if (err?.name === "ValidationError") {
            return this.sendError(res, {}, err.errors.join(", "), 400);
          }
          console.error("❌ Error in bulkAssignLeads:", err);
          return this.sendError(res, err, "Internal server error", 500);
        }
      };
    public getDispositionById = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                disposition_id: Yup.string().uuid().required("disposition_id is required"),
            });
            const { disposition_id } = await schema.validate(req.body, { abortEarly: false });

            const hasDescription = await this.columnExists("lead_dispositions", "description");
            const descriptionCol = hasDescription ? "ld.description" : "NULL::text AS description";

            const sql = `
        SELECT ld.id,
               ld."name" AS name,
               ${descriptionCol},
               ld.is_active,
               ld.created_at
          FROM public.lead_dispositions ld
         WHERE ld.id = :id
         LIMIT 1
      `;

            const rows = await this.db_services.sequelizeWriter.query(sql, {
                replacements: { id: disposition_id },
                type: QueryTypes.SELECT,
            });

            if (!rows.length) return this.sendError(res, {}, "Disposition not found", 404);
            return this.sendSuccess(res, rows[0], "Disposition");
        } catch (err: any) {
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    // LeadController.ts
    public addActivity = async (req: Request, res: Response): Promise<void> => {
        try {
            const authUser = (req as any)?.user;
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                disposition_id: Yup.string().uuid().required("disposition_id is required"),
                conversation: Yup.string().required("conversation is required"),
                agent_id: Yup.string().nullable().optional().transform(v => (v === "" ? undefined : v)),
                occurred_at_text: Yup.string().trim().optional(),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, disposition_id, conversation, occurred_at_text } = body;
            const finalAgentId = body.agent_id || authUser?.system_user_id || null;

            // validate disposition
            const disp: { id: string }[] = await this.db_services.sequelizeWriter.query(
                `SELECT id FROM public.lead_dispositions WHERE id = :id AND is_active = TRUE`,
                { replacements: { id: disposition_id }, type: QueryTypes.SELECT }
            );
            if (!disp.length) return this.sendError(res, {}, "Invalid disposition_id", 400);

            // parse occurred_at in Canada → UTC for DB
            const parsed = parseInCA(occurred_at_text);
            const occurredAtUTC: Date | null = parsed ? parsed.toUTC().toJSDate() : null;

            const [row]: any[] = await this.db_services.sequelizeWriter.query(
                `INSERT INTO public.lead_activity_history
                   (id, lead_id, agent_id, disposition_id, conversation, occurred_at, created_at, updated_at)
                 VALUES
                   (:id, :lead_id, :agent_id, :disposition_id, :conversation, COALESCE(:occurred_at, NOW()), NOW(), NOW())
                 RETURNING id, lead_id, agent_id, disposition_id, conversation, occurred_at, created_at, updated_at`,
                {
                    replacements: {
                        id: uuidv4(),
                        lead_id,
                        agent_id: finalAgentId,
                        disposition_id,
                        conversation,
                        occurred_at: occurredAtUTC,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            // Log the user activity
            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,  // Use the authenticated user's ID
                    user_activity: `Added activity for lead ${lead_id}`,  // Activity description
                    module: 'activity_management',  // The module name
                    type: 'create',  // Activity type
                });
            }

            return this.sendSuccess(res, {
                ...row,
                occurred_at_ca: toCAString(row.occurred_at),
                created_at_ca: toCAString(row.created_at),
                occurred_at_date_ca: toCADate(row.occurred_at),
            }, "Activity added successfully");
        } catch (err: any) {
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            console.error("Error in addActivity:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public updateActivity = async (req: Request, res: Response): Promise<void> => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("activity id is required"),
                disposition_id: Yup.string().uuid().optional(),
                conversation: Yup.string().optional(),
                agent_id: Yup.string().uuid().optional(),
                occurred_at_text: Yup.string().trim().optional(),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { id, disposition_id, conversation, agent_id, occurred_at_text } = body;

            // Check if the activity exists
            const exists: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, lead_id FROM public.lead_activity_history WHERE id = :id`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction }
            );
            if (!exists.length) {
                await transaction.rollback();
                return this.sendError(res, {}, "Activity not found", 404);
            }

            const lead_id = exists[0].lead_id;

            // Validate disposition if provided
            if (disposition_id) {
                const disp: any[] = await this.db_services.sequelizeWriter.query(
                    `SELECT id FROM public.lead_dispositions WHERE id = :id AND is_active = TRUE`,
                    { replacements: { id: disposition_id }, type: QueryTypes.SELECT, transaction }
                );
                if (!disp.length) {
                    await transaction.rollback();
                    return this.sendError(res, {}, "Invalid disposition_id", 400);
                }
            }

            const updates: string[] = [];
            const repl: Record<string, any> = { id };

            // Prepare fields for updates
            if (disposition_id) { updates.push("disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
            if (conversation !== undefined) { updates.push("conversation = :conversation"); repl.conversation = conversation; }
            if (agent_id !== undefined) { updates.push("agent_id = :agent_id"); repl.agent_id = agent_id; }

            if (occurred_at_text !== undefined) {
                const p = parseInCA(occurred_at_text);
                repl.occurred_at = p ? p.toUTC().toJSDate() : null;
                updates.push("occurred_at = :occurred_at");
            }

            if (!updates.length) {
                await transaction.rollback();
                return this.sendError(res, {}, "No fields to update", 400);
            }

            updates.push("updated_at = NOW()");
            updates.push("is_edited = TRUE"); // Mark as edited

            // Update the activity record in the database
            await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_activity_history
                SET ${updates.join(", ")}
                WHERE id = :id`,
                { replacements: repl, type: QueryTypes.UPDATE, transaction }
            );

            // Fetch the updated activity
            const [result]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ah.id,
                        d.name AS disposition,
                        ah.disposition_id,
                        ah.conversation,
                        ah.occurred_at,
                        ah.created_at,
                        ah.updated_at,
                        su.name AS agent_name,
                        ah.agent_id
                FROM public.lead_activity_history ah
                LEFT JOIN public.lead_dispositions d ON d.id = ah.disposition_id
                LEFT JOIN public.system_users su ON su.id = ah.agent_id
                WHERE ah.id = :id`,
                { replacements: { id }, type: QueryTypes.SELECT, transaction }
            );

            // Log the user activity in the SystemUserActivity table
            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,
                    user_activity: `Updated activity for activity ID ${result.id}`,  // Now logging activity ID instead of lead_id
                    module: 'activity_management',  // Module name
                    type: 'update',  // Activity type
                    transaction, // Ensure the log happens in the same transaction
                });
            }

            // Commit the transaction
            await transaction.commit();

            return this.sendSuccess(res, {
                ...result,
                occurred_at_ca: toCAString(result.occurred_at),
                created_at_ca: toCAString(result.created_at),
                updated_at_ca: toCAString(result.updated_at),
                occurred_at_date_ca: toCADate(result.occurred_at),
            }, "Activity updated successfully");
        } catch (err: any) {
            try {
                await transaction.rollback();
            } catch { }
            console.error("Error in updateActivity:", err);
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };



    public listActivities = async (req: Request, res: Response): Promise<void> => {
        try {
            const src: any = { ...req.query, ...req.body, ...req.params };
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                disposition_id: Yup.string().uuid().optional(),
                agent_id: Yup.string().uuid().optional(),
                from: Yup.string().trim().optional(), // MM-DD-YYYY or MM-DD-YYYY hh:mm a
                to: Yup.string().trim().optional(),
                conversation: Yup.string().trim().max(500).optional(),
                q: Yup.string().trim().max(500).optional(),
                has_conversation: Yup.boolean().optional(),
                page: Yup.number().integer().min(1).default(1),
                pageSize: Yup.number().integer().min(1).max(200).default(10),
            });

            const body = await schema.validate(src, { abortEarly: false });
            const { lead_id, disposition_id, agent_id } = body;
            const conversation = body.conversation ?? body.q ?? undefined;
            const page = Number(body.page);
            const pageSize = Number(body.pageSize);
            const offset = (page - 1) * pageSize;

            const where: string[] = ["ah.lead_id = :lead_id", "ah.deleted_at IS NULL"];
            const repl: Record<string, any> = { lead_id, limit: pageSize, offset };

            if (disposition_id) { where.push("ah.disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
            if (agent_id) { where.push("ah.agent_id = :agent_id"); repl.agent_id = agent_id; }
            if (conversation) { where.push("(ah.conversation ILIKE :conv)"); repl.conv = `%${conversation}%`; }
            if (typeof body.has_conversation === "boolean") {
                where.push(body.has_conversation ? "(btrim(ah.conversation) <> '')" : "(btrim(ah.conversation) = '')");
            }

            // Canada TZ range → UTC
            if (body.from) {
                const f = parseInCA(body.from);
                if (f) { where.push("ah.occurred_at >= :from_ts"); repl.from_ts = f.toUTC().toISO({ suppressMilliseconds: true })!; }
            }
            if (body.to) {
                const t = parseInCA(body.to);
                if (t) {
                    const tExclusive = /^\d{2}-\d{2}-\d{4}$/.test(body.to) ? t.plus({ days: 1 }).startOf("day") : t;
                    where.push("ah.occurred_at < :to_ts");
                    repl.to_ts = tExclusive.toUTC().toISO({ suppressMilliseconds: true })!;
                }
            }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total
               FROM public.lead_activity_history ah
               JOIN public.lead_dispositions d ON d.id = ah.disposition_id
          LEFT JOIN public.system_users su ON su.id = ah.agent_id
              ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            const activities: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ah.id,
                        d.name AS disposition,
                        ah.disposition_id,
                        ah.conversation,
                        ah.occurred_at,
                        ah.created_at,
                        ah.updated_at,
                        ah.is_edited,
                        su.name AS agent_name,
                        ah.agent_id
                 FROM public.lead_activity_history ah
                 JOIN public.lead_dispositions d ON d.id = ah.disposition_id
            LEFT JOIN public.system_users su ON su.id = ah.agent_id
                ${whereSql}
             ORDER BY ah.updated_at DESC, ah.occurred_at DESC
             LIMIT :limit OFFSET :offset`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            const data = activities.map(a => ({
                ...a,
                occurred_at_ca: toCAString(a.occurred_at),
                created_at_ca: toCAString(a.created_at),
                updated_at_ca: toCAString(a.updated_at),
                occurred_at_date_ca: toCADate(a.occurred_at),
                edited: a.is_edited ? true : false,
            }));


            return this.sendSuccess(res, {
                activities: data,
                pagination: { page, pageSize, totalPages: Math.ceil(total / pageSize), total },
            }, "Activity history fetched successfully");
        } catch (err: any) {
            console.error("Error in listActivities:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    // POST /leads/activities/list
    public filterlistActivities = async (req: Request, res: Response): Promise<void> => {
        try {
            const src: any = { ...req.query, ...req.body };

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                disposition_id: Yup.string().optional(),
                agent_id: Yup.string().optional(),
                conversation: Yup.string().trim().max(500).optional(),
                has_conversation: Yup.boolean().optional(),
                from: Yup.string().trim().optional(),
                to: Yup.string().trim().optional(),
            }).test("at-least-one-filter", "Provide at least one filter field", (o) => {
                if (!o) return false;
                const { disposition_id, agent_id, conversation, has_conversation, from, to } = o as any;
                return [disposition_id, agent_id, conversation, has_conversation, from, to]
                    .some(v => v !== undefined && v !== null && String(v).trim() !== "");
            });

            const body = await schema.validate(src, { abortEarly: false });
            const { lead_id, disposition_id, agent_id, conversation, has_conversation } = body;

            const repl: Record<string, any> = { lead_id, };
            const where: string[] = ["ah.lead_id = :lead_id"];

            if (disposition_id) { where.push("ah.disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
            if (agent_id) { where.push("ah.agent_id = :agent_id"); repl.agent_id = agent_id; }
            if (conversation) { where.push("ah.conversation ILIKE :conv"); repl.conv = `%${conversation}%`; }
            if (typeof has_conversation === "boolean") {
                where.push(has_conversation
                    ? "(ah.conversation IS NOT NULL AND btrim(ah.conversation) <> '')"
                    : "(ah.conversation IS NULL OR btrim(ah.conversation) = '')");
            }

            if (body.from) {
                const f = parseInCA(body.from);
                if (f) {
                    where.push("ah.occurred_at >= :from_ts");
                    repl.from_ts = f.toUTC().toISO({ suppressMilliseconds: true })!;
                }
            }
            if (body.to) {
                const t = parseInCA(body.to);
                if (t) {
                    const tExclusive = /^\d{2}-\d{2}-\d{4}$/.test(body.to) ? t.plus({ days: 1 }).startOf("day") : t;
                    where.push("ah.occurred_at < :to_ts");
                    repl.to_ts = tExclusive.toUTC().toISO({ suppressMilliseconds: true })!;
                }
            }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            const [{ total }]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COUNT(*)::int AS total FROM public.lead_activity_history ah ${whereSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT ah.id,
                        d.name AS disposition,
                        ah.disposition_id,
                        ah.conversation,
                        ah.occurred_at,
                        ah.created_at,
                        su.name AS agent_name,
                        ah.agent_id
                   FROM public.lead_activity_history ah
                   JOIN public.lead_dispositions d ON d.id = ah.disposition_id
              LEFT JOIN public.system_users su ON su.id = ah.agent_id
                  ${whereSql}
               ORDER BY ah.occurred_at DESC`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            const activities = rows.map(a => ({
                ...a,
                occurred_at_ca: toCAString(a.occurred_at),
                created_at_ca: toCAString(a.created_at),
                occurred_at_date_ca: toCADate(a.occurred_at),
            }));

            return this.sendSuccess(res, {
                activities,

            }, "Activity history fetched successfully");
        } catch (err: any) {
            console.error("Error in listActivities:", err);
            if (err.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };



    public softDeleteActivity = async (req: Request, res: Response): Promise<void> => {
        const tx = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                updated_at: Yup.string().optional(),
            });

            const { id, updated_at } = await schema.validate(req.body, { abortEarly: false });

            const where: string[] = ["ah.id = :id", "ah.deleted_at IS NULL"];
            const repl: any = { id };

            if (updated_at) {
                where.push("ah.updated_at = :updated_at");
                repl.updated_at = updated_at;
            }

            // Perform the soft delete on the activity
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_activity_history AS ah
                  SET deleted_at = NOW(),
                      updated_at = NOW()
                WHERE ${where.join(" AND ")}
                RETURNING ah.id, ah.lead_id, ah.disposition_id, ah.deleted_at`,
                { replacements: repl, type: QueryTypes.SELECT, transaction: tx }
            );

            // If no matching activity found, return error
            if (!rows.length) {
                await tx.rollback();
                return this.sendError(res, {}, "No matching active activity found (already deleted or concurrency mismatch).", 404);
            }

            // Log the activity (Admin's action)
            const adminUserId = (req as any)?.user?.system_user_id;  // Fetch admin user id from request context
            if (adminUserId) {
                // Log the activity in SystemUserActivity table
                await SystemUserActivity.create({
                    system_user_id: adminUserId,  // Admin's ID performing the delete action
                    user_activity: `deleted activity for lead ${rows[0].lead_id}`,  // Activity description
                    module: 'activity_management',  // Module name
                    type: 'delete',  // Activity type
                });
            }

            // Commit the transaction after logging
            await tx.commit();

            // Return success response
            return this.sendSuccess(res, { count: 1, item: rows[0] }, "Activity deleted successfully");
        } catch (err: any) {
            try { await tx.rollback(); } catch { }
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            console.error("Error in softDeleteActivity:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    
    ;
    
    
    
    public getActivityById = async (req: Request, res: Response) => {
        try {
            // ✅ Validate body
            const schema = Yup.object({
                activity_id: Yup.string().uuid().required("activity_id is required"),
            });
            await schema.validate(req.body, { abortEarly: false });

            const { activity_id } = req.body;

            // ✅ Query single activity with disposition + agent name
            const rows = await this.db_services.sequelizeWriter.query(
                `SELECT lah.id,
                    lah.lead_id,
                    lah.conversation,
                    lah.occurred_at,
                    su.name AS agent_name,
                    d.name AS disposition
               FROM public.lead_activity_history lah
          LEFT JOIN public.system_users su ON su.id = lah.agent_id
          LEFT JOIN public.lead_dispositions d ON d.id = lah.disposition_id
              WHERE lah.id = :activity_id`,
                { replacements: { activity_id }, type: QueryTypes.SELECT }
            );

            if (!rows.length) {
                return this.sendError(res, {}, "Activity not found", 404);
            }

            return this.sendSuccess(res, rows[0], "Activity fetched successfully");
        } catch (err: any) {
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    private fitToAllowedTimerBuckets(diffMinutesRaw: number) {
        const ALLOWED = [5, 10, 15, 20, 30, 60];

        // Clamp to DB constraints window (5..720)
        let diffMin = Math.ceil(diffMinutesRaw);
        if (diffMin < 5) diffMin = 5;
        if (diffMin > 12 * 60) diffMin = 12 * 60;

        let hours = Math.floor(diffMin / 60);
        let rem = diffMin - hours * 60;

        let minutes: number;
        if (rem === 0) {
            // exact hour → represent as (hours-1, 60)
            minutes = 60;
            hours = Math.max(0, hours - 1);
        } else {
            // round remainder up to next allowed bucket
            minutes = ALLOWED.find((m) => m >= rem) ?? 60;
            if (minutes === 60) {
                // carry to hour using (hours,60) → stored as (hours,60) but we keep (hours-1,60) form
                if (hours < 12) hours += 1;
                minutes = 60;
                hours = Math.max(0, hours - 1);
            }
        }
        return { timer_hours: hours, timer_minutes: minutes };
    }
    private taskTypeLabel(t: string) {
        switch ((t || "").toLowerCase()) {
            case "meeting": return "Meeting";
            case "phonecall": return "Phone Call";
            case "followup": return "Follow Up";
            default: return (t || "").charAt(0).toUpperCase() + (t || "").slice(1);
        }
    }
    public createTask = async (req: Request, res: Response) => {
        try {
            const tokenUser = (req as any)?.user ?? {};
            const authUserId: string | undefined = tokenUser.system_user_id || tokenUser.id;
            const authUserName: string | undefined = tokenUser.name || tokenUser.full_name;

            const cleaned = {
                ...req.body,
                assigned_agent_id: req.body?.assigned_agent_id?.trim?.()
                    ? String(req.body.assigned_agent_id).trim()
                    : (authUserId || undefined),
                task_type: req.body?.task_type?.trim?.()
                    ? String(req.body.task_type).trim().toLowerCase()
                    : "followup",
                subject: req.body?.subject?.trim?.() ? String(req.body.subject).trim() : undefined,
                location: req.body?.location?.trim?.() ? String(req.body.location).trim() : undefined,
            };

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                details: Yup.string().optional(),
                assigned_agent_id: Yup.string().optional(),
                task_type: Yup.string().oneOf(["meeting", "phonecall", "followup"]).required(),
                start_at_text: Yup.string().trim().required("start_at_text is required"),
                end_at_text: Yup.string().trim().required("end_at_text is required"),
                subject: Yup.string().trim().max(255).optional(),
                location: Yup.string().trim().max(255).required("location is required"),
            });
            const body = await schema.validate(cleaned, { abortEarly: false });

            const { lead_id, details, assigned_agent_id, task_type, location } = body;
            if (!assigned_agent_id)
                return this.sendError(res, {}, "assigned_agent_id is required (missing in body and token)", 400);

            const leadRow: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT full_name FROM public.leads WHERE id = :lead_id LIMIT 1`,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );
            if (!leadRow?.[0]?.full_name) return this.sendError(res, {}, "Lead not found", 404);
            const leadFullName: string = leadRow[0].full_name;

            const typeLabel = (t: string) =>
                t === "meeting" ? "Meeting" : t === "phonecall" ? "Phone Call" : "Follow Up";
            const subject = body.subject?.length ? body.subject : `${typeLabel(task_type)}: ${leadFullName}`;

            // ⬇️ Parse in Canada TZ
            const start = parseInCA(body.start_at_text!);
            const end = parseInCA(body.end_at_text!);
            if (!start || !end) return this.sendError(res, {}, "Invalid start_at_text or end_at_text format", 400);
            if (end <= start) return this.sendError(res, {}, "end_at must be after start_at", 400);

            const startAtUtc = start.toUTC().toJSDate();
            const endAtUtc = end.toUTC().toJSDate();

            // timer from now (Canada) -> start
            const remaining = remainingMinutesCA(startAtUtc);
            const toDbTimerPair = (remainingMin: number) => {
                const ALLOWED = [5, 10, 15, 20, 30, 60] as const, MAX = 12 * 60;
                let mins = Math.min(Math.max(Math.ceil(remainingMin), 5), MAX);
                let hrs = Math.floor(mins / 60), rem = mins - hrs * 60;
                if (rem === 0) return { timer_hours: Math.max(0, hrs - 1), timer_minutes: 60 as 60 };
                const m = ALLOWED.find(a => a >= rem);
                if (!m || m === 60) return { timer_hours: hrs, timer_minutes: 60 as 60 };
                return { timer_hours: hrs, timer_minutes: m };
            };
            const dbPair = toDbTimerPair(remaining);

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `WITH ins AS (
               INSERT INTO public.lead_tasks
                 (id, lead_id, assigned_agent_id, details, task_type, subject, location,
                  timer_minutes, timer_hours, due_at, start_at, end_at,
                  status, created_at, updated_at)
               VALUES
                 (:id, :lead_id, :assigned_agent_id, :details, :task_type, :subject, :location,
                  :timer_minutes, :timer_hours, :due_at, :start_at, :end_at,
                  'pending', NOW(), NOW())
               RETURNING id, lead_id, assigned_agent_id, details, task_type, subject, location,
                         timer_hours, timer_minutes, start_at, end_at, status
             )
             SELECT i.*,
                    COALESCE(su.name, :fallback_agent_name) AS agent_name,
                    l.full_name,
                    split_part(l.full_name, ' ', 1) AS lead_first_name,
                    CASE WHEN strpos(l.full_name,' ') > 0
                         THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                         ELSE NULL END AS lead_last_name
               FROM ins i
          LEFT JOIN public.system_users su ON su.id = i.assigned_agent_id
               JOIN public.leads l ON l.id = i.lead_id
              LIMIT 1`,
                {
                    replacements: {
                        id: uuidv4(),
                        lead_id, assigned_agent_id, details, task_type, subject, location,
                        timer_minutes: dbPair.timer_minutes, timer_hours: dbPair.timer_hours,
                        due_at: startAtUtc, start_at: startAtUtc, end_at: endAtUtc,
                        fallback_agent_name: authUserName ?? null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            const rec = rows[0];
            const displayPair = toDisplayTimerPair(rec.timer_hours, rec.timer_minutes);

            // NOTE: kept key names *_ist for backward-compat; values are CANADA TZ now
            const toCA = (d: any) => toCAString(d);
            // Log activity after the task is created
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,  // Use system_user_id from the request's authentication context
                    user_activity: `Created task for lead ${rec.lead_id}`,  // Describe the activity
                    module: 'task_management',  // Module name
                    type: 'create',  // Activity type
                });
            }

            return this.sendSuccess(res, {
                id: rec.id,
                type: rec.task_type,
                subject: rec.subject,
                details: rec.details,
                location: rec.location,
                status: rec.status,
                start_at: rec.start_at, start_at_ist: toCA(rec.start_at), // Canada time
                end_at: rec.end_at, end_at_ist: toCA(rec.end_at),   // Canada time
                owner_name: rec.agent_name,
                organizer_name: rec.agent_name,
                associated_lead: {
                    id: rec.lead_id,
                    first_name: rec.lead_first_name,
                    last_name: rec.lead_last_name,
                    full_name: rec.full_name,
                },
                timer_hours: displayPair.timer_hours,
                timer_minutes: displayPair.timer_minutes,
            }, "Task created", 200);
        } catch (err: any) {
            console.error("createTask error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };
    public listTasks = async (req: Request, res: Response) => {
        try {
            const tokenUser = (req as any)?.user ?? {};
            const fallbackAgentName: string | undefined = tokenUser.name || tokenUser.full_name || undefined;

            // ---- Validation
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                order: Yup.string()
                    .oneOf(["start_desc", "start_asc", "created_desc", "created_asc"])
                    .default("created_desc"),
            });

            const qp = await schema.validate(req.body, { abortEarly: false });
            const { lead_id } = qp;

            // ---- Ordering
            const orderMap: Record<string, string> = {
                start_desc: "t.start_at DESC,  t.created_at DESC",
                start_asc: "t.start_at ASC,   t.created_at DESC",
                created_desc: "t.created_at DESC, t.start_at DESC",
                created_asc: "t.created_at ASC,  t.start_at DESC",
            };
            const orderSql = `ORDER BY ${orderMap[qp.order] ?? orderMap.created_desc}`;

            // ---- Query
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id, t.task_type, t.subject, t.details, t.location,
                        t.status, t.timer_hours, t.timer_minutes,
                        t.start_at, t.end_at,
                        t.assigned_agent_id,
                        COALESCE(su.name, :fallback_agent_name) AS agent_name,
                        t.created_at, t.updated_at,
                        l.id AS lead_id, l.full_name,
                        split_part(l.full_name, ' ', 1) AS lead_first_name,
                        CASE WHEN strpos(l.full_name,' ') > 0
                             THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                             ELSE NULL END AS lead_last_name
                   FROM public.lead_tasks t
              LEFT JOIN public.system_users su ON su.id = t.assigned_agent_id
                   JOIN public.leads l ON l.id = t.lead_id
                  WHERE t.lead_id = :lead_id AND t.deleted_at IS NULL
                  ${orderSql}`,
                {
                    replacements: {
                        lead_id,
                        fallback_agent_name: fallbackAgentName ?? null
                    },
                    type: QueryTypes.SELECT
                }
            );

            // ---- Map & Format
            const task = rows.map((r) => {
                const remMin = r.start_at ? remainingMinutesCA(r.start_at) : 0;
                const human = toDisplayTimerPair(r.timer_hours ?? 0, r.timer_minutes ?? 0);

                const remaining_label =
                    remMin <= 0 ? "Due"
                        : human.timer_hours > 0
                            ? `${human.timer_hours}h ${String(human.timer_minutes).padStart(2, "0")}m`
                            : `${human.timer_minutes}m`;

                return {
                    id: r.id,
                    type: r.task_type,
                    subject: r.subject,
                    details: r.details,
                    location: r.location,
                    status: r.status,
                    start_at: r.start_at,                 // raw UTC
                    start_at_ca: toCAString(r.start_at),  // Canadian formatted
                    end_at: r.end_at,                     // raw UTC
                    end_at_ca: toCAString(r.end_at),      // Canadian formatted
                    owner_name: r.agent_name ?? null,
                    organizer_name: r.agent_name ?? null,
                    associated_lead: {
                        id: r.lead_id,
                        first_name: r.lead_first_name,
                        last_name: r.lead_last_name,
                        full_name: r.full_name,
                    },
                    assigned_agent_id: r.assigned_agent_id,
                    timer_hours: human.timer_hours,
                    timer_minutes: human.timer_minutes,
                    remaining_minutes: remMin,
                    remaining_label,
                    created_at: r.created_at,
                    created_at_ca: toCAString(r.created_at),
                    updated_at: r.updated_at,
                    updated_at_ca: toCAString(r.updated_at),
                };
            });

            // ✅ Final flat response (no date headers)
            return this.sendSuccess(res, { task }, "Tasks fetched successfully", 200);

        } catch (err: any) {
            if (err?.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };

    public filterTasks = async (req: Request, res: Response) => {
        try {
            const tokenUser = (req as any)?.user ?? {};
            const fallbackAgentName: string | undefined = tokenUser.name || tokenUser.full_name || undefined;

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                assigned_agent_id: Yup.string().optional(),
                status: Yup.string().trim().max(30).optional(),
                task_type: Yup.string().optional(),
                subject: Yup.string().trim().max(255).optional(),
                details: Yup.string().trim().max(500).optional(),
                location: Yup.string().trim().max(255).optional(),
                date: Yup.string().trim().matches(/^\d{4}-\d{2}-\d{2}$/, {
                    message: "date must be YYYY-MM-DD",
                    excludeEmptyString: true,
                }).optional(),
                from: Yup.string().trim().optional(),
                to: Yup.string().trim().optional(),
                overdue_only: Yup.boolean().optional(),
                order: Yup.string().oneOf(["start_desc", "start_asc", "created_desc", "created_asc"]).default("start_desc"),
            }).test("at-least-one-filter", "Provide at least one filter field", (o) => {
                if (!o) return false;
                const { assigned_agent_id, status, task_type, subject, details, location, date, from, to, overdue_only } = o as any;
                return [assigned_agent_id, status, task_type, subject, details, location, date, from, to, (overdue_only === true ? "x" : "")]
                    .some(v => v != null && String(v).trim() !== "");
            });

            const qp = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, assigned_agent_id, status, task_type, subject, details, location, date, from, to, overdue_only } = qp;

            const where: string[] = ["t.lead_id = :lead_id"];
            const repl: Record<string, any> = { lead_id };

            if (assigned_agent_id) { where.push("t.assigned_agent_id = :assigned_agent_id"); repl.assigned_agent_id = assigned_agent_id; }
            if (status) { where.push("t.status = :status"); repl.status = status; }
            if (task_type) { where.push("t.task_type = :task_type"); repl.task_type = task_type; }
            if (subject) { where.push("t.subject ILIKE :subject"); repl.subject = `%${subject}%`; }
            if (details) { where.push("t.details ILIKE :details_text"); repl.details_text = `%${details}%`; }
            if (location) { where.push("t.location ILIKE :location"); repl.location = `%${location}%`; }

            // Canada TZ range on start_at only
            const parseAny = (txt?: string) => {
                if (!txt) return null;
                if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return DateTime.fromISO(txt, { zone: ZONE }).startOf("day");
                const p = DateTime.fromISO(txt, { zone: ZONE });
                return p.isValid ? p : null;
            };

            let start_ts: string | undefined;
            let end_ts: string | undefined;

            if (date) {
                const d0 = DateTime.fromISO(date, { zone: ZONE }).startOf("day");
                const d1 = d0.plus({ days: 1 });
                start_ts = d0.toUTC().toISO({ suppressMilliseconds: true })!;
                end_ts = d1.toUTC().toISO({ suppressMilliseconds: true })!;
            } else {
                const f = parseAny(from);
                const t = parseAny(to);
                if (f && t) {
                    const tExclusive = /^\d{4}-\d{2}-\d{2}$/.test(to!) ? t.plus({ days: 1 }).startOf("day") : t;
                    start_ts = f.toUTC().toISO({ suppressMilliseconds: true })!;
                    end_ts = tExclusive.toUTC().toISO({ suppressMilliseconds: true })!;
                } else if (f) {
                    start_ts = f.toUTC().toISO({ suppressMilliseconds: true })!;
                } else if (t) {
                    const tExclusive = /^\d{4}-\d{2}-\d{2}$/.test(to!) ? t.plus({ days: 1 }).startOf("day") : t;
                    end_ts = tExclusive.toUTC().toISO({ suppressMilliseconds: true })!;
                }
            }

            if (start_ts && end_ts) { where.push("(t.start_at >= :start_ts AND t.start_at < :end_ts)"); Object.assign(repl, { start_ts, end_ts }); }
            else if (start_ts) { where.push("t.start_at >= :start_ts"); Object.assign(repl, { start_ts }); }
            else if (end_ts) { where.push("t.start_at < :end_ts"); Object.assign(repl, { end_ts }); }

            if (overdue_only === true) {
                const nowUtcISO = DateTime.now().setZone(ZONE).toUTC().toISO({ suppressMilliseconds: true })!;
                where.push("t.start_at < :now_utc"); repl.now_utc = nowUtcISO;
            }

            const whereSql = `WHERE ${where.join(" AND ")}`;
            const orderSql = `ORDER BY ${{
                start_desc: "t.start_at DESC,  t.created_at DESC",
                start_asc: "t.start_at ASC,   t.created_at DESC",
                created_desc: "t.created_at DESC, t.start_at DESC",
                created_asc: "t.created_at ASC,  t.start_at DESC",
            }[qp.order]}`;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.id, t.task_type, t.subject, t.details, t.location,
                    t.status, t.timer_hours, t.timer_minutes,
                    t.start_at, t.end_at,
                    t.assigned_agent_id,
                    CASE WHEN t.assigned_agent_id IS NULL THEN :fallback_agent_name ELSE su.name END AS agent_name,
                    t.created_at, t.updated_at,
                    l.id AS lead_id, l.full_name,
                    split_part(l.full_name, ' ', 1) AS lead_first_name,
                    CASE WHEN strpos(l.full_name,' ') > 0
                         THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                         ELSE NULL END AS lead_last_name
               FROM public.lead_tasks t
          LEFT JOIN public.system_users su ON su.id = t.assigned_agent_id
               JOIN public.leads l ON l.id = t.lead_id
              ${whereSql}
              ${orderSql}`,
                { replacements: { ...repl, fallback_agent_name: fallbackAgentName ?? null }, type: QueryTypes.SELECT }
            );

            const task = rows.map((r) => {
                const remMin = r.start_at ? remainingMinutesCA(r.start_at) : 0;
                const human = toDisplayTimerPair(r.timer_hours ?? 0, r.timer_minutes ?? 0);
                const remaining_label =
                    remMin <= 0 ? "Due"
                        : human.timer_hours > 0 ? `${human.timer_hours}h ${String(human.timer_minutes).padStart(2, "0")}m`
                            : `${human.timer_minutes}m`;

                return {
                    id: r.id,
                    type: r.task_type,
                    subject: r.subject,
                    details: r.details,
                    location: r.location,
                    status: r.status,
                    start_at: r.start_at, start_at_ist: toCAString(r.start_at), // Canada
                    end_at: r.end_at, end_at_ist: toCAString(r.end_at),   // Canada
                    owner_name: r.agent_name ?? null,
                    organizer_name: r.agent_name ?? null,
                    associated_lead: {
                        id: r.lead_id,
                        first_name: r.lead_first_name,
                        last_name: r.lead_last_name,
                        full_name: r.full_name,
                    },
                    assigned_agent_id: r.assigned_agent_id,
                    timer_hours: human.timer_hours,
                    timer_minutes: human.timer_minutes,
                    remaining_minutes: remMin,
                    remaining_label,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                };
            });

            return this.sendSuccess(res, { task }, "Tasks filtered successfully", 200);
        } catch (err: any) {
            console.error("filterTasks error:", err);
            if (err?.name === "ValidationError")
                return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
    public editTask = async (req: Request, res: Response) => {
        const t = await this.db_services.sequelizeWriter.transaction(); // Start a transaction
        try {
            // Fetch authentication data
            const auth = (req as any)?.user;
            if (!auth?.system_user_id) {
                await t.rollback();
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }
            const authUserId = String(auth.system_user_id);
            const tokenUser = (req as any)?.user ?? {};

            const fallbackAgentName: string | undefined = tokenUser.name || tokenUser.full_name || undefined;

            const schema = Yup.object({
                task_id: Yup.string().uuid().required("task_id is required"),
                lead_id: Yup.string().uuid().optional(),
                assigned_agent_id: Yup.string().uuid().optional(),
                details: Yup.string().optional(),
                task_type: Yup.string().oneOf(["meeting", "phonecall", "followup"]).optional(),
                subject: Yup.string().trim().max(255).optional(),
                location: Yup.string().trim().max(255).optional(),
                start_at_text: Yup.string().trim().optional(),
                end_at_text: Yup.string().trim().optional(),
                status: Yup.string().oneOf(["pending", "done"]).optional(),
            }).test("at-least-one", "Provide at least one field to update", (o) => {
                if (!o) return false;
                const { lead_id, assigned_agent_id, details, task_type, subject, location, start_at_text, end_at_text, status } = o as any;
                return [lead_id, assigned_agent_id, details, task_type, subject, location, start_at_text, end_at_text, status]
                    .some(v => v != null && String(v).trim() !== "");
            });

            const body = await schema.validate(req.body, { abortEarly: false });

            // Load current row
            const current: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT t.*, l.full_name
                 FROM public.lead_tasks t
                 JOIN public.leads l ON l.id = t.lead_id
                WHERE t.id = :id AND t.deleted_at IS NULL
                LIMIT 1`,
                { replacements: { id: body.task_id }, type: QueryTypes.SELECT }
            );
            if (!current.length) return this.sendError(res, {}, "Task not found", 404);
            const row = current[0];

            // --- Parse times in Canada timezone (same as createTask) ---
            let startAtUtc: Date | undefined;
            let endAtUtc: Date | undefined;

            if (body.start_at_text) {
                const s = parseInCA(body.start_at_text);
                if (!s) return this.sendError(res, {}, "Invalid start_at_text format", 400);
                startAtUtc = s.toUTC().toJSDate();
            }
            if (body.end_at_text) {
                const e = parseInCA(body.end_at_text);
                if (!e) return this.sendError(res, {}, "Invalid end_at_text format", 400);
                endAtUtc = e.toUTC().toJSDate();
            }
            if (startAtUtc && endAtUtc && endAtUtc <= startAtUtc) {
                return this.sendError(res, {}, "end_at must be after start_at", 400);
            }

            // --- Build update set ---
            const sets: string[] = [];
            const repl: any = { id: body.task_id };

            if (body.lead_id) { sets.push("lead_id = :lead_id"); repl.lead_id = body.lead_id; }
            if (body.assigned_agent_id) { sets.push("assigned_agent_id = :assigned_agent_id"); repl.assigned_agent_id = body.assigned_agent_id; }
            if (body.details != null) { sets.push("details = :details"); repl.details = body.details; }
            if (body.task_type) { sets.push("task_type = :task_type"); repl.task_type = body.task_type; }
            if (body.subject != null) { sets.push("subject = :subject"); repl.subject = body.subject; }
            if (body.location != null) { sets.push("location = :location"); repl.location = body.location; }
            if (startAtUtc) { sets.push("start_at = :start_at, due_at = :start_at"); repl.start_at = startAtUtc; }
            if (endAtUtc) { sets.push("end_at = :end_at"); repl.end_at = endAtUtc; }
            if (body.status) { sets.push("status = :status"); repl.status = body.status; }

            if (!sets.length) return this.sendError(res, {}, "Nothing to update", 400);

            // --- Recompute timer if start_at changed ---
            if (startAtUtc) {
                const remaining = remainingMinutesCA(startAtUtc);
                const toDbTimerPair = (remainingMin: number) => {
                    const ALLOWED = [5, 10, 15, 20, 30, 60] as const, MAX = 12 * 60;
                    let mins = Math.min(Math.max(Math.ceil(remainingMin), 5), MAX);
                    let hrs = Math.floor(mins / 60), rem = mins - hrs * 60;
                    if (rem === 0) return { timer_hours: Math.max(0, hrs - 1), timer_minutes: 60 as 60 };
                    const m = ALLOWED.find(a => a >= rem);
                    if (!m || m === 60) return { timer_hours: hrs, timer_minutes: 60 as 60 };
                    return { timer_hours: hrs, timer_minutes: m };
                };
                const pair = toDbTimerPair(remaining);
                sets.push("timer_hours = :timer_hours", "timer_minutes = :timer_minutes");
                repl.timer_hours = pair.timer_hours; repl.timer_minutes = pair.timer_minutes;
            }

            sets.push("updated_at = NOW()");
            const updated: any[] = await this.db_services.sequelizeWriter.query(
                `WITH upd AS (
                     UPDATE public.lead_tasks
                        SET ${sets.join(", ")}
                      WHERE id = :id
                    RETURNING *
                 )
                 SELECT u.*,
                        COALESCE(su.name, :fallback_agent_name) AS agent_name,
                        l.full_name,
                        split_part(l.full_name, ' ', 1) AS lead_first_name,
                        CASE WHEN strpos(l.full_name,' ') > 0
                             THEN btrim(substr(l.full_name, strpos(l.full_name,' ')+1))
                             ELSE NULL END AS lead_last_name
                   FROM upd u
              LEFT JOIN public.system_users su ON su.id = u.assigned_agent_id
                   JOIN public.leads l ON l.id = u.lead_id
                  LIMIT 1`,
                { replacements: { ...repl, fallback_agent_name: fallbackAgentName ?? null }, type: QueryTypes.SELECT }
            );
            if (!updated.length) return this.sendError(res, {}, "Task not found", 404);

            const rec = updated[0];
            const toCA = (d: any) => toCAString(d);
            // Log activity after the task is updated
            await SystemUserActivity.create({
                system_user_id: authUserId,  // Use the authenticated user's ID
                user_activity: `Updated task for lead ${rec.lead_id}`,  // Describe the activity
                module: 'task_management',  // The module name
                type: 'update',  // Activity type
            });

            await t.commit();  // Commit transaction if everything is successful

            return this.sendSuccess(res, {
                id: rec.id,
                type: rec.task_type,
                subject: rec.subject,
                details: rec.details,
                location: rec.location,
                status: rec.status,
                start_at: rec.start_at, start_at_ist: toCA(rec.start_at), // Canada time
                end_at: rec.end_at, end_at_ist: toCA(rec.end_at),         // Canada time
                owner_name: rec.agent_name,
                organizer_name: rec.agent_name,
                associated_lead: {
                    id: rec.lead_id,
                    first_name: rec.lead_first_name,
                    last_name: rec.lead_last_name,
                    full_name: rec.full_name,
                },
                timer_hours: rec.timer_hours,
                timer_minutes: rec.timer_minutes,
                created_at: rec.created_at,
                updated_at: rec.updated_at,
            }, "Task updated", 200);
        } catch (err: any) {
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };

    // PATCH /leads/tasks/complete
    public completeTask = async (req: Request, res: Response) => {
        try {
            // Fetch authentication data
            const auth = (req as any)?.user;
            if (!auth?.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }
            const authUserId = String(auth.system_user_id); // Correctly set authUserId

            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                task_id: Yup.string().uuid().required("task_id is required"),
            });

            await schema.validate(req.body, { abortEarly: false });

            const { lead_id, task_id } = req.body;

            // Update task status to 'done'
            await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_tasks
                SET status='done', updated_at=NOW()
                WHERE id = :task_id AND lead_id = :lead_id`,
                { replacements: { lead_id, task_id }, type: QueryTypes.UPDATE }
            );

            // Log activity after completing the task
            await SystemUserActivity.create({
                system_user_id: authUserId,  // Use system_user_id from the request's authentication context
                user_activity: `Completed task for lead ${lead_id}`,  // Describe the activity
                module: 'task_management',  // The module name
                type: 'update',  // Activity type
            });

            return this.sendSuccess(res, {}, "Task completed", 200);
        } catch (err: any) {
            console.error("completeTask error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public uploadDocument = async (req: Request, res: Response) => {
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
      
          // Body data
          const body = {
            lead_id: req.body.lead_id,
            uploaded_by: req.body.uploaded_by?.trim() || null,
            notes: req.body.notes?.trim() || null,
          };
      
          // Yup validation
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

          // S3 Upload if configured, otherwise local disk storage fallback
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
              console.warn("S3 upload failed, using local disk storage fallback:", s3Err);
              const uploadDir = path.join(process.cwd(), "uploads", "lead-documents");
              if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
              }
              fs.writeFileSync(path.join(uploadDir, path.basename(key)), file.buffer);
            }
          } else {
            const uploadDir = path.join(process.cwd(), "uploads", "lead-documents");
            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true });
            }
            fs.writeFileSync(path.join(uploadDir, path.basename(key)), file.buffer);
          }

          const finalUploadedBy = uploaded_by || (req as any)?.user?.system_user_id || null;
      
          // Insert into DB
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
      
          // User activity log
          const authUserId = (req as any)?.user?.system_user_id;
          if (authUserId) {
            await SystemUserActivity.create({
              system_user_id: authUserId,
              user_activity: `Uploaded document for lead ${lead_id}`,
              module: "document_management",
              type: "create",
            });
          }
      
          const out = rows[0];
          return this.sendSuccess(res, out, "Document uploaded successfully", 200);
        } catch (err: any) {
          console.error("uploadDocument error:", err);
          if (err.name === "ValidationError") {
            return this.sendError(res, {}, err.errors.join(", "), 400);
          }
          return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
      };
      

    public listDocuments = async (req: Request, res: Response) => {
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
          WHERE d.lead_id = :lead_id
            AND d.deleted_at IS NULL
          ORDER BY d.created_at DESC`,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );

            const result = await Promise.all(
                rows.map(async (row) => {
                    const base = {
                        ...row,
                        created_at_ca: toCAString(row.created_at),
                        updated_at_ca: toCAString(row.updated_at),
                        created_date_ca: toCADate(row.created_at),
                        updated_date_ca: toCADate(row.updated_at),
                        // For convenience: treat updated_at as edited_at if is_edited = true
                        edited_at_ca: row.is_edited ? toCAString(row.updated_at) : null,
                        edited_date_ca: row.is_edited ? toCADate(row.updated_at) : null,
                    };

                    try {
                        if (!row.storage_path) {
                            return { ...base, download: null };
                        }

                        if (process.env.AWS_S3_BUCKET_NAME) {
                            try {
                                const downloadCommand = new GetObjectCommand({
                                    Bucket: process.env.AWS_S3_BUCKET_NAME!,
                                    Key: row.storage_path,
                                    ResponseContentDisposition: `attachment; filename="${row.file_name}"`,
                                });
                                const download = await getSignedUrl(s3Client, downloadCommand, { expiresIn: 3600 });
                                return { ...base, download };
                            } catch (s3GetErr) {
                                return { ...base, download: `http://localhost:${process.env.MEDICINE_CRM_PORT || 8016}/uploads/${row.storage_path}` };
                            }
                        } else {
                            return { ...base, download: `http://localhost:${process.env.MEDICINE_CRM_PORT || 8016}/uploads/${row.storage_path}` };
                        }
                    } catch (e) {
                        console.error("Signed URL error for", row.storage_path, e);
                        return { ...base, download: null };
                    }
                })
            );

            return this.sendSuccess(res, { data: result }, "Documents fetched successfully");
        } catch (err: any) {
            console.error("listDocuments error:", err);
            if (err?.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public searchLeadsForDashboard = async (req: Request, res: Response) => {
        try {
            // ---- Validation
            const schema = () =>
                Yup.object({
                    q: Yup.string().required("Search query is required"),
                });

            type SearchQuery = { q: string };

            const qp = await schema()
                .validate(req.query)
                .catch((err: any) => ({ error: err.errors?.[0] ?? "Validation failed" }));

            if ((qp as any)?.error) {
                return this.sendError(res, {}, (qp as any).error, 400);
            }

            const { q } = qp as SearchQuery;
            const rawQ = q.toString().toLowerCase().trim();

            // ---- Detect query type
            const digitsOnly = rawQ.replace(/\D+/g, "");
            const isPhone = digitsOnly.length >= 10; // allow shorter than before for flexibility
            const isEmail = rawQ.includes("@");

            let phoneQuery: string | undefined;
            let emailQuery: string | undefined;

            if (isPhone) {
                phoneQuery = digitsOnly;
            } else if (isEmail) {
                emailQuery = rawQ;
            }

            if (!phoneQuery && !emailQuery) {
                return this.sendError(res, {}, "Enter a valid phone number or email", 400);
            }

            // ---- WHERE clause
            const where: string[] = ["l.deleted_at IS NULL"];
            const repl: any = {};

            if (phoneQuery) {
                // Normalize phone numbers and allow search with/without country code
                where.push(`
                (
                    regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') LIKE :p_like
                    OR regexp_replace(COALESCE(l.whatsapp_number, ''), '[^0-9]', '', 'g') LIKE :p_like
                    OR regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') LIKE :p_alt
                    OR regexp_replace(COALESCE(l.whatsapp_number, ''), '[^0-9]', '', 'g') LIKE :p_alt
                )
            `);

                // Prepare variants — e.g. +918108527593 and 8108527593
                repl.p_like = `%${phoneQuery}%`;
                repl.p_alt = `%${phoneQuery.replace(/^91/, "")}%`; // remove 91 if user included it
            } else if (emailQuery) {
                where.push(`
                regexp_replace(LOWER(TRIM(l.email)), '\\s+', '', 'g') LIKE :e_like
            `);
                repl.e_like = `%${emailQuery.trim().toLowerCase()}%`;
            }

            const sql = `
            SELECT
                l.id,
                l.full_name,
                l.email,
                l.phone,
                l.whatsapp_number,
                l.created_at,
                u.name AS agent_name
            FROM leads l
            LEFT JOIN system_users u ON u.id = l.agent_id
            WHERE ${where.join(" AND ")}
            ORDER BY l.created_at DESC
            LIMIT 50
        `;

            const leads = await db.sequelize.query(sql, {
                replacements: repl,
                type: QueryTypes.SELECT,
            });

            return this.sendSuccess(res, { leads }, "Leads fetched successfully");
        } catch (err: any) {
            console.error("searchLeadsForDashboard error:", err);
            return this.sendError(res, {}, "Something went wrong", 500);
        }
    };

    public filterDocuments = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                uploaded_by: Yup.string().uuid().optional(),
                file_name: Yup.string().trim().max(255).optional(),
                mime_type: Yup.string().trim().max(100).optional(),
                is_image: Yup.boolean().optional(),
                notes: Yup.string().trim().max(10000).optional(),
                from: Yup.string().trim().optional(),  // ISO date/datetime string
                to: Yup.string().trim().optional(),
                order: Yup.string().oneOf(["created_desc", "created_asc"]).default("created_desc"),
            }).test(
                "at-least-one-filter",
                "Provide at least one filter field",
                (o) => {
                    if (!o) return false;
                    const { uploaded_by, file_name, mime_type, is_image, notes, from, to } = o as any;
                    return [uploaded_by, file_name, mime_type, is_image, notes, from, to]
                        .some(v => v !== undefined && v !== null && String(v).trim() !== "");
                }
            );

            const qp = await schema.validate(req.body, { abortEarly: false });

            const { lead_id, uploaded_by, file_name, mime_type, is_image, notes, from, to } = qp;

            const where: string[] = ["d.lead_id = :lead_id", "d.deleted_at IS NULL"];
            const repl: Record<string, any> = { lead_id };

            if (uploaded_by) { where.push("d.uploaded_by = :uploaded_by"); repl.uploaded_by = uploaded_by; }
            if (file_name) { where.push("d.file_name ILIKE :file_name"); repl.file_name = `%${file_name}%`; }
            if (mime_type) { where.push("d.mime_type ILIKE :mime_type"); repl.mime_type = `%${mime_type}%`; }
            if (typeof is_image === "boolean") { where.push("d.is_image = :is_image"); repl.is_image = is_image; }
            if (notes) { where.push("d.notes ILIKE :notes"); repl.notes = `%${notes}%`; }
            if (from) { where.push("d.created_at >= :from_ts"); repl.from_ts = from; }
            if (to) { where.push("d.created_at <= :to_ts"); repl.to_ts = to; }

            const whereSql = `WHERE ${where.join(" AND ")}`;

            const orderSql = qp.order === "created_asc"
                ? "ORDER BY d.created_at ASC"
                : "ORDER BY d.created_at DESC";

            // No COUNT, no LIMIT/OFFSET → returns all matching rows
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT d.id,
                    d.file_name,
                    d.mime_type,
                    d.file_size,
                    d.storage_path,
                    d.is_image,
                    d.notes,
                    d.uploaded_by,
                    su.name AS uploaded_by_name,
                    d.created_at,
                    d.updated_at
               FROM public.lead_documents d
          LEFT JOIN public.system_users su ON su.id = d.uploaded_by
              ${whereSql}
              ${orderSql}`,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            return this.sendSuccess(
                res,
                { data: rows }, // 👈 no pagination in response
                "Documents filtered successfully",
                200
            );
        } catch (err: any) {
            console.error("filterDocuments error:", err);
            if (err?.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
    private async deleteS3ObjectSafe(key: string) {
        try {
            if (!key) return;
            await s3Client.send(
                new DeleteObjectCommand({
                    Bucket: process.env.AWS_S3_BUCKET_NAME!,
                    Key: key,
                })
            );
        } catch (e) {
            // Don't throw; just log
            console.error("deleteS3ObjectSafe error:", e);
        }
    }
    public editDocument = async (req: Request, res: Response) => {
        const DELETE_OLD_S3_ON_REPLACE = true;
    
        const t = await this.db_services.sequelizeWriter.transaction();
        let newObjectKeyToCleanupOnError: string | undefined;
    
        try {
            const schema = Yup.object({
                document_id: Yup.string().uuid().required("document_id is required"),
                notes: Yup.string().max(10000).nullable().optional(),
            });
    
            const body = await schema.validate(req.body, { abortEarly: false });
            const { document_id, notes } = body;
    
            // 1. Load current document
            const currentRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT d.*, su.name AS uploaded_by_name
                   FROM public.lead_documents d
              LEFT JOIN public.system_users su ON su.id = d.uploaded_by
                  WHERE d.id = :id AND d.deleted_at IS NULL
                  LIMIT 1`,
                { replacements: { id: document_id }, type: QueryTypes.SELECT, transaction: t }
            );
    
            if (!currentRows.length) {
                await t.rollback();
                return this.sendError(res, {}, "Document not found", 404);
            }
    
            const current = currentRows[0];
    
            const hasNewFile = !!req.file;
            let newS3Key: string | undefined;
            let newFileName: string | undefined;
            let newMimeType: string | undefined;
            let newIsImage: boolean | undefined;
            let newFileSize: number | undefined;
    
            if (!hasNewFile && notes === undefined) {
                await t.rollback();
                return this.sendError(res, {}, "Nothing to update", 400);
            }
    
            // ALLOWED MIME TYPES (same as uploadDocument)
            const allowedMimeTypes = [
                "image/jpeg",
                "image/png",
                "image/webp",
                "application/pdf",
                "text/csv",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ];
    
            // 2. If replacing file → validate + upload
            if (hasNewFile) {
                const file = req.file!;
    
                // ❗ Validate Excel, CSV, PDF, Image here
                if (!allowedMimeTypes.includes(file.mimetype)) {
                    await t.rollback();
                    return this.sendError(
                        res,
                        {},
                        "Invalid file type. Allowed: JPEG, PNG, WEBP, PDF, CSV, XLS, XLSX.",
                        400
                    );
                }
    
                newIsImage = file.mimetype.startsWith("image/");
                newFileName = file.originalname;
                newMimeType = file.mimetype;
                newFileSize = file.size;
    
                newS3Key = `lead-documents/${Date.now()}_${file.originalname}`;
    
                // Upload new file to S3
                const upload = new Upload({
                    client: s3Client,
                    params: {
                        Bucket: process.env.AWS_S3_BUCKET_NAME!,
                        Key: newS3Key,
                        Body: file.buffer,
                        ContentType: file.mimetype,
                        ACL: "private",
                    },
                });
    
                await upload.done();
                newObjectKeyToCleanupOnError = newS3Key;
            }
    
            // 3. Dynamic UPDATE builder
            const sets = ["updated_at = NOW()", "is_edited = TRUE"];
            const repl: any = { id: document_id };
    
            const authUserId = (req as any)?.user?.system_user_id || null;
            if (authUserId) {
                sets.push("edited_by = :edited_by");
                repl.edited_by = authUserId;
            }
    
            if (notes !== undefined) {
                sets.push("notes = :notes");
                repl.notes = notes;
            }
    
            if (hasNewFile && newS3Key) {
                sets.push(
                    "file_name = :file_name",
                    "mime_type = :mime_type",
                    "file_size = :file_size",
                    "storage_path = :storage_path",
                    "is_image = :is_image"
                );
                repl.file_name = newFileName;
                repl.mime_type = newMimeType;
                repl.file_size = newFileSize;
                repl.storage_path = newS3Key;
                repl.is_image = newIsImage;
            }
    
            // 4. Update row
            const updatedRows: any[] = await this.db_services.sequelizeWriter.query(
                `WITH upd AS (
                    UPDATE public.lead_documents
                       SET ${sets.join(", ")}
                     WHERE id = :id
                 RETURNING *
                )
                SELECT u.*, su.name AS uploaded_by_name, su2.name AS edited_by_name
                  FROM upd u
             LEFT JOIN public.system_users su  ON su.id  = u.uploaded_by
             LEFT JOIN public.system_users su2 ON su2.id = u.edited_by
                 LIMIT 1`,
                { replacements: repl, type: QueryTypes.SELECT, transaction: t }
            );
    
            if (!updatedRows.length) {
                await t.rollback();
                if (newObjectKeyToCleanupOnError) {
                    await this.deleteS3ObjectSafe(newObjectKeyToCleanupOnError);
                }
                return this.sendError(res, {}, "Document not found", 404);
            }
    
            const updated = updatedRows[0];
    
            await t.commit();
    
            // 5. Delete old S3 file after commit
            if (hasNewFile && DELETE_OLD_S3_ON_REPLACE && current.storage_path !== newS3Key) {
                await this.deleteS3ObjectSafe(current.storage_path);
            }
    
            // Log user activity
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,
                    user_activity: `Edited document for lead ${updated.lead_id || current.lead_id}`,
                    module: "document_management",
                    type: "update",
                });
            }
    
            return this.sendSuccess(res, updated, "Document updated successfully", 200);
        } catch (err: any) {
            try { await t.rollback(); } catch {}
            if (newObjectKeyToCleanupOnError) {
                await this.deleteS3ObjectSafe(newObjectKeyToCleanupOnError);
            }
            if (err?.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            console.error("editDocument error:", err);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };
    


    public getAgentTasksDashboard = async (req: Request, res: Response) => {
        try {
            const auth = (req as any)?.user;
            if (!auth?.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }
            const me = String(auth.system_user_id);
            const isAdmin = await this.isAdmin(me);

            // -------- inputs
            const schema = Yup.object({
                agent_id: Yup.string().uuid().optional(),                // honored for admins only
                days: Yup.number().integer().min(1).max(31).default(7),  // window for charts
            });
            const qp = await schema.validate(req.query, { abortEarly: false });
            const targetAgentId = isAdmin && qp.agent_id ? qp.agent_id : me;
            const windowDays = Number(qp.days ?? 7);

            // -------- IST TZ helpers
            const ZONE = "Asia/Kolkata";
            const DATE_FMT = "MM-dd-yyyy";
            const DATETIME_FMT = "MM-dd-yyyy hh:mm a";

            const nowEST = DateTime.now().setZone(ZONE);
            const todayStartEST = nowEST.startOf("day");
            const todayEndEST = nowEST.endOf("day");
            const nowUtcISO = nowEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayStartUTC = todayStartEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayEndUTC = todayEndEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const rangeStartEST = todayStartEST.minus({ days: windowDays - 1 });
            const rangeStartUTC = rangeStartEST.toUTC().toISO({ suppressMilliseconds: true })!;
            const rangeEndUTC = todayEndUTC;

            const toESTString = (d: any): string | null =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATETIME_FMT) : null;
            const toESTDate = (d: any): string | null =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATE_FMT) : null;

            // ==========================================================
            // 0) Reusable normalized view for this agent
            // ==========================================================
            const baseWhere = `
            FROM public.lead_tasks t
            JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL  -- Exclude deleted leads
            WHERE t.deleted_at IS NULL
            AND t.assigned_agent_id = :aid
            `;

            // ==========================================================
            // 1) CARDS
            // ==========================================================
            const [pendingTodayRow]: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT COUNT(*)::int AS pending_today
                ${baseWhere}
                AND t.start_at >= :start_utc AND t.start_at <= :end_utc
                AND CASE
                    WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                    WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                    ELSE 'pending'
                END = 'pending'
                `,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const [cancelledTodayRow]: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT COUNT(*)::int AS cancelled_today
                ${baseWhere}
                AND t.start_at >= :start_utc AND t.start_at <= :end_utc
                AND CASE
                    WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                    WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                    ELSE 'pending'
                END = 'cancelled'
                `,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const [completedTodayRow]: any[] = await this.db_services.sequelizeWriter.query(
                `
                WITH norm AS (
                    SELECT t.id, t.start_at, t.updated_at,
                    CASE
                        WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                        WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                        ELSE 'pending'
                    END AS s
                    ${baseWhere}
                ),
                today_start_done AS (
                    SELECT id FROM norm
                    WHERE s = 'done' AND start_at IS NOT NULL
                    AND start_at >= :start_utc AND start_at <= :end_utc
                ),
                marked_done_today AS (
                    SELECT id FROM norm
                    WHERE s = 'done' AND updated_at IS NOT NULL
                    AND updated_at >= :start_utc AND updated_at <= :end_utc
                )
                SELECT COUNT(DISTINCT id)::int AS completed_today
                FROM (
                    SELECT id FROM today_start_done
                    UNION
                    SELECT id FROM marked_done_today
                ) u
                `,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const [dueRow]: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                    SUM( (t.end_at < :now_utc AND
                        (CASE
                            WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                            WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                            ELSE 'pending'
                        END) = 'pending')::int )::int AS overdue,
                    SUM( (t.start_at >= :now_utc AND
                        (CASE
                            WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                            WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                            ELSE 'pending'
                        END) = 'pending')::int )::int AS upcoming
                ${baseWhere}
                `,
                { replacements: { aid: targetAgentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            // ==========================================================
            // 2) MINI: Today by type
            // ==========================================================
            const byTypeToday: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT t.task_type, COUNT(*)::int AS c
                ${baseWhere}
                AND t.start_at >= :start_utc AND t.start_at <= :end_utc
                AND CASE
                    WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                    WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                    ELSE 'pending'
                END = 'pending'
                GROUP BY 1
                `,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            // ==========================================================
            // 3) SERIES: Last N days
            // ==========================================================
            const lastNDaysRows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                    (t.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS day_est,
                    COUNT(*)::int AS c
                ${baseWhere}
                AND t.start_at >= :start_utc
                AND t.start_at <= :end_utc
                GROUP BY 1
                ORDER BY 1 ASC
                `,
                { replacements: { aid: targetAgentId, start_utc: rangeStartUTC, end_utc: rangeEndUTC }, type: QueryTypes.SELECT }
            );

            const barMap = new Map<string, number>();
            for (const r of lastNDaysRows) {
                const key = DateTime.fromJSDate(new Date(r.day_est)).setZone(ZONE).toFormat(DATE_FMT);
                barMap.set(key, r.c);
            }
            const tasksBar: Array<{ date: string; count: number }> = [];
            for (let i = 0; i < windowDays; i++) {
                const d = rangeStartEST.plus({ days: i }).toFormat(DATE_FMT);
                tasksBar.push({ date: d, count: barMap.get(d) ?? 0 });
            }

            // ==========================================================
            // 4) PIE: Today status distribution
            // ==========================================================
            const statusTodayRows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                    CASE
                        WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                        WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                        ELSE 'pending'
                    END AS status,
                    COUNT(*)::int AS count
                ${baseWhere}
                AND t.start_at >= :start_utc
                AND t.start_at <= :end_utc
                GROUP BY 1
                `,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            // ==========================================================
            // 5) LISTS
            // ==========================================================
            const upcomingRows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT t.id, t.task_type, t.subject,
                       'pending'::text AS status,
                       t.start_at, l.full_name, l.id AS lead_id
                FROM public.lead_tasks t
                JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL  -- Exclude deleted leads
                WHERE t.deleted_at IS NULL
                AND t.assigned_agent_id = :aid
                AND t.start_at >= :now_utc
                AND CASE
                    WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                    WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                    ELSE 'pending'
                END = 'pending'
                ORDER BY t.start_at ASC
                LIMIT 20
                `,
                { replacements: { aid: targetAgentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            const overdueRows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT 
                    t.id, 
                    t.task_type, 
                    t.subject,
                    'pending'::text AS status,
                    t.start_at,        
                    t.end_at,           
                    l.full_name, 
                    l.id AS lead_id
                FROM public.lead_tasks t
                JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL  -- Exclude deleted leads
                WHERE t.deleted_at IS NULL
                AND t.assigned_agent_id = :aid
                AND t.end_at < :now_utc  
                AND CASE
                    WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                    WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                    ELSE 'pending'
                END = 'pending'
                ORDER BY t.end_at DESC
                LIMIT 20
                `,
                { replacements: { aid: targetAgentId, now_utc: nowUtcISO }, type: QueryTypes.SELECT }
            );

            const doneTodayRows: any[] = await this.db_services.sequelizeWriter.query(
                `
                WITH norm AS (
                    SELECT
                        t.id,
                        t.lead_id,
                        t.task_type,
                        t.subject,
                        t.start_at,
                        t.updated_at,
                        l.full_name,
                        CASE
                            WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                            WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                            ELSE 'pending'
                        END AS s
                    FROM public.lead_tasks t
                    JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL  -- Exclude deleted leads
                    WHERE t.deleted_at IS NULL
                    AND t.assigned_agent_id = :aid
                ),
                today_start_done AS (
                    SELECT id
                    FROM norm
                    WHERE s = 'done'
                    AND start_at IS NOT NULL
                    AND start_at >= :start_utc
                    AND start_at <= :end_utc
                ),
                marked_done_today AS (
                    SELECT id
                    FROM norm
                    WHERE s = 'done'
                    AND updated_at IS NOT NULL
                    AND updated_at >= :start_utc
                    AND updated_at <= :end_utc
                ),
                union_ids AS (
                    SELECT id FROM today_start_done
                    UNION
                    SELECT id FROM marked_done_today
                )
                SELECT
                    n.id,
                    n.lead_id,
                    n.task_type,
                    n.subject,
                    'done'::text AS status,
                    n.start_at,
                    n.full_name
                FROM union_ids u
                JOIN norm n ON n.id = u.id
                ORDER BY COALESCE(n.start_at, n.updated_at) DESC
                LIMIT 20
                `,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const pendingTodayRows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT t.id, t.lead_id, t.task_type, t.subject, 'pending'::text AS status, t.start_at, l.full_name
                FROM public.lead_tasks t
                JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL  -- Exclude deleted leads
                WHERE t.deleted_at IS NULL
                AND t.assigned_agent_id = :aid
                AND t.start_at >= :start_utc AND t.start_at <= :end_utc
                AND CASE
                    WHEN t.status::text IN ('completed','complete','done') THEN 'done'
                    WHEN t.status::text IN ('cancelled','canceled')        THEN 'cancelled'
                    ELSE 'pending'
                END = 'pending'
                ORDER BY t.start_at ASC
                LIMIT 20
                `,
                { replacements: { aid: targetAgentId, start_utc: todayStartUTC, end_utc: todayEndUTC }, type: QueryTypes.SELECT }
            );

            const mapList = (rows: any[]) =>
                rows.map(r => ({
                    id: r.id,
                    lead_id: r.lead_id,
                    type: r.task_type,
                    subject: r.subject,
                    status: r.status,
                    start_at: r.start_at,
                    start_at_est: toESTString(r.start_at),
                    end_at_est: toESTString(r.end_at),
                    start_date_est: toESTDate(r.start_at),
                    lead_name: r.full_name,
                }));

            const upcoming = mapList(upcomingRows);
            const overdue = mapList(overdueRows);
            const done_today = mapList(doneTodayRows);
            const pending_today = mapList(pendingTodayRows);

            // ==========================================================
            // 6) Return payload
            // ==========================================================
            return this.sendSuccess(
                res,
                {
                    scope: { agent_id: targetAgentId, is_admin_view: isAdmin && targetAgentId !== me },
                    cards: {
                        today: {
                            total: Number(pendingTodayRow?.pending_today ?? 0),
                            pending: Number(pendingTodayRow?.pending_today ?? 0),
                            completed: Number(completedTodayRow?.completed_today ?? 0),
                            cancelled: Number(cancelledTodayRow?.cancelled_today ?? 0),
                            today_est: todayStartEST.toFormat(DATE_FMT),
                        },
                        overdue: Number(dueRow?.overdue ?? 0),
                        upcoming: Number(dueRow?.upcoming ?? 0),
                        today_by_type: byTypeToday.map((x: any) => ({ type: x.task_type, count: x.c })),
                    },
                    series: {
                        tasks_bar_last_n_days: tasksBar,
                        today_status_pie: statusTodayRows.map((x: any) => ({ status: x.status, count: x.count })),
                    },
                    lists: {
                        upcoming,
                        overdue,
                        done_today,
                        pending_today,
                    },
                    window_days: windowDays,
                    today_est: todayStartEST.toFormat(DATE_FMT),
                    now_est: nowEST.toFormat(DATETIME_FMT),
                },
                "Agent tasks dashboard (EST)"
            );
        } catch (err: any) {
            console.error("getAgentTasksDashboard error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };

    public softDeleteDocument = async (req: Request, res: Response) => {
        const tx = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                updated_at: Yup.string().optional(),
            });

            const { id, updated_at } = await schema.validate(req.body, { abortEarly: false });

            const where: string[] = ["d.id = :id", "d.deleted_at IS NULL"];
            const repl: any = { id };

            if (updated_at) {
                where.push("d.updated_at = :updated_at");
                repl.updated_at = updated_at;
            }

            // Correctly type the rows variable as Document[]
            const rows: Document[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_documents AS d
              SET deleted_at = NOW(),
                  updated_at = NOW()
              WHERE ${where.join(" AND ")}
              RETURNING d.id, d.lead_id, d.deleted_at`,
                { replacements: repl, type: QueryTypes.SELECT, transaction: tx }
            );

            await tx.commit();

            if (!rows.length) {
                return this.sendError(res, {}, "No matching active document found (already deleted or concurrency mismatch).", 404);
            }

            // Log activity for soft-deleting the document
            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,
                    user_activity: `deleted document for lead ${rows[0].lead_id}`,  // Document soft-delete action
                    module: 'document_management',  // Module name
                    type: 'delete',  // Activity type
                });
            }

            return this.sendSuccess(res, { count: 1, item: rows[0] }, "Document deleted");
        } catch (err: any) {
            try { await tx.rollback(); } catch { }
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            console.error("Error in softDeleteDocument:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };


    // POST /leads/documents/get
    public getDocument = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("Document id is required"),
                include_deleted: Yup.boolean().default(false), // optional flag
            });

            const { id, include_deleted } = await schema.validate(req.body, { abortEarly: false });

            // WHERE clause
            const whereParts: string[] = ["d.id = :id"];
            const replacements: any = { id };

            if (!include_deleted) {
                whereParts.push("d.deleted_at IS NULL");
            }

            const whereSql = `WHERE ${whereParts.join(" AND ")}`;

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT d.id,
                d.lead_id,
                d.file_name,
                d.mime_type,
                d.file_size,
                d.storage_path,
                d.is_image,
                d.created_at,
                d.updated_at,
                d.deleted_at,
                su.name AS uploader_name,
                d.uploaded_by
           FROM public.lead_documents d
           LEFT JOIN public.system_users su ON su.id = d.uploaded_by
           ${whereSql}
           LIMIT 1`,
                { replacements, type: QueryTypes.SELECT }
            );

            if (!rows.length) {
                return this.sendError(res, {}, "Document not found", 404);
            }

            return this.sendSuccess(res, rows[0], "Document fetched successfully");
        } catch (err: any) {
            console.error("Error in getDocument:", err);
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getDocumentUrl = async (req: Request, res: Response) => {
        try {
            const { id } = req.body;
            if (!id) return this.sendError(res, {}, "id is required", 400);

            const result: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT file_name, mime_type, storage_path, is_image
             FROM lead_documents
             WHERE id = :id
             LIMIT 1;`,
                { replacements: { id }, type: QueryTypes.SELECT }
            );

            const document = result[0];
            if (!document) return this.sendError(res, {}, "Document not found", 404);

            const command = new GetObjectCommand({
                Bucket: process.env.AWS_S3_BUCKET_NAME!,
                Key: document.storage_path,
            });

            const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

            return this.sendSuccess(
                res,
                {
                    file_name: document.file_name,
                    mime_type: document.mime_type,
                    is_image: document.is_image,
                    url: signedUrl,
                },
                "Document URL fetched successfully",
                200
            );

        } catch (err) {
            console.error("getDocumentUrl error:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public downloadDocument = async (req: Request, res: Response) => {
        try {
            const { id } = req.body;
            if (!id) return this.sendError(res, {}, "id is required", 400);

            // Lookup document in DB
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT file_name, mime_type, storage_path
           FROM lead_documents
          WHERE id = :id
          LIMIT 1;`,
                { replacements: { id }, type: QueryTypes.SELECT }
            );

            const doc = rows[0];
            if (!doc) return this.sendError(res, {}, "Document not found", 404);

            const key = String(doc.storage_path);
            const fileName = String(doc.file_name || "download");
            const mimeType = String(doc.mime_type || "application/octet-stream");

            // Fetch file from S3
            const s3Resp = await s3Client.send(
                new GetObjectCommand({ Bucket: this.bucketName, Key: key })
            );
            if (!s3Resp.Body) return this.sendError(res, {}, "File stream not found", 404);

            // Headers for download
            const asciiSafe = fileName.replace(/["\r\n]/g, "_");
            const disposition =
                `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

            res.setHeader("Content-Type", s3Resp.ContentType || mimeType);
            res.setHeader("Content-Disposition", disposition);
            if (s3Resp.ContentLength) res.setHeader("Content-Length", String(s3Resp.ContentLength));
            if (s3Resp.ETag) res.setHeader("ETag", s3Resp.ETag);
            if (s3Resp.LastModified) res.setHeader("Last-Modified", new Date(s3Resp.LastModified).toUTCString());

            res.setHeader("Cache-Control", "private, no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Accept-Ranges", "bytes");

            // Pipe directly to client
            await streamPipeline(s3Resp.Body as NodeJS.ReadableStream, res);

        } catch (err) {
            console.error("downloadDocument error:", err);
            if (!res.headersSent) {
                return this.sendError(res, err, "Internal server error", 500);
            }
            res.end();
        }
    };
    public getDocumentImage = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("Document id is required"),
                include_deleted: Yup.boolean().default(false),
                download: Yup.boolean().default(false), // force download vs inline preview
            });

            const { id, include_deleted, download } = await schema.validate(req.body, { abortEarly: false });

            // fetch document (join lead for ownership checks if needed)
            const where: string[] = ["d.id = :id"];
            const repl: any = { id };

            if (!include_deleted) {
                where.push("d.deleted_at IS NULL");
            }

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
        SELECT d.id, d.lead_id, d.file_name, d.mime_type, d.file_size, d.storage_path,
               d.is_image, d.created_at, d.updated_at, d.deleted_at,
               l.agent_id
          FROM public.lead_documents d
          JOIN public.leads l ON l.id = d.lead_id
         WHERE ${where.join(" AND ")}
         LIMIT 1
        `,
                { replacements: repl, type: QueryTypes.SELECT }
            );

            if (!rows.length) {
                return this.sendError(res, {}, "Document not found", 404);
            }

            const doc = rows[0];

            // ✅ must be an image
            if (!doc.is_image || !doc.mime_type?.startsWith("image/")) {
                return this.sendError(res, {}, "Not an image document", 415);
            }

            // build absolute file path
            const storageRoot = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
            const relativeFromUploads = doc.storage_path.replace(/^[\\/]*uploads[\\/]?/i, "");
            const absPath = path.join(storageRoot, relativeFromUploads);

            const normalized = path.normalize(absPath);
            if (!normalized.startsWith(path.normalize(storageRoot + path.sep))) {
                return this.sendError(res, {}, "Invalid storage path", 400);
            }

            if (!fs.existsSync(normalized)) {
                return this.sendError(res, {}, "File missing from storage", 410);
            }

            const stat = fs.statSync(normalized);

            // headers
            res.setHeader("Content-Type", doc.mime_type);
            res.setHeader("Content-Length", String(stat.size));
            res.setHeader("Last-Modified", stat.mtime.toUTCString());
            res.setHeader("Cache-Control", "private, max-age=31536000, immutable");

            const disposition = download ? "attachment" : "inline";
            const safeName = encodeURIComponent(doc.file_name || "image");
            res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);

            // stream
            const stream = fs.createReadStream(normalized);
            stream.on("error", (e) => {
                console.error("Stream error:", e);
                if (!res.headersSent) this.sendError(res, {}, "Error reading file", 500);
            });
            return stream.pipe(res);
        } catch (err: any) {
            console.error("Error in getDocumentImage:", err);
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public softDeleteTask = async (req: Request, res: Response) => {
        const tx = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                // optional optimistic concurrency guard
                updated_at: Yup.string().optional(),
            });

            const { id, updated_at } = await schema.validate(req.body, { abortEarly: false });

            const where: string[] = ["t.id = :id", "t.deleted_at IS NULL"];
            const repl: any = { id };

            if (updated_at) {
                where.push("t.updated_at = :updated_at");
                repl.updated_at = updated_at;
            }

            const rows = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_tasks AS t
             SET deleted_at = NOW(),
                 updated_at = NOW()
             WHERE ${where.join(" AND ")}
             RETURNING t.id, t.lead_id, t.deleted_at`,
                { replacements: repl, type: QueryTypes.SELECT, transaction: tx }
            );

            await tx.commit();

            if (!rows.length) {
                return this.sendError(
                    res,
                    {},
                    "No matching active task found (already deleted or concurrency mismatch).",
                    404
                );
            }

            return this.sendSuccess(res, { count: 1, item: rows[0] }, "Task deleted");
        } catch (err: any) {
            try { await tx.rollback(); } catch { }
            if (err.name === "ValidationError") {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }
            console.error("Error in softDeleteTask:", err);
            return this.sendError(res, err, "Internal server error", 500);
        }
    };
    public getAdminDashboard = async (req: Request, res: Response) => {
        try {
            // --- Auth (admins only)
            const auth = (req as any)?.user;
            if (!auth?.system_user_id) return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            const me = String(auth.system_user_id);
            const isAdmin = await this.isAdmin(me);
            if (!isAdmin) return this.sendError(res, {}, "Forbidden", 403);

            // --- Input validation
            const schema = Yup.object({
                days: Yup.number().integer().min(1).max(31).default(7),
            });
            const qp = await schema.validate(req.query, { abortEarly: false });
            const windowDays = Number(qp.days ?? 7);

            // ---- IST TZ window helpers
            const ZONE = "Asia/Kolkata";
            const DATE_FMT = "MM-dd-yyyy";
            const DATETIME_FMT = "MM-dd-yyyy hh:mm a";

            const nowCA = DateTime.now().setZone(ZONE);
            const todayStartCA = nowCA.startOf("day");
            const todayEndCA = nowCA.endOf("day");
            const nowUtcISO = nowCA.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayStartUTC = todayStartCA.toUTC().toISO({ suppressMilliseconds: true })!;
            const todayEndUTC = todayEndCA.toUTC().toISO({ suppressMilliseconds: true })!;

            const toCAString = (d: any) =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATETIME_FMT) : null;
            const toCADate = (d: any) =>
                d ? DateTime.fromJSDate(new Date(d), { zone: "utc" }).setZone(ZONE).toFormat(DATE_FMT) : null;

            // ==========================================================
            // 1) CARDS: Team totals for today & overdue (normalized status)
            // ==========================================================
            const [teamCards]: any[] = await this.db_services.sequelizeWriter.query(
                `
            WITH norm AS (
              SELECT
                t.id,
                t.start_at,
                t.end_at,
                t.updated_at,
                CASE
                  WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done'
                  WHEN LOWER(t.status::text) IN ('cancelled','canceled')        THEN 'cancelled'
                  WHEN LOWER(t.status::text) = 'pending'                       THEN 'pending'
                  ELSE NULL
                END AS s
              FROM public.lead_tasks t
              JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL
              WHERE t.deleted_at IS NULL
            ),
            today_base AS (
              SELECT id, s
              FROM norm
              WHERE start_at >= :start_utc AND start_at <= :end_utc
            ),
            done_marked_today AS (
              SELECT id
              FROM norm
              WHERE s = 'done'
                AND updated_at >= :start_utc AND updated_at <= :end_utc
            ),
            done_today_union AS (
              SELECT id FROM today_base WHERE s = 'done'
              UNION
              SELECT id FROM done_marked_today
            )
            SELECT
              (SELECT COUNT(*)             FROM today_base)                   AS total_today,
              (SELECT COUNT(*)             FROM today_base WHERE s='pending') AS pending_today,
              (SELECT COUNT(*)             FROM done_today_union)             AS done_today,
              (SELECT COUNT(*)             FROM today_base WHERE s='cancelled') AS cancelled_today,
              (SELECT COUNT(*) 
               FROM norm
               WHERE end_at IS NOT NULL
                 AND s = 'pending'
                 AND end_at < :now_utc)                                      AS overdue_all
            `,
                {
                    replacements: {
                        start_utc: todayStartUTC,
                        end_utc: todayEndUTC,
                        now_utc: nowUtcISO,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            // ==========================================================
            // 2) Per-agent summary (excluding blocked/deleted agents)
            // ==========================================================
            const teamByAgent: any[] = await this.db_services.sequelizeWriter.query(
                `
            WITH active_agents AS (
              SELECT su.id, su.name
              FROM public.system_users su
              JOIN public.user_role ur ON ur.system_user_id = su.id
              JOIN public.roles r      ON r.id = ur.role_id
              WHERE su.deleted_at IS NULL
                AND (su.is_blocked = FALSE OR su.is_blocked IS NULL)
                AND TRIM(LOWER(r.name)) = 'agent'
            ),
            lead_counts AS (
              SELECT
                l.agent_id,
                COUNT(*)::int AS total_assigned_leads,
                SUM((l.lead_status = 'New' OR l.lead_status IS NULL)::int)::int AS new_leads,
                SUM((l.lead_status = 'Converted')::int)::int AS converted_leads
              FROM public.leads l
              WHERE l.deleted_at IS NULL AND l.agent_id IS NOT NULL
              GROUP BY l.agent_id
            ),
            norm AS (
              SELECT
                t.id,
                t.assigned_agent_id,
                t.start_at,
                t.end_at,
                t.updated_at,
                CASE
                  WHEN LOWER(t.status::text) IN ('completed','complete','done') THEN 'done'
                  WHEN LOWER(t.status::text) IN ('cancelled','canceled')        THEN 'cancelled'
                  WHEN LOWER(t.status::text) = 'pending'                       THEN 'pending'
                  ELSE NULL
                END AS s
              FROM public.lead_tasks t
              JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL
              WHERE t.deleted_at IS NULL
            ),
            today_base AS (
              SELECT assigned_agent_id, id, s
              FROM norm
              WHERE start_at >= :start_utc AND start_at <= :end_utc
            ),
            done_marked_today AS (
              SELECT assigned_agent_id, id
              FROM norm
              WHERE s = 'done'
                AND updated_at >= :start_utc AND updated_at <= :end_utc
            ),
            done_today_union AS (
              SELECT assigned_agent_id, id FROM today_base WHERE s='done'
              UNION
              SELECT assigned_agent_id, id FROM done_marked_today
            ),
            overdue_now AS (
              SELECT assigned_agent_id, COUNT(*)::int AS overdue
              FROM norm
              WHERE end_at IS NOT NULL
                AND s = 'pending'
                AND end_at < :now_utc
              GROUP BY assigned_agent_id
            ),
            today_counts AS (
              SELECT
                tb.assigned_agent_id,
                COUNT(*)::int                                   AS total_today,
                SUM((tb.s='pending')::int)::int                 AS pending_today
              FROM today_base tb
              GROUP BY tb.assigned_agent_id
            ),
            done_counts AS (
              SELECT assigned_agent_id, COUNT(*)::int AS done_today
              FROM done_today_union
              GROUP BY assigned_agent_id
            )
            SELECT
              aa.id   AS agent_id,
              aa.name AS agent_name,
              COALESCE(lc.total_assigned_leads, 0) AS total_assigned_leads,
              COALESCE(lc.new_leads, 0)            AS new_leads,
              COALESCE(lc.converted_leads, 0)      AS converted_leads,
              COALESCE(tc.total_today, 0)          AS total_today,
              COALESCE(dc.done_today, 0)           AS done_today,
              COALESCE(tc.pending_today, 0)        AS pending_today,
              COALESCE(onow.overdue, 0)            AS overdue
            FROM active_agents aa
            LEFT JOIN lead_counts   lc   ON CAST(lc.agent_id AS TEXT) = CAST(aa.id AS TEXT)
            LEFT JOIN today_counts  tc   ON CAST(tc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT)
            LEFT JOIN done_counts   dc   ON CAST(dc.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT)
            LEFT JOIN overdue_now   onow ON CAST(onow.assigned_agent_id AS TEXT) = CAST(aa.id AS TEXT)
            ORDER BY total_assigned_leads DESC, overdue DESC, agent_name ASC
            `,
                {
                    replacements: {
                        start_utc: todayStartUTC,
                        end_utc: todayEndUTC,
                        now_utc: nowUtcISO,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            // ==========================================================
            // 3) Tasks list (today + overdue) per agent
            // ==========================================================
            const listTasksRaw: any[] = await this.db_services.sequelizeWriter.query(
                `
            SELECT
                t.id AS task_id,
                t.assigned_agent_id AS agent_id,
                su.name AS agent_name,
                t.lead_id,
                l.full_name AS lead_name,
                t.status,
                t.start_at,
                t.end_at
            FROM public.lead_tasks t
            JOIN public.leads l ON l.id = t.lead_id AND l.deleted_at IS NULL
            JOIN public.system_users su ON su.id = t.assigned_agent_id
            WHERE t.deleted_at IS NULL AND su.deleted_at IS NULL AND su.is_blocked = FALSE
            ORDER BY t.start_at ASC
            `,
                { type: QueryTypes.SELECT }
            );

            // --- group tasks by agent
            const todayTasksByAgent: Record<string, any> = {};
            const overdueTasksByAgent: Record<string, any> = {};

            listTasksRaw.forEach(t => {
                const agentKey = t.agent_id;
                const startCA = DateTime.fromJSDate(new Date(t.start_at), { zone: "utc" }).setZone(ZONE);
                const endCA = t.end_at ? DateTime.fromJSDate(new Date(t.end_at), { zone: "utc" }).setZone(ZONE) : null;

                // **Done today**
                if (startCA >= todayStartCA && startCA <= todayEndCA && ['completed', 'complete', 'done'].includes(t.status)) {
                    if (!todayTasksByAgent[agentKey]) todayTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
                    todayTasksByAgent[agentKey].tasks.push({
                        task_id: t.task_id,
                        lead_id: t.lead_id,
                        lead_name: t.lead_name,
                        status: 'done',
                        due_date: toCADate(t.end_at ?? t.start_at),
                        start_at_ca: toCAString(t.start_at),
                        end_at_ca: t.end_at ? toCAString(t.end_at) : null,
                    });
                }

                // **Pending today**
                if (startCA >= todayStartCA && startCA <= todayEndCA && t.status === 'pending') {
                    if (!todayTasksByAgent[agentKey]) todayTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
                    todayTasksByAgent[agentKey].tasks.push({
                        task_id: t.task_id,
                        lead_id: t.lead_id,
                        lead_name: t.lead_name,
                        status: 'pending',
                        due_date: toCADate(t.end_at ?? t.start_at),
                        start_at_ca: toCAString(t.start_at),
                        end_at_ca: t.end_at ? toCAString(t.end_at) : null,
                    });
                }

                // **Overdue (by end_at)**
                if (endCA && endCA < nowCA && t.status === 'pending') {
                    if (!overdueTasksByAgent[agentKey]) overdueTasksByAgent[agentKey] = { agent_id: t.agent_id, agent_name: t.agent_name, tasks: [] };
                    overdueTasksByAgent[agentKey].tasks.push({
                        task_id: t.task_id,
                        lead_id: t.lead_id,
                        lead_name: t.lead_name,
                        status: 'overdue',
                        due_date: toCADate(t.end_at),
                        start_at_ca: toCAString(t.start_at),
                        end_at_ca: toCAString(t.end_at),
                    });
                }
            });

            return this.sendSuccess(
                res,
                {
                    cards: {
                        team_tasks: {
                            total_today: Number(teamCards?.total_today ?? 0),
                            pending_today: Number(teamCards?.pending_today ?? 0),
                            done_today: Number(teamCards?.done_today ?? 0),
                            cancelled_today: Number(teamCards?.cancelled_today ?? 0),
                            overdue_all: Number(teamCards?.overdue_all ?? 0),
                            today_ca: todayStartCA.toFormat(DATE_FMT),
                        },
                    },
                    tables: {
                        team_tasks_by_agent: teamByAgent,
                    },
                    lists: {
                        today_tasks_by_agent: Object.values(todayTasksByAgent),
                        overdue_tasks_by_agent: Object.values(overdueTasksByAgent),
                    },
                },
                "Admin dashboard (Canada time)"
            );
        } catch (err: any) {
            console.error("getAdminDashboard error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, {}, "Internal server error", 500);
        }
    };















    // ==========================================
    // 💊 LEAD MEDICINES / ORDER ITEMS APIS
    // ==========================================

    public saveLeadMedicines = async (req: Request, res: Response) => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
                items: Yup.array().of(
                    Yup.object({
                        id: Yup.string().uuid().optional(),
                        medicine_name: Yup.string().trim().required("Medicine name is required"),
                        unit: Yup.string().trim().default("Strip"),
                        quantity: Yup.number().integer().min(1, "Quantity must be at least 1").required("Quantity is required"),
                        rate: Yup.number().min(0, "Rate cannot be negative").required("Rate is required"),
                    })
                ).required("items array is required"),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { lead_id, items } = body;

            // Verify lead exists
            const [leadRow]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, full_name, lead_number FROM public.leads WHERE id = :lead_id AND deleted_at IS NULL LIMIT 1`,
                { replacements: { lead_id }, type: QueryTypes.SELECT, transaction }
            );
            if (!leadRow) {
                await transaction.rollback();
                return this.sendError(res, {}, "Lead not found", 404);
            }

            // Soft-delete existing active items for this lead
            await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_medicines SET deleted_at = NOW() WHERE lead_id = :lead_id AND deleted_at IS NULL`,
                { replacements: { lead_id }, type: QueryTypes.UPDATE, transaction }
            );

            // Insert new items
            const insertedRows: any[] = [];
            let grandTotal = 0;

            for (const item of items) {
                const qty = Number(item.quantity) || 1;
                const rate = Number(item.rate) || 0;
                const totalPrice = Number((qty * rate).toFixed(2));
                grandTotal += totalPrice;

                const itemId = uuidv4();
                const [row]: any[] = await this.db_services.sequelizeWriter.query(
                    `INSERT INTO public.lead_medicines
                        (id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at)
                      VALUES
                        (:id, :lead_id, :medicine_name, :unit, :quantity, :rate, :total_price, NOW(), NOW())
                      RETURNING id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at`,
                    {
                        replacements: {
                            id: itemId,
                            lead_id,
                            medicine_name: item.medicine_name,
                            unit: item.unit || "Strip",
                            quantity: qty,
                            rate,
                            total_price: totalPrice,
                        },
                        type: QueryTypes.SELECT,
                        transaction,
                    }
                );
                if (row) insertedRows.push(row);
            }

            await transaction.commit();

            // Log activity
            const authUserId = (req as any)?.user?.system_user_id;
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,
                    user_activity: `Updated medicines for lead ${leadRow.lead_number} (Total items: ${insertedRows.length}, Grand Total: ${grandTotal.toFixed(2)})`,
                    module: "order_management",
                    type: "update",
                });
            }

            return this.sendSuccess(
                res,
                {
                    items: insertedRows,
                    total_items: insertedRows.length,
                    grand_total: Number(grandTotal.toFixed(2)),
                },
                "Lead medicines saved successfully"
            );
        } catch (err: any) {
            await transaction.rollback();
            console.error("saveLeadMedicines error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

    public listLeadMedicines = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            const { lead_id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at
                   FROM public.lead_medicines
                  WHERE lead_id = :lead_id AND deleted_at IS NULL
                  ORDER BY created_at ASC`,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );

            const grandTotal = rows.reduce((acc, r) => acc + (Number(r.total_price) || 0), 0);

            return this.sendSuccess(
                res,
                {
                    items: rows,
                    total_items: rows.length,
                    grand_total: Number(grandTotal.toFixed(2)),
                },
                "Lead medicines fetched successfully"
            );
        } catch (err: any) {
            console.error("listLeadMedicines error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

    public deleteLeadMedicine = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            const { id, lead_id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_medicines
                     SET deleted_at = NOW(), updated_at = NOW()
                   WHERE id = :id AND lead_id = :lead_id AND deleted_at IS NULL
                   RETURNING id, lead_id, medicine_name`,
                { replacements: { id, lead_id }, type: QueryTypes.SELECT }
            );

            if (!rows.length) {
                return this.sendError(res, {}, "Medicine item not found", 404);
            }

            // Recalculate remaining grand total
            const remaining: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT COALESCE(SUM(total_price), 0)::numeric AS grand_total
                   FROM public.lead_medicines
                  WHERE lead_id = :lead_id AND deleted_at IS NULL`,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );
            const grandTotal = Number(remaining[0]?.grand_total || 0);

            return this.sendSuccess(
                res,
                {
                    deleted_item: rows[0],
                    grand_total: Number(grandTotal.toFixed(2)),
                },
                "Medicine item deleted successfully"
            );
        } catch (err: any) {
            console.error("deleteLeadMedicine error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };


    // ==========================================
    // 📦 MULTI-ORDER MANAGEMENT APIS
    // ==========================================

    public saveLeadOrder = async (req: Request, res: Response) => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().optional(),
                lead_id: Yup.string().uuid().required("lead_id is required"),
                payment_status: Yup.string().default("Pending"),
                payment_mode: Yup.string().default("COD"),
                order_status: Yup.string().default("Pending"),
                order_notes: Yup.string().nullable().optional(),
                courier_name: Yup.string().nullable().optional(),
                tracking_number: Yup.string().nullable().optional(),
                items: Yup.array().of(
                    Yup.object({
                        id: Yup.string().uuid().optional(),
                        medicine_name: Yup.string().trim().required("Medicine name is required"),
                        unit: Yup.string().trim().default("Strip"),
                        quantity: Yup.number().integer().min(1, "Quantity must be at least 1").required("Quantity is required"),
                        rate: Yup.number().min(0, "Rate cannot be negative").required("Rate is required"),
                    })
                ).min(1, "At least one medicine item is required").required("items array is required"),
            });

            const body = await schema.validate(req.body, { abortEarly: false });
            const { id: existingOrderId, lead_id, payment_status, payment_mode, order_status, order_notes, courier_name, tracking_number, items } = body;

            // Verify lead exists
            const [leadRow]: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, full_name, lead_number FROM public.leads WHERE id = :lead_id AND deleted_at IS NULL LIMIT 1`,
                { replacements: { lead_id }, type: QueryTypes.SELECT, transaction }
            );
            if (!leadRow) {
                await transaction.rollback();
                return this.sendError(res, {}, "Lead not found", 404);
            }

            const authUserId = (req as any)?.user?.system_user_id || null;

            // Calculate totals
            let grandTotal = 0;
            const computedItems: any[] = [];
            for (const item of items) {
                const qty = Number(item.quantity) || 1;
                const rate = Number(item.rate) || 0;
                const totalPrice = Number((qty * rate).toFixed(2));
                grandTotal += totalPrice;
                computedItems.push({
                    medicine_name: item.medicine_name,
                    unit: item.unit || "Strip",
                    quantity: qty,
                    rate,
                    total_price: totalPrice,
                });
            }
            grandTotal = Number(grandTotal.toFixed(2));

            let orderId = existingOrderId;
            let orderNumber = "";

            if (existingOrderId) {
                // Update existing order
                const [existingOrder]: any[] = await this.db_services.sequelizeWriter.query(
                    `SELECT id, order_number FROM public.lead_orders WHERE id = :id AND lead_id = :lead_id AND deleted_at IS NULL LIMIT 1`,
                    { replacements: { id: existingOrderId, lead_id }, type: QueryTypes.SELECT, transaction }
                );
                if (!existingOrder) {
                    await transaction.rollback();
                    return this.sendError(res, {}, "Order not found", 404);
                }
                orderNumber = existingOrder.order_number;

                await this.db_services.sequelizeWriter.query(
                    `UPDATE public.lead_orders
                         SET total_items = :total_items,
                             grand_total = :grand_total,
                             order_status = :order_status,
                             payment_status = :payment_status,
                             payment_mode = :payment_mode,
                             order_notes = :order_notes,
                             courier_name = :courier_name,
                             tracking_number = :tracking_number,
                             agent_id = COALESCE(:agent_id, agent_id),
                             updated_at = NOW()
                       WHERE id = :id AND lead_id = :lead_id`,
                    {
                        replacements: {
                            id: existingOrderId,
                            lead_id,
                            total_items: computedItems.length,
                            grand_total: grandTotal,
                            order_status,
                            payment_status,
                            payment_mode,
                            order_notes: order_notes || null,
                            courier_name: courier_name || null,
                            tracking_number: tracking_number || null,
                            agent_id: authUserId,
                        },
                        type: QueryTypes.UPDATE,
                        transaction,
                    }
                );

                // Remove existing items
                await this.db_services.sequelizeWriter.query(
                    `DELETE FROM public.lead_order_items WHERE order_id = :order_id`,
                    { replacements: { order_id: existingOrderId }, type: QueryTypes.DELETE, transaction }
                );
            } else {
                // Create brand new order
                orderId = uuidv4();
                const [newOrderRow]: any[] = await this.db_services.sequelizeWriter.query(
                    `INSERT INTO public.lead_orders
                        (id, lead_id, agent_id, total_items, grand_total, order_status, payment_status, payment_mode, order_notes, courier_name, tracking_number, created_at, updated_at)
                      VALUES
                        (:id, :lead_id, :agent_id, :total_items, :grand_total, :order_status, :payment_status, :payment_mode, :order_notes, :courier_name, :tracking_number, NOW(), NOW())
                      RETURNING id, order_number, created_at, updated_at`,
                    {
                        replacements: {
                            id: orderId,
                            lead_id,
                            agent_id: authUserId,
                            total_items: computedItems.length,
                            grand_total: grandTotal,
                            order_status,
                            payment_status,
                            payment_mode,
                            order_notes: order_notes || null,
                            courier_name: courier_name || null,
                            tracking_number: tracking_number || null,
                        },
                        type: QueryTypes.SELECT,
                        transaction,
                    }
                );
                orderNumber = newOrderRow.order_number;
            }

            // Insert items into lead_order_items
            const insertedItems: any[] = [];
            for (const item of computedItems) {
                const itemId = uuidv4();
                const [itemRow]: any[] = await this.db_services.sequelizeWriter.query(
                    `INSERT INTO public.lead_order_items
                        (id, order_id, lead_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at)
                      VALUES
                        (:id, :order_id, :lead_id, :medicine_name, :unit, :quantity, :rate, :total_price, NOW(), NOW())
                      RETURNING id, order_id, medicine_name, unit, quantity, rate, total_price, created_at, updated_at`,
                    {
                        replacements: {
                            id: itemId,
                            order_id: orderId,
                            lead_id,
                            medicine_name: item.medicine_name,
                            unit: item.unit,
                            quantity: item.quantity,
                            rate: item.rate,
                            total_price: item.total_price,
                        },
                        type: QueryTypes.SELECT,
                        transaction,
                    }
                );
                if (itemRow) insertedItems.push(itemRow);
            }

            await transaction.commit();

            // Log activity
            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,
                    user_activity: `${existingOrderId ? "Updated" : "Created"} order ${orderNumber} for lead ${leadRow.lead_number} (Items: ${insertedItems.length}, Total: ₹${grandTotal.toFixed(2)})`,
                    module: "order_management",
                    type: existingOrderId ? "update" : "create",
                });
            }

            return this.sendSuccess(
                res,
                {
                    id: orderId,
                    order_number: orderNumber,
                    lead_id,
                    total_items: insertedItems.length,
                    grand_total: grandTotal,
                    order_status,
                    payment_status,
                    payment_mode,
                    courier_name,
                    tracking_number,
                    items: insertedItems,
                },
                `Order ${orderNumber} saved successfully`
            );
        } catch (err: any) {
            await transaction.rollback();
            console.error("saveLeadOrder error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

    public listLeadOrders = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            const { lead_id } = await schema.validate(req.body, { abortEarly: false });

            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT
                    o.id,
                    o.order_number,
                    o.lead_id,
                    o.agent_id,
                    u.name AS agent_name,
                    o.total_items,
                    o.grand_total,
                    o.order_status,
                    o.payment_status,
                    o.payment_mode,
                    o.order_notes,
                    o.courier_name,
                    o.tracking_number,
                    o.created_at,
                    o.updated_at,
                    COALESCE(
                        JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'id', oi.id,
                                'order_id', oi.order_id,
                                'medicine_name', oi.medicine_name,
                                'unit', oi.unit,
                                'quantity', oi.quantity,
                                'rate', oi.rate,
                                'total_price', oi.total_price
                            ) ORDER BY oi.created_at ASC
                        ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json
                    ) AS items
                 FROM public.lead_orders o
                 LEFT JOIN public.system_users u ON o.agent_id = u.id
                 LEFT JOIN public.lead_order_items oi ON o.id = oi.order_id AND oi.deleted_at IS NULL
                 WHERE o.lead_id = :lead_id AND o.deleted_at IS NULL
                 GROUP BY o.id, u.name
                 ORDER BY o.created_at DESC`,
                { replacements: { lead_id }, type: QueryTypes.SELECT }
            );

            const allOrdersTotal = rows.reduce((acc, r) => acc + (Number(r.grand_total) || 0), 0);

            return this.sendSuccess(
                res,
                {
                    orders: rows,
                    total_orders: rows.length,
                    all_orders_grand_total: Number(allOrdersTotal.toFixed(2)),
                },
                "Lead orders fetched successfully"
            );
        } catch (err: any) {
            console.error("listLeadOrders error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

    public deleteLeadOrder = async (req: Request, res: Response) => {
        const transaction = await this.db_services.sequelizeWriter.transaction();
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                lead_id: Yup.string().uuid().required("lead_id is required"),
            });
            const { id, lead_id } = await schema.validate(req.body, { abortEarly: false });

            const [orderRow]: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_orders
                     SET deleted_at = NOW(), updated_at = NOW()
                   WHERE id = :id AND lead_id = :lead_id AND deleted_at IS NULL
                   RETURNING id, order_number`,
                { replacements: { id, lead_id }, type: QueryTypes.SELECT, transaction }
            );

            if (!orderRow) {
                await transaction.rollback();
                return this.sendError(res, {}, "Order not found", 404);
            }

            // Soft-delete items
            await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_order_items
                     SET deleted_at = NOW(), updated_at = NOW()
                   WHERE order_id = :id`,
                { replacements: { id }, type: QueryTypes.UPDATE, transaction }
            );

            await transaction.commit();

            return this.sendSuccess(
                res,
                { deleted_order: orderRow },
                `Order ${orderRow.order_number} deleted successfully`
            );
        } catch (err: any) {
            await transaction.rollback();
            console.error("deleteLeadOrder error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };


    public updateLeadOrderStatus = async (req: Request, res: Response) => {
        try {
            const schema = Yup.object({
                id: Yup.string().uuid().required("id is required"),
                lead_id: Yup.string().uuid().required("lead_id is required"),
                order_status: Yup.string().optional(),
                payment_status: Yup.string().optional(),
                payment_mode: Yup.string().optional(),
                order_notes: Yup.string().nullable().optional(),
                courier_name: Yup.string().nullable().optional(),
                tracking_number: Yup.string().nullable().optional(),
            });
            const body = await schema.validate(req.body, { abortEarly: false });
            const { id, lead_id, order_status, payment_status, payment_mode, order_notes, courier_name, tracking_number } = body;

            const authUserId = (req as any)?.user?.system_user_id || null;

            const [updatedOrder]: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE public.lead_orders
                     SET order_status = COALESCE(:order_status, order_status),
                         payment_status = COALESCE(:payment_status, payment_status),
                         payment_mode = COALESCE(:payment_mode, payment_mode),
                         order_notes = COALESCE(:order_notes, order_notes),
                         courier_name = COALESCE(:courier_name, courier_name),
                         tracking_number = COALESCE(:tracking_number, tracking_number),
                         updated_at = NOW()
                   WHERE id = :id AND lead_id = :lead_id AND deleted_at IS NULL
                   RETURNING id, order_number, order_status, payment_status, payment_mode, grand_total`,
                {
                    replacements: {
                        id,
                        lead_id,
                        order_status: order_status || null,
                        payment_status: payment_status || null,
                        payment_mode: payment_mode || null,
                        order_notes: order_notes !== undefined ? order_notes : null,
                        courier_name: courier_name !== undefined ? courier_name : null,
                        tracking_number: tracking_number !== undefined ? tracking_number : null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            if (!updatedOrder) {
                return this.sendError(res, {}, "Order not found", 404);
            }

            if (authUserId) {
                await SystemUserActivity.create({
                    system_user_id: authUserId,
                    user_activity: `Updated status for order ${updatedOrder.order_number} to Status: ${updatedOrder.order_status}, Payment: ${updatedOrder.payment_status}`,
                    module: "order_management",
                    type: "update",
                });
            }

            return this.sendSuccess(
                res,
                { order: updatedOrder },
                `Order ${updatedOrder.order_number} status updated successfully`
            );
        } catch (err: any) {
            console.error("updateLeadOrderStatus error:", err);
            if (err?.name === "ValidationError") return this.sendError(res, {}, err.errors.join(", "), 400);
            return this.sendError(res, err, err?.message || "Internal server error", 500);
        }
    };

}
