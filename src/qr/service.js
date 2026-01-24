import QRCode from "qrcode";
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { restaurants, tables } from "../../shared/schema.js";
import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool();
const db = drizzle(pool);

/**
 * Generate QR code data URL (base64 encoded image)
 * @param {string} payload - The URL or data to encode in QR
 * @param {object} options - QR code generation options
 * @returns {Promise<string>} Data URL of the QR code
 */
export async function generateQRCodeDataURL(payload, options = {}) {
  const defaultOptions = {
    errorCorrectionLevel: "M",
    type: "image/png",
    quality: 0.92,
    margin: 1,
    width: 300,
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
    ...options,
  };

  try {
    const dataURL = await QRCode.toDataURL(payload, defaultOptions);
    return dataURL;
  } catch (error) {
    console.error("QR Code generation error:", error);
    throw new Error("Failed to generate QR code");
  }
}

/**
 * Generate QR code as buffer (for S3 upload)
 * @param {string} payload - The URL or data to encode in QR
 * @param {object} options - QR code generation options
 * @returns {Promise<Buffer>} Buffer of the QR code image
 */
export async function generateQRCodeBuffer(payload, options = {}) {
  const defaultOptions = {
    errorCorrectionLevel: "M",
    type: "png",
    quality: 0.92,
    margin: 1,
    width: 300,
    ...options,
  };

  try {
    const buffer = await QRCode.toBuffer(payload, defaultOptions);
    return buffer;
  } catch (error) {
    console.error("QR Code generation error:", error);
    throw new Error("Failed to generate QR code");
  }
}

/**
 * Generate QR code for restaurant (general menu access)
 * @param {string} restaurantId - Restaurant ID
 * @returns {Promise<object>} QR code data and metadata
 */
export async function generateRestaurantQR(restaurantId) {
  // Get restaurant slug
  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const restaurant = restaurantRows[0];
  if (!restaurant) {
    throw new Error("Restaurant not found");
  }

  // Get base URL from environment or use default
  const baseUrl = env.appUrl || "https://qrave.app";
  const menuUrl = `${baseUrl}/r/${restaurant.slug}`;

  // Generate QR code
  const qrDataURL = await generateQRCodeDataURL(menuUrl);

  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    slug: restaurant.slug,
    menuUrl,
    qrCodeDataURL: qrDataURL,
    type: "RESTAURANT",
  };
}

/**
 * Generate QR code for a specific table
 * @param {string} restaurantId - Restaurant ID
 * @param {string} tableId - Table ID
 * @returns {Promise<object>} QR code data and metadata
 */
export async function generateTableQR(restaurantId, tableId) {
  // Get restaurant slug
  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const restaurant = restaurantRows[0];
  if (!restaurant) {
    throw new Error("Restaurant not found");
  }

  // Get table details
  const tableRows = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .limit(1);

  const table = tableRows[0];
  if (!table) {
    throw new Error("Table not found");
  }

  // Build table-specific URL with query params
  const baseUrl = env.appUrl || "https://qrave.app";
  const menuUrl = `${baseUrl}/r/${restaurant.slug}?table=${table.tableNumber}&tid=${tableId}`;

  // Generate QR code with custom design if available
  const qrOptions = restaurant.qrDesign
    ? {
        color: {
          dark: restaurant.qrDesign.darkColor || "#000000",
          light: restaurant.qrDesign.lightColor || "#FFFFFF",
        },
      }
    : {};

  const qrDataURL = await generateQRCodeDataURL(menuUrl, qrOptions);

  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    slug: restaurant.slug,
    tableId: table.id,
    tableNumber: table.tableNumber,
    menuUrl,
    qrCodeDataURL: qrDataURL,
    type: "TABLE",
    qrCodeVersion: table.qrCodeVersion,
  };
}

/**
 * Batch generate QR codes for all tables in a restaurant
 * @param {string} restaurantId - Restaurant ID
 * @returns {Promise<Array>} Array of QR code data for each table
 */
export async function generateAllTableQRs(restaurantId) {
  // Get all active tables
  const restaurantTables = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.isActive, true)
      )
    )
    .orderBy(tables.tableNumber);

  // Generate QR for each table
  const qrCodes = await Promise.all(
    restaurantTables.map((table) =>
      generateTableQR(restaurantId, table.id)
    )
  );

  return qrCodes;
}

/**
 * Update table QR code payload and increment version
 * @param {string} restaurantId - Restaurant ID
 * @param {string} tableId - Table ID
 * @param {string} newPayload - New QR code payload
 * @returns {Promise<object>} Updated table
 */
export async function updateTableQRPayload(restaurantId, tableId, newPayload) {
  const rows = await db
    .update(tables)
    .set({
      qrCodePayload: newPayload,
      qrCodeVersion: sql`${tables.qrCodeVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .returning();

  return rows[0];
}

/**
 * Get QR code statistics for a restaurant
 * @param {string} restaurantId - Restaurant ID
 * @returns {Promise<object>} QR code statistics
 */
export async function getQRStats(restaurantId) {
  const restaurantTables = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.isActive, true)
      )
    );

  return {
    totalTables: restaurantTables.length,
    tablesWithQR: restaurantTables.filter((t) => t.qrCodePayload).length,
    lastUpdated: restaurantTables.reduce(
      (latest, t) =>
        t.updatedAt > latest ? t.updatedAt : latest,
      new Date(0)
    ),
  };
}
