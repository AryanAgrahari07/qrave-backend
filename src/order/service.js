import { eq, and, desc, sql, gte, lte, inArray, not, or } from "drizzle-orm";
import { 
  orders, 
  orderItems, 
  menuItems, 
  tables, 
  restaurants,
  menuItemVariants,
  modifiers,
  modifierGroups,
  transactions,
  staff
} from "../../shared/schema.js";
import { db } from "../dbClient.js";
import {
  emitOrderCreated,
  emitOrderItemsAdded,
  emitOrderStatusChanged,
  emitOrderUpdated,
} from "../realtime/events.js";
import { emitTableStatusChanged } from "../realtime/events.js";

/**
 * Process order items with customization data
 * Fetches variant and modifier details, calculates prices including customizations
 * @private
 */
async function processOrderItemsWithCustomization(restaurantId, items) {
  const processedItems = [];
  let subtotal = 0;

  if (!items?.length) return { processedItems, subtotal };

  // Batch fetch base menu items
  const menuItemIds = Array.from(new Set(items.map((i) => i.menuItemId)));
  const menuItemRows = await db
    .select({ id: menuItems.id, name: menuItems.name, price: menuItems.price })
    .from(menuItems)
    .where(and(eq(menuItems.restaurantId, restaurantId), inArray(menuItems.id, menuItemIds)));

  const menuItemMap = new Map(menuItemRows.map((m) => [m.id, m]));

  // Batch fetch selected variants (variant price replaces base price)
  const variantIds = Array.from(new Set(items.map((i) => i.variantId).filter(Boolean)));
  const variantRows = variantIds.length
    ? await db
        .select({
          id: menuItemVariants.id,
          menuItemId: menuItemVariants.menuItemId,
          variantName: menuItemVariants.variantName,
          price: menuItemVariants.price,
        })
        .from(menuItemVariants)
        .where(and(eq(menuItemVariants.restaurantId, restaurantId), inArray(menuItemVariants.id, variantIds)))
    : [];

  const variantMap = new Map(variantRows.map((v) => [v.id, v]));

  // Batch fetch selected modifiers + their groups
  const allModifierIds = Array.from(
    new Set(items.flatMap((i) => (Array.isArray(i.modifierIds) ? i.modifierIds : [])).filter(Boolean)),
  );

  const modifierRows = allModifierIds.length
    ? await db
        .select({
          id: modifiers.id,
          name: modifiers.name,
          price: modifiers.price,
          groupId: modifiers.modifierGroupId,
          groupName: modifierGroups.name,
        })
        .from(modifiers)
        .innerJoin(modifierGroups, eq(modifiers.modifierGroupId, modifierGroups.id))
        .where(and(eq(modifiers.restaurantId, restaurantId), inArray(modifiers.id, allModifierIds)))
    : [];

  const modifierMap = new Map(modifierRows.map((m) => [m.id, m]));

  for (const item of items) {
    const menuItem = menuItemMap.get(item.menuItemId);
    if (!menuItem) {
      throw new Error(`Menu item ${item.menuItemId} not found`);
    }

    let basePrice = parseFloat(menuItem.price);

    let variantData = null;
    if (item.variantId) {
      const variant = variantMap.get(item.variantId);
      // Preserve previous behavior: if variantId is provided but not found, ignore it.
      if (variant && variant.menuItemId === item.menuItemId) {
        variantData = {
          id: variant.id,
          name: variant.variantName,
          price: parseFloat(variant.price),
        };
        basePrice = variantData.price;
      }
    }

    let modifiersData = [];
    let customizationAmount = 0;
    if (Array.isArray(item.modifierIds) && item.modifierIds.length > 0) {
      for (const mid of item.modifierIds) {
        const mod = modifierMap.get(mid);
        // Preserve previous behavior: silently ignore missing modifiers.
        if (!mod) continue;

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
    waiveServiceCharge = false,
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

      // ✅ If caller provided a staff assignment (admin selected waiter),
      // update the existing open order so it becomes assigned to that waiter.
      // This is important for Waiter Terminal filtering/notifications.
      const shouldUpdateAssignment = placedByStaffId && existing.placedByStaffId !== placedByStaffId;

      // Optionally enrich guest info if provided
      if (
        (guestName && !existing.guestName) ||
        (guestPhone && !existing.guestPhone) ||
        notes ||
        shouldUpdateAssignment
      ) {
        await db
          .update(orders)
          .set({
            guestName: existing.guestName ?? (guestName || null),
            guestPhone: existing.guestPhone ?? (guestPhone || null),
            notes: notes ?? existing.notes,
            placedByStaffId: shouldUpdateAssignment ? placedByStaffId : existing.placedByStaffId,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, existing.id));

        // Also mirror assignment onto the table if applicable
        if (shouldUpdateAssignment) {
          try {
            await db
              .update(tables)
              .set({ assignedWaiterId: placedByStaffId, updatedAt: new Date() })
              .where(and(eq(tables.restaurantId, restaurantId), eq(tables.id, tableId)));
          } catch (err) {
            console.error("Failed to update table assignment for existing order:", err);
          }
        }
      }

      // Add items to existing order (this will handle payment status properly)
      const { order: updatedOrder } = await addOrderItems(
        restaurantId,
        existing.id,
        items,
        paymentMethod,
        paymentStatus,
      );

      console.log("✅ Items added to existing OPEN order. Payment status:", updatedOrder.paymentStatus);

      // Return enriched order so UI has placedByStaff info.
      return await getOrder(restaurantId, existing.id);
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

  // Service charge applies ONLY for dine-in orders, and can be waived per-order.
  const serviceTaxAmount =
    orderType === "DINE_IN" && !waiveServiceCharge ? subtotal * serviceRate : 0;

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
  const rows = await db
    .select({
      order: orders,
      placedByStaff: {
        id: staff.id,
        fullName: staff.fullName,
        role: staff.role,
      },
    })
    .from(orders)
    .leftJoin(staff, eq(staff.id, orders.placedByStaffId))
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const order = row.order;
  const placedByStaff = row.placedByStaff?.id ? row.placedByStaff : null;

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

  return {
    ...order,
    paid_amount: order.paid_amount || order.paid_amount,
    items: parsedItems,
    placedByStaff,
  };
}

/**
 * List cancelled orders (summary only) - lightweight and fast.
 * Returns only important fields + table + staff (no items join).
 */
export async function listCancelledOrdersSummary(restaurantId, filters = {}) {
  const {
    orderType,
    tableId,
    fromDate,
    toDate,
    limit = 20,
    offset = 0,
    placedByStaffId,
  } = filters;

  const conditions = [
    eq(orders.restaurantId, restaurantId),
    eq(orders.status, "CANCELLED"),
  ];

  if (orderType) conditions.push(eq(orders.orderType, orderType));
  if (tableId) conditions.push(eq(orders.tableId, tableId));
  if (fromDate) conditions.push(gte(orders.updatedAt, new Date(fromDate)));
  if (toDate) conditions.push(lte(orders.updatedAt, new Date(toDate)));
  if (placedByStaffId) conditions.push(eq(orders.placedByStaffId, placedByStaffId));

  const countResult = await db
    .select({ count: sql`count(*)` })
    .from(orders)
    .where(and(...conditions));
  const total = parseInt(countResult[0]?.count || 0);

  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      orderType: orders.orderType,
      paymentStatus: orders.paymentStatus,
      cancelReason: orders.cancelReason,
      subtotalAmount: orders.subtotalAmount,
      gstAmount: orders.gstAmount,
      serviceTaxAmount: orders.serviceTaxAmount,
      discountAmount: orders.discountAmount,
      totalAmount: orders.totalAmount,
      paid_amount: orders.paid_amount,
      guestName: orders.guestName,
      guestPhone: orders.guestPhone,
      tableId: orders.tableId,
      placedByStaffId: orders.placedByStaffId,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      closedAt: orders.closedAt,
      isClosed: orders.isClosed,
    })
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.updatedAt))
    .limit(limit)
    .offset(offset);

  // Enrich table + staff with minimal extra queries
  const tableIds = Array.from(new Set(rows.map(r => r.tableId).filter(Boolean)));
  const staffIds = Array.from(new Set(rows.map(r => r.placedByStaffId).filter(Boolean)));

  let tableMap = new Map();
  if (tableIds.length) {
    const tableRows = await db
      .select({ id: tables.id, tableNumber: tables.tableNumber, floorSection: tables.floorSection })
      .from(tables)
      .where(inArray(tables.id, tableIds));
    tableMap = new Map(tableRows.map(t => [t.id, t]));
  }

  let staffMap = new Map();
  if (staffIds.length) {
    const { staff } = await import("../../shared/schema.js");
    const staffRows = await db
      .select({ id: staff.id, fullName: staff.fullName, role: staff.role })
      .from(staff)
      .where(inArray(staff.id, staffIds));
    staffMap = new Map(staffRows.map(s => [s.id, s]));
  }

  const ordersSummary = rows.map(r => ({
    ...r,
    table: r.tableId ? tableMap.get(r.tableId) || null : null,
    placedByStaff: r.placedByStaffId ? staffMap.get(r.placedByStaffId) || null : null,
    items: undefined, // keep response light
  }));

  return { orders: ordersSummary, total };
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
    excludePaid = true, // Default behavior for live orders lists
  } = filters;

  let conditions = [eq(orders.restaurantId, restaurantId)];

  // If a specific status filter is provided, do NOT apply "excludePaid" heuristics.
  // Otherwise, requesting status=CANCELLED would never return results.
  const shouldApplyExcludePaid = excludePaid && !status;

  if (shouldApplyExcludePaid) {
    // Exclude CANCELLED orders from active/live lists
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

  if (ordersList.length === 0) {
    return { orders: [], total };
  }

  // Batch fetch items, tables, and staff to avoid N+1 queries
  const orderIds = ordersList.map((o) => o.id);
  const tableIds = Array.from(new Set(ordersList.map((o) => o.tableId).filter(Boolean)));
  const staffIds = Array.from(new Set(ordersList.map((o) => o.placedByStaffId).filter(Boolean)));

  const [itemsRows, tableRows, staffRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
    tableIds.length
      ? db
          .select({ id: tables.id, tableNumber: tables.tableNumber, floorSection: tables.floorSection })
          .from(tables)
          .where(inArray(tables.id, tableIds))
      : Promise.resolve([]),
    staffIds.length
      ? (async () => {
          const { staff } = await import("../../shared/schema.js");
          return db
            .select({ id: staff.id, fullName: staff.fullName, role: staff.role })
            .from(staff)
            .where(inArray(staff.id, staffIds));
        })()
      : Promise.resolve([]),
  ]);

  const itemsByOrderId = new Map();
  for (const item of itemsRows) {
    const parsed = { ...item, selectedModifiers: item.selectedModifiers || [] };
    const arr = itemsByOrderId.get(item.orderId);
    if (arr) arr.push(parsed);
    else itemsByOrderId.set(item.orderId, [parsed]);
  }

  const tableMap = new Map(tableRows.map((t) => [t.id, t]));
  const staffMap = new Map(staffRows.map((s) => [s.id, s]));

  const ordersWithDetails = ordersList.map((order) => {
    const tableInfo = order.tableId ? tableMap.get(order.tableId) || null : null;
    const staffInfo = order.placedByStaffId ? staffMap.get(order.placedByStaffId) || null : null;

    return {
      ...order,
      paid_amount: order.paid_amount || order.paid_amount || "0",
      items: itemsByOrderId.get(order.id) || [],
      table: tableInfo,
      placedByStaff: staffInfo,
    };
  });

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
  const existing = await getOrder(restaurantId, orderId);
  if (!existing) return null;

  const updateData = { ...data };

  // If discountAmount is provided, recalculate totals + payment status based on existing subtotal/taxes.
  if (data.discountAmount !== undefined) {
    let discount = Number(data.discountAmount);
    if (!Number.isFinite(discount)) discount = 0;
    discount = Math.max(0, discount);

    const subtotal = parseFloat(existing.subtotalAmount || "0");
    const gst = parseFloat(existing.gstAmount || "0");
    const service = parseFloat(existing.serviceTaxAmount || "0");

    const totalBeforeDiscount = subtotal + gst + service;
    discount = Math.min(discount, totalBeforeDiscount);

    const newTotal = Math.max(0, totalBeforeDiscount - discount);

    updateData.discountAmount = discount.toFixed(2);
    updateData.totalAmount = newTotal.toFixed(2);

    // Re-evaluate payment status in case discount changes outstanding amount.
    let paidAmount = parseFloat(existing.paid_amount || "0");
    let paymentStatus = existing.paymentStatus;

    if (paidAmount >= newTotal - 0.01) {
      paymentStatus = "PAID";
      paidAmount = newTotal;
    } else if (paidAmount > 0) {
      paymentStatus = "PARTIALLY_PAID";
    } else {
      paymentStatus = "DUE";
    }

    updateData.paymentStatus = paymentStatus;
    updateData.paid_amount = paidAmount.toFixed(2);

    // If a transaction already exists, keep it in sync.
    const existingTransactionRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, orderId))
      .limit(1);
    const existingTransaction = existingTransactionRows[0];
    if (existingTransaction) {
      await db
        .update(transactions)
        .set({
          subtotal: subtotal.toFixed(2),
          gstAmount: gst.toFixed(2),
          serviceTaxAmount: service.toFixed(2),
          discountAmount: discount.toFixed(2),
          grandTotal: newTotal.toFixed(2),
        })
        .where(eq(transactions.id, existingTransaction.id));
    }
  }

  const rows = await db
    .update(orders)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
    .returning();

  const updated = rows[0] || null;
  if (updated) {
    emitOrderUpdated(restaurantId, updated);
  }
  return updated;
}

/**
 * Remove service charge (serviceTaxAmount) from an order and recompute totals.
 *
 * This is used by the bill preview to let staff waive service charges for a specific order.
 */
export async function removeServiceChargeFromOrder(restaurantId, orderId) {
  const existing = await getOrder(restaurantId, orderId);
  if (!existing) {
    throw new Error("Order not found");
  }

  if (existing.orderType !== "DINE_IN") {
    throw new Error("Service charge can only be removed for dine-in orders");
  }

  const subtotal = parseFloat(existing.subtotalAmount || "0");
  const gst = parseFloat(existing.gstAmount || "0");

  // Keep existing discount amount, but clamp it to the new total before discount.
  let discount = parseFloat(existing.discountAmount || "0");
  if (!Number.isFinite(discount)) discount = 0;
  discount = Math.max(0, discount);

  const service = 0;
  const totalBeforeDiscount = subtotal + gst + service;
  discount = Math.min(discount, totalBeforeDiscount);

  const newTotal = Math.max(0, totalBeforeDiscount - discount);

  // Re-evaluate payment status to keep outstanding amount correct.
  let paidAmount = parseFloat(existing.paid_amount || "0");
  let paymentStatus = existing.paymentStatus;

  if (paidAmount >= newTotal - 0.01) {
    paymentStatus = "PAID";
    paidAmount = newTotal;
  } else if (paidAmount > 0) {
    paymentStatus = "PARTIALLY_PAID";
  } else {
    paymentStatus = "DUE";
  }

  // Update order
  const rows = await db
    .update(orders)
    .set({
      serviceTaxAmount: service.toFixed(2),
      discountAmount: discount.toFixed(2),
      totalAmount: newTotal.toFixed(2),
      paymentStatus,
      paid_amount: paidAmount.toFixed(2),
      updatedAt: new Date(),
    })
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
    .returning();

  const updated = rows[0] || null;
  if (!updated) return null;

  // Sync any existing transaction (if order was already paid / has transaction).
  const existingTransactionRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.orderId, orderId))
    .limit(1);
  const existingTransaction = existingTransactionRows[0];

  if (existingTransaction) {
    await db
      .update(transactions)
      .set({
        subtotal: subtotal.toFixed(2),
        gstAmount: gst.toFixed(2),
        serviceTaxAmount: service.toFixed(2),
        discountAmount: discount.toFixed(2),
        grandTotal: newTotal.toFixed(2),
      })
      .where(eq(transactions.id, existingTransaction.id));
  }

  emitOrderUpdated(restaurantId, updated);

  // Return enriched order for immediate UI refresh.
  return getOrder(restaurantId, orderId);
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

  if (activeOrders.length === 0) return [];

  const orderIds = activeOrders.map((o) => o.id);
  const tableIds = Array.from(new Set(activeOrders.map((o) => o.tableId).filter(Boolean)));
  const staffIds = Array.from(new Set(activeOrders.map((o) => o.placedByStaffId).filter(Boolean)));

  const [itemsRows, tableRows, staffRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
    tableIds.length
      ? db
          .select({ id: tables.id, tableNumber: tables.tableNumber, floorSection: tables.floorSection })
          .from(tables)
          .where(inArray(tables.id, tableIds))
      : Promise.resolve([]),
    staffIds.length
      ? (async () => {
          const { staff } = await import("../../shared/schema.js");
          return db
            .select({ id: staff.id, fullName: staff.fullName, role: staff.role })
            .from(staff)
            .where(inArray(staff.id, staffIds));
        })()
      : Promise.resolve([]),
  ]);

  const itemsByOrderId = new Map();
  for (const item of itemsRows) {
    const parsed = { ...item, selectedModifiers: item.selectedModifiers || [] };
    const arr = itemsByOrderId.get(item.orderId);
    if (arr) arr.push(parsed);
    else itemsByOrderId.set(item.orderId, [parsed]);
  }

  const tableMap = new Map(tableRows.map((t) => [t.id, t]));
  const staffMap = new Map(staffRows.map((s) => [s.id, s]));

  return activeOrders.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) || [],
    table: order.tableId ? tableMap.get(order.tableId) || null : null,
    placedByStaff: order.placedByStaffId ? staffMap.get(order.placedByStaffId) || null : null,
  }));
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

  // Preserve per-order waiver: if service charge is currently 0 despite positive subtotal and non-zero service rate,
  // treat it as waived and keep it at 0 when adding items.
  const currentSubtotal = parseFloat(order.subtotalAmount || "0");
  const currentService = parseFloat(order.serviceTaxAmount || "0");
  const wasServiceChargeWaived =
    order.orderType === "DINE_IN" && serviceRate > 0 && currentSubtotal > 0 && currentService === 0;

  // Service charge applies ONLY for dine-in orders.
  const newService =
    order.orderType === "DINE_IN" && !wasServiceChargeWaived
      ? newSubtotal * serviceRate
      : 0;

  // Apply existing discountAmount on the order (discount reduces the grand total, after taxes).
  let discount = parseFloat(order.discountAmount || "0");
  if (!Number.isFinite(discount)) discount = 0;
  discount = Math.max(0, discount);

  const totalBeforeDiscount = newSubtotal + newGst + newService;
  discount = Math.min(discount, totalBeforeDiscount);

  const newTotal = Math.max(0, totalBeforeDiscount - discount);

  // ✅ CRITICAL: Calculate taxes on ONLY the new items
  const additionalService =
    order.orderType === "DINE_IN" && !wasServiceChargeWaived ? additionalTotal * serviceRate : 0;
  const additionalTotalWithTax = additionalTotal + (additionalTotal * gstRate) + additionalService;

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
      discountAmount: discount.toFixed(2),
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
          discountAmount: discount.toFixed(2),
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

  // Preserve per-order waiver: if service charge is currently 0 despite positive subtotal and non-zero service rate,
  // treat it as waived and keep it at 0 when adding items.
  const currentSubtotal = parseFloat(order.subtotalAmount || "0");
  const currentService = parseFloat(order.serviceTaxAmount || "0");
  const wasServiceChargeWaived =
    order.orderType === "DINE_IN" && serviceRate > 0 && currentSubtotal > 0 && currentService === 0;

  // Service charge applies ONLY for dine-in orders.
  const newService =
    order.orderType === "DINE_IN" && !wasServiceChargeWaived
      ? newSubtotal * serviceRate
      : 0;

  // Preserve and apply existing discount.
  let discount = parseFloat(order.discountAmount || "0");
  if (!Number.isFinite(discount)) discount = 0;
  discount = Math.max(0, discount);

  const totalBeforeDiscount = newSubtotal + newGst + newService;
  discount = Math.min(discount, totalBeforeDiscount);
  const newTotal = Math.max(0, totalBeforeDiscount - discount);

  // Update order totals
  await db
    .update(orders)
    .set({
      subtotalAmount: newSubtotal.toFixed(2),
      gstAmount: newGst.toFixed(2),
      serviceTaxAmount: newService.toFixed(2),
      discountAmount: discount.toFixed(2),
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