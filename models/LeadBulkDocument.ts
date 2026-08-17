import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadBulkDocumentAttrs {
  id: string;
  lead_id: string;
  file_name: string;
  storage_path: string;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

type LeadBulkDocumentCreation = Optional<
  LeadBulkDocumentAttrs,
  "id" | "created_at" | "updated_at" | "deleted_at"
>;

export const initLeadBulkDocumentModel = (sequelize: Sequelize) => {
  class LeadBulkDocument
    extends Model<LeadBulkDocumentAttrs, LeadBulkDocumentCreation>
    implements LeadBulkDocumentAttrs {
    public id!: string;
    public lead_id!: string;
    public file_name!: string;
    public storage_path!: string;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  LeadBulkDocument.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      lead_id: { type: DataTypes.UUID, allowNull: false },
      file_name: { type: DataTypes.STRING(255), allowNull: false },
      storage_path: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      tableName: "lead_bulk_documents",
      schema: "public",
      timestamps: false,
    }
  );

  return LeadBulkDocument;
};
