import { Request, Response } from "express";
import * as yup from "yup";
import { QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import db from "../models";

// ==================== HELPER RESPONSE HANDLERS ====================
const sendSuccess = (res: Response, data: any, message: string = "Success", code = 200) => {
  return res.status(code).json({ success: true, msg: message, data });
};

const sendError = (res: Response, data: any = {}, message: string = "Error", code = 400) => {
  return res.status(code).json({ success: false, msg: message, data });
};

// Safe Activity Logger
const logUserActivity = async (userId: string, activity: string, type: string, transaction?: any) => {
  try {
    await db.sequelize.query(
      `INSERT INTO public.system_user_activity
         ("uuid", user_activity, module, type, activity_timestamp)
       VALUES
         (:userId, :activity, 'activity_management', :type, NOW())`,
      {
        replacements: { userId, activity, type },
        type: QueryTypes.INSERT,
        ...(transaction ? { transaction } : {}),
      }
    );
  } catch (err) {
    console.warn("Could not log user activity:", err);
  }
};

// ==================== 1. GET ALL DISPOSITIONS ====================
export const getAllDispositions = async (req: Request, res: Response) => {
  try {
    const schema = yup.object({
      page: yup.number().integer().min(1).default(1),
      pageSize: yup.number().integer().min(1).max(200).default(10),
      search: yup.string().trim().max(200).optional(),
      is_active: yup.mixed<boolean>()
        .transform((v) => (v === "true" ? true : v === "false" ? false : v))
        .optional(),
    });

    const qp = await schema.validate(req.query, { abortEarly: false });
    const page = Number(qp.page);
    const pageSize = Number(qp.pageSize);
    const offset = (page - 1) * pageSize;
    const search = (qp.search as string | undefined)?.trim();
    const isActiveFilter = qp.is_active as boolean | undefined;

    const where: string[] = [];
    const repl: Record<string, any> = {};

    if (typeof isActiveFilter === "boolean") {
      where.push("ld.is_active = :is_active");
      repl.is_active = isActiveFilter;
    }

    if (search) {
      where.push("(ld.name ILIKE :q OR ld.description ILIKE :q)");
      repl.q = `%${search}%`;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [{ total }]: any[] = await db.sequelize.query(
      `SELECT COUNT(*)::int AS total FROM public.lead_dispositions ld ${whereSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const rows: any[] = await db.sequelize.query(
      `SELECT ld.id, ld.name, ld.description, ld.is_active, ld.created_at
         FROM public.lead_dispositions ld
        ${whereSql}
        ORDER BY ld.name ASC
        LIMIT :limit OFFSET :offset`,
      {
        replacements: { ...repl, limit: pageSize, offset },
        type: QueryTypes.SELECT,
      }
    );

    const totalPages = Math.ceil(Number(total) / pageSize) || 1;

    return sendSuccess(
      res,
      {
        items: rows,
        pagination: { page, pageSize, total: Number(total), totalPages },
      },
      "Dispositions fetched"
    );
  } catch (err: any) {
    if (err.name === "ValidationError") {
      return sendError(res, {}, err.errors.join(", "), 400);
    }
    return sendError(res, err, "Internal server error", 500);
  }
};

// ==================== 2. GET DISPOSITION BY ID ====================
export const getDispositionById = async (req: Request, res: Response) => {
  try {
    const disposition_id = req.query?.id || req.body?.disposition_id || req.body?.id;
    if (!disposition_id) {
      return sendError(res, {}, "disposition_id is required", 400);
    }

    const rows: any[] = await db.sequelize.query(
      `SELECT ld.id, ld.name, ld.description, ld.is_active, ld.created_at
         FROM public.lead_dispositions ld
        WHERE ld.id = :id
        LIMIT 1`,
      {
        replacements: { id: disposition_id },
        type: QueryTypes.SELECT,
      }
    );

    if (!rows.length) return sendError(res, {}, "Disposition not found", 404);
    return sendSuccess(res, rows[0], "Disposition");
  } catch (err: any) {
    return sendError(res, err, "Internal server error", 500);
  }
};

// ==================== 3. ADD ACTIVITY ====================
export const addActivity = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any)?.user;
    const schema = yup.object({
      lead_id: yup.string().uuid().required("lead_id is required"),
      disposition_id: yup.string().uuid().required("disposition_id is required"),
      conversation: yup.string().required("conversation is required"),
      agent_id: yup.string().nullable().optional(),
      occurred_at: yup.date().nullable().optional(),
    });

    const body = await schema.validate(req.body, { abortEarly: false });
    const { lead_id, disposition_id, conversation } = body;

    let finalAgentId = body.agent_id || authUser?.system_user_id || null;
    if (!finalAgentId) {
      const leadRows: any[] = await db.sequelize.query(
        `SELECT agent_id FROM public.leads WHERE id = :lead_id LIMIT 1`,
        { replacements: { lead_id }, type: QueryTypes.SELECT }
      );
      finalAgentId = leadRows[0]?.agent_id || authUser?.system_user_id || null;
    }

    // Validate disposition via raw SQL
    const disp: any[] = await db.sequelize.query(
      `SELECT id FROM public.lead_dispositions WHERE id = :id AND is_active = TRUE`,
      { replacements: { id: disposition_id }, type: QueryTypes.SELECT }
    );
    if (!disp.length) return sendError(res, {}, "Invalid disposition_id", 400);

    // Raw SQL INSERT for activity
    const [row]: any[] = await db.sequelize.query(
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
          occurred_at: body.occurred_at || null,
        },
        type: QueryTypes.SELECT,
      }
    );

    // Safe log in system_user_activity
    const authUserId = (req as any)?.user?.system_user_id;
    if (authUserId) {
      await logUserActivity(authUserId, `Added activity for lead ${lead_id}`, "create");
    }

    return sendSuccess(res, row, "Activity added successfully");
  } catch (err: any) {
    if (err.name === "ValidationError") return sendError(res, {}, err.errors.join(", "), 400);
    console.error("Error in addActivity:", err);
    return sendError(res, err, "Internal server error", 500);
  }
};

// ==================== 4. UPDATE ACTIVITY ====================
export const updateActivity = async (req: Request, res: Response) => {
  const transaction = await db.sequelize.transaction();
  try {
    const schema = yup.object({
      id: yup.string().uuid().required("activity id is required"),
      disposition_id: yup.string().uuid().optional(),
      conversation: yup.string().optional(),
      agent_id: yup.string().uuid().optional(),
      occurred_at: yup.date().optional(),
    });

    const body = await schema.validate(req.body, { abortEarly: false });
    const { id, disposition_id, conversation, agent_id, occurred_at } = body;

    // Check existence
    const exists: any[] = await db.sequelize.query(
      `SELECT id, lead_id FROM public.lead_activity_history WHERE id = :id AND deleted_at IS NULL`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction }
    );
    if (!exists.length) {
      await transaction.rollback();
      return sendError(res, {}, "Activity not found", 404);
    }

    if (disposition_id) {
      const disp: any[] = await db.sequelize.query(
        `SELECT id FROM public.lead_dispositions WHERE id = :id AND is_active = TRUE`,
        { replacements: { id: disposition_id }, type: QueryTypes.SELECT, transaction }
      );
      if (!disp.length) {
        await transaction.rollback();
        return sendError(res, {}, "Invalid disposition_id", 400);
      }
    }

    const updates: string[] = [];
    const repl: Record<string, any> = { id };

    if (disposition_id) { updates.push("disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
    if (conversation !== undefined) { updates.push("conversation = :conversation"); repl.conversation = conversation; }
    if (agent_id !== undefined) { updates.push("agent_id = :agent_id"); repl.agent_id = agent_id; }
    if (occurred_at !== undefined) { updates.push("occurred_at = :occurred_at"); repl.occurred_at = occurred_at; }

    if (!updates.length) {
      await transaction.rollback();
      return sendError(res, {}, "No fields to update", 400);
    }

    updates.push("updated_at = NOW()");
    updates.push("is_edited = TRUE");

    await db.sequelize.query(
      `UPDATE public.lead_activity_history
       SET ${updates.join(", ")}
       WHERE id = :id`,
      { replacements: repl, type: QueryTypes.UPDATE, transaction }
    );

    const [result]: any[] = await db.sequelize.query(
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

    const authUserId = (req as any)?.user?.system_user_id;
    if (authUserId) {
      await logUserActivity(authUserId, `Updated activity ID ${result.id}`, "update", transaction);
    }

    await transaction.commit();
    return sendSuccess(res, result, "Activity updated successfully");
  } catch (err: any) {
    try { await transaction.rollback(); } catch {}
    console.error("Error in updateActivity:", err);
    if (err.name === "ValidationError") return sendError(res, {}, err.errors.join(", "), 400);
    return sendError(res, err, "Internal server error", 500);
  }
};

// ==================== 5. LIST ACTIVITIES ====================
export const listActivities = async (req: Request, res: Response) => {
  try {
    const src: any = { ...req.query, ...req.body, ...req.params };
    const schema = yup.object({
      lead_id: yup.string().uuid().required("lead_id is required"),
      disposition_id: yup.string().uuid().optional(),
      agent_id: yup.string().uuid().optional(),
      conversation: yup.string().trim().max(500).optional(),
      page: yup.number().integer().min(1).default(1),
      pageSize: yup.number().integer().min(1).max(200).default(10),
    });

    const body = await schema.validate(src, { abortEarly: false });
    const { lead_id, disposition_id, agent_id, conversation } = body;
    const page = Number(body.page);
    const pageSize = Number(body.pageSize);
    const offset = (page - 1) * pageSize;

    const where: string[] = ["ah.lead_id = :lead_id", "ah.deleted_at IS NULL"];
    const repl: Record<string, any> = { lead_id, limit: pageSize, offset };

    if (disposition_id) { where.push("ah.disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
    if (agent_id) { where.push("ah.agent_id = :agent_id"); repl.agent_id = agent_id; }
    if (conversation) { where.push("ah.conversation ILIKE :conv"); repl.conv = `%${conversation}%`; }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [{ total }]: any[] = await db.sequelize.query(
      `SELECT COUNT(*)::int AS total
         FROM public.lead_activity_history ah
         JOIN public.lead_dispositions d ON d.id = ah.disposition_id
    LEFT JOIN public.system_users su ON su.id = ah.agent_id
        ${whereSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const activities: any[] = await db.sequelize.query(
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
       ORDER BY ah.created_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    return sendSuccess(
      res,
      {
        activities,
        pagination: { page, pageSize, totalPages: Math.ceil(total / pageSize), total },
      },
      "Activity history fetched successfully"
    );
  } catch (err: any) {
    console.error("Error in listActivities:", err);
    if (err?.name === "ValidationError") return sendError(res, {}, err.errors.join(", "), 400);
    return sendError(res, err, "Internal server error", 500);
  }
};

// ==================== 6. FILTER ACTIVITIES ====================
export const filterlistActivities = async (req: Request, res: Response) => {
  try {
    const src: any = { ...req.query, ...req.body };

    const schema = yup.object({
      lead_id: yup.string().uuid().required("lead_id is required"),
      disposition_id: yup.string().optional(),
      agent_id: yup.string().optional(),
      conversation: yup.string().trim().max(500).optional(),
    });

    const body = await schema.validate(src, { abortEarly: false });
    const { lead_id, disposition_id, agent_id, conversation } = body;

    const repl: Record<string, any> = { lead_id };
    const where: string[] = ["ah.lead_id = :lead_id", "ah.deleted_at IS NULL"];

    if (disposition_id) { where.push("ah.disposition_id = :disposition_id"); repl.disposition_id = disposition_id; }
    if (agent_id) { where.push("ah.agent_id = :agent_id"); repl.agent_id = agent_id; }
    if (conversation) { where.push("ah.conversation ILIKE :conv"); repl.conv = `%${conversation}%`; }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const activities: any[] = await db.sequelize.query(
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
         JOIN public.lead_dispositions d ON d.id = ah.disposition_id
    LEFT JOIN public.system_users su ON su.id = ah.agent_id
        ${whereSql}
       ORDER BY ah.created_at DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    return sendSuccess(res, { activities }, "Activity history fetched successfully");
  } catch (err: any) {
    console.error("Error in filterlistActivities:", err);
    if (err.name === "ValidationError") return sendError(res, {}, err.errors.join(", "), 400);
    return sendError(res, err, "Internal server error", 500);
  }
};

// ==================== 7. SOFT DELETE ACTIVITY ====================
export const softDeleteActivity = async (req: Request, res: Response) => {
  const tx = await db.sequelize.transaction();
  try {
    const schema = yup.object({
      id: yup.string().uuid().required("id is required"),
    });

    const { id } = await schema.validate(req.body, { abortEarly: false });

    const rows: any[] = await db.sequelize.query(
      `UPDATE public.lead_activity_history AS ah
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE ah.id = :id AND ah.deleted_at IS NULL
       RETURNING ah.id, ah.lead_id, ah.disposition_id, ah.deleted_at`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction: tx }
    );

    if (!rows.length) {
      await tx.rollback();
      return sendError(res, {}, "Activity not found or already deleted.", 404);
    }

    const adminUserId = (req as any)?.user?.system_user_id;
    if (adminUserId) {
      await logUserActivity(adminUserId, `Deleted activity for lead ${rows[0].lead_id}`, "delete", tx);
    }

    await tx.commit();
    return sendSuccess(res, { count: 1, item: rows[0] }, "Activity deleted successfully");
  } catch (err: any) {
    try { await tx.rollback(); } catch {}
    if (err.name === "ValidationError") {
      return sendError(res, {}, err.errors.join(", "), 400);
    }
    console.error("Error in softDeleteActivity:", err);
    return sendError(res, err, "Internal server error", 500);
  }
};

// ==================== 8. GET ACTIVITY BY ID ====================
export const getActivityById = async (req: Request, res: Response) => {
  try {
    const activity_id = req.body?.activity_id || req.query?.id || req.body?.id;
    if (!activity_id) {
      return sendError(res, {}, "activity_id is required", 400);
    }

    const rows: any[] = await db.sequelize.query(
      `SELECT lah.id,
              lah.lead_id,
              lah.conversation,
              lah.occurred_at,
              lah.created_at,
              su.name AS agent_name,
              d.name AS disposition
         FROM public.lead_activity_history lah
    LEFT JOIN public.system_users su ON su.id = lah.agent_id
    LEFT JOIN public.lead_dispositions d ON d.id = lah.disposition_id
        WHERE lah.id = :activity_id`,
      { replacements: { activity_id }, type: QueryTypes.SELECT }
    );

    if (!rows.length) {
      return sendError(res, {}, "Activity not found", 404);
    }

    return sendSuccess(res, rows[0], "Activity fetched successfully");
  } catch (err: any) {
    return sendError(res, err, "Internal server error", 500);
  }
};

// Default export class for full backward compatibility
export default class LeadActivityHistoryController {
  public getAllDispositions = getAllDispositions;
  public getDispositionById = getDispositionById;
  public addActivity = addActivity;
  public updateActivity = updateActivity;
  public listActivities = listActivities;
  public filterlistActivities = filterlistActivities;
  public softDeleteActivity = softDeleteActivity;
  public getActivityById = getActivityById;
}
