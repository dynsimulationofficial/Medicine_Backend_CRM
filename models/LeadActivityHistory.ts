import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadActivityHistoryAttributes {
  id: string;
  lead_id: string;
  agent_id?: string | null;
  disposition_id: string;
  conversation: string;
  occurred_at: Date;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
  is_edited?: boolean;
}

export type LeadActivityHistoryCreationAttributes = Optional<
  LeadActivityHistoryAttributes,
  | "id"
  | "agent_id"
  | "occurred_at"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "is_edited"
>;

export const initLeadActivityHistoryModel = (sequelize: Sequelize) => {
  class LeadActivityHistory
    extends Model<
      LeadActivityHistoryAttributes,
      LeadActivityHistoryCreationAttributes
    >
    implements LeadActivityHistoryAttributes
  {
    public id!: string;
    public lead_id!: string;
    public agent_id!: string | null;
    public disposition_id!: string;
    public conversation!: string;
    public occurred_at!: Date;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
    public is_edited!: boolean;
  }

  LeadActivityHistory.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      lead_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      agent_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      disposition_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      conversation: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
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
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_edited: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      tableName: "lead_activity_history",
      schema: "public",
      timestamps: false,
    },
  );

  return LeadActivityHistory;
};
