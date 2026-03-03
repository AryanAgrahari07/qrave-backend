import { pool } from "../dbClient.js";

export async function listStaff(restaurantId) {
  const result = await pool.query(
    `SELECT id, staff_code AS "staffCode", full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive"
     FROM staff
     WHERE restaurant_id = $1
     ORDER BY created_at DESC`,
    [restaurantId],
  );
  return result.rows;
}

function rolePrefix(role) {
  if (role === "WAITER") return "W";
  if (role === "KITCHEN") return "K";
  if (role === "ADMIN") return "A";
  return "S";
}

async function generateNextStaffCode(restaurantId, role) {
  const prefix = rolePrefix(role);
  const like = `${prefix}-%`;
  const r = await pool.query(
    `SELECT staff_code AS "staffCode"
     FROM staff
     WHERE restaurant_id = $1 AND staff_code LIKE $2
     ORDER BY staff_code DESC
     LIMIT 1`,
    [restaurantId, like],
  );

  const last = r.rows[0]?.staffCode;
  const lastNum = last ? Number(String(last).split("-")[1]) : 999;
  const nextNum = Number.isFinite(lastNum) ? lastNum + 1 : 1000;
  return `${prefix}-${nextNum}`;
}

export async function createStaff(restaurantId, data) {
  const { fullName, phoneNumber, email, role, passcodeHash } = data;

  // Generate a human-friendly staff code (unique per restaurant).
  // Retry on conflict.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const staffCode = await generateNextStaffCode(restaurantId, role);

    try {
      const result = await pool.query(
        `INSERT INTO staff
          (restaurant_id, staff_code, full_name, phone_number, email, role, passcode_hash, is_active)
         VALUES
          ($1,            $2,         $3,        $4,           $5,   $6,   $7,            true)
         RETURNING id, staff_code AS "staffCode", full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive"`,
        [restaurantId, staffCode, fullName, phoneNumber || null, email || null, role, passcodeHash],
      );
      return result.rows[0];
    } catch (e) {
      // Unique violation -> retry
      if (String(e?.code) === "23505") continue;
      throw e;
    }
  }

  throw new Error("Failed to generate unique staff code");
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
     RETURNING id, staff_code AS "staffCode", full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive"`,
    values,
  );
  return result.rows[0] || null;
}

export async function deactivateStaff(restaurantId, staffId) {
  const result = await pool.query(
    `UPDATE staff
     SET is_active = false, updated_at = now()
     WHERE restaurant_id = $1 AND id = $2
     RETURNING id, staff_code AS "staffCode", full_name AS "fullName", is_active AS "isActive"`,
    [restaurantId, staffId],
  );
  return result.rows[0] || null;
}

