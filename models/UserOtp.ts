// models/UserOtp.ts
import { DataTypes, Sequelize, Model } from "sequelize";

export default (sequelize: Sequelize) => {
  class UserOtp extends Model {
    public id!: number;
    public system_user_id!: string; // UUID of the user
    public otp!: string;
    public is_used!: boolean;
    public expires_at!: Date;
    public created_at!: Date;
  }

  UserOtp.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      system_user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "system_user_id",
      },
      otp: {
        type: DataTypes.STRING(6),
        allowNull: false,
      },
      is_used: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: "user_otps",
      timestamps: false, // using created_at manually
    }
  );

  return UserOtp;
};
