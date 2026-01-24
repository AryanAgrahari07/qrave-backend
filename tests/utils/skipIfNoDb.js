/**
 * Skip tests if database is not configured
 */
export function skipIfNoDb() {
  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!testDbUrl) {
    return {
      skip: true,
      reason: "TEST_DATABASE_URL not configured",
    };
  }
  
  return { skip: false };
}

/**
 * Check if database connection is available
 */
export async function checkDbConnection(pool) {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (error) {
    return false;
  }
}
