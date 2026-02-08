import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { 
  orders, 
  orderItems, 
  menuItems, 
  tables, 
  restaurants,
  menuItemVariants,
  modifiers,
  modifierGroups
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
 * Create a new order with items (with customization support)
 * @param {string} restaurantId - Restaurant ID
 * @param {object} data - Order data
 * @param {string|null} placedByStaffId - Staff ID who placed the order
 * @returns {Promise<object>} Created order with items
 */
export async function createOrder(restaurantId, data, placedByStaffId = null) {
  const {
    tableId,
    guestName,
    guestPhone,
    orderType = "DINE_IN",
    items = [],
    notes,
  } = data;

  // If this is a DINE_IN order for a specific table, reuse the existing
  // active order (one running bill per table) instead of creating a new one.
  if (tableId && orderType === "DINE_IN") {
    const existingRows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          eq(orders.orderType, "DINE_IN"),
          sql`${orders.status} IN ('PENDING', 'PREPARING', 'READY', 'SERVED')`,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);

    const existing = existingRows[0];
    if (existing) {
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

      const { order: updatedOrder } = await addOrderItems(restaurantId, existing.id, items);
      // Keep API shape: return the order object (with items) like a "create"
      return updatedOrder;
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
  
  // Create order
  const orderRows = await db
    .insert(orders)
    .values({
      restaurantId,
      tableId: tableId || null,
      guestName: guestName || null,
      guestPhone: guestPhone || null,
      placedByStaffId: placedByStaffId || null,
      status: "PENDING",
      orderType,
      subtotalAmount: subtotal.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      serviceTaxAmount: serviceTaxAmount.toFixed(2),
      discountAmount: "0",
      totalAmount: totalAmount.toFixed(2),
      notes: notes || null,
    })
    .returning();

  const order = orderRows[0];
  console.log(order);

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

  // Exclude PAID orders by default unless explicitly requested
  if (excludePaid) {
    conditions.push(sql`${orders.status} != 'PAID'`);
  }

  if (status) {
    conditions.push(eq(orders.status, status));
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
        sql`${orders.status} IN ('PENDING', 'PREPARING', 'READY')`
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
    sql`${orders.status} IN (${sql.join(status.map(s => sql`${s}`), sql`, `)})`,
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
 * @param {string} restaurantId - Restaurant ID
 * @param {string} orderId - Order ID
 * @param {Array} items - Items to add (may include variantId and modifierIds)
 * @returns {Promise<object>} Updated order with new items
 */
export async function addOrderItems(restaurantId, orderId, items) {
  // Verify order exists and belongs to restaurant
  const order = await getOrder(restaurantId, orderId);
  if (!order) {
    throw new Error("Order not found");
  }

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
    // If order was SERVED or READY and we're adding items, change status back to PENDING
    // so kitchen sees it as a new order (but it's still the same order ID for billing)
    if (order.status === "SERVED" || order.status === "READY") {
      await db
        .update(orders)
        .set({
          status: "PENDING",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
      
      const refreshedOrder = await getOrder(restaurantId, orderId);
      if (refreshedOrder) {
        emitOrderStatusChanged(restaurantId, refreshedOrder);
        emitOrderItemsAdded(restaurantId, orderId, newItems, refreshedOrder);
        return {
          order: refreshedOrder,
          newItems,
        };
      }
    }
    
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