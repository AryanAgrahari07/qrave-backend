import { createPgPool } from './src/db.js';
import { env } from './src/config/env.js';

const pool = createPgPool(env.databaseUrl);

async function test() {
  const result = await pool.query(`SELECT id, extracted_data FROM menu_extraction_jobs WHERE status = 'COMPLETED' LIMIT 20`);
  for (const row of result.rows) {
    if (row.extracted_data) {
      console.log(`Job ${row.id}: type = ${typeof row.extracted_data}`);
      if (typeof row.extracted_data === 'string') {
        console.log(`STRING:`, row.extracted_data.substring(0, 50));
      }
    }
  }
  process.exit(0);
}

test().catch(console.error);
