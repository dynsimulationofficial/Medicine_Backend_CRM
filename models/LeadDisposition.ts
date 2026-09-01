import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadDispositionAttributes {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at?: Date;
}

export type LeadDispositionCreationAttributes = Optional<
  LeadDispositionAttributes,
  "id" | "description" | "is_active" | "created_at"
>;

export const initLeadDispositionModel = (sequelize: Sequelize) => {
  class LeadDisposition
    extends Model<LeadDispositionAttributes, LeadDispositionCreationAttributes>
    implements LeadDispositionAttributes
  {
    public id!: string;
    public name!: string;
    public description!: string | null;
    public is_active!: boolean;
    public created_at!: Date;
  }

  LeadDisposition.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: "lead_dispositions",
      schema: "public",
      timestamps: false,
    }
  );

  return LeadDisposition;
};
