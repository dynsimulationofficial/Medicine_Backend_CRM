import adminDashboardController from "../controllers/AdminDashboardController";
import agentDashboardController from "../controllers/AgentDashboardController";
import * as masterMedicineController from "../controllers/MasterMedicineController";
import * as leadSourceController from "../controllers/LeadSourceController";
import * as campaignController from "../controllers/CampaignController";
import leadOrderController from "../controllers/LeadOrderController";
import leadDocumentController from "../controllers/LeadDocumentController";
import leadTaskController from "../controllers/LeadTaskController";
import leadActivityHistoryController from "../controllers/LeadActivityHistoryController";
import express from "express";
import CompressCrmController from "../controllers/AdvanceLeadCRMController";
import UserActivityController from "../controllers/UserActivityController";
import leadController from "../controllers/LeadController";
import UserManagementController from "../controllers/UserManagementController";
import reportController from "../controllers/ReportController";
import trackingController from "../controllers/TrackingController";
import { uploadFile } from "../multerconfig";
import { requireAuth } from "../middleware/auth";

export const SystemuserRouter = express.Router();

const systemuserController = new CompressCrmController();
const userActivityController = new UserActivityController();

/* ==================== 1. PUBLIC AUTH ROUTES ==================== */
SystemuserRouter.post("/sendotp", systemuserController.loginRequestOtp);
SystemuserRouter.post("/login", systemuserController.verifyOtp);
SystemuserRouter.post("/logout", systemuserController.logout);

/* ==================== 2. GLOBAL AUTH MIDDLEWARE (All routes below require authentication) ==================== */
SystemuserRouter.use(requireAuth);

/* -------------------- User Management -------------------- */
SystemuserRouter.post("/register", UserManagementController.createUser);
SystemuserRouter.post("/userdelete", UserManagementController.deleteUser);
SystemuserRouter.post("/leads/user/edit", UserManagementController.editUser);
SystemuserRouter.get("/allusers", UserManagementController.getAllUsers);
SystemuserRouter.post("/blockuser", UserManagementController.blockUser);
SystemuserRouter.post("/unblockuser", systemuserController.unblockUser);
SystemuserRouter.get("/listblockuser", systemuserController.listBlockedUsers);
SystemuserRouter.get("/assigned-lead-notifications", leadController.getAssignedLeadNotifications);

/* -------------------- User Activity -------------------- */
SystemuserRouter.post("/user-activity/log", userActivityController.logUserActivity);
SystemuserRouter.get("/user-activity", userActivityController.getAllUserActivities);
SystemuserRouter.post("/user-activity/filter", userActivityController.filterUserActivities);
SystemuserRouter.get("/users", userActivityController.getAllUserNamesAndUUIDs);
SystemuserRouter.get("/users/deleted", userActivityController.getAllDeletedUsers);

/* -------------------- Leads (Core) -------------------- */
SystemuserRouter.post("/leads", leadController.createLead);
SystemuserRouter.get("/leads/unassigned", leadController.getUnassignedLeads);
SystemuserRouter.get("/leads/notassigned", leadController.getUnassignedLeads);
SystemuserRouter.get("/leads/assigned", leadController.getAssignedLeads);
SystemuserRouter.post("/leads/get", leadController.getLead);
SystemuserRouter.post("/leads/update", leadController.updateLead);
SystemuserRouter.post("/leads/soft-delete", leadController.softDeleteLeads);
SystemuserRouter.post("/assignlead", leadController.assignLeadToAgent);
SystemuserRouter.post("/leads/assigned/bulk", leadController.bulkAssignLeads);
SystemuserRouter.post("/leads/filter", leadController.searchLeads);
SystemuserRouter.post("/unassignedleads/filter", leadController.searchLeads);
SystemuserRouter.get("/allagents", leadController.getAllAgents);
SystemuserRouter.get("/leadsources", leadController.getLeadSources);
SystemuserRouter.get("/leads/random", leadController.getNextUnassignedLead);

/* -------------------- Lead Activity -------------------- */
SystemuserRouter.post("/leads/activities/create", leadActivityHistoryController.createActivity);
SystemuserRouter.post("/leads/activities/list", leadActivityHistoryController.getAllActivities);
SystemuserRouter.post("/leads/update/activity", leadActivityHistoryController.updateActivity);
SystemuserRouter.post("/leads/activities/delete", leadActivityHistoryController.deleteActivity);
SystemuserRouter.post("/leads/activities/soft-delete", leadActivityHistoryController.deleteActivity);
SystemuserRouter.get("/leads/dispositions/all", leadActivityHistoryController.getAllDispositions);

/* -------------------- Lead Tasks -------------------- */
SystemuserRouter.post("/leads/tasks/create", leadTaskController.createTask);
SystemuserRouter.post("/leads/tasks/list", leadTaskController.getAllTasks);
SystemuserRouter.post("/leads/tasks/edit", leadTaskController.updateTask);
SystemuserRouter.post("/leads/tasks/filter", leadTaskController.getAllTasks);
SystemuserRouter.post("/leads/tasks/complete", leadTaskController.completeTask);
SystemuserRouter.post("/leads/tasks/delete", leadTaskController.deleteTask);
SystemuserRouter.post("/leads/tasks/soft-delete", leadTaskController.deleteTask);

/* -------------------- Lead Documents -------------------- */
SystemuserRouter.post("/leads/documents/list", leadDocumentController.getAllDocuments);
SystemuserRouter.post("/leads/documents/upload", uploadFile.single("file"), leadDocumentController.uploadDocument);
SystemuserRouter.post("/leads/bulk/upload", uploadFile.single("file"), leadController.bulkUploadFromFile);
SystemuserRouter.post("/leads/documents/download", leadDocumentController.getDocumentUrl);
SystemuserRouter.post("/leads/documents/geturl", leadDocumentController.getDocumentUrl);
SystemuserRouter.post("/leads/documents/edit", leadDocumentController.updateDocument);
SystemuserRouter.post("/leads/documents/notes", leadDocumentController.updateDocument);
SystemuserRouter.post("/leads/document/notes", leadDocumentController.updateDocument);
SystemuserRouter.post("/leads/documents/update/notes", leadDocumentController.updateDocument);
SystemuserRouter.post("/leads/documents/delete", leadDocumentController.deleteDocument);
SystemuserRouter.post("/leads/documents/soft-delete", leadDocumentController.deleteDocument);
SystemuserRouter.post("/leads/document/delete", leadDocumentController.deleteDocument);
SystemuserRouter.post("/leads/document/soft-delete", leadDocumentController.deleteDocument);

/* -------------------- Lead Medicines / Order Items -------------------- */
SystemuserRouter.get("/leads/medicines/suggestions", leadOrderController.getMedicineSuggestions);

/* -------------------- Lead Orders -------------------- */
SystemuserRouter.post("/leads/orders/create", leadOrderController.createOrder);
SystemuserRouter.post("/leads/orders/update", leadOrderController.updateOrder);
SystemuserRouter.post("/leads/orders/save", (req, res) => {
  if (req.body?.id || req.body?.order_id) {
    return leadOrderController.updateOrder(req, res);
  }
  return leadOrderController.createOrder(req, res);
});
SystemuserRouter.post("/leads/orders/list", leadOrderController.getAllOrders);
SystemuserRouter.post("/leads/orders/delete", leadOrderController.deleteOrder);
SystemuserRouter.post("/leads/orders/update-status", leadOrderController.updateOrder);

/* -------------------- Dashboards -------------------- */
SystemuserRouter.post("/leads/task/agent/dashboard", agentDashboardController.getAgentTasksDashboard);
SystemuserRouter.get("/leads/task/agent/dashboard", agentDashboardController.getAgentTasksDashboard);
SystemuserRouter.post("/leads/agent/dashboard/assigned-leads-count", agentDashboardController.getAssignedLeadsCount);
SystemuserRouter.get("/leads/agent/dashboard/assigned-leads-count", agentDashboardController.getAssignedLeadsCount);
SystemuserRouter.post("/leads/agent/dashboard/converted-deals-count", agentDashboardController.getConvertedDealsCount);
SystemuserRouter.get("/leads/agent/dashboard/converted-deals-count", agentDashboardController.getConvertedDealsCount);
SystemuserRouter.post("/leads/agent/dashboard/total-orders-count", agentDashboardController.getTotalOrdersCount);
SystemuserRouter.get("/leads/agent/dashboard/total-orders-count", agentDashboardController.getTotalOrdersCount);
SystemuserRouter.post("/leads/agent/dashboard/sales-revenue", agentDashboardController.getSalesRevenue);
SystemuserRouter.get("/leads/agent/dashboard/sales-revenue", agentDashboardController.getSalesRevenue);
SystemuserRouter.post("/leads/agent/dashboard/tasks-today", agentDashboardController.getTasksTodayCount);
SystemuserRouter.get("/leads/agent/dashboard/tasks-today", agentDashboardController.getTasksTodayCount);
SystemuserRouter.post("/leads/agent/dashboard/overdue-tasks", agentDashboardController.getOverdueTasksCount);
SystemuserRouter.get("/leads/agent/dashboard/overdue-tasks", agentDashboardController.getOverdueTasksCount);
SystemuserRouter.post("/leads/agent/dashboard/assigned-leads", agentDashboardController.getAssignedLeadsQueue);
SystemuserRouter.get("/leads/agent/dashboard/assigned-leads", agentDashboardController.getAssignedLeadsQueue);

SystemuserRouter.post("/leads/admin/dashboard", adminDashboardController.getAdminDashboard);
SystemuserRouter.post("/leads/admin/dashboard/cards", adminDashboardController.getAdminCards);
SystemuserRouter.get("/leads/admin/dashboard/cards", adminDashboardController.getAdminCards);
SystemuserRouter.post("/leads/admin/dashboard/campaigns", adminDashboardController.getCampaignPerformance);
SystemuserRouter.get("/leads/admin/dashboard/campaigns", adminDashboardController.getCampaignPerformance);
SystemuserRouter.post("/leads/admin/dashboard/team-tasks", adminDashboardController.getTeamTasks);
SystemuserRouter.get("/leads/admin/dashboard/team-tasks", adminDashboardController.getTeamTasks);
SystemuserRouter.post("/leads/admin/dashboard/tasks-list", adminDashboardController.getTasksList);
SystemuserRouter.get("/leads/admin/dashboard/tasks-list", adminDashboardController.getTasksList);
SystemuserRouter.get("/leads/search/dashboard", agentDashboardController.searchLeadsForDashboard);

/* -------------------- Reports & Analytics -------------------- */
SystemuserRouter.post("/reports/kpi", reportController.getKpiAnalytics);
SystemuserRouter.get("/reports/kpi", reportController.getKpiAnalytics);

/* -------------------- Master Medicine Catalog -------------------- */
SystemuserRouter.post("/medicines", uploadFile.single("image"), masterMedicineController.createMedicine);
SystemuserRouter.get("/medicines", masterMedicineController.getAllMedicines);
SystemuserRouter.get("/medicines/:id", masterMedicineController.getMedicineById);
SystemuserRouter.put("/medicines/:id", uploadFile.single("image"), masterMedicineController.updateMedicine);
SystemuserRouter.post("/medicines/:id", uploadFile.single("image"), masterMedicineController.updateMedicine);
SystemuserRouter.delete("/medicines/:id", masterMedicineController.deleteMedicine);

/* -------------------- Lead Sources -------------------- */
SystemuserRouter.post("/lead-sources", leadSourceController.createLeadSource);
SystemuserRouter.post("/lead-sources/create", leadSourceController.createLeadSource);
SystemuserRouter.get("/lead-sources", leadSourceController.getAllLeadSources);
SystemuserRouter.get("/lead-sources/search", leadSourceController.getAllLeadSources);
SystemuserRouter.get("/lead-sources/:id", leadSourceController.getLeadSourceById);
SystemuserRouter.put("/lead-sources/:id", leadSourceController.updateLeadSource);
SystemuserRouter.post("/lead-sources/edit", leadSourceController.updateLeadSource);
SystemuserRouter.delete("/lead-sources/:id", leadSourceController.deleteLeadSource);
SystemuserRouter.post("/lead-sources/delete", leadSourceController.deleteLeadSource);

/* -------------------- Campaigns -------------------- */
SystemuserRouter.post("/campaigns", campaignController.createCampaign);
SystemuserRouter.post("/campaigns/create", campaignController.createCampaign);
SystemuserRouter.get("/campaigns", campaignController.getAllCampaigns);
SystemuserRouter.get("/campaigns/search", campaignController.getAllCampaigns);
SystemuserRouter.get("/campaigns/by-source", campaignController.getCampaignsBySource);
SystemuserRouter.get("/campaigns/:id", campaignController.getCampaignById);
SystemuserRouter.put("/campaigns/:id", campaignController.updateCampaign);
SystemuserRouter.post("/campaigns/edit", campaignController.updateCampaign);
SystemuserRouter.delete("/campaigns/:id", campaignController.deleteCampaign);
SystemuserRouter.post("/campaigns/delete", campaignController.deleteCampaign);

/* -------------------- Courier / Parcel Tracking (On-Demand) -------------------- */
SystemuserRouter.post("/tracking/sync", trackingController.syncTracking);
SystemuserRouter.post("/tracking/history", trackingController.getTrackingHistory);
SystemuserRouter.get("/tracking/history/:order_id", trackingController.getTrackingHistory);

export default SystemuserRouter;
