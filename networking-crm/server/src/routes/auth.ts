import { Router, Request, Response } from "express";
import { config, verifyPin, hashPin, getEnvPinHash } from "../config";
import prisma from "../lib/prisma";

const router = Router();

const COOKIE_NAME = "auth_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function setAuthCookie(res: Response, pin: string): void {
  res.cookie(COOKIE_NAME, pin, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
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
      setAuthCookie(res, pin);
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

    // Set new auth cookie with the new PIN
    setAuthCookie(res, new_pin);

    res.json({ success: true, message: "PIN changed successfully" });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true });
});

export default router;
