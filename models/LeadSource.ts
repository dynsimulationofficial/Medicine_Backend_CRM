import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface LeadSourceAttributes {
    id: string;
    name: string;
    created_at?: Date;
    updated_at?: Date;
}

export type LeadSourceCreationAttributes = Optional<LeadSourceAttributes, "id" | "created_at" | "updated_at">;

export const initLeadSourceModel = (sequelize: Sequelize) => {
    class LeadSource extends Model<LeadSourceAttributes, LeadSourceCreationAttributes> implements LeadSourceAttributes {
        public id!: string;
        public name!: string;
        public created_at!: Date;
        public updated_at!: Date;
    }

    LeadSource.init(
        {
            id: {
                type: DataTypes.UUID,
                primaryKey: true,
                defaultValue: DataTypes.UUIDV4
            },
            name: {
                type: DataTypes.STRING(120),
                allowNull: false,
                unique: true
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
            tableName: "lead_sources",
            schema: "public",
            timestamps: false
        }
    );

    return LeadSource;
};