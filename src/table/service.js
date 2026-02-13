import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { tables } from "../../shared/schema.js";
import { createPgPool } from "../db.js";
import {
  emitTableCreated,
  emitTableDeleted,
  emitTableStatusChanged,
  emitTableUpdated,
} from "../realtime/events.js";

const pool = createPgPool();
const db = drizzle(pool);

/**
 * List all tables for a restaurant
 */
export async function listTables(restaurantId) {
  const tablesList = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.isActive, true)
      )
    )
    .orderBy(tables.tableNumber);
  
  // Enrich with assigned waiter info
  const { staff } = await import("../../shared/schema.js");
  const tablesWithWaiter = await Promise.all(
    tablesList.map(async (table) => {
      if (!table.assignedWaiterId) return table;
      
      const waiterRows = await db
        .select({
          id: staff.id,
          fullName: staff.fullName,
        })
        .from(staff)
        .where(eq(staff.id, table.assignedWaiterId))
        .limit(1);
      
      return {
        ...table,
        assignedWaiter: waiterRows[0] || null,
      };
    })
  );
  
  return tablesWithWaiter;
}

/**
 * Get a specific table
 */
export async function getTable(restaurantId, tableId) {
  const rows = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .limit(1);
  
  const table = rows[0];
  if (!table) return null;
  
  // Enrich with assigned waiter info
  if (table.assignedWaiterId) {
    const { staff } = await import("../../shared/schema.js");
    const waiterRows = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
      })
      .from(staff)
      .where(eq(staff.id, table.assignedWaiterId))
      .limit(1);
    
    return {
      ...table,
      assignedWaiter: waiterRows[0] || null,
    };
  }
  
  return table;
}

/**
 * Create a new table
 */
export async function createTable(restaurantId, data) {
  const rows = await db
    .insert(tables)
    .values({
      restaurantId,
      ...data,
    })
    .returning();
  const table = rows[0];
  if (table) emitTableCreated(restaurantId, table);
  return table;
}

/**
 * Update a table
 */
export async function updateTable(restaurantId, tableId, data) {
  const rows = await db
    .update(tables)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .returning();
  const table = rows[0];
  if (table) emitTableUpdated(restaurantId, table);
  return table;
}

/**
 * Soft delete a table
 */
export async function deleteTable(restaurantId, tableId) {
  const rows = await db
    .update(tables)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .returning();
  const table = rows[0];
  if (table) emitTableDeleted(restaurantId, table);
  return table;
}

/**
 * Update table status (AVAILABLE, OCCUPIED, RESERVED, BLOCKED)
 * Auto-assigns waiter if provided and status is OCCUPIED
 */
export async function updateTableStatus(restaurantId, tableId, status, staffId = null) {
  const updateData = {
    currentStatus: status,
    updatedAt: new Date(),
  };
  
  // Auto-assign waiter if marking table as OCCUPIED
  if (staffId && status === "OCCUPIED") {
    updateData.assignedWaiterId = staffId;
  }
  
  // Clear waiter assignment if marking table as AVAILABLE
  if (status === "AVAILABLE") {
    updateData.assignedWaiterId = null;
  }
  
  const rows = await db
    .update(tables)
    .set(updateData)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .returning();
  const table = rows[0];
  if (!table) return null;
  
  // Enrich with assigned waiter info
  if (table.assignedWaiterId) {
    const { staff } = await import("../../shared/schema.js");
    const waiterRows = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
      })
      .from(staff)
      .where(eq(staff.id, table.assignedWaiterId))
      .limit(1);
    
    const enrichedTable = {
      ...table,
      assignedWaiter: waiterRows[0] || null,
    };
    
    emitTableStatusChanged(restaurantId, enrichedTable);
    return enrichedTable;
  }
  
  emitTableStatusChanged(restaurantId, table);
  return table;
}

/**
 * Assign a waiter to a table
 * If table is AVAILABLE and a waiter is assigned, automatically changes status to OCCUPIED
 * If waiter is unassigned (staffId is null), keeps current status
 */
export async function assignWaiterToTable(restaurantId, tableId, staffId) {
  // First, get the current table to check its status
  const currentTableRows = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .limit(1);
  
  const currentTable = currentTableRows[0];
  if (!currentTable) return null;
  
  const updateData = {
    assignedWaiterId: staffId,
    updatedAt: new Date(),
  };
  
  // If assigning a waiter to an AVAILABLE table, automatically change status to OCCUPIED
  if (staffId && currentTable.currentStatus === "AVAILABLE") {
    updateData.currentStatus = "OCCUPIED";
  }
  
  // If unassigning waiter and table is OCCUPIED (and has no active orders), change to AVAILABLE
  // Note: We don't automatically change to AVAILABLE when unassigning, as the table might still be occupied
  // Admin can manually change status if needed
  
  const rows = await db
    .update(tables)
    .set(updateData)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        eq(tables.id, tableId)
      )
    )
    .returning();
  
  const table = rows[0];
  if (!table) return null;
  
  // Enrich with assigned waiter info
  if (table.assignedWaiterId) {
    const { staff } = await import("../../shared/schema.js");
    const waiterRows = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
      })
      .from(staff)
      .where(eq(staff.id, table.assignedWaiterId))
      .limit(1);
    
    const enrichedTable = {
      ...table,
      assignedWaiter: waiterRows[0] || null,
    };
    
    emitTableStatusChanged(restaurantId, enrichedTable);
    return enrichedTable;
  }

  // Keep response shape stable for clients
  const enrichedTable = {
    ...table,
    assignedWaiter: null,
  };

  emitTableStatusChanged(restaurantId, enrichedTable);
  return enrichedTable;
}

/**
 * Bulk create tables (useful for onboarding)
 */
export async function createTablesBulk(restaurantId, tablesData) {
  const values = tablesData.map((t) => ({
    restaurantId,
    ...t,
  }));
  
  const rows = await db
    .insert(tables)
    .values(values)
    .returning();
  return rows;
}
