# Testing Infrastructure

Comprehensive testing suite aligned with scalable architecture requirements for Qrave backend.

## 📋 Overview

This testing infrastructure includes:
- **Unit Tests**: Service-level tests with Jest
- **Integration Tests**: API endpoint tests with Supertest
- **Load Tests**: k6 scripts for performance testing
- **Performance Benchmarks**: Node.js benchmarking suite

## 🎯 Architecture Alignment

Tests are designed to verify scalable architecture targets:
- **API Response Time**: <200ms (P95)
- **Database Queries**: <50ms (P95)
- **Error Rate**: <0.1%
- **Throughput**: 50,000-100,000 RPS (peak)

## 🚀 Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Install k6 (for load testing)
# macOS: brew install k6
# Linux: https://k6.io/docs/getting-started/installation/
# Windows: https://k6.io/docs/getting-started/installation/
```

### Environment Setup

Create a test database:

```bash
# PostgreSQL
createdb qrave_test

# Set test database URL
export TEST_DATABASE_URL=postgresql://user:password@localhost:5432/qrave_test
```

### Run Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## 📁 Test Structure

```
tests/
├── setup.js                 # Jest configuration and setup
├── utils/
│   ├── db.js               # Database utilities (clean, setup)
│   ├── auth.js             # Auth helpers (tokens, headers)
│   └── fixtures.js         # Test data fixtures
├── unit/                   # Unit tests (service layer)
│   ├── order.service.test.js
│   └── queue.service.test.js
├── integration/            # Integration tests (API layer)
│   └── order.api.test.js
├── load/                   # k6 load tests
│   ├── order-api.js
│   └── queue-api.js
└── benchmark/              # Performance benchmarks
    └── run.js
```

## 🧪 Unit Tests

Unit tests focus on service-level business logic:

```bash
npm run test:unit
```

**Coverage:**
- Order service (creation, updates, status changes)
- Queue service (registration, status updates, wait time estimation)
- Tax calculations
- Business logic validation

## 🔗 Integration Tests

Integration tests verify API endpoints end-to-end:

```bash
npm run test:integration
```

**Coverage:**
- REST API endpoints
- Authentication & authorization
- Request/response validation
- Error handling
- Status codes

## 📊 Load Testing (k6)

Load tests simulate high-traffic scenarios:

```bash
# Order API load test
npm run test:load

# Or run directly with k6
k6 run tests/load/order-api.js \
  --env BASE_URL=http://localhost:5000 \
  --env JWT_TOKEN=your-token \
  --env RESTAURANT_ID=your-restaurant-id
```

**Load Test Scenarios:**
- Ramp-up: 0 → 1000 concurrent users
- Peak load: 1000 concurrent users for 5 minutes
- Ramp-down: Gradual decrease

**Metrics Tracked:**
- Response times (P50, P95, P99)
- Error rates
- Throughput (requests/second)
- Custom metrics (order creation success rate, etc.)

## ⚡ Performance Benchmarks

Performance benchmarks measure operation latency:

```bash
npm run test:benchmark
```

**Benchmarks:**
- Order creation
- Order status updates
- List orders (pagination)
- Queue registration
- Call next guest

**Targets:**
- Order operations: P95 < 200ms, P50 < 100ms
- Queue operations: P95 < 200ms, P50 < 50ms

## 📈 Test Coverage

Generate coverage report:

```bash
npm run test:coverage
```

Coverage reports are generated in `coverage/` directory:
- HTML report: `coverage/index.html`
- LCOV report: `coverage/lcov.info`

## 🔧 Test Utilities

### Database Utilities (`tests/utils/db.js`)

```javascript
import { createTestPool, cleanDatabase, closePool } from "./utils/db.js";

const pool = createTestPool();
await cleanDatabase(pool); // Clean before each test
// ... run tests
await closePool(pool);
```

### Auth Utilities (`tests/utils/auth.js`)

```javascript
import { generateTestToken, getAuthHeaders } from "./utils/auth.js";

const token = generateTestToken({ restaurantId, role: "owner" });
const headers = getAuthHeaders(token);
```

### Fixtures (`tests/utils/fixtures.js`)

```javascript
import { fixtures } from "./utils/fixtures.js";

const restaurant = fixtures.restaurant();
const order = fixtures.order(restaurantId);
const queueEntry = fixtures.queueEntry(restaurantId);
```

## 🎯 Scalable Architecture Targets

### Performance Targets

| Metric | Target | Test |
|--------|--------|------|
| API Response Time (P95) | <200ms | Load tests |
| API Response Time (P99) | <500ms | Load tests |
| Database Query (P95) | <50ms | Benchmarks |
| Error Rate | <0.1% | Load tests |
| Order Creation (P50) | <100ms | Benchmarks |
| Queue Registration (P50) | <50ms | Benchmarks |

### Scalability Targets

- **Concurrent Users**: 1000+ (load tests)
- **Throughput**: 50,000-100,000 RPS (peak)
- **Database Connections**: Connection pooling tested
- **Multi-tenant Isolation**: Verified in integration tests

## 🐛 Debugging Tests

### Run Single Test File

```bash
npm test -- tests/unit/order.service.test.js
```

### Run Tests Matching Pattern

```bash
npm test -- -t "createOrder"
```

### Verbose Output

```bash
npm test -- --verbose
```

### Debug Mode

```bash
node --inspect-brk --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand
```

## 📝 Writing New Tests

### Unit Test Example

```javascript
import { describe, it, expect, beforeEach } from "@jest/globals";
import { createOrder } from "../../src/order/service.js";

describe("Order Service", () => {
  beforeEach(async () => {
    // Setup test data
  });

  it("should create order with correct totals", async () => {
    const order = await createOrder(restaurantId, orderData);
    expect(order.totalAmount).toBe("115.00");
  });
});
```

### Integration Test Example

```javascript
import request from "supertest";
import { app } from "../../src/index.js";

describe("Order API", () => {
  it("should create order via API", async () => {
    const response = await request(app)
      .post(`/api/restaurants/${restaurantId}/orders`)
      .set(getAuthHeaders(token))
      .send(orderData);

    expect(response.status).toBe(201);
  });
});
```

## 🔍 CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: qrave_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/qrave_test
```

## 📚 Additional Resources

- [Jest Documentation](https://jestjs.io/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [k6 Documentation](https://k6.io/docs/)
- [Scalable Architecture Roadmap](../SCALABLE_ARCHITECTURE_ROADMAP.md)

## ✅ Test Checklist

- [x] Unit tests for order service
- [x] Unit tests for queue service
- [x] Integration tests for order API
- [x] Load tests with k6
- [x] Performance benchmarks
- [x] Test utilities and fixtures
- [x] Coverage reporting
- [ ] Integration tests for queue API (TODO)
- [ ] Integration tests for WebSocket (TODO)
- [ ] E2E tests (TODO)

---

**Last Updated:** 2024  
**Status:** ✅ Testing Infrastructure Complete
