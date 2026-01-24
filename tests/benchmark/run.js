import { performance } from "perf_hooks";
import { createTestPool, cleanDatabase, closePool } from "../utils/db.js";
import { createOrder, updateOrderStatus, listOrders } from "../../src/order/service.js";
import { registerInQueue, callNextGuest } from "../../src/queue/service.js";
import { fixtures } from "../utils/fixtures.js";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  restaurants,
  menuItems,
  menuCategories,
  orders,
  tables,
} from "../../shared/schema.js";

/**
 * Performance Benchmark Suite
 * 
 * Tests performance against scalable architecture targets:
 * - API Response Time: <200ms (P95)
 * - Database Queries: <50ms (P95)
 * - Order Creation: <100ms (P50)
 * - Queue Operations: <50ms (P50)
 */

const ITERATIONS = 100;
const WARMUP_ITERATIONS = 10;

class Benchmark {
  constructor(name) {
    this.name = name;
    this.times = [];
    this.errors = 0;
  }

  async run(fn) {
    const start = performance.now();
    try {
      await fn();
      const duration = performance.now() - start;
      this.times.push(duration);
      return duration;
    } catch (error) {
      this.errors++;
      console.error(`Error in ${this.name}:`, error.message);
      return null;
    }
  }

  getStats() {
    if (this.times.length === 0) {
      return { error: "No successful runs" };
    }

    const sorted = [...this.times].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      name: this.name,
      count: this.times.length,
      errors: this.errors,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }
}

async function benchmarkOrderCreation(db, restaurantId, menuItemId, iterations) {
  const benchmark = new Benchmark("Order Creation");

  for (let i = 0; i < iterations; i++) {
    await benchmark.run(async () => {
      await createOrder(restaurantId, {
        items: [{ menuItemId, quantity: Math.floor(Math.random() * 5) + 1 }],
      });
    });
  }

  return benchmark.getStats();
}

async function benchmarkOrderStatusUpdate(db, restaurantId, orderIds, iterations) {
  const benchmark = new Benchmark("Order Status Update");

  const statuses = ["PREPARING", "SERVED", "PAID"];
  let statusIndex = 0;

  for (let i = 0; i < iterations; i++) {
    const orderId = orderIds[i % orderIds.length];
    const status = statuses[statusIndex % statuses.length];
    statusIndex++;

    await benchmark.run(async () => {
      await updateOrderStatus(restaurantId, orderId, status);
    });
  }

  return benchmark.getStats();
}

async function benchmarkListOrders(db, restaurantId, iterations) {
  const benchmark = new Benchmark("List Orders");

  for (let i = 0; i < iterations; i++) {
    await benchmark.run(async () => {
      await listOrders(restaurantId, { limit: 50, offset: 0 });
    });
  }

  return benchmark.getStats();
}

async function benchmarkQueueRegistration(db, restaurantId, iterations) {
  const benchmark = new Benchmark("Queue Registration");

  for (let i = 0; i < iterations; i++) {
    await benchmark.run(async () => {
      await registerInQueue(restaurantId, {
        guestName: `Guest ${i}`,
        partySize: Math.floor(Math.random() * 8) + 1,
        phoneNumber: `+1${Math.floor(Math.random() * 10000000000)}`,
      });
    });
  }

  return benchmark.getStats();
}

async function benchmarkCallNextGuest(db, restaurantId, iterations) {
  const benchmark = new Benchmark("Call Next Guest");

  // Ensure we have queue entries
  for (let i = 0; i < iterations; i++) {
    await registerInQueue(restaurantId, {
      guestName: `Guest ${i}`,
      partySize: 2,
    });
  }

  for (let i = 0; i < iterations; i++) {
    await benchmark.run(async () => {
      await callNextGuest(restaurantId);
    });
  }

  return benchmark.getStats();
}

function printStats(stats) {
  console.log(`\n📊 ${stats.name}`);
  console.log("─".repeat(50));
  console.log(`  Count:        ${stats.count}`);
  console.log(`  Errors:       ${stats.errors}`);
  console.log(`  Min:          ${stats.min.toFixed(2)}ms`);
  console.log(`  Max:          ${stats.max.toFixed(2)}ms`);
  console.log(`  Mean:         ${stats.mean.toFixed(2)}ms`);
  console.log(`  Median (P50): ${stats.median.toFixed(2)}ms`);
  console.log(`  P95:          ${stats.p95.toFixed(2)}ms`);
  console.log(`  P99:          ${stats.p99.toFixed(2)}ms`);

  // Check against targets
  const targets = {
    "Order Creation": { p95: 200, p50: 100 },
    "Order Status Update": { p95: 200, p50: 100 },
    "List Orders": { p95: 200, p50: 100 },
    "Queue Registration": { p95: 200, p50: 50 },
    "Call Next Guest": { p95: 200, p50: 50 },
  };

  const target = targets[stats.name];
  if (target) {
    const p95Pass = stats.p95 < target.p95;
    const p50Pass = stats.median < target.p50;
    console.log(`\n  Targets:`);
    console.log(`    P95 < ${target.p95}ms: ${p95Pass ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`    P50 < ${target.p50}ms: ${p50Pass ? "✅ PASS" : "❌ FAIL"}`);
  }
}

async function main() {
  console.log("🚀 Starting Performance Benchmark Suite\n");
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Warmup iterations: ${WARMUP_ITERATIONS}\n`);

  const pool = createTestPool();
  const db = drizzle(pool);

  try {
    await cleanDatabase(pool);

    // Setup test data
    console.log("📦 Setting up test data...");
    const restaurant = fixtures.restaurant();
    const restaurantId = restaurant.id;
    await db.insert(restaurants).values(restaurant);

    const category = fixtures.menuCategory(restaurantId);
    await db.insert(menuCategories).values(category);

    const menuItem = fixtures.menuItem(restaurantId, category.id, { price: "10.00" });
    await db.insert(menuItems).values(menuItem);

    // Warmup
    console.log("🔥 Warming up...");
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      await createOrder(restaurantId, {
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      });
    }
    await cleanDatabase(pool);

    // Re-insert base data (cleanDatabase removes restaurant, category, menuItem)
    await db.insert(restaurants).values(restaurant);
    await db.insert(menuCategories).values(category);
    await db.insert(menuItems).values(menuItem);

    // Create test orders for status update benchmark
    const orderIds = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const order = await createOrder(restaurantId, {
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      });
      orderIds.push(order.id);
    }

    // Run benchmarks
    console.log("\n🏃 Running benchmarks...\n");

    const results = [];

    results.push(await benchmarkOrderCreation(db, restaurantId, menuItem.id, ITERATIONS));
    results.push(await benchmarkOrderStatusUpdate(db, restaurantId, orderIds, ITERATIONS));
    results.push(await benchmarkListOrders(db, restaurantId, ITERATIONS));
    results.push(await benchmarkQueueRegistration(db, restaurantId, ITERATIONS));
    results.push(await benchmarkCallNextGuest(db, restaurantId, ITERATIONS));

    // Print results
    console.log("\n" + "=".repeat(60));
    console.log("📈 BENCHMARK RESULTS");
    console.log("=".repeat(60));

    results.forEach(printStats);

    console.log("\n" + "=".repeat(60));
    console.log("✅ Benchmark suite completed");
    console.log("=".repeat(60) + "\n");

  } catch (error) {
    console.error("❌ Benchmark failed:", error);
    process.exit(1);
  } finally {
    await closePool(pool);
  }
}

main();
