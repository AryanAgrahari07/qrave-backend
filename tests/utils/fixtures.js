import { v4 as uuidv4 } from "uuid";

/**
 * Create test fixtures for common entities
 */
export const fixtures = {
  /**
   * Create a test restaurant object
   */
  restaurant: (overrides = {}) => ({
    id: uuidv4(),
    name: "Test Restaurant",
    slug: `test-restaurant-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    type: "Restaurant",
    taxRateGst: "5.00",
    taxRateService: "10.00",
    currency: "$",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a test user object
   */
  user: (overrides = {}) => ({
    id: uuidv4(),
    email: "test@example.com",
    password: "hashedpassword",
    fullName: "Test User",
    createdAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a test table object
   */
  table: (restaurantId, overrides = {}) => ({
    id: uuidv4(),
    restaurantId,
    tableNumber: "1",
    capacity: 4,
    currentStatus: "AVAILABLE",
    qrCodePayload: `https://example.com/r/test-restaurant/table/1`,
    qrCodeVersion: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a test menu category object
   */
  menuCategory: (restaurantId, overrides = {}) => ({
    id: uuidv4(),
    restaurantId,
    name: "Appetizers",
    displayOrder: 1,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a test menu item object
   */
  menuItem: (restaurantId, categoryId, overrides = {}) => ({
    id: uuidv4(),
    restaurantId,
    categoryId,
    name: "Test Item",
    description: "Test description",
    price: "10.00",
    available: true,
    displayOrder: 1,
    createdAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a test order object
   */
  order: (restaurantId, overrides = {}) => ({
    id: uuidv4(),
    restaurantId,
    tableId: null,
    status: "PENDING",
    orderType: "DINE_IN",
    subtotalAmount: "100.00",
    gstAmount: "5.00",
    serviceTaxAmount: "10.00",
    discountAmount: "0.00",
    totalAmount: "115.00",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a test order item object
   */
  orderItem: (orderId, menuItemId, overrides = {}) => ({
    id: uuidv4(),
    orderId,
    menuItemId,
    itemName: "Test Item",
    unitPrice: "10.00",
    quantity: 1,
    totalPrice: "10.00",
    createdAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a test queue entry object
   */
  queueEntry: (restaurantId, overrides = {}) => ({
    id: uuidv4(),
    restaurantId,
    guestName: "Test Guest",
    partySize: 2,
    phoneNumber: "+1234567890",
    status: "WAITING",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),
};
