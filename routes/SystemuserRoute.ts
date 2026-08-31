import adminDashboardController from "../controllers/AdminDashboardController";
import agentDashboardController from "../controllers/AgentDashboardController";
import * as masterMedicineController from "../controllers/MasterMedicineController";
import * as leadSourceController from "../controllers/LeadSourceController";
import * as campaignController from "../controllers/CampaignController";
import LeadOrderController from "../controllers/LeadOrderController";
import LeadDocumentController from "../controllers/LeadDocumentController";
import LeadTaskController from "../controllers/LeadTaskController";
import LeadActivityHistoryController from "../controllers/LeadActivityHistoryController";
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
const leadActivityHistoryController = new LeadActivityHistoryController();
const leadTaskController = new LeadTaskController();
const leadDocumentController = new LeadDocumentController();
const leadOrderController = new LeadOrderController();

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
SystemuserRouter.post("/unassignedleads/filter", leadController.filterUnassignedLeads);
SystemuserRouter.post("/leads/unassigned/filter", leadController.filterUnassignedLeads);
SystemuserRouter.post("/notassignedleads/filter", leadController.filterUnassignedLeads);
SystemuserRouter.get("/allagents", leadController.getAllAgents);
SystemuserRouter.get("/leadsources", leadController.getLeadSources);
SystemuserRouter.get("/leads/random", leadController.getNextUnassignedLead);

/* -------------------- Lead Activity -------------------- */
SystemuserRouter.post("/lead/activity/filter", leadActivityHistoryController.filterlistActivities);
SystemuserRouter.post("/leads/activities/create", leadActivityHistoryController.addActivity);
SystemuserRouter.post("/leads/activities/list", leadActivityHistoryController.listActivities);
SystemuserRouter.post("/leads/getactivity", leadActivityHistoryController.getActivityById);
SystemuserRouter.post("/leads/update/activity", leadActivityHistoryController.updateActivity);
SystemuserRouter.get("/leads/dispositions/all", leadActivityHistoryController.getAllDispositions);
SystemuserRouter.get("/leads/dispositions/id", leadActivityHistoryController.getDispositionById);
SystemuserRouter.post("/leads/activities/delete", leadActivityHistoryController.softDeleteActivity);
SystemuserRouter.post("/leads/activities/soft-delete", leadActivityHistoryController.softDeleteActivity);
SystemuserRouter.post("/leads/activity/delete", leadActivityHistoryController.softDeleteActivity);
SystemuserRouter.post("/leads/activity/soft-delete", leadActivityHistoryController.softDeleteActivity);

/* -------------------- Lead Tasks -------------------- */
SystemuserRouter.post("/leads/tasks/create", leadTaskController.createTask);
SystemuserRouter.post("/leads/tasks/list", leadTaskController.listTasks);
SystemuserRouter.post("/leads/tasks/edit", leadTaskController.editTask);
SystemuserRouter.post("/leads/tasks/filter", leadTaskController.filterTasks);
SystemuserRouter.post("/leads/tasks/complete", leadTaskController.completeTask);
SystemuserRouter.post("/leads/tasks/delete", leadTaskController.softDeleteTask);
SystemuserRouter.post("/leads/tasks/soft-delete", leadTaskController.softDeleteTask);
SystemuserRouter.post("/leads/task/delete", leadTaskController.softDeleteTask);
SystemuserRouter.post("/leads/task/soft-delete", leadTaskController.softDeleteTask);

/* -------------------- Lead Documents -------------------- */
SystemuserRouter.post("/leads/documents/list", leadDocumentController.listDocuments);
SystemuserRouter.post("/leads/documents/upload", uploadFile.single("file"), leadDocumentController.uploadDocument);
SystemuserRouter.post("/leads/bulk/upload", uploadFile.single("file"), leadController.bulkUploadFromFile);
SystemuserRouter.post("/leads/documents/download", leadDocumentController.getDocumentUrl);
SystemuserRouter.post("/leads/documents/delete", leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/documents/soft-delete", leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/document/delete", leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/document/soft-delete", leadDocumentController.softDeleteDocument);
SystemuserRouter.post("/leads/document/notes", leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/notes", leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/update/notes", leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/edit", leadDocumentController.updateDocumentNotes);
SystemuserRouter.post("/leads/documents/get", leadDocumentController.getDocument);
SystemuserRouter.post("/leads/documents/filter", leadDocumentController.filterDocuments);
SystemuserRouter.post("/leads/documents/geturl", leadDocumentController.getDocumentUrl);

/* -------------------- Lead Medicines / Order Items -------------------- */
SystemuserRouter.post("/leads/medicines/save", leadOrderController.saveLeadMedicines);
SystemuserRouter.post("/leads/medicines/list", leadOrderController.listLeadMedicines);
SystemuserRouter.post("/leads/medicines/delete", leadOrderController.deleteLeadMedicine);
SystemuserRouter.get("/leads/medicines/suggestions", leadOrderController.getMedicineSuggestions);

/* -------------------- Lead Orders -------------------- */
SystemuserRouter.post("/leads/orders/save", leadOrderController.saveLeadOrder);
SystemuserRouter.post("/leads/orders/list", leadOrderController.listLeadOrders);
SystemuserRouter.post("/leads/orders/delete", leadOrderController.deleteLeadOrder);
SystemuserRouter.post("/leads/orders/update-status", leadOrderController.updateLeadOrderStatus);

/* -------------------- Dashboards -------------------- */
SystemuserRouter.post("/leads/task/agent/dashboard", agentDashboardController.getAgentTasksDashboard);
SystemuserRouter.post("/leads/admin/dashboard", adminDashboardController.getAdminDashboard);
SystemuserRouter.get("/leads/search/dashboard", agentDashboardController.searchLeadsForDashboard);

/* -------------------- Reports & Analytics -------------------- */
SystemuserRouter.post("/reports/kpi", reportController.getKpiAnalytics);
SystemuserRouter.get("/reports/kpi", reportController.getKpiAnalytics);

/* -------------------- Master Medicine Catalog -------------------- */
SystemuserRouter.post("/medicines", masterMedicineController.createMedicine);
SystemuserRouter.get("/medicines", masterMedicineController.getAllMedicines);
SystemuserRouter.get("/medicines/:id", masterMedicineController.getMedicineById);
SystemuserRouter.put("/medicines/:id", masterMedicineController.updateMedicine);
SystemuserRouter.delete("/medicines/:id", masterMedicineController.deleteMedicine);

/* -------------------- Lead Sources -------------------- */
SystemuserRouter.post("/lead-sources", leadSourceController.createLeadSource);
SystemuserRouter.post("/lead-sources/create", leadSourceController.createLeadSource);
SystemuserRouter.get("/lead-sources", leadSourceController.getAllLeadSources);
SystemuserRouter.get("/lead-sources/search", leadSourceController.searchLeadSources);
SystemuserRouter.get("/lead-sources/:id", leadSourceController.getLeadSourceById);
SystemuserRouter.put("/lead-sources/:id", leadSourceController.updateLeadSource);
SystemuserRouter.post("/lead-sources/edit", leadSourceController.updateLeadSource);
SystemuserRouter.delete("/lead-sources/:id", leadSourceController.deleteLeadSource);
SystemuserRouter.post("/lead-sources/delete", leadSourceController.deleteLeadSource);

/* -------------------- Campaigns -------------------- */
SystemuserRouter.post("/campaigns", campaignController.createCampaign);
SystemuserRouter.post("/campaigns/create", campaignController.createCampaign);
SystemuserRouter.get("/campaigns", campaignController.getAllCampaigns);
SystemuserRouter.get("/campaigns/search", campaignController.searchCampaigns);
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
