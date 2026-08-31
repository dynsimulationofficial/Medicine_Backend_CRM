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
import { initLeadDispositionModel } from "./LeadDisposition";
import { initLeadActivityHistoryModel } from "./LeadActivityHistory";
import { initLeadTaskModel } from "./LeadTask";
import { initLeadDocumentModel } from "./LeadDocument";
import { initLeadBulkDocumentModel } from "./LeadBulkDocument";

// Medicine & Order Management Models
import { initLeadMedicineModel } from "./LeadMedicine";
import { initLeadOrderModel } from "./LeadOrder";
import { initLeadOrderItemModel } from "./LeadOrderItem";
import { initOrderTrackingLogModel } from "./OrderTrackingLog";

// Notifications & Utilities
import initWebPushNotificationModel from "./WebPushNotification";
import initWebPushTokenModel from "./WebPushToken";
import { initAssignedLeadNotificationModel } from "./AssignedLeadNotification";
import { initExpenseModel } from "./Expense";
import { initConsolidatedCreditStatusModel } from "./ConsolidatedCreditStatus";
import { initLeadDebtStatusModel } from "./LeadDebtStatus";

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
const LeadDisposition = initLeadDispositionModel(sequelize);
const LeadActivityHistory = initLeadActivityHistoryModel(sequelize);
const LeadTask = initLeadTaskModel(sequelize);
const LeadDocument = initLeadDocumentModel(sequelize);
const LeadBulkDocument = initLeadBulkDocumentModel(sequelize);

const LeadMedicine = initLeadMedicineModel(sequelize);
const LeadOrder = initLeadOrderModel(sequelize);
const LeadOrderItem = initLeadOrderItemModel(sequelize);
const OrderTrackingLog = initOrderTrackingLogModel(sequelize);

const WebPushToken = initWebPushTokenModel(sequelize);
const WebPushNotification = initWebPushNotificationModel(sequelize);
const AssignedLeadNotification = initAssignedLeadNotificationModel(sequelize);
const Expense = initExpenseModel(sequelize);
const ConsolidatedCreditStatus = initConsolidatedCreditStatusModel(sequelize);
const LeadDebtStatus = initLeadDebtStatusModel(sequelize);

/* =========================================================================
   2. Define Associations
========================================================================= */

/* -------------------------------------------------------------------------
   A. ROLES & PERMISSIONS ASSOCIATIONS (START)
------------------------------------------------------------------------- */
// Role ↔ Permission (Many-to-Many via role_permissions)
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

// SystemUser ↔ Role (Many-to-Many via user_roles)
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
/* -------------------- END ROLES & PERMISSIONS ----------------------------- */


/* -------------------------------------------------------------------------
   B. SYSTEM USER & AUTH ASSOCIATIONS (START)
------------------------------------------------------------------------- */
// SystemUser ↔ UserOtp
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

// SystemUser ↔ SystemUserActivity
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

// SystemUser ↔ UserLogin
SystemUser.hasMany(UserLogin, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "loginOtps",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
UserLogin.belongsTo(SystemUser, {
  foreignKey: { name: "system_user_id", allowNull: false },
  as: "user",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
/* -------------------- END SYSTEM USER & AUTH ------------------------------ */


/* -------------------------------------------------------------------------
   C. LEADS ASSOCIATIONS (START)
------------------------------------------------------------------------- */
// 1. Lead ↔ Agent (SystemUser)
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

// 2. Lead ↔ Marketing Source (LeadSource)
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

// 3. Lead ↔ Orders (LeadOrder)
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

// 4. Lead ↔ Call & Activity Logs (LeadActivityHistory)
Lead.hasMany(LeadActivityHistory, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "activities",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
LeadActivityHistory.belongsTo(Lead, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "lead",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

// 5. Lead ↔ Follow-up Tasks (LeadTask)
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

// 6. Lead ↔ Prescription & Documents (LeadDocument)
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
/* -------------------- END LEADS ASSOCIATIONS ------------------------------ */


/* -------------------------------------------------------------------------
   D. MEDICINE ORDERS & ITEMS ASSOCIATIONS (START)
------------------------------------------------------------------------- */
// LeadOrder ↔ LeadOrderItem
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
/* -------------------- END MEDICINE ORDERS & ITEMS ------------------------- */


/* -------------------------------------------------------------------------
   E. TASKS, ACTIVITIES & AGENT ASSIGNMENTS (START)
------------------------------------------------------------------------- */
// Activity Agent
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

// Activity Disposition
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

// Task Agent
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

// Document Uploader
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
  LeadMedicine,
  LeadOrder,
  LeadOrderItem,
  OrderTrackingLog,
  UserLogin,
  UserOtp,
  WebPushNotification,
  WebPushToken,
  AssignedLeadNotification,
  Expense,
  SystemUserSecret,
  LeadBulkDocument,
  ConsolidatedCreditStatus,
  LeadDebtStatus,
};

export default db;
export {
  dbService,
  sequelize,
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
  LeadMedicine,
  LeadOrder,
  LeadOrderItem,
  OrderTrackingLog,
  LeadSource,
  UserLogin,
  UserOtp,
  WebPushNotification,
  WebPushToken,
  AssignedLeadNotification,
  Expense,
  SystemUserSecret,
  LeadBulkDocument,
  ConsolidatedCreditStatus,
  LeadDebtStatus,
};
