import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadTaskAttributes {
  id: string;
  lead_id: string;
  assigned_agent_id?: string | null;
  task_type: "meeting" | "phonecall" | "followup";
  subject?: string | null;
  details?: string | null;
  location?: string | null;
  start_at?: Date | null;
  end_at?: Date | null;
  due_at?: Date | null;
  status: "pending" | "done";
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export type LeadTaskCreationAttributes = Optional<
  LeadTaskAttributes,
  | "id"
  | "assigned_agent_id"
  | "task_type"
  | "subject"
  | "details"
  | "location"
  | "start_at"
  | "end_at"
  | "due_at"
  | "status"
  | "created_at"
  | "updated_at"
  | "deleted_at"
>;

export const initLeadTaskModel = (sequelize: Sequelize) => {
  class LeadTask
    extends Model<LeadTaskAttributes, LeadTaskCreationAttributes>
    implements LeadTaskAttributes
  {
    public id!: string;
    public lead_id!: string;
    public assigned_agent_id!: string | null;
    public task_type!: "meeting" | "phonecall" | "followup";
    public subject!: string | null;
    public details!: string | null;
    public location!: string | null;
    public start_at!: Date | null;
    public end_at!: Date | null;
    public due_at!: Date | null;
    public status!: "pending" | "done";
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null;
  }

  LeadTask.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      lead_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      assigned_agent_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      task_type: {
        type: DataTypes.ENUM("meeting", "phonecall", "followup"),
        allowNull: false,
        defaultValue: "followup",
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      details: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      location: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      start_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      end_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      due_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("pending", "done"),
        allowNull: false,
        defaultValue: "pending",
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
      tableName: "lead_tasks",
      schema: "public",
      timestamps: false,
    }
  );

  return LeadTask;
};
