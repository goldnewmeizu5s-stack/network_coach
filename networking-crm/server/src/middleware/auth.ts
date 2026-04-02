import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import prisma from "../lib/prisma";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const pin = req.headers["x-auth-pin"] as string | undefined;

  if (!pin || pin !== config.authPin) {
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
