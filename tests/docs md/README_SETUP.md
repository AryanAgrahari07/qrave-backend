# Test Setup Guide

## ⚠️ Important: Database Setup Required

Before running tests, you need to set up a test database.

## Quick Setup

### 1. Create Test Database

```bash
# PostgreSQL
createdb qrave_test

# Or using psql
psql -U postgres -c "CREATE DATABASE qrave_test;"
```

### 2. Set Environment Variable

**Windows PowerShell:**
```powershell
$env:TEST_DATABASE_URL="postgresql://username:password@localhost:5432/qrave_test"
```

**Windows CMD:**
```cmd
set TEST_DATABASE_URL=postgresql://username:password@localhost:5432/qrave_test
```

**Linux/macOS:**
```bash
export TEST_DATABASE_URL=postgresql://username:password@localhost:5432/qrave_test
```

### 3. Run Database Migrations

```bash
# Make sure your schema is up to date
npm run db:push
```

### 4. Run Tests

```bash
npm test
```

## Troubleshooting

### "password authentication failed"
- Check your `TEST_DATABASE_URL` connection string
- Verify PostgreSQL is running
- Check username/password are correct

### "database does not exist"
- Create the test database: `createdb qrave_test`
- Or update `TEST_DATABASE_URL` to point to an existing database

### "deadlock detected"
- This is usually fixed by the updated `cleanDatabase` function
- Make sure you're using the latest test utilities

### "relation does not exist"
- Run database migrations: `npm run db:push`
- Ensure all tables are created in the test database

## Test Database Best Practices

1. **Use a separate test database** - Never use your production database
2. **Clean between tests** - Tests automatically clean the database
3. **Isolated tests** - Each test should be independent
4. **Fast cleanup** - Use TRUNCATE for faster test runs

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TEST_DATABASE_URL` | PostgreSQL connection string for tests | Yes |
| `DATABASE_URL` | Fallback if `TEST_DATABASE_URL` not set | No |
| `NODE_ENV` | Set to `test` automatically by test scripts | Auto |

## Example Connection Strings

```bash
# Local PostgreSQL
postgresql://postgres:password@localhost:5432/qrave_test

# With custom user
postgresql://testuser:testpass@localhost:5432/qrave_test

# Remote database (not recommended for tests)
postgresql://user:pass@remote-host:5432/qrave_test
```

---

**Note:** Tests will automatically clean the database before each test suite, so you don't need to manually clean it.
