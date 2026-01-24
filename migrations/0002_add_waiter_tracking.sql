-- Add waiter tracking to orders and tables
-- This allows tracking which staff member placed an order and which waiter is assigned to a table

-- Add placed_by_staff_id to orders (tracks who created the order)
ALTER TABLE orders 
  ADD COLUMN placed_by_staff_id varchar REFERENCES staff(id) ON DELETE SET NULL;

-- Add assigned_waiter_id to tables (tracks which waiter is responsible for a table)
ALTER TABLE tables
  ADD COLUMN assigned_waiter_id varchar REFERENCES staff(id) ON DELETE SET NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_placed_by_staff 
  ON orders (placed_by_staff_id);

CREATE INDEX IF NOT EXISTS idx_tables_assigned_waiter 
  ON tables (assigned_waiter_id);
