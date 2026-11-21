import { timingSafeEqual } from 'node:crypto';
import { query, ConfigError } from './db';
import { MailError, emailConfigured, runScheduledEmail, sendReport } from './mailer';

export interface ApiRequest {
  method: string;
  path: string[];
  query: Record<string, string>;
  body: any;
  headers?: Record<string, string | string[] | undefined>;
}
export interface ApiResponse {
  status: number;
  json: unknown;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const ok = (json: unknown, status = 200): ApiResponse => ({ status, json });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, label: string, min = 0) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < min) {
    throw new HttpError(400, `${label} must be a number${min === 0 ? ' (0 or more)' : ''}`);
  }
  return n;
};
const int = (v: unknown, label: string, min = 0) => {
  const n = num(v, label, min);
  if (!Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number`);
  return n;
};
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, label = 'id') => {
  if (typeof v !== 'string' || !uuidRe.test(v)) throw new HttpError(400, `Invalid ${label}`);
  return v;
};

// The list leaves out columns the screens never show, to keep the download small.
const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.brand_id, p.category_id, p.sku, p.mrp, p.size, p.purchase_price, p.selling_price,
         p.stock, p.unit, p.low_stock_threshold, p.expiry_date, p.archived,
         CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('name', b.name) END AS brands,
         CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object('name', c.name) END AS categories
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id`;

// Wraps an INSERT/UPDATE ... RETURNING * (aliased "p") so the saved product comes back in the same call.
const WITH_NAMES = `
  SELECT p.id, p.name, p.brand_id, p.category_id, p.sku, p.mrp, p.size, p.purchase_price, p.selling_price,
         p.stock, p.unit, p.low_stock_threshold, p.expiry_date, p.archived,
         (SELECT json_build_object('name', b.name) FROM brands b WHERE b.id = p.brand_id) AS brands,
         (SELECT json_build_object('name', c.name) FROM categories c WHERE c.id = p.category_id) AS categories
    FROM p`;

// cost = what the goods cost the shop; profit = what the customer was charged for the bill (after discount) minus cost.
const SALE_SELECT = `
  SELECT s.*,
         s.total - s.amount_paid AS amount_due,
         coalesce((SELECT sum(si.quantity * si.purchase_price) FROM sale_items si WHERE si.sale_id = s.id), 0) AS cost,
         s.total - coalesce((SELECT sum(si.quantity * si.purchase_price) FROM sale_items si WHERE si.sale_id = s.id), 0) AS profit,
         coalesce((SELECT json_agg(si ORDER BY si.product_name) FROM sale_items si WHERE si.sale_id = s.id), '[]'::json) AS sale_items
    FROM sales s`;

// Customer totals are always computed from their completed bills, so they cannot drift out of sync.
const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.phone, c.address, c.created_at,
         a.bills AS bill_count, a.sold AS total_purchases, a.due AS outstanding, a.cost AS cost,
         a.sold - a.cost AS profit
    FROM customers c
    LEFT JOIN LATERAL (
      SELECT count(s.id)::int AS bills,
             coalesce(sum(s.total), 0) AS sold,
             coalesce(sum(s.total - s.amount_paid), 0) AS due,
             coalesce(sum(ic.cost), 0) AS cost
        FROM sales s
        LEFT JOIN LATERAL (SELECT sum(quantity * purchase_price) AS cost FROM sale_items WHERE sale_id = s.id) ic ON true
       WHERE s.customer_id = c.id AND s.status = 'completed'
    ) a ON true`;

// Turn Postgres errors into messages a shopkeeper can act on.
function friendly(e: any): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof ConfigError) return new HttpError(503, e.message);
  if (e instanceof MailError) return new HttpError(502, e.message);
  const code = e?.code as string | undefined;
  const detail = `${e?.detail ?? ''} ${e?.constraint ?? ''}`;
  if (code === '23505') {
    if (/sku/i.test(detail)) return new HttpError(409, 'That SKU is already used by another product');
    if (/phone/i.test(detail)) return new HttpError(409, 'A customer with this phone number already exists');
    return new HttpError(409, 'That name already exists');
  }
  if (code === '23503' || code === '23001') {
    return new HttpError(409, 'This item is in use and cannot be deleted');
  }
  if (code === '23514') return new HttpError(400, 'A value is out of the allowed range');
  if (code === 'P0001') return new HttpError(400, e.message); // RAISE EXCEPTION from our functions
  if (/fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|certificate|SSL/i.test(`${e?.message} ${e?.cause?.message ?? ''} ${e?.cause?.code ?? ''}`)) {
    const why = [e?.cause?.code, e?.cause?.message, e?.message].filter(Boolean)[0];
    console.error('[db] connection problem:', e);
    return new HttpError(503, `Cannot reach the database (${why}). Check DATABASE_URL in .env, your internet/VPN/proxy, and that Node is v18 or newer.`);
  }
  console.error(e);
  return new HttpError(500, 'Something went wrong on the server');
}

function productValues(b: any, partial: boolean) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { cols.push(col); vals.push(v); };
  const has = (k: string) => !partial || k in b;

  if (has('name')) {
    const name = str(b.name);
    if (!name) throw new HttpError(400, 'Product name is required');
    set('name', name);
  }
  if (has('brand_id')) set('brand_id', b.brand_id ? uuid(b.brand_id, 'brand') : null);
  if (has('category_id')) set('category_id', b.category_id ? uuid(b.category_id, 'category') : null);
  if (has('size')) set('size', str(b.size));
  if ('sku' in b && str(b.sku)) set('sku', str(b.sku));
  if ('mrp' in b) set('mrp', b.mrp === '' || b.mrp === null ? null : num(b.mrp, 'MRP'));
  if (has('purchase_price')) set('purchase_price', num(b.purchase_price ?? 0, 'Purchase price'));
  if (has('selling_price')) set('selling_price', num(b.selling_price ?? 0, 'Selling price'));
  if (has('stock')) set('stock', int(b.stock ?? 0, 'Stock'));
  if (has('unit')) set('unit', str(b.unit) || 'piece');
  if (has('low_stock_threshold')) set('low_stock_threshold', int(b.low_stock_threshold ?? 5, 'Low stock threshold'));
  if (has('expiry_date')) {
    const d = str(b.expiry_date);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'Invalid expiry date');
    set('expiry_date', d || null);
  }
  if ('archived' in b) set('archived', Boolean(b.archived));
  return { cols, vals };
}

async function route(r: ApiRequest): Promise<ApiResponse> {
  const [res, id, sub] = r.path;
  const m = r.method;
  const b = r.body ?? {};

  // ----- settings -----
  if (res === 'settings') {
    if (m === 'GET') {
      const row = (await query('SELECT * FROM settings WHERE id = 1'))[0] as any;
      return ok(row ? { ...row, email_configured: emailConfigured() } : null);
    }
    if (m === 'PUT') {
      const fmt = b.receipt_format;
      if (fmt !== undefined && fmt !== 'thermal' && fmt !== 'a4') throw new HttpError(400, 'Invalid receipt format');

      // Daily email report
      const emailTo = b.email_to !== undefined ? str(b.email_to) : null;
      if (emailTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) throw new HttpError(400, 'That email address does not look right');
      if (b.email_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(str(b.email_time))) throw new HttpError(400, 'Choose a time like 20:00');
      if (b.email_tz !== undefined) {
        try { new Intl.DateTimeFormat('en', { timeZone: str(b.email_tz) }); } catch { throw new HttpError(400, 'Unknown time zone'); }
      }
      if (b.email_enabled === true) {
        const have = emailTo ?? ((await query<{ email_to: string }>('SELECT email_to FROM settings WHERE id = 1'))[0]?.email_to ?? '');
        if (!have) throw new HttpError(400, 'Enter the email address to send the report to before switching it on');
      }
      const rows = await query(
        `UPDATE settings SET
           store_name = coalesce($1, store_name), store_subtitle = coalesce($2, store_subtitle),
           store_phone = coalesce($3, store_phone), store_address = coalesce($4, store_address),
           default_discount = coalesce($5, default_discount), receipt_format = coalesce($6, receipt_format),
           low_stock_default = coalesce($7, low_stock_default), currency = coalesce($8, currency),
           store_gstin = coalesce($9, store_gstin),
           email_enabled = coalesce($10::boolean, email_enabled), email_to = coalesce($11, email_to),
           email_time = coalesce($12, email_time), email_tz = coalesce($13, email_tz),
           updated_at = now()
         WHERE id = 1 RETURNING *`,
        [
          b.store_name !== undefined ? str(b.store_name) || 'Mahaveer Agencies' : null,
          b.store_subtitle !== undefined ? str(b.store_subtitle) : null,
          b.store_phone !== undefined ? str(b.store_phone) : null,
          b.store_address !== undefined ? str(b.store_address) : null,
          b.default_discount !== undefined ? num(b.default_discount, 'Default discount') : null,
          fmt ?? null,
          b.low_stock_default !== undefined ? int(b.low_stock_default, 'Low stock default') : null,
          b.currency !== undefined ? str(b.currency) || 'INR' : null,
          b.store_gstin !== undefined ? str(b.store_gstin) : null,
          typeof b.email_enabled === 'boolean' ? b.email_enabled : null,
          emailTo,
          b.email_time !== undefined ? str(b.email_time) : null,
          b.email_tz !== undefined ? str(b.email_tz) : null,
        ]
      );
      return ok({ ...(rows[0] as any), email_configured: emailConfigured() });
    }
  }

  // ----- categories & brands -----
  if (res === 'categories' || res === 'brands') {
    const table = res;
    if (!id && m === 'GET') return ok(await query(`SELECT * FROM ${table} ORDER BY name`));
    if (!id && m === 'POST') {
      const name = str(b.name);
      if (!name) throw new HttpError(400, 'Name is required');
      return ok((await query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING *`, [name]))[0], 201);
    }
    if (id && m === 'PUT') {
      const name = str(b.name);
      if (!name) throw new HttpError(400, 'Name is required');
      const rows = await query(`UPDATE ${table} SET name = $2 WHERE id = $1 RETURNING *`, [uuid(id), name]);
      if (!rows[0]) throw new HttpError(404, 'Not found');
      return ok(rows[0]);
    }
    if (id && m === 'DELETE') {
      await query(`DELETE FROM ${table} WHERE id = $1`, [uuid(id)]);
      return ok({ ok: true });
    }
  }

  // ----- products -----
  if (res === 'products') {
    if (!id && m === 'GET') {
      const where: string[] = [];
      const params: unknown[] = [];
      const q = r.query;
      if (q.archived !== 'true') where.push('p.archived = false');
      if (q.category_id) { params.push(uuid(q.category_id)); where.push(`p.category_id = $${params.length}`); }
      if (q.brand_id) { params.push(uuid(q.brand_id)); where.push(`p.brand_id = $${params.length}`); }
      if (q.search?.trim()) {
        params.push(`%${q.search.trim()}%`);
        where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR b.name ILIKE $${params.length})`);
      }
      return ok(await query(`${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`, params));
    }
    if (!id && m === 'POST') {
      const { cols, vals } = productValues(b, false);
      const hasSku = cols.includes('sku');
      const rows = await query(
        `WITH p AS (
           INSERT INTO products (${cols.join(', ')}${hasSku ? '' : ', sku'})
           VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}${hasSku ? '' : ", ''"}) RETURNING *
         ), m AS (
           INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note)
           SELECT id, 'purchase', stock, stock, 'Opening stock' FROM p WHERE stock > 0
         )
         ${WITH_NAMES}`,
        vals
      );
      return ok(rows[0], 201);
    }
    if (id && !sub && m === 'PUT') {
      // Stock is deliberately not editable here: use /adjust so every change is audited.
      const { cols, vals } = productValues(b, true);
      const editable = cols.map((c, i) => ({ c, v: vals[i] })).filter((x) => x.c !== 'stock');
      if (!editable.length) throw new HttpError(400, 'Nothing to update');
      const sets = editable.map((x, i) => `${x.c} = $${i + 2}`).join(', ');
      const rows = await query(
        `WITH p AS (UPDATE products SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *) ${WITH_NAMES}`,
        [uuid(id), ...editable.map((x) => x.v)]
      );
      if (!rows[0]) throw new HttpError(404, 'Product not found');
      return ok(rows[0]);
    }
    if (id && sub === 'adjust' && m === 'POST') {
      const type = str(b.type);
      const money = (v: unknown, label: string) => (v === undefined || v === null || v === '' ? null : num(v, label));
      const rows = await query(
        'SELECT adjust_stock($1::uuid, $2, $3::integer, $4, $5::numeric, $6::numeric) AS result',
        [
          uuid(id), type, int(b.quantity_change, 'Quantity', Number.MIN_SAFE_INTEGER), str(b.note),
          money(b.unit_cost, 'Buying price'), money(b.selling_price, 'Selling price'),
        ]
      );
      // { stock, purchase_price (the new average cost), selling_price }
      return ok((rows[0] as any).result);
    }
    if (id && !sub && m === 'DELETE') {
      const used = await query('SELECT 1 FROM sale_items WHERE product_id = $1 LIMIT 1', [uuid(id)]);
      if (used.length) {
        throw new HttpError(409, 'This product has sales history, so it cannot be deleted. Archive it instead.');
      }
      await query('DELETE FROM stock_movements WHERE product_id = $1', [id]);
      await query('DELETE FROM products WHERE id = $1', [id]);
      return ok({ ok: true });
    }
  }

  // ----- customers -----
  if (res === 'customers') {
    if (!id && m === 'GET') {
      const term = r.query.search?.trim();
      return ok(
        term
          ? await query(`${CUSTOMER_SELECT} WHERE c.name ILIKE $1 OR c.phone ILIKE $1 ORDER BY c.name`, [`%${term}%`])
          : await query(`${CUSTOMER_SELECT} ORDER BY c.name`)
      );
    }
    if (!id && m === 'POST') {
      const name = str(b.name);
      if (!name) throw new HttpError(400, 'Customer name is required');
      const made = await query<{ id: string }>(
        'INSERT INTO customers (name, phone, address) VALUES ($1, $2, $3) RETURNING id',
        [name, str(b.phone) || null, str(b.address)]);
      return ok((await query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [made[0].id]))[0], 201);
    }
    if (id && !sub && m === 'PUT') {
      const name = str(b.name);
      if (!name) throw new HttpError(400, 'Customer name is required');
      const rows = await query(
        'UPDATE customers SET name = $2, phone = $3, address = $4 WHERE id = $1 RETURNING id',
        [uuid(id), name, str(b.phone) || null, str(b.address)]
      );
      if (!rows[0]) throw new HttpError(404, 'Customer not found');
      return ok((await query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id]))[0]);
    }
    if (id && sub === 'sales' && m === 'GET') {
      return ok(await query(`${SALE_SELECT} WHERE s.customer_id = $1 ORDER BY s.created_at DESC LIMIT 100`, [uuid(id)]));
    }
    if (id && sub === 'payment' && m === 'POST') {
      // A lump-sum payment clears the customer's oldest unpaid bills first.
      await query('SELECT record_customer_payment($1, $2::numeric)', [uuid(id), num(b.amount, 'Amount', 0.01)]);
      return ok((await query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id]))[0]);
    }
    if (id && !sub && m === 'DELETE') {
      await query('DELETE FROM customers WHERE id = $1', [uuid(id)]);
      return ok({ ok: true });
    }
  }

  // ----- sales -----
  if (res === 'sales') {
    if (!id && m === 'GET') {
      const where: string[] = [];
      const params: unknown[] = [];
      const q = r.query;
      if (q.search?.trim()) {
        params.push(`%${q.search.trim()}%`);
        where.push(`(s.bill_number ILIKE $${params.length} OR s.customer_name ILIKE $${params.length} OR s.customer_phone ILIKE $${params.length})`);
      }
      if (q.payment) { params.push(q.payment); where.push(`s.payment_method = $${params.length}`); }
      if (q.status) { params.push(q.status); where.push(`s.status = $${params.length}`); }
      if (q.due === 'true') where.push(`s.status = 'completed' AND s.amount_paid < s.total`);
      if (q.from) { params.push(q.from); where.push(`s.created_at >= $${params.length}::date`); }
      if (q.to) { params.push(q.to); where.push(`s.created_at < ($${params.length}::date + 1)`); }
      const limit = Math.min(Math.max(parseInt(q.limit ?? '500', 10) || 500, 1), 2000);
      return ok(await query(
        `${SALE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.created_at DESC LIMIT ${limit}`,
        params
      ));
    }
    if (!id && m === 'POST') {
      if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Add at least one product to the bill');
      const items = b.items.map((i: any) => ({
        product_id: uuid(i.product_id, 'product'),
        quantity: int(i.quantity, 'Quantity', 1),
        // The owner decides the selling price per line; omitted means the listed selling price.
        unit_price: i.unit_price === undefined || i.unit_price === null || i.unit_price === ''
          ? undefined : num(i.unit_price, 'Selling price'),
      }));
      const rows = await query(
        'SELECT create_bill($1::jsonb, $2::uuid, $3, $4, $5::numeric, $6, $7, $8, $9::numeric) AS result',
        [
          JSON.stringify(items),
          b.customer_id ? uuid(b.customer_id, 'customer') : null,
          str(b.customer_name), str(b.customer_phone),
          num(b.discount ?? 0, 'Discount'),
          str(b.payment_method) || 'cash',
          str(b.notes),
          str(b.idempotency_key) || null,
          b.amount_paid === undefined || b.amount_paid === '' ? null : num(b.amount_paid, 'Amount paid'),
        ]
      );
      const result = (rows[0] as any).result;
      // Only a repeated (duplicate) submission comes back without the bill attached.
      const sale = result.sale ?? (await query(`${SALE_SELECT} WHERE s.id = $1`, [result.sale_id]))[0];
      return ok({ ...result, sale }, result.duplicate ? 200 : 201);
    }
    if (id && !sub && m === 'GET') {
      const rows = await query(`${SALE_SELECT} WHERE s.id = $1`, [uuid(id)]);
      if (!rows[0]) throw new HttpError(404, 'Bill not found');
      return ok(rows[0]);
    }
    if (!id && m === 'DELETE') {
      // Wipes the entire sales log, so the caller has to say so explicitly.
      if (r.query.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm clearing the whole sales log');
      const rows = await query('SELECT clear_sales($1::boolean) AS n', [r.query.restore !== 'false']);
      return ok({ deleted: Number((rows[0] as any).n) });
    }
    if (id && !sub && m === 'DELETE') {
      await query('SELECT delete_bill($1::uuid, $2::boolean)', [uuid(id), r.query.restore !== 'false']);
      return ok({ ok: true });
    }
    if (id && sub === 'payment' && m === 'POST') {
      const due = await query('SELECT record_bill_payment($1, $2::numeric) AS due', [uuid(id), num(b.amount, 'Amount', 0.01)]);
      return ok({ amount_due: Number((due[0] as any).due) });
    }
    if (id && sub === 'cancel' && m === 'POST') {
      await query('SELECT cancel_bill($1)', [uuid(id)]);
      return ok({ ok: true });
    }
  }

  // ----- stock movements -----
  if (res === 'stock-movements' && m === 'GET') {
    const limit = Math.min(Math.max(parseInt(r.query.limit ?? '300', 10) || 300, 1), 1000);
    const where = r.query.product_id ? 'WHERE sm.product_id = $1' : '';
    return ok(await query(
      `SELECT sm.*, json_build_object('name', p.name, 'sku', p.sku, 'unit', p.unit) AS products
         FROM stock_movements sm JOIN products p ON p.id = sm.product_id
         ${where} ORDER BY sm.created_at DESC LIMIT ${limit}`,
      r.query.product_id ? [uuid(r.query.product_id)] : []
    ));
  }

  // ----- dashboard: one query, small answer -----
  if (res === 'dashboard' && m === 'GET') {
    let tz = r.query.tz || 'Asia/Kolkata';
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = 'Asia/Kolkata'; }
    const days = Math.min(Math.max(parseInt(r.query.days ?? '30', 10) || 30, 1), 366);
    // Products that were never stocked (catalogue entries only) are not "out of stock".
    const stocked = 'EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = p.id)';
    const rows = await query(
      `WITH today AS (SELECT (now() AT TIME ZONE $1::text)::date AS d),
            win AS (SELECT (SELECT d FROM today) - ($2::int - 1) AS start_d),
            sold AS (
              SELECT s.id, s.total, s.payment_method,
                     (s.created_at AT TIME ZONE $1::text)::date AS d,
                     s.total - coalesce(c.cost, 0) AS profit
                FROM sales s
                LEFT JOIN LATERAL (SELECT sum(quantity * purchase_price) AS cost FROM sale_items WHERE sale_id = s.id) c ON true
               WHERE s.status = 'completed'
                 AND s.created_at >= ((SELECT start_d FROM win)::timestamp AT TIME ZONE $1::text)
            )
       SELECT json_build_object(
         'days', $2::int,
         'kpis', json_build_object(
           'revenue', (SELECT coalesce(sum(total), 0) FROM sold),
           'profit', (SELECT coalesce(sum(profit), 0) FROM sold),
           'bills', (SELECT count(*) FROM sold),
           'today_revenue', (SELECT coalesce(sum(total), 0) FROM sold WHERE d = (SELECT d FROM today)),
           'today_bills', (SELECT count(*) FROM sold WHERE d = (SELECT d FROM today)),
           'to_collect', (SELECT coalesce(sum(total - amount_paid), 0) FROM sales WHERE status = 'completed'),
           'out_count', (SELECT count(*) FROM products p WHERE NOT p.archived AND p.stock = 0 AND ${stocked}),
           'low_count', (SELECT count(*) FROM products p WHERE NOT p.archived AND p.stock > 0 AND p.stock <= p.low_stock_threshold),
           'inventory_cost', (SELECT coalesce(sum(stock * purchase_price), 0) FROM products WHERE NOT archived),
           'inventory_retail', (SELECT coalesce(sum(stock * selling_price), 0) FROM products WHERE NOT archived)
         ),
         'series', (SELECT coalesce(json_agg(r ORDER BY r.d), '[]'::json) FROM (
                      SELECT g::date AS d, coalesce(sum(sold.total), 0) AS revenue,
                             coalesce(sum(sold.profit), 0) AS profit, count(sold.id)::int AS bills
                        FROM generate_series((SELECT start_d FROM win), (SELECT d FROM today), interval '1 day') g
                        LEFT JOIN sold ON sold.d = g::date GROUP BY g) r),
         'payments', (SELECT coalesce(json_agg(p), '[]'::json) FROM (
                        SELECT payment_method AS method, sum(total) AS revenue, count(*)::int AS bills
                          FROM sold GROUP BY payment_method ORDER BY 2 DESC) p),
         'top', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
                   SELECT si.product_name AS name, sum(si.quantity)::int AS qty, sum(si.line_total) AS revenue,
                          sum(si.line_total - si.quantity * si.purchase_price) AS profit
                     FROM sale_items si JOIN sold ON sold.id = si.sale_id
                    GROUP BY si.product_name ORDER BY qty DESC, revenue DESC LIMIT 8) t),
         'categories', (SELECT coalesce(json_agg(c), '[]'::json) FROM (
                          SELECT coalesce(cat.name, 'Other') AS name, sum(si.line_total) AS revenue
                            FROM sale_items si JOIN sold ON sold.id = si.sale_id
                            LEFT JOIN products p ON p.id = si.product_id
                            LEFT JOIN categories cat ON cat.id = p.category_id
                           GROUP BY 1 ORDER BY 2 DESC LIMIT 8) c),
         'alerts', (SELECT coalesce(json_agg(a), '[]'::json) FROM (
                      SELECT p.id, p.name, p.sku, p.stock, p.unit FROM products p
                       WHERE NOT p.archived AND (p.stock = 0 OR p.stock <= p.low_stock_threshold) AND ${stocked}
                       ORDER BY p.stock, p.name LIMIT 8) a),
         'owing', (SELECT coalesce(json_agg(o), '[]'::json) FROM (
                     SELECT coalesce(c.name, nullif(s.customer_name, ''), 'Walk-in (no name)') AS name,
                            coalesce(c.phone, nullif(s.customer_phone, '')) AS phone,
                            sum(s.total - s.amount_paid) AS due, count(*)::int AS bills
                       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
                      WHERE s.status = 'completed' AND s.amount_paid < s.total
                      GROUP BY coalesce(s.customer_id::text, nullif(s.customer_phone, ''), lower(nullif(s.customer_name, '')), 'walkin'),
                               c.name, c.phone, s.customer_name, s.customer_phone
                      ORDER BY due DESC LIMIT 6) o),
         'recent', (SELECT coalesce(json_agg(x), '[]'::json) FROM (
                      SELECT id, bill_number, customer_name, created_at, total, payment_method, total - amount_paid AS amount_due
                        FROM sales WHERE status = 'completed' ORDER BY created_at DESC LIMIT 6) x)
       ) AS data`,
      [tz, days]
    );
    return ok((rows[0] as any).data);
  }

  // ----- daily email -----
  if (res === 'email' && id === 'test' && m === 'POST') {
    const to = str(b.to);
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, 'That email address does not look right');
    return ok(await sendReport({ to: to || undefined }));
  }
  if (res === 'cron' && id === 'daily-email') {
    // Called by a timer outside the app (the dev server has its own). Must carry the shared secret.
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new HttpError(403, 'CRON_SECRET is not set');
    const header = String(r.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
    const given = Buffer.from(header || r.query.key || '');
    const want = Buffer.from(secret);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(401, 'Wrong key');
    return ok(await runScheduledEmail());
  }

  if (res === 'health') {
    await query('SELECT 1');
    return ok({ ok: true });
  }

  throw new HttpError(404, 'Not found');
}

export async function handle(r: ApiRequest): Promise<ApiResponse> {
  try {
    return await route(r);
  } catch (e) {
    const err = friendly(e);
    return { status: err.status, json: { error: err.message } };
  }
}
