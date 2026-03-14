-- Combined & Idempotent Migrations File
-- Safely applies missing indexes, columns, constraints, and triggers without crashing on existing data.

-- ==========================================
-- 1. ADD NEW ENUM VALUES (Idempotent)
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'payment_method' AND e.enumlabel = 'DUE'
  ) THEN
    ALTER TYPE "public"."payment_method" ADD VALUE 'DUE';
  END IF;
END$$;

-- ==========================================
-- 2. CREATE NEW TABLES
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inquiry_status') THEN
    CREATE TYPE "public"."inquiry_status" AS ENUM('PENDING', 'CONTACTED', 'CLOSED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "inquiries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"phone_number" varchar(30) NOT NULL,
	"restaurant_name" varchar(200) NOT NULL,
	"message" text,
	"status" "inquiry_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "menu_suggestions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"image_url" text,
	"category" varchar(150),
	"dietary_tags" varchar(50)[],
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

-- ==========================================
-- 3. ADD NEW COLUMNS (Idempotent)
-- ==========================================
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "kot_number" integer;

ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "invoice_counter" integer DEFAULT 0 NOT NULL;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "order_counter" integer DEFAULT 0 NOT NULL;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "kot_counter" integer DEFAULT 0 NOT NULL;

ALTER TABLE "guest_queue" ADD COLUMN IF NOT EXISTS "assigned_table_id" varchar;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_number" integer;

-- Change analytics ID to BIGINT safely
ALTER TABLE "analytics_events" ALTER COLUMN "id" TYPE bigint;

-- ==========================================
-- 4. ADD FOREIGN KEYS & CONSTRAINTS
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_queue_assigned_table_id_tables_id_fk') THEN
    ALTER TABLE "guest_queue" ADD CONSTRAINT "guest_queue_assigned_table_id_tables_id_fk" FOREIGN KEY ("assigned_table_id") REFERENCES "public"."tables"("id") ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_order_id_unique') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_unique" UNIQUE("order_id");
  END IF;
END$$;

-- ==========================================
-- 5. CREATE INDEXES (Idempotent)
-- ==========================================
CREATE INDEX IF NOT EXISTS "analytics_events_restaurant_event_time_idx" ON "analytics_events" USING btree ("restaurant_id","event_type","occurred_at");
CREATE INDEX IF NOT EXISTS "auth_refresh_tokens_hash_idx" ON "auth_refresh_tokens" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "guest_queue_restaurant_status_time_idx" ON "guest_queue" USING btree ("restaurant_id","status","entry_time");
CREATE INDEX IF NOT EXISTS "menu_items_restaurant_id_idx" ON "menu_items" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "menu_items_category_status_idx" ON "menu_items" USING btree ("restaurant_id","category_id","is_available");
CREATE INDEX IF NOT EXISTS "order_items_order_restaurant_idx" ON "order_items" USING btree ("order_id","restaurant_id");
CREATE INDEX IF NOT EXISTS "orders_restaurant_status_date_idx" ON "orders" USING btree ("restaurant_id","status","created_at");
CREATE INDEX IF NOT EXISTS "orders_restaurant_table_idx" ON "orders" USING btree ("restaurant_id","table_id");
CREATE INDEX IF NOT EXISTS "staff_restaurant_code_idx" ON "staff" USING btree ("restaurant_id","staff_code");
CREATE INDEX IF NOT EXISTS "staff_email_idx" ON "staff" USING btree ("email");
CREATE INDEX IF NOT EXISTS "tables_restaurant_status_idx" ON "tables" USING btree ("restaurant_id","current_status");

CREATE INDEX IF NOT EXISTS "inventory_items_restaurant_id_idx" ON "inventory_items" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "menu_categories_restaurant_id_idx" ON "menu_categories" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "menu_item_variants_restaurant_id_idx" ON "menu_item_variants" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "menu_item_variants_menu_item_id_idx" ON "menu_item_variants" USING btree ("menu_item_id");
CREATE INDEX IF NOT EXISTS "modifier_groups_restaurant_id_idx" ON "modifier_groups" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "modifiers_restaurant_id_idx" ON "modifiers" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "modifiers_group_id_idx" ON "modifiers" USING btree ("modifier_group_id");
CREATE INDEX IF NOT EXISTS "order_items_restaurant_created_idx" ON "order_items" USING btree ("restaurant_id","created_at") WHERE status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS "orders_restaurant_updated_at_idx" ON "orders" USING btree ("restaurant_id","updated_at");
CREATE INDEX IF NOT EXISTS "orders_open_table_idx" ON "orders" USING btree ("restaurant_id","table_id","is_closed") WHERE is_closed = false;
CREATE INDEX IF NOT EXISTS "staff_email_lower_idx" ON "staff" USING btree (lower("email"));
CREATE INDEX IF NOT EXISTS "subscriptions_restaurant_id_idx" ON "subscriptions" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "transactions_restaurant_id_idx" ON "transactions" USING btree ("restaurant_id");
CREATE INDEX IF NOT EXISTS "transactions_restaurant_created_idx" ON "transactions" USING btree ("restaurant_id","created_at");
CREATE INDEX IF NOT EXISTS "inquiries_status_created_idx" ON "inquiries" USING btree ("status","created_at");
CREATE INDEX IF NOT EXISTS "menu_suggestions_name_search_idx" ON "menu_suggestions" USING gin (to_tsvector('english', "name"));
CREATE INDEX IF NOT EXISTS "menu_suggestions_category_idx" ON "menu_suggestions" USING btree ("category");
CREATE INDEX IF NOT EXISTS "order_items_restaurant_kot_idx" ON "order_items" USING btree ("restaurant_id","kot_number");
CREATE INDEX IF NOT EXISTS "orders_restaurant_order_number_idx" ON "orders" USING btree ("restaurant_id","order_number");

-- Additional Performance Indexes
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON orders(restaurant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_closed_status ON orders(restaurant_id, is_closed, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_table ON orders(restaurant_id, table_id, is_closed) WHERE table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_payment_status ON orders(restaurant_id, payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_placed_by_staff ON orders(restaurant_id, placed_by_staff_id, created_at DESC) WHERE placed_by_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_restaurant ON order_items(restaurant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_status_time ON guest_queue(restaurant_id, status, entry_time ASC);
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_phone ON guest_queue(restaurant_id, phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_status ON tables(restaurant_id, current_status);
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_active ON tables(restaurant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_available ON menu_items(restaurant_id, is_available, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_menu_items_category_available ON menu_items(category_id, is_available, sort_order);
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant_active ON menu_categories(restaurant_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_analytics_restaurant_time ON analytics_events(restaurant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_restaurant_type_time ON analytics_events(restaurant_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_restaurant_active ON staff(restaurant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_transactions_restaurant_time ON transactions(restaurant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON auth_refresh_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_subject ON auth_refresh_tokens(subject_id, subject_type);
CREATE INDEX IF NOT EXISTS idx_subscriptions_restaurant_status ON subscriptions(restaurant_id, status, end_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_restaurant_active ON inventory_items(restaurant_id, is_active);

-- ==========================================
-- 6. SETUP ORDER & KOT NUMBER DB TRIGGERS & LOGIC
-- ==========================================
-- Create the trigger function that atomically assigns the next order_number
CREATE OR REPLACE FUNCTION assign_order_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Atomically increment the counter for this restaurant and assign to new order
  UPDATE restaurants
    SET order_counter = order_counter + 1
    WHERE id = NEW.restaurant_id;

  SELECT order_counter INTO NEW.order_number
    FROM restaurants
    WHERE id = NEW.restaurant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger on INSERT into orders
DROP TRIGGER IF EXISTS trg_assign_order_number ON orders;
CREATE TRIGGER trg_assign_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION assign_order_number();

-- Backfill missing order numbers safely
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY restaurant_id ORDER BY created_at ASC) AS rn
  FROM orders WHERE order_number IS NULL
)
UPDATE orders SET order_number = numbered.rn FROM numbered WHERE orders.id = numbered.id;

-- Ensure order_counter represents the max assigned order
UPDATE restaurants r
SET order_counter = COALESCE((SELECT MAX(o.order_number) FROM orders o WHERE o.restaurant_id = r.id), 0);

-- Backfill kot_counter safely
WITH order_kots AS (
  SELECT id AS order_id, restaurant_id, order_number AS assigned_kot
  FROM orders WHERE order_number IS NOT NULL
)
UPDATE order_items oi
SET kot_number = ok.assigned_kot
FROM order_kots ok
WHERE oi.order_id = ok.order_id AND oi.kot_number IS NULL;

-- Ensure kot_counter matches the max order_number
UPDATE restaurants r
SET kot_counter = (SELECT COALESCE(MAX(order_number), 0) FROM orders o WHERE o.restaurant_id = r.id);
