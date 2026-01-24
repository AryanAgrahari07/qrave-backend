import express from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { createStaff, listStaff, updateStaff, deactivateStaff } from "./service.js";

const router = express.Router({ mergeParams: true });

const staffCreateSchema = z.object({
  // Accept both legacy `fullName` and UI-friendly `displayName`
  fullName: z.string().min(2).max(150).optional(),
  displayName: z.string().min(2).max(150).optional(),
  phoneNumber: z.string().max(20).optional(),
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "WAITER", "KITCHEN"]),
  passcode: z.string().min(4).max(50).optional(),
})
  .refine((val) => !!(val.fullName ?? val.displayName), {
    path: ["fullName"],
    message: "Required",
  })
  .transform((val) => {
    const fullName = val.fullName ?? val.displayName;
    // `refine` guarantees one exists
    return {
      fullName,
      phoneNumber: val.phoneNumber,
      email: val.email,
      role: val.role,
      passcode: val.passcode,
    };
  });

const staffUpdateSchema = z
  .object({
    fullName: z.string().min(2).max(150).optional(),
    displayName: z.string().min(2).max(150).optional(),
    phoneNumber: z.string().max(20).optional(),
    email: z.string().email().optional(),
    role: z.enum(["ADMIN", "WAITER", "KITCHEN"]).optional(),
    passcode: z.string().min(4).max(50).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (val) => Object.keys(val).length > 0,
    { message: "No fields to update" },
  )
  .transform((val) => {
    // Normalize `displayName` -> `fullName` for updates as well
    const fullName = val.fullName ?? val.displayName;
    const out = { ...val };
    if (fullName) out.fullName = fullName;
    delete out.displayName;
    return out;
  });

export function registerStaffRoutes(app) {
  // Staff scoped to a restaurant
  app.use(
    "/api/restaurants/:restaurantId/staff",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    router,
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const staff = await listStaff(restaurantId);
      res.json({ staff });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = staffCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const { fullName, phoneNumber, email, role, passcode } = parsed.data;
      // Generate a default passcode if not provided
      const finalPasscode = passcode || "1234"; // Default passcode
      const passcodeHash = await bcrypt.hash(finalPasscode, env.bcryptRounds);
      const staff = await createStaff(restaurantId, {
        fullName,
        phoneNumber,
        email,
        role,
        passcodeHash,
      });
      res.status(201).json({ staff });
    }),
  );

  router.put(
    "/:staffId",
    asyncHandler(async (req, res) => {
      const { restaurantId, staffId } = req.params;
      const parsed = staffUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const data = { ...parsed.data };
      if (data.passcode) {
        data.passcodeHash = await bcrypt.hash(data.passcode, env.bcryptRounds);
        delete data.passcode;
      }
      const staff = await updateStaff(restaurantId, staffId, data);
      if (!staff) return res.status(404).json({ message: "Not found" });
      res.json({ staff });
    }),
  );

  router.delete(
    "/:staffId",
    asyncHandler(async (req, res) => {
      const { restaurantId, staffId } = req.params;
      const staff = await deactivateStaff(restaurantId, staffId);
      if (!staff) return res.status(404).json({ message: "Not found" });
      res.json({ staff, deleted: true });
    }),
  );
}

