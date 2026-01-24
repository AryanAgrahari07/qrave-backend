import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  numeric,
  uuid,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

//
// Enums
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

export const staffRoleEnum = pgEnum("staff_role", ["ADMIN", "WAITER", "KITCHEN"]);

export const guestQueueStatusEnum = pgEnum("guest_queue_status", [
  "WAITING",
  "CALLED",
  "SEATED",
  "CANCELLED",
]);

//
// Platform users (SaaS owners / platform admins)
//
export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 150 }),
  role: varchar("role", { length: 50 }).notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// Restaurants (tenants)
//
export const restaurants = pgTable("restaurants", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
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
// Menu categories
//
export const menuCategories = pgTable("menu_categories", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
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
// Menu items
//
export const menuItems = pgTable("menu_items", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
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
  isAvailable: boolean("is_available").notNull().default(true),
  dietaryTags: varchar("dietary_tags", { length: 50 }).array(), // Veg, Non-Veg, Vegan, etc.
  sortOrder: integer("sort_order"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// Tables / floor map
//
export const tables = pgTable("tables", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  tableNumber: varchar("table_number", { length: 50 }).notNull(),
  capacity: integer("capacity").notNull(),
  currentStatus: tableStatusEnum("current_status").notNull().default("AVAILABLE"),
  floorSection: varchar("floor_section", { length: 100 }),
  positionX: numeric("position_x", { precision: 10, scale: 2 }),
  positionY: numeric("position_y", { precision: 10, scale: 2 }),
  assignedWaiterId: varchar("assigned_waiter_id").references(() => staff.id, { onDelete: "set null" }),
  qrCodePayload: text("qr_code_payload").notNull(),
  qrCodeVersion: integer("qr_code_version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

//
// Orders
//
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
  placedByStaffId: varchar("placed_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
  status: orderStatusEnum("status").notNull().default("PENDING"),
  orderType: orderTypeEnum("order_type").notNull().default("DINE_IN"),
  subtotalAmount: numeric("subtotal_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  gstAmount: numeric("gst_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  serviceTaxAmount: numeric("service_tax_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
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

//
// Order items
//
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

//
// Transactions / billing
//
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
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentReference: varchar("payment_reference", { length: 100 }),
  paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

//
// Inventory
//
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

//
// Staff & roles
//
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

//
// Guest queue / waitlist
//
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
  status: guestQueueStatusEnum("status").notNull().default("WAITING"),
  entryTime: timestamp("entry_time", { withTimezone: true }).defaultNow(),
  calledTime: timestamp("called_time", { withTimezone: true }),
  seatedTime: timestamp("seated_time", { withTimezone: true }),
  cancelledTime: timestamp("cancelled_time", { withTimezone: true }),
  notes: text("notes"),
});

//
// Analytics events (optional but future-proof)
//
export const analyticsEvents = pgTable("analytics_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  restaurantId: varchar("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 50 }).notNull(), // QR_SCAN, ORDER_CREATED, etc.
  tableId: varchar("table_id").references(() => tables.id),
  orderId: varchar("order_id").references(() => orders.id),
  menuItemId: varchar("menu_item_id").references(() => menuItems.id),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow(),
});

//
// Zod schemas (you can extend as needed)
//
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  passwordHash: true,
  fullName: true,
});

// Type exports (for JSDoc or TypeScript compatibility)
// export type InsertUser = z.infer<typeof insertUserSchema>;
// export type User = typeof users.$inferSelect;
// export type Restaurant = typeof restaurants.$inferSelect;
// export type MenuCategory = typeof menuCategories.$inferSelect;
// export type MenuItem = typeof menuItems.$inferSelect;
// export type Table = typeof tables.$inferSelect;
// export type Order = typeof orders.$inferSelect;
// export type OrderItem = typeof orderItems.$inferSelect;
// export type Transaction = typeof transactions.$inferSelect;
// export type InventoryItem = typeof inventoryItems.$inferSelect;
// export type Staff = typeof staff.$inferSelect;
// export type GuestQueue = typeof guestQueue.$inferSelect;
// export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

// -- Countries table
// CREATE TABLE countries (
//   code         varchar(3) PRIMARY KEY,      -- ISO 3166-1 alpha-2 (e.g., 'IN', 'US')
//   name         varchar(100) NOT NULL,       -- Full country name
//   created_at   timestamptz NOT NULL DEFAULT now()
// );

// CREATE INDEX idx_countries_name ON countries(name);

// -- States/Provinces table
// CREATE TABLE states (
//   code         varchar(10) PRIMARY KEY,     -- ISO 3166-2 code (e.g., 'IN-MP', 'US-CA')
//   name         varchar(100) NOT NULL,       -- State/Province name
//   country_code varchar(3) NOT NULL REFERENCES countries(code) ON DELETE CASCADE,
//   created_at   timestamptz NOT NULL DEFAULT now()
// );

// CREATE INDEX idx_states_country ON states(country_code);
// CREATE INDEX idx_states_name ON states(name);

// -- Cities table
// CREATE TABLE cities (
//   code         varchar(20) PRIMARY KEY,     -- Composite code (e.g., 'IN-MP:Bhopal')
//   name         varchar(100) NOT NULL,       -- City name
//   state_code   varchar(10) NOT NULL REFERENCES states(code) ON DELETE CASCADE,
//   created_at   timestamptz NOT NULL DEFAULT now()
// );

// CREATE INDEX idx_cities_state ON cities(state_code);
// CREATE INDEX idx_cities_name ON cities(name);

// -- Currencies table
// CREATE TABLE currencies (
//   code         varchar(3) PRIMARY KEY,      -- ISO 4217 code (e.g., 'INR', 'USD')
//   name         varchar(100) NOT NULL,       -- Currency name
//   symbol       varchar(10) NOT NULL,        -- Currency symbol (e.g., '₹', '$')
//   created_at   timestamptz NOT NULL DEFAULT now()
// );

// CREATE INDEX idx_currencies_name ON currencies(name);

// -- Sample data for India
// INSERT INTO countries (code, name) VALUES 
//   ('IN', 'India'),
//   ('US', 'United States'),
//   ('GB', 'United Kingdom'),
//   ('AU', 'Australia'),
//   ('CA', 'Canada');

// -- Sample Indian states
// INSERT INTO states (code, name, country_code) VALUES 
//   ('IN-MP', 'Madhya Pradesh', 'IN'),
//   ('IN-MH', 'Maharashtra', 'IN'),
//   ('IN-DL', 'Delhi', 'IN'),
//   ('IN-KA', 'Karnataka', 'IN'),
//   ('IN-TN', 'Tamil Nadu', 'IN');

// -- Sample cities for Madhya Pradesh
// INSERT INTO cities (code, name, state_code) VALUES 
//   ('IN-MP:Bhopal', 'Bhopal', 'IN-MP'),
//   ('IN-MP:Indore', 'Indore', 'IN-MP'),
//   ('IN-MP:Gwalior', 'Gwalior', 'IN-MP'),
//   ('IN-MP:Jabalpur', 'Jabalpur', 'IN-MP');

// -- Sample cities for Maharashtra
// INSERT INTO cities (code, name, state_code) VALUES 
//   ('IN-MH:Mumbai', 'Mumbai', 'IN-MH'),
//   ('IN-MH:Pune', 'Pune', 'IN-MH'),
//   ('IN-MH:Nagpur', 'Nagpur', 'IN-MH');

// -- Sample currencies
// INSERT INTO currencies (code, name, symbol) VALUES 
//   ('INR', 'Indian Rupee', '₹'),
//   ('USD', 'US Dollar', '$'),
//   ('EUR', 'Euro', '€'),
//   ('GBP', 'British Pound', '£'),
//   ('AUD', 'Australian Dollar', 'A$'),
//   ('CAD', 'Canadian Dollar', 'C$');