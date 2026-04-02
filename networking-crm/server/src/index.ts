import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import prisma from "./lib/prisma";
import { authMiddleware } from "./middleware/auth";
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

const app = express();
const startTime = Date.now();

// Trust proxy (Railway, Heroku, etc.)
if (config.isProd) {
  app.set("trust proxy", 1);
}

// Security & compression
app.use(
  helmet({
    contentSecurityPolicy: false, // Let Vite handle CSP
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Request logging (JSON in prod)
app.use((req, _res, next) => {
  if (config.isProd) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
      })
    );
  } else {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Health check (public)
app.get("/api/health", async (_req, res) => {
  let dbStatus = "disconnected";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch {
    dbStatus = "disconnected";
  }

  const uptimeMs = Date.now() - startTime;
  const hours = Math.floor(uptimeMs / 3600000);
  const mins = Math.floor((uptimeMs % 3600000) / 60000);

  res.json({
    status: "ok",
    db: dbStatus,
    uptime: `${hours}h ${mins}m`,
    version: "1.0.0",
  });
});

// Auth routes (public)
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/contacts", authMiddleware, apiLimiter, contactsRoutes);
app.use("/api/voice", authMiddleware, apiLimiter, voiceRoutes);
app.use("/api/chat", authMiddleware, chatLimiter, chatRoutes);
app.use("/api/challenges", authMiddleware, apiLimiter, challengesRoutes);
app.use("/api/followups", authMiddleware, apiLimiter, followupsRoutes);
app.use("/api/user", authMiddleware, apiLimiter, userRoutes);
app.use("/api/methodologies", authMiddleware, apiLimiter, methodologiesRoutes);
app.use("/api/insights", authMiddleware, chatLimiter, insightsRoutes);
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

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port} [${config.nodeEnv}]`);
  startCron();
});
