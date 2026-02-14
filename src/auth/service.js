import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { pool } from "../dbClient.js";

export async function findUserByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, password_hash AS "passwordHash", full_name AS "fullName", role
     FROM users
     WHERE email = $1`,
    [email],
  );
  return result.rows[0] || null;
}

export async function findUserById(id) {
  const result = await pool.query(
    `SELECT id, email, password_hash AS "passwordHash", full_name AS "fullName", role
     FROM users
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function createUser({ email, password, fullName, role = "owner" }) {
  const saltRounds = env.bcryptRounds;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1,      $2,            $3,        $4)
     RETURNING id, email, password_hash AS "passwordHash", full_name AS "fullName", role`,
    [email, passwordHash, fullName || null, role],
  );

  return result.rows[0];
}

export async function verifyPassword(user, plainPassword) {
  if (!user || !user.passwordHash) return false;
  return bcrypt.compare(plainPassword, user.passwordHash);
}

