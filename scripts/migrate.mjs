// Usage: npm run db:migrate   (schema only)
//        npm run db:seed      (schema + sample data)
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set (put it in .env)'); process.exit(1); }
if (/ep-dummy|user:password@/.test(url)) {
  console.error('DATABASE_URL is still the placeholder. Put your real Neon connection string in .env first.');
  process.exit(1);
}

const files = ['db/schema.sql', ...(process.argv.includes('--seed') ? ['db/seed.sql'] : [])];
const client = new pg.Client({ connectionString: url });
await client.connect();
let current = '';
try {
  for (const f of files) {
    current = f;
    await client.query(await readFile(new URL(`../${f}`, import.meta.url), 'utf8'));
    console.log(`applied ${f}`);
  }
} catch (e) {
  console.error(`FAILED while applying ${current}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
