import { PrismaClient } from "@prisma/client";

const isDev = process.env.NODE_ENV !== "production";

const prisma = new PrismaClient({
  log: isDev ? ["query", "warn", "error"] : ["error"],
});

export default prisma;
