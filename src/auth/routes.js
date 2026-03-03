import express from "express";
import passport from "passport";
import { z } from "zod";
import { configurePassport, signJwt } from "./passport.js";
import { createUser, findUserByEmail, findUserById } from "./service.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";
import bcrypt from "bcryptjs";
import { pool } from "../dbClient.js";
import {
  clearRefreshCookie,
  createRefreshTokenValue,
  findValidRefreshToken,
  parseCookies,
  persistRefreshToken,
  revokeRefreshTokenById,
  revokeRefreshTokenValue,
  setRefreshCookie,
} from "./refreshTokens.js";

const router = express.Router();

let passportConfigured = false;

function ensurePassportConfigured() {
  if (!passportConfigured) {
    configurePassport();
    passportConfigured = true;
  }
}

export function registerAuthRoutes(app) {
  ensurePassportConfigured();

  app.use(passport.initialize());
  app.use(passport.session());

  const credentialsSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    fullName: z.string().trim().min(1).max(150).optional(),
    role: z.string().optional(),
  });

  // Dev-only registration endpoint (disable in prod via ALLOW_DEV_REGISTER=false)
  router.post(
    "/register",
    // rateLimit({ keyPrefix: "auth:register", windowSeconds: 60, max: 5 }),
    asyncHandler(async (req, res) => {
      if (env.isProd && !env.allowDevRegister) {
        return res.status(403).json({ message: "Registration disabled" });
      }

      const parsed = credentialsSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }

      const { email, password, fullName, role } = parsed.data;

      const existing = await findUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "User already exists" });
      }

      const user = await createUser({ email, password, fullName, role });

      const accessToken = signJwt(user);
      const refreshToken = createRefreshTokenValue();

      await persistRefreshToken({
        subjectId: user.id,
        subjectType: "user",
        refreshToken,
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      });

      const includeRefreshInBody = String(req.query?.includeRefresh || "").toLowerCase() === "true";
      setRefreshCookie(res, refreshToken);

      return res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
        token: accessToken,
        ...(includeRefreshInBody ? { refreshToken } : {}),
      });
    }),
  );

  router.post(
    "/login",
    // rateLimit({ keyPrefix: "auth:login", windowSeconds: 60, max: 10 }),
    passport.authenticate("local", { session: true }),
    asyncHandler(async (req, res) => {
      const user = req.user;

      const accessToken = signJwt(user);
      const refreshToken = createRefreshTokenValue();

      await persistRefreshToken({
        subjectId: user.id,
        subjectType: "user",
        refreshToken,
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      });

      // Web/PWA uses HttpOnly cookie. Mobile can request refresh token in body.
      const includeRefreshInBody = String(req.query?.includeRefresh || "").toLowerCase() === "true";
      setRefreshCookie(res, refreshToken);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
        token: accessToken,
        ...(includeRefreshInBody ? { refreshToken } : {}),
      });
    }),
  );

// Staff login (waiter / kitchen / staff-admin) using email + passcode
// Staff login (waiter / kitchen / staff-admin) using email + passcode
router.post(
  "/staff/login",
  rateLimit({ keyPrefix: "auth:staff-login", windowSeconds: 60, max: 20 }),
  asyncHandler(async (req, res) => {
    // Terminal mode staff login: prefer staffId + passcode.
    // Backwards compatible: email + passcode.
    const schema = z
      .object({
        staffCode: z.string().min(2).optional(),
        staffId: z.string().min(1).optional(), // legacy
        email: z.string().email().optional(), // legacy
        restaurantId: z.string().min(1).optional(),
        passcode: z.string().min(4).max(50),
      })
      .refine((v) => !!(v.staffCode || v.staffId || v.email), {
        message: "staffCode, staffId, or email is required",
      });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
    }

    const { staffCode, staffId, email, restaurantId, passcode } = parsed.data;

    const result = staffCode
      ? restaurantId
        ? await pool.query(
            `SELECT id, staff_code AS "staffCode", restaurant_id AS "restaurantId", full_name AS "fullName", email, role, passcode_hash AS "passcodeHash", is_active AS "isActive"
             FROM staff
             WHERE staff_code = $1 AND restaurant_id = $2
             LIMIT 1`,
            [staffCode, restaurantId],
          )
        : await pool.query(
            `SELECT id, staff_code AS "staffCode", restaurant_id AS "restaurantId", full_name AS "fullName", email, role, passcode_hash AS "passcodeHash", is_active AS "isActive"
             FROM staff
             WHERE staff_code = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [staffCode],
          )
      : staffId
        ? restaurantId
          ? await pool.query(
              `SELECT id, staff_code AS "staffCode", restaurant_id AS "restaurantId", full_name AS "fullName", email, role, passcode_hash AS "passcodeHash", is_active AS "isActive"
               FROM staff
               WHERE id = $1 AND restaurant_id = $2
               LIMIT 1`,
              [staffId, restaurantId],
            )
          : await pool.query(
              `SELECT id, staff_code AS "staffCode", restaurant_id AS "restaurantId", full_name AS "fullName", email, role, passcode_hash AS "passcodeHash", is_active AS "isActive"
               FROM staff
               WHERE id = $1
               LIMIT 1`,
              [staffId],
            )
        : await pool.query(
            `SELECT id, staff_code AS "staffCode", restaurant_id AS "restaurantId", full_name AS "fullName", email, role, passcode_hash AS "passcodeHash", is_active AS "isActive"
             FROM staff
             WHERE lower(email) = lower($1)
             ORDER BY created_at DESC
             LIMIT 1`,
            [email],
          );

    const staff = result.rows[0];
    if (!staff || !staff.isActive) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(passcode, staff.passcodeHash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ CRITICAL: Destroy existing session before creating JWT
    if (req.session) {
      await new Promise((resolve) => {
        req.session.destroy(() => resolve());
      });
    }

    const accessToken = signJwt({
      id: staff.id,
      email: staff.email,
      role: staff.role,
      restaurantId: staff.restaurantId,
      isStaff: true,
      staffId: staff.id,
    });

    const refreshToken = createRefreshTokenValue();
    await persistRefreshToken({
      subjectId: staff.id,
      subjectType: "staff",
      refreshToken,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

    const includeRefreshInBody = String(req.query?.includeRefresh || "").toLowerCase() === "true";
    setRefreshCookie(res, refreshToken);

    return res.json({
      user: {
        id: staff.id,
        staffCode: staff.staffCode || null,
        email: staff.email,
        fullName: staff.fullName,
        role: staff.role,
        restaurantId: staff.restaurantId,
      },
      token: accessToken,
      ...(includeRefreshInBody ? { refreshToken } : {}),
      restaurantId: staff.restaurantId,
    });
  }),
);

  router.post(
    "/logout",
    asyncHandler(async (req, res, next) => {
      // Revoke refresh token if present (cookie or body)
      const cookies = parseCookies(req);
      const rt = cookies[env.refreshTokenCookieName] || req.body?.refreshToken;
      if (rt) {
        try {
          await revokeRefreshTokenValue(rt);
        } catch {
          // ignore
        }
      }

      clearRefreshCookie(res);

      req.logout((err) => {
        if (err) return next(err);
        req.session?.destroy(() => {
          res.json({ success: true });
        });
      });
    }),
  );

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = req.user;
      res.json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        restaurantId: user.restaurantId,
        isStaff: user.isStaff || false,
        staffId: user.staffId || null,
      });
    }),
  );

  // Exchange refresh token for a new access token (and rotate refresh token)
  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      const cookies = parseCookies(req);
      const incoming = req.body?.refreshToken || cookies[env.refreshTokenCookieName];
      if (!incoming) {
        return res.status(401).json({ message: "Missing refresh token" });
      }

      const existing = await findValidRefreshToken(incoming);
      if (!existing) {
        clearRefreshCookie(res);
        return res.status(401).json({ message: "Invalid refresh token" });
      }

      // Load subject
      let subject = null;
      if (existing.subjectType === "user") {
        subject = await findUserById(existing.subjectId);
      } else {
        const r = await pool.query(
          `SELECT id, restaurant_id AS "restaurantId", full_name AS "fullName", email, role, is_active AS "isActive"
           FROM staff
           WHERE id = $1
           LIMIT 1`,
          [existing.subjectId],
        );
        subject = r.rows[0] || null;
        if (subject && !subject.isActive) subject = null;
        if (subject) {
          subject = {
            id: subject.id,
            email: subject.email,
            role: subject.role,
            restaurantId: subject.restaurantId,
            isStaff: true,
            staffId: subject.id,
            fullName: subject.fullName,
          };
        }
      }

      if (!subject) {
        await revokeRefreshTokenById(existing.id);
        clearRefreshCookie(res);
        return res.status(401).json({ message: "Session no longer valid" });
      }

      // Rotate refresh token
      const nextRefreshToken = createRefreshTokenValue();
      const persisted = await persistRefreshToken({
        subjectId: existing.subjectId,
        subjectType: existing.subjectType,
        refreshToken: nextRefreshToken,
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      });

      await revokeRefreshTokenById(existing.id, { replacedByTokenId: persisted.id });
      setRefreshCookie(res, nextRefreshToken);

      const nextAccessToken = signJwt(subject);

      const includeRefreshInBody = String(req.query?.includeRefresh || "").toLowerCase() === "true";

      return res.json({
        token: nextAccessToken,
        ...(includeRefreshInBody ? { refreshToken: nextRefreshToken } : {}),
      });
    }),
  );

  app.use("/api/auth", router);
}

