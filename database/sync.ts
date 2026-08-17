// src/database/sync.ts
import { Sequelize, Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  Role,
  Permission,
  RolePermission,
  LeadDisposition,
  LeadSource,
  LeadDebtStatus,
  ConsolidatedCreditStatus,
} from "../models";

/**
 * Make sure block columns/index/foreign key exist on system_users
 * Run this BEFORE sequelize.sync()
 */
async function ensureSystemUsersBlockColumns(sequelize: Sequelize) {
  // add columns (idempotent)
  await sequelize.query(`
    ALTER TABLE public.system_users
      ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS blocked_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS blocked_by uuid NULL,
      ADD COLUMN IF NOT EXISTS block_reason text NULL;
  `);

  // add FK if missing
  await sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'system_users_blocked_by_fkey'
      ) THEN
        ALTER TABLE public.system_users
          ADD CONSTRAINT system_users_blocked_by_fkey
          FOREIGN KEY (blocked_by)
          REFERENCES public.system_users(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // add index if missing
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS system_users_is_blocked
    ON public.system_users (is_blocked);
  `);
}

export async function seedInitialData() {
  try {
    console.log("✅ Starting seed data...");

    // --- ROLES ---
    const roles = [
      { id: "2a673caa-1dc9-41c2-90f4-154b16f2cb99", name: "Admin", level: 1 },
      { id: "dc5d4739-fd95-4aa3-8b33-983f9be2e09b", name: "Agent", level: 2 },
    ];
    // Upsert to preserve UUIDs
    for (const r of roles) await Role.upsert(r);
    console.log("✅ Roles seeded");

    // --- PERMISSIONS ---
    const PERMISSION_IDS = {
      CREATE_USER: "a6aabad4-306d-4010-bab4-ef774e1d6e7c",
      DELETE_USER: "5ad8c3e4-e642-4209-82e2-b80db133775a",
      UPDATE_USER: "42dcc2b6-0202-4efb-9af0-d6590832d065",
      VIEW_USER: "0ad14199-1eb4-4895-b629-480c749ecff4",
      VIEW_LEADAGE: "d187bda5-4de9-40d4-ad4a-830445da14f0",
      VIEW_USER_ACTIVITY_ADMIN: "f76ae73d-6c53-4355-9c1b-3402eeb3a8f9",
    } as const;

    const permissions = [
      { id: PERMISSION_IDS.CREATE_USER, name: "create_user", description: "Can create user" },
      { id: PERMISSION_IDS.DELETE_USER, name: "delete_user", description: "Can delete user" },
      { id: PERMISSION_IDS.UPDATE_USER, name: "update_user", description: "Can update user" },
      { id: PERMISSION_IDS.VIEW_USER, name: "view_user", description: "Can view user" },
      { id: PERMISSION_IDS.VIEW_LEADAGE, name: "view_leadage", description: "Can view leadage" },
      { id: PERMISSION_IDS.VIEW_USER_ACTIVITY_ADMIN, name: "view_user_activity_admin", description: "Can view user activity for admin only" },
    ];

    await Permission.bulkCreate(permissions, { ignoreDuplicates: true });
    console.log("✅ Permissions seeded");

    // --- LEAD DISPOSITIONS ---
    const DISPOSITION_IDS = {
      PHONE_CONVERSATION: "fbc5af04-3f2c-41d1-8b65-7c65e84b95a1",
      EMAIL_CONVERSATION: "71a29c1b-84ac-4a39-a6dd-7f891f32de52",
      SMS_CONVERSATION: "14d40c0a-5189-49cc-8790-5c9a69e4c5b3",
      WHATSAPP_CONVERSATION: "0d9a2c0f-2b49-4666-8c89-89a9e093c777",
      LEFT_A_VOICE_MAIL: "b6e6c7df-9c4d-4737-9a42-0fba8c7a04d2",
      NO_ANSWER: "5cfec775-44db-4051-bf7b-b43839b0123a",
      BLANK_CALL: "9e2b8a76-d9ed-46c8-8a56-3de9fdaafc7f",
      VOICE_MAIL_FULL: "6f4a283f-3086-442d-b5fb-52c5f82c1c4e",
      VOICE_MAIL_NOT_SET: "ea8fddbc-83f0-4495-83d6-c68f12a7fd5e",
      OTHERS: "d7524d2d-57e6-48aa-bcb2-3506fee8a3b4",
    } as const;

    const leadDispositions = [
      { id: DISPOSITION_IDS.PHONE_CONVERSATION, name: "Phone Conversation", description: "Lead contacted via phone conversation", is_active: true },
      { id: DISPOSITION_IDS.EMAIL_CONVERSATION, name: "Email Conversation", description: "Lead contacted via email conversation", is_active: true },
      { id: DISPOSITION_IDS.SMS_CONVERSATION, name: "SMS Conversation", description: "Lead contacted via SMS", is_active: true },
      { id: DISPOSITION_IDS.WHATSAPP_CONVERSATION, name: "WhatsApp Conversation", description: "Lead contacted via WhatsApp", is_active: true },
      { id: DISPOSITION_IDS.LEFT_A_VOICE_MAIL, name: "Left A Voice Mail", description: "Agent left a voicemail for the lead", is_active: true },
      { id: DISPOSITION_IDS.NO_ANSWER, name: "No Answer", description: "Lead did not answer the call", is_active: true },
      { id: DISPOSITION_IDS.BLANK_CALL, name: "Blank Call", description: "Blank call encountered", is_active: true },
      { id: DISPOSITION_IDS.VOICE_MAIL_FULL, name: "Voice Mail Full", description: "Lead's voicemail box is full", is_active: true },
      { id: DISPOSITION_IDS.VOICE_MAIL_NOT_SET, name: "Voice Mail Not Set", description: "Lead has not set up voicemail", is_active: true },
      { id: DISPOSITION_IDS.OTHERS, name: "Others", description: "Other disposition", is_active: true },
    ];

    await LeadDisposition.bulkCreate(leadDispositions, { ignoreDuplicates: true });
    console.log("✅ Lead Dispositions seeded");

    // --- LEAD SOURCES ---
    const LEAD_SOURCE_IDS = {
      PARTNER_REFERRAL: "b471169f-072a-4875-9b69-d1f37cf62df1",
      VLOVE_PARTIAL_LEAD: "27efb81f-3d3c-46a6-872c-999af5b5603b",
      FACEBOOK_ADS: "50d07062-dcff-47ef-96cf-6612e58bfc95",
      GOOGLE_ADS: "d921c06f-88b5-4b60-8f2a-240745e4e163",
      REFERRAL: "7ed44459-0804-4829-a112-eb9ac98e5c01",
      WEBSITE: "3c032d1b-114e-452c-8c3f-f6e42cdb47a1",
      IMPORTED: "9a3c9de7-2760-468f-bcee-94c2b914399d",
      OTHER: "12216d83-70fe-4c26-9453-793592ef05ff",
    } as const;

    const leadSources = [
      { id: LEAD_SOURCE_IDS.PARTNER_REFERRAL, name: "Partner Referral" },
      { id: LEAD_SOURCE_IDS.VLOVE_PARTIAL_LEAD, name: "VLOVE Partial Lead" },
      { id: LEAD_SOURCE_IDS.FACEBOOK_ADS, name: "Facebook Ads" },
      { id: LEAD_SOURCE_IDS.GOOGLE_ADS, name: "Google Ads" },
      { id: LEAD_SOURCE_IDS.REFERRAL, name: "Referral" },
      { id: LEAD_SOURCE_IDS.WEBSITE, name: "Website" },
      { id: LEAD_SOURCE_IDS.IMPORTED, name: "Imported" },
      { id: LEAD_SOURCE_IDS.OTHER, name: "Other" },
    ];

    await LeadSource.bulkCreate(leadSources, { ignoreDuplicates: true });
    console.log("✅ Lead Sources seeded");

    // --- LEAD DEBT STATUSES ---
    const LEAD_DEBT_STATUS_IDS = {
      FRESH_LEAD: "8c0fa0d5-7df6-47fe-a35b-341d3338e43d",
      LIVE_LEAD: "3f1a9c2d-4b7e-45a1-b2c3-9d8f0a1b2c3d",
      NO_CONNECT: "bfbac94b-2495-458b-8979-909f5ee67b07",
      TASK_LEAD: "e87034f1-020b-4444-baf6-b953561d8452",
      NURTURE: "00beda01-d273-4a5d-97fc-99a7aa8d5bdf",
      CNQ_LOW_DEBTS: "2171d768-6de3-4a6b-9587-b517d8f054d6",
      CNQ_NO_DEBTS: "ed4fd108-e1de-4877-ae9f-df373b4cb6a2",
      NOT_INTERESTED: "d592c368-e2f6-4aff-8449-8b4a61d75800",
      AGREEMENT_SENT: "632485d5-2143-4386-8608-5102803b5284",
      SIGNED_AGREEMENT_RECEIVED: "dd8fa82a-837a-48ce-8751-a338f8676189",
      DOCUMENTS_PENDING: "f3eb2efc-c379-4039-982e-3c974d138cf2",
      DOCUMENTS_RECEIVED: "c021cd9c-96a9-4ccd-8931-dfa3409b34a6",
      PARTIAL_FEE_PAID: "6f556004-6a98-4168-a891-faf754210144",
      FULL_FEE_PAID: "f0618d10-6b66-49c8-8b19-2cbac5c4371d",
      PAD_SET: "5740a9a1-1cbb-40fc-bbf2-5d06e6202a2e",
      ADMIN_FEE_PENDING: "87b4d1ec-1930-454a-8a7a-cf7fd98ec4bb",
      NSF: "5f59b754-4fbc-4889-9401-3bb1903fb3cc",
      REFUND: "0839dbe6-587b-43b1-befb-b7a01a178b1c",
      WRONG_NUMBER: "ba365dbb-78b8-4c6a-a4b1-5f995514b3aa",
      CANCELLED_BTM: "ba365dbb-78b8-4c6a-a4b1-5f995514b3cd",
      CANCELLED_ATM: "ba365dbb-78b8-4c6a-a4b1-5f995514b3cb",
      CNQ_BK_CP: "e21f6f49-3b2d-4d9f-91c4-7a0e2a6b9e5f",
      DNC: "44aa658d-c384-4ca3-bd2c-667892ada66a",
      COMPLAINT_SENSITIVE: "f418aa6b-3dbb-42ee-81ad-86549331b711",
      AWAITING_DOCS: "22fd1078-7631-42cb-a0f6-4a60f53b662a",
      FINALIZATION_PENDING: "0662e0e2-a9ac-43ab-840d-11b075c87e8e",
      FINALIZED_AND_SENT: "786c1dad-bf3d-49fd-a7b5-8d4c374084b0",
      TRANSFERRED_TO_C3: "5de4a732-9419-49c2-8731-5f4f56cd7e94",
    } as const;

    const leadDebtStatuses = [
      { id: LEAD_DEBT_STATUS_IDS.FRESH_LEAD, name: "Fresh Lead", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.LIVE_LEAD, name: "Live Lead", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.NO_CONNECT, name: "No Connect", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.TASK_LEAD, name: "Task Lead", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.NURTURE, name: "Nurture", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.CNQ_LOW_DEBTS, name: "CNQ - Low Debts", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.CNQ_NO_DEBTS, name: "CNQ- No Debts", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.NOT_INTERESTED, name: "Not Interested", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.AGREEMENT_SENT, name: "Agreement Sent", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.SIGNED_AGREEMENT_RECEIVED, name: "Signed Agreement Received", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.DOCUMENTS_PENDING, name: "Documents Pending", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.DOCUMENTS_RECEIVED, name: "Documents Received", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.PARTIAL_FEE_PAID, name: "Partial Fee Paid", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.FULL_FEE_PAID, name: "Full Fee Paid", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.PAD_SET, name: "PAD Set", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.ADMIN_FEE_PENDING, name: "Admin Fee Pending", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.NSF, name: "NSF", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.REFUND, name: "Refund", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.WRONG_NUMBER, name: "Wrong Number", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.CNQ_BK_CP, name: "CNQ - BK/CP", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.CANCELLED_BTM, name: "Cancelled - BTM", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.CANCELLED_ATM, name: "Cancelled - ATM", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.DNC, name: "DNC", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.COMPLAINT_SENSITIVE, name: "Complaint Sensitive", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.AWAITING_DOCS, name: "Awaiting Docs", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.FINALIZATION_PENDING, name: "Finalization Pending", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.FINALIZED_AND_SENT, name: "Finalized and Sent", is_active: true },
      { id: LEAD_DEBT_STATUS_IDS.TRANSFERRED_TO_C3, name: "Transferred To C3", is_active: true },
    ];

    await LeadDebtStatus.bulkCreate(leadDebtStatuses, { ignoreDuplicates: true });
    console.log("✅ Lead Debt Statuses seeded");

    // --- CONSOLIDATED CREDIT STATUSES ---
    const CONSOLIDATED_STATUS_IDS = {
      CONVERTED_DMP: "9aa5f29b-b689-4e76-9e2d-63b0e5fa8d0f",
      CONVERTED_HEW: "af8c13e5-0c4e-47d8-a6ef-7cf6db87c5c1",
      DUPLICATE_DMP: "fd3b2e13-03a4-41ab-b231-6b3a8d8b49e3",
      DUPLICATE_HEW: "38a0e13d-09e2-48bb-a6f4-849a31b0d457",
      CBO_DMP: "f24b8b38-17e3-4d6d-8fa7-9a48f2e9e7f2",
      CBO_HEW: "5e0a8d91-72c5-45aa-94d2-3f540e62f19e",
      IN_PROCESS_DMP: "b08bdf7a-f3de-4d63-a351-f4dbcb487c8a",
      IN_PROCESS_HEW: "28a1fdb3-5861-4d5d-bb84-0c4c2fa3a511",
    } as const;

    const consolidatedStatuses = [
      { id: CONSOLIDATED_STATUS_IDS.CONVERTED_DMP, name: "Converted - DMP" },
      { id: CONSOLIDATED_STATUS_IDS.CONVERTED_HEW, name: "Converted - HEW" },
      { id: CONSOLIDATED_STATUS_IDS.DUPLICATE_DMP, name: "Duplicate - DMP" },
      { id: CONSOLIDATED_STATUS_IDS.DUPLICATE_HEW, name: "Duplicate - HEW" },
      { id: CONSOLIDATED_STATUS_IDS.CBO_DMP, name: "CBO - DMP" },
      { id: CONSOLIDATED_STATUS_IDS.CBO_HEW, name: "CBO - HEW" },
      { id: CONSOLIDATED_STATUS_IDS.IN_PROCESS_DMP, name: "In Process - DMP" },
      { id: CONSOLIDATED_STATUS_IDS.IN_PROCESS_HEW, name: "In Process - HEW" },
    ];
    await ConsolidatedCreditStatus.bulkCreate(consolidatedStatuses, { ignoreDuplicates: true });
    console.log("✅ Consolidated Credit Statuses seeded");

    // --- ROLE PERMISSIONS ---
    const rolePermissions: { role_id: string; permission_id: string }[] = [];

    const adminRole = await Role.findOne({ where: { name: "Admin" } });
    const agentRole = await Role.findOne({ where: { name: "Agent" } });
    const allPermissions = await Permission.findAll();

    if (adminRole && allPermissions.length > 0) {
      allPermissions.forEach((p) => {
        rolePermissions.push({ role_id: adminRole.id, permission_id: p.id });
      });
    }

    if (agentRole) {
      // ✅ use Op.in for Sequelize v6
      const agentPerms = await Permission.findAll({
        where: { name: { [Op.in]: ["create_user", "update_user", "view_user"] } },
      });
      agentPerms.forEach((p) => {
        rolePermissions.push({ role_id: agentRole.id, permission_id: p.id });
      });
    }

    await RolePermission.bulkCreate(rolePermissions, { ignoreDuplicates: true });
    console.log("✅ Role-Permissions seeded");

    console.log("🎉 Seed complete!");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    throw error;
  }
}

async function ensureSequencesExist(sequelize: Sequelize) {
  await sequelize.query(`CREATE SEQUENCE IF NOT EXISTS lead_number_seq START 1;`);
}

export async function syncDatabase(sequelize: Sequelize) {
  try {
    console.log("🔄 Syncing database...");

    // 1) Ensure required sequences exist for model defaults
    await ensureSequencesExist(sequelize);

    // 2) Sync models (creates missing tables)
    await sequelize.sync();

    // 3) Ensure new columns/index/FK exist for system_users
    await ensureSystemUsersBlockColumns(sequelize);

    console.log("✅ Tables are in sync");

    // 4) Seed fixed data
    await seedInitialData();
  } catch (error) {
    console.error("❌ Database sync failed:", error);
    throw error;
  }
}
