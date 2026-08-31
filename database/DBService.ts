// src/database/DBService.ts
import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

// 1. Direct Sequelize Instance (Function / Direct Export Style)
const useSSL = (process.env.PG_USE_SSL || "false").toLowerCase() === "true";

export const sequelize = new Sequelize(
    process.env.PGDATABASE_WRITER || "medicine_crm_db",
    process.env.PGUSER_WRITER || "postgres",
    process.env.PGPASSWORD_WRITER || "123456",
    {
        host: process.env.PGHOST_WRITER || "127.0.0.1",
        port: Number(process.env.PGPORT_WRITER) || 5432,
        dialect: "postgres",
        dialectOptions: useSSL ? { ssl: { require: true, rejectUnauthorized: false } } : {},
        logging: false,
        pool: {
            max: parseInt(process.env.PGMAXCONNECTIONS_WRITER || "50", 10),
            min: parseInt(process.env.PGMINCONNECTIONS_WRITER || "2", 10),
            idle: parseInt(process.env.PGIDLETIMEOUTMILLIS_WRITER || "10000", 10),
            acquire: parseInt(process.env.PGCONNECTIONTIMEOUTMILLIS_WRITER || "30000", 10),
        },
        define: {
            underscored: true,
            timestamps: true,
        },
        timezone: "+00:00",
    }
);

// 2. Functional Database Helpers
export const initDB = async (): Promise<void> => {
    await sequelize.authenticate();
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
};

export const testDBConnection = async (): Promise<void> => {
    await sequelize.authenticate();
    console.log("✅ Database connection established successfully");
};

export const closeDB = async (): Promise<void> => {
    await sequelize.close();
};

// 3. Compatibility Class (Ensures existing Controllers run with 0% error)
export default class DBServices {
    public sequelizeWriter: Sequelize = sequelize;
    public sequelizeReader: Sequelize = sequelize;
    public init = initDB;
    public testConnections = testDBConnection;
    public closeAll = closeDB;
    public get write(): Sequelize { return sequelize; }
    public get read(): Sequelize { return sequelize; }
}

// 4. Easy Exports
export const db = new DBServices();
export const sequelizeWriter = sequelize;
export const sequelizeReader = sequelize;
