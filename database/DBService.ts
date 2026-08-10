// src/database/DBService.ts
import { Sequelize, Transaction, Options } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

/** Small helper to ensure required envs exist (gives clear errors) */
function required(name: string, fallback?: string) {
    const v = process.env[name] ?? fallback;
    if (v === undefined || v === "") {
        throw new Error(`Missing required env: ${name}`);
    }
    return v;
}

/** Build Sequelize options for writer/reader */
function buildOptions(prefix: "WRITER" | "READER"): Options {
    const useSSL = (process.env.PG_USE_SSL || "false").toLowerCase() === "true";

    return {
        database: required(`PGDATABASE_${prefix}`),
        username: required(`PGUSER_${prefix}`),
        password: required(`PGPASSWORD_${prefix}`),
        host: required(`PGHOST_${prefix}`),
        port: parseInt(required(`PGPORT_${prefix}`, "5432"), 10),
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
        timezone: "+00:00", // keep DB in UTC; handle local in app layer
        logging: process.env.NODE_ENV === "development" ? console.log : false,
    };
}

/** Retry with exponential backoff (good for cold boots / DB restarts) */
async function retry<T>(
    fn: () => Promise<T>,
    attempts = 5,
    baseDelayMs = 500
): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const delay = baseDelayMs * Math.pow(2, i);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

export default class DBServices {
    public sequelizeWriter: Sequelize;
    public sequelizeReader: Sequelize;

    constructor() {
        this.sequelizeWriter = new Sequelize(buildOptions("WRITER"));
        this.sequelizeReader = new Sequelize(buildOptions("READER"));
    }

    /** Ensures pgcrypto is present (for gen_random_uuid), and tests connections */
    public async init(): Promise<void> {
        await this.testConnections();

        // Safe to run on both — no-op if already installed
        await this.sequelizeWriter.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    }

    public async testConnections(): Promise<void> {
        await retry(async () => {
            await this.sequelizeWriter.authenticate();
            if (process.env.NODE_ENV !== "test") console.log("✅ Writer connection established");
        });

        await retry(async () => {
            await this.sequelizeReader.authenticate();
            if (process.env.NODE_ENV !== "test") console.log("✅ Reader connection established");
        });
    }

    /** Gracefully close pools (call on shutdown) */
    public async closeAll(): Promise<void> {
        await Promise.all([this.sequelizeWriter.close(), this.sequelizeReader.close()]);
    }

    /** Convenience helpers */
    public get write(): Sequelize {
        return this.sequelizeWriter;
    }
    public get read(): Sequelize {
        return this.sequelizeReader;
    }

    /** Run a callback inside a write transaction */
    public async withTransaction<T>(cb: (t: Transaction) => Promise<T>): Promise<T> {
        return this.sequelizeWriter.transaction(async (t) => cb(t));
    }

    /** Quick runners (avoid importing Sequelize everywhere) */
    public async queryWrite<T = unknown>(sql: string, replacements?: Record<string, unknown>): Promise<T> {
        const [rows] = await this.sequelizeWriter.query(sql, { replacements });
        return rows as T;
    }

    public async queryRead<T = unknown>(sql: string, replacements?: Record<string, unknown>): Promise<T> {
        const [rows] = await this.sequelizeReader.query(sql, { replacements });
        return rows as T;
    }

    /** Attach process signal handlers for graceful shutdown (optional) */
    public attachSignalHandlers(): void {
        const handler = async (signal: NodeJS.Signals) => {
            console.log(`\nReceived ${signal}. Closing DB pools...`);
            try {
                await this.closeAll();
                console.log("✅ DB pools closed. Bye!");
                process.exit(0);
            } catch (e) {
                console.error("❌ Error closing pools:", e);
                process.exit(1);
            }
        };
        process.on("SIGINT", handler);
        process.on("SIGTERM", handler);
    }
}

/** Singleton exports (compatible with your existing imports) */
export const db = new DBServices();
export const sequelizeWriter = db.sequelizeWriter;
export const sequelizeReader = db.sequelizeReader;
