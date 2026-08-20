import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadAttributes {
  id: string;
  lead_number: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  lead_score?: number | null;
  lead_quality?: string | null;
  best_time_to_call?: string | null;
  agent_id?: string | null;
  whatsapp_number?: string | null;
  lead_source_id?: string | null;
  note?: string | null;
  status?: string | null;
  lead_status?: string | null;
  payment_status?: string | null;
  delivery_status?: string | null;
  company?: string | null;
  activity_summary?: string | null;
  medicine_name?: string | null;
  order_amount?: number | null;
  currency?: string | null;
  courier_name?: string | null;
  tracking_number?: string | null;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export type LeadCreationAttributes = Optional<
  LeadAttributes,
  | "id" | "lead_number" | "first_name" | "last_name" | "address_line1" | "address_line2"
  | "city" | "state" | "postal_code" | "country" | "lead_score" | "lead_quality"
  | "best_time_to_call" | "agent_id"
  | "whatsapp_number" | "lead_source_id"
  | "note" | "status" | "lead_status" | "payment_status" | "delivery_status"
  | "company" | "activity_summary"
  | "medicine_name" | "order_amount" | "currency" | "courier_name" | "tracking_number"
  | "created_at" | "updated_at" | "deleted_at"
>;

export const initLeadModel = (sequelize: Sequelize) => {
  class Lead extends Model<LeadAttributes, LeadCreationAttributes> implements LeadAttributes {
    public id!: string;
    public lead_number!: string;
    public full_name!: string;
    public first_name!: string | null;
    public last_name!: string | null;
    public email!: string;
    public phone!: string;
    public address_line1!: string | null;
    public address_line2!: string | null;
    public city!: string | null;
    public state!: string | null;
    public postal_code!: string | null;
    public country!: string | null;
    public lead_score!: number | null;
    public lead_quality!: string | null;
    public best_time_to_call!: string | null;
    public agent_id!: string | null;
    public whatsapp_number!: string | null;
    public lead_source_id!: string | null;
    public note!: string | null;
    public status!: string | null;
    public lead_status!: string | null;
    public payment_status!: string | null;
    public delivery_status!: string | null;
    public company!: string | null;
    public activity_summary!: string | null;
    public medicine_name!: string | null;
    public order_amount!: number | null;
    public currency!: string | null;
    public courier_name!: string | null;
    public tracking_number!: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  Lead.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      lead_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        defaultValue: sequelize.literal(`'L' || to_char(nextval('lead_number_seq'), 'FM000000')`),
      },
      full_name: { type: DataTypes.STRING, allowNull: false },
      first_name: { type: DataTypes.STRING(255), allowNull: true },
      last_name: { type: DataTypes.STRING(255), allowNull: true },
      email: { type: DataTypes.STRING, allowNull: false, validate: { isEmail: true } },
      phone: { type: DataTypes.STRING, allowNull: false },
      address_line1: { type: DataTypes.STRING, allowNull: true },
      address_line2: { type: DataTypes.STRING, allowNull: true },
      city: { type: DataTypes.STRING, allowNull: true },
      state: { type: DataTypes.STRING, allowNull: true },
      postal_code: { type: DataTypes.STRING, allowNull: true },
      country: { type: DataTypes.STRING, allowNull: true },
      lead_score: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
      lead_quality: { type: DataTypes.STRING, allowNull: true },
      best_time_to_call: { type: DataTypes.STRING, allowNull: true },
      agent_id: { type: DataTypes.UUID, allowNull: true },
      whatsapp_number: { type: DataTypes.STRING(30), allowNull: true },
      lead_source_id: { type: DataTypes.UUID, allowNull: true },
      note: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING(100), allowNull: true },
      lead_status: { type: DataTypes.STRING(50), allowNull: true, defaultValue: "New" },
      payment_status: { type: DataTypes.STRING(50), allowNull: true, defaultValue: "Pending" },
      delivery_status: { type: DataTypes.STRING(50), allowNull: true, defaultValue: "Pending" },
      company: { type: DataTypes.STRING(255), allowNull: true },
      activity_summary: { type: DataTypes.TEXT, allowNull: true },
      medicine_name: { type: DataTypes.STRING(255), allowNull: true },
      order_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      currency: { type: DataTypes.STRING(10), allowNull: true, defaultValue: "USD" },
      courier_name: { type: DataTypes.STRING(100), allowNull: true },
      tracking_number: { type: DataTypes.STRING(100), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      tableName: "leads",
      schema: "public",
      timestamps: false,
    }
  );

  return Lead;
};
