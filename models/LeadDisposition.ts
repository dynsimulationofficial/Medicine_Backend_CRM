import { Sequelize, DataTypes, Model, Optional } from "sequelize";

export interface LeadDispositionAttrs {
    id: string;
    name: string;
    description?: string | null;
    is_active: boolean;
    created_at?: Date;
}

export type LeadDispositionCreation = Optional<
    LeadDispositionAttrs,
    "id" | "description" | "is_active" | "created_at"
>;

export function initLeadDispositionModel(sequelize: Sequelize) {
    const LeadDisposition = sequelize.define<
        Model<LeadDispositionAttrs, LeadDispositionCreation>
    >(
        "LeadDisposition",
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
            tableName: "lead_dispositions",
            schema: "public",
            timestamps: false,
            indexes: [{ unique: true, fields: ["name"] }],
        }
    );
    return LeadDisposition;
}
