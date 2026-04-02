import { PrismaClient } from "@prisma/client";
import { config } from "../config";

const prisma = new PrismaClient({
  log: config.isProd ? ["error"] : ["query", "warn", "error"],
});

export default prisma;
