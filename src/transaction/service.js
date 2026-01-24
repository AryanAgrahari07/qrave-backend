import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { transactions, orders, orderItems, tables } from "../../shared/schema.js";
import { createPgPool } from "../db.js";
import { emitTableStatusChanged } from "../realtime/events.js";

const pool = createPgPool();
const db = drizzle(pool);

/**
 * Create a transaction when an order is paid
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @param {object} data - Transaction data
 * @returns {Promise<object>} Created transaction
 */
export async function createTransaction(restaurantId, orderId, data) {
  const {
    billNumber,
    paymentMethod,
    paymentReference,
    // Optional: combined totals for multiple orders
    combinedSubtotal,
    combinedGst,
    combinedService,
    combinedTotal,
  } = data;

  // Get order details
  const orderRows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.id, orderId)
      )
    )
    .limit(1);

  const order = orderRows[0];
  if (!order) {
    throw new Error("Order not found");
  }

  // Use combined totals if provided (for multiple orders), otherwise use order totals
  const subtotal = combinedSubtotal !== undefined ? combinedSubtotal : order.subtotalAmount;
  const gst = combinedGst !== undefined ? combinedGst : order.gstAmount;
  const service = combinedService !== undefined ? combinedService : order.serviceTaxAmount;
  const total = combinedTotal !== undefined ? combinedTotal : order.totalAmount;

  // Create transaction
  const transactionRows = await db
    .insert(transactions)
    .values({
      restaurantId,
      orderId,
      billNumber,
      subtotal: subtotal.toString(),
      gstAmount: gst.toString(),
      serviceTaxAmount: service.toString(),
      discountAmount: order.discountAmount || "0",
      grandTotal: total.toString(),
      paymentMethod,
      paymentReference: paymentReference || null,
    })
    .returning();

  const transaction = transactionRows[0];

  // Update table status to AVAILABLE if order has a table and is DINE_IN
  // Only if this is the last active order for this table
  if (order.tableId && order.orderType === "DINE_IN") {
    // Check if there are any other active orders (PENDING, PREPARING, READY, SERVED) for this table
    const activeOrdersForTable = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.tableId, order.tableId),
          sql`${orders.status} IN ('PENDING', 'PREPARING', 'READY', 'SERVED')`,
          sql`${orders.id} != ${order.id}`
        )
      )
      .limit(1);

    // If no other active orders, mark table as AVAILABLE
    if (activeOrdersForTable.length === 0) {
      const tableRows = await db
        .update(tables)
        .set({
          currentStatus: "AVAILABLE",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tables.restaurantId, restaurantId),
            eq(tables.id, order.tableId)
          )
        )
        .returning();
      
      if (tableRows[0]) {
        emitTableStatusChanged(restaurantId, tableRows[0]);
      }
    }
  }

  return transaction;
}

/**
 * List transactions for a restaurant
 * @param {string} restaurantId - Restaurant ID
 * @param {object} filters - Filter options
 * @returns {Promise<Array>} List of transactions with order info
 */
export async function listTransactions(restaurantId, filters = {}) {
  const {
    fromDate,
    toDate,
    paymentMethod,
    limit = 50,
    offset = 0,
  } = filters;

  let conditions = [eq(transactions.restaurantId, restaurantId)];

  if (fromDate) {
    conditions.push(gte(transactions.paidAt, new Date(fromDate)));
  }
  if (toDate) {
    conditions.push(lte(transactions.paidAt, new Date(toDate)));
  }
  if (paymentMethod) {
    conditions.push(eq(transactions.paymentMethod, paymentMethod));
  }

  const transactionsList = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.paidAt))
    .limit(limit)
    .offset(offset);

  // Get order info for each transaction
  const transactionsWithDetails = await Promise.all(
    transactionsList.map(async (transaction) => {
      const orderRows = await db
        .select()
        .from(orders)
        .where(eq(orders.id, transaction.orderId))
        .limit(1);

      const order = orderRows[0];
      
      // Get order items
      const items = order ? await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, transaction.orderId)) : [];

      // Get table info if available
      let tableInfo = null;
      if (order?.tableId) {
        const tableRows = await db
          .select()
          .from(tables)
          .where(eq(tables.id, order.tableId))
          .limit(1);
        tableInfo = tableRows[0] ? {
          id: tableRows[0].id,
          tableNumber: tableRows[0].tableNumber,
          floorSection: tableRows[0].floorSection,
        } : null;
      }

      // Get staff info if available
      let staffInfo = null;
      if (order?.placedByStaffId) {
        const { staff } = await import("../../shared/schema.js");
        const staffRows = await db
          .select({
            id: staff.id,
            fullName: staff.fullName,
            role: staff.role,
          })
          .from(staff)
          .where(eq(staff.id, order.placedByStaffId))
          .limit(1);
        staffInfo = staffRows[0] || null;
      }

      return {
        ...transaction,
        order: order ? {
          ...order,
          items: items,
          table: tableInfo,
          placedByStaff: staffInfo,
        } : null,
      };
    })
  );

  return transactionsWithDetails;
}

/**
 * Get transaction by ID
 * @param {string} restaurantId - Restaurant ID
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<object|null>} Transaction with order info
 */
export async function getTransaction(restaurantId, transactionId) {
  const transactionRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.restaurantId, restaurantId),
        eq(transactions.id, transactionId)
      )
    )
    .limit(1);

  const transaction = transactionRows[0];
  if (!transaction) return null;

  // Get order info
  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, transaction.orderId))
    .limit(1);

  const order = orderRows[0];
  
  // Get order items
  const items = order ? await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, transaction.orderId)) : [];

  // Get table info if available
  let tableInfo = null;
  if (order?.tableId) {
    const tableRows = await db
      .select()
      .from(tables)
      .where(eq(tables.id, order.tableId))
      .limit(1);
    tableInfo = tableRows[0] ? {
      id: tableRows[0].id,
      tableNumber: tableRows[0].tableNumber,
      floorSection: tableRows[0].floorSection,
    } : null;
  }

  // Get staff info if available
  let staffInfo = null;
  if (order?.placedByStaffId) {
    const { staff } = await import("../../shared/schema.js");
    const staffRows = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
        role: staff.role,
      })
      .from(staff)
      .where(eq(staff.id, order.placedByStaffId))
      .limit(1);
    staffInfo = staffRows[0] || null;
  }

  return {
    ...transaction,
    order: order ? {
      ...order,
      items: items,
      table: tableInfo,
      placedByStaff: staffInfo,
    } : null,
  };
}
