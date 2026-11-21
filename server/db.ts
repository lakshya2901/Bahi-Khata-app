import { neon } from '@neondatabase/serverless';

type Row = Record<string, unknown>;
type Runner = (text: string, params?: unknown[]) => Promise<Row[]>;

let runner: Runner | null = null;

// Money columns arrive from Postgres as strings (numeric). Convert them for the UI.
// This works by column name on the top-level columns of a row, so a NEW numeric column must be added here or it
// reaches the UI as a string. Numbers nested inside json_build_object(...) already arrive as real JSON numbers.
const NUMERIC_KEYS = new Set([
  'purchase_price', 'selling_price', 'subtotal', 'discount', 'total', 'unit_price',
  'line_total', 'total_purchases', 'outstanding', 'default_discount', 'mrp',
  'amount_paid', 'amount_due', 'cost', 'profit', 'today_revenue', 'to_collect', 'revenue',
  'unit_cost', 'cost_after',
]);

export function normalize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalize) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Row = {};
    for (const [k, v] of Object.entries(value as Row)) {
      out[k] = NUMERIC_KEYS.has(k) && typeof v === 'string' ? Number(v) : normalize(v);
    }
    return out as T;
  }
  return value;
}

export class ConfigError extends Error {}

function getRunner(): Runner {
  if (runner) return runner;
  const url = process.env.DATABASE_URL;
  if (!url) throw new ConfigError('DATABASE_URL is not set. Add it to your .env file.');
  if (/ep-dummy|user:password@/.test(url)) {
    throw new ConfigError('DATABASE_URL is still the placeholder. Put your real Neon connection string in .env.');
  }
  let host: string;
  try { host = new URL(url).hostname; } catch { throw new ConfigError('DATABASE_URL is not a valid connection string. Copy it again from the Neon dashboard.'); }
  // Neon is reached over HTTP (one statement per request, no session), so multi-step changes must live in SQL functions.
  if (host.endsWith('neon.tech')) {
    const sql = neon(url);
    runner = async (text, params = []) => (await sql.query(text, params)) as Row[];
  } else {
    // Any non-Neon Postgres (e.g. a local one for development) goes through the standard driver.
    let pool: import('pg').Pool | null = null;
    runner = async (text, params = []) => {
      if (!pool) {
        const pg = await import('pg');
        pool = new pg.default.Pool({ connectionString: url });
        // Without a listener, an error on an idle connection would crash the whole Node process.
        pool.on('error', (err) => console.error('[db] idle connection error:', err.message));
      }
      return (await pool.query(text, params)).rows as Row[];
    };
  }
  return runner;
}

// Only plain reads are safe to repeat. A write that timed out may already have been applied, and running it
// again would double a payment or a stock change.
const WRITES = /\b(insert|update|delete|create_bill|adjust_stock|record_\w+|cancel_bill|delete_bill|clear_sales)\b/i;
const isRead = (text: string) => /^\s*(select|with)\b/i.test(text) && !WRITES.test(text);

export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const run = getRunner();
  let rows: Row[];
  try {
    rows = await run(text, params);
  } catch (e) {
    // Retry a READ once on a dropped connection (e.g. Neon waking from idle). Postgres errors have a SQLSTATE code
    // and are not retried. Keep the pattern below in step with the connection check in friendly() in routes.ts.
    if ((e as { code?: string })?.code && /^[0-9A-Z]{5}$/.test((e as { code: string }).code)) throw e;
    if (!isRead(text)) throw e;
    if (!/fetch|ECONNRESET|ETIMEDOUT|socket/i.test(`${(e as Error)?.message} ${(e as { cause?: { message?: string } })?.cause?.message ?? ''}`)) throw e;
    console.warn('[db] connection dropped, retrying read once:', (e as Error)?.message);
    rows = await run(text, params);
  }
  return normalize(rows) as unknown as T[];
}
