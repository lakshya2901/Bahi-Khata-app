import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Brand, Category, Customer, Product, Sale, Settings, StockMovement,
} from './types';
import { toastError } from '@/components/Toast';

// ---------- http ----------
async function http<T>(method: string, path: string, body?: unknown, params?: Record<string, string | undefined>): Promise<T> {
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()
    : '';
  let res: Response;
  try {
    res = await fetch(`/api/${path}${qs}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. Check your connection.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Something went wrong (error ${res.status})`);
  // A successful reply that is not JSON (e.g. a proxy page) would otherwise crash later as "cannot read properties of null".
  if (data === null) throw new Error('The server sent an unexpected reply. Please try again.');
  return data as T;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

// Results stay in memory for the whole session. A screen that was opened before shows what it had
// straight away and refreshes quietly in the background, so moving around the app feels instant.
const cache = new Map<string, unknown>();

// The everyday lists are also kept in the browser between visits, so after a refresh the app still opens
// instantly (and quietly updates). Customer and sales data is deliberately not stored.
const PERSIST = new Set(['products', 'settings', 'categories', 'brands', 'dashboard:7', 'dashboard:30', 'dashboard:90', 'dashboard:365']);

// Screens showing the same data are kept in step: when one saves a change, the others update too.
const watchers = new Map<string, Set<(value: unknown) => void>>();
// Bump the "-v1" whenever the shape of a cached item changes, so old saved copies are not read back as the new shape.
const STORE_KEY = 'mahaveer-cache-v1';
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>;
  for (const [k, v] of Object.entries(saved)) if (PERSIST.has(k)) cache.set(k, v);
} catch { /* a missing or damaged copy just means a normal first load */ }

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function remember(key: string, value: unknown) {
  cache.set(key, value);
  watchers.get(key)?.forEach((fn) => fn(value));
  if (!PERSIST.has(key)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const out: Record<string, unknown> = {};
      for (const k of PERSIST) if (cache.has(k)) out[k] = cache.get(k);
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch { /* storage full or blocked: not important */ }
  }, 500);
}

interface QueryOptions {
  /** Don't fetch (and don't show a spinner) until true. */
  enabled?: boolean;
  /** Wait this long before fetching after the key changes (e.g. while typing in a search box). */
  debounce?: number;
}

export function useQuery<T>(key: string, fetcher: () => Promise<T>, initial: T, errorLabel: string, opts: QueryOptions = {}) {
  const { enabled = true, debounce = 0 } = opts;
  const cached = cache.get(key) as T | undefined;
  const [data, setData] = useState<T>(cached ?? initial);
  const [loading, setLoading] = useState(enabled && cached === undefined);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;
  const first = useRef(true);

  const load = useCallback(async () => {
    const k = keyRef.current;
    try {
      const fresh = await fetcherRef.current();
      remember(k, fresh);
      if (keyRef.current === k) setData(fresh); // ignore a slow answer for a search the user has already changed
    } catch (e) {
      toastError(`${errorLabel}: ${msg(e)}`);
    } finally {
      if (keyRef.current === k) setLoading(false);
    }
  }, [errorLabel]);

  useEffect(() => {
    const set = watchers.get(key) ?? new Set();
    const listener = (value: unknown) => setData(value as T);
    set.add(listener);
    watchers.set(key, set);
    return () => { set.delete(listener); };
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    const hit = cache.get(key) as T | undefined;
    if (hit !== undefined) {
      setData(hit);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const wait = first.current ? 0 : debounce;
    first.current = false;
    const t = setTimeout(load, wait);
    return () => clearTimeout(t);
  }, [key, enabled, debounce, load]);

  /** Change what is on screen (and in the cache) right away, without asking the server again. */
  const mutate = useCallback((update: (current: T) => T) => {
    setData((current) => {
      const next = update(current);
      remember(keyRef.current, next);
      return next;
    });
  }, []);

  return { data, loading, reload: load, mutate };
}

// ---------- settings ----------
export const fetchSettings = () => http<Settings>('GET', 'settings');

export function useSettings() {
  const { data, loading, reload } = useQuery<Settings | null>('settings', fetchSettings, null, 'Could not load store settings');
  return { settings: data, loading, reload };
}

export async function updateSettings(patch: Partial<Settings>) {
  const saved = await http<Settings>('PUT', 'settings', patch);
  remember('settings', saved); // the sidebar and the other screens pick up the new values straight away
  return saved;
}

/** Sends today's stock / pending-payment report right now. `to` overrides the saved address. */
export const sendTestEmail = (to?: string) => http<{ sent_to: string; subject: string }>('POST', 'email/test', { to });

// ---------- categories & brands ----------
export function useCategories() {
  const { data, loading, reload } = useQuery<Category[]>('categories', () => http('GET', 'categories'), [], 'Could not load categories');
  return { categories: data, loading, reload };
}

export function useBrands() {
  const { data, loading, reload } = useQuery<Brand[]>('brands', () => http('GET', 'brands'), [], 'Could not load brands');
  return { brands: data, loading, reload };
}

export type NamedKind = 'category' | 'brand';
const namedPath = (k: NamedKind) => (k === 'category' ? 'categories' : 'brands');
export const createNamed = (k: NamedKind, name: string) => http('POST', namedPath(k), { name });
export const renameNamed = (k: NamedKind, id: string, name: string) => http('PUT', `${namedPath(k)}/${id}`, { name });
export const deleteNamed = (k: NamedKind, id: string) => http('DELETE', `${namedPath(k)}/${id}`);

// ---------- products ----------
export interface ProductFilters {
  search: string;
  categoryId: string;
  brandId: string;
  stockFilter: 'all' | 'low' | 'out';
  includeArchived: boolean;
}

export const fetchProducts = (includeArchived = false) =>
  http<Product[]>('GET', 'products', undefined, { archived: includeArchived ? 'true' : undefined });

export function useProducts(filters: ProductFilters) {
  const plain = !filters.search.trim() && !filters.categoryId && !filters.brandId && filters.stockFilter === 'all';
  // The everyday list (no search/filters) shares one cache entry with the billing screen.
  const key = plain ? (filters.includeArchived ? 'products:all' : 'products') : `products:${JSON.stringify(filters)}`;
  const { data, loading, reload, mutate } = useQuery<Product[]>(
    key,
    async () => {
      const rows = await http<Product[]>('GET', 'products', undefined, {
        archived: filters.includeArchived ? 'true' : undefined,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        search: filters.search.trim(),
      });
      if (filters.stockFilter === 'low') return rows.filter((p) => p.stock > 0 && p.stock <= p.low_stock_threshold);
      if (filters.stockFilter === 'out') return rows.filter((p) => p.stock === 0);
      return rows;
    },
    [],
    'Could not load products',
    { debounce: 250 }
  );

  /** Show a change to one product immediately. */
  const patchProduct = useCallback(
    (id: string, patch: Partial<Product>) => mutate((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    [mutate]
  );
  /** Add a saved product to the list, or replace it if it is already there. */
  const upsertProduct = useCallback(
    (product: Product) =>
      mutate((list) =>
        list.some((p) => p.id === product.id)
          ? list.map((p) => (p.id === product.id ? product : p))
          : [...list, product].sort((a, b) => a.name.localeCompare(b.name))
      ),
    [mutate]
  );
  const removeProduct = useCallback((id: string) => mutate((list) => list.filter((p) => p.id !== id)), [mutate]);

  return { products: data, loading, reload, patchProduct, upsertProduct, removeProduct };
}

export const createProduct = (values: Record<string, unknown>) => http<Product>('POST', 'products', values);
export const updateProduct = (id: string, values: Record<string, unknown>) => http<Product>('PUT', `products/${id}`, values);
export const archiveProduct = (id: string, archived: boolean) => http<Product>('PUT', `products/${id}`, { archived });
export const deleteProduct = (id: string) => http('DELETE', `products/${id}`);

/**
 * The server applies the change atomically. When units are added with a buying price (`unitCost`) the product's
 * cost becomes the weighted average of the old stock and the new lot. Returns the product's new figures.
 */
export const adjustStock = (
  productId: string,
  type: 'purchase' | 'correction' | 'damage' | 'return',
  quantityChange: number,
  note: string,
  extra?: { unitCost?: number; sellingPrice?: number }
) =>
  http<{ stock: number; purchase_price: number; selling_price: number }>('POST', `products/${productId}/adjust`, {
    type, quantity_change: quantityChange, note, unit_cost: extra?.unitCost, selling_price: extra?.sellingPrice,
  });

// ---------- customers ----------
export function useCustomers(search: string) {
  const { data, loading, reload } = useQuery<Customer[]>(
    `customers:${search.trim()}`,
    () => http('GET', 'customers', undefined, { search: search.trim() }),
    [], 'Could not load customers', { debounce: 250 }
  );
  return { customers: data, loading, reload };
}

export const createCustomer = (values: { name: string; phone?: string | null; address?: string }) =>
  http<Customer>('POST', 'customers', values);
export const updateCustomer = (id: string, values: Partial<Customer>) => http<Customer>('PUT', `customers/${id}`, values);
export const deleteCustomer = (id: string) => http('DELETE', `customers/${id}`);
export const fetchCustomerSales = (id: string) => http<Sale[]>('GET', `customers/${id}/sales`);
export const recordCustomerPayment = (id: string, amount: number) =>
  http<Customer>('POST', `customers/${id}/payment`, { amount });

// ---------- sales ----------
export const fetchSales = (limit: number, extra?: { due?: boolean }) =>
  http<Sale[]>('GET', 'sales', undefined, { limit: String(limit), due: extra?.due ? 'true' : undefined });

export function useSales(filters: { search: string; payment: string; status: string; from: string; to: string; due?: string }) {
  const { data, loading, reload } = useQuery<Sale[]>(
    `sales:${JSON.stringify(filters)}`,
    () => http('GET', 'sales', undefined, { ...filters, search: filters.search.trim() }),
    [], 'Could not load sales', { debounce: 250 }
  );
  return { sales: data, loading, reload };
}

export const createSale = (payload: {
  items: { product_id: string; quantity: number; unit_price: number }[];
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  discount: number;
  payment_method: string;
  notes: string;
  amount_paid?: number;
  idempotency_key: string;
}) => http<{ sale_id: string; bill_number: string; total: number; duplicate: boolean; sale: Sale }>('POST', 'sales', payload);

/** Money received against one bill. */
export const recordBillPayment = (saleId: string, amount: number) =>
  http<{ amount_due: number }>('POST', `sales/${saleId}/payment`, { amount });

/** Removes one bill from the sales log for good. Optionally puts its items back into stock. */
export const deleteSale = (saleId: string, restoreStock: boolean) =>
  http('DELETE', `sales/${saleId}`, undefined, { restore: String(restoreStock) });

/** Wipes the whole sales log (the caller must pass the word DELETE). */
export const clearSales = (restoreStock: boolean) =>
  http<{ deleted: number }>('DELETE', 'sales', undefined, { confirm: 'DELETE', restore: String(restoreStock) });

export const cancelSale = (saleId: string) => http('POST', `sales/${saleId}/cancel`);

// ---------- stock movements ----------
export const fetchStockMovements = (limit: number) =>
  http<StockMovement[]>('GET', 'stock-movements', undefined, { limit: String(limit) });

/** Stock history for one product. Nothing is downloaded until `enabled` (e.g. the history window is open). */
export function useStockMovements(productId: string | undefined, enabled = true) {
  const { data, loading, reload } = useQuery<StockMovement[]>(
    `movements:${productId ?? 'all'}`,
    () => http('GET', 'stock-movements', undefined, { product_id: productId }),
    [], 'Could not load stock history', { enabled }
  );
  return { movements: data, loading, reload };
}

// ---------- dashboard ----------
export interface DashboardData {
  days: number;
  kpis: {
    revenue: number; profit: number; bills: number; today_revenue: number; today_bills: number; to_collect: number;
    out_count: number; low_count: number; inventory_cost: number; inventory_retail: number;
  };
  series: { d: string; revenue: number; profit: number; bills: number }[];
  payments: { method: string; revenue: number; bills: number }[];
  top: { name: string; qty: number; revenue: number; profit: number }[];
  categories: { name: string; revenue: number }[];
  alerts: { id: string; name: string; sku: string; stock: number; unit: string }[];
  owing: { name: string; phone: string | null; due: number; bills: number }[];
  recent: { id: string; bill_number: string; customer_name: string; created_at: string; total: number; payment_method: string; amount_due: number }[];
}

const browserZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'Asia/Kolkata'; }
};

export function useDashboard(days: number) {
  const { data, loading, reload } = useQuery<DashboardData | null>(
    `dashboard:${days}`,
    () => http<DashboardData>('GET', 'dashboard', undefined, { tz: browserZone(), days: String(days) }),
    null, 'Could not load dashboard'
  );
  return { dashboard: data, loading, reload };
}
