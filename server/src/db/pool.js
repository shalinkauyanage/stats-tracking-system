// One shared connection pool. Every query in the app goes through here and uses
// "?" placeholders (parameterised queries), never string concatenation.
import mysql from 'mysql2/promise';
import { config } from '../config.js';

let pool;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    });
  }
  return pool;
}

/** Runs several queries as ONE transaction: all succeed, or none are saved. */
export async function withTransaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
