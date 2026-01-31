import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

function requireEnv(name, fallback, allowMissingInDev = false) {
  const val = process.env[name];
  if (val) return val;
  if (!isProd && allowMissingInDev && fallback !== undefined) return fallback;
  if (!isProd && allowMissingInDev) return undefined;
  throw new Error(`Missing required env var: ${name}`);
}

export const env = {
  isProd,
  port: Number(process.env.PORT || "3001"),
  corsOrigin: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173",
  sessionSecret: requireEnv("SESSION_SECRET", "dev-session-secret-change-me", true),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "qrave.sid",
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || String(1000 * 60 * 60 * 24)),
  jwtSecret: requireEnv("JWT_SECRET", "dev-jwt-secret-change-me", true),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
  databaseUrl: requireEnv("DATABASE_URL", undefined, true),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || "10"),
  menuCacheTtlSec: Number(process.env.MENU_CACHE_TTL_SEC || "300"),
  allowDevRegister: String(process.env.ALLOW_DEV_REGISTER || "true").toLowerCase() === "true",
  redisMode: (process.env.REDIS_MODE || "single").toLowerCase(),
  redisUrl: process.env.REDIS_URL,

  geminiApiKey: process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY,
  
  // S3 / object storage
  s3Bucket: process.env.AWS_S3_BUCKET,
  s3Region: process.env.AWS_REGION,
  s3Endpoint: process.env.S3_ENDPOINT, // optional (e.g., MinIO/Cloudflare R2)
  s3ForcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "").toLowerCase() === "true",
};

