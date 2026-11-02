// Applies the numbered .sql files in server/db/migrations, once each, in order.
// Applied files are remembered in the "schema_migrations" table, so running
// "npm run db:setup" again is safe and does nothing if everything is up to date.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../db/migrations');

export async function listMigrationFiles(dir = MIGRATIONS_DIR) {
  const files = await fs.readdir(dir);
  return files.filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
}

/** connection must be created with { multipleStatements: true } */
export async function runMigrations(connection, dir = MIGRATIONS_DIR) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [rows] = await connection.query('SELECT filename FROM schema_migrations');
  const done = new Set(rows.map((r) => r.filename));
  const applied = [];
  for (const file of await listMigrationFiles(dir)) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    await connection.query(sql);
    await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    applied.push(file);
  }
  return applied;
}
