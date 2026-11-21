/*
# SKU auto-generation trigger

1. Functions
- `generate_sku()` trigger function: when a new product is inserted without a SKU,
  generates one from the first 3 letters of the product name plus a zero-padded
  sequence number (e.g. SHA-0001), guaranteeing uniqueness via retry loop.
2. Notes
- Safe to re-run (drops/recreates trigger + function).
*/

CREATE OR REPLACE FUNCTION generate_sku() RETURNS trigger AS $$
DECLARE
  prefix text;
  next_num integer;
BEGIN
  IF NEW.sku IS NOT NULL AND NEW.sku <> '' THEN
    RETURN NEW;
  END IF;
  prefix := upper(left(regexp_replace(coalesce(NEW.name, ''), '[^A-Za-z]', '', 'g'), 3));
  IF prefix IS NULL OR prefix = '' THEN prefix := 'PRD'; END IF;
  LOOP
    SELECT coalesce(max(nullif(regexp_replace(substring(sku from length(prefix) + 1), '[^0-9]', '', 'g'), '')::integer), 0) + 1
      INTO next_num
      FROM products
     WHERE sku LIKE prefix || '%' AND substring(sku from length(prefix) + 1) ~ '^[0-9]+$';
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM products WHERE sku = prefix || lpad(next_num::text, 4, '0')
    );
  END LOOP;
  NEW.sku := prefix || lpad(next_num::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_sku ON products;
CREATE TRIGGER trg_generate_sku
BEFORE INSERT ON products
FOR EACH ROW EXECUTE FUNCTION generate_sku();