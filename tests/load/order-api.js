import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics for scalable architecture monitoring
const orderCreationRate = new Rate("order_creation_success");
const orderStatusUpdateRate = new Rate("order_status_update_success");
const apiResponseTime = new Trend("api_response_time");
const p95ResponseTime = new Trend("p95_response_time");

/**
 * Load Test Configuration
 * 
 * Scalable Architecture Targets:
 * - API Response Time: <200ms (P95)
 * - Throughput: 50,000-100,000 RPS (peak)
 * - Error Rate: <0.1%
 */
export const options = {
  stages: [
    // Ramp-up phase (simulate gradual load increase)
    { duration: "2m", target: 100 }, // Ramp to 100 concurrent users
    { duration: "5m", target: 500 }, // Ramp to 500 concurrent users
    { duration: "5m", target: 1000 }, // Ramp to 1000 concurrent users (peak)
    { duration: "5m", target: 1000 }, // Stay at peak for 5 minutes
    { duration: "2m", target: 500 }, // Ramp down to 500
    { duration: "2m", target: 100 }, // Ramp down to 100
    { duration: "1m", target: 0 }, // Ramp down to 0
  ],
  thresholds: {
    // Scalable architecture performance targets
    http_req_duration: ["p(95)<200", "p(99)<500"], // P95 < 200ms, P99 < 500ms
    http_req_failed: ["rate<0.001"], // Error rate < 0.1%
    order_creation_success: ["rate>0.99"], // 99% success rate
    order_status_update_success: ["rate>0.99"], // 99% success rate
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const JWT_TOKEN = __ENV.JWT_TOKEN || "test-token";
const RESTAURANT_ID = __ENV.RESTAURANT_ID || "test-restaurant-id";
const MENU_ITEM_ID = __ENV.MENU_ITEM_ID || "test-menu-item-id";

/**
 * Test data generator
 */
function generateOrderData() {
  return {
    items: [
      {
        menuItemId: MENU_ITEM_ID,
        quantity: Math.floor(Math.random() * 5) + 1,
      },
    ],
    orderType: ["DINE_IN", "TAKEAWAY", "DELIVERY"][Math.floor(Math.random() * 3)],
    guestName: `Guest ${Math.random().toString(36).substring(7)}`,
  };
}

/**
 * Create order load test
 */
export function createOrderTest() {
  const orderData = generateOrderData();
  const url = `${BASE_URL}/api/restaurants/${RESTAURANT_ID}/orders`;
  const params = {
    headers: {
      Authorization: `Bearer ${JWT_TOKEN}`,
      "Content-Type": "application/json",
    },
    tags: { name: "CreateOrder" },
  };

  const res = http.post(url, JSON.stringify(orderData), params);
  const responseTime = res.timings.duration;

  const success = check(res, {
    "order creation status is 201": (r) => r.status === 201,
    "order creation response time < 200ms": () => responseTime < 200,
    "order has ID": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.order && body.order.id;
      } catch {
        return false;
      }
    },
  });

  orderCreationRate.add(success);
  apiResponseTime.add(responseTime);

  if (responseTime > 0) {
    p95ResponseTime.add(responseTime);
  }

  return res;
}

/**
 * Update order status load test
 */
export function updateOrderStatusTest(orderId) {
  const statuses = ["PENDING", "PREPARING", "SERVED", "PAID"];
  const status = statuses[Math.floor(Math.random() * statuses.length)];

  const url = `${BASE_URL}/api/restaurants/${RESTAURANT_ID}/orders/${orderId}/status`;
  const params = {
    headers: {
      Authorization: `Bearer ${JWT_TOKEN}`,
      "Content-Type": "application/json",
    },
    tags: { name: "UpdateOrderStatus" },
  };

  const res = http.patch(url, JSON.stringify({ status }), params);
  const responseTime = res.timings.duration;

  const success = check(res, {
    "status update is 200": (r) => r.status === 200,
    "status update response time < 200ms": () => responseTime < 200,
  });

  orderStatusUpdateRate.add(success);
  apiResponseTime.add(responseTime);

  return res;
}

/**
 * List orders load test
 */
export function listOrdersTest() {
  const url = `${BASE_URL}/api/restaurants/${RESTAURANT_ID}/orders`;
  const params = {
    headers: {
      Authorization: `Bearer ${JWT_TOKEN}`,
    },
    tags: { name: "ListOrders" },
  };

  const res = http.get(url, params);
  const responseTime = res.timings.duration;

  check(res, {
    "list orders status is 200": (r) => r.status === 200,
    "list orders response time < 200ms": () => responseTime < 200,
    "orders array exists": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.orders);
      } catch {
        return false;
      }
    },
  });

  apiResponseTime.add(responseTime);
  return res;
}

/**
 * Get kitchen active orders load test
 */
export function getKitchenOrdersTest() {
  const url = `${BASE_URL}/api/restaurants/${RESTAURANT_ID}/orders/kitchen/active`;
  const params = {
    headers: {
      Authorization: `Bearer ${JWT_TOKEN}`,
    },
    tags: { name: "GetKitchenOrders" },
  };

  const res = http.get(url, params);
  const responseTime = res.timings.duration;

  check(res, {
    "kitchen orders status is 200": (r) => r.status === 200,
    "kitchen orders response time < 200ms": () => responseTime < 200,
  });

  apiResponseTime.add(responseTime);
  return res;
}

/**
 * Main test function
 */
export default function () {
  // Create order (most common operation)
  const createRes = createOrderTest();
  let orderId = null;

  if (createRes.status === 201) {
    try {
      const body = JSON.parse(createRes.body);
      orderId = body.order?.id;
    } catch {
      // Ignore parse errors
    }
  }

  sleep(0.5); // Simulate user think time

  // List orders
  listOrdersTest();

  sleep(0.3);

  // Get kitchen orders
  getKitchenOrdersTest();

  // Update order status if order was created
  if (orderId) {
    sleep(0.2);
    updateOrderStatusTest(orderId);
  }

  sleep(1); // Simulate user think time between operations
}

/**
 * Setup function (runs once before all VUs)
 */
export function setup() {
  // Verify API is accessible
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`API health check failed: ${healthCheck.status}`);
  }

  return {
    baseUrl: BASE_URL,
    restaurantId: RESTAURANT_ID,
  };
}

/**
 * Teardown function (runs once after all VUs)
 */
export function teardown(data) {
  console.log(`Load test completed for ${data.baseUrl}`);
}
