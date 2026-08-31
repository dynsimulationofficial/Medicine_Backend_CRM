// src/database/DBService.ts
import { Sequelize, Options } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

function getEnv(name: string, fallback?: string): string {
    const val = process.env[name] ?? fallback;
    if (!val) throw new Error(`[DBService] Missing required env: ${name}`);
    return val;
}

function buildOptions(prefix: "WRITER" | "READER"): Options {
    const useSSL = (process.env.PG_USE_SSL || "false").toLowerCase() === "true";

    return {
        database: getEnv(`PGDATABASE_${prefix}`),
        username: getEnv(`PGUSER_${prefix}`),
        password: getEnv(`PGPASSWORD_${prefix}`),
        host: getEnv(`PGHOST_${prefix}`),
        port: parseInt(getEnv(`PGPORT_${prefix}`, "5432"), 10),
        dialect: "postgres",
        dialectOptions: useSSL ? { ssl: { require: true, rejectUnauthorized: false } } : {},
        pool: {
            max: parseInt(process.env[`PGMAXCONNECTIONS_${prefix}`] || "50", 10),
            min: parseInt(process.env[`PGMINCONNECTIONS_${prefix}`] || "2", 10),
            idle: parseInt(process.env[`PGIDLETIMEOUTMILLIS_${prefix}`] || "10000", 10),
            acquire: parseInt(process.env[`PGCONNECTIONTIMEOUTMILLIS_${prefix}`] || "30000", 10),
        },
        define: {
            underscored: true,
            timestamps: true,
        },
        timezone: "+00:00",
        logging: process.env.NODE_ENV === "development" ? console.log : false,
    };
}

async function retry<T>(fn: () => Promise<T>, attempts = 5, baseDelayMs = 500): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, i)));
        }
    }
    throw lastError;
}

export default class DBServices {
    public sequelizeWriter: Sequelize;
    public sequelizeReader: Sequelize;

    constructor() {
        this.sequelizeWriter = new Sequelize(buildOptions("WRITER"));
        this.sequelizeReader = new Sequelize(buildOptions("READER"));
    }

    public async init(): Promise<void> {
        await this.testConnections();
        await this.sequelizeWriter.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    }

    public async testConnections(): Promise<void> {
        await retry(async () => {
            await this.sequelizeWriter.authenticate();
            if (process.env.NODE_ENV !== "test") console.log("✅ Writer database connection established");
        });

        await retry(async () => {
            await this.sequelizeReader.authenticate();
            if (process.env.NODE_ENV !== "test") console.log("✅ Reader database connection established");
        });
    }

    public async closeAll(): Promise<void> {
        await Promise.all([this.sequelizeWriter.close(), this.sequelizeReader.close()]);
    }

    public get write(): Sequelize {
        return this.sequelizeWriter;
    }

    public get read(): Sequelize {
        return this.sequelizeReader;
    }
}

export const db = new DBServices();
export const sequelizeWriter = db.sequelizeWriter;
export const sequelizeReader = db.sequelizeReader;
