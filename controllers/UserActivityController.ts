// controllers/UserActivityController.ts
import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import BaseController from "./BaseController";
import db from "../models";
import logger from "../utils/logger";

const { SystemUser, SystemUserActivity } = db;

export const logUserActivitySchema = Yup.object().shape({
  userId: Yup.string().uuid().required("userId is required"),
  userActivity: Yup.string().required("userActivity is required"),
  module: Yup.string().optional(),
  type: Yup.string().optional(),
});

export const filterUserActivitySchema = Yup.object().shape({
  uuId: Yup.string().optional(),
  userActivity: Yup.string().optional(),
  startDate: Yup.string().optional(),
  endDate: Yup.string().optional(),
  module: Yup.string().optional(),
  type: Yup.string().optional(),
});

// ... schemas unchanged ...

export default class UserActivityController extends BaseController {
  public logUserActivity = async (req: Request, res: Response) => {
    try {
      await logUserActivitySchema.validate(req.body, { abortEarly: false });
      const { userId, userActivity, module, type } = req.body;

      const user = await SystemUser.findByPk(userId);
      if (!user) return this.sendError(res, {}, "User does not exist", 404);

      await SystemUserActivity.create({
        system_user_id: userId,  // Use system_user_id instead of uuid
        user_activity: userActivity,
        module: module || 'general',
        type: type || 'action',
      });

      return this.sendSuccess(res, {}, "User activity logged successfully!");
    } catch (err: any) {
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      logger.error("logUserActivity error", err);
      return this.sendError(res, {}, "Internal server error", 500);
    }
  };

  public getAllUserActivities = async (req: Request, res: Response) => {
    try {
      const schema = Yup.object({
        page: Yup.number().integer().min(1).default(1),
        // ✅ fix per-page limit to 10 always
        pageSize: Yup.number().integer().min(1).max(2000).default(10),
        userId: Yup.string().uuid().optional(),
        activityType: Yup.string().optional(),
        startDate: Yup.date().optional(),
        endDate: Yup.date().optional(),
      });

      const qp = await schema.validate(req.query, { abortEarly: false });

      const page = Number(qp.page);
      const pageSize = 10; // ✅ enforce 10 records per page
      const offset = (page - 1) * pageSize;

      // Build dynamic filter
      const where: any = {};
      if (qp.userId) {
        where.system_user_id = qp.userId;
      }
      if (qp.activityType) {
        where.activity_type = qp.activityType;
      }
      if (qp.startDate && qp.endDate) {
        where.activity_timestamp = {
          [Op.between]: [qp.startDate, qp.endDate],
        };
      }

      const { count, rows } = await SystemUserActivity.findAndCountAll({
        where,
        include: [
          {
            model: SystemUser,
            as: "user",
            attributes: ["id", "name"],
            required: false,
          },
        ],
        order: [["activity_timestamp", "DESC"]],
        limit: pageSize,
        offset,
        distinct: true,
      });

      return this.sendSuccess(
        res,
        {
          data: rows,
          pagination: {
            page,
            pageSize,
            totalPages: Math.ceil(count / pageSize),
          },
        },
        "Activities fetched successfully!"
      );
    } catch (err: any) {
      logger.error("getAllUserActivities error", err);
      if (err.name === "ValidationError") {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      return this.sendError(res, {}, "Internal server error", 500);
    }
  };
  public filterUserActivities = async (req: Request, res: Response) => {
    try {
      // Validate the body with Yup schema
      await filterUserActivitySchema.validate(req.body, { abortEarly: false });

      const { uuId, userActivity, startDate, endDate, module, type } = req.body;

      // Ensure at least one filter is provided
      const filters = [uuId, userActivity, startDate, endDate, module, type];
      const filterCount = filters.filter(Boolean).length;

      if (filterCount === 0) {
        return this.sendError(res, {}, "At least one filter must be provided.", 400);
      }

      // Pagination setup
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const offset = (page - 1) * limit;

      // Prepare `where` condition based on provided filters
      const where: any = {};

      if (uuId) {
        if (!Yup.string().uuid().isValidSync(uuId)) {
          return this.sendError(res, {}, "Invalid uuId format", 400);
        }
        where.uuid = uuId;
      }

      if (userActivity) where.user_activity = userActivity;
      if (module) where.module = module;
      if (type) where.type = type;

      // Handle date filters
      if (startDate || endDate) where.activity_timestamp = {};

      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          return this.sendError(res, {}, "Invalid startDate format", 400);
        }
        where.activity_timestamp[Op.gte] = parsedStartDate;
      }

      if (endDate) {
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          return this.sendError(res, {}, "Invalid endDate format", 400);
        }
        where.activity_timestamp[Op.lte] = parsedEndDate;
      }

      // Fetch filtered activities with pagination
      const { count, rows } = await SystemUserActivity.findAndCountAll({
        where,
        include: [
          {
            model: SystemUser,
            as: "user",
            attributes: ["id", "name"],
            required: false,
          },
        ],
        order: [["activity_timestamp", "DESC"]],
        limit,
        offset,
        distinct: true,
      });

      // Return filtered activities and pagination details
      return this.sendSuccess(
        res,
        {
          data: rows,
          pagination: {
            page,
            pageSize: limit,
            totalPages: Math.ceil(count / limit),
          },
        },
        "Filtered activities fetched successfully!"
      );
    } catch (err: any) {
      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      logger.error("filterUserActivities error", err);
      return this.sendError(res, {}, "Internal server error", 500);
    }
  };
  // -------------------- Get all users (id + name) --------------------
  public getAllUserNamesAndUUIDs = async (_req: Request, res: Response) => {
    try {
      const users = await SystemUser.findAll({
        where: { deleted_at: null },
        attributes: ["id", "name"],
        order: [["name", "ASC"]],
      });
      return this.sendSuccess(res, users, "Users fetched successfully!");
    } catch (err: any) {
      logger.error("getAllUserNamesAndUUIDs error", err);
      return this.sendError(res, {}, "Internal server error", 500);
    }
  };

  // -------------------- Get all deleted users --------------------
  public getAllDeletedUsers = async (_req: Request, res: Response) => {
    try {
      const users = await SystemUser.findAll({
        where: { deleted_at: { [Op.ne]: null } },
        attributes: ["id", "name", "deleted_at"],
        order: [["deleted_at", "DESC"]],
      });

      if (!users.length) {
        return this.sendError(res, {}, "No deleted users found", 404);
      }

      return this.sendSuccess(res, users, "Deleted users fetched successfully!");
    } catch (err: any) {
      logger.error("getAllDeletedUsers error", err);
      return this.sendError(res, {}, "Internal server error", 500);
    }
  };
}
