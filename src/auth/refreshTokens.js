import crypto from "crypto";
import { pool } from "../dbClient.js";
import { env } from "../config/env.js";

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function createRefreshTokenValue() {
  // 64 bytes => 128 hex chars
  return crypto.randomBytes(64).toString("hex");
}

export async function persistRefreshToken({
  subjectId,
  subjectType, // 'user' | 'staff'
  refreshToken,
  userAgent,
  ip,
  ttlDays = env.refreshTokenTtlDays,
}) {
  const tokenHash = sha256Hex(refreshToken);
  const now = new Date();
  const expiresAt = addDays(now, ttlDays);

  const result = await pool.query(
    `INSERT INTO auth_refresh_tokens (subject_id, subject_type, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, expires_at AS "expiresAt"`,
    [subjectId, subjectType, tokenHash, expiresAt, userAgent || null, ip || null],
  );

  return { id: result.rows[0].id, expiresAt: result.rows[0].expiresAt };
}

export async function findValidRefreshToken(refreshToken) {
  const tokenHash = sha256Hex(refreshToken);
  const result = await pool.query(
    `SELECT id, subject_id AS "subjectId", subject_type AS "subjectType", expires_at AS "expiresAt", revoked_at AS "revokedAt"
     FROM auth_refresh_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;

  return row;
}

export async function revokeRefreshTokenById(tokenId, { replacedByTokenId = null } = {}) {
  await pool.query(
    `UPDATE auth_refresh_tokens
     SET revoked_at = now(), replaced_by_token_id = $2
     WHERE id = $1 AND revoked_at IS NULL`,
    [tokenId, replacedByTokenId],
  );
}

export async function revokeRefreshTokenValue(refreshToken) {
  const tokenHash = sha256Hex(refreshToken);
  await pool.query(
    `UPDATE auth_refresh_tokens
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}

export function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setRefreshCookie(res, refreshToken) {
  const isProd = env.isProd;
  const maxAgeMs = env.refreshTokenTtlDays * 24 * 60 * 60 * 1000;

  // ALB Fix: Check both direct HTTPS and X-Forwarded-Proto header
  const isSecure = env.refreshCookieSecure || 
                   (isProd && (res.req?.protocol === 'https' || 
                               res.req?.get('x-forwarded-proto') === 'https'));

  const sameSite = (() => {
    const v = env.refreshCookieSameSite;
    if (v === "strict") return "Strict";
    if (v === "none") return "None";
    return "Lax";
  })();

  const parts = [
    `${env.refreshTokenCookieName}=${encodeURIComponent(refreshToken)}`,
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    "Path=/",
    "HttpOnly",
    isSecure ? "Secure" : "",
    `SameSite=${sameSite}`,
  ].filter(Boolean);

  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearRefreshCookie(res) {
  const sameSite = (() => {
    const v = env.refreshCookieSameSite;
    if (v === "strict") return "Strict";
    if (v === "none") return "None";
    return "Lax";
  })();

  const parts = [
    `${env.refreshTokenCookieName}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
  ].filter(Boolean);
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function startTokenCleanupJob() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const LOCK_TTL_SECONDS = 23 * 60 * 60; // 23h — expires just before next interval
  const LOCK_KEY = 'job:token-cleanup:lock';

  async function runCleanup() {
    try {
      // INFRA-3: Distributed lock — only one pod runs cleanup per cycle
      const { getRedisClient } = await import('../redis/client.js');
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        const acquired = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
        if (!acquired) return; // Another pod already claimed this cycle
      }

      await pool.query(
        `DELETE FROM auth_refresh_tokens 
         WHERE expires_at < now() OR revoked_at < now() - interval '7 days'`
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Token Cleanup] Failed to run token cleanup job:", err);
    }
  }

  // REL-2 FIX: Run immediately on startup so expired tokens from before
  // the first deployment don't accumulate for a full 24-hour cycle.
  runCleanup();

  // REL-2 FIX: Wrap the interval callback so synchronous errors never crash the event loop.
  // runCleanup already has an internal try/catch for async errors, but this adds a belt-and-suspenders guard.
  setInterval(() => {
    runCleanup().catch(err => {
      // eslint-disable-next-line no-console
      console.error("[Token Cleanup] Unhandled error in cleanup job:", err);
    });
  }, ONE_DAY_MS);
}
