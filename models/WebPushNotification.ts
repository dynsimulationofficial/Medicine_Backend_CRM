// models/web_push_notifications.model.ts
import { DataTypes, Sequelize } from "sequelize";

export default function initWebPushNotificationModel(sequelize: Sequelize) {
  return sequelize.define(
    "web_push_notifications",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      type: {
        type: DataTypes.STRING, // e.g., 'lead_created', 'bulk_upload_summary'
        allowNull: false,
      },
      ref_id: {
        type: DataTypes.UUID,
        allowNull: true, // lead id for lead_created, etc.
      },
      recipient_user_id: {
        type: DataTypes.UUID,
        allowNull: true, // if you target a single user (optional)
      },
      fcmtoken: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      data: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      // Use STRING for simpler sync (avoid ENUM migrations)
      status: {
        type: DataTypes.STRING, // 'pending' | 'sent' | 'failed'
        allowNull: false,
        defaultValue: "pending",
      },
      message_id: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      schema: "public",
      tableName: "web_push_notifications",
      timestamps: false,
      freezeTableName: true,
      indexes: [
        { fields: ["ref_id"] },
        // NOTE: Only enable this after the column surely exists in DB:
        // { fields: ["recipient_user_id"] },
        { fields: ["status"] },
      ],
    }
  );
}
