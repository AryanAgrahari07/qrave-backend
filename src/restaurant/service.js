import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool(env.databaseUrl);

export async function listRestaurantsByOwner(ownerId) {
  const restaurants = await pool.query(
    `SELECT id, name, slug, type, currency, plan, is_active 
     FROM restaurants 
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [ownerId]
  );
  
  return restaurants.rows;
}

export async function listRestaurants() {
  const result = await pool.query(
    `SELECT id, name, slug, type, currency, plan, is_active AS "isActive"
     FROM restaurants
     ORDER BY created_at DESC`,
  );
  return result.rows;
}

export async function getRestaurant(id) {
  const result = await pool.query(
    `SELECT id, name, slug, type, currency, plan, is_active AS "isActive",
            tax_rate_gst AS "taxRateGst",
            tax_rate_service AS "taxRateService",
            address_line1 AS "addressLine1",
            address_line2 AS "addressLine2",
            city, state, postal_code AS "postalCode", country,
            gst_number AS "gstNumber",
            fssai_number AS "fssaiNumber",
            email, phone_number AS "phoneNumber",
            google_maps_link AS "googleMapsLink",
            qr_design AS "qrDesign", settings
     FROM restaurants
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function getRestaurantBySlug(slug) {
  const result = await pool.query(
    `SELECT id, name, slug, type, currency, plan, is_active AS "isActive",
            tax_rate_gst AS "taxRateGst",
            tax_rate_service AS "taxRateService",
            address_line1 AS "addressLine1",
            address_line2 AS "addressLine2",
            city, state, postal_code AS "postalCode", country,
            gst_number AS "gstNumber",
            fssai_number AS "fssaiNumber",
            email, phone_number AS "phoneNumber",
            google_maps_link AS "googleMapsLink",
            qr_design AS "qrDesign", settings
     FROM restaurants
     WHERE slug = $1`,
    [slug],
  );
  return result.rows[0] || null;
}

export async function createRestaurant(data) {
  const {
    name,
    slug,
    type,
    currency,
    plan,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    taxRateGst,
    taxRateService,
    qrDesign,
    settings,
  } = data;

  const result = await pool.query(
    `INSERT INTO restaurants
      (name, slug, type, currency, plan,
       address_line1, address_line2, city, state, postal_code, country,
       tax_rate_gst, tax_rate_service, qr_design, settings,
       is_active)
     VALUES
      ($1,   $2,  $3,   $4,      $5,
       $6,           $7,           $8,  $9,    $10,         $11,
       $12,          $13,             $14,      $15,
       true)
     RETURNING id, name, slug, type, currency, plan, is_active AS "isActive"`,
    [
      name,
      slug,
      type || null,
      currency || "₹",
      plan || "STARTER",
      addressLine1 || null,
      addressLine2 || null,
      city || null,
      state || null,
      postalCode || null,
      country || "India",
      taxRateGst != null ? taxRateGst : null,
      taxRateService != null ? taxRateService : null,
      qrDesign || null,
      settings || null,
    ],
  );

  return result.rows[0];
}

export async function updateRestaurant(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const updatable = {
    name: "name",
    type: "type",
    currency: "currency",
    plan: "plan",
    taxRateGst: "tax_rate_gst",
    taxRateService: "tax_rate_service",
    qrDesign: "qr_design",
    settings: "settings",
    isActive: "is_active",
    addressLine1: "address_line1",
    addressLine2: "address_line2",
    city: "city",
    state: "state",
    postalCode: "postal_code",
    country: "country",
    gstNumber: "gst_number",
    fssaiNumber: "fssai_number",
    email: "email",
    phoneNumber: "phone_number",
    googleMapsLink: "google_maps_link",
  };

  for (const [key, column] of Object.entries(updatable)) {
    if (data[key] !== undefined) {
      fields.push(`${column} = $${idx}`);
      values.push(data[key]);
      idx += 1;
    }
  }

  if (!fields.length) {
    return getRestaurant(id);
  }

  values.push(id);

  const result = await pool.query(
    `UPDATE restaurants
     SET ${fields.join(", ")}, updated_at = now()
     WHERE id = $${idx}
     RETURNING id, name, slug, type, currency, plan, is_active AS "isActive"`,
    values,
  );
  return result.rows[0] || null;
}

export async function deleteRestaurant(id) {
  // Soft delete via is_active=false
  const result = await pool.query(
    `UPDATE restaurants
     SET is_active = false, updated_at = now()
     WHERE id = $1
     RETURNING id, name, slug, is_active AS "isActive"`,
    [id],
  );
  return result.rows[0] || null;
}

