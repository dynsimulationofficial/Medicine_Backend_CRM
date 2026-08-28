// models/index.ts
import { Sequelize } from "sequelize";
import DBServices from "../database/DBService";

import RoleModel from "./Role";
import PermissionModel from "./Permission";
import RolePermissionModel from "./RolePermission";
import SystemUserModel from "./SystemUser";
import initUserOtpModel from "./UserOtp";

import initWebPushNotificationModel from "./WebPushNotification";
import initWebPushTokenModel from "./WebPushToken";

import initSystemUserActivityModel from "./UserActivity";
import initUserRoleModel from "./UserRole";

import { initLeadModel } from "./Lead";
import { initLeadDispositionModel } from "./LeadDisposition";
import { initLeadActivityHistoryModel } from "./LeadActivityHistory";
import { initLeadTaskModel } from "./LeadTask";
import { initLeadDocumentModel } from "./LeadDocument";
import { initConsolidatedCreditStatusModel } from "./ConsolidatedCreditStatus";
import { initLeadSourceModel } from "./LeadSource";
import { initLeadDebtStatusModel } from "./LeadDebtStatus";
import initUserLoginModel from "./UserLogin";
import { initAssignedLeadNotificationModel } from "./AssignedLeadNotification";
import { initExpenseModel } from "./Expense";
import { initSystemUserSecretModel } from "./SystemUserSecret";
import { initLeadBulkDocumentModel } from "./LeadBulkDocument";
import { initLeadMedicineModel } from "./LeadMedicine";
import { initLeadOrderModel } from "./LeadOrder";
import { initLeadOrderItemModel } from "./LeadOrderItem";
import { initOrderTrackingLogModel } from "./OrderTrackingLog";

const dbService = new DBServices();
const sequelize: Sequelize = dbService.sequelizeWriter;

/* ------------- Init models ------------- */
const Role = RoleModel(sequelize);
const Permission = PermissionModel(sequelize);
const RolePermission = RolePermissionModel(sequelize);
const UserOtp = initUserOtpModel(sequelize);
const SystemUser = SystemUserModel(sequelize);

const SystemUserActivity = initSystemUserActivityModel(sequelize);
const UserRole = initUserRoleModel(sequelize);

const Lead = initLeadModel(sequelize);
const ConsolidatedCreditStatus = initConsolidatedCreditStatusModel(sequelize);
const LeadDisposition = initLeadDispositionModel(sequelize);
const LeadActivityHistory = initLeadActivityHistoryModel(sequelize);
const LeadTask = initLeadTaskModel(sequelize);
const LeadDocument = initLeadDocumentModel(sequelize);
const LeadMedicine = initLeadMedicineModel(sequelize);
const LeadOrder = initLeadOrderModel(sequelize);
const LeadOrderItem = initLeadOrderItemModel(sequelize);
const OrderTrackingLog = initOrderTrackingLogModel(sequelize);

const WebPushToken = initWebPushTokenModel(sequelize);
const WebPushNotification = initWebPushNotificationModel(sequelize);

const LeadSource = initLeadSourceModel(sequelize);
const LeadDebtStatus = initLeadDebtStatusModel(sequelize);

const UserLogin = initUserLoginModel(sequelize);

const AssignedLeadNotification = initAssignedLeadNotificationModel(sequelize);
const Expense = initExpenseModel(sequelize);
const SystemUserSecret = initSystemUserSecretModel(sequelize);
const LeadBulkDocument = initLeadBulkDocumentModel(sequelize);

/* ------------- Associations ------------- */

// Role ↔ Permission
Role.belongsToMany(Permission, {
  through: RolePermission,
  foreignKey: { name: "role_id", allowNull: false },
  otherKey: { name: "permission_id", allowNull: false },
  as: "permissions",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
  hooks: true,
  constraints: true,
});
Permission.belongsToMany(Role, {
  through: RolePermission,
  foreignKey: { name: "permission_id", allowNull: false },
  otherKey: { name: "role_id", allowNull: false },
  as: "roles",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
  hooks: true,
  constraints: true,
});

// SystemUser ↔ Role (via user_role)
SystemUser.belongsToMany(Role, {
  through: UserRole,
  foreignKey: { name: "system_user_id", allowNull: false },
  otherKey: { name: "role_id", allowNull: false },
  as: "roles",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
  hooks: true,
  constraints: true,
});
Role.belongsToMany(SystemUser, {
  through: UserRole,
  foreignKey: { name: "role_id", allowNull: false },
  otherKey: { name: "system_user_id", allowNull: false },
  as: "users",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
  hooks: true,
  constraints: true,
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

// Lead ↔ Agent
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

// Lead ↔ LeadSource
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

// Lead ↔ LeadDebtStatus



// Lead ↔ ConsolidatedCreditStatus
Lead.belongsTo(ConsolidatedCreditStatus, {
  foreignKey: { name: "consolidated_credit_status_id", allowNull: true },
  as: "consolidatedCreditStatus",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
ConsolidatedCreditStatus.hasMany(Lead, {
  foreignKey: { name: "consolidated_credit_status_id", allowNull: true },
  as: "leads",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

// Lead activity history
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

// Lead tasks
LeadTask.belongsTo(Lead, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "lead",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Lead.hasMany(LeadTask, {
  foreignKey: { name: "lead_id", allowNull: false },
  as: "tasks",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
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

// Lead documents
LeadDocument.belongsTo(Lead, {
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

// OTP / Logins
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

/* ------------- Exports ------------- */
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
  ConsolidatedCreditStatus,
  LeadActivityHistory,
  LeadTask,
  LeadDocument,
  LeadSource,
  LeadDebtStatus,
  UserLogin,
  UserOtp,
  WebPushNotification,
  WebPushToken,
  AssignedLeadNotification,
  Expense,
  SystemUserSecret,
  LeadBulkDocument,
  LeadMedicine,
  LeadOrder,
  LeadOrderItem,
  OrderTrackingLog,
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
  ConsolidatedCreditStatus,
  WebPushNotification,
  LeadDisposition,
  LeadActivityHistory,
  LeadTask,
  LeadDocument,
  LeadMedicine,
  LeadOrder,
  LeadOrderItem,
  OrderTrackingLog,
  LeadSource,
  LeadDebtStatus,
  UserLogin,
  UserOtp,
  WebPushToken,
  AssignedLeadNotification,
  Expense,
  SystemUserSecret,
  LeadBulkDocument,
};
