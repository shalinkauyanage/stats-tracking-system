// Prints the tables found in your database. Run with:  npm run db:check
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

let connection;
try {
  connection = await mysql.createConnection(config.db);
  const [[version]] = await connection.query('SELECT VERSION() AS v');
  const [tables] = await connection.query(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
    [config.db.database],
  );
  console.log(`Connected. MySQL ${version.v}, database "${config.db.database}".`);
  console.log(`${tables.length} tables:`);
  for (const t of tables) console.log('  - ' + t.name);
} catch (err) {
  console.error('Could not connect: ' + err.message);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
