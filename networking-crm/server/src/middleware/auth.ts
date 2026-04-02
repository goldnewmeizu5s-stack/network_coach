import { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.["auth_session"];

  if (!token) {
    res.status(401).json({ error: "Invalid or missing session" });
    return;
  }

  try {
    const session = await prisma.session.findUnique({ where: { token } });

    if (!session || session.expires_at < new Date()) {
      res.status(401).json({ error: "Invalid or missing session" });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}

/** Ensure at least one User row exists. Call once at server startup. */
export async function ensureUser(): Promise<void> {
  const user = await prisma.user.findFirst();
  if (!user) {
    await prisma.user.create({ data: {} });
  }
}
