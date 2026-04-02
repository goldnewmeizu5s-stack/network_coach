import { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const pin = req.headers["x-auth-pin"] as string | undefined;
  const authPin = process.env.AUTH_PIN;

  if (!authPin) {
    res.status(500).json({ error: "AUTH_PIN not configured on server" });
    return;
  }

  if (!pin || pin !== authPin) {
    res.status(401).json({ error: "Invalid or missing PIN" });
    return;
  }

  ensureUser().then(() => next()).catch(next);
}

async function ensureUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count === 0) {
    await prisma.user.create({ data: {} });
  }
}
