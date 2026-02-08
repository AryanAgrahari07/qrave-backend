import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  numeric,
  integer,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";

//
// ENUMS
//

export const tableStatusEnum = pgEnum("table_status", [
  "AVAILABLE",
  "OCCUPIED",
  "RESERVED",
  "BLOCKED",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "PREPARING",
  "READY",
  "SERVED",
  "PAID",
  "CANCELLED",
]);

export const orderTypeEnum = pgEnum("order_type", [
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "CASH",
  "UPI",
  "CARD",
  "WALLET",
  "OTHER",
]);

export const staffRoleEnum = pgEnum("staff_role", [
  "ADMIN",
  "WAITER",
  "KITCHEN",
]);

export const guestQueueStatusEnum = pgEnum("guest_queue_status", [
  "WAITING",
  "CALLED",
  "SEATED",
  "CANCELLED",
]);

export const selectionTypeEnum = pgEnum("selection_type", [
  "SINGLE",
  "MULTIPLE",
]);

//
// USERS
//

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 150 }),
  role: varchar("role", { length: 50 }).notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// RESTAURANTS
//

export const restaurants = pgTable("restaurants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: varchar("owner_id").references(() => users.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 150 }).notNull().unique(),
  type: varchar("type", { length: 50 }),

  addressLine1: varchar("address_line1", { length: 255 }),
  addressLine2: varchar("address_line2", { length: 255 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  postalCode: varchar("postal_code", { length: 20 }),
  country: varchar("country", { length: 100 }).default("India"),

  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),

  currency: varchar("currency", { length: 10 }).notNull().default("₹"),
  taxRateGst: numeric("tax_rate_gst", { precision: 5, scale: 2 })
    .notNull()
    .default("5.00"),
  taxRateService: numeric("tax_rate_service", { precision: 5, scale: 2 })
    .notNull()
    .default("10.00"),

  qrDesign: jsonb("qr_design"),
  settings: jsonb("settings"),
  plan: varchar("plan", { length: 50 }).default("STARTER"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// MENU CATEGORIES
//

export const menuCategories = pgTable("menu_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 150 }).notNull(),
  sortOrder: integer("sort_order"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// MENU EXTRACTION JOBS
//

export const menuExtractionJobs = pgTable("menu_extraction_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  uploadedBy: varchar("uploaded_by").references(() => users.id),

  imageUrl: text("image_url").notNull(),
  imageS3Key: text("image_s3_key").notNull(),
  imageSizeBytes: integer("image_size_bytes"),
  imageHash: varchar("image_hash", { length: 64 }),

  status: varchar("status", { length: 50 }).notNull().default("PENDING"),
  extractedData: jsonb("extracted_data"),
  extractionConfidence: numeric("extraction_confidence", { precision: 5, scale: 2 }),
  aiModelUsed: varchar("ai_model_used", { length: 50 }),

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  processingTimeMs: integer("processing_time_ms"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),

  itemsExtracted: integer("items_extracted").default(0),
  itemsConfirmed: integer("items_confirmed").default(0),
  manualEditsCount: integer("manual_edits_count").default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// MENU ITEMS
//

export const menuItems = pgTable("menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id")
    .notNull()
    .references(() => menuCategories.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),

  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  isAvailable: boolean("is_available").notNull().default(true),
  dietaryTags: varchar("dietary_tags", { length: 50 }).array(),
  sortOrder: integer("sort_order"),
  metadata: jsonb("metadata"),

  extractionJobId: varchar("extraction_job_id").references(
    () => menuExtractionJobs.id,
    { onDelete: "set null" }
  ),

  isAiExtracted: boolean("is_ai_extracted").default(false),
  extractionConfidence: numeric("extraction_confidence", { precision: 5, scale: 2 }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// MENU VARIANTS
//

export const menuItemVariants = pgTable("menu_item_variants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  menuItemId: varchar("menu_item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "cascade" }),

  variantName: varchar("variant_name", { length: 100 }).notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),

  isDefault: boolean("is_default").notNull().default(false),
  isAvailable: boolean("is_available").notNull().default(true),
  sortOrder: integer("sort_order"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// MODIFIER GROUPS
//

export const modifierGroups = pgTable("modifier_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  selectionType: selectionTypeEnum("selection_type")
    .notNull()
    .default("MULTIPLE"),

  minSelections: integer("min_selections").default(0),
  maxSelections: integer("max_selections"),
  isRequired: boolean("is_required").notNull().default(false),

  sortOrder: integer("sort_order"),
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// MODIFIERS
//

export const modifiers = pgTable("modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  modifierGroupId: varchar("modifier_group_id")
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 150 }).notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),

  isDefault: boolean("is_default").notNull().default(false),
  isAvailable: boolean("is_available").notNull().default(true),
  sortOrder: integer("sort_order"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// MENU ITEM MODIFIER GROUPS (JUNCTION)
//

export const menuItemModifierGroups = pgTable(
  "menu_item_modifier_groups",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    menuItemId: varchar("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    modifierGroupId: varchar("modifier_group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    menuItemModifierGroupUnique: unique("menu_item_modifier_group_unique").on(
      table.menuItemId,
      table.modifierGroupId
    ),
  })
);


export const staff = pgTable("staff", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  fullName: varchar("full_name", { length: 150 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 20 }),
  email: varchar("email", { length: 255 }),

  role: staffRoleEnum("role").notNull(),

  passcodeHash: text("passcode_hash").notNull(),

  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});



export const tables = pgTable("tables", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  tableNumber: varchar("table_number", { length: 50 }).notNull(),
  capacity: integer("capacity").notNull(),

  currentStatus: tableStatusEnum("current_status")
    .notNull()
    .default("AVAILABLE"),

  floorSection: varchar("floor_section", { length: 100 }),

  positionX: numeric("position_x", { precision: 10, scale: 2 }),
  positionY: numeric("position_y", { precision: 10, scale: 2 }),

  qrCodePayload: text("qr_code_payload").notNull(),
  qrCodeVersion: integer("qr_code_version").notNull().default(1),

  assignedWaiterId: varchar("assigned_waiter_id").references(
    () => staff.id,
    { onDelete: "set null" }
  ),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});


export const orders = pgTable("orders", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  tableId: varchar("table_id").references(() => tables.id),

  guestName: varchar("guest_name", { length: 150 }),
  guestPhone: varchar("guest_phone", { length: 20 }),

  placedByStaffId: varchar("placed_by_staff_id").references(
    () => staff.id,
    { onDelete: "set null" }
  ),

  status: orderStatusEnum("status").notNull().default("PENDING"),
  orderType: orderTypeEnum("order_type").notNull().default("DINE_IN"),

  subtotalAmount: numeric("subtotal_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),

  gstAmount: numeric("gst_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),

  serviceTaxAmount: numeric("service_tax_amount", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),

  discountAmount: numeric("discount_amount", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),

  totalAmount: numeric("total_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),

  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});


export const orderItems = pgTable("order_items", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  orderId: varchar("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),

  menuItemId: varchar("menu_item_id")
    .notNull()
    .references(() => menuItems.id),

  itemName: varchar("item_name", { length: 200 }).notNull(),

  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),

  quantity: integer("quantity").notNull(),

  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),

  notes: text("notes"),

  // 🔥 Customization Snapshot
  selectedVariantId: varchar("selected_variant_id").references(
    () => menuItemVariants.id
  ),

  variantName: varchar("variant_name", { length: 100 }),
  variantPrice: numeric("variant_price", { precision: 10, scale: 2 }),

  selectedModifiers: jsonb("selected_modifiers").default(
    sql`'[]'::jsonb`
  ),

  customizationAmount: numeric("customization_amount", {
    precision: 10,
    scale: 2,
  }).default("0"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});



export const transactions = pgTable("transactions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  orderId: varchar("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),

  billNumber: varchar("bill_number", { length: 50 }).notNull(),

  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  gstAmount: numeric("gst_amount", { precision: 12, scale: 2 }).notNull(),
  serviceTaxAmount: numeric("service_tax_amount", {
    precision: 12,
    scale: 2,
  }).notNull(),

  discountAmount: numeric("discount_amount", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),

  grandTotal: numeric("grand_total", { precision: 12, scale: 2 })
    .notNull(),

  paymentMethod: paymentMethodEnum("payment_method").notNull(),

  paymentReference: varchar("payment_reference", { length: 100 }),

  paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});


export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 50 }).notNull(),

  currentStock: numeric("current_stock", { precision: 14, scale: 3 })
    .notNull()
    .default("0"),

  reorderLevel: numeric("reorder_level", { precision: 14, scale: 3 })
    .notNull()
    .default("0"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});


export const guestQueue = pgTable("guest_queue", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  guestName: varchar("guest_name", { length: 150 }).notNull(),
  partySize: integer("party_size").notNull(),
  phoneNumber: varchar("phone_number", { length: 20 }),

  status: guestQueueStatusEnum("status")
    .notNull()
    .default("WAITING"),

  entryTime: timestamp("entry_time", { withTimezone: true }).defaultNow(),
  calledTime: timestamp("called_time", { withTimezone: true }),
  seatedTime: timestamp("seated_time", { withTimezone: true }),
  cancelledTime: timestamp("cancelled_time", { withTimezone: true }),

  notes: text("notes"),
});


export const analyticsEvents = pgTable("analytics_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),

  eventType: varchar("event_type", { length: 50 }).notNull(),

  tableId: varchar("table_id").references(() => tables.id),
  orderId: varchar("order_id").references(() => orders.id),
  menuItemId: varchar("menu_item_id").references(() => menuItems.id),

  metadata: jsonb("metadata"),

  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow(),
});


export const countries = pgTable("countries", {
  code: varchar("code", { length: 3 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});


export const states = pgTable("states", {
  code: varchar("code", { length: 10 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),

  countryCode: varchar("country_code", { length: 3 })
    .notNull()
    .references(() => countries.code, { onDelete: "cascade" }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});


export const cities = pgTable("cities", {
  code: varchar("code", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),

  stateCode: varchar("state_code", { length: 10 })
    .notNull()
    .references(() => states.code, { onDelete: "cascade" }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});


export const currencies = pgTable("currencies", {
  code: varchar("code", { length: 3 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

