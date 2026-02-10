CREATE TYPE "public"."payment_status_enum" AS ENUM('DUE', 'PAID', 'PARTIALLY_PAID');--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" "payment_status_enum" DEFAULT 'DUE' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "is_closed" boolean DEFAULT false NOT NULL;