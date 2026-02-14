import express from "express";
import passport from "passport";
import { z } from "zod";
import { configurePassport, signJwt } from "./passport.js";
import { createUser, findUserByEmail } from "./service.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import bcrypt from "bcryptjs";
import { pool } from "../dbClient.js";

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
      const token = signJwt(user);

      return res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
        token,
      });
    }),
  );

  router.post(
    "/login",
    // rateLimit({ keyPrefix: "auth:login", windowSeconds: 60, max: 10 }),
    passport.authenticate("local", { session: true }),
    (req, res) => {
      const user = req.user;
      const token = signJwt(user);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
        token,
      });
    },
  );

// Staff login (waiter / kitchen / staff-admin) using email + passcode
// Staff login (waiter / kitchen / staff-admin) using email + passcode
router.post(
  "/staff/login",
  rateLimit({ keyPrefix: "auth:staff-login", windowSeconds: 60, max: 20 }),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      passcode: z.string().min(4).max(50),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
    }

    const { email, passcode } = parsed.data;

    const result = await pool.query(
      `SELECT id, restaurant_id AS "restaurantId", full_name AS "fullName", email, role, passcode_hash AS "passcodeHash", is_active AS "isActive"
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

    const token = signJwt({
      id: staff.id,
      email: staff.email,
      role: staff.role,
      restaurantId: staff.restaurantId,
      isStaff: true,
      staffId: staff.id,
    });

    return res.json({
      user: {
        id: staff.id,
        email: staff.email,
        fullName: staff.fullName,
        role: staff.role,
        restaurantId: staff.restaurantId,
      },
      token,
      restaurantId: staff.restaurantId,
    });
  }),
);

  router.post(
    "/logout",
    asyncHandler((req, res, next) => {
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
    asyncHandler((req, res) => {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const user = req.user;
      res.json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        restaurantId: user.restaurantId,
      });
    }),
  );

  app.use("/api/auth", router);
}

