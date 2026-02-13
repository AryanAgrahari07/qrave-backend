import { eq, and, desc, sql, gte, lte, inArray, not, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { 
  orders, 
  orderItems, 
  menuItems, 
  tables, 
  restaurants,
  menuItemVariants,
  modifiers,
  modifierGroups,
  transactions
} from "../../shared/schema.js";
import { createPgPool } from "../db.js";
import {
  emitOrderCreated,
  emitOrderItemsAdded,
  emitOrderStatusChanged,
  emitOrderUpdated,
} from "../realtime/events.js";
import { emitTableStatusChanged } from "../realtime/events.js";

const pool = createPgPool();
const db = drizzle(pool);

/**
 * Process order items with customization data
 * Fetches variant and modifier details, calculates prices including customizations
 * @private
 */
async function processOrderItemsWithCustomization(restaurantId, items) {
  const processedItems = [];
  let subtotal = 0;

  for (const item of items) {
    // Fetch base menu item
    const menuItemRows = await db
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.id, item.menuItemId),
          eq(menuItems.restaurantId, restaurantId)
        )
      )
      .limit(1);

    const menuItem = menuItemRows[0];
    if (!menuItem) {
      throw new Error(`Menu item ${item.menuItemId} not found`);
    }

    let basePrice = parseFloat(menuItem.price);
    let variantData = null;
    let modifiersData = [];
    let customizationAmount = 0;

    // Handle variant selection (size/portion)
    if (item.variantId) {
      const variantRows = await db
        .select()
        .from(menuItemVariants)
        .where(
          and(
            eq(menuItemVariants.id, item.variantId),
            eq(menuItemVariants.menuItemId, item.menuItemId),
            eq(menuItemVariants.restaurantId, restaurantId)
          )
        )
        .limit(1);

      if (variantRows[0]) {
        const variant = variantRows[0];
        variantData = {
          id: variant.id,
          name: variant.variantName,
          price: parseFloat(variant.price),
        };
        // Variant price REPLACES base price (not adds to it)
        basePrice = variantData.price;
      }
    }

    // Handle modifier selections (add-ons/toppings)
    if (item.modifierIds && item.modifierIds.length > 0) {
      const modifierRows = await db
        .select({
          id: modifiers.id,
          name: modifiers.name,
          price: modifiers.price,
          groupId: modifiers.modifierGroupId,
          groupName: modifierGroups.name,
        })
        .from(modifiers)
        .innerJoin(modifierGroups, eq(modifiers.modifierGroupId, modifierGroups.id))
        .where(
          and(
            inArray(modifiers.id, item.modifierIds),
            eq(modifiers.restaurantId, restaurantId)
          )
        );

      for (const mod of modifierRows) {
        const modPrice = parseFloat(mod.price);
        modifiersData.push({
          id: mod.id,
          name: mod.name,
          price: modPrice,
          groupId: mod.groupId,
          groupName: mod.groupName,
        });
        customizationAmount += modPrice;
      }
    }

    // Calculate item total: (base/variant price + modifiers) * quantity
    const itemTotal = (basePrice + customizationAmount) * item.quantity;
    subtotal += itemTotal;

    processedItems.push({
      menuItemId: item.menuItemId,
      itemName: menuItem.name,
      unitPrice: basePrice.toFixed(2),
      quantity: item.quantity,
      totalPrice: itemTotal.toFixed(2),
      notes: item.notes || null,
      
      // Customization data (snapshot at order time)
      selectedVariantId: variantData?.id || null,
      variantName: variantData?.name || null,
      variantPrice: variantData?.price?.toFixed(2) || null,
      selectedModifiers: modifiersData,
      customizationAmount: customizationAmount.toFixed(2),
    });
  }

  return { processedItems, subtotal };
}


/**
 * ✅ FIX #1: Update payment status without creating duplicate transactions
 * Creates transaction ONLY if none exists for this order
 * Updates existing transaction if order was partially paid
 */
export async function updatePaymentStatus(restaurantId, orderId, paymentStatus, paymentMethod = null) {
  // Get current order to calculate paid amount
  const order = await getOrder(restaurantId, orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  const currentPaidAmount = parseFloat(order.paid_amount || "0");
  const totalAmount = parseFloat(order.totalAmount);
  const outstandingAmount = totalAmount - currentPaidAmount;

  const updateData = {
    paymentStatus,
    updatedAt: new Date(),
  };

  // If marking as PAID, update paid amount and close order
  if (paymentStatus === "PAID") {
    // Add the outstanding amount to paid amount
    updateData.paid_amount = totalAmount.toFixed(2);  // ✅ This correctly sets to total
    updateData.closedAt = new Date();
    
    console.log("💳 Marking order as PAID");
    console.log("Previous paid amount:", currentPaidAmount.toFixed(2));
    console.log("Outstanding amount paid:", outstandingAmount.toFixed(2));
    console.log("Total paid amount:", totalAmount.toFixed(2));
  }

  const rows = await db
    .update(orders)
    .set(updateData)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.id, orderId)
      )
    )
    .returning();

  const updated = rows[0] || null;
  if (updated) {
    emitOrderStatusChanged(restaurantId, updated);
    
    // ✅ FIX: Only create transaction if marking as PAID AND no transaction exists
    if (paymentStatus === "PAID" && paymentMethod) {
      // Check if transaction already exists for this order
      const existingTransactionRows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.orderId, orderId))
        .limit(1);

      const existingTransaction = existingTransactionRows[0];

      if (existingTransaction) {
        // ✅ UPDATE existing transaction instead of creating new one
        console.log("💳 Transaction already exists, updating it...");
        
        await db
          .update(transactions)
          .set({
            paymentMethod: paymentMethod.toUpperCase(),
            grandTotal: updated.totalAmount,
            subtotal: updated.subtotalAmount,
            gstAmount: updated.gstAmount,
            serviceTaxAmount: updated.serviceTaxAmount,
            discountAmount: updated.discountAmount || "0",
            paidAt: new Date(), // Update payment time
          })
          .where(eq(transactions.id, existingTransaction.id));

        console.log("✅ Transaction updated:", existingTransaction.id);
      } else {
        // ✅ CREATE new transaction only if none exists
        const billNumber = `INV-${Math.floor(1000 + Math.random() * 9000)}`;
        
        const { createTransaction } = await import("../transaction/service.js");
        
        try {
          await createTransaction(
            restaurantId,
            updated.id,
            {
              billNumber,
              paymentMethod: paymentMethod.toUpperCase(),
              combinedSubtotal: parseFloat(updated.subtotalAmount),
              combinedGst: parseFloat(updated.gstAmount),
              combinedService: parseFloat(updated.serviceTaxAmount),
              combinedTotal: parseFloat(updated.totalAmount),
            }
          );

          console.log("✅ New transaction created");
        } catch (err) {
          console.error("Failed to create transaction:", err);
        }
      }
    }
  }
  
  return updated;
}



/**
 * Cancel order with reason
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @param {string} cancelReason - Reason for cancellation
 * @returns {Promise<object|null>} Cancelled order
 */
export async function cancelOrderWithReason(restaurantId, orderId, cancelReason) {
  if (!cancelReason || cancelReason.trim().length === 0) {
    throw new Error("Cancel reason is required");
  }

  const rows = await db
    .update(orders)
    .set({
      status: "CANCELLED",
      paymentStatus: "DUE", // Reset payment status on cancel
      cancelReason: cancelReason.trim(),
      updatedAt: new Date(),
      closedAt: new Date(),
    })
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.id, orderId)
      )
    )
    .returning();

  const cancelled = rows[0] || null;
  if (cancelled) {
    emitOrderStatusChanged(restaurantId, cancelled);
    
    // If order was for a table, set table back to AVAILABLE
    if (cancelled.tableId) {
      try {
        const tableRows = await db
          .update(tables)
          .set({
            currentStatus: "AVAILABLE",
            assignedWaiterId: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tables.restaurantId, restaurantId),
              eq(tables.id, cancelled.tableId)
            )
          )
          .returning();
        
        if (tableRows[0]) {
          emitTableStatusChanged(restaurantId, tableRows[0]);
        }
      } catch (err) {
        console.error("Failed to update table status:", err);
      }
    }
  }
  
  return cancelled;
}


/**
 * ✅ FIX #2: Create order with proper open/closed logic
 * Only reuses existing order if it's OPEN (is_closed = false)
 * Closed orders will trigger creation of new order
 */
export async function createOrder(restaurantId, data, placedByStaffId = null) {
  const {
    tableId,
    guestName,
    guestPhone,
    orderType = "DINE_IN",
    items = [],
    notes,
    paymentMethod = "DUE",
    paymentStatus = "DUE",
  } = data;

  // ✅ FIX: Only reuse order if it's OPEN (is_closed = false)
  // This prevents adding items to completed/closed orders
  if (tableId && orderType === "DINE_IN") {
    const existingRows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          eq(orders.orderType, "DINE_IN"),
          eq(orders.isClosed, false), // ✅ CRITICAL: Only open orders
          // Include orders in any active state OR partially paid
          or(
            inArray(orders.status, ['PENDING', 'PREPARING', 'READY', 'SERVED']),
            eq(orders.paymentStatus, 'PARTIALLY_PAID')
          )
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);

    const existing = existingRows[0];
    if (existing) {
      console.log("🔄 Found OPEN order for table, adding items to it:", existing.id);
      
      // Optionally enrich guest info if provided
      if ((guestName && !existing.guestName) || (guestPhone && !existing.guestPhone) || notes) {
        await db
          .update(orders)
          .set({
            guestName: existing.guestName ?? (guestName || null),
            guestPhone: existing.guestPhone ?? (guestPhone || null),
            notes: notes ?? existing.notes,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, existing.id));
      }

      // Add items to existing order (this will handle payment status properly)
      const { order: updatedOrder } = await addOrderItems(restaurantId, existing.id, items, paymentMethod, paymentStatus);
      
      console.log("✅ Items added to existing OPEN order. Payment status:", updatedOrder.paymentStatus);
      
      return updatedOrder;
    } else {
      console.log("📝 No open order found for table, creating new order");
    }
  }

  // Process items with customization
  const { processedItems, subtotal } = await processOrderItemsWithCustomization(
    restaurantId,
    items
  );

  // Get restaurant tax rates
  const restaurantRows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const restaurant = restaurantRows[0];
  const gstRate = restaurant ? parseFloat(restaurant.taxRateGst) / 100 : 0.05;
  const serviceRate = restaurant ? parseFloat(restaurant.taxRateService) / 100 : 0.1;

  const gstAmount = subtotal * gstRate;
  const serviceTaxAmount = subtotal * serviceRate;
  const totalAmount = subtotal + gstAmount + serviceTaxAmount;
  
  console.log("-----");
  console.log("✅ Order placed by staff ID:", placedByStaffId);
  
  const finalOrderStatus = "PENDING";
  const finalPaymentStatus = paymentStatus;
  
  // If payment is made upfront (PAID status), track the paid amount
  const paid_amount = paymentStatus === "PAID" ? totalAmount.toFixed(2) : "0";

  // Create order (defaults to OPEN - is_closed = false)
  const orderRows = await db
    .insert(orders)
    .values({
      restaurantId,
      tableId: tableId || null,
      guestName: guestName || null,
      guestPhone: guestPhone || null,
      placedByStaffId: placedByStaffId || null,
      status: finalOrderStatus,
      paymentStatus: finalPaymentStatus,
      orderType,
      subtotalAmount: subtotal.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      serviceTaxAmount: serviceTaxAmount.toFixed(2),
      discountAmount: "0",
      totalAmount: totalAmount.toFixed(2),
      paid_amount: paid_amount,
      notes: notes || null,
      isClosed: false, // ✅ New orders are always OPEN
    })
    .returning();

  const order = orderRows[0];
  console.log("📝 New OPEN order created:", order.id, "Payment status:", order.paymentStatus);

  // Create order items with customization data
  const orderItemsData = processedItems.map((item) => ({
    restaurantId,
    orderId: order.id,
    menuItemId: item.menuItemId,
    itemName: item.itemName,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    notes: item.notes,
    // Customization fields
    selectedVariantId: item.selectedVariantId,
    variantName: item.variantName,
    variantPrice: item.variantPrice,
    selectedModifiers: sql`${JSON.stringify(item.selectedModifiers)}::jsonb`,
    customizationAmount: item.customizationAmount,
  }));

  const createdItems = await db
    .insert(orderItems)
    .values(orderItemsData)
    .returning();

  const result = {
    ...order,
    items: createdItems,
  };

  // Update table status to OCCUPIED if tableId is provided and orderType is DINE_IN
  if (tableId && orderType === "DINE_IN") {
    const tableRows = await db
      .update(tables)
      .set({
        currentStatus: "OCCUPIED",
        // Clear any previous waiter and set current if available
        assignedWaiterId: placedByStaffId || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tables.restaurantId, restaurantId),
          eq(tables.id, tableId)
        )
      )
      .returning();
    
    if (tableRows[0]) {
      emitTableStatusChanged(restaurantId, tableRows[0]);
    }
  }

  // If paid upfront, create transaction record
  if (paymentStatus === "PAID" && paymentMethod && paymentMethod !== "DUE") {
    const billNumber = `INV-${Math.floor(1000 + Math.random() * 9000)}`;
    const { createTransaction } = await import("../transaction/service.js");
    
    try {
      await createTransaction(restaurantId, order.id, {
        billNumber,
        paymentMethod: paymentMethod.toUpperCase(),
        combinedSubtotal: parseFloat(order.subtotalAmount),
        combinedGst: parseFloat(order.gstAmount),
        combinedService: parseFloat(order.serviceTaxAmount),
        combinedTotal: parseFloat(order.totalAmount),
      });
      console.log("💳 Transaction created for prepaid order");
    } catch (err) {
      console.error("Failed to create transaction for prepaid order:", err);
    }
  }

  emitOrderCreated(restaurantId, result);
  console.log(result);

  return result;
}

/**
 * Get order by ID with items (including customization data)
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @returns {Promise<object|null>} Order with items
 */
export async function getOrder(restaurantId, orderId) {
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
  if (!order) return null;

  // Get order items with customization data
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  // Parse selectedModifiers JSONB field for each item
  const parsedItems = items.map(item => ({
    ...item,
    selectedModifiers: item.selectedModifiers || [],
  }));

  // Get staff info if available
  let staffInfo = null;
  if (order.placedByStaffId) {
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
    ...order,
    paid_amount: order.paid_amount || order.paid_amount,
    items: parsedItems,
    placedByStaff: staffInfo,
  };
}

/**
 * List orders with filters and pagination (including customization data in items)
 * @param {string} restaurantId - Restaurant ID
 * @param {object} filters - Filter options
 * @returns {Promise<object>} Object with orders array and total count
 */
export async function listOrders(restaurantId, filters = {}) {
  const {
    status,
    orderType,
    tableId,
    fromDate,
    toDate,
    limit = 50,
    offset = 0,
    placedByStaffId,
    excludePaid = true, // Default to excluding PAID orders
  } = filters;

  let conditions = [eq(orders.restaurantId, restaurantId)];

  if (excludePaid) {
    // Exclude CANCELLED orders
    conditions.push(not(eq(orders.status, 'CANCELLED')));
    // Exclude orders that are both SERVED AND PAID AND CLOSED
    conditions.push(
      or(
        not(eq(orders.status, 'SERVED')),
        not(eq(orders.paymentStatus, 'PAID')),
        not(eq(orders.isClosed, true)) // ✅ Show PAID orders if still OPEN
      )
    );
  }


  if (status) {
    if (Array.isArray(status)) {
      conditions.push(inArray(orders.status, status));
    } else {
      conditions.push(eq(orders.status, status));
    }
  }

  if (orderType) {
    conditions.push(eq(orders.orderType, orderType));
  }
  if (tableId) {
    conditions.push(eq(orders.tableId, tableId));
  }
  if (fromDate) {
    conditions.push(gte(orders.createdAt, new Date(fromDate)));
  }
  if (toDate) {
    conditions.push(lte(orders.createdAt, new Date(toDate)));
  }
  // Filter by staff ID if provided (for waiter terminal)
  if (placedByStaffId) {
    conditions.push(eq(orders.placedByStaffId, placedByStaffId));
  }

  // Get total count for pagination
  const countResult = await db
    .select({ count: sql`count(*)` })
    .from(orders)
    .where(and(...conditions));

  const total = parseInt(countResult[0]?.count || 0);

  // Get paginated orders
  const ordersList = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);

  // Get items and table info for each order
  const ordersWithDetails = await Promise.all(
    ordersList.map(async (order) => {
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      // Parse selectedModifiers JSONB for each item
      const parsedItems = items.map(item => ({
        ...item,
        selectedModifiers: item.selectedModifiers || [],
      }));

      // Get table info if available
      let tableInfo = null;
      if (order.tableId) {
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
      if (order.placedByStaffId) {
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
        ...order,
        paid_amount: order.paid_amount || order.paid_amount || "0",
        items: parsedItems,
        table: tableInfo,
        placedByStaff: staffInfo,
      };
    })
  );

  return {
    orders: ordersWithDetails,
    total,
  };
}

/**
 * Update order status
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @param {string} status - New status
 * @returns {Promise<object|null>} Updated order
 */
export async function updateOrderStatus(restaurantId, orderId, status) {
  const updateData = {
    status,
    updatedAt: new Date(),
  };

  // If status is PAID, set closedAt
  if (status === "PAID") {
    updateData.closedAt = new Date();
  }

  const rows = await db
    .update(orders)
    .set(updateData)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.id, orderId)
      )
    )
    .returning();

  const updated = rows[0] || null;
  if (updated) {
    emitOrderStatusChanged(restaurantId, updated);
  }
  return updated;
}

/**
 * Update order (partial update)
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @param {object} data - Update data
 * @returns {Promise<object|null>} Updated order
 */
export async function updateOrder(restaurantId, orderId, data) {
  const rows = await db
    .update(orders)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.id, orderId)
      )
    )
    .returning();

  const updated = rows[0] || null;
  if (updated) {
    emitOrderUpdated(restaurantId, updated);
  }
  return updated;
}

/**
 * Cancel order
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @returns {Promise<object|null>} Cancelled order
 */
export async function cancelOrder(restaurantId, orderId) {
  return updateOrderStatus(restaurantId, orderId, "CANCELLED");
}

/**
 * ✅ NEW: Close an order (mark as is_closed = true)
 * This prevents future orders from being added to this order
 * Only available for SERVED + PAID orders
 */
export async function closeOrder(restaurantId, orderId) {
  const order = await getOrder(restaurantId, orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  // Validate order can be closed
  if (order.status !== "SERVED") {
    throw new Error("Order must be SERVED before closing");
  }
  if (order.paymentStatus !== "PAID") {
    throw new Error("Order must be fully PAID before closing");
  }
  if (order.isClosed) {
    throw new Error("Order is already closed");
  }

  const rows = await db
    .update(orders)
    .set({
      isClosed: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.id, orderId)
      )
    )
    .returning();

  const updated = rows[0] || null;
  if (updated) {
    console.log("🔒 Order closed:", orderId);
    emitOrderUpdated(restaurantId, updated);
    
    // If table order, check if we should free the table
    if (updated.tableId) {
      // Check if there are any other OPEN orders for this table
      const otherOpenOrders = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.tableId, updated.tableId),
            eq(orders.isClosed, false),
            not(eq(orders.id, orderId))
          )
        )
        .limit(1);

      // If no other open orders, free the table
      if (otherOpenOrders.length === 0) {
        const tableRows = await db
          .update(tables)
          .set({
            currentStatus: "AVAILABLE",
            assignedWaiterId: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tables.restaurantId, restaurantId),
              eq(tables.id, updated.tableId)
            )
          )
          .returning();
        
        if (tableRows[0]) {
          emitTableStatusChanged(restaurantId, tableRows[0]);
          console.log("✅ Table freed:", tableRows[0].tableNumber);
        }
      }
    }
  }
  
  return updated;
}

/**
 * Get active orders for kitchen (PENDING, PREPARING, READY) with customization
 * @param {string} restaurantId - Restaurant ID
 * @returns {Promise<Array>} Active orders with items
 */
export async function getKitchenOrders(restaurantId) {
  const activeOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        inArray(orders.status, ['PENDING', 'PREPARING', 'READY'])
      )
    )
    .orderBy(orders.createdAt);

  // Get items for each order
  const ordersWithItems = await Promise.all(
    activeOrders.map(async (order) => {
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      // Parse selectedModifiers JSONB for each item
      const parsedItems = items.map(item => ({
        ...item,
        selectedModifiers: item.selectedModifiers || [],
      }));

      // Get table info if available
      let tableInfo = null;
      if (order.tableId) {
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
      if (order.placedByStaffId) {
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
        ...order,
        items: parsedItems,
        table: tableInfo,
        placedByStaff: staffInfo,
      };
    })
  );

  return ordersWithItems;
}

/**
 * Get order history (completed/cancelled orders)
 * @param {string} restaurantId - Restaurant ID
 * @param {object} options - Pagination and filter options
 * @returns {Promise<object>} Orders with pagination info
 */
export async function getOrderHistory(restaurantId, options = {}) {
  const {
    limit = 50,
    offset = 0,
    fromDate,
    toDate,
    status = ["SERVED", "PAID", "CANCELLED"],
  } = options;

  let conditions = [
    eq(orders.restaurantId, restaurantId),
    inArray(orders.status, status),
  ];

  if (fromDate) {
    conditions.push(gte(orders.createdAt, new Date(fromDate)));
  }
  if (toDate) {
    conditions.push(lte(orders.createdAt, new Date(toDate)));
  }

  const ordersList = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await db
    .select({ count: sql`count(*)` })
    .from(orders)
    .where(and(...conditions));

  const totalCount = parseInt(countResult[0]?.count || 0);

  return {
    orders: ordersList,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  };
}

/**
 * Get order statistics for a restaurant
 * @param {string} restaurantId - Restaurant ID
 * @param {object} options - Time range options
 * @returns {Promise<object>} Order statistics
 */
export async function getOrderStats(restaurantId, options = {}) {
  const { fromDate, toDate } = options;

  let conditions = [eq(orders.restaurantId, restaurantId)];

  if (fromDate) {
    conditions.push(gte(orders.createdAt, new Date(fromDate)));
  }
  if (toDate) {
    conditions.push(lte(orders.createdAt, new Date(toDate)));
  }

  const stats = await db
    .select({
      totalOrders: sql`count(*)`,
      totalRevenue: sql`sum(${orders.totalAmount})`,
      avgOrderValue: sql`avg(${orders.totalAmount})`,
      pendingOrders: sql`count(*) filter (where ${orders.status} = 'PENDING')`,
      preparingOrders: sql`count(*) filter (where ${orders.status} = 'PREPARING')`,
      servedOrders: sql`count(*) filter (where ${orders.status} = 'SERVED')`,
      paidOrders: sql`count(*) filter (where ${orders.status} = 'PAID')`,
      cancelledOrders: sql`count(*) filter (where ${orders.status} = 'CANCELLED')`,
    })
    .from(orders)
    .where(and(...conditions));

  return stats[0];
}

/**
 * Add items to existing order (with customization support)
 * ✅ FIXED: Properly handles payment for new items
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @param {Array} items - Items to add (may include variantId and modifierIds)
 * @param {string} paymentMethod - Payment method for new items (CASH, CARD, UPI, DUE)
 * @param {string} paymentStatus - Payment status for new items (PAID, DUE)
 * @returns {Promise<object>} Updated order with new items
 */
export async function addOrderItems(restaurantId, orderId, items, paymentMethod = "DUE", paymentStatus = "DUE") {
  // Verify order exists and belongs to restaurant
  const order = await getOrder(restaurantId, orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  // ✅ CRITICAL: Cannot add items to CLOSED orders
  if (order.isClosed) {
    throw new Error("Cannot add items to a closed order. Please create a new order.");
  }

  console.log("📦 Adding items to order:", orderId);
  console.log("Current payment status:", order.paymentStatus);
  console.log("Current total:", order.totalAmount);
  console.log("Current paid amount:", order.paid_amount || "0");
  console.log("Order closed?", order.isClosed);
  console.log("New items payment method:", paymentMethod);
  console.log("New items payment status:", paymentStatus);

  // Process new items with customization
  const { processedItems, subtotal: additionalTotal } = await processOrderItemsWithCustomization(
    restaurantId,
    items
  );

  // Insert new items with customization data
  const orderItemsData = processedItems.map((item) => ({
    restaurantId,
    orderId,
    menuItemId: item.menuItemId,
    itemName: item.itemName,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    notes: item.notes,
    // Customization fields
    selectedVariantId: item.selectedVariantId,
    variantName: item.variantName,
    variantPrice: item.variantPrice,
    selectedModifiers: sql`${JSON.stringify(item.selectedModifiers)}::jsonb`,
    customizationAmount: item.customizationAmount,
  }));

  const newItems = await db
    .insert(orderItems)
    .values(orderItemsData)
    .returning();

  // Recalculate order totals
  const newSubtotal = parseFloat(order.subtotalAmount) + additionalTotal;
  const restaurant = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const gstRate = restaurant[0] ? parseFloat(restaurant[0].taxRateGst) / 100 : 0.05;
  const serviceRate = restaurant[0] ? parseFloat(restaurant[0].taxRateService) / 100 : 0.1;

  const newGst = newSubtotal * gstRate;
  const newService = newSubtotal * serviceRate;
  const newTotal = newSubtotal + newGst + newService;

  // ✅ CRITICAL: Calculate taxes on ONLY the new items
  const additionalTotalWithTax = additionalTotal + (additionalTotal * gstRate) + (additionalTotal * serviceRate);

  // ✅ FIX: Handle payment for new items
  let updatedPaidAmount = parseFloat(order.paid_amount || "0");
  let newPaymentStatus = order.paymentStatus;
  let newOrderStatus = order.status;

  console.log("\n💰 Payment calculation for new items:");
  console.log("Additional items subtotal:", additionalTotal.toFixed(2));
  console.log("Additional items total (with tax):", additionalTotalWithTax.toFixed(2));
  console.log("Payment method for new items:", paymentMethod);
  console.log("Payment status for new items:", paymentStatus);

  // If new items are being PAID (not DUE), add to paid_amount
  if (paymentStatus === "PAID" && paymentMethod !== "DUE") {
    updatedPaidAmount += additionalTotalWithTax;
    console.log("✅ New items PAID - adding to paid_amount:", additionalTotalWithTax.toFixed(2));
    console.log("Updated paid_amount:", updatedPaidAmount.toFixed(2));
  } else {
    console.log("⏳ New items marked as DUE - not adding to paid_amount");
  }

  // Determine final payment status
  if (updatedPaidAmount >= newTotal - 0.01) { // Allow 1 cent tolerance for rounding
    newPaymentStatus = "PAID";
    updatedPaidAmount = newTotal; // Ensure exact match
    console.log("✅ Order now FULLY PAID");
  } else if (updatedPaidAmount > 0) {
    newPaymentStatus = "PARTIALLY_PAID";
    console.log("⚠️ Order now PARTIALLY PAID");
    console.log("Total:", newTotal.toFixed(2));
    console.log("Paid:", updatedPaidAmount.toFixed(2));
    console.log("Outstanding:", (newTotal - updatedPaidAmount).toFixed(2));
  } else {
    newPaymentStatus = "DUE";
    console.log("📋 Order remains DUE");
  }

  // Determine order status
  if (order.status === "SERVED" || order.status === "READY") {
    // Adding items to SERVED/READY order - send back to kitchen
    newOrderStatus = "PENDING";
    console.log("🔄 Order status reset to PENDING (new items need preparation)");
  }

  console.log("\n📊 Final order state:");
  console.log("New total:", newTotal.toFixed(2));
  console.log("Final paid_amount:", updatedPaidAmount.toFixed(2));
  console.log("Final payment status:", newPaymentStatus);
  console.log("Final order status:", newOrderStatus);

  // Update order totals and payment status
  await db
    .update(orders)
    .set({
      subtotalAmount: newSubtotal.toFixed(2),
      gstAmount: newGst.toFixed(2),
      serviceTaxAmount: newService.toFixed(2),
      totalAmount: newTotal.toFixed(2),
      paid_amount: updatedPaidAmount.toFixed(2),
      paymentStatus: newPaymentStatus,
      status: newOrderStatus,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  // ✅ If new items were PAID, create/update transaction
  if (paymentStatus === "PAID" && paymentMethod !== "DUE" && additionalTotalWithTax > 0) {
    console.log("\n💳 Creating/updating transaction for paid items...");
    
    // Check if transaction exists
    const existingTransactionRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, orderId))
      .limit(1);

    const existingTransaction = existingTransactionRows[0];

    if (existingTransaction) {
      // Update existing transaction
      console.log("Updating existing transaction:", existingTransaction.id);
      await db
        .update(transactions)
        .set({
          paymentMethod: paymentMethod.toUpperCase(),
          grandTotal: newTotal.toFixed(2),
          subtotal: newSubtotal.toFixed(2),
          gstAmount: newGst.toFixed(2),
          serviceTaxAmount: newService.toFixed(2),
          paidAt: new Date(),
        })
        .where(eq(transactions.id, existingTransaction.id));
    } else {
      // Create new transaction
      console.log("Creating new transaction");
      const billNumber = `INV-${Math.floor(1000 + Math.random() * 9000)}`;
      const { createTransaction } = await import("../transaction/service.js");
      
      try {
        await createTransaction(restaurantId, orderId, {
          billNumber,
          paymentMethod: paymentMethod.toUpperCase(),
          combinedSubtotal: newSubtotal,
          combinedGst: newGst,
          combinedService: newService,
          combinedTotal: newTotal,
        });
      } catch (err) {
        console.error("Failed to create transaction:", err);
      }
    }
  }

  const updatedOrder = await getOrder(restaurantId, orderId);
  if (updatedOrder) {
    console.log("\n✅ Order updated successfully");
    console.log("Final payment status:", updatedOrder.paymentStatus);
    console.log("Final total:", updatedOrder.totalAmount);
    console.log("Final paid amount:", updatedOrder.paid_amount);
    
    emitOrderStatusChanged(restaurantId, updatedOrder);
    emitOrderItemsAdded(restaurantId, orderId, newItems, updatedOrder);
  }

  return {
    order: updatedOrder,
    newItems,
  };
}


/**
 * Remove an item from an order
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @param {string} orderItemId - Order Item ID to remove
 * @returns {Promise<object>} Updated order
 */
export async function removeOrderItem(restaurantId, orderId, orderItemId) {
  // Verify order exists and belongs to restaurant
  const order = await getOrder(restaurantId, orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  // Only allow removing items from PENDING orders
  if (order.status !== "PENDING") {
    throw new Error("Can only remove items from pending orders");
  }

  // Find the item to remove
  const itemToRemove = order.items.find(i => i.id === orderItemId);
  if (!itemToRemove) {
    throw new Error("Order item not found");
  }

  // Remove the item
  await db
    .delete(orderItems)
    .where(
      and(
        eq(orderItems.id, orderItemId),
        eq(orderItems.orderId, orderId)
      )
    );

  // Recalculate order totals
  const itemTotal = parseFloat(itemToRemove.totalPrice);
  const newSubtotal = parseFloat(order.subtotalAmount) - itemTotal;
  
  // Get restaurant tax rates
  const restaurant = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const gstRate = restaurant[0] ? parseFloat(restaurant[0].taxRateGst) / 100 : 0.05;
  const serviceRate = restaurant[0] ? parseFloat(restaurant[0].taxRateService) / 100 : 0.1;

  const newGst = newSubtotal * gstRate;
  const newService = newSubtotal * serviceRate;
  const newTotal = newSubtotal + newGst + newService;

  // Update order totals
  await db
    .update(orders)
    .set({
      subtotalAmount: newSubtotal.toFixed(2),
      gstAmount: newGst.toFixed(2),
      serviceTaxAmount: newService.toFixed(2),
      totalAmount: newTotal.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  const updatedOrder = await getOrder(restaurantId, orderId);
  if (updatedOrder) {
    emitOrderUpdated(restaurantId, updatedOrder);
  }

  return {
    order: updatedOrder,
    deleted: true,
  };
}