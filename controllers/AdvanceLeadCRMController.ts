import { Request, Response } from "express";
import BaseController from "./BaseController";
import logger from "../utils/logger";
import DBServices from "../database/DBService";
import { QueryTypes } from "sequelize";
import bcrypt from "bcrypt";
import "../config/production/env_config";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import * as Yup from "yup";

const E164_PHONE = /^\+\d{1,3}\d{10}$/;

const createUserSchema = Yup.object().shape({
  name: Yup.string().required("Name is required"),
  mobile_number: Yup.string()
    .matches(
      E164_PHONE,
      "Mobile number must include country code and be in the format +<country_code><number>"
    )
    .required("Mobile number is required"),
  email: Yup.string().email("Invalid email format").required("Email is required"),
  password: Yup.string()
    .min(6, "Password must be at least 6 characters")
    .required("Password is required"),
  roleLevel: Yup.number()
    .typeError("Role level must be a number")
    .required("Role level is required"),
}).noUnknown(true);

const loginRequestOtpSchema = Yup.object().shape({
  email: Yup.string().email("Invalid email format").optional(),
  mobile_number: Yup.string().optional(),
  password: Yup.string().required("Password is required"),
}).noUnknown(true);

import db from "../models";
import { tokenBlacklist } from "../utils/tokenBlacklisted";
import emailService from "../service/EmailService";

const { SystemUserActivity, UserLogin } = db;



export default class CompressCrmController extends BaseController {
  db_services: DBServices = new DBServices();

  constructor() {
    super();
    logger.info("CompressCrmController instantiated");
  }
  // -------------------- Block User --------------------
  // ---- Case-insensitive admin check, always read from WRITER (no replica lag) ----
  private async isAdmin(systemUserId: string): Promise<boolean> {
    if (!systemUserId) return false;
    const rows = await this.db_services.sequelizeWriter.query(
      `
    SELECT 1
    FROM public.user_role ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.system_user_id = :uid::uuid
      AND TRIM(LOWER(r.name)) = 'admin'
    LIMIT 1
    `,
      {
        replacements: { uid: systemUserId },
        type: QueryTypes.SELECT,
        // Critical in production with replication:
        useMaster: true,
      } as any
    );
    return rows.length > 0;
  }

  // Add this helper once in your class (near isAdmin)
  private async isActiveAgent(systemUserId: string): Promise<boolean> {
    if (!systemUserId) return false;
    const rows: any[] = await this.db_services.sequelizeWriter.query(
      `
    SELECT 1
    FROM public.system_users su
    JOIN public.user_role ur ON ur.system_user_id = su.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE su.id = :uid::uuid
      AND su.deleted_at IS NULL
      AND (su.is_blocked = FALSE OR su.is_blocked IS NULL)
      AND TRIM(LOWER(r.name)) = 'agent'
    LIMIT 1
    `,
      { replacements: { uid: systemUserId }, type: QueryTypes.SELECT, useMaster: true } as any
    );
    return rows.length > 0;
  }

  public createUser = async (req: Request, res: Response): Promise<void> => {
    const t = await this.db_services.sequelizeWriter.transaction();
    // Authentication check
    const authUser = (req as any)?.user;
    if (!authUser || !authUser.system_user_id) {
      await t.rollback();
      return this.sendError(res, {}, "Unauthorized - Please login again", 401);
    }
    try {
      await createUserSchema.validate(req.body, { abortEarly: false });
      const { name, mobile_number, email, password, roleLevel } = req.body;

      const existing = await this.db_services.sequelizeWriter.query(
        `SELECT email, mobile_number
           FROM public.system_users
          WHERE (email = :email OR mobile_number = :mobile_number)
            AND deleted_at IS NULL`,
        { replacements: { email, mobile_number }, type: QueryTypes.SELECT, transaction: t }
      );
      if (existing.length) {
        const msgs: string[] = [];
        if (existing.some((u: any) => u.email === email)) msgs.push("Email is already in use");
        if (existing.some((u: any) => u.mobile_number === mobile_number)) msgs.push("Mobile number is already in use");
        await t.rollback();
        return this.sendError(res, {}, msgs.join(", "), 409);
      }

      const userId = uuidv4();
      const hash = await bcrypt.hash(password, 10);

      await this.db_services.sequelizeWriter.query(
        `INSERT INTO public.system_users
           (id, name, mobile_number, email, password, created_at, updated_at)
         VALUES (:id, :name, :mobile_number, :email, :password, NOW(), NOW())`,
        { replacements: { id: userId, name, mobile_number, email, password: hash }, type: QueryTypes.INSERT, transaction: t }
      );

      const roleRows = await this.db_services.sequelizeWriter.query(
        `SELECT id, name FROM public.roles WHERE level = :roleLevel`,
        { replacements: { roleLevel }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!roleRows.length) { await t.rollback(); return this.sendError(res, {}, "Role not found", 404); }

      const roleId = (roleRows[0] as any).id;
      const roleName = (roleRows[0] as any).name;

      // INSERT into permanent table `public.user_role`
      await this.db_services.sequelizeWriter.query(
        `INSERT INTO public.user_role (system_user_id, role_id, created_at, updated_at)
         VALUES (:userId, :roleId, NOW(), NOW())`,
        { replacements: { userId, roleId }, type: QueryTypes.INSERT, transaction: t }
      );

      const rolePerms = await this.db_services.sequelizeWriter.query(
        `SELECT permission_id FROM public.role_permissions WHERE role_id = :roleId`,
        { replacements: { roleId }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!rolePerms.length) { await t.rollback(); return this.sendError(res, {}, `No permissions assigned to the role ${roleName}`, 404); }

      await t.commit();
      // Log user activity
      await SystemUserActivity.create({
        system_user_id: authUser.system_user_id,  // Use the authenticated user's ID
        user_activity: `Created user ${name}`,  // Log the activity
        module: 'user_management',  // The module name
        type: 'create',  // Activity type
      });

      return this.sendSuccess(res, { userId, role: roleName }, "User registered successfully with role and permissions");
    } catch (err: any) {
      await t.rollback();
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      logger.error("Error in createUser", { error: err });
      return this.sendError(res, err, "Internal server error", 500);
    }
  };
  public editUser = async (req: Request, res: Response): Promise<void> => {
    const t = await this.db_services.sequelizeWriter.transaction();
    try {
      const authUserId = (req as any)?.user?.system_user_id;
      if (!authUserId) { await t.rollback(); return this.sendError(res, {}, "Unauthorized", 401); }
      const isAdminUser = await this.isAdmin(authUserId);

      // helpers to coerce form values
      const toNum = (v: any) => (v === "" || v == null ? undefined : Number(v));
      const s = () => Yup.string().trim().transform(v => v === "" ? undefined : v);

      const schema = Yup.object({
        user_id: s().required("user_id is required"),
        name: s().max(255).optional(),
        mobile_number: s().max(30).optional(),
        email: s().email().max(255).optional(),
        password: s().min(6).optional(),
        roleLevel: Yup.mixed().transform(toNum).nullable().optional(),
      });

      const body = await schema.validate(req.body, { abortEarly: false });
      const { user_id, name, mobile_number, email, password } = body;
      const roleLevel: number | undefined =
        typeof body.roleLevel === "number" ? body.roleLevel : undefined;

      if (!isAdminUser && user_id !== authUserId) {
        await t.rollback();
        return this.sendError(res, {}, "Forbidden", 403);
      }

      // Only admins can change roles
      if (roleLevel != null && !isAdminUser) {
        await t.rollback();
        return this.sendError(res, {}, "Only admins can change roles", 403);
      }

      // must exist
      const userRows: any[] = await this.db_services.sequelizeWriter.query(
        `SELECT id, email, mobile_number
           FROM public.system_users
          WHERE id = :id AND deleted_at IS NULL
          LIMIT 1`,
        { replacements: { id: user_id }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!userRows.length) { await t.rollback(); return this.sendError(res, {}, "User not found", 404); }

      // uniqueness (only when values provided)
      if (email || mobile_number) {
        const dupRows: any[] = await this.db_services.sequelizeWriter.query(
          `SELECT id, email, mobile_number
             FROM public.system_users
            WHERE id <> :id
              AND deleted_at IS NULL
              AND (
                    (:email IS NOT NULL AND LOWER(email) = LOWER(:email))
                 OR (:mobile IS NOT NULL AND mobile_number = :mobile)
              )`,
          {
            replacements: { id: user_id, email: email ?? null, mobile: mobile_number ?? null },
            type: QueryTypes.SELECT, transaction: t
          }
        );
        if (dupRows.length) {
          const msgs: string[] = [];
          if (email && dupRows.some(r => String(r.email).toLowerCase() === String(email).toLowerCase()))
            msgs.push("Email is already in use");
          if (mobile_number && dupRows.some(r => r.mobile_number === mobile_number))
            msgs.push("Mobile number is already in use");
          await t.rollback();
          return this.sendError(res, {}, msgs.join(", "), 409);
        }
      }

      // build update
      const sets: string[] = [];
      const repl: any = { id: user_id };

      if (name != null) { sets.push("name = :name"); repl.name = name; }
      if (mobile_number != null) { sets.push("mobile_number = :mobile_number"); repl.mobile_number = mobile_number; }
      if (email != null) { sets.push("email = :email"); repl.email = email; }
      if (password) {
        repl.password_hash = await bcrypt.hash(password, 10);
        sets.push("password = :password_hash");
      }

      if (!sets.length && roleLevel == null) {
        await t.rollback();
        return this.sendError(res, {}, "Nothing to update", 400);
      }

      if (sets.length) {
        sets.push("updated_at = NOW()");
        await this.db_services.sequelizeWriter.query(
          `UPDATE public.system_users SET ${sets.join(", ")} WHERE id = :id`,
          { replacements: repl, type: QueryTypes.UPDATE, transaction: t }
        );
      }

      // role change
      let roleName: string | undefined;
      if (roleLevel != null) {
        const roleRows: any[] = await this.db_services.sequelizeWriter.query(
          `SELECT id, name FROM public.roles WHERE level = :level LIMIT 1`,
          { replacements: { level: roleLevel }, type: QueryTypes.SELECT, transaction: t }
        );
        if (!roleRows.length) { await t.rollback(); return this.sendError(res, {}, "Role not found", 404); }
        const roleId = roleRows[0].id; roleName = roleRows[0].name;

        await this.db_services.sequelizeWriter.query(
          `DELETE FROM public.user_role WHERE system_user_id = :uid`,
          { replacements: { uid: user_id }, type: QueryTypes.DELETE, transaction: t }
        );
        await this.db_services.sequelizeWriter.query(
          `INSERT INTO public.user_role (system_user_id, role_id, created_at, updated_at)
           VALUES (:uid, :rid, NOW(), NOW())`,
          { replacements: { uid: user_id, rid: roleId }, type: QueryTypes.INSERT, transaction: t }
        );
      }

      await t.commit();
      // Log user activity
      await SystemUserActivity.create({
        system_user_id: authUserId,
        user_activity: `Updated user ${user_id}`,
        module: 'user_management',
        type: 'update',
      });
      return this.sendSuccess(res, { userId: user_id, role: roleName }, "User updated successfully", 200);
    } catch (err: any) {
      try { await t.rollback(); } catch { }
      // TEMP: surface error to help you debug (remove in production)
      console.error("editUser error:", err?.message, err?.stack);
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      return this.sendError(res, {}, "Internal server error", 500);
    }
  };
  public blockUser = async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any)?.user?.system_user_id;
      if (!authUserId || !(await this.isAdmin(authUserId))) {
        return this.sendError(res, {}, "Only admin can block users", 403);
      }

      const schema = Yup.object({
        user_id: Yup.string().uuid().required("user_id is required"),
        reason: Yup.string().trim().max(1000).optional(),
      });

      const { user_id, reason } = await schema.validate(req.body, { abortEarly: false });

      // Block user
      const rows: any[] = await this.db_services.sequelizeWriter.query(
        `UPDATE public.system_users
             SET is_blocked = TRUE,
                 blocked_at = CURRENT_TIMESTAMP,
                 blocked_by = :blocked_by::uuid,
                 block_reason = :reason,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = :user_id::uuid AND deleted_at IS NULL
             RETURNING id, name, email, mobile_number, is_blocked`,
        { replacements: { user_id, blocked_by: authUserId, reason }, type: QueryTypes.SELECT }
      );

      if (!rows.length) {
        return this.sendError(res, {}, "Failed to block user", 500);
      }

      // Log activity after blocking the user
      await SystemUserActivity.create({
        system_user_id: authUserId,
        user_activity: `Blocked user ${user_id}`,
        module: 'user_management',
        type: 'block',
      });

      return this.sendSuccess(res, rows[0], "User blocked successfully");
    } catch (err: any) {
      console.error("Block user error:", err);
      return this.sendError(res, err, "Internal server error", 500);
    }
  };
  public unblockUser = async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any)?.user?.system_user_id;
      if (!authUserId || !(await this.isAdmin(authUserId))) {
        return this.sendError(res, {}, "Only admin can unblock users", 403);
      }

      const schema = Yup.object({
        user_id: Yup.string().uuid().required("user_id is required"),
      });

      const { user_id } = await schema.validate(req.body, { abortEarly: false });

      // Unblock user
      const rows: any[] = await this.db_services.sequelizeWriter.query(
        `UPDATE public.system_users
           SET is_blocked = FALSE, blocked_at = NULL, blocked_by = NULL, block_reason = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = :user_id::uuid AND deleted_at IS NULL AND is_blocked = TRUE
           RETURNING id, name, email, mobile_number, is_blocked`,
        { replacements: { user_id }, type: QueryTypes.SELECT, useMaster: true }
      );

      if (!rows.length) {
        return this.sendError(res, {}, "Failed to unblock user", 500);
      }

      // Log activity after unblocking the user
      await SystemUserActivity.create({
        system_user_id: authUserId,
        user_activity: `Unblocked user ${user_id}`,
        module: 'user_management',
        type: 'unblock',
      });

      return this.sendSuccess(res, rows[0], "User unblocked successfully");
    } catch (err: any) {
      console.error("Unblock user error:", err);
      return this.sendError(res, err, "Internal server error", 500);
    }
  };


  public getAllUsers = async (req: Request, res: Response) => {
    try {
      const schema = Yup.object({
        page: Yup.number().integer().min(1).default(1),
        pageSize: Yup.number().integer().min(1).max(200).default(10),
        search: Yup.string().trim().max(200).optional(),
        role_name: Yup.string().trim().max(100).optional(),
        role_level: Yup.number().integer().optional(),
        include_blocked: Yup.boolean().default(false),
      });

      const qp = await schema.validate(req.query, { abortEarly: false });
      const page = Number(qp.page);
      const pageSize = Number(qp.pageSize);
      const offset = (page - 1) * pageSize;

      const search = qp.search?.trim();
      const includeBlocked = !!qp.include_blocked;
      const roleName = qp.role_name?.trim()?.toLowerCase();
      const roleLevel = qp.role_level;

      const where: string[] = ["su.deleted_at IS NULL"];
      const replacements: any = { limit: pageSize, offset };

      if (!includeBlocked) {
        where.push("(su.is_blocked = FALSE OR su.is_blocked IS NULL)");  // Unblocked or non-blocked users
      }

      if (search) {
        where.push("(su.name ILIKE :search OR su.email ILIKE :search OR su.mobile_number ILIKE :search)");
        replacements.search = `%${search}%`;
      }

      const roleConds: string[] = [];
      if (roleName) {
        roleConds.push("TRIM(LOWER(r.name)) = :role_name");
        replacements.role_name = roleName;
      }
      if (typeof roleLevel === "number") {
        roleConds.push("r.level = :role_level");
        replacements.role_level = roleLevel;
      }

      const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const roleClause = roleConds.length ? `AND ${roleConds.join(" AND ")}` : "";

      // Count query (force WRITER)
      const countSql = `
      SELECT COUNT(DISTINCT su.id) AS total
      FROM public.system_users su
      LEFT JOIN public.user_role ur ON ur.system_user_id = su.id
      LEFT JOIN public.roles r ON r.id = ur.role_id
      ${whereClause}
      ${roleClause}
    `;
      const countRow: any[] = await this.db_services.sequelizeWriter.query(countSql, {
        replacements,
        type: QueryTypes.SELECT,
        useMaster: true,  // Ensure fresh data from the writer
      } as any);
      const total = countRow[0]?.total || 0;

      // Data query (force WRITER)
      const dataSql = `
      SELECT DISTINCT
        su.id,
        su.name,
        su.email,
        su.mobile_number,
        su.is_blocked,
        su.blocked_at,
        su.block_reason,
        blocker.name as blocked_by_name,
        su.created_at,
        su.updated_at,
        r.name as role_name,
        r.level as role_level
      FROM public.system_users su
      LEFT JOIN public.user_role ur ON ur.system_user_id = su.id
      LEFT JOIN public.roles r ON r.id = ur.role_id
      LEFT JOIN public.system_users blocker ON blocker.id = su.blocked_by
      ${whereClause}
      ${roleClause}
      ORDER BY su.created_at DESC
      LIMIT :limit OFFSET :offset
    `;
      const rows: any[] = await this.db_services.sequelizeWriter.query(dataSql, {
        replacements,
        type: QueryTypes.SELECT,
        useMaster: true,  // Ensure fresh data from the writer
      } as any);

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
        "Users fetched successfully"
      );
    } catch (err: any) {
      if (err?.name === "ValidationError") {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      console.error("Get all users error:", err);
      return this.sendError(res, err, "Internal server error", 500);
    }
  };
  public listBlockedUsers = async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any)?.user?.system_user_id;
      if (!authUserId || !(await this.isAdmin(authUserId))) {
        return this.sendError(res, {}, "Only admin can view blocked users", 403);
      }

      const rows: any[] = await this.db_services.sequelizeWriter.query(
        `
      SELECT 
        su.id, 
        su.name, 
        su.email, 
        su.mobile_number,
        su.is_blocked, 
        su.blocked_at, 
        su.block_reason,
        blocker.name AS blocked_by_name
      FROM public.system_users su
      LEFT JOIN public.system_users blocker ON blocker.id = su.blocked_by
      WHERE su.deleted_at IS NULL 
        AND su.is_blocked = TRUE
      ORDER BY su.blocked_at DESC
      `,
        {
          type: QueryTypes.SELECT,
          useMaster: true,  // Force WRITER for fresh data
        } as any
      );

      return this.sendSuccess(res, { data: rows }, "Blocked users fetched successfully");
    } catch (err: any) {
      console.error("List blocked users error:", err);
      return this.sendError(res, err, "Internal server error", 500);
    }
  };
  public loginRequestOtp = async (req: Request, res: Response) => {
    try {
      await loginRequestOtpSchema.validate(req.body, { abortEarly: false });
      const { email, password } = req.body;

      // Find user
      // Find user (also fetch is_blocked)
      const [user] = (await this.db_services.sequelizeWriter.query(
        `SELECT id, password, is_blocked, name
         FROM public.system_users
         WHERE LOWER(email) = LOWER(:email)
           AND deleted_at IS NULL
         LIMIT 1`,
        { replacements: { email }, type: QueryTypes.SELECT }
      )) as any[];
      

      if (!user) return this.sendError(res, {}, "Invalid email or password", 401);
      if (user.is_blocked) return this.sendError(res, {}, "Account is blocked. Contact admin.", 403); // 👈 NEW

      // password compare… (unchanged)


      // Verify password
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return this.sendError(res, {}, "Invalid email or password", 401);

      const system_user_id: string = user.id;

      // 🔎 Get user's latest role (no deleted_at column in user_role)
      const [role] = (await this.db_services.sequelizeWriter.query(
        `SELECT r.id   AS role_id,
              r.name AS role_name,
              r.level AS role_level
         FROM public.user_role ur
         JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.system_user_id = :system_user_id
        ORDER BY COALESCE(ur.updated_at, ur.created_at) DESC
        LIMIT 1`,
        { replacements: { system_user_id }, type: QueryTypes.SELECT }
      )) as any[];

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Invalidate old unused OTPs
      await UserLogin.update(
        { is_used: true },
        { where: { system_user_id, is_used: false } }
      );

      // Create new OTP (5 min expiry)
      await UserLogin.create({
        system_user_id,
        otp,
        is_used: false,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      });

      // Send OTP
      try {
        await emailService.sendOtpEmail(email, otp);
      } catch (emailErr) {
        console.warn("⚠️ SMTP email sending failed/timed out, continuing login OTP flow:", emailErr);
      }

      // Success with role in payload
      return this.sendSuccess(
        res,
        {
          system_user_id,
          name: user.name,          // 👈 Add name
          role: role?.role_name ?? null,
          role_id: role?.role_id ?? null,
          role_level: role?.role_level ?? null,
        },
        "OTP sent to email"
      );      
    } catch (err: any) {
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      logger.error("Login OTP error", { error: err });
      return this.sendError(res, err, "Internal server error", 500);
    }
  };
  public softDeleteUser = async (req: Request, res: Response): Promise<void> => {
    const tx = await this.db_services.sequelizeWriter.transaction();
    try {
      // Validate input using Yup
      const schema = Yup.object({
        id: Yup.string().uuid().required("id is required"),
        updated_at: Yup.string().optional(), // optimistic concurrency check
      });
      const { id, updated_at } = await schema.validate(req.body, { abortEarly: false });

      // Optional: Prevent deleting yourself
      const me = (req as any)?.user?.system_user_id as string | undefined;
      if (me && me === id) {
        await tx.rollback();
        return this.sendError(res, {}, "You cannot delete your own account.", 400);
      }

      // (Optional) Prevent deleting highest-privilege users
      // const isTargetSuperAdmin = await this.isAdmin(id); if (isTargetSuperAdmin) ...

      const where: string[] = ["u.id = :id", "u.deleted_at IS NULL"];
      const repl: any = { id };
      if (updated_at) {
        where.push("u.updated_at = :updated_at");
        repl.updated_at = updated_at;
      }

      // Soft delete the user
      const rows: any[] = await this.db_services.sequelizeWriter.query(
        `UPDATE public.system_users AS u
              SET deleted_at = NOW(),
                  updated_at = NOW()
            WHERE ${where.join(" AND ")}
            RETURNING u.id, u.email, u.mobile_number, u.deleted_at`,
        { replacements: repl, type: QueryTypes.SELECT, transaction: tx }
      );

      if (!rows.length) {
        await tx.rollback();
        return this.sendError(
          res,
          {},
          "No matching active user found (already deleted or concurrency mismatch).",
          404
        );
      }

      // Type Assertion: Define the type for the deleted user object
      const deletedUser = rows[0] as { id: string; email: string; mobile_number: string; deleted_at: Date };

      // Fetch the admin's system_user_id from req.user (assumes the request contains the authenticated user)
      const adminUserId = (req as any)?.user?.system_user_id;

      // Ensure the adminUserId is available
      if (!adminUserId) {
        await tx.rollback();
        return this.sendError(res, {}, "Admin user not authenticated", 401);
      }

      // Log the activity
      await SystemUserActivity.create({
        system_user_id: adminUserId, // Admin's ID
        user_activity: `Soft-deleted user ${deletedUser.email}`, // Describing the activity
        module: 'user_management', // The module name
        type: 'delete', // Activity type (delete)
      });

      // Commit the transaction
      await tx.commit();

      return this.sendSuccess(res, { count: 1, item: rows[0] }, "User soft-deleted successfully");
    } catch (err: any) {
      try { await tx.rollback(); } catch { }
      console.error("Error in softDeleteUser:", err);
      return this.sendError(res, err, "Internal server error", 500);
    }
  };




  public verifyOtp = async (req: Request, res: Response) => {
    try {
      // Validate input
      const schema = Yup.object({
        email: Yup.string().trim().email().required("email is required"),
        otp: Yup.string().trim().matches(/^\d{6}$/, "otp must be 6 digits").required("otp is required"),
      });
      await schema.validate(req.body, { abortEarly: false });

      const email: string = String(req.body.email).trim();
      const normalizedOtp: string = String(req.body.otp).trim();

      // Find user
      const user = await this.db_services.sequelizeWriter.query(
        `SELECT id, name, is_blocked, deleted_at
             FROM public.system_users
             WHERE LOWER(email) = LOWER(:email) AND deleted_at IS NULL`,
        { replacements: { email }, type: QueryTypes.SELECT }
      );
      if (!user || user.length === 0) {
        return this.sendError(res, {}, "User not found", 404);
      }

      const system_user_id = (user[0] as any).id as string;
      const userName = (user[0] as any).name as string;
      const isBlocked = (user[0] as any).is_blocked;

      // Check if the user is blocked
      if (isBlocked) {
        return this.sendError(res, {}, "Your account is blocked. Please contact the admin.", 403);
      }

      // Check OTP
      const otpRow = await this.db_services.sequelizeWriter.query(
        `SELECT id, otp, is_used, expires_at, created_at
             FROM public.user_login_otp
             WHERE system_user_id = :system_user_id
             AND is_used = FALSE
             AND expires_at > NOW()
             AND otp::text = :otp
             ORDER BY created_at DESC
             LIMIT 1`,
        { replacements: { system_user_id, otp: normalizedOtp }, type: QueryTypes.SELECT }
      );
      if (!otpRow || otpRow.length === 0) {
        return this.sendError(res, {}, "Invalid or expired OTP", 400);
      }

      const otpId = (otpRow[0] as any).id as string;

      // Mark OTP as used
      await this.db_services.sequelizeWriter.query(
        `UPDATE public.user_login_otp SET is_used = TRUE WHERE id = :id`,
        { replacements: { id: otpId }, type: QueryTypes.UPDATE }
      );

      // Issue JWT with 12-hour expiry
      const token = jwt.sign(
        { system_user_id, email },
        process.env.JWT_SECRET || "your_secret_key",
        { expiresIn: "12h" }   // ⬅️ expires in 14 hours
      );

      // Log the user login activity (Who logged in)
      await SystemUserActivity.create({
        system_user_id,  // User ID who logged in
        user_activity: `User ${userName} (ID: ${system_user_id}) logged in successfully`,  // Activity description with user details
        module: 'authentication',
        type: 'login',
      }).then(() => {
        console.log(`User ${userName} logged in successfully (ID: ${system_user_id})`);
      }).catch((error) => {
        console.error("Error saving login activity:", error);
      });

      // 🔎 Check if user is an agent and send alert email to Admin
      try {
        const [roleRow] = (await this.db_services.sequelizeWriter.query(
          `SELECT r.name AS role_name
             FROM public.user_role ur
             JOIN public.roles r ON r.id = ur.role_id
            WHERE ur.system_user_id = :system_user_id
            ORDER BY COALESCE(ur.updated_at, ur.created_at) DESC
            LIMIT 1`,
          { replacements: { system_user_id }, type: QueryTypes.SELECT }
        )) as any[];

        const userRoleName = roleRow?.role_name || "Agent";
        const isAgent = String(userRoleName).trim().toLowerCase() === "agent" || (await this.isActiveAgent(system_user_id));

        if (isAgent) {
          const loginTimeLabel = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " (IST)";
          emailService.sendAdminLoginNotification({
            adminTo: "wasiquekhan90@gmail.com",
            userName,
            userEmail: email,
            roleName: userRoleName,
            loginTimeLocalLabel: loginTimeLabel,
          }).catch((mailErr) => {
            console.error("⚠️ [mailer] Failed to send admin login notification email:", mailErr);
          });
        }
      } catch (checkErr) {
        console.error("⚠️ Error checking agent status for login email:", checkErr);
      }

      // Send success response
      return this.sendSuccess(
        res,
        { 
          token, 
          system_user_id,
          name: userName
        },
        "Login successful"
      );

    } catch (err) {
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      console.error(err);
      return this.sendError(res, {}, "Internal server error", 500);
    }
  };



  public logout = async (req: Request, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return this.sendError(res, {}, "Unauthorized: No token provided", 401);
      }
      const token = authHeader.split(" ")[1];
      tokenBlacklist.add(token);
      logger.info(`Token blacklisted: ${token}`);
      return this.sendSuccess(res, {}, "Logged out successfully");
    } catch (error) {
      logger.error("Logout error:", error);
      return this.sendError(res, error, "Internal server error", 500);
    }
  };





}
