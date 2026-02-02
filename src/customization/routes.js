import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { z } from "zod";
import {
  getVariantsForMenuItem,
  createVariant,
  updateVariant,
  deleteVariant,
  getModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  getModifiersForGroup,
  createModifier,
  updateModifier,
  deleteModifier,
  getModifierGroupsForMenuItem,
  linkModifierGroupToMenuItem,
  unlinkModifierGroupFromMenuItem,
} from "./service.js";

const router = express.Router();


// ============================================
// VARIANTS ROUTES
// ============================================

// Validation schemas - updated to accept total price
const variantSchema = z.object({
  variantName: z.string().min(1).max(100),
  price: z.number().positive(), // Total price of the variant
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const variantUpdateSchema = variantSchema.partial().extend({
  isAvailable: z.boolean().optional(),
});

// Validation schemas
const modifierGroupSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().optional(),
  selectionType: z.enum(["SINGLE", "MULTIPLE"]).optional(),
  minSelections: z.number().int().min(0).optional(),
  maxSelections: z.number().int().positive().optional().nullable(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const modifierGroupUpdateSchema = modifierGroupSchema.partial().extend({
  isActive: z.boolean().optional(),
});



// ============================================
// MODIFIERS ROUTES
// ============================================

// Validation schemas
const modifierSchema = z.object({
  name: z.string().min(1).max(150),
  price: z.number().min(0).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const modifierUpdateSchema = modifierSchema.partial().extend({
  isAvailable: z.boolean().optional(),
});


export function registerCustomizationRoutes(app) {
  // Get all variants for a menu item
  router.get(
    "/:restaurantId/items/:itemId/variants",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    asyncHandler(async (req, res) => {
      const { itemId } = req.params;
      const variants = await getVariantsForMenuItem(itemId);
      res.json({ variants });
    })
  );

  // Create variant
  router.post(
    "/:restaurantId/items/:itemId/variants",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:variants:create", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, itemId } = req.params;
      const parsed = variantSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      const variant = await createVariant(restaurantId, itemId, parsed.data);
      res.status(201).json({ variant });
    })
  );

  // Update variant
  router.put(
    "/:restaurantId/variants/:variantId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:variants:update", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, variantId } = req.params;
      const parsed = variantUpdateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      const variant = await updateVariant(restaurantId, variantId, parsed.data);
      if (!variant) return res.status(404).json({ message: "Variant not found" });
      
      res.json({ variant });
    })
  );

  // Delete variant
  router.delete(
    "/:restaurantId/variants/:variantId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:variants:delete", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, variantId } = req.params;
      const variant = await deleteVariant(restaurantId, variantId);
      
      if (!variant) return res.status(404).json({ message: "Variant not found" });
      
      res.json({ variant, deleted: true });
    })
  );

  // ============================================
  // MODIFIER GROUPS ROUTES
  // ============================================

  // Get all modifier groups for restaurant
  router.get(
    "/:restaurantId/modifier-groups",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const groups = await getModifierGroups(restaurantId);
      res.json({ modifierGroups: groups });
    })
  );

  // Create modifier group
  router.post(
    "/:restaurantId/modifier-groups",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:modifierGroups:create", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = modifierGroupSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      const group = await createModifierGroup(restaurantId, parsed.data);
      res.status(201).json({ modifierGroup: group });
    })
  );

  // Update modifier group
  router.put(
    "/:restaurantId/modifier-groups/:groupId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:modifierGroups:update", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, groupId } = req.params;
      const parsed = modifierGroupUpdateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      const group = await updateModifierGroup(restaurantId, groupId, parsed.data);
      if (!group) return res.status(404).json({ message: "Modifier group not found" });
      
      res.json({ modifierGroup: group });
    })
  );

  // Delete modifier group (soft delete)
  router.delete(
    "/:restaurantId/modifier-groups/:groupId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:modifierGroups:delete", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, groupId } = req.params;
      const group = await deleteModifierGroup(restaurantId, groupId);
      
      if (!group) return res.status(404).json({ message: "Modifier group not found" });
      
      res.json({ modifierGroup: group, deleted: true });
    })
  );

  // Get all modifiers for a group
  router.get(
    "/:restaurantId/modifier-groups/:groupId/modifiers",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    asyncHandler(async (req, res) => {
      const { groupId } = req.params;
      const modifiers = await getModifiersForGroup(groupId);
      res.json({ modifiers });
    })
  );

  // Create modifier
  router.post(
    "/:restaurantId/modifier-groups/:groupId/modifiers",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:modifiers:create", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, groupId } = req.params;
      const parsed = modifierSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      const modifier = await createModifier(restaurantId, groupId, parsed.data);
      res.status(201).json({ modifier });
    })
  );

  // Update modifier
  router.put(
    "/:restaurantId/modifiers/:modifierId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:modifiers:update", windowSeconds: 60, max: 240 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, modifierId } = req.params;
      const parsed = modifierUpdateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      const modifier = await updateModifier(restaurantId, modifierId, parsed.data);
      if (!modifier) return res.status(404).json({ message: "Modifier not found" });
      
      res.json({ modifier });
    })
  );

  // Delete modifier
  router.delete(
    "/:restaurantId/modifiers/:modifierId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:modifiers:delete", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, modifierId } = req.params;
      const modifier = await deleteModifier(restaurantId, modifierId);
      
      if (!modifier) return res.status(404).json({ message: "Modifier not found" });
      
      res.json({ modifier, deleted: true });
    })
  );

  // ============================================
  // MENU ITEM <-> MODIFIER GROUP LINKING
  // ============================================

  // Get modifier groups for a menu item
  router.get(
    "/:restaurantId/items/:itemId/modifier-groups",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    asyncHandler(async (req, res) => {
      const { itemId } = req.params;
      const modifierGroups = await getModifierGroupsForMenuItem(itemId);
      res.json({ modifierGroups });
    })
  );

  // Link modifier group to menu item
  router.post(
    "/:restaurantId/items/:itemId/modifier-groups/:groupId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:itemModifierGroups:link", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { itemId, groupId } = req.params;
      const { sortOrder } = req.body;
      
      const link = await linkModifierGroupToMenuItem(itemId, groupId, sortOrder);
      res.status(201).json({ link });
    })
  );

  // Unlink modifier group from menu item
  router.delete(
    "/:restaurantId/items/:itemId/modifier-groups/:groupId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:itemModifierGroups:unlink", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { itemId, groupId } = req.params;
      const link = await unlinkModifierGroupFromMenuItem(itemId, groupId);
      
      if (!link) return res.status(404).json({ message: "Link not found" });
      
      res.json({ link, deleted: true });
    })
  );

    app.use("/api/menu", router);
}