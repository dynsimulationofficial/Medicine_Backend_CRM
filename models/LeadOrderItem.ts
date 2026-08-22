import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadOrderItemAttributes {
  id: string;
  order_id: string;
  lead_id: string;
  medicine_name: string;
  unit: string;
  quantity: number;
  rate: number;
  total_price: number;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export type LeadOrderItemCreationAttributes = Optional<
  LeadOrderItemAttributes,
  "id" | "unit" | "quantity" | "rate" | "total_price" | "created_at" | "updated_at" | "deleted_at"
>;

export const initLeadOrderItemModel = (sequelize: Sequelize) => {
  class LeadOrderItem
    extends Model<LeadOrderItemAttributes, LeadOrderItemCreationAttributes>
    implements LeadOrderItemAttributes
  {
    public id!: string;
    public order_id!: string;
    public lead_id!: string;
    public medicine_name!: string;
    public unit!: string;
    public quantity!: number;
    public rate!: number;
    public total_price!: number;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  LeadOrderItem.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      order_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      lead_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      medicine_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      unit: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Strip",
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      rate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
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
      tableName: "lead_order_items",
      schema: "public",
      timestamps: false,
    }
  );

  return LeadOrderItem;
};
