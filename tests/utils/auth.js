import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-for-testing-only";

/**
 * Generate a test JWT token
 */
export function generateTestToken(payload = {}) {
  const defaultPayload = {
    sub: payload.sub || uuidv4(),
    email: payload.email || "test@example.com",
    role: payload.role || "owner",
    restaurantId: payload.restaurantId || null,
  };

  return jwt.sign(defaultPayload, JWT_SECRET, { expiresIn: "1h" });
}

/**
 * Generate auth headers for API requests
 */
export function getAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Create test user payload
 */
export function createTestUser(overrides = {}) {
  return {
    email: `test-${Date.now()}@example.com`,
    password: "TestPassword123!",
    fullName: "Test User",
    ...overrides,
  };
}

/**
 * Create test restaurant payload
 */
export function createTestRestaurant(overrides = {}) {
  return {
    name: `Test Restaurant ${Date.now()}`,
    slug: `test-restaurant-${Date.now()}`,
    type: "Restaurant",
    ...overrides,
  };
}
