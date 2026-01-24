-- Add READY to order_status enum (missing in initial migration)
-- Note: IF NOT EXISTS requires relatively modern Postgres.
ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'READY';

