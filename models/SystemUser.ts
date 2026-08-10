import { DataTypes, Sequelize, Model, Optional, Association } from "sequelize";

export interface SystemUserAttributes {
  id: string;
  name: string;
  email: string;
  mobile_number: string;
  password: string;

  // timestamps / soft delete
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;

  // blocking
  is_blocked: boolean;
  blocked_at?: Date | null;
  blocked_by?: string | null;
  block_reason?: string | null;
}

export type SystemUserCreationAttributes = Optional<
  SystemUserAttributes,
  | "id"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "is_blocked"
  | "blocked_at"
  | "blocked_by"
  | "block_reason"
>;

export default (sequelize: Sequelize) => {
  class SystemUser
    extends Model<SystemUserAttributes, SystemUserCreationAttributes>
    implements SystemUserAttributes
  {
    public id!: string;
    public name!: string;
    public email!: string;
    public mobile_number!: string;
    public password!: string;

    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;

    public is_blocked!: boolean;
    public blocked_at!: Date | null;
    public blocked_by!: string | null;
    public block_reason!: string | null;

    // self-association (who blocked this user)
    public static associations: {
      blockedByUser: Association<SystemUser, SystemUser>;
    };
  }

  SystemUser.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false },
      mobile_number: { type: DataTypes.STRING, allowNull: false },
      password: { type: DataTypes.STRING, allowNull: false },

      // timestamps (snake_case)
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },

      // blocking fields
      is_blocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      blocked_at: { type: DataTypes.DATE, allowNull: true },
      blocked_by: { type: DataTypes.UUID, allowNull: true },
      block_reason: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      tableName: "system_users",

      // ✅ timestamps + soft delete in snake_case
      timestamps: true,
      underscored: true,
      paranoid: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      deletedAt: "deleted_at",

      defaultScope: {
        // paranoid already excludes soft-deleted
      },
      scopes: {
        withDeleted: { paranoid: false },
        onlyDeleted: {
          paranoid: false,
          where: sequelize.where(sequelize.col("deleted_at"), "IS NOT", null),
        },
        blocked: { where: { is_blocked: true } },
        active: { where: { is_blocked: false } },
      },

      indexes: [
        { fields: ["email"] },
        { fields: ["mobile_number"] },
        { fields: ["is_blocked"] },
      ],
    }
  );

  // self-FK association for blocked_by → system_users.id
  SystemUser.belongsTo(SystemUser, {
    as: "blockedByUser",
    foreignKey: "blocked_by",
    targetKey: "id",
    constraints: false, // FK is enforced at DB level; keep true if you want Sequelize to enforce
  });

  return SystemUser;
};
