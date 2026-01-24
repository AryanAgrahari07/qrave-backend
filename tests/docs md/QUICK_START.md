# Quick Start Guide - Running Tests

## ⚠️ Before Running Tests

You need a PostgreSQL database configured. Tests will **skip automatically** if the database is not configured.

## Option 1: Skip Tests (If Database Not Available)

Tests will automatically skip if `TEST_DATABASE_URL` is not set. You'll see:

```
⚠️  WARNING: Test database not configured!
Tests will be skipped until database is configured.
```

This is **OK** - the test infrastructure is complete and ready when you have a database.

## Option 2: Configure Database and Run Tests

### Step 1: Install PostgreSQL (if not installed)

**Windows:**
- Download from: https://www.postgresql.org/download/windows/
- Or use Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres`

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Linux:**
```bash
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Step 2: Create Test Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create test database
CREATE DATABASE qrave_test;

# Exit
\q
```

### Step 3: Set Environment Variable

**PowerShell:**
```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/qrave_test"
```

**CMD:**
```cmd
set TEST_DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/qrave_test
```

**Linux/macOS:**
```bash
export TEST_DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/qrave_test
```

### Step 4: Run Database Migrations

```bash
npm run db:push
```

### Step 5: Run Tests

```bash
npm test
```

## Test Status Summary

✅ **Complete:**
- Jest configuration (ES modules support)
- Test utilities (database, auth, fixtures)
- Unit test structure (order & queue services)
- Integration test structure (order API)
- Load testing scripts (k6)
- Performance benchmarks
- Cross-platform support (Windows/Mac/Linux)

⏳ **Requires Database:**
- Actual test execution (will skip if DB not configured)
- Database connection verification

## What's Working

Even without a database, you can:

1. **Verify test structure:**
   ```bash
   npm test -- --listTests
   ```

2. **Check Jest configuration:**
   ```bash
   npm test -- --showConfig
   ```

3. **View test files:**
   - `tests/unit/` - Unit tests
   - `tests/integration/` - Integration tests
   - `tests/load/` - Load tests (k6)
   - `tests/benchmark/` - Performance benchmarks

## Troubleshooting

See `tests/TROUBLESHOOTING.md` for detailed solutions to common issues.

## Next Steps

1. **If you have PostgreSQL:** Follow Option 2 above
2. **If you don't have PostgreSQL:** Tests will skip automatically - this is fine!
3. **For CI/CD:** Set `TEST_DATABASE_URL` in your CI environment variables

---

**Status:** ✅ Test infrastructure complete and ready  
**Database:** ⏳ Required for actual test execution
