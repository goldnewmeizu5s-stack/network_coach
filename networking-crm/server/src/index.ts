import path from "path";
import express from "express";
import cors from "cors";
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
import { startCron, runDailyJob } from "./services/cron";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check (public)
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Auth routes (public)
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/contacts", authMiddleware, contactsRoutes);
app.use("/api/voice", authMiddleware, voiceRoutes);
app.use("/api/chat", authMiddleware, chatRoutes);
app.use("/api/challenges", authMiddleware, challengesRoutes);
app.use("/api/followups", authMiddleware, followupsRoutes);
app.use("/api/user", authMiddleware, userRoutes);
app.use("/api/methodologies", authMiddleware, methodologiesRoutes);

// Manual cron trigger (dev-mode)
app.post("/api/cron/run-now", authMiddleware, async (_req, res, next) => {
  try {
    await runDailyJob();
    res.json({ status: "completed" });
  } catch (err) {
    next(err);
  }
});

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startCron();
});
