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
                lead_status: s().optional(),
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
                    if (emailNorm && (r.email || "").toLowerCase() === emailNorm) conflicts.push(`Email (${emailNorm})`);
                    if (phoneNorm && normDigits(r.phone) === phoneNorm) conflicts.push(`Mobile (${input.phone})`);
                    if (whatsappNorm && normDigits(r.whatsapp_number) === whatsappNorm) conflicts.push(`WhatsApp (${input.whatsapp_number})`);

                    await transaction.rollback();
                    const conflictMsg = conflicts.length > 0
                        ? `Lead already exists with this ${conflicts.join(" and ")}`
                        : "A lead with this contact information already exists.";

                    this.sendError(res, { conflicts }, conflictMsg, 409);
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
                "currency",
                "lead_status"
            ];
            const vals = [
                ":id", ":full_name", ":email", ":phone",
                ":address_line1", ":address_line2", ":city", ":state", ":postal_code", ":country",
                "COALESCE(:lead_score,0)", ":lead_quality", ":best_time_to_call",
                ":agent_id", ":whatsapp_number", "NOW()", "NOW()",
                ":lead_source_id", 
                ":currency",
                ":lead_status"
            ];

            let resolvedLeadCurrency = "INR";
            const cntry = (input.country || "").toLowerCase();
            const phn = (phoneNorm || "").toLowerCase();
            if (cntry.includes("uk") || cntry.includes("united kingdom") || phn.startsWith("+44") || phn.startsWith("44")) {
                resolvedLeadCurrency = "GBP";
            } else if (cntry.includes("usa") || cntry.includes("united states") || phn.startsWith("+1") || phn.startsWith("1")) {
                resolvedLeadCurrency = "USD";
            } else {
                resolvedLeadCurrency = "INR";
            }

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
                currency: resolvedLeadCurrency,
                lead_status: toNull(input.lead_status) ?? "New",
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
                  l.full_name,
                  l.email, l.phone,
                  l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                  l.lead_score, l.lead_quality, l.best_time_to_call,
                  l.agent_id, su.name AS agent_name,
                  l.created_at, l.updated_at,
                  ls.name AS lead_source_name,
                  
                  
                  l.whatsapp_number, l.note, l.lead_source_id, l.lead_status, l.currency,
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
                payment_status: "Pending",
                delivery_status: "Pending",
                currency: r.currency ?? null,
                courier_name: null,
                tracking_number: null,
                
                
                whatsapp_number: r.whatsapp_number ?? null,
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
                  l.full_name,
                  l.email, l.phone,
                  l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                  l.lead_score, l.lead_quality, l.best_time_to_call,
                  l.agent_id, su.name AS agent_name,
                  l.created_at, l.updated_at,
                  ls.name AS lead_source_name,
                  l.whatsapp_number, l.note, l.lead_source_id,
                  CASE WHEN COALESCE(ord_agg.order_count, 0) > 0 THEN 'Converted' ELSE l.lead_status END AS lead_status,
                  COALESCE(ord_agg.latest_payment_status, 'Pending') AS payment_status,
                  COALESCE(ord_agg.latest_order_status, 'Pending') AS delivery_status,
                  l.currency,
                  COALESCE(ord_agg.order_count, 0) AS order_count,
                  COALESCE(ord_agg.total_order_amount, 0) AS total_order_amount,
                  ord_agg.latest_order_number,
                  ord_agg.latest_order_status,
                  ord_agg.latest_payment_status,
                  ord_agg.latest_courier_name,
                  ord_agg.latest_tracking_number,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400))::int AS lead_age_days
                FROM public.leads l
                LEFT JOIN public.system_users su ON su.id = l.agent_id
                LEFT JOIN public.lead_sources ls ON ls.id = l.lead_source_id
                LEFT JOIN (
                    SELECT 
                        lead_id, 
                        COUNT(id)::int AS order_count,
                        COALESCE(SUM(CASE WHEN order_status != 'Cancelled' THEN grand_total ELSE 0 END), 0)::numeric AS total_order_amount,
                        (ARRAY_AGG(order_number ORDER BY created_at DESC))[1] AS latest_order_number,
                        (ARRAY_AGG(order_status ORDER BY created_at DESC))[1] AS latest_order_status,
                        (ARRAY_AGG(payment_status ORDER BY created_at DESC))[1] AS latest_payment_status,
                        (ARRAY_AGG(courier_name ORDER BY created_at DESC))[1] AS latest_courier_name,
                        (ARRAY_AGG(tracking_number ORDER BY created_at DESC))[1] AS latest_tracking_number
                    FROM public.lead_orders
                    WHERE deleted_at IS NULL
                    GROUP BY lead_id
                ) ord_agg ON ord_agg.lead_id = l.id
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
                courier_name: r.latest_courier_name ?? null,
                tracking_number: r.latest_tracking_number ?? null,
                order_count: Number(r.order_count || 0),
                total_order_amount: Number(r.total_order_amount || 0),
                latest_order_number: r.latest_order_number ?? null,
                latest_order_status: r.latest_order_status ?? null,
                latest_payment_status: r.latest_payment_status ?? null,
                whatsapp_number: r.whatsapp_number ?? null,
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
                  
                  
                  l.whatsapp_number, l.lead_source_id, l.lead_status, l.currency,
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
                payment_status: "Pending",
                delivery_status: "Pending",
                currency: r.currency ?? null,
                courier_name: null,
                tracking_number: null,
                
                
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
      
          if (agent_id && !UUID36.test(String(agent_id))) {
            return this.sendError(res, {}, "agent_id must be a valid UUID", 400);
          }
      
          if (lead_source_id && !UUID36.test(String(lead_source_id))) {
            return this.sendError(res, {}, "lead_source_id must be a valid UUID", 400);
          }
      
          // Pre-fetch all active lead sources for name-to-id mapping
          const allLeadSources: any[] = await this.db_services.sequelizeWriter.query(
            `SELECT id, name FROM public.lead_sources`,
            { type: QueryTypes.SELECT }
          );
          const leadSourceMap = new Map<string, string>();
          for (const s of allLeadSources) {
            if (s.name) leadSourceMap.set(String(s.name).trim().toLowerCase(), String(s.id));
          }
      
          // --- Header normalization map ---
          const HEADER_MAP: Record<string, string> = {
            "full name": "full_name", "fullname": "full_name", "full_name": "full_name", "name": "full_name",
            "mobile": "phone", "mobile number": "phone", "mobile no": "phone", "phone": "phone", "phone number": "phone",
            "email": "email", "e-mail": "email", "mail": "email",
            "whatsapp": "whatsapp_number", "whatsapp number": "whatsapp_number", "whatsapp_number": "whatsapp_number",
            "address line1": "address_line1", "address_line1": "address_line1", "address": "address_line1",
            "address line2": "address_line2", "address_line2": "address_line2",
            "city": "city", "state": "state", "postal code": "postal_code", "postal_code": "postal_code", "zip": "postal_code", "pincode": "postal_code",
            "country": "country",
            "lead score": "lead_score", "lead_score": "lead_score",
            "lead quality": "lead_quality", "lead_quality": "lead_quality",
            "best time to call": "best_time_to_call", "best_time_to_call": "best_time_to_call",
            "agent id": "agent_id", "agent_id": "agent_id",
            "lead source": "lead_source", "lead_source": "lead_source", "source": "lead_source",
            "lead source id": "lead_source_id", "lead_source_id": "lead_source_id",
            "note": "note", "notes": "note"
          };
      
          // --- Row schema (empty strings transformed to null) ---
          const toEmptyNull = (v: any) => (v === "" || v === undefined ? null : v);
          const rowSchema = Yup.object({
            full_name: Yup.string().trim().required("full_name is required"),
            email: Yup.string().trim().email("Invalid email").required("email is required"),
            phone: Yup.string().trim().required("phone is required"),
            whatsapp_number: Yup.string().nullable().transform(toEmptyNull).optional(),
            address_line1: Yup.string().nullable().transform(toEmptyNull).optional(),
            address_line2: Yup.string().nullable().transform(toEmptyNull).optional(),
            city: Yup.string().nullable().transform(toEmptyNull).optional(),
            state: Yup.string().nullable().transform(toEmptyNull).optional(),
            postal_code: Yup.string().nullable().transform(toEmptyNull).optional(),
            country: Yup.string().nullable().transform(toEmptyNull).optional(),
            lead_score: Yup.number().transform((v, o) => (o === "" || isNaN(v) ? 0 : v)).nullable().optional(),
            lead_quality: Yup.string().nullable().transform(toEmptyNull).optional(),
            best_time_to_call: Yup.string().nullable().transform(toEmptyNull).optional(),
            note: Yup.string().nullable().transform(toEmptyNull).optional(),
            agent_id: Yup.string().nullable().transform(toEmptyNull).optional(),
            lead_source: Yup.string().nullable().transform(toEmptyNull).optional(),
            lead_source_id: Yup.string().nullable().transform(toEmptyNull).optional(),
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
              const phoneNorm = typeof v.phone === "string" ? v.phone.trim() : String(v.phone);
              const phoneDigits = normDigits(v.phone ?? null);
              const whatsappNorm = v.whatsapp_number ? String(v.whatsapp_number).trim() : null;
              const whatsDigits = normDigits(v.whatsapp_number ?? null);
      
              if (!emailNorm && !phoneDigits) {
                results.push({ index: i, success: false, error: "Row must include valid email and phone" });
                continue;
              }
      
              if (emailNorm) {
                if (seenEmail.has(emailNorm)) {
                  results.push({ index: i, success: false, error: `Duplicate email in file (first at row ${seenEmail.get(emailNorm)! + 1})` });
                  continue;
                }
                seenEmail.set(emailNorm, i);
              }
              if (phoneDigits) {
                if (seenPhone.has(phoneDigits)) {
                  results.push({ index: i, success: false, error: `Duplicate phone in file (first at row ${seenPhone.get(phoneDigits)! + 1})` });
                  continue;
                }
                seenPhone.set(phoneDigits, i);
              }
              if (whatsDigits) {
                if (seenWhats.has(whatsDigits)) {
                  results.push({ index: i, success: false, error: `Duplicate whatsapp_number in file (first at row ${seenWhats.get(whatsDigits)! + 1})` });
                  continue;
                }
                seenWhats.set(whatsDigits, i);
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
          const phones = Array.from(new Set(clean.map(c => normDigits(c.phoneNorm)).filter(Boolean))) as string[];
          const whats = Array.from(new Set(clean.map(c => normDigits(c.whatsappNorm)).filter(Boolean))) as string[];
      
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
                   REGEXP_REPLACE(phone, '\\D', '', 'g') AS phone_norm,
                   REGEXP_REPLACE(whatsapp_number, '\\D', '', 'g') AS whatsapp_norm
              FROM public.leads
             WHERE deleted_at IS NULL
               AND (
                     (email IS NOT NULL AND LOWER(email) IN (${emailParams}))
                  OR (phone IS NOT NULL AND REGEXP_REPLACE(phone, '\\D', '', 'g') IN (${phoneParams}))
                  OR (whatsapp_number IS NOT NULL AND REGEXP_REPLACE(whatsapp_number, '\\D', '', 'g') IN (${whatsParams}))
               )
            `,
            { replacements: rep, type: QueryTypes.SELECT }
          );
      
          const existEmailSet = new Set((existing || []).map(x => x.email_norm).filter(Boolean));
          const existPhoneSet = new Set((existing || []).map(x => x.phone_norm).filter(Boolean));
          const existWhatsSet = new Set((existing || []).map(x => x.whatsapp_norm).filter(Boolean));
      
          // --- Insert valid non-duplicate rows ---
          for (const c of clean) {
            const phoneDigits = normDigits(c.phoneNorm);
            const whatsDigits = normDigits(c.whatsappNorm);
            const dupParts: string[] = [];
            if (c.emailNorm && existEmailSet.has(c.emailNorm)) dupParts.push("email");
            if (phoneDigits && existPhoneSet.has(phoneDigits)) dupParts.push("phone");
            if (whatsDigits && existWhatsSet.has(whatsDigits)) dupParts.push("whatsapp_number");
            if (dupParts.length) {
              results.push({ index: c.idx, success: false, error: `Duplicate in DB: ${dupParts.join(" & ")}` });
              continue;
            }
      
            try {
              const id = uuidv4();
      
              // Resolve agent_id: Row > Body > NULL
              const rowAgentId = toNull(c.data.agent_id) || toNull(agent_id);
      
              // Resolve lead_source_id: Named source in row > Source ID in row > Body Source ID > NULL
              let resolvedSourceId = null;
              if (c.data.lead_source && leadSourceMap.has(String(c.data.lead_source).trim().toLowerCase())) {
                resolvedSourceId = leadSourceMap.get(String(c.data.lead_source).trim().toLowerCase());
              } else if (c.data.lead_source_id && UUID36.test(String(c.data.lead_source_id))) {
                resolvedSourceId = c.data.lead_source_id;
              } else if (lead_source_id && UUID36.test(String(lead_source_id))) {
                resolvedSourceId = lead_source_id;
              }
      
              // Auto-resolve currency from country or phone code
              let resolvedCurrency = "INR";
              const cCountry = String(c.data.country || "").trim().toLowerCase();
              const cPhone = String(c.phoneNorm || "").trim();
              if (cCountry === "usa" || cCountry === "us" || cCountry === "united states" || cPhone.startsWith("+1") || cPhone.startsWith("1")) {
                resolvedCurrency = "USD";
              } else if (cCountry === "uk" || cCountry === "united kingdom" || cCountry === "gb" || cPhone.startsWith("+44") || cPhone.startsWith("44")) {
                resolvedCurrency = "GBP";
              } else {
                resolvedCurrency = "INR";
              }

              const [inserted]: any[] = await this.db_services.sequelizeWriter.query(
                `
                INSERT INTO public.leads
                  (id, full_name, email, phone, whatsapp_number,
                   agent_id,
                   address_line1, address_line2, city, state, postal_code, country,
                   lead_score, lead_quality, best_time_to_call, note,
                   lead_source_id, lead_status, currency,
                   created_at, updated_at)
                VALUES
                  (:id, :full_name, :email, :phone, :whatsapp_number,
                   :agent_id,
                   :address_line1, :address_line2, :city, :state, :postal_code, :country,
                   COALESCE(:lead_score,0), :lead_quality, :best_time_to_call, :note,
                   :lead_source_id, 'New', :currency,
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
                    lead_source_id: resolvedSourceId,
                    currency: resolvedCurrency,
                  },
                  type: QueryTypes.SELECT,
                }
              );
      
              results.push({ index: c.idx, success: true, data: inserted });
              if (c.emailNorm) existEmailSet.add(c.emailNorm);
              if (phoneDigits) existPhoneSet.add(phoneDigits);
              if (whatsDigits) existWhatsSet.add(whatsDigits);
            } catch (e: any) {
              const msg = e?.message || "Row insert failed";
              results.push({ index: c.idx, success: false, error: msg });
            }
          }
      
          const successCount = results.filter(r => r.success).length;
          const failedCount = results.filter(r => !r.success).length;
      
          if (successCount === 0) {
            return this.sendError(res, { total: results.length, successCount, failedCount, results }, "Bulk upload failed - all rows invalid", 400);
          }
      
          return this.sendSuccess(
            res,
            { total: results.length, successCount, failedCount, results },
            `Bulk upload completed: ${successCount} lead(s) created, ${failedCount} failed`
          );
        } catch (err: any) {
          console.error("bulkUploadFromFile error:", err);
          return this.sendError(res, { error: err?.message, stack: err?.stack }, err?.message || "Internal server error", 500);
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
          ];
          const repl: Record<string, any> = { agentUserId };
      
          if (search && search.length) {
            where.push(`(wn.title ILIKE :q OR wn.body ILIKE :q OR COALESCE(l.full_name, '') ILIKE :q OR COALESCE(l.lead_number::text, '') ILIKE :q)`);
            repl.q = `%${search}%`;
          }
      
          const whereSql = where.length ? `AND ${where.join(" AND ")}` : "";
      
          // Count total
          const countQuery = `
            SELECT COUNT(*)::int AS total 
            FROM public.web_push_notifications wn
            JOIN public.leads l ON (wn.ref_id = l.id OR (wn.data->>'lead_id')::uuid = l.id) AND l.deleted_at IS NULL
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
              wn.data,
              wn.created_at,
              wn.updated_at,
              COALESCE((wn.data->>'lead_id')::uuid, wn.ref_id) AS lead_id,
              l.lead_number,
              l.full_name,
              l.agent_id
            FROM public.web_push_notifications wn
            JOIN public.leads l ON (wn.ref_id = l.id OR (wn.data->>'lead_id')::uuid = l.id) AND l.deleted_at IS NULL
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
            "lead_status",
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
            lead_status: Yup.string().optional(),
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

            // ✅ Check duplicates for updated contact fields
            const normEmail = updateData.email ? String(updateData.email).trim().toLowerCase() : null;
            const normPhone = updateData.phone ? String(updateData.phone).trim().replace(/\D/g, "") : null;
            const normWhatsApp = updateData.whatsapp_number ? String(updateData.whatsapp_number).trim().replace(/\D/g, "") : null;

            const orConds: string[] = [];
            const replCheck: Record<string, any> = { id };
            if (normEmail) { orConds.push("LOWER(email) = :ce"); replCheck.ce = normEmail; }
            if (normPhone) { orConds.push("REGEXP_REPLACE(phone, '\\\\D', '', 'g') = :cp"); replCheck.cp = normPhone; }
            if (normWhatsApp) { orConds.push("REGEXP_REPLACE(whatsapp_number, '\\\\D', '', 'g') = :cw"); replCheck.cw = normWhatsApp; }

            if (orConds.length > 0) {
                const dupRows: any[] = await this.db_services.sequelizeWriter.query(
                    `SELECT id, email, phone, whatsapp_number
                       FROM public.leads
                      WHERE deleted_at IS NULL
                        AND id != :id
                        AND (${orConds.join(" OR ")})
                      LIMIT 1`,
                    { replacements: replCheck, type: QueryTypes.SELECT, transaction }
                );

                if (dupRows.length) {
                    const r = dupRows[0];
                    const conflicts: string[] = [];
                    if (normEmail && (r.email || "").toLowerCase() === normEmail) conflicts.push(`Email (${normEmail})`);
                    if (normPhone && (r.phone || "").replace(/\D/g, "") === normPhone) conflicts.push(`Mobile (${updateData.phone})`);
                    if (normWhatsApp && (r.whatsapp_number || "").replace(/\D/g, "") === normWhatsApp) conflicts.push(`WhatsApp (${updateData.whatsapp_number})`);

                    await transaction.rollback();
                    const conflictMsg = conflicts.length > 0
                        ? `Another lead already exists with this ${conflicts.join(" and ")}`
                        : "Another lead with this contact information already exists.";
                    return this.sendError(res, { conflicts }, conflictMsg, 409);
                }
            }

            const targetCountry = (updateData.country ?? existingLead.country ?? "").toLowerCase();
            const targetPhone = (updateData.phone ?? existingLead.phone ?? "").toLowerCase();
            if (targetCountry.includes("uk") || targetCountry.includes("united kingdom") || targetPhone.startsWith("+44") || targetPhone.startsWith("44")) {
                updateData.currency = "GBP";
            } else if (targetCountry.includes("usa") || targetCountry.includes("united states") || targetPhone.startsWith("+1") || targetPhone.startsWith("1")) {
                updateData.currency = "USD";
            } else {
                updateData.currency = "INR";
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
              
              
              l.whatsapp_number, l.lead_source_id, l.lead_status, l.currency,
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
                payment_status: "Pending",
                delivery_status: "Pending",
                currency: r.currency ?? null,
                courier_name: null,
                tracking_number: null,
                
                
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
    public getLead = async (req: Request, res: Response) => {
        try {
            // 1️⃣ Check if user is authenticated
            const authUser = (req as any)?.user;
            if (!authUser || !authUser.system_user_id) {
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }

            // 2️⃣ Get lead_id from body or query
            const lead_id = req.body.lead_id || req.body.id || req.query.lead_id || req.query.id;
            if (!lead_id) {
                return this.sendError(res, {}, "lead_id is required", 400);
            }

            // 3️⃣ Build WHERE condition (only filter by lead existence)
            const whereSql = `WHERE l.id = :lead_id AND l.deleted_at IS NULL`;

            // 4️⃣ Run query
            const rows: any[] = await this.db_services.sequelizeWriter.query(
                `
                SELECT
                    l.id,
                    l.lead_number,
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
                    l.whatsapp_number, l.lead_source_id, l.lead_status, l.currency,
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
                payment_status: "Pending",
                delivery_status: "Pending",
                currency: raw.currency ?? null,
                courier_name: null,
                tracking_number: null,
                debt_consolidation_status: raw.debt_consolidation_status_name ?? null,
                consolidated_credit_status: raw.consolidated_credit_status_name ?? null,
                whatsapp_number: raw.whatsapp_number ?? null,
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
                    l.full_name,
                    l.email, l.phone,
                    l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country,
                    l.lead_score, l.lead_quality, l.best_time_to_call,
                    l.agent_id, su.name AS agent_name,
                    l.created_at, l.updated_at,
                    ls.name AS lead_source_name,
                    
                    
                    l.whatsapp_number, l.note, l.lead_source_id, l.lead_status, l.currency,
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
                payment_status: "Pending",
                delivery_status: "Pending",
                currency: r.currency ?? null,
                courier_name: null,
                tracking_number: null,
                
                
                whatsapp_number: r.whatsapp_number ?? null,
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
      
              // Send individual notifications for each assigned lead so clicking opens that exact lead
              for (const lead of leads) {
                await FCMService.notifyLeadAssigned(String(agent_id), lead);
              }
              console.log(`✅ Sent individual notifications for ${leads.length} assigned leads`);
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
    
}
