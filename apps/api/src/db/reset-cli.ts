import { Client } from 'pg';
import { migrate } from './migrate';
import { loadEnvFile } from './env-file';

loadEnvFile();
(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  console.log(`${await migrate(url)} migration(s) applied to a clean schema`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
