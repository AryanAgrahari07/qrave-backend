import bcrypt from "bcryptjs";
import { users, restaurants, tables, menuCategories, staff } from "../../shared/schema.js";
import { db } from "../dbClient.js";
import { env } from "../config/env.js";
import { generateTableQR } from "../qr/service.js";

/**
 * Complete onboarding flow for a new restaurant
 * This handles: user creation, restaurant setup, tables, and initial staff
 * 
 * @param {object} data - Onboarding data
 * @param {object} data.user - User information (email, password, fullName)
 * @param {object} data.restaurant - Restaurant details (name, slug, type, address, etc.)
 * @param {array} data.tables - Array of table configurations (optional)
 * @param {array} data.categories - Initial menu categories (optional)
 * @param {object} data.settings - Additional settings (optional)
 * @returns {Promise<object>} Complete onboarding result with user, restaurant, tables, QR codes
 */
export async function completeOnboarding(data) {
  const {
    user: userData,
    restaurant: restaurantData,
    tables: tablesData = [],
    categories: categoriesData = [],
    settings = {},
  } = data;

  // Start a transaction-like operation (ideally use actual transactions in production)
  try {
    // Step 1: Create user account
    const passwordHash = await bcrypt.hash(userData.password, env.bcryptRounds);
    
    const userRows = await db
      .insert(users)
      .values({
        email: userData.email,
        passwordHash,
        fullName: userData.fullName || "",
        role: userData.role || "owner",
      })
      .returning();
    
    const user = userRows[0];

    // Step 2: Create restaurant
    const restaurantRows = await db
      .insert(restaurants)
      .values({
        ownerId: user.id,
        name: restaurantData.name,
        slug: restaurantData.slug,
        type: restaurantData.type || "Restaurant",
        addressLine1: restaurantData.addressLine1,
        addressLine2: restaurantData.addressLine2,
        city: restaurantData.city,
        state: restaurantData.state,
        postalCode: restaurantData.postalCode,
        country: restaurantData.country || "India",
        currency: restaurantData.currency || "₹",
        taxRateGst: restaurantData.taxRateGst || "5.00",
        taxRateService: restaurantData.taxRateService || "10.00",
        plan: restaurantData.plan || "STARTER",
        qrDesign: settings.qrDesign || null,
        settings: settings.restaurantSettings || null,
      })
      .returning();
    
    const restaurant = restaurantRows[0];

    // Step 3: Create tables (if provided)
    let createdTables = [];
    if (tablesData && tablesData.length > 0) {
      // Get base URL for QR codes
      const baseUrl = env.appUrl || "https://qrave.app";
      
      const tablesWithQR = tablesData.map((table) => ({
        restaurantId: restaurant.id,
        tableNumber: table.tableNumber,
        capacity: table.capacity || 4,
        floorSection: table.floorSection || "Main Floor",
        positionX: table.positionX || null,
        positionY: table.positionY || null,
        currentStatus: table.currentStatus || "AVAILABLE",
        // Generate QR payload for each table
        qrCodePayload: `${baseUrl}/r/${restaurant.slug}?table=${table.tableNumber}`,
        qrCodeVersion: 1,
      }));

      createdTables = await db
        .insert(tables)
        .values(tablesWithQR)
        .returning();
    }

    // Step 4: Create default menu categories (if provided)
    let createdCategories = [];
    if (categoriesData && categoriesData.length > 0) {
      const categoriesWithRestaurant = categoriesData.map((cat, index) => ({
        restaurantId: restaurant.id,
        name: cat.name,
        sortOrder: cat.sortOrder !== undefined ? cat.sortOrder : index,
      }));

      createdCategories = await db
        .insert(menuCategories)
        .values(categoriesWithRestaurant)
        .returning();
    }

    // Step 5: Create admin staff member for the owner (optional)
    let adminStaff = null;
    if (settings.createAdminStaff !== false) {
      const adminPasscodeHash = await bcrypt.hash(
        settings.adminPasscode || "1234",
        env.bcryptRounds
      );
      
      const staffRows = await db
        .insert(staff)
        .values({
          restaurantId: restaurant.id,
          fullName: userData.fullName || "Admin",
          email: userData.email,
          role: "ADMIN",
          passcodeHash: adminPasscodeHash,
        })
        .returning();
      
      adminStaff = staffRows[0];
    }

    // Step 6: Generate QR codes for all tables
    let qrCodes = [];
    if (createdTables.length > 0) {
      qrCodes = await Promise.all(
        createdTables.map(async (table) => {
          try {
            return await generateTableQR(restaurant.id, table.id);
          } catch (error) {
            console.error(`Failed to generate QR for table ${table.id}:`, error);
            return null;
          }
        })
      );
      // Filter out any failed QR generations
      qrCodes = qrCodes.filter((qr) => qr !== null);
    }

    // Return complete onboarding result
    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        type: restaurant.type,
        plan: restaurant.plan,
        currency: restaurant.currency,
      },
      tables: createdTables.map((t) => ({
        id: t.id,
        tableNumber: t.tableNumber,
        capacity: t.capacity,
        floorSection: t.floorSection,
        qrCodePayload: t.qrCodePayload,
      })),
      categories: createdCategories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
      })),
      staff: adminStaff ? [{
        id: adminStaff.id,
        fullName: adminStaff.fullName,
        role: adminStaff.role,
      }] : [],
      qrCodes,
      nextSteps: [
        "Add menu items to your categories",
        "Customize your QR code design",
        "Add more staff members",
        "Print and place QR codes on tables",
      ],
    };
  } catch (error) {
    console.error("Onboarding error:", error);
    throw error;
  }
}

/**
 * Validate onboarding data before processing
 * @param {object} data - Onboarding data to validate
 * @returns {object} Validation result
 */
export function validateOnboardingData(data) {
  const errors = [];

  // Validate user data
  if (!data.user) {
    errors.push("User information is required");
  } else {
    if (!data.user.email || !data.user.email.includes("@")) {
      errors.push("Valid email is required");
    }
    if (!data.user.password || data.user.password.length < 6) {
      errors.push("Password must be at least 6 characters");
    }
  }

  // Validate restaurant data
  if (!data.restaurant) {
    errors.push("Restaurant information is required");
  } else {
    if (!data.restaurant.name || data.restaurant.name.length < 2) {
      errors.push("Restaurant name must be at least 2 characters");
    }
    if (!data.restaurant.slug || data.restaurant.slug.length < 2) {
      errors.push("Restaurant slug must be at least 2 characters");
    }
    // Slug should be URL-friendly
    if (data.restaurant.slug && !/^[a-z0-9-]+$/.test(data.restaurant.slug)) {
      errors.push("Slug must contain only lowercase letters, numbers, and hyphens");
    }
  }

  // Validate tables data (if provided)
  if (data.tables && Array.isArray(data.tables)) {
    data.tables.forEach((table, index) => {
      if (!table.tableNumber) {
        errors.push(`Table ${index + 1}: tableNumber is required`);
      }
      if (table.capacity && table.capacity < 1) {
        errors.push(`Table ${index + 1}: capacity must be at least 1`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate default table configuration for onboarding
 * @param {number} count - Number of tables to generate
 * @param {object} options - Configuration options
 * @returns {Array} Array of table configurations
 */
export function generateDefaultTables(count = 10, options = {}) {
  const {
    prefix = "T",
    capacity = 4,
    floorSection = "Main Floor",
  } = options;

  return Array.from({ length: count }, (_, i) => ({
    tableNumber: `${prefix}${i + 1}`,
    capacity,
    floorSection,
    currentStatus: "AVAILABLE",
  }));
}

/**
 * Generate default menu categories for onboarding
 * @param {string} restaurantType - Type of restaurant
 * @returns {Array} Array of category configurations
 */
export function generateDefaultCategories(restaurantType = "Restaurant") {
  const categoryMap = {
    "Restaurant": [
      { name: "Appetizers" },
      { name: "Main Course" },
      { name: "Desserts" },
      { name: "Beverages" },
    ],
    "Cafe": [
      { name: "Coffee" },
      { name: "Snacks" },
      { name: "Sandwiches" },
      { name: "Pastries" },
    ],
    "Bar": [
      { name: "Cocktails" },
      { name: "Beer" },
      { name: "Wine" },
      { name: "Spirits" },
      { name: "Bar Snacks" },
    ],
    "Fine Dining": [
      { name: "Amuse-Bouche" },
      { name: "Appetizers" },
      { name: "Soups & Salads" },
      { name: "Main Course" },
      { name: "Desserts" },
      { name: "Beverages" },
    ],
  };

  return categoryMap[restaurantType] || categoryMap["Restaurant"];
}
