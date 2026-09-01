// src/database/sync.ts
import { Sequelize, Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import db from "../models";

const { Role, Permission, RolePermission, LeadDisposition, LeadSource } = db;

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

async function ensureMedicineColumns(sequelize: Sequelize) {
  await sequelize.query(`
    ALTER TABLE public.leads
      ADD COLUMN IF NOT EXISTS currency varchar(10) NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS lead_status varchar(50) NULL DEFAULT 'New';
  `);
}

async function ensureTrackingLogsTable(sequelize: Sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS public.order_tracking_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES public.lead_orders(id) ON DELETE CASCADE,
      tracking_number VARCHAR(100) NOT NULL,
      courier_name VARCHAR(100) NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'In_Transit',
      sub_status VARCHAR(100) NULL,
      location VARCHAR(255) NULL,
      details TEXT NULL,
      checkpoint_time TIMESTAMP WITH TIME ZONE NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tracking_order_id ON public.order_tracking_logs(order_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_number ON public.order_tracking_logs(tracking_number);
  `);
}

export async function syncDatabase(sequelize: Sequelize) {
  try {
    console.log("🔄 Syncing database...");

    // 1) Ensure required sequences exist for model defaults
    await ensureSequencesExist(sequelize);

    // 2) Sync models (creates missing tables)
    await sequelize.sync();

    // 3) Ensure new columns/index/FK exist for system_users and leads
    await ensureSystemUsersBlockColumns(sequelize);
    await ensureMedicineColumns(sequelize);
    await ensureTrackingLogsTable(sequelize);

    console.log("✅ Tables are in sync");

    // 4) Seed fixed data
    await seedInitialData();
  } catch (error) {
    console.error("❌ Database sync failed:", error);
    throw error;
  }
}
