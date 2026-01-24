import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { findUserByEmail } from "../auth/service.js";
import { getRestaurantBySlug } from "../restaurant/service.js";
import { signJwt } from "../auth/passport.js";
import {
  completeOnboarding,
  validateOnboardingData,
  generateDefaultTables,
  generateDefaultCategories,
} from "./service.js";

const router = express.Router();

// Zod schemas for validation
const onboardingSchema = z.object({
  user: z.object({
    email: z.string().email(),
    password: z.string().min(6).max(100),
    fullName: z.string().min(1).max(150),
    role: z.string().optional().default("owner"),
  }),
  restaurant: z.object({
    name: z.string().min(2).max(200),
    slug: z.string().min(2).max(150).regex(/^[a-z0-9-]+$/, "Slug must be URL-friendly"),
    type: z.string().max(50).optional(),
    addressLine1: z.string().max(255).optional(),
    addressLine2: z.string().max(255).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
    currency: z.string().max(10).optional(),
    taxRateGst: z.string().optional(),
    taxRateService: z.string().optional(),
    plan: z.string().max(50).optional(),
  }),
  tables: z.array(
    z.object({
      tableNumber: z.string().min(1).max(50),
      capacity: z.number().int().positive().optional().default(4),
      floorSection: z.string().max(100).optional(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
      currentStatus: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "BLOCKED"]).optional(),
    })
  ).optional().default([]),
  categories: z.array(
    z.object({
      name: z.string().min(1).max(150),
      sortOrder: z.number().int().optional(),
    })
  ).optional().default([]),
  settings: z.object({
    qrDesign: z.object({
      darkColor: z.string().optional(),
      lightColor: z.string().optional(),
    }).optional(),
    restaurantSettings: z.any().optional(),
    createAdminStaff: z.boolean().optional(),
    adminPasscode: z.string().optional(),
  }).optional().default({}),
});

const onboardingQuickStartSchema = z.object({
  user: z.object({
    email: z.string().email(),
    password: z.string().min(6).max(100),
    fullName: z.string().min(1).max(150),
  }),
  restaurant: z.object({
    name: z.string().min(2).max(200),
    slug: z.string().min(2).max(150).regex(/^[a-z0-9-]+$/, "Slug must be URL-friendly"),
    type: z.string().max(50).optional().default("Restaurant"),
  }),
  tableCount: z.number().int().min(1).max(100).optional().default(10),
  useDefaultCategories: z.boolean().optional().default(true),
});

export function registerOnboardingRoutes(app) {
  // Complete onboarding flow
  router.post(
    "/",
    rateLimit({ keyPrefix: "onboarding:complete", windowSeconds: 300, max: 5 }),
    asyncHandler(async (req, res) => {
      // Parse and validate request
      const parsed = onboardingSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid onboarding data",
          errors: parsed.error.errors,
        });
      }

      const data = parsed.data;

      // Additional validation
      const validation = validateOnboardingData(data);
      if (!validation.valid) {
        return res.status(400).json({
          message: "Validation failed",
          errors: validation.errors,
        });
      }

      // Check if user already exists
      const existingUser = await findUserByEmail(data.user.email);
      if (existingUser) {
        return res.status(409).json({
          message: "User with this email already exists",
        });
      }

      // Check if restaurant slug is already taken
      const existingRestaurant = await getRestaurantBySlug(data.restaurant.slug);
      if (existingRestaurant) {
        return res.status(409).json({
          message: "Restaurant slug is already taken",
        });
      }

      // Process onboarding
      const result = await completeOnboarding(data);

      // Generate JWT token for immediate login
      const token = signJwt({
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
      });

      res.status(201).json({
        ...result,
        token,
        message: "Onboarding completed successfully!",
      });
    })
  );

  // Quick start onboarding (with defaults)
  router.post(
    "/quick-start",
    rateLimit({ keyPrefix: "onboarding:quick-start", windowSeconds: 300, max: 5 }),
    asyncHandler(async (req, res) => {
      const parsed = onboardingQuickStartSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid quick start data",
          errors: parsed.error.errors,
        });
      }

      const { user, restaurant, tableCount, useDefaultCategories } = parsed.data;

      // Check if user already exists
      const existingUser = await findUserByEmail(user.email);
      if (existingUser) {
        return res.status(409).json({
          message: "User with this email already exists",
        });
      }

      // Check if restaurant slug is already taken
      const existingRestaurant = await getRestaurantBySlug(restaurant.slug);
      if (existingRestaurant) {
        return res.status(409).json({
          message: "Restaurant slug is already taken",
        });
      }

      // Generate default configuration
      const tables = generateDefaultTables(tableCount);
      const categories = useDefaultCategories
        ? generateDefaultCategories(restaurant.type)
        : [];

      // Complete onboarding with defaults
      const result = await completeOnboarding({
        user,
        restaurant,
        tables,
        categories,
        settings: {
          createAdminStaff: true,
          adminPasscode: "1234", // Default admin passcode
        },
      });

      // Generate JWT token for immediate login
      const token = signJwt({
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
      });

      res.status(201).json({
        ...result,
        token,
        message: "Quick start onboarding completed successfully!",
      });
    })
  );

  // Check availability endpoints

  // Check if email is available
  router.post(
    "/check-email",
    rateLimit({ keyPrefix: "onboarding:check-email", windowSeconds: 60, max: 20 }),
    asyncHandler(async (req, res) => {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const existingUser = await findUserByEmail(email);
      res.json({
        available: !existingUser,
        message: existingUser ? "Email already in use" : "Email is available",
      });
    })
  );

  // Check if slug is available
  router.post(
    "/check-slug",
    rateLimit({ keyPrefix: "onboarding:check-slug", windowSeconds: 60, max: 20 }),
    asyncHandler(async (req, res) => {
      const { slug } = req.body;
      
      if (!slug) {
        return res.status(400).json({ message: "Slug is required" });
      }

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({
          available: false,
          message: "Slug must contain only lowercase letters, numbers, and hyphens",
        });
      }

      const existingRestaurant = await getRestaurantBySlug(slug);
      res.json({
        available: !existingRestaurant,
        message: existingRestaurant ? "Slug already taken" : "Slug is available",
      });
    })
  );

  // Get default configuration suggestions
  router.get(
    "/defaults/:restaurantType",
    rateLimit({ keyPrefix: "onboarding:defaults", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantType } = req.params;
      const { tableCount = 10 } = req.query;

      const tables = generateDefaultTables(parseInt(tableCount));
      const categories = generateDefaultCategories(restaurantType);

      res.json({
        restaurantType,
        tables,
        categories,
        suggestions: {
          currency: "₹",
          taxRateGst: "5.00",
          taxRateService: "10.00",
          plan: "STARTER",
        },
      });
    })
  );

  app.use("/api/onboarding", router);
}
