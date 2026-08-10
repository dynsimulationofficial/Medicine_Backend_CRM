import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface ConsolidatedCreditStatusAttributes {
    id: string;
    name: string;
    is_active: boolean;
    created_at?: Date;
    updated_at?: Date;
}

export type ConsolidatedCreditStatusCreationAttributes = Optional<
    ConsolidatedCreditStatusAttributes,
    "id"  | "is_active" | "created_at" | "updated_at"
>;

export const initConsolidatedCreditStatusModel = (sequelize: Sequelize) => {
    class ConsolidatedCreditStatus
        extends Model<
            ConsolidatedCreditStatusAttributes,
            ConsolidatedCreditStatusCreationAttributes
        >
        implements ConsolidatedCreditStatusAttributes
    {
        public id!: string;
        public name!: string;
        public is_active!: boolean;
        public created_at!: Date;
        public updated_at!: Date;
    }

    ConsolidatedCreditStatus.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            name: {
                type: DataTypes.STRING(255),
                allowNull: false,
                unique: true,
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
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            sequelize,
            modelName: "ConsolidatedCreditStatus",
            tableName: "consolidated_credit_statuses",
            schema: "public",
            timestamps: false,
            underscored: true,
        }
    );

    return ConsolidatedCreditStatus;
};
