import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { findUserByEmail, findUserById, verifyPassword } from "./service.js";

export function configurePassport() {
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
        session: true,
      },
      async (email, password, done) => {
        try {
          const user = await findUserByEmail(email);
          if (!user) return done(null, false, { message: "Invalid credentials" });

          const isValid = await verifyPassword(user, password);
          if (!isValid) return done(null, false, { message: "Invalid credentials" });

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await findUserById(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });
}

export function signJwt(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
    isStaff: user.isStaff || false,
    staffId: user.staffId || null,
  };

  const expiresIn = env.jwtExpiresIn;

  return jwt.sign(payload, env.jwtSecret, { expiresIn });
}

