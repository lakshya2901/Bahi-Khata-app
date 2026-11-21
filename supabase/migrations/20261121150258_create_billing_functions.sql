/*
# Atomic billing functions

1. Functions
- `create_bill(p_items jsonb, p_customer_id, p_customer_name, p_customer_phone,
  p_discount, p_payment_method, p_notes)` - the entire sale runs as ONE database
  transaction: takes the next bill number, validates every line (product exists,
  not archived, enough stock), computes subtotal, clamps discount to subtotal,
  inserts the sale + line item snapshots, deducts stock with a re-validated atomic
  UPDATE, writes stock movement rows, and updates customer purchase/credit totals.
  Raises an exception (whole sale rolls back) on any validation failure, so stock
  can never be deducted without the bill being saved and vice versa.
- `cancel_bill(p_sale_id)` - restores stock for every line, writes sale_cancel
  stock movements, marks the bill cancelled, reverses customer totals. Never
  deletes the sales record.
2. Security
- EXECUTE granted to anon + authenticated.
*/

CREATE OR REPLACE FUNCTION create_bill(
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT '',
  p_customer_phone text DEFAULT '',
  p_discount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT ''
)
RETURNS jsonb AS $$
DECLARE
  v_sale_id uuid;
  v_counter integer;
  v_bill_number text;
  v_subtotal numeric(14,2) := 0;
  v_item jsonb;
  v_qty integer;
  v_unit_price numeric(12,2);
  v_prod record;
  v_new_stock integer;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item';
  END IF;

  UPDATE bill_counters
     SET current_number = current_number + 1
   WHERE id = 1
   RETURNING current_number INTO v_counter;
  v_bill_number := 'INV-' || lpad(v_counter::text, 6, '0');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit price';
    END IF;

    SELECT p.*, b.name AS brand_text INTO v_prod
      FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found';
    END IF;
    IF v_prod.archived THEN
      RAISE EXCEPTION 'Product % is archived', v_prod.name;
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (available: %, requested: %)', v_prod.name, v_prod.stock, v_qty;
    END IF;

    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  END LOOP;

  IF p_discount IS NULL OR p_discount < 0 THEN
    p_discount := 0;
  END IF;
  IF p_discount > v_subtotal THEN
    p_discount := v_subtotal;
  END IF;

  INSERT INTO sales (bill_number, customer_id, customer_name, customer_phone, subtotal, discount, total, payment_method, notes)
  VALUES (v_bill_number, p_customer_id, coalesce(p_customer_name, ''), coalesce(p_customer_phone, ''),
          v_subtotal, p_discount, v_subtotal - p_discount, p_payment_method, coalesce(p_notes, ''))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;

    SELECT p.*, b.name AS brand_text INTO v_prod
      FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.id = (v_item->>'product_id')::uuid;

    UPDATE products
       SET stock = stock - v_qty, updated_at = now()
     WHERE id = v_prod.id AND stock >= v_qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_prod.name;
    END IF;
    SELECT stock INTO v_new_stock FROM products WHERE id = v_prod.id;

    INSERT INTO sale_items (sale_id, product_id, product_name, product_brand, product_sku, product_unit, quantity, unit_price, purchase_price, line_total)
    VALUES (v_sale_id, v_prod.id, v_prod.name, coalesce(v_prod.brand_text, ''), v_prod.sku, v_prod.unit,
            v_qty, v_unit_price, v_prod.purchase_price, v_qty * v_unit_price);

    INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note, bill_id)
    VALUES (v_prod.id, 'sale', -v_qty, v_new_stock, 'Sale ' || v_bill_number, v_sale_id);
  END LOOP;

  IF p_customer_id IS NOT NULL THEN
    UPDATE customers
       SET total_purchases = total_purchases + (v_subtotal - p_discount),
           bill_count = bill_count + 1,
           outstanding = outstanding + CASE WHEN p_payment_method = 'credit' THEN (v_subtotal - p_discount) ELSE 0 END
     WHERE id = p_customer_id;
  END IF;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'bill_number', v_bill_number, 'total', v_subtotal - p_discount);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cancel_bill(p_sale_id uuid) RETURNS void AS $$
DECLARE
  v_sale record;
  v_item record;
  v_new_stock integer;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;
  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'Bill is already cancelled';
  END IF;

  FOR v_item IN
    SELECT si.*, si.product_id AS pid FROM sale_items si WHERE si.sale_id = p_sale_id
  LOOP
    IF v_item.pid IS NOT NULL THEN
      UPDATE products SET stock = stock + v_item.quantity, updated_at = now() WHERE id = v_item.pid;
      SELECT stock INTO v_new_stock FROM products WHERE id = v_item.pid;
      INSERT INTO stock_movements (product_id, movement_type, quantity_change, resulting_stock, note, bill_id)
      VALUES (v_item.pid, 'sale_cancel', v_item.quantity, v_new_stock,
              'Bill ' || v_sale.bill_number || ' cancelled - stock restored', p_sale_id);
    END IF;
  END LOOP;

  UPDATE sales SET status = 'cancelled' WHERE id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
       SET total_purchases = greatest(total_purchases - v_sale.total, 0),
           bill_count = greatest(bill_count - 1, 0),
           outstanding = greatest(outstanding - CASE WHEN v_sale.payment_method = 'credit' THEN v_sale.total ELSE 0 END, 0)
     WHERE id = v_sale.customer_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION create_bill(jsonb, uuid, text, text, numeric, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_bill(uuid) TO anon, authenticated;