import { neon } from '@neondatabase/serverless';

type Row = Record<string, unknown>;
type Runner = (text: string, params?: unknown[]) => Promise<Row[]>;

let runner: Runner | null = null;

// Money columns arrive from Postgres as strings (numeric). Convert them for the UI.
const NUMERIC_KEYS = new Set([
  'purchase_price', 'selling_price', 'subtotal', 'discount', 'total', 'unit_price',
  'line_total', 'total_purchases', 'outstanding', 'default_discount', 'mrp',
  'amount_paid', 'amount_due', 'cost', 'profit', 'inventory_value', 'today_revenue', 'to_collect', 'revenue',
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
  const host = new URL(url).hostname;
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
      }
      return (await pool.query(text, params)).rows as Row[];
    };
  }
  return runner;
}

export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const run = getRunner();
  let rows: Row[];
  try {
    rows = await run(text, params);
  } catch (e) {
    // Retry once on a dropped connection (e.g. Neon waking from idle). Postgres errors have a SQLSTATE code and are not retried.
    if ((e as { code?: string })?.code && /^[0-9A-Z]{5}$/.test((e as { code: string }).code)) throw e;
    if (!/fetch|ECONNRESET|ETIMEDOUT|socket/i.test(`${(e as Error)?.message} ${(e as { cause?: { message?: string } })?.cause?.message ?? ''}`)) throw e;
    rows = await run(text, params);
  }
  return normalize(rows) as unknown as T[];
}
