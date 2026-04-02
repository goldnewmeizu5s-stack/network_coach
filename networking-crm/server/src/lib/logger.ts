const isProd = process.env.NODE_ENV === "production";

function format(level: string, msg: string, meta?: Record<string, unknown>) {
  if (isProd) {
    return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  }
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${metaStr}`;
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>) {
    console.log(format("info", msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    console.warn(format("warn", msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    console.error(format("error", msg, meta));
  },
};
