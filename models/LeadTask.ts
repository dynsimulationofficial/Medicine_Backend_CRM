import { Sequelize, DataTypes, Model, Optional } from "sequelize";

export interface LeadTaskAttrs {
  id: string;
  lead_id: string;
  assigned_agent_id: string;
  task_type: "meeting" | "phonecall" | "followup";
  subject?: string | null;
  details: string;
  timer_minutes: number;
  timer_hours: number;
  due_at: Date;                 // pivot (same as start_at for countdown)
  start_at?: Date | null;
  end_at?: Date | null;
  status: "pending" | "done";
  location?: string | null;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;     // 👈 NEW for soft delete
}

type LeadTaskCreation = Optional<
  LeadTaskAttrs,
  | "id"
  | "subject"
  | "timer_hours"
  | "start_at"
  | "end_at"
  | "status"
  | "created_at"
  | "updated_at"
  | "location"
  | "deleted_at" // 👈 NEW optional
>;

export function initLeadTaskModel(sequelize: Sequelize) {
  class LeadTask extends Model<LeadTaskAttrs, LeadTaskCreation>
    implements LeadTaskAttrs {
    public id!: string;
    public lead_id!: string;
    public assigned_agent_id!: string;
    public task_type!: "meeting" | "phonecall" | "followup";
    public subject!: string | null;
    public details!: string;
    public timer_minutes!: number;
    public timer_hours!: number;
    public due_at!: Date;
    public start_at!: Date | null;
    public end_at!: Date | null;
    public status!: "pending" | "done";
    public location!: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public deleted_at!: Date | null; // 👈 added to class
  }

  LeadTask.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      lead_id: { type: DataTypes.UUID, allowNull: false },
      assigned_agent_id: { type: DataTypes.UUID, allowNull: false },
      task_type: {
        type: DataTypes.ENUM("meeting", "phonecall", "followup"),
        allowNull: false,
        defaultValue: "followup",
      },
      subject: { type: DataTypes.STRING(255), allowNull: true },
      details: { type: DataTypes.TEXT, allowNull: false },
      timer_minutes: { type: DataTypes.INTEGER, allowNull: false },
      timer_hours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      due_at: { type: DataTypes.DATE, allowNull: false },
      start_at: { type: DataTypes.DATE, allowNull: true },
      end_at: { type: DataTypes.DATE, allowNull: true },
      location: { type: DataTypes.STRING(255), allowNull: true },
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
      deleted_at: { type: DataTypes.DATE, allowNull: true }, // 👈 added column
    },
    {
      sequelize,
      tableName: "lead_tasks",
      schema: "public",
      timestamps: true,
      paranoid: true,              // 👈 enables soft delete in Sequelize
      createdAt: "created_at",
      updatedAt: "updated_at",
      deletedAt: "deleted_at",     // 👈 maps deletedAt
      indexes: [
        { fields: ["lead_id"] },
        { fields: ["assigned_agent_id"] },
        { fields: ["task_type"] },
        { fields: ["due_at"] },
        { fields: ["start_at"] },
        { fields: ["end_at"] },
      ],
    }
  );

  return LeadTask;
}
