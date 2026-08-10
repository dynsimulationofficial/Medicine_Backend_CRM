import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadAttributes {
  id: string;
  lead_number: string;
  full_name: string;
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
  consolidated_credit_status_id?: string | null;
  whatsapp_number?: string | null;
  lead_source_id?: string | null;
  debt_consolidation_status_id?: string | null;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export type LeadCreationAttributes = Optional<
  LeadAttributes,
  | "id" | "lead_number" | "address_line1" | "address_line2"
  | "city" | "state" | "postal_code" | "country" | "lead_score" | "lead_quality"
  | "best_time_to_call" | "agent_id" | "consolidated_credit_status_id"
  | "whatsapp_number" | "lead_source_id" | "debt_consolidation_status_id"
  | "created_at" | "updated_at" | "deleted_at"
>;

export const initLeadModel = (sequelize: Sequelize) => {
  class Lead extends Model<LeadAttributes, LeadCreationAttributes> implements LeadAttributes {
    public id!: string;
    public lead_number!: string;
    public full_name!: string;
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
    public consolidated_credit_status_id!: string | null;
    public whatsapp_number!: string | null;
    public lead_source_id!: string | null;
    public debt_consolidation_status_id!: string | null;
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
      consolidated_credit_status_id: { type: DataTypes.UUID, allowNull: true },
      whatsapp_number: { type: DataTypes.STRING, allowNull: true },
      lead_source_id: { type: DataTypes.UUID, allowNull: true },
      debt_consolidation_status_id: { type: DataTypes.UUID, allowNull: true },
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
