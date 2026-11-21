/*
# RLS policies for all store tables

Single-tenant store app with no sign-in: data is intentionally shared across the
store owner's devices, so every policy targets `anon, authenticated` and permits
the full CRUD the app performs. RLS stays enabled; these policies define exactly
what the anon-key frontend can do.
*/

-- settings
DROP POLICY IF EXISTS "settings readable" ON settings;
CREATE POLICY "settings readable" ON settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "settings updatable" ON settings;
CREATE POLICY "settings updatable" ON settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- categories
DROP POLICY IF EXISTS "categories select" ON categories;
CREATE POLICY "categories select" ON categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "categories insert" ON categories;
CREATE POLICY "categories insert" ON categories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "categories update" ON categories;
CREATE POLICY "categories update" ON categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "categories delete" ON categories;
CREATE POLICY "categories delete" ON categories FOR DELETE TO anon, authenticated USING (true);

-- brands
DROP POLICY IF EXISTS "brands select" ON brands;
CREATE POLICY "brands select" ON brands FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "brands insert" ON brands;
CREATE POLICY "brands insert" ON brands FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "brands update" ON brands;
CREATE POLICY "brands update" ON brands FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "brands delete" ON brands;
CREATE POLICY "brands delete" ON brands FOR DELETE TO anon, authenticated USING (true);

-- products
DROP POLICY IF EXISTS "products select" ON products;
CREATE POLICY "products select" ON products FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "products insert" ON products;
CREATE POLICY "products insert" ON products FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "products update" ON products;
CREATE POLICY "products update" ON products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "products delete" ON products;
CREATE POLICY "products delete" ON products FOR DELETE TO anon, authenticated USING (true);

-- customers
DROP POLICY IF EXISTS "customers select" ON customers;
CREATE POLICY "customers select" ON customers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "customers insert" ON customers;
CREATE POLICY "customers insert" ON customers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "customers update" ON customers;
CREATE POLICY "customers update" ON customers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "customers delete" ON customers;
CREATE POLICY "customers delete" ON customers FOR DELETE TO anon, authenticated USING (true);

-- sales
DROP POLICY IF EXISTS "sales select" ON sales;
CREATE POLICY "sales select" ON sales FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "sales insert" ON sales;
CREATE POLICY "sales insert" ON sales FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sales update" ON sales;
CREATE POLICY "sales update" ON sales FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sales delete" ON sales;
CREATE POLICY "sales delete" ON sales FOR DELETE TO anon, authenticated USING (true);

-- sale_items
DROP POLICY IF EXISTS "sale_items select" ON sale_items;
CREATE POLICY "sale_items select" ON sale_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "sale_items insert" ON sale_items;
CREATE POLICY "sale_items insert" ON sale_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sale_items update" ON sale_items;
CREATE POLICY "sale_items update" ON sale_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sale_items delete" ON sale_items;
CREATE POLICY "sale_items delete" ON sale_items FOR DELETE TO anon, authenticated USING (true);

-- stock_movements
DROP POLICY IF EXISTS "stock_movements select" ON stock_movements;
CREATE POLICY "stock_movements select" ON stock_movements FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "stock_movements insert" ON stock_movements;
CREATE POLICY "stock_movements insert" ON stock_movements FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "stock_movements update" ON stock_movements;
CREATE POLICY "stock_movements update" ON stock_movements FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "stock_movements delete" ON stock_movements;
CREATE POLICY "stock_movements delete" ON stock_movements FOR DELETE TO anon, authenticated USING (true);

-- bill_counters is SELECT-only for the app (the billing function updates it server-side)