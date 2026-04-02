function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3001"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  isProd: process.env.NODE_ENV === "production",

  databaseUrl: required("DATABASE_URL"),
  openaiApiKey: required("OPENAI_API_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  authPin: required("AUTH_PIN"),
};
