import { Request, Response } from "express";
import * as yup from "yup";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";

// ==================== SINGLE UNIFIED VALIDATION SCHEMA ====================
const leadTaskSchema = yup.object({
  id: yup.string().uuid("Invalid task ID").optional(),
  task_id: yup.string().uuid("Invalid task ID").optional(),
  lead_id: yup.string().uuid("Invalid lead ID").optional(),
  task_type: yup.string().oneOf(["meeting", "phonecall", "followup"]).default("followup"),
  subject: yup.string().trim().max(255).optional(),
  details: yup.string().trim().optional(),
  location: yup.string().trim().max(255).optional(),
  start_at: yup.date().nullable().optional(),
  end_at: yup.date().nullable().optional(),
  status: yup.string().oneOf(["pending", "done"]).optional(),
  assigned_agent_id: yup.string().uuid("Invalid agent ID").nullable().optional(),
});

// Helper for parsing date/string inputs safely
const parseDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// ==================== 1. CREATE TASK ====================
export const createTask = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const validatedData = await leadTaskSchema.validate(req.body, { abortEarly: false });
    const id = uuidv4();
    const now = new Date();

    const startAt = parseDate(validatedData.start_at || req.body.start_at_text) || now;
    const endAt = parseDate(validatedData.end_at || req.body.end_at_text) || new Date(startAt.getTime() + 30 * 60000);

    let agent_id = validatedData.assigned_agent_id || null;
    if (!agent_id) {
      const leadRows: any[] = await db.sequelize.query(
        `SELECT agent_id, full_name FROM public.leads WHERE id = :lead_id LIMIT 1`,
        { replacements: { lead_id }, type: QueryTypes.SELECT }
      );
      agent_id = leadRows[0]?.agent_id || null;
    }

    const typeLabel = validatedData.task_type === "meeting" ? "Meeting" : validatedData.task_type === "phonecall" ? "Phone Call" : "Follow Up";
    const subject = validatedData.subject?.trim() || `${typeLabel} Task`;

    const result: any[] = await db.sequelize.query(
      `INSERT INTO public.lead_tasks (
         id, lead_id, assigned_agent_id, task_type, subject, details, location,
         timer_minutes, timer_hours,
         start_at, end_at, due_at, status, created_at, updated_at
       ) VALUES (
         :id, :lead_id, :assigned_agent_id, :task_type, :subject, :details, :location,
         0, 0,
         :start_at, :end_at, :start_at, 'pending', :now, :now
       )
       RETURNING *`,
      {
        replacements: {
          id,
          lead_id,
          assigned_agent_id: agent_id,
          task_type: validatedData.task_type || "followup",
          subject,
          details: validatedData.details || "",
          location: validatedData.location || "",
          start_at: startAt,
          end_at: endAt,
          now,
        },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(201).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 2. GET ALL TASKS FOR LEAD ====================
export const getAllTasks = async (req: Request, res: Response) => {
  try {
    const lead_id = req.body?.lead_id || req.query?.lead_id;
    if (!lead_id) {
      return res.status(400).json({ success: false, message: "Lead ID is required" });
    }

    const tasks: any[] = await db.sequelize.query(
      `SELECT
         t.id,
         t.task_type,
         t.task_type AS type,
         t.subject,
         t.details,
         t.location,
         t.status,
         t.start_at,
         t.end_at,
         t.due_at,
         t.assigned_agent_id,
         su.name AS agent_name,
         su.name AS owner_name,
         t.created_at,
         t.updated_at,
         l.id AS lead_id,
         l.full_name
       FROM public.lead_tasks t
       JOIN public.leads l ON l.id = t.lead_id
       LEFT JOIN public.system_users su ON su.id = t.assigned_agent_id
       WHERE t.lead_id = :lead_id
         AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC`,
      { replacements: { lead_id }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, data: { task: tasks } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 3. UPDATE TASK ====================
export const updateTask = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.body?.task_id || req.query?.id || req.query?.task_id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Task ID is required" });
    }

    const validatedData = await leadTaskSchema.validate(req.body, { abortEarly: false });
    const now = new Date();

    const startAt = parseDate(validatedData.start_at || req.body.start_at_text);
    const endAt = parseDate(validatedData.end_at || req.body.end_at_text);

    const result: any[] = await db.sequelize.query(
      `UPDATE public.lead_tasks
       SET task_type = COALESCE(:task_type, task_type),
           subject = COALESCE(:subject, subject),
           details = COALESCE(:details, details),
           location = COALESCE(:location, location),
           status = COALESCE(:status, status),
           assigned_agent_id = COALESCE(:assigned_agent_id, assigned_agent_id),
           start_at = COALESCE(:start_at, start_at),
           due_at = COALESCE(:start_at, due_at),
           end_at = COALESCE(:end_at, end_at),
           updated_at = :now
       WHERE id = :id AND deleted_at IS NULL
       RETURNING *`,
      {
        replacements: {
          id,
          task_type: validatedData.task_type || null,
          subject: validatedData.subject || null,
          details: validatedData.details !== undefined ? validatedData.details : null,
          location: validatedData.location !== undefined ? validatedData.location : null,
          status: validatedData.status || null,
          assigned_agent_id: validatedData.assigned_agent_id || null,
          start_at: startAt,
          end_at: endAt,
          now,
        },
        type: QueryTypes.SELECT,
      }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Task record not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 4. COMPLETE TASK ====================
export const completeTask = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.body?.task_id || req.query?.id || req.query?.task_id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Task ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `UPDATE public.lead_tasks
       SET status = 'done', updated_at = NOW()
       WHERE id = :id AND deleted_at IS NULL
       RETURNING id, status, updated_at`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Task record not found" });
    }

    return res.status(200).json({ success: true, message: "Task marked as completed", data: result[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== 5. DELETE TASK (SOFT DELETE) ====================
export const deleteTask = async (req: Request, res: Response) => {
  try {
    const id = req.body?.id || req.body?.task_id || req.query?.id || req.query?.task_id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Task ID is required" });
    }

    const result: any[] = await db.sequelize.query(
      `UPDATE public.lead_tasks
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = :id AND deleted_at IS NULL
       RETURNING id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: "Task record not found" });
    }

    return res.status(200).json({ success: true, message: "Task deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DEFAULT EXPORT ====================
export default {
  createTask,
  getAllTasks,
  listTasks: getAllTasks,
  updateTask,
  editTask: updateTask,
  filterTasks: getAllTasks,
  completeTask,
  deleteTask,
  softDeleteTask: deleteTask,
};
