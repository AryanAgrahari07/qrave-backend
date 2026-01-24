# Test Troubleshooting Guide

## Common Issues and Solutions

### 1. "password authentication failed for user 'postgres'"

**Problem:** Test database connection is not configured correctly.

**Solution:**
```powershell
# Set your test database URL
$env:TEST_DATABASE_URL="postgresql://username:password@localhost:5432/qrave_test"

# Or create a .env.test file with:
# TEST_DATABASE_URL=postgresql://username:password@localhost:5432/qrave_test
```

**Verify connection:**
```powershell
# Test PostgreSQL connection
psql -U username -d qrave_test -c "SELECT 1;"
```

---

### 2. "deadlock detected"

**Problem:** Multiple tests running concurrently are trying to modify the same database tables.

**Solution:** Tests are now configured to run sequentially (`maxWorkers: 1`, `runInBand: true`). If you still see deadlocks:

1. **Check for open connections:**
```sql
SELECT * FROM pg_stat_activity WHERE datname = 'qrave_test';
```

2. **Kill hanging connections:**
```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'qrave_test' AND pid <> pg_backend_pid();
```

3. **Ensure database is clean before running tests:**
```powershell
# Drop and recreate test database
dropdb qrave_test
createdb qrave_test
npm run db:push
```

---

### 3. "violates foreign key constraint"

**Problem:** Tests are inserting data in the wrong order (e.g., menu items before restaurant exists).

**Solution:** The test fixtures now ensure correct insertion order:
1. Restaurant (no dependencies)
2. Menu Category (depends on Restaurant)
3. Menu Items (depends on Restaurant + Category)
4. Tables (depends on Restaurant)
5. Orders (depends on Restaurant + Table)

**If you see FK violations:**
- Check that `beforeEach` creates data in the correct order
- Ensure `cleanDatabase()` runs before each test
- Verify foreign key relationships in schema

---

### 4. "relation does not exist"

**Problem:** Database tables haven't been created.

**Solution:**
```powershell
# Run migrations
npm run db:push

# Or manually create schema
psql -U username -d qrave_test -f schema.sql
```

---

### 5. Tests timing out

**Problem:** Database operations are taking too long.

**Solutions:**
- Increase timeout in `jest.config.js`: `testTimeout: 60000`
- Check database performance
- Ensure indexes exist on foreign keys
- Use connection pooling (already configured)

---

### 6. "A worker process has failed to exit gracefully"

**Problem:** Database connections or timers not being cleaned up.

**Solutions:**
- Ensure `afterAll` closes database pools: `await closePool(pool)`
- Check for unclosed connections in test code
- Run with `--detectOpenHandles` to find leaks:
```powershell
npm test -- --detectOpenHandles
```

---

## Test Database Setup Checklist

- [ ] PostgreSQL is installed and running
- [ ] Test database `qrave_test` exists
- [ ] `TEST_DATABASE_URL` environment variable is set
- [ ] Database migrations have been run (`npm run db:push`)
- [ ] Database user has proper permissions
- [ ] No other processes are using the test database

## Quick Fix Commands

```powershell
# 1. Create test database
createdb qrave_test

# 2. Set environment variable
$env:TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/qrave_test"

# 3. Run migrations
npm run db:push

# 4. Run tests
npm test

# 5. If tests fail, clean and retry
dropdb qrave_test
createdb qrave_test
npm run db:push
npm test
```

---

## Debug Mode

Run tests with verbose output and open handle detection:

```powershell
npm test -- --verbose --detectOpenHandles
```

Run a single test file:

```powershell
npm test -- tests/unit/order.service.test.js
```

Run tests matching a pattern:

```powershell
npm test -- -t "createOrder"
```

---

## Database Connection String Format

```
postgresql://[user]:[password]@[host]:[port]/[database]
```

Examples:
- Local: `postgresql://postgres:mypassword@localhost:5432/qrave_test`
- Docker: `postgresql://postgres:postgres@localhost:5432/qrave_test`
- Remote: `postgresql://user:pass@remote-host:5432/qrave_test`

---

**Last Updated:** 2024
