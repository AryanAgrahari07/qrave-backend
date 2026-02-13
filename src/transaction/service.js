import { eq, and, desc, sql, gte, lte, or, ilike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { transactions, orders, orderItems, tables, staff, restaurants } from "../../shared/schema.js";
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
    combinedSubtotal,
    combinedGst,
    combinedService,
    combinedTotal,
  } = data;

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

  const subtotal = combinedSubtotal !== undefined ? combinedSubtotal : order.subtotalAmount;
  const gst = combinedGst !== undefined ? combinedGst : order.gstAmount;
  const service = combinedService !== undefined ? combinedService : order.serviceTaxAmount;
  const total = combinedTotal !== undefined ? combinedTotal : order.totalAmount;

  // Snapshot the tax rates used at the time of payment so receipts remain historical
  const restaurantRows = await db
    .select({ taxRateGst: restaurants.taxRateGst, taxRateService: restaurants.taxRateService })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const restaurant = restaurantRows[0];

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

      // Rate snapshots
      taxRateGst: restaurant?.taxRateGst ?? null,
      taxRateService: restaurant?.taxRateService ?? null,

      paymentMethod,
      paymentReference: paymentReference || null,
    })
    .returning();

  const transaction = transactionRows[0];

  if (order.tableId && order.orderType === "DINE_IN") {
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
 * List transactions for a restaurant with pagination and search (OPTIMIZED)
 * Only fetches essential fields for list view
 * @param {string} restaurantId - Restaurant ID
 * @param {object} filters - Filter options
 * @returns {Promise<object>} Transactions with pagination info
 */
export async function listTransactions(restaurantId, filters = {}) {
  const {
    fromDate,
    toDate,
    paymentMethod,
    search,
    limit = 20,
    offset = 0,
  } = filters;

  // Build WHERE conditions
  let conditions = [eq(transactions.restaurantId, restaurantId)];

  if (fromDate) {
    conditions.push(gte(transactions.paidAt, new Date(fromDate)));
  }
  if (toDate) {
    // Add 1 day to include the entire end date
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    conditions.push(lte(transactions.paidAt, endDate));
  }
  if (paymentMethod) {
    conditions.push(eq(transactions.paymentMethod, paymentMethod));
  }

  // OPTIMIZATION: Select only necessary fields for list view
  let baseQuery = db
    .select({
      // Transaction essentials
      id: transactions.id,
      billNumber: transactions.billNumber,
      paidAt: transactions.paidAt,
      paymentMethod: transactions.paymentMethod,
      grandTotal: transactions.grandTotal,
      subtotal: transactions.subtotal,
      gstAmount: transactions.gstAmount,
      serviceTaxAmount: transactions.serviceTaxAmount,
      
      // Minimal order info
      orderId: orders.id,
      orderType: orders.orderType,
      guestName: orders.guestName,
      
      // Minimal table info (only what's displayed)
      tableNumber: tables.tableNumber,
    })
    .from(transactions)
    .leftJoin(orders, eq(transactions.orderId, orders.id))
    .leftJoin(tables, eq(orders.tableId, tables.id));

  // Apply base conditions
  let query = baseQuery.where(and(...conditions));

  // Add search filter if provided
  if (search && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    const searchConditions = [
      ...conditions,
      or(
        ilike(transactions.billNumber, searchTerm),
        sql`CAST(${tables.tableNumber} AS TEXT) ILIKE ${searchTerm}`,
        ilike(orders.guestName, searchTerm)
      )
    ];
    query = baseQuery.where(and(...searchConditions));
  }

  // Count query - optimized with specific fields
  let countConditions = [...conditions];
  if (search && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    countConditions.push(
      or(
        ilike(transactions.billNumber, searchTerm),
        sql`CAST(${tables.tableNumber} AS TEXT) ILIKE ${searchTerm}`,
        ilike(orders.guestName, searchTerm)
      )
    );
  }

  const countQuery = db
    .select({ count: sql`count(*)::int` })
    .from(transactions)
    .leftJoin(orders, eq(transactions.orderId, orders.id))
    .leftJoin(tables, eq(orders.tableId, tables.id))
    .where(and(...countConditions));

  // Execute queries in parallel
  const [transactionsList, totalCountResult] = await Promise.all([
    query
      .orderBy(desc(transactions.paidAt))
      .limit(limit)
      .offset(offset),
    countQuery
  ]);

  const total = totalCountResult[0]?.count || 0;

  // OPTIMIZATION: Return lightweight transaction objects for list view
  // No need to fetch order items or staff info for the list
  const lightweightTransactions = transactionsList.map(row => ({
    id: row.id,
    billNumber: row.billNumber,
    paidAt: row.paidAt,
    paymentMethod: row.paymentMethod,
    grandTotal: row.grandTotal,
    subtotal: row.subtotal,
    gstAmount: row.gstAmount,
    serviceTaxAmount: row.serviceTaxAmount,
    order: row.orderId ? {
      id: row.orderId,
      orderType: row.orderType,
      guestName: row.guestName,
      table: row.tableNumber ? {
        tableNumber: row.tableNumber,
      } : null,
    } : null,
  }));

  return {
    transactions: lightweightTransactions,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      totalPages: Math.ceil(total / limit),
      currentPage: Math.floor(offset / limit) + 1,
    },
  };
}

/**
 * Export transactions as CSV data
 * @param {string} restaurantId - Restaurant ID
 * @param {object} filters - Filter options
 * @returns {Promise<Array>} Transaction rows for CSV
 */
export async function exportTransactionsCSV(restaurantId, filters = {}) {
  const {
    fromDate,
    toDate,
    paymentMethod,
  } = filters;

  let conditions = [eq(transactions.restaurantId, restaurantId)];

  if (fromDate) {
    conditions.push(gte(transactions.paidAt, new Date(fromDate)));
  }
  if (toDate) {
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    conditions.push(lte(transactions.paidAt, endDate));
  }
  if (paymentMethod) {
    conditions.push(eq(transactions.paymentMethod, paymentMethod));
  }

  // OPTIMIZATION: Only select fields needed for CSV
  const transactionsList = await db
    .select({
      billNumber: transactions.billNumber,
      paidAt: transactions.paidAt,
      paymentMethod: transactions.paymentMethod,
      subtotal: transactions.subtotal,
      gstAmount: transactions.gstAmount,
      serviceTaxAmount: transactions.serviceTaxAmount,
      discountAmount: transactions.discountAmount,
      grandTotal: transactions.grandTotal,
      tableNumber: tables.tableNumber,
      guestName: orders.guestName,
    })
    .from(transactions)
    .leftJoin(orders, eq(transactions.orderId, orders.id))
    .leftJoin(tables, eq(orders.tableId, tables.id))
    .where(and(...conditions))
    .orderBy(desc(transactions.paidAt));

  // Transform to CSV-friendly format
  return transactionsList.map((row) => ({
    bill_number: row.billNumber,
    paid_at: row.paidAt,
    table_or_guest: row.tableNumber 
      ? `Table ${row.tableNumber}` 
      : row.guestName || 'N/A',
    payment_method: row.paymentMethod,
    subtotal: row.subtotal,
    gst_amount: row.gstAmount,
    service_tax_amount: row.serviceTaxAmount,
    discount_amount: row.discountAmount,
    grand_total: row.grandTotal,
  }));
}

/**
 * Get transaction by ID with FULL details (for detail view/bill modal)
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

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, transaction.orderId))
    .limit(1);

  const order = orderRows[0];
  
  const items = order ? await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, transaction.orderId)) : [];

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


/**
 * Get recent transactions summary (lightweight for widgets/dashboards)
 * Only fetches essential fields needed for display
 * @param {string} restaurantId - Restaurant ID
 * @param {number} limit - Number of recent transactions to fetch (default 5)
 * @returns {Promise<Array>} Lightweight transaction summaries
 */
export async function getRecentTransactionsSummary(restaurantId, limit = 5) {
  // OPTIMIZATION: Only select the bare minimum fields needed for the widget
  const recentTransactions = await db
    .select({
      // Transaction essentials only
      id: transactions.id,
      billNumber: transactions.billNumber,
      paidAt: transactions.paidAt,
      paymentMethod: transactions.paymentMethod,
      grandTotal: transactions.grandTotal,
      
      // Minimal order info
      orderType: orders.orderType,
      guestName: orders.guestName,
      
      // Only table number (not full table object)
      tableNumber: tables.tableNumber,
      
      // Only staff name (not full staff object)
      staffName: sql`${staff.fullName}`,
    })
    .from(transactions)
    .leftJoin(orders, eq(transactions.orderId, orders.id))
    .leftJoin(tables, eq(orders.tableId, tables.id))
    .leftJoin(staff, eq(orders.placedByStaffId, staff.id))
    .where(eq(transactions.restaurantId, restaurantId))
    .orderBy(desc(transactions.paidAt))
    .limit(limit);

  // Return lightweight objects - no nested structures
  return recentTransactions.map(row => ({
    id: row.id,
    billNumber: row.billNumber,
    paidAt: row.paidAt,
    paymentMethod: row.paymentMethod,
    grandTotal: row.grandTotal,
    orderType: row.orderType,
    guestName: row.guestName,
    tableNumber: row.tableNumber,
    staffName: row.staffName,
  }));
}