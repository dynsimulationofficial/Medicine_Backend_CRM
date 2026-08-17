// lead_documents.model.ts
import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadDocumentAttrs {
  id: string;
  lead_id: string;
  uploaded_by?: string | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  is_image: boolean;
  notes?: string | null;
  is_edited?: boolean;
  edited_by?: string | null;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

type LeadDocumentCreation = Optional<
  LeadDocumentAttrs,
  "id" | "uploaded_by" | "notes" | "is_edited" | "edited_by" | "created_at" | "updated_at" | "deleted_at"
>;

export const initLeadDocumentModel = (sequelize: Sequelize) => {
  class LeadDocument extends Model<LeadDocumentAttrs, LeadDocumentCreation>
    implements LeadDocumentAttrs {
    public id!: string;
    public lead_id!: string;
    public uploaded_by?: string | null;
    public file_name!: string;
    public mime_type!: string;
    public file_size!: number;
    public storage_path!: string;
    public is_image!: boolean;
    public notes?: string | null;
    public is_edited!: boolean;
    public edited_by?: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  LeadDocument.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      lead_id: { type: DataTypes.UUID, allowNull: false },
      uploaded_by: { type: DataTypes.UUID, allowNull: true },
      file_name: { type: DataTypes.STRING, allowNull: false },
      mime_type: { type: DataTypes.STRING, allowNull: false },
      file_size: { type: DataTypes.INTEGER, allowNull: false },
      storage_path: { type: DataTypes.STRING, allowNull: false },
      is_image: { type: DataTypes.BOOLEAN, defaultValue: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      is_edited: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
      edited_by: { type: DataTypes.UUID, allowNull: true },
      created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      tableName: "lead_documents",
      schema: "public",
      timestamps: false,
      indexes: [
        { fields: ["lead_id"] },
        { fields: ["uploaded_by"] },
        { fields: ["deleted_at"] },
      ],
    }
  );

  return LeadDocument;
};
