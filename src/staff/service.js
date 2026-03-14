import { pool as writePool, readPool as pool } from "../dbClient.js";

export async function listStaff(restaurantId) {
  const result = await pool.query(
    `SELECT id, staff_code AS "staffCode", full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
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
  // We need to order by the numeric part of the staff code.
  // staff_code format is 'W-1000'
  const r = await writePool.query(
    `SELECT staff_code AS "staffCode"
     FROM staff
     WHERE staff_code LIKE $1
     ORDER BY CAST(SUBSTRING(staff_code FROM length($1)) AS INTEGER) DESC
     LIMIT 1`,
    [prefix + "-%"]
  );

  const last = r.rows[0]?.staffCode;
  const lastNum = last ? Number(String(last).replace(prefix + "-", "")) : 999;
  const nextNum = Number.isFinite(lastNum) && lastNum >= 1000 ? lastNum + 1 : 1000;
  return `${prefix}-${nextNum}`;
}

export async function createStaff(restaurantId, data) {
  const { fullName, phoneNumber, email, role, passcodeHash } = data;

  // Generate a human-friendly staff code (unique per restaurant).
  // Retry on conflict.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const staffCode = await generateNextStaffCode(restaurantId, role);

    try {
      const result = await writePool.query(
        `INSERT INTO staff
          (restaurant_id, staff_code, full_name, phone_number, email, role, passcode_hash, is_active)
         VALUES
          ($1,            $2,         $3,        $4,           $5,   $6,   $7,            true)
         RETURNING id, staff_code AS "staffCode", full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
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

  const result = await writePool.query(
    `UPDATE staff
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, staff_code AS "staffCode", full_name AS "fullName", phone_number AS "phoneNumber", email, role, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
    values,
  );
  return result.rows[0] || null;
}

export async function deactivateStaff(restaurantId, staffId) {
  const result = await writePool.query(
    `UPDATE staff
     SET is_active = false, updated_at = now()
     WHERE restaurant_id = $1 AND id = $2
     RETURNING id, staff_code AS "staffCode", full_name AS "fullName", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [restaurantId, staffId],
  );
  return result.rows[0] || null;
}

