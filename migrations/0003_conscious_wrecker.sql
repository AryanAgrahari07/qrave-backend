ALTER TABLE "order_items" ADD COLUMN "selected_variant_id" varchar;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_name" varchar(100);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "selected_modifiers" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "customization_amount" numeric(10, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_selected_variant_id_menu_item_variants_id_fk" FOREIGN KEY ("selected_variant_id") REFERENCES "public"."menu_item_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_group_unique" UNIQUE("menu_item_id","modifier_group_id");