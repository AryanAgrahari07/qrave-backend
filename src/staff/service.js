import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool(env.databaseUrl);

export async function listStaff(restaurantId) {
  const result = await pool.query(
    `SELECT id, full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive"
     FROM staff
     WHERE restaurant_id = $1
     ORDER BY created_at DESC`,
    [restaurantId],
  );
  return result.rows;
}

export async function createStaff(restaurantId, data) {
  const { fullName, phoneNumber, email, role, passcodeHash } = data;
  const result = await pool.query(
    `INSERT INTO staff
      (restaurant_id, full_name, phone_number, email, role, passcode_hash, is_active)
     VALUES
      ($1,            $2,        $3,           $4,   $5,   $6,            true)
     RETURNING id, full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive"`,
    [restaurantId, fullName, phoneNumber || null, email || null, role, passcodeHash],
  );
  return result.rows[0];
}

export async function updateStaff(restaurantId, staffId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const updatable = {
    fullName: "full_name",
    phoneNumber: "phone_number",
    email: "email",
    role: "role",
    passcodeHash: "passcode_hash",
    isActive: "is_active",
  };

  for (const [key, column] of Object.entries(updatable)) {
    if (data[key] !== undefined) {
      fields.push(`${column} = $${idx}`);
      values.push(data[key]);
      idx += 1;
    }
  }

  if (!fields.length) {
    return null;
  }

  values.push(restaurantId);
  values.push(staffId);

  const result = await pool.query(
    `UPDATE staff
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive"`,
    values,
  );
  return result.rows[0] || null;
}

export async function deactivateStaff(restaurantId, staffId) {
  const result = await pool.query(
    `UPDATE staff
     SET is_active = false, updated_at = now()
     WHERE restaurant_id = $1 AND id = $2
     RETURNING id, full_name AS "fullName", is_active AS "isActive"`,
    [restaurantId, staffId],
  );
  return result.rows[0] || null;
}

