import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadDebtStatusAttributes {
  id: string;
  name: string;
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export type LeadDebtStatusCreationAttributes = Optional<LeadDebtStatusAttributes, "id" | "is_active" | "created_at" | "updated_at">;

export const initLeadDebtStatusModel = (sequelize: Sequelize) => {
  class LeadDebtStatus extends Model<LeadDebtStatusAttributes, LeadDebtStatusCreationAttributes> implements LeadDebtStatusAttributes {
    public id!: string;
    public name!: string;
    public is_active!: boolean;
    public created_at!: Date;
    public updated_at!: Date;
  }

  LeadDebtStatus.init(
    {
      id: { 
        type: DataTypes.UUID, 
        primaryKey: true, 
        defaultValue: DataTypes.UUIDV4 
      },
      name: { 
        type: DataTypes.TEXT, 
        allowNull: false,
        unique: true 
      },
      is_active: { 
        type: DataTypes.BOOLEAN, 
        allowNull: true,
        defaultValue: true 
      },
      created_at: { 
        type: DataTypes.DATE, 
        allowNull: false, 
        defaultValue: DataTypes.NOW 
      },
      updated_at: { 
        type: DataTypes.DATE, 
        allowNull: false, 
        defaultValue: DataTypes.NOW 
      },
    },
    { 
      sequelize, 
      tableName: "lead_debt_statuses", 
      schema: "public", 
      timestamps: false 
    }
  );

  return LeadDebtStatus;
};