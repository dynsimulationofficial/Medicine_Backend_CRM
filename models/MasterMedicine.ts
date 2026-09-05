import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface MasterMedicineAttributes {
  id: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export type MasterMedicineCreationAttributes = Optional<
  MasterMedicineAttributes,
  "id" | "description" | "image_url" | "created_at" | "updated_at" | "deleted_at"
>;

export const initMasterMedicineModel = (sequelize: Sequelize) => {
  class MasterMedicine
    extends Model<MasterMedicineAttributes, MasterMedicineCreationAttributes>
    implements MasterMedicineAttributes
  {
    public id!: string;
    public name!: string;
    public description!: string | null;
    public image_url!: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  MasterMedicine.init(
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
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      image_url: {
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
      tableName: "master_medicines",
      schema: "public",
      timestamps: false,
    }
  );

  return MasterMedicine;
};
