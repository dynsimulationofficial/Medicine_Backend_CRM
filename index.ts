import path from "path";
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import cors from "cors";

import SystemuserRouter from "./routes/SystemuserRoute";
import { sequelize } from "./models";
import { syncDatabase } from "./database/sync";
import emailService from "./service/EmailService";
dotenv.config();

console.log("🛠️ MANAGE_LEAD_PORT =", process.env.MANAGE_LEAD_PORT);

const app: Express = express();
const port = Number(process.env.MANAGE_LEAD_PORT) || 3000;

// Sentry setup
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  serverName: "Manage Lead",
  profilesSampleRate: 1.0,
});

// Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👉 Serve uploads folder
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Routes
app.use("/api/v1/managelead", SystemuserRouter);

app.get("/", (_req: Request, res: Response) => {
  res.send("Express + TypeScript server is running.");
});
// Initialize server
async function startServer() {
  try {
    // ✅ Verify SMTP, but don't crash the server if it fails
    try {
      console.log("📧 Verifying SMTP…");
      await emailService.verify();
      console.log("✅ SMTP OK");
    } catch (e) {
      console.error("⚠️ SMTP verify failed (continuing to start server):", e);
    }

    console.log("📦 Connecting to database...");
    await sequelize.authenticate();
    console.log("✅ Database connection established");

    await syncDatabase(sequelize);

    console.log("🚀 Launching server...");
    app.listen(port, "0.0.0.0", () => {
      console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

startServer();
