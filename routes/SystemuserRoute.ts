import express, { Request, Response } from "express";
import CompressCrmController from "../controllers/AdvanceLeadCRMController";
import UserActivityController from "../controllers/UserActivityController";
import LeadController from "../controllers/LeadController";
import UserManagementController from "../controllers/UserManagementController";
import reportController from "../controllers/ReportController";
import { uploadFile } from "../multerconfig";
import { requireAuth } from "../middleware/auth";
import { randomUUID } from 'crypto';
import FCMService from "../service/FCMService";
import { WebPushToken } from "../models";
import { Op } from "sequelize";
import db from "../models";

function normalizeFcmToken(raw?: string) {
  if (!raw) return "";
  const t = raw.trim().replace(/\s+/g, "");
  return t;
}

export const SystemuserRouter = express.Router();

const systemuserController = new CompressCrmController();
const userActivityController = new UserActivityController();
const leadController = new LeadController();

/* -------------------- Authentication & User Management -------------------- */
SystemuserRouter.post("/register", requireAuth, UserManagementController.createUser);
SystemuserRouter.post("/sendotp", systemuserController.loginRequestOtp);
SystemuserRouter.post("/login", systemuserController.verifyOtp);
SystemuserRouter.post("/logout", systemuserController.logout);
SystemuserRouter.post("/userdelete", requireAuth, UserManagementController.deleteUser);
SystemuserRouter.post("/leads/user/edit", requireAuth, UserManagementController.editUser);
SystemuserRouter.get("/allusers", UserManagementController.getAllUsers);
SystemuserRouter.post("/blockuser", requireAuth, UserManagementController.blockUser);
SystemuserRouter.post("/unblockuser", requireAuth, systemuserController.unblockUser);
SystemuserRouter.get("/listblockuser", requireAuth, systemuserController.listBlockedUsers);
SystemuserRouter.get("/assigned-lead-notifications", requireAuth, leadController.getAssignedLeadNotifications);

/* -------------------- User Activity -------------------- */
SystemuserRouter.post("/user-activity/log", userActivityController.logUserActivity);
SystemuserRouter.get("/user-activity", userActivityController.getAllUserActivities);
SystemuserRouter.post("/user-activity/filter", userActivityController.filterUserActivities);
SystemuserRouter.get("/users", userActivityController.getAllUserNamesAndUUIDs);
SystemuserRouter.get("/users/deleted", userActivityController.getAllDeletedUsers);

/* -------------------- Web Push (FCM) -------------------- */
SystemuserRouter.post(
  "/register-fcm",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { fcmtoken } = req.body as { fcmtoken?: string };
      const user = (req as any).user;

      if (!fcmtoken) {
        return res.status(400).json({ success: false, msg: "FCM token required" });
      }

      if (!user?.system_user_id) {
        return res.status(401).json({ success: false, msg: "Unauthorized" });
      }

      const userId = user.system_user_id;

      if (fcmtoken.length < 100) {
        return res.status(400).json({ 
          success: false, 
          msg: "Invalid FCM token format" 
        });
      }

      const existingToken = await db.WebPushToken.findOne({
        where: { system_user_id: userId }
      });

      if (existingToken) {
        await db.WebPushToken.update(
          { 
            fcmtoken: fcmtoken,
            is_active: true, 
            updated_at: new Date() 
          },
          { where: { system_user_id: userId } }
        );
      } else {
        await db.WebPushToken.create({
          id: randomUUID(),
          system_user_id: userId,
          fcmtoken: fcmtoken,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      return res.json({
        success: true,
        msg: "FCM token registered successfully",
      });
    } catch (e) {
      console.error("register-fcm error:", e);
      return res.status(500).json({ success: false, msg: "Failed to register FCM token" });
    }
  }
);

SystemuserRouter.post(
  "/debug-token",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { fcmtoken } = req.body;
      if (!fcmtoken) {
        return res.status(400).json({ success: false, msg: "FCM token required" });
      }

      const validity = await FCMService.debugTokenValidity(fcmtoken);
      
      return res.json({
        success: validity.valid,
        valid: validity.valid,
        error: validity.error,
        msg: validity.valid ? "Token is valid" : `Token invalid: ${validity.error}`
      });
    } catch (e) {
      console.error("debug-token error:", e);
      return res.status(500).json({ success: false, msg: "Debug failed" });
    }
  }
);

SystemuserRouter.post(
  "/cleanup-tokens",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const result = await FCMService.cleanupInvalidTokens(user.system_user_id);
      
      return res.json({
        success: true,
        ...result,
        message: "Token cleanup completed"
      });
    } catch (e) {
      console.error("cleanup-tokens error:", e);
      return res.status(500).json({ success: false, msg: "Cleanup failed" });
    }
  }
);
SystemuserRouter.get("/assigned-lead-notifications", requireAuth, leadController.getAssignedLeadNotifications);

/* -------------------- Leads (core) -------------------- */
SystemuserRouter.post("/leads", requireAuth, leadController.createLead);
SystemuserRouter.post("/leads/get", requireAuth, leadController.getLead);
SystemuserRouter.get("/leads/assigned", requireAuth, leadController.getAssignedLeads);
SystemuserRouter.post("/leads/assigned/bulk", requireAuth, leadController.bulkAssignLeads);
SystemuserRouter.get("/leads/unassigned", requireAuth, leadController.getUnassignedLeads);
SystemuserRouter.get("/leads/notassigned", requireAuth, leadController.getUnassignedLeads);
SystemuserRouter.get("/leads/random", leadController.getNextUnassignedLead);
SystemuserRouter.get("/allagents", requireAuth, leadController.getAllAgents);
SystemuserRouter.post("/leads/update", leadController.updateLead);
SystemuserRouter.post("/assignlead", requireAuth, leadController.assignLeadToAgent);
SystemuserRouter.post("/leads/filter", requireAuth, leadController.searchLeads);
SystemuserRouter.post("/unassignedleads/filter", requireAuth, leadController.filterUnassignedLeads);
SystemuserRouter.post("/leads/unassigned/filter", requireAuth, leadController.filterUnassignedLeads);
SystemuserRouter.post("/notassignedleads/filter", requireAuth, leadController.filterUnassignedLeads);
SystemuserRouter.post("/lead/activity/filter", leadController.filterlistActivities);

/* -------------------- Lead Activity -------------------- */
SystemuserRouter.post("/leads/activities/create", requireAuth, leadController.addActivity);
SystemuserRouter.post("/leads/activities/list", leadController.listActivities);
SystemuserRouter.post("/leads/getactivity", leadController.getActivityById);
SystemuserRouter.post("/leads/update/activity", requireAuth, leadController.updateActivity);
SystemuserRouter.get("/leads/dispositions/all", leadController.getAllDispositions);
SystemuserRouter.get("/leads/dispositions/id", leadController.getDispositionById);
SystemuserRouter.post("/leads/activities/soft-delete", requireAuth, leadController.softDeleteActivity);
SystemuserRouter.post("/leads/soft-delete", requireAuth, leadController.softDeleteLeads);
SystemuserRouter.get("/leadsources", leadController.getLeadSources);
SystemuserRouter.get("/getconsolidation", leadController.getConsolidatedCreditStatuses);
SystemuserRouter.get("/leaddebtstatuses", leadController.getLeadDebtStatuses);

/* -------------------- Lead Tasks -------------------- */
SystemuserRouter.post("/leads/tasks/create", requireAuth, leadController.createTask);
SystemuserRouter.post("/leads/tasks/list", leadController.listTasks);
SystemuserRouter.post("/leads/tasks/edit", requireAuth, leadController.editTask);
SystemuserRouter.post("/leads/tasks/filter", leadController.filterTasks);
SystemuserRouter.post("/leads/tasks/complete", requireAuth, leadController.completeTask);
SystemuserRouter.post("/leads/task/soft-delete", leadController.softDeleteTask);

/* -------------------- Lead Documents -------------------- */
SystemuserRouter.post("/leads/documents/list", leadController.listDocuments);
SystemuserRouter.post("/leads/documents/upload", uploadFile.single("file"), requireAuth, leadController.uploadDocument);
SystemuserRouter.post(
  "/leads/bulk/upload",
  uploadFile.single("file"),
  leadController.bulkUploadFromFile
);
SystemuserRouter.post("/leads/documents/download", leadController.downloadDocument);
SystemuserRouter.post("/leads/documents/soft-delete", requireAuth, leadController.softDeleteDocument);
SystemuserRouter.post("/leads/documents/get", leadController.getDocument);
SystemuserRouter.post("/leads/documents/filter", leadController.filterDocuments);
SystemuserRouter.post("/leads/documents/geturl", leadController.getDocumentUrl);

/* -------------------- Lead Medicines / Order Items -------------------- */
SystemuserRouter.post("/leads/medicines/save", requireAuth, leadController.saveLeadMedicines);
SystemuserRouter.post("/leads/medicines/list", requireAuth, leadController.listLeadMedicines);
SystemuserRouter.post("/leads/medicines/delete", requireAuth, leadController.deleteLeadMedicine);
SystemuserRouter.get("/leads/medicines/suggestions", requireAuth, leadController.getMedicineSuggestions);

/* -------------------- Lead Orders -------------------- */
SystemuserRouter.post("/leads/orders/save", requireAuth, leadController.saveLeadOrder);
SystemuserRouter.post("/leads/orders/list", requireAuth, leadController.listLeadOrders);
SystemuserRouter.post("/leads/orders/delete", requireAuth, leadController.deleteLeadOrder);
SystemuserRouter.post("/leads/orders/update-status", requireAuth, leadController.updateLeadOrderStatus);

/* -------------------- Dashboards -------------------- */
SystemuserRouter.post("/leads/task/agent/dashboard", requireAuth, leadController.getAgentTasksDashboard);
SystemuserRouter.post("/leads/admin/dashboard", requireAuth, leadController.getAdminDashboard);
SystemuserRouter.get("/leads/search/dashboard", requireAuth, leadController.searchLeadsForDashboard);

/* -------------------- Reports & Analytics -------------------- */
SystemuserRouter.post("/reports/kpi", requireAuth, reportController.getKpiAnalytics);

export default SystemuserRouter;
