import { Request, Response, NextFunction } from "express";
import { config } from "../config";

interface AppError extends Error {
  statusCode?: number;
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    error: err.message || "Internal server error",
    ...(!config.isProd && { stack: err.stack }),
  });
}
