import { Sequelize, DataTypes, Model, Optional } from "sequelize";

export interface LeadActivityHistoryAttrs {
    id: string;
    lead_id: string;
    agent_id?: string | null;
    disposition_id: string;
    conversation: string;
    occurred_at: Date;
    created_at?: Date;
    updated_at?: Date;
    deleted_at?: Date | null; // 👈 added
    is_edited?: boolean; // 👈 added
}

type LeadActivityHistoryCreation = Optional<
    LeadActivityHistoryAttrs,
    "id" | "agent_id" | "occurred_at" | "created_at" | "updated_at" | "deleted_at"
>;

export function initLeadActivityHistoryModel(sequelize: Sequelize) {
    const LeadActivityHistory = sequelize.define<
        Model<LeadActivityHistoryAttrs, LeadActivityHistoryCreation>
    >(
        "LeadActivityHistory",
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            lead_id: { type: DataTypes.UUID, allowNull: false },
            agent_id: { type: DataTypes.UUID, allowNull: true },
            disposition_id: { type: DataTypes.UUID, allowNull: false },
            conversation: { type: DataTypes.TEXT, allowNull: false },
            occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            deleted_at: { type: DataTypes.DATE, allowNull: true }, // 👈 added
            is_edited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // 👈
        },
        {
            tableName: "lead_activity_history",
            schema: "public",
            timestamps: false, // we’re managing created_at/updated_at manually
            indexes: [
                { fields: ["lead_id"] },
                { fields: ["disposition_id"] },
                { fields: ["agent_id"] },
                { fields: ["occurred_at"] },
                { fields: ["deleted_at"] }, // 👈 useful for filtering
                { fields: ["is_edited"] }, // 👈 useful
            ],
        }
    );

    return LeadActivityHistory;
}
