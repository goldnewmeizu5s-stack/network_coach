import crypto from "crypto";

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

// --- PIN hashing helpers (scrypt, no external deps) ---

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

export function hashPin(pin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(
      pin,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt.toString("hex")}:${derivedKey.toString("hex")}`);
      },
    );
  });
}

export function verifyPin(pin: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [saltHex, keyHex] = stored.split(":");
    if (!saltHex || !keyHex) return resolve(false);
    const salt = Buffer.from(saltHex, "hex");
    const storedKey = Buffer.from(keyHex, "hex");
    crypto.scrypt(
      pin,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (err, derivedKey) => {
        if (err) return reject(err);
        try {
          resolve(crypto.timingSafeEqual(derivedKey, storedKey));
        } catch {
          resolve(false);
        }
      },
    );
  });
}

// Hash the env PIN at startup so we never compare plaintext
let envPinHash: string | null = null;

export async function initEnvPinHash(): Promise<void> {
  const rawPin = required("AUTH_PIN");
  envPinHash = await hashPin(rawPin);
}

export function getEnvPinHash(): string {
  if (!envPinHash) {
    throw new Error("ENV PIN hash not initialized. Call initEnvPinHash() first.");
  }
  return envPinHash;
}

export const config = {
  port: parseInt(optional("PORT", "3001"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  isProd: process.env.NODE_ENV === "production",

  databaseUrl: required("DATABASE_URL"),
  openaiApiKey: required("OPENAI_API_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  authPin: required("AUTH_PIN"),
  claudeModel: optional("CLAUDE_MODEL", "claude-opus-4-20250514"),
};
