import { Router, Request, Response } from "express";
import crypto from "crypto";
import { config, verifyPin, hashPin, getEnvPinHash } from "../config";
import prisma from "../lib/prisma";

const router = Router();

const COOKIE_NAME = "auth_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

async function createSession(): Promise<string> {
  const token = crypto.randomUUID();
  const expires_at = new Date(Date.now() + COOKIE_MAX_AGE);
  await prisma.session.create({ data: { token, expires_at } });
  return token;
}

/** Check PIN against DB hash first, fallback to env hash */
async function checkPin(pin: string): Promise<boolean> {
  const user = await prisma.user.findFirst();
  if (user?.pin_hash) {
    return verifyPin(pin, user.pin_hash);
  }
  return verifyPin(pin, getEnvPinHash());
}

router.post("/verify", async (req: Request, res: Response) => {
  try {
    const pin = req.body?.pin || (req.headers["x-auth-pin"] as string);
    if (!pin) {
      res.json({ valid: false });
      return;
    }

    const valid = await checkPin(pin);
    if (valid) {
      const token = await createSession();
      setAuthCookie(res, token);
    }
    res.json({ valid });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/change-pin", async (req: Request, res: Response) => {
  try {
    const { current_pin, new_pin } = req.body;

    if (!current_pin) {
      res.status(401).json({ error: "Invalid current PIN" });
      return;
    }

    const valid = await checkPin(current_pin);
    if (!valid) {
      res.status(401).json({ error: "Invalid current PIN" });
      return;
    }

    if (!new_pin || new_pin.length < 4) {
      res.status(400).json({ error: "New PIN must be at least 4 characters" });
      return;
    }

    // Hash and store in DB
    const newHash = await hashPin(new_pin);
    const user = await prisma.user.findFirst();
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { pin_hash: newHash },
      });
    } else {
      await prisma.user.create({ data: { pin_hash: newHash } });
    }

    // Delete all old sessions and create a new one
    await prisma.session.deleteMany();
    const token = await createSession();
    setAuthCookie(res, token);

    res.json({ success: true, message: "PIN changed successfully" });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Telegram Mini App auth ───────────────────────────────

function validateTelegramInitData(initData: string, botToken: string): boolean {
  if (!botToken) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return calculatedHash === hash;
}

router.post("/telegram", async (req: Request, res: Response) => {
  try {
    const { initData } = req.body;
    if (!initData || !config.telegramBotToken) {
      res.json({ valid: false });
      return;
    }

    const valid = validateTelegramInitData(initData, config.telegramBotToken);
    if (valid) {
      const token = await createSession();
      setAuthCookie(res, token);
    }
    res.json({ valid });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      await prisma.session.deleteMany({ where: { token } });
    }
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
