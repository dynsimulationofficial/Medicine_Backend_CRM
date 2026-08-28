import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface OrderTrackingLogAttributes {
  id: string;
  order_id: string;
  tracking_number: string;
  courier_name?: string | null;
  status: string; // In_Transit, Out_For_Delivery, Delivered, Exception, etc.
  sub_status?: string | null;
  location?: string | null;
  details?: string | null;
  checkpoint_time?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export type OrderTrackingLogCreationAttributes = Optional<
  OrderTrackingLogAttributes,
  "id" | "courier_name" | "sub_status" | "location" | "details" | "checkpoint_time" | "created_at" | "updated_at"
>;

export const initOrderTrackingLogModel = (sequelize: Sequelize) => {
  class OrderTrackingLog
    extends Model<OrderTrackingLogAttributes, OrderTrackingLogCreationAttributes>
    implements OrderTrackingLogAttributes
  {
    public id!: string;
    public order_id!: string;
    public tracking_number!: string;
    public courier_name!: string | null;
    public status!: string;
    public sub_status!: string | null;
    public location!: string | null;
    public details!: string | null;
    public checkpoint_time!: Date | null;
    public created_at!: Date;
    public updated_at!: Date;
  }

  OrderTrackingLog.init(
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
      tracking_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      courier_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "In_Transit",
      },
      sub_status: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      location: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      details: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      checkpoint_time: {
        type: DataTypes.DATE,
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
      sequelize,
      tableName: "order_tracking_logs",
      schema: "public",
      timestamps: false,
    }
  );

  return OrderTrackingLog;
};

export default initOrderTrackingLogModel;
