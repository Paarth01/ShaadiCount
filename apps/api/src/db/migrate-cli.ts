import { migrate } from './migrate';
import { loadEnvFile } from './env-file';

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
migrate(url, undefined, (m) => console.log(m))
  .then((n) => console.log(n ? `${n} migration(s) applied` : 'Database is up to date'))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
