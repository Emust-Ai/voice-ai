import pg from 'pg';
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ev24_supervisor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const r = await pool.query("UPDATE conversations SET status = 'ended' WHERE status = 'active' AND caller_number = 'web-client'");
console.log('Updated', r.rowCount, 'rows');
await pool.end();
