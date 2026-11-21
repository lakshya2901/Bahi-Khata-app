export type PaymentMethod = 'cash' | 'upi' | 'card' | 'credit';

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  sku: string;
  mrp: number | null;
  size: string;
  purchase_price: number;
  selling_price: number;
  stock: number;
  unit: string;
  low_stock_threshold: number;
  expiry_date: string | null;
  archived: boolean;
  brands?: { name: string } | null;
  categories?: { name: string } | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  total_purchases: number;
  bill_count: number;
  outstanding: number;
  cost: number;
  profit: number;
  created_at: string;
}

export interface Sale {
  id: string;
  bill_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  amount_due: number;
  cost: number;
  profit: number;
  payment_method: PaymentMethod;
  status: 'completed' | 'cancelled';
  notes: string;
  created_at: string;
  sale_items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  product_brand: string;
  product_sku: string;
  product_unit: string;
  quantity: number;
  unit_price: number;
  purchase_price: number;
  mrp: number | null;
  line_total: number;
}

export interface StockMovement {
  id: string;
  product_id: string;
  movement_type: 'purchase' | 'sale' | 'correction' | 'damage' | 'return' | 'sale_cancel';
  quantity_change: number;
  resulting_stock: number;
  note: string;
  bill_id: string | null;
  unit_cost: number | null;
  cost_after: number | null;
  created_at: string;
  products?: { name: string; sku: string; unit: string } | null;
}

export interface Settings {
  id: number;
  store_name: string;
  store_subtitle: string;
  store_phone: string;
  store_address: string;
  store_gstin: string;
  email_enabled: boolean;
  email_to: string;
  email_time: string;
  email_tz: string;
  email_last_sent: string | null;
  email_last_error: string;
  /** True when the sending Gmail account is set up in .env on the server. */
  email_configured?: boolean;
  default_discount: number;
  receipt_format: 'thermal' | 'a4';
  low_stock_default: number;
  currency: string;
  updated_at: string;
}
