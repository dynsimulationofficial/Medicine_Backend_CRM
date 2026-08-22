import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadOrderAttributes {
  id: string;
  order_number: string;
  lead_id: string;
  agent_id?: string | null;
  total_items: number;
  grand_total: number;
  order_status: string;
  payment_status: string;
  payment_mode: string;
  order_notes?: string | null;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export type LeadOrderCreationAttributes = Optional<
  LeadOrderAttributes,
  | "id"
  | "order_number"
  | "agent_id"
  | "total_items"
  | "grand_total"
  | "order_status"
  | "payment_status"
  | "payment_mode"
  | "order_notes"
  | "created_at"
  | "updated_at"
  | "deleted_at"
>;

export const initLeadOrderModel = (sequelize: Sequelize) => {
  class LeadOrder
    extends Model<LeadOrderAttributes, LeadOrderCreationAttributes>
    implements LeadOrderAttributes
  {
    public id!: string;
    public order_number!: string;
    public lead_id!: string;
    public agent_id!: string | null;
    public total_items!: number;
    public grand_total!: number;
    public order_status!: string;
    public payment_status!: string;
    public payment_mode!: string;
    public order_notes!: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  LeadOrder.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      order_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        defaultValue: sequelize.literal(
          `'ORD' || to_char(nextval('public.order_number_seq'), 'FM000000')`
        ),
      },
      lead_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      agent_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      total_items: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      grand_total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      order_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Pending",
      },
      payment_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Pending",
      },
      payment_mode: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "COD",
      },
      order_notes: {
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
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: "lead_orders",
      schema: "public",
      timestamps: false,
    }
  );

  return LeadOrder;
};
