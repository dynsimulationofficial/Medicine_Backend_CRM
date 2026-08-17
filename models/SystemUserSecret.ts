import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface SystemUserSecretAttrs {
  id: string;
  user_id: string;
  secret_key: string;
  description?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

type SystemUserSecretCreation = Optional<
  SystemUserSecretAttrs,
  "id" | "description" | "created_at" | "updated_at"
>;

export const initSystemUserSecretModel = (sequelize: Sequelize) => {
  class SystemUserSecret
    extends Model<SystemUserSecretAttrs, SystemUserSecretCreation>
    implements SystemUserSecretAttrs {
    public id!: string;
    public user_id!: string;
    public secret_key!: string;
    public description!: string | null;
    public created_at!: Date;
    public updated_at!: Date;
  }

  SystemUserSecret.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      user_id: { type: DataTypes.UUID, allowNull: false },
      secret_key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      description: { type: DataTypes.STRING(255), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      tableName: "system_user_secret",
      schema: "public",
      timestamps: false,
    }
  );

  return SystemUserSecret;
};
