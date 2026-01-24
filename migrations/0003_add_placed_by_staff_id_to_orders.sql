ALTER TYPE "public"."order_status" ADD VALUE 'READY' BEFORE 'SERVED';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "placed_by_staff_id" varchar;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "assigned_waiter_id" varchar;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_staff_id_staff_id_fk" FOREIGN KEY ("placed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_assigned_waiter_id_staff_id_fk" FOREIGN KEY ("assigned_waiter_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;