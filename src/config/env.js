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
  appUrl: process.env.BASE_URL || process.env.FRONTEND_URL || "https://qrave.netlify.app/",
  corsOrigin: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173",
  sessionSecret: requireEnv("SESSION_SECRET", "dev-session-secret-change-me", true),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "qrave.sid",
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || String(1000 * 60 * 60 * 24)),
  jwtSecret: requireEnv("JWT_SECRET", "dev-jwt-secret-change-me", true),

  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "test_key",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "test_secret", 
  // Subscription Pricing Parameters
  planStarterPrice: Number(process.env.PLAN_STARTER_PRICE || "1499"),
  planProPrice: Number(process.env.PLAN_PRO_PRICE || "3999"),
  planEnterprisePrice: Number(process.env.PLAN_ENTERPRISE_PRICE || "7999"),

  // Access token (JWT): short-lived, sent in Authorization header
  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || process.env.JWT_EXPIRES_IN || "15m",

  // Refresh token: long-lived, stored server-side as a hash, and sent via HttpOnly cookie (web) or native secure storage (mobile)
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || "60"),
  refreshTokenCookieName: process.env.REFRESH_TOKEN_COOKIE_NAME || "qrave.refresh",

  // Cookie settings for web/PWA refresh token.
  // - SameSite=Strict is most secure but can break cross-site deployments.
  // - Recommended: Lax for same-site; None + Secure for cross-site.
  refreshCookieSameSite: (process.env.REFRESH_COOKIE_SAMESITE || "lax").toLowerCase(),
  refreshCookieSecure: String(process.env.REFRESH_COOKIE_SECURE || "").length
    ? String(process.env.REFRESH_COOKIE_SECURE).toLowerCase() === "true"
    : isProd,

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

