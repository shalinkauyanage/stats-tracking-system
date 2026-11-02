// Reads settings from server/.env (copy .env.example to .env first).
import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3002),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'f1_career_archive',
  },
  testDatabaseName: process.env.DB_TEST_NAME || 'f1_career_archive_test',
};
