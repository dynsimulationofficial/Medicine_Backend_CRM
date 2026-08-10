// models/web_push_tokens.model.ts
import { DataTypes, Sequelize } from "sequelize";

export default function initWebPushTokenModel(sequelize: Sequelize) {
  return sequelize.define(
    "web_push_tokens",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      system_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      fcmtoken: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      schema: "public",
      tableName: "web_push_tokens",
      timestamps: false,
      freezeTableName: true,
      indexes: [{ fields: ["system_user_id"] }, { fields: ["is_active"] }],
    }
  );
}
