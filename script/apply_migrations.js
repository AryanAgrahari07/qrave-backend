import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigrations() {
  try {
    const migrationFilePath = path.join(__dirname, '..', 'migrations', 'init_all.sql');
    
    if (!fs.existsSync(migrationFilePath)) {
      console.error(`❌ Migration file not found at ${migrationFilePath}`);
      console.log('Please ensure the single combined migration file exists.');
      process.exit(1);
    }
    
    console.log(`Reading combined migrations from ${migrationFilePath}...`);
    const sqlCommands = fs.readFileSync(migrationFilePath, 'utf8');

    console.log('Applying migrations to the database...');
    // Execute all SQL statements
    await pool.query(sqlCommands);
    
    console.log('✅ All migrations applied successfully!');
  } catch (error) {
    console.error('❌ Error applying migrations:\n', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
