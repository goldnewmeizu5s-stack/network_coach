import { Request, Response, NextFunction } from "express";
import { verifyPin, getEnvPinHash } from "../config";
import prisma from "../lib/prisma";

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionPin = req.cookies?.["auth_session"];

  if (!sessionPin) {
    res.status(401).json({ error: "Invalid or missing session" });
    return;
  }

  try {
    const valid = await verifyPinAgainstStored(sessionPin);
    if (!valid) {
      res.status(401).json({ error: "Invalid or missing session" });
      return;
    }

    await ensureUser();
    next();
  } catch (err) {
    next(err);
  }
}

/** Check PIN against DB hash first, fallback to env hash */
async function verifyPinAgainstStored(pin: string): Promise<boolean> {
  const user = await prisma.user.findFirst();
  if (user?.pin_hash) {
    return verifyPin(pin, user.pin_hash);
  }
  return verifyPin(pin, getEnvPinHash());
}

async function ensureUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count === 0) {
    await prisma.user.create({ data: {} });
  }
}
