import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface AssignedLeadNotificationAttrs {
  id: string;
  recipient_user_id: string;
  title: string;
  body: string;
  data?: object | null;
  created_at?: Date;
  updated_at?: Date;
}

type AssignedLeadNotificationCreation = Optional<
  AssignedLeadNotificationAttrs,
  "id" | "data" | "created_at" | "updated_at"
>;

export const initAssignedLeadNotificationModel = (sequelize: Sequelize) => {
  class AssignedLeadNotification
    extends Model<AssignedLeadNotificationAttrs, AssignedLeadNotificationCreation>
    implements AssignedLeadNotificationAttrs {
    public id!: string;
    public recipient_user_id!: string;
    public title!: string;
    public body!: string;
    public data!: object | null;
    public created_at!: Date;
    public updated_at!: Date;
  }

  AssignedLeadNotification.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      recipient_user_id: { type: DataTypes.UUID, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      body: { type: DataTypes.STRING(255), allowNull: false },
      data: { type: DataTypes.JSONB, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      tableName: "assigned_lead_notifications",
      schema: "public",
      timestamps: false,
    }
  );

  return AssignedLeadNotification;
};
