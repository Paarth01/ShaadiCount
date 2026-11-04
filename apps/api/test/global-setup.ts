import { Client } from 'pg';
import { migrate } from '../src/db/migrate';

/** Rebuilds the test database from scratch using the real migrations (also proves empty-database migration works). */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://shaadicount:shaadicount_local_dev@localhost:5432/shaadicount_test';
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await migrate(url);
}
