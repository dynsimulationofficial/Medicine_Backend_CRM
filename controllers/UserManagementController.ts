import { Request, Response } from "express";
import * as Yup from "yup";
import db, { SystemUserActivity } from "../models";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import { QueryTypes } from "sequelize";

// ==================== VALIDATION SCHEMAS ====================
const createUserSchema = Yup.object({
  name: Yup.string().required("Name is required").max(100),
  mobile_number: Yup.string().required("Mobile number is required"),
  email: Yup.string().email("Invalid email").required("Email is required"),
  password: Yup.string().min(6, "Password must be at least 6 characters").required("Password is required"),
  roleLevel: Yup.number().required("Role level is required"),
});

const editUserSchema = Yup.object({
  user_id: Yup.string().uuid("Invalid user ID").required("User ID is required"),
  name: Yup.string().max(255).optional(),
  mobile_number: Yup.string().max(30).optional(),
  email: Yup.string().email().max(255).optional(),
  password: Yup.string().min(6).optional(),
  roleLevel: Yup.number().nullable().optional(),
});

// Helper for Admin check
const isAdmin = async (systemUserId: string): Promise<boolean> => {
  if (!systemUserId) return false;
  const rows = await db.sequelize.query(
    `SELECT 1 FROM public.user_role ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.system_user_id = :uid::uuid AND TRIM(LOWER(r.name)) = 'admin' LIMIT 1`,
    { replacements: { uid: systemUserId }, type: QueryTypes.SELECT }
  );
  return rows.length > 0;
};

// ==================== CREATE USER ====================
export const createUser = async (req: Request, res: Response) => {
  const t = await db.sequelize.transaction();
  try {
    const authUser = (req as any)?.user;
    if (!authUser || !authUser.system_user_id) {
      await t.rollback();
      return res.status(401).json({ success: false, message: "Unauthorized - Please login again" });
    }

    const validatedData = await createUserSchema.validate(req.body, { abortEarly: false });
    const { name, mobile_number, email, password, roleLevel } = validatedData;

    const existing: any[] = await db.sequelize.query(
      `SELECT email, mobile_number FROM public.system_users WHERE (email = :email OR mobile_number = :mobile_number) AND deleted_at IS NULL`,
      { replacements: { email, mobile_number }, type: QueryTypes.SELECT, transaction: t }
    );
    
    if (existing.length) {
      await t.rollback();
      return res.status(409).json({ success: false, message: "Email or Mobile number is already in use" });
    }

    const userId = uuidv4();
    const hash = await bcrypt.hash(password, 10);

    await db.sequelize.query(
      `INSERT INTO public.system_users (id, name, mobile_number, email, password, created_at, updated_at)
       VALUES (:id, :name, :mobile_number, :email, :password, NOW(), NOW())`,
      { replacements: { id: userId, name, mobile_number, email, password: hash }, type: QueryTypes.INSERT, transaction: t }
    );

    const roleRows: any[] = await db.sequelize.query(
      `SELECT id, name FROM public.roles WHERE level = :roleLevel`,
      { replacements: { roleLevel }, type: QueryTypes.SELECT, transaction: t }
    );
    
    if (!roleRows.length) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    const roleId = roleRows[0].id;
    const roleName = roleRows[0].name;

    await db.sequelize.query(
      `INSERT INTO public.user_role (system_user_id, role_id, created_at, updated_at)
       VALUES (:userId, :roleId, NOW(), NOW())`,
      { replacements: { userId, roleId }, type: QueryTypes.INSERT, transaction: t }
    );

    await t.commit();

    await SystemUserActivity.create({
      system_user_id: authUser.system_user_id,
      user_activity: `Created user ${name}`,
      module: 'user_management',
      type: 'create',
    });

    return res.status(201).json({ success: true, data: { userId, role: roleName }, message: "User registered successfully" });
  } catch (error: any) {
    try { await t.rollback(); } catch {}
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET ALL USERS ====================
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.pageSize) || 10));
    const offset = (page - 1) * limit;
    
    const search = req.query.search?.toString().trim();
    const includeBlocked = req.query.include_blocked === 'true';

    const where: string[] = ["su.deleted_at IS NULL"];
    const replacements: any = { limit, offset };

    if (!includeBlocked) {
      where.push("(su.is_blocked = FALSE OR su.is_blocked IS NULL)");
    }

    if (search) {
      where.push("(su.name ILIKE :search OR su.email ILIKE :search OR su.mobile_number ILIKE :search)");
      replacements.search = `%${search}%`;
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countRow: any[] = await db.sequelize.query(
      `SELECT COUNT(DISTINCT su.id) AS total
       FROM public.system_users su
       LEFT JOIN public.user_role ur ON ur.system_user_id = su.id
       LEFT JOIN public.roles r ON r.id = ur.role_id
       ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = parseInt(countRow[0]?.total || "0");

    const rows: any[] = await db.sequelize.query(
      `SELECT DISTINCT
        su.id, su.name, su.email, su.mobile_number, su.is_blocked, su.blocked_at,
        su.block_reason, blocker.name as blocked_by_name, su.created_at, su.updated_at,
        r.name as role_name, r.level as role_level
       FROM public.system_users su
       LEFT JOIN public.user_role ur ON ur.system_user_id = su.id
       LEFT JOIN public.roles r ON r.id = ur.role_id
       LEFT JOIN public.system_users blocker ON blocker.id = su.blocked_by
       ${whereClause}
       ORDER BY su.created_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      data: {
        data: rows,
        pagination: { total, page, pageSize: limit, totalPages: Math.ceil(total / limit) }
      },
      message: "Users fetched successfully"
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== EDIT USER ====================
export const editUser = async (req: Request, res: Response) => {
  const t = await db.sequelize.transaction();
  try {
    const authUserId = (req as any)?.user?.system_user_id;
    if (!authUserId) {
      await t.rollback();
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const isAdminUser = await isAdmin(authUserId);
    const validatedData = await editUserSchema.validate(req.body, { abortEarly: false });
    const { user_id, name, mobile_number, email, password, roleLevel } = validatedData;

    if (!isAdminUser && user_id !== authUserId) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (roleLevel != null && !isAdminUser) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Only admins can change roles" });
    }

    const sets: string[] = [];
    const repl: any = { id: user_id };

    if (name) { sets.push("name = :name"); repl.name = name; }
    if (mobile_number) { sets.push("mobile_number = :mobile_number"); repl.mobile_number = mobile_number; }
    if (email) { sets.push("email = :email"); repl.email = email; }
    if (password) {
      repl.password_hash = await bcrypt.hash(password, 10);
      sets.push("password = :password_hash");
    }

    if (sets.length) {
      sets.push("updated_at = NOW()");
      await db.sequelize.query(
        `UPDATE public.system_users SET ${sets.join(", ")} WHERE id = :id`,
        { replacements: repl, type: QueryTypes.UPDATE, transaction: t }
      );
    }

    let roleName;
    if (roleLevel != null) {
      const roleRows: any[] = await db.sequelize.query(
        `SELECT id, name FROM public.roles WHERE level = :level LIMIT 1`,
        { replacements: { level: roleLevel }, type: QueryTypes.SELECT, transaction: t }
      );
      if (roleRows.length) {
        const roleId = roleRows[0].id;
        roleName = roleRows[0].name;
        await db.sequelize.query(
          `DELETE FROM public.user_role WHERE system_user_id = :uid`,
          { replacements: { uid: user_id }, type: QueryTypes.DELETE, transaction: t }
        );
        await db.sequelize.query(
          `INSERT INTO public.user_role (system_user_id, role_id, created_at, updated_at) VALUES (:uid, :rid, NOW(), NOW())`,
          { replacements: { uid: user_id, rid: roleId }, type: QueryTypes.INSERT, transaction: t }
        );
      }
    }

    await t.commit();
    return res.status(200).json({ success: true, message: "User updated successfully" });
  } catch (error: any) {
    try { await t.rollback(); } catch {}
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DELETE USER ====================
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const authUserId = (req as any)?.user?.system_user_id;
    const { id } = req.body;
    
    if (!id) return res.status(400).json({ success: false, message: "User ID is required" });
    if (authUserId === id) return res.status(400).json({ success: false, message: "You cannot delete your own account" });

    const rows: any[] = await db.sequelize.query(
      `UPDATE public.system_users SET deleted_at = NOW(), updated_at = NOW() WHERE id = :id AND deleted_at IS NULL RETURNING id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found or already deleted" });
    }

    return res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== BLOCK USER ====================
export const blockUser = async (req: Request, res: Response) => {
  try {
    const authUserId = (req as any)?.user?.system_user_id;
    if (!authUserId || !(await isAdmin(authUserId))) {
      return res.status(403).json({ success: false, message: "Only admin can block users" });
    }

    const { user_id, reason } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: "user_id is required" });

    const rows: any[] = await db.sequelize.query(
      `UPDATE public.system_users
       SET is_blocked = TRUE, blocked_at = NOW(), blocked_by = :blocked_by::uuid, block_reason = :reason, updated_at = NOW()
       WHERE id = :user_id::uuid AND deleted_at IS NULL RETURNING id`,
      { replacements: { user_id, blocked_by: authUserId, reason }, type: QueryTypes.SELECT }
    );

    if (!rows.length) return res.status(500).json({ success: false, message: "Failed to block user" });

    return res.status(200).json({ success: true, message: "User blocked successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  createUser,
  getAllUsers,
  editUser,
  deleteUser,
  blockUser
};
