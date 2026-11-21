-- Mahaveer Agencies — plain PostgreSQL schema (Neon compatible). Safe to re-run.


CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name text NOT NULL DEFAULT 'Mahaveer Agencies',
  store_subtitle text NOT NULL DEFAULT 'Inventory & Billing Management',
  store_phone text NOT NULL DEFAULT '',
  store_address text NOT NULL DEFAULT '',
  default_discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (default_discount >= 0),
  receipt_format text NOT NULL DEFAULT 'a4' CHECK (receipt_format IN ('thermal','a4')),
  low_stock_default integer NOT NULL DEFAULT 5 CHECK (low_stock_default >= 0),
  currency text NOT NULL DEFAULT 'INR',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS store_gstin text NOT NULL DEFAULT '';
-- Daily email report (the sender's Gmail login lives in .env, never here)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_to text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_time text NOT NULL DEFAULT '20:00';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_tz text NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_last_sent date;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_last_attempt timestamptz;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS email_last_error text NOT NULL DEFAULT '';
ALTER TABLE settings ALTER COLUMN receipt_format SET DEFAULT 'a4';
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  sku text NOT NULL UNIQUE,
  purchase_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unit text NOT NULL DEFAULT 'piece',
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  expiry_date date,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp numeric(12,2) CHECK (mrp IS NULL OR mrp >= 0);
-- Size / variant (e.g. '200 ml'). Products of the same brand and line are grouped by it in Inventory.
ALTER TABLE products ADD COLUMN IF NOT EXISTS size text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_name ON products (lower(name));
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand_id);
CREATE INDEX IF NOT EXISTS idx_products_archived ON products (archived);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE,
  address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Totals, profit and amount due are computed from sales, so they can never drift out of sync.
ALTER TABLE customers DROP COLUMN IF EXISTS total_purchases;
ALTER TABLE customers DROP COLUMN IF EXISTS bill_count;
ALTER TABLE customers DROP COLUMN IF EXISTS outstanding;

CREATE TABLE IF NOT EXISTS bill_counters (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_number integer NOT NULL DEFAULT 0
);
INSERT INTO bill_counters (id, current_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number text NOT NULL UNIQUE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','upi','card','credit')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  notes text NOT NULL DEFAULT '',
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'amount_paid') THEN
    ALTER TABLE sales ADD COLUMN amount_paid numeric(14,2);
    UPDATE sales SET amount_paid = CASE WHEN payment_method = 'credit' THEN 0 ELSE total END;
    ALTER TABLE sales ALTER COLUMN amount_paid SET NOT NULL;
    ALTER TABLE sales ALTER COLUMN amount_paid SET DEFAULT 0;
    ALTER TABLE sales ADD CONSTRAINT sales_amount_paid_range CHECK (amount_paid >= 0 AND amount_paid <= total);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sales_unpaid ON sales (created_at) WHERE status = 'completed' AND amount_paid < total;
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  product_brand text NOT NULL DEFAULT '',
  product_sku text NOT NULL DEFAULT '',
  product_unit text NOT NULL DEFAULT 'piece',
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  purchase_price numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL
);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS mrp numeric(12,2);
-- Bills made before the MRP was stored on each item: fill it in from the product (so their invoices can show the discount too).
UPDATE sale_items si SET mrp = p.mrp FROM products p WHERE si.product_id = p.id AND si.mrp IS NULL AND p.mrp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase','sale','correction','damage','return','sale_cancel')),
  quantity_change integer NOT NULL,
  resulting_stock integer NOT NULL,
  note text NOT NULL DEFAULT '',
  bill_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_bill ON stock_movements (bill_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements (created_at DESC);

-- ---------- SKU auto-generation (only when SKU left blank) ----------
CREATE OR REPLACE FUNCTION generate_sku() RETURNS trigger AS $$
DECLARE
  prefix text;
  next_num integer;
BEGIN
  IF NEW.sku IS NOT NULL AND NEW.sku <> '' THEN
    RETURN NEW;
  END IF;
  prefix := upper(left(regexp_replace(coalesce(NEW.name, ''), '[^A-Za-z]', '', 'g'), 3));
  IF prefix = '' THEN prefix := 'PRD'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('generate_sku'));
  SELECT coalesce(max(substring(sku from length(prefix) + 2)::integer), 0) + 1
    INTO next_num
    FROM products
   WHERE sku ~ ('^' || prefix || '-[0-9]+$');
  NEW.sku := prefix || '-' || lpad(next_num::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_sku ON products;
CREATE TRIGGER trg_generate_sku BEFORE INSERT ON products
FOR EACH ROW EXECUTE FUNCTION generate_sku();

-- ---------- create_bill: one atomic statement ----------
DROP FUNCTION IF EXISTS create_bill(jsonb, uuid, text, text, numeric, text, text);
DROP FUNCTION IF EXISTS create_bill(jsonb, uuid, text, text, numeric, text, text, text);

-- p_items: [{product_id, quantity, unit_price?}]. unit_price lets the owner sell above/below the listed price;
-- when omitted the product's selling price is used.
CREATE OR REPLACE FUNCTION create_bill(
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT '',
  p_customer_phone text DEFAULT '',
  p_discount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT '',
  p_idempotency_key text DEFAULT NULL,
  p_amount_paid numeric DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_sale_id uuid;
  v_counter integer;
  v_bill_number text;
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_line record;
  v_prod record;
  v_new_stock integer;
  v_existing record;
  v_sale jsonb;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, bill_number, total INTO v_existing FROM sales WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_existing.id, 'bill_number', v_existing.bill_number,
                                'total', v_existing.total, 'duplicate', true);
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item';
  END IF;
  IF p_payment_method NOT IN ('cash','upi','card','credit') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
              WHERE coalesce((e->>'quantity')::integer, 0) <= 0 OR e->>'product_id' IS NULL
                 OR coalesce((e->>'unit_price')::numeric, 0) < 0) THEN
    RAISE EXCEPTION 'Invalid quantity or price';
  END IF;

  -- Customer details typed at billing are linked to a customer record (matched by phone, else by name)
  -- so purchase history, profit and amount due add up per customer.
  IF p_customer_id IS NULL AND (coalesce(p_customer_phone, '') <> '' OR coalesce(p_customer_name, '') <> '') THEN
    IF coalesce(p_customer_phone, '') <> '' THEN
      SELECT id INTO p_customer_id FROM customers WHERE phone = p_customer_phone;
    ELSE
      SELECT id INTO p_customer_id FROM customers WHERE lower(name) = lower(p_customer_name) ORDER BY created_at LIMIT 1;
    END IF;
    IF p_customer_id IS NULL THEN
      INSERT INTO customers (name, phone)
      VALUES (coalesce(nullif(p_customer_name, ''), p_customer_phone), nullif(p_customer_phone, ''))
      ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
      RETURNING id INTO p_customer_id;
    END IF;
  END IF;

  -- Lock each product once (in id order, so concurrent bills cannot deadlock) and check stock for the total quantity.
  FOR v_line IN
    SELECT (e->>'product_id')::uuid AS product_id, sum((e->>'quantity')::integer)::integer AS qty
      FROM jsonb_array_elements(p_items) e GROUP BY 1 ORDER BY 1
  LOOP
    SELECT p.* INTO v_prod FROM products p WHERE p.id = v_line.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_prod.archived THEN RAISE EXCEPTION 'Product % is archived', v_prod.name; END IF;
    IF v_prod.stock < v_line.qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (available: %, requested: %)', v_prod.name, v_prod.stock, v_line.qty;
    END IF;
  END LOOP;

  SELECT coalesce(sum((e->>'quantity')::integer * round(coalesce((e->>'unit_price')::numeric, p.selling_price), 2)), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(p_items) e JOIN products p ON p.id = (e->>'product_id')::uuid;

  p_discount := least(greatest(coalesce(p_discount, 0), 0), v_subtotal);
  v_total := v_subtotal - p_discount;
  v_paid := CASE WHEN p_payment_method = 'credit'
                 THEN least(greatest(coalesce(p_amount_paid, 0), 0), v_total)
                 ELSE v_total END;

  UPDATE bill_counters SET current_number = current_number + 1 WHERE id = 1 RETURNING current_number INTO v_counter;
  v_bill_number := 'INV-' || lpad(v_counter::text, 6, '0');

  INSERT INTO sales (bill_number, customer_id, customer_name, customer_phone, subtotal, discount, total,
                     amount_paid, payment_method, notes, idempotency_key)
  VALUES (v_bill_number, p_customer_id, coalesce(p_customer_name, ''), coalesce(p_customer_phone, ''),
          v_subtotal, p_discount, v_total, v_paid, p_payment_method, coalesce(p_notes, ''), p_idempotency_key)
  RETURNING id INTO v_sale_id;

  FOR v_line IN
    SELECT (e->>'product_id')::uuid AS product_id,
           round((e->>'unit_price')::numeric, 2) AS unit_price,
           sum((e->>'quantity')::integer)::integer AS qty
      FROM jsonb_array_elements(p_items) e GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    SELECT p.*, coalesce(b.name, '') AS brand_text INTO v_prod
      FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = v_line.product_id;

    UPDATE products SET stock = stock - v_line.qty, updated_at = now()
     WHERE id = v_line.product_id AND stock >= v_line.qty
     RETURNING stock INTO v_new_stock;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for %', v_prod.name; END IF;

    INSERT INTO sale_items (sale_id, product_id, product_name, product_brand, product_sku, product_unit,
                            quantity, unit_price, purchase_price, mrp, line_total)
    VALUES (v_sale_id, v_prod.id, v_prod.name, v_prod.brand_text, v_prod.sku, v_prod.unit,
            v_line.qty, coalesce(v_line.unit_price, v_prod.selling_price), v_prod.purchase_price, v_prod.mrp,
            v_line.qty * coalesce(v_line.unit_price, v_prod.selling_price));

    INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note, bill_id)
    VALUES (v_prod.id, 'sale', -v_line.qty, v_new_stock, 'Sale ' || v_bill_number, v_sale_id);
  END LOOP;

  -- Hand back the finished bill so the app needs no second round trip.
  SELECT to_jsonb(s) || jsonb_build_object(
           'amount_due', s.total - s.amount_paid,
           'cost', coalesce(c.cost, 0),
           'profit', s.total - coalesce(c.cost, 0),
           'sale_items', coalesce(i.items, '[]'::jsonb))
    INTO v_sale
    FROM sales s
    LEFT JOIN LATERAL (SELECT sum(quantity * purchase_price) AS cost FROM sale_items WHERE sale_id = s.id) c ON true
    LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(si) ORDER BY si.product_name) AS items FROM sale_items si WHERE si.sale_id = s.id) i ON true
   WHERE s.id = v_sale_id;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'bill_number', v_bill_number, 'total', v_total,
                            'duplicate', false, 'sale', v_sale);
EXCEPTION WHEN unique_violation THEN
  -- Two identical submissions raced: return the one that won.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, bill_number, total INTO v_existing FROM sales WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_existing.id, 'bill_number', v_existing.bill_number,
                                'total', v_existing.total, 'duplicate', true);
    END IF;
  END IF;
  RAISE;
END;
$$ LANGUAGE plpgsql;

-- ---------- cancel_bill ----------
CREATE OR REPLACE FUNCTION cancel_bill(p_sale_id uuid) RETURNS void AS $$
DECLARE
  v_sale record;
  v_item record;
  v_new_stock integer;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_sale.status = 'cancelled' THEN RAISE EXCEPTION 'Bill is already cancelled'; END IF;

  FOR v_item IN
    SELECT product_id, sum(quantity)::integer AS quantity FROM sale_items
     WHERE sale_id = p_sale_id AND product_id IS NOT NULL GROUP BY product_id ORDER BY product_id
  LOOP
    UPDATE products SET stock = stock + v_item.quantity, updated_at = now()
     WHERE id = v_item.product_id RETURNING stock INTO v_new_stock;
    INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note, bill_id)
    VALUES (v_item.product_id, 'sale_cancel', v_item.quantity, v_new_stock,
            'Bill ' || v_sale.bill_number || ' cancelled - stock restored', p_sale_id);
  END LOOP;

  UPDATE sales SET status = 'cancelled' WHERE id = p_sale_id;

END;
$$ LANGUAGE plpgsql;

-- ---------- adjust_stock: atomic, computed on the server ----------
-- When units are bought at a price (p_unit_cost), the product's cost becomes the WEIGHTED AVERAGE of the old
-- stock and the new lot:  (old stock x old cost + new units x new cost) / (old stock + new units).
-- p_selling_price optionally changes the selling price in the same step.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);   -- what was paid per unit for this lot
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS cost_after numeric(12,2);  -- the average cost once the lot was added

DROP FUNCTION IF EXISTS adjust_stock(uuid, text, integer, text);

CREATE OR REPLACE FUNCTION adjust_stock(
  p_product_id uuid, p_type text, p_change integer, p_note text DEFAULT '',
  p_unit_cost numeric DEFAULT NULL, p_selling_price numeric DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_old record;
  v_new_stock integer;
  v_new_cost numeric(12,2);
  v_lot_cost numeric(12,2);
  v_sell numeric(12,2);
BEGIN
  IF p_type NOT IN ('purchase','correction','damage','return') THEN
    RAISE EXCEPTION 'Invalid adjustment type';
  END IF;
  IF p_change IS NULL OR p_change = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN RAISE EXCEPTION 'Buying price cannot be negative'; END IF;
  IF p_selling_price IS NOT NULL AND p_selling_price < 0 THEN RAISE EXCEPTION 'Selling price cannot be negative'; END IF;

  SELECT stock, purchase_price INTO v_old FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF v_old.stock + p_change < 0 THEN
    RAISE EXCEPTION 'Adjustment would make stock negative (or product not found)';
  END IF;

  v_new_cost := v_old.purchase_price;
  IF p_type = 'purchase' AND p_change > 0 AND p_unit_cost IS NOT NULL THEN
    v_lot_cost := p_unit_cost;
    v_new_cost := round((v_old.stock * v_old.purchase_price + p_change * p_unit_cost) / (v_old.stock + p_change), 2);
  END IF;

  UPDATE products
     SET stock = stock + p_change, purchase_price = v_new_cost,
         selling_price = coalesce(p_selling_price, selling_price), updated_at = now()
   WHERE id = p_product_id
   RETURNING stock, selling_price INTO v_new_stock, v_sell;

  INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note, unit_cost, cost_after)
  VALUES (p_product_id, p_type, p_change, v_new_stock, coalesce(p_note, ''), v_lot_cost,
          CASE WHEN v_lot_cost IS NULL THEN NULL ELSE v_new_cost END);

  RETURN jsonb_build_object('stock', v_new_stock, 'purchase_price', v_new_cost, 'selling_price', v_sell);
END;
$$ LANGUAGE plpgsql;

-- ---------- payments received against bills ----------
CREATE OR REPLACE FUNCTION record_bill_payment(p_sale_id uuid, p_amount numeric) RETURNS numeric AS $$
DECLARE
  v_due numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter an amount greater than zero'; END IF;
  UPDATE sales SET amount_paid = amount_paid + p_amount
   WHERE id = p_sale_id AND status = 'completed' AND amount_paid + p_amount <= total
   RETURNING total - amount_paid INTO v_due;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amount is more than what is due on this bill (or the bill is cancelled)';
  END IF;
  RETURN v_due;
END;
$$ LANGUAGE plpgsql;

-- A customer pays a lump sum: it clears their oldest unpaid bills first.
CREATE OR REPLACE FUNCTION record_customer_payment(p_customer_id uuid, p_amount numeric) RETURNS void AS $$
DECLARE
  v_left numeric := p_amount;
  v_bill record;
  v_apply numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter an amount greater than zero'; END IF;
  FOR v_bill IN
    SELECT id, total - amount_paid AS due FROM sales
     WHERE customer_id = p_customer_id AND status = 'completed' AND amount_paid < total
     ORDER BY created_at FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_apply := least(v_left, v_bill.due);
    UPDATE sales SET amount_paid = amount_paid + v_apply WHERE id = v_bill.id;
    v_left := v_left - v_apply;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'Amount is more than the total due for this customer';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ---------- delete a bill from the sales log ----------
-- Removes the bill and its items for good. A completed bill can put its items back into stock
-- (a cancelled bill already did, so there is nothing more to give back).
CREATE OR REPLACE FUNCTION delete_bill(p_sale_id uuid, p_restore_stock boolean DEFAULT true) RETURNS void AS $$
DECLARE
  v_sale record;
  v_item record;
  v_new_stock integer;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;

  IF p_restore_stock AND v_sale.status = 'completed' THEN
    FOR v_item IN
      SELECT product_id, sum(quantity)::integer AS quantity FROM sale_items
       WHERE sale_id = p_sale_id AND product_id IS NOT NULL GROUP BY product_id ORDER BY product_id
    LOOP
      UPDATE products SET stock = stock + v_item.quantity, updated_at = now()
       WHERE id = v_item.product_id RETURNING stock INTO v_new_stock;
      IF FOUND THEN
        INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note)
        VALUES (v_item.product_id, 'sale_cancel', v_item.quantity, v_new_stock,
                'Bill ' || v_sale.bill_number || ' deleted - stock restored');
      END IF;
    END LOOP;
  END IF;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM sales WHERE id = p_sale_id;
END;
$$ LANGUAGE plpgsql;

-- ---------- clear the whole sales log ----------
-- Returns how many bills were removed. Bill numbers start again from INV-000001.
CREATE OR REPLACE FUNCTION clear_sales(p_restore_stock boolean DEFAULT true) RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM sales;

  IF p_restore_stock THEN
    WITH back AS (
      SELECT si.product_id, sum(si.quantity)::int AS q
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND si.product_id IS NOT NULL
       GROUP BY si.product_id
    ), upd AS (
      UPDATE products p SET stock = p.stock + b.q, updated_at = now()
        FROM back b WHERE p.id = b.product_id
      RETURNING p.id AS product_id, b.q AS q, p.stock AS stock
    )
    INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note)
    SELECT product_id, 'sale_cancel', q, stock, 'Sales log cleared - stock restored' FROM upd;
  END IF;

  DELETE FROM sale_items WHERE true;
  DELETE FROM sales WHERE true;
  UPDATE bill_counters SET current_number = 0 WHERE id = 1;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
