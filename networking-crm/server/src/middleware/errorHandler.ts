import { Request, Response, NextFunction } from "express";

interface AppError extends Error {
  statusCode?: number;
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  const statusCode = err.statusCode || 500;
  const isDev = process.env.NODE_ENV !== "production";

  res.status(statusCode).json({
    error: err.message || "Internal server error",
    ...(isDev && { stack: err.stack }),
  });
}
