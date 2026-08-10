// models/UserActivity.ts
import { DataTypes, Sequelize, Model } from "sequelize";

export default (sequelize: Sequelize) => {
  class SystemUserActivity extends Model {
    public id!: number;
    public system_user_id!: string; // Changed from uuid to system_user_id
    public user_activity!: string;
    public activity_timestamp!: Date;
    public module?: string;
    public type?: string;
  }

  SystemUserActivity.init(
    {
      id: { 
        type: DataTypes.INTEGER, 
        autoIncrement: true, 
        primaryKey: true 
      },
      system_user_id: { 
        type: DataTypes.UUID, 
        allowNull: false,
        field: 'uuid' // Map to the 'uuid' column in the database
      },
      user_activity: { 
        type: DataTypes.STRING, 
        allowNull: false 
      },
      activity_timestamp: { 
        type: DataTypes.DATE, 
        defaultValue: DataTypes.NOW 
      },
      module: { 
        type: DataTypes.STRING, 
        allowNull: true 
      },
      type: { 
        type: DataTypes.STRING, 
        allowNull: true 
      },
    },
    {
      sequelize,
      tableName: "system_user_activity",
      timestamps: false,
    }
  );

  return SystemUserActivity;
};