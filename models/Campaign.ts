import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface CampaignAttributes {
  id: string;
  name: string;
  lead_source_id?: string | null;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export type CampaignCreationAttributes = Optional<
  CampaignAttributes,
  "id" | "lead_source_id" | "created_at" | "updated_at" | "deleted_at"
>;

export const initCampaignModel = (sequelize: Sequelize) => {
  class Campaign
    extends Model<CampaignAttributes, CampaignCreationAttributes>
    implements CampaignAttributes
  {
    public id!: string;
    public name!: string;
    public lead_source_id!: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  Campaign.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      lead_source_id: {
        type: DataTypes.UUID,
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
      tableName: "campaigns",
      schema: "public",
      timestamps: false,
    }
  );

  return Campaign;
};
