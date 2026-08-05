import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  connectionLimit: env.db.connectionLimit,
  timezone: '+08:00',
  decimalNumbers: false,
  namedPlaceholders: true,
  multipleStatements: false
});

export async function pingDatabase() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
