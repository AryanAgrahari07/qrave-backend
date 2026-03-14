import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function test() {
  await pool.query(`CREATE TEMP TABLE test_jsonb (id serial, data jsonb)`);
  
  const obj = { categories: [{ name: "test", items: [] }] };
  
  // Test 1: stringify
  await pool.query(`INSERT INTO test_jsonb (data) VALUES ($1)`, [JSON.stringify(obj)]);
  
  let res = await pool.query(`SELECT data FROM test_jsonb LIMIT 1`);
  let fetched = res.rows[0].data;
  console.log('Fetched 1 type:', typeof fetched); // object
  
  // Test 2: duplicate update
  await pool.query(`UPDATE test_jsonb SET data = $1`, [JSON.stringify(fetched)]);
  
  res = await pool.query(`SELECT data FROM test_jsonb LIMIT 1`);
  fetched = res.rows[0].data;
  console.log('Fetched 2 type:', typeof fetched); // object
  
  process.exit(0);
}
test().catch(e => { console.error(e.message); process.exit(0); });
