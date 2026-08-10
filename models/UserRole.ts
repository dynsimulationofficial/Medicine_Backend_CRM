// models/UserRole.ts
import { DataTypes, Sequelize, Model } from "sequelize";

export default (sequelize: Sequelize) => {
  class UserRole extends Model {
    public system_user_id!: string;
    public role_id!: string;
    public readonly created_at!: Date;
    public readonly updated_at!: Date;
  }

  UserRole.init(
    {
      system_user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: { schema: "public", tableName: "system_users" }, key: "id" },
      },
      role_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: { schema: "public", tableName: "roles" }, key: "id" },
      },
      created_at: { type: DataTypes.DATE, allowNull: true },
      updated_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      schema: "public",
      tableName: "user_role",
      freezeTableName: true,
      timestamps: true,             // keep created_at / updated_at maintained by Sequelize
      underscored: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      paranoid: false,              // NEVER paranoid on join tables
      indexes: [
        { fields: ["system_user_id"] },
        { fields: ["role_id"] },
      ],
    }
  );

  return UserRole;
};
