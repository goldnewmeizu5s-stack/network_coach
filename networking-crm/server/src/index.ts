import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { config, initEnvPinHash } from "./config";
import prisma from "./lib/prisma";
import { logger } from "./lib/logger";
import { aiLimiter } from "./lib/rate-limit";
import { authMiddleware, ensureUser } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth";
import contactsRoutes from "./routes/contacts";
import voiceRoutes from "./routes/voice";
import chatRoutes from "./routes/chat";
import challengesRoutes from "./routes/challenges";
import followupsRoutes from "./routes/followups";
import userRoutes from "./routes/user";
import methodologiesRoutes from "./routes/methodologies";
import insightsRoutes from "./routes/insights";
import statsRoutes from "./routes/stats";
import exportRoutes from "./routes/export";
import { startCron, runDailyJob } from "./services/cron";
import { startBot, stopBot } from "./bot";

const app = express();
const startTime = Date.now();

// Trust proxy (Railway, Heroku, etc.)
if (config.isProd) {
  app.set("trust proxy", 1);
}

// Security & compression
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limit for auth routes (5 attempts per minute)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please wait a minute." },
});

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check (public) — ALWAYS returns 200 so Railway healthcheck passes
app.get("/api/health", async (_req, res) => {
  let dbStatus = "unknown";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch {
    dbStatus = "connecting";
  }
  // ALWAYS return 200 — even if DB is not ready yet
  res.status(200).json({
    status: "ok",
    db: dbStatus,
    version: "1.0.0",
  });
});

// Auth routes (public, with strict rate limit)
app.use("/api/auth", authLimiter, authRoutes);

// Protected routes
app.use("/api/contacts", authMiddleware, apiLimiter, contactsRoutes);
app.use("/api/voice", authMiddleware, apiLimiter, voiceRoutes);
app.use("/api/chat", authMiddleware, aiLimiter, chatRoutes);
app.use("/api/challenges", authMiddleware, apiLimiter, challengesRoutes);
app.use("/api/followups", authMiddleware, apiLimiter, followupsRoutes);
app.use("/api/user", authMiddleware, apiLimiter, userRoutes);
app.use("/api/methodologies", authMiddleware, apiLimiter, methodologiesRoutes);
app.use("/api/insights", authMiddleware, aiLimiter, insightsRoutes);
app.use("/api/stats", authMiddleware, apiLimiter, statsRoutes);
app.use("/api/export", authMiddleware, apiLimiter, exportRoutes);

// Manual cron trigger
app.post("/api/cron/run-now", authMiddleware, async (_req, res, next) => {
  try {
    await runDailyJob();
    res.json({ status: "completed" });
  } catch (err) {
    next(err);
  }
});

// Serve static files + SPA fallback
if (config.isProd) {
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientDist, { maxAge: "7d" }));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Error handler (must be last)
app.use(errorHandler);

// === STARTUP ===
// Step 1: Listen on port IMMEDIATELY (healthcheck must pass)
const server = app.listen(config.port, () => {
  logger.info(`Server listening on port ${config.port} [${config.nodeEnv}]`);
});

// Step 2: Background initialization (does NOT block the port)
(async () => {
  try {
    // Wait for DB with retries
    for (let i = 0; i < 15; i++) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        logger.info("Database connected");
        break;
      } catch {
        logger.warn(`DB not ready, retry ${i + 1}/15...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    await initEnvPinHash();
    logger.info("PIN hash initialized");

    await ensureUser();
    logger.info("Default user ensured");

    startCron();
    logger.info("Cron started");

    try {
      startBot();
    } catch (botErr) {
      logger.error("Telegram bot init failed", { error: String(botErr) });
    }
  } catch (err) {
    logger.error("Background init failed", { error: String(err) });
    // Do NOT process.exit — server keeps running, health endpoint responds,
    // so we can debug via logs
  }
})();

// Graceful shutdown
function shutdown() {
  logger.info("Shutting down...");
  stopBot();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
