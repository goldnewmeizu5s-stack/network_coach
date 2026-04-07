import { config } from "../config";

function format(level: string, msg: string, meta?: Record<string, unknown>) {
  if (config.isProd) {
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

/**
 * Extract detailed error info from any error, especially Anthropic SDK errors.
 * Returns a flat object safe for structured logging.
 */
export function extractErrorDetails(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };

  const details: Record<string, unknown> = {
    error_message: err.message,
    error_name: err.name,
  };

  // Anthropic SDK APIError has status, error body, headers etc.
  const apiErr = err as Record<string, unknown>;
  if (apiErr.status) details.status = apiErr.status;
  if (apiErr.error) {
    try {
      details.error_body = JSON.stringify(apiErr.error);
    } catch {
      details.error_body = String(apiErr.error);
    }
  }
  if (apiErr.headers) {
    const h = apiErr.headers as Record<string, string>;
    if (h["x-request-id"]) details.request_id = h["x-request-id"];
  }

  return details;
}
