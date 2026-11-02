// Creates the database (if missing) and applies the schema.
// Run with:  npm run db:setup
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';

const { database, ...connectionSettings } = config.db;

if (!/^[A-Za-z0-9_]+$/.test(database)) {
  console.error(`DB_NAME "${database}" may only contain letters, numbers and underscores.`);
  process.exit(1);
}

let connection;
try {
  connection = await mysql.createConnection({ ...connectionSettings, multipleStatements: true });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.changeUser({ database });
  const applied = await runMigrations(connection);
  console.log(applied.length
    ? `Database "${database}" ready. Applied: ${applied.join(', ')}`
    : `Database "${database}" is already up to date.`);
} catch (err) {
  console.error('\nCould not set up the database:\n  ' + err.message);
  console.error('\nCheck that MySQL is running and that DB_USER / DB_PASSWORD in server/.env are correct.');
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
