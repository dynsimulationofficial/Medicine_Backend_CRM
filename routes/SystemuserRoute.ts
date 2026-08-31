import adminDashboardController from "../controllers/AdminDashboardController";
import agentDashboardController from "../controllers/AgentDashboardController";
import * as masterMedicineController from "../controllers/MasterMedicineController";
import * as leadSourceController from "../controllers/LeadSourceController";
import * as campaignController from "../controllers/CampaignController";
import LeadOrderController from "../controllers/LeadOrderController";
import LeadDocumentController from "../controllers/LeadDocumentController";
import LeadTaskController from "../controllers/LeadTaskController";
import LeadActivityHistoryController from "../controllers/LeadActivityHistoryController";
import express, { Request, Response } from "express";
import CompressCrmController from "../controllers/AdvanceLeadCRMController";
import UserActivityController from "../controllers/UserActivityController";
import leadController from "../controllers/LeadController";
import UserManagementController from "../controllers/UserManagementController";
import reportController from "../controllers/ReportController";
import trackingController from "../controllers/TrackingController";
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
const leadActivityHistoryController = new LeadActivityHistoryController();
const leadTaskController = new LeadTaskController();
const leadDocumentController = new LeadDocumentController();
const leadOrderController = new LeadOrderController();

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
SystemuserRouter.post("/lead/activity/filter", leadActivityHistoryController.filterlistActivities);

/* -------------------- Lead Activity -------------------- */
SystemuserRouter.post("/leads/activities/create", requireAuth, leadActivityHistoryController.addActivity);
SystemuserRouter.post("/leads/activities/list", leadActivityHistoryController.listActivities);
SystemuserRouter.post("/leads/getactivity", leadActivityHistoryController.getActivityById);
SystemuserRouter.post("/leads/update/activity", requireAuth, leadActivityHistoryController.updateActivity);
SystemuserRouter.get("/leads/dispositions/all", leadActivityHistoryController.getAllDispositions);
SystemuserRouter.get("/leads/dispositions/id", leadActivityHistoryController.getDispositionById);
SystemuserRouter.post("/leads/activities/delete", requireAuth, leadActivityHistoryController.softDeleteActivity);
SystemuserRouter.post("/leads/activities/soft-delete", requireAuth, leadActivityHistoryController.softDeleteActivity);
SystemuserRouter.post("/leads/activity/delete", requireAuth, leadActivityHistoryController.softDeleteActivity);
SystemuserRouter.post("/leads/activity/soft-delete", requireAuth, leadActivityHistoryController.softDeleteActivity);
SystemuserRouter.post("/leads/soft-delete", requireAuth, leadController.softDeleteLeads);
SystemuserRouter.get("/leadsources", leadController.getLeadSources);

/* -------------------- Lead Tasks -------------------- */
SystemuserRouter.post("/leads/tasks/create", requireAuth, leadTaskController.createTask);
SystemuserRouter.post("/leads/tasks/list", leadTaskController.listTasks);
SystemuserRouter.post("/leads/tasks/edit", requireAuth, leadTaskController.editTask);
SystemuserRouter.post("/leads/tasks/filter", leadTaskController.filterTasks);
SystemuserRouter.post("/leads/tasks/complete", requireAuth, leadTaskController.completeTask);
SystemuserRouter.post("/leads/tasks/delete", requireAuth, leadTaskController.softDeleteTask);
SystemuserRouter.post("/leads/tasks/soft-delete", requireAuth, leadTaskController.softDeleteTask);
SystemuserRouter.post("/leads/task/delete", requireAuth, leadTaskController.softDeleteTask);
SystemuserRouter.post("/leads/task/soft-delete", requireAuth, leadTaskController.softDeleteTask);

/* -------------------- Lead Documents -------------------- */
SystemuserRouter.post("/leads/documents/list", leadDocumentController.listDocuments);
SystemuserRouter.post("/leads/documents/upload", uploadFile.single("file"), requireAuth, leadDocumentController.uploadDocument);
SystemuserRouter.post(
  "/leads/bulk/upload",
  uploadFile.single("file"),
  leadController.bulkUploadFromFile
);
SystemuserRouter.post("/leads/documents/download", leadDocumentController.getDocumentUrl);
SystemuserRouter.post("/leads/documents/delete", requireAuth, leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/documents/soft-delete", requireAuth, leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/document/delete", requireAuth, leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/document/soft-delete", requireAuth, leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/document/notes", requireAuth, leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/notes", requireAuth, leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/update/notes", requireAuth, leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/edit", requireAuth, leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/get", leadDocumentController.getDocument);
SystemuserRouter.post("/leads/documents/filter", leadDocumentController.filterDocuments);
SystemuserRouter.post("/leads/documents/geturl", leadDocumentController.getDocumentUrl);

/* -------------------- Lead Medicines / Order Items -------------------- */
SystemuserRouter.post("/leads/medicines/save", requireAuth, leadOrderController.saveLeadMedicines);
SystemuserRouter.post("/leads/medicines/list", requireAuth, leadOrderController.listLeadMedicines);
SystemuserRouter.post("/leads/medicines/delete", requireAuth, leadOrderController.deleteLeadMedicine);
SystemuserRouter.get("/leads/medicines/suggestions", requireAuth, leadOrderController.getMedicineSuggestions);

/* -------------------- Lead Orders -------------------- */
SystemuserRouter.post("/leads/orders/save", requireAuth, leadOrderController.saveLeadOrder);
SystemuserRouter.post("/leads/orders/list", requireAuth, leadOrderController.listLeadOrders);
SystemuserRouter.post("/leads/orders/delete", requireAuth, leadOrderController.deleteLeadOrder);
SystemuserRouter.post("/leads/orders/update-status", requireAuth, leadOrderController.updateLeadOrderStatus);

/* -------------------- Dashboards -------------------- */
SystemuserRouter.post("/leads/task/agent/dashboard", requireAuth, agentDashboardController.getAgentTasksDashboard);
SystemuserRouter.post("/leads/admin/dashboard", requireAuth, adminDashboardController.getAdminDashboard);
SystemuserRouter.get("/leads/search/dashboard", requireAuth, agentDashboardController.searchLeadsForDashboard);

/* -------------------- Reports & Analytics -------------------- */
SystemuserRouter.post("/reports/kpi", requireAuth, reportController.getKpiAnalytics);
SystemuserRouter.get("/reports/kpi", requireAuth, reportController.getKpiAnalytics);

/* -------------------- Master Medicine Catalog -------------------- */
SystemuserRouter.post("/medicines", requireAuth, masterMedicineController.createMedicine);
SystemuserRouter.get("/medicines", requireAuth, masterMedicineController.getAllMedicines);
SystemuserRouter.get("/medicines/:id", requireAuth, masterMedicineController.getMedicineById);
SystemuserRouter.put("/medicines/:id", requireAuth, masterMedicineController.updateMedicine);
SystemuserRouter.delete("/medicines/:id", requireAuth, masterMedicineController.deleteMedicine);

/* -------------------- Lead Sources -------------------- */
SystemuserRouter.post("/lead-sources", requireAuth, leadSourceController.createLeadSource);
SystemuserRouter.post("/lead-sources/create", requireAuth, leadSourceController.createLeadSource);
SystemuserRouter.get("/lead-sources", requireAuth, leadSourceController.getAllLeadSources);
SystemuserRouter.get("/lead-sources/search", requireAuth, leadSourceController.searchLeadSources);
SystemuserRouter.get("/lead-sources/:id", requireAuth, leadSourceController.getLeadSourceById);
SystemuserRouter.put("/lead-sources/:id", requireAuth, leadSourceController.updateLeadSource);
SystemuserRouter.post("/lead-sources/edit", requireAuth, leadSourceController.updateLeadSource);
SystemuserRouter.delete("/lead-sources/:id", requireAuth, leadSourceController.deleteLeadSource);
SystemuserRouter.post("/lead-sources/delete", requireAuth, leadSourceController.deleteLeadSource);

/* -------------------- Campaigns -------------------- */
SystemuserRouter.post("/campaigns", requireAuth, campaignController.createCampaign);
SystemuserRouter.post("/campaigns/create", requireAuth, campaignController.createCampaign);
SystemuserRouter.get("/campaigns", requireAuth, campaignController.getAllCampaigns);
SystemuserRouter.get("/campaigns/search", requireAuth, campaignController.searchCampaigns);
SystemuserRouter.get("/campaigns/by-source", requireAuth, campaignController.getCampaignsBySource);
SystemuserRouter.get("/campaigns/:id", requireAuth, campaignController.getCampaignById);
SystemuserRouter.put("/campaigns/:id", requireAuth, campaignController.updateCampaign);
SystemuserRouter.post("/campaigns/edit", requireAuth, campaignController.updateCampaign);
SystemuserRouter.delete("/campaigns/:id", requireAuth, campaignController.deleteCampaign);
SystemuserRouter.post("/campaigns/delete", requireAuth, campaignController.deleteCampaign);

/* -------------------- Courier / Parcel Tracking (On-Demand) -------------------- */
SystemuserRouter.post("/tracking/sync", requireAuth, trackingController.syncTracking);
SystemuserRouter.post("/tracking/history", requireAuth, trackingController.getTrackingHistory);
SystemuserRouter.get("/tracking/history/:order_id", requireAuth, trackingController.getTrackingHistory);

export default SystemuserRouter;

