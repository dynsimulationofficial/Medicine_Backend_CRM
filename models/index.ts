// models/index.ts
import { Sequelize } from "sequelize";
import DBServices from "../database/DBService";

// Auth & User Models
import RoleModel from "./Role";
import PermissionModel from "./Permission";
import RolePermissionModel from "./RolePermission";
import SystemUserModel from "./SystemUser";
import initUserRoleModel from "./UserRole";
import initUserOtpModel from "./UserOtp";
import initUserLoginModel from "./UserLogin";
import initSystemUserActivityModel from "./UserActivity";
import { initSystemUserSecretModel } from "./SystemUserSecret";

// Lead & Core Business Models
import { initLeadModel } from "./Lead";
import { initLeadSourceModel } from "./LeadSource";
import { initCampaignModel } from "./Campaign";
import { initLeadDispositionModel } from "./LeadDisposition";
import { initLeadActivityHistoryModel } from "./LeadActivityHistory";
import { initLeadTaskModel } from "./LeadTask";
import { initLeadDocumentModel } from "./LeadDocument";
import { initLeadBulkDocumentModel } from "./LeadBulkDocument";

// Medicine & Order Management Models
import { initMasterMedicineModel } from "./MasterMedicine";
import { initLeadMedicineModel } from "./LeadMedicine";
import { initLeadOrderModel } from "./LeadOrder";
import { initLeadOrderItemModel } from "./LeadOrderItem";
import { initOrderTrackingLogModel } from "./OrderTrackingLog";

// In-App Notifications
import { initAssignedLeadNotificationModel } from "./AssignedLeadNotification";

// DB Connection
const dbService = new DBServices();
const sequelize: Sequelize = dbService.sequelizeWriter;

/* =========================================================================
   1. Initialize Models
========================================================================= */
const Role = RoleModel(sequelize);
const Permission = PermissionModel(sequelize);
const RolePermission = RolePermissionModel(sequelize);
const SystemUser = SystemUserModel(sequelize);
const UserRole = initUserRoleModel(sequelize);
const UserOtp = initUserOtpModel(sequelize);
const UserLogin = initUserLoginModel(sequelize);
const SystemUserActivity = initSystemUserActivityModel(sequelize);
const SystemUserSecret = initSystemUserSecretModel(sequelize);

const Lead = initLeadModel(sequelize);
const LeadSource = initLeadSourceModel(sequelize);
const Campaign = initCampaignModel(sequelize);
const LeadDisposition = initLeadDispositionModel(sequelize);
const LeadActivityHistory = initLeadActivityHistoryModel(sequelize);
const LeadTask = initLeadTaskModel(sequelize);
const LeadDocument = initLeadDocumentModel(sequelize);
const LeadBulkDocument = initLeadBulkDocumentModel(sequelize);

const MasterMedicine = initMasterMedicineModel(sequelize);
const LeadMedicine = initLeadMedicineModel(sequelize);
const LeadOrder = initLeadOrderModel(sequelize);
const LeadOrderItem = initLeadOrderItemModel(sequelize);
const OrderTrackingLog = initOrderTrackingLogModel(sequelize);

const AssignedLeadNotification = initAssignedLeadNotificationModel(sequelize);

/* =========================================================================
   2. Define Associations
========================================================================= */

/* -------------------------------------------------------------------------
   A. ROLES & PERMISSIONS ASSOCIATIONS (START)
------------------------------------------------------------------------- */
Role.belongsToMany(Permission, {
  through: RolePermission,
  foreignKey: { name: "role_id", allowNull: false },
  otherKey: { name: "permission_id", allowNull: false },
  as: "permissions",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Permission.belongsToMany(Role, {
  through: RolePermission,
  foreignKey: { name: "permission_id", allowNull: false },
  otherKey: { name: "role_id", allowNull: false },
  as: "roles",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

Role.hasMany(RolePermission, {
  foreignKey: { name: "role_id", allowNull: false },
  as: "rolePermissions",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
RolePermission.belongsTo(Role, {
  foreignKey: { name: "role_id", allowNull: false },
  as: "role",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

Permission.hasMany(RolePermission, {
  foreignKey: { name: "permission_id", allowNull: false },
  as: "rolePermissions",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
RolePermission.belongsTo(Permission, {
  foreignKey: { name: "permission_id", allowNull: false },
  as: "permission",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

SystemUser.belongsToMany(Role, {
  through: UserRole,
  foreignKey: { name: "system_user_id", allowNull: false },
  otherKey: { name: "role_id", allowNull: false },
  as: "roles",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Role.belongsToMany(SystemUser, {
  through: UserRole,
  foreignKey: { name: "role_id", allowNull: false },
  otherKey: { name: "system_user_id", allowNull: false },
  as: "users",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

SystemUser.hasMany(UserRole, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "userRoles",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
UserRole.belongsTo(SystemUser, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "user",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

Role.hasMany(UserRole, {
  foreignKey: { name: "role_id", allowNull: false },
  as: "userRoles",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
UserRole.belongsTo(Role, {
  foreignKey: { name: "role_id", allowNull: false },
  as: "role",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
/* -------------------- END ROLES & PERMISSIONS --------------------------- */

/* -------------------------------------------------------------------------
   B. USER AUTH & SECRETS ASSOCIATIONS (START)
------------------------------------------------------------------------- */
SystemUser.hasOne(SystemUserSecret, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "secret",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
SystemUserSecret.belongsTo(SystemUser, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "user",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

SystemUser.hasMany(UserOtp, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "otps",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
UserOtp.belongsTo(SystemUser, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "user",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

SystemUser.hasMany(UserLogin, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "logins",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
UserLogin.belongsTo(SystemUser, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "user",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

SystemUser.hasMany(SystemUserActivity, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "activities",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
SystemUserActivity.belongsTo(SystemUser, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "user",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
/* -------------------- END USER AUTH & SECRETS --------------------------- */

/* -------------------------------------------------------------------------
   C. LEAD CORE ASSOCIATIONS (START)
------------------------------------------------------------------------- */
// Lead <-> Lead Source
Lead.belongsTo(LeadSource, {
  foreignKey: { name: "lead_source_id", allowNull: true },
  as: "leadSource",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
LeadSource.hasMany(Lead, {
  foreignKey: { name: "lead_source_id", allowNull: true },
  as: "leads",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

// Lead <-> Campaign
Lead.belongsTo(Campaign, {
  foreignKey: { name: "campaign_id", allowNull: true },
  as: "campaign",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
Campaign.hasMany(Lead, {
  foreignKey: { name: "campaign_id", allowNull: true },
  as: "leads",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

// Lead <-> Agent (SystemUser)
Lead.belongsTo(SystemUser, {
  foreignKey: { name: "agent_id", allowNull: true },
  as: "agent",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
SystemUser.hasMany(Lead, {
  foreignKey: { name: "agent_id", allowNull: true },
  as: "assignedLeads",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
/* -------------------- END LEAD CORE ------------------------------------- */

/* -------------------------------------------------------------------------
   D. CAMPAIGN & LEAD SOURCE ASSOCIATIONS (START)
------------------------------------------------------------------------- */
// Campaign <-> Lead Source
Campaign.belongsTo(LeadSource, {
  foreignKey: { name: "lead_source_id", allowNull: true },
  as: "leadSource",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
LeadSource.hasMany(Campaign, {
  foreignKey: { name: "lead_source_id", allowNull: true },
  as: "campaigns",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
/* -------------------- END CAMPAIGN & LEAD SOURCE ------------------------ */


Lead.hasMany(LeadTask, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "tasks",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LeadTask.belongsTo(Lead, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "lead",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

Lead.hasMany(LeadDocument, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "documents",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LeadDocument.belongsTo(Lead, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "lead",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
/* -------------------- END LEAD CORE ------------------------------------- */

/* -------------------------------------------------------------------------
   D. MEDICINE & ORDER MANAGEMENT ASSOCIATIONS (START)
------------------------------------------------------------------------- */
Lead.hasMany(LeadMedicine, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "medicines",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LeadMedicine.belongsTo(Lead, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "lead",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

Lead.hasMany(LeadOrder, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "orders",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LeadOrder.belongsTo(Lead, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "lead",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

LeadOrder.hasMany(LeadOrderItem, {
  foreignKey: { name: "order_id", allowNull: false },
  as: "items",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LeadOrderItem.belongsTo(LeadOrder, {
  foreignKey: { name: "order_id", allowNull: false },
  as: "order",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

LeadOrder.hasMany(OrderTrackingLog, {
  foreignKey: { name: "order_id", allowNull: false },
  as: "trackingLogs",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
OrderTrackingLog.belongsTo(LeadOrder, {
  foreignKey: { name: "order_id", allowNull: false },
  as: "order",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
/* -------------------- END MEDICINE & ORDER MANAGEMENT ------------------- */

/* -------------------------------------------------------------------------
   E. LEAD ACTIVITY HISTORY & DISPOSITIONS ASSOCIATIONS
------------------------------------------------------------------------- */

// 1. Lead Activity History <-> Lead Association (lead_id)
LeadActivityHistory.belongsTo(Lead, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "lead",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Lead.hasMany(LeadActivityHistory, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "activities",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

// 2. Lead Activity History <-> System User / Agent Association (agent_id)
LeadActivityHistory.belongsTo(SystemUser, {
  foreignKey: { name: "agent_id", allowNull: true },
  as: "agent",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
SystemUser.hasMany(LeadActivityHistory, {
  foreignKey: { name: "agent_id", allowNull: true },
  as: "leadActivities",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

// 3. Lead Activity History <-> Lead Disposition Association (disposition_id)
LeadActivityHistory.belongsTo(LeadDisposition, {
  foreignKey: { name: "disposition_id", allowNull: false },
  as: "disposition",
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});
LeadDisposition.hasMany(LeadActivityHistory, {
  foreignKey: { name: "disposition_id", allowNull: false },
  as: "activities",
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/* -------------------------------------------------------------------------
   F. TASKS, DOCUMENTS & UPLOADS ASSOCIATIONS
------------------------------------------------------------------------- */

LeadTask.belongsTo(SystemUser, {
  foreignKey: { name: "assigned_agent_id", allowNull: false },
  as: "assignedAgent",
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});
SystemUser.hasMany(LeadTask, {
  foreignKey: { name: "assigned_agent_id", allowNull: false },
  as: "assignedTasks",
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

LeadDocument.belongsTo(SystemUser, {
  foreignKey: { name: "uploaded_by", allowNull: true },
  as: "uploader",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
SystemUser.hasMany(LeadDocument, {
  foreignKey: { name: "uploaded_by", allowNull: true },
  as: "uploadedDocuments",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
/* -------------------- END TASKS, ACTIVITIES & UPLOADS --------------------- */

/* =========================================================================
   3. Centralized Exports
========================================================================= */
const db = {
  sequelize,
  Sequelize,
  Role,
  Permission,
  RolePermission,
  SystemUser,
  SystemUserActivity,
  UserRole,
  Lead,
  LeadDisposition,
  LeadActivityHistory,
  LeadTask,
  LeadDocument,
  LeadSource,
  Campaign,
  MasterMedicine,
  LeadMedicine,
  LeadOrder,
  LeadOrderItem,
  OrderTrackingLog,
  UserLogin,
  UserOtp,
  AssignedLeadNotification,
  SystemUserSecret,
  LeadBulkDocument,
};

export default db;


