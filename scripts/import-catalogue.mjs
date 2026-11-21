// Usage: npm run db:catalogue            (import into the database in .env)
//        npm run db:catalogue -- --dry   (just show what would happen)
//
// Reads db/catalogue.psv (supplier price list) and creates/updates categories, brands and products.
// Safe to re-run: existing products (same name + brand) only get their MRP, size, category and cost price
// refreshed; stock and the selling price you chose are never touched. The built-in sample products are
// archived (not deleted) so they stop showing up; pass --keep-sample to leave them alone.
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const dry = process.argv.includes('--dry');
const keepSample = process.argv.includes('--keep-sample');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set (put it in .env)'); process.exit(1); }
if (/ep-dummy|user:password@/.test(url)) {
  console.error('DATABASE_URL is still the placeholder. Put your real Neon connection string in .env first.');
  process.exit(1);
}

const round2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- parse ----------
const text = await readFile(new URL('../db/catalogue.psv', import.meta.url), 'utf8');
const seen = new Set();
const rows = [];
const problems = [];
for (const [i, raw] of text.split('\n').entries()) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [category, brand, name, size, mrpRaw, discRaw, flatRaw] = line.split('|').map((x) => (x ?? '').trim());
  const mrp = mrpRaw ? Number(mrpRaw) : null;
  const disc = discRaw ? Number(discRaw) : 0;
  const flat = flatRaw ? Number(flatRaw) : null;
  if (!category || !brand || !name || [mrp, disc, flat].some((v) => v !== null && !Number.isFinite(v))) {
    problems.push(`line ${i + 1}: cannot read "${line}"`);
    continue;
  }
  const cost = flat ?? (mrp !== null ? round2(mrp * (1 - disc / 100)) : null);
  if (cost === null) { problems.push(`line ${i + 1}: no price for "${name}"`); continue; }

  const base = norm(name).startsWith(norm(brand)) ? name : `${brand} ${name}`;
  const fullName = size ? `${base} ${size}` : base;
  const key = `${norm(brand)}|${norm(fullName)}`;
  if (seen.has(key)) { problems.push(`line ${i + 1}: duplicate "${fullName}" skipped`); continue; }
  seen.add(key);
  rows.push({ category, brand, fullName, size, mrp, cost, selling: mrp ?? cost });
}

console.log(`${rows.length} products read from catalogue`);
problems.forEach((p) => console.log('  !', p));
const below = rows.filter((r) => r.selling < r.cost);
if (below.length) console.log(`  ! ${below.length} items would sell below cost`);

const cats = [...new Set(rows.map((r) => r.category))];
const brands = [...new Set(rows.map((r) => r.brand))];
if (dry) {
  console.log(`would use ${cats.length} categories and ${brands.length} brands`);
  console.log('dry run: nothing written');
  process.exit(0);
}

// ---------- write (a handful of bulk statements, all in one transaction) ----------
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');

  const idMap = async (table, names) => {
    await client.query(`INSERT INTO ${table} (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING`, [names]);
    const r = await client.query(`SELECT id, name FROM ${table} WHERE name = ANY($1::text[])`, [names]);
    return new Map(r.rows.map((x) => [x.name, x.id]));
  };
  const catIds = await idMap('categories', cats);
  const brandIds = await idMap('brands', brands);

  const existing = await client.query('SELECT id, lower(name) AS n, brand_id FROM products');
  const have = new Map(existing.rows.map((r) => [`${r.brand_id}|${r.n}`, r.id]));

  const upd = { id: [], mrp: [], cost: [], cat: [], size: [] };
  const ins = { name: [], brand: [], cat: [], size: [], mrp: [], cost: [], sell: [] };
  for (const r of rows) {
    const brandId = brandIds.get(r.brand), catId = catIds.get(r.category);
    const id = have.get(`${brandId}|${r.fullName.toLowerCase()}`);
    if (id) {
      upd.id.push(id); upd.mrp.push(r.mrp); upd.cost.push(r.cost); upd.cat.push(catId); upd.size.push(r.size);
    } else {
      ins.name.push(r.fullName); ins.brand.push(brandId); ins.cat.push(catId); ins.size.push(r.size);
      ins.mrp.push(r.mrp); ins.cost.push(r.cost); ins.sell.push(r.selling);
    }
  }

  if (upd.id.length) {
    await client.query(
      `UPDATE products p
          SET mrp = v.mrp, purchase_price = v.cost, category_id = v.cat, size = v.size, archived = false, updated_at = now()
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::numeric[]) AS mrp, unnest($3::numeric[]) AS cost,
                      unnest($4::uuid[]) AS cat, unnest($5::text[]) AS size) v
        WHERE p.id = v.id`,
      [upd.id, upd.mrp, upd.cost, upd.cat, upd.size]);
  }
  if (ins.name.length) {
    // sku is left blank so the database generates it (one per row)
    await client.query(
      `INSERT INTO products (name, brand_id, category_id, size, sku, mrp, purchase_price, selling_price, stock)
       SELECT v.name, v.brand, v.cat, v.size, '', v.mrp, v.cost, v.sell, 0
         FROM (SELECT unnest($1::text[]) AS name, unnest($2::uuid[]) AS brand, unnest($3::uuid[]) AS cat,
                      unnest($4::text[]) AS size, unnest($5::numeric[]) AS mrp, unnest($6::numeric[]) AS cost,
                      unnest($7::numeric[]) AS sell) v`,
      [ins.name, ins.brand, ins.cat, ins.size, ins.mrp, ins.cost, ins.sell]);
  }

  let archived = 0;
  if (!keepSample) {
    const a = await client.query(
      "UPDATE products SET archived = true WHERE id::text LIKE 'c1000000-0000-0000-0000-%' AND archived = false");
    archived = a.rowCount;
  }

  await client.query('COMMIT');
  console.log(`done: ${ins.name.length} created, ${upd.id.length} updated, ${archived} sample products archived`);
} catch (e) {
  // If the connection itself died, ROLLBACK fails too; do not let that hide the real error.
  await client.query('ROLLBACK').catch((r) => console.error('rollback also failed:', r.message));
  throw e;
} finally {
  await client.end();
}
