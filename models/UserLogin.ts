import { DataTypes, Sequelize, Model, Optional } from "sequelize";

export interface UserLoginAttributes {
    id: string;
    system_user_id: string;
    otp: string;
    is_used: boolean;
    expires_at: Date;
    created_at?: Date;
}
export type UserLoginCreationAttributes = Optional<UserLoginAttributes,
    "id" | "is_used" | "created_at"
>;

export default function initUserLoginModel(sequelize: Sequelize) {
    class UserLogin
        extends Model<UserLoginAttributes, UserLoginCreationAttributes>
        implements UserLoginAttributes {
        public id!: string;
        public system_user_id!: string;
        public otp!: string;
        public is_used!: boolean;
        public expires_at!: Date;
        public created_at!: Date;
    }

    UserLogin.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            system_user_id: { type: DataTypes.UUID, allowNull: false },
            otp: { type: DataTypes.STRING(6), allowNull: false },
            is_used: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            expires_at: { type: DataTypes.DATE, allowNull: false },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        {
            sequelize,
            tableName: "user_login_otp",
            schema: "public",
            timestamps: false,
            indexes: [
                { name: "idx_user_login_otp_expiry", fields: ["expires_at"] },
                { name: "idx_user_login_otp_lookup", fields: ["system_user_id", "otp", "is_used"] },
            ],
        }
    );

    return UserLogin;
}
