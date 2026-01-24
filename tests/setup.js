import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { jest } from "@jest/globals";
import {env} from "../src/config/env.js";

// Load .env from backend root before reading process.env (works even if cwd is monorepo root)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true });
dotenv.config({ path: path.join(backendRoot, ".env.test"), quiet: true }); // optional test overrides

// Increase timeout for integration tests
jest.setTimeout(30000);

// Set test environment variables
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-key-for-testing-only";
process.env.SESSION_SECRET = "test-session-secret-key-for-testing-only";

// Check if test database is configured
const testDbUrl = process.env.TEST_DATABASE_URL || env.databaseUrl;
if (!testDbUrl) {
  console.warn(`
⚠️  WARNING: Test database not configured!
   
   Set TEST_DATABASE_URL environment variable:
   PowerShell: $env:TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/qrave_test"
   CMD: set TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/qrave_test
   Linux/Mac: export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/qrave_test
   
   Tests will be skipped until database is configured.
  `);
  
  // Set flag for tests to check
  process.env.SKIP_TESTS_NO_DB = "true";
} else {
  process.env.DATABASE_URL = testDbUrl;
  process.env.SKIP_TESTS_NO_DB = "false";
}
