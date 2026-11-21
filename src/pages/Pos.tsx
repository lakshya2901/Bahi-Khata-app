import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, ReceiptText,
  ArrowLeft, ChevronRight, Layers, Tag,
} from 'lucide-react';
import { PageHeader } from '@/components/Page';
import { TextInput, EmptyState } from '@/components/Form';
import { toastSuccess, toastError } from '@/components/Toast';
import { createSale, useCategories, useCustomers, useProducts, useSettings } from '@/lib/api';
import { currentTag, goBack, parseHash, setParams, useHash } from '@/lib/nav';
import { Breadcrumb, TileGroup, ViewToggle, useDrillDown, useViewMode, type ViewMode } from '@/components/Catalogue';
import { formatMoney } from '@/lib/format';
import { ReceiptModal } from '@/components/Invoice';
import type { Product, Sale, PaymentMethod } from '@/lib/types';

interface CartLine {
  product: Product;
  quantity: number;
  /** Selling price for this bill. Starts at the listed price; the owner can change it per line. */
  price: string;
  /** Discount % off the MRP. Always kept in step with `price`: change either one and the other follows. */
  disc: string;
}

const ALL_ACTIVE = { search: '', categoryId: '', brandId: '', stockFilter: 'all', includeArchived: false } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The printed MRP, or null when the product has none (then there is no discount to show). */
const mrpOfProduct = (p: Product): number | null => (p.mrp !== null && Number(p.mrp) > 0 ? Number(p.mrp) : null);
const mrpOf = (l: CartLine) => mrpOfProduct(l.product);

/** Discount % that a given selling price represents off the MRP ("" when there is no MRP or no price). */
function discFromPrice(mrp: number | null, price: string): string {
  const p = Number(price);
  if (!mrp || price === '' || !Number.isFinite(p)) return '';
  return String(round2(((mrp - p) / mrp) * 100));
}

const linePrice = (l: CartLine) => {
  const n = Number(l.price);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// The bill being made is kept for this browser tab, so pressing Back or refreshing does not lose it.
const DRAFT_KEY = 'mahaveer-bill-draft-v1';

interface Draft {
  lines: { id: string; quantity: number; price: string }[];
  customerName: string;
  customerPhone: string;
  discountInput: string;
  discountIsPercent: boolean;
  payment: PaymentMethod;
  paidNow: string;
}

function readDraft(): Draft | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
    return d && Array.isArray(d.lines) ? (d as Draft) : null;
  } catch {
    return null;
  }
}

export function PosPage() {
  const [draft] = useState(readDraft);
  // Which screen we are on lives in the address (#/pos?step=cart), so Back returns to the products.
  const { params } = parseHash(useHash());
  const step: 'shop' | 'cart' = params.get('step') === 'cart' ? 'cart' : 'shop';
  const openCart = () => setParams({ step: 'cart' }, { tag: 'cart-from-shop' });
  const backToShop = () => (currentTag() === 'cart-from-shop' ? goBack() : setParams({ step: null }, { replace: true }));
  const [search, setSearch] = useState('');
  const [view, changeView] = useViewMode();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountInput, setDiscountInput] = useState(draft?.discountInput ?? '');
  const [discountIsPercent, setDiscountIsPercent] = useState(draft?.discountIsPercent ?? false);
  const [customerName, setCustomerName] = useState(draft?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(draft?.customerPhone ?? '');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>(draft?.payment ?? 'cash');
  const [paidNow, setPaidNow] = useState(draft?.paidNow ?? '');
  const { customers: knownCustomers } = useCustomers('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  // Products and settings are kept in memory, so opening this screen again is instant.
  const { products, loading, reload: reloadProducts, patchProduct } = useProducts(ALL_ACTIVE);
  const { categories } = useCategories();
  const { settings } = useSettings();

  // One key per bill attempt: if the same bill is submitted twice, the server returns the first one.
  const billKey = useRef(crypto.randomUUID());
  const inFlight = useRef(false);

  const searching = search.trim() !== '';
  const { catKey, setCatKey, brandKey, setBrandKey, categoryTiles, brandTiles, lines, catName, brandName } =
    useDrillDown(products, categories, false);

  // Latest stock for each product, and how many of each are already in the bill.
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const qtyOf = useMemo(() => new Map(cart.map((l) => [l.product.id, l.quantity])), [cart]);
  const stockOf = (l: CartLine) => byId.get(l.product.id)?.stock ?? l.product.stock;
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);

  // Bring back a bill that was in progress (after Back or a refresh); stock is checked against the latest numbers.
  const [ready, setReady] = useState(() => !draft || draft.lines.length === 0);
  useEffect(() => {
    if (ready || products.length === 0) return;
    const lines = (draft?.lines ?? []).flatMap((d) => {
      const p = byId.get(d.id);
      return p && p.stock > 0
        ? [{ product: p, quantity: Math.min(d.quantity, p.stock), price: d.price, disc: discFromPrice(mrpOfProduct(p), d.price) }]
        : [];
    });
    if (lines.length) setCart(lines);
    setReady(true);
  }, [ready, products.length, byId, draft]);

  useEffect(() => {
    if (!ready) return;
    const empty = cart.length === 0 && !customerName && !customerPhone && !discountInput;
    if (empty) {
      sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    const saved: Draft = {
      lines: cart.map((l) => ({ id: l.product.id, quantity: l.quantity, price: l.price })),
      customerName, customerPhone, discountInput, discountIsPercent, payment, paidNow,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(saved));
  }, [ready, cart, customerName, customerPhone, discountInput, discountIsPercent, payment, paidNow]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        (p.brands?.name ?? '').toLowerCase().includes(term))
      // Things you can actually sell come first.
      .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0));
  }, [products, search]);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * linePrice(l), 0), [cart]);
  const costTotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * Number(l.product.purchase_price), 0), [cart]);
  // What the items add up to at MRP, and how much of that has been given away per item.
  const mrpTotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * (mrpOf(l) ?? linePrice(l)), 0), [cart]);
  const mrpSavings = useMemo(
    () => cart.reduce((s, l) => { const m = mrpOf(l); return m ? s + Math.max(0, l.quantity * (m - linePrice(l))) : s; }, 0),
    [cart]
  );

  const discount = useMemo(() => {
    let d = Number(discountInput || 0);
    if (discountIsPercent) d = (subtotal * d) / 100;
    if (!isFinite(d) || d < 0) d = 0;
    return Math.min(d, subtotal);
  }, [discountInput, discountIsPercent, subtotal]);

  const total = subtotal - discount;
  const profit = total - costTotal;
  const isCredit = payment === 'credit';
  const paidAmount = isCredit ? Math.min(Math.max(Number(paidNow) || 0, 0), total) : total;
  const balanceDue = total - paidAmount;

  const addOne = (p: Product) => {
    if (p.stock === 0) return toastError(`${p.name} is out of stock`);
    setCart((c) => {
      const existing = c.find((l) => l.product.id === p.id);
      if (existing) {
        if (existing.quantity >= p.stock) {
          toastError(`Only ${p.stock} ${p.unit} in stock`);
          return c;
        }
        return c.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...c, { product: p, quantity: 1, price: String(p.selling_price), disc: discFromPrice(mrpOfProduct(p), String(p.selling_price)) }];
    });
  };

  /** One fewer; the product leaves the cart when it reaches zero. */
  const removeOne = (p: Product) =>
    setCart((c) =>
      c.flatMap((l) => {
        if (l.product.id !== p.id) return [l];
        return l.quantity <= 1 ? [] : [{ ...l, quantity: l.quantity - 1 }];
      })
    );

  const setQty = (l: CartLine, qty: number) =>
    setCart((c) => c.map((x) => (x.product.id === l.product.id ? { ...x, quantity: Math.max(1, Math.min(qty, stockOf(l))) } : x)));

  // Price and discount % move together: type one and the other is worked out from the MRP.
  const setPrice = (productId: string, price: string) =>
    setCart((c) => c.map((l) => (l.product.id === productId ? { ...l, price, disc: discFromPrice(mrpOf(l), price) } : l)));

  const setDisc = (productId: string, value: string) =>
    setCart((c) =>
      c.map((l) => {
        const mrp = mrpOf(l);
        if (l.product.id !== productId || !mrp) return l;
        if (value === '') return { ...l, disc: '', price: String(mrp) };
        const typed = Number(value);
        if (!Number.isFinite(typed)) return l;
        const d = Math.min(100, Math.max(0, typed));
        return { ...l, disc: typed > 100 ? '100' : value, price: String(round2(mrp * (1 - d / 100))) };
      })
    );

  const removeLine = (productId: string) => setCart((c) => c.filter((l) => l.product.id !== productId));

  const submitBill = async () => {
    if (cart.length === 0) return toastError('Add at least one product to the bill');
    if (cart.some((l) => l.price === '' || !(Number(l.price) >= 0))) return toastError('Enter a selling price for every item');
    if (isCredit && !customerName.trim() && !customerPhone.trim()) {
      return toastError('Enter the customer name or phone so the balance can be collected later');
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await createSale({
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity, unit_price: linePrice(l) })),
        customer_id: customerId,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        discount: discount,
        payment_method: payment,
        notes: '',
        amount_paid: isCredit ? paidAmount : undefined,
        idempotency_key: billKey.current,
      });

      setReceipt(result.sale);
      billKey.current = crypto.randomUUID();

      setCart([]);
      setDiscountInput('');
      setCustomerName('');
      setCustomerPhone('');
      setCustomerId(null);
      setPayment('cash');
      setPaidNow('');
      for (const line of cart) patchProduct(line.product.id, { stock: stockOf(line) - line.quantity });
      toastSuccess(`Bill ${result.bill_number} created`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not create bill');
      reloadProducts(); // stock may have changed; show the latest numbers
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const newBill = () => {
    setReceipt(null);
    setParams({ step: null }, { replace: true });
  };

  const shop = (items: Product[], title: (p: Product) => string, subtitle: (p: Product) => string) => (
    <ShopGroup items={items} view={view} title={title} subtitle={subtitle} qtyOf={qtyOf} onAdd={addOne} onRemove={removeOne} />
  );

  // ============================ CART / CHECKOUT ============================
  if (step === 'cart') {
    return (
      <div>
        <PageHeader
          title="Your Bill"
          subtitle={`${cart.length} product${cart.length === 1 ? '' : 's'} · ${cartCount} item${cartCount === 1 ? '' : 's'}`}
          actions={
            <button
              onClick={backToShop}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft size={16} /> Add more products
            </button>
          }
        />

        {cart.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <EmptyState icon={<ShoppingCart size={36} />} title="Your bill is empty" message="Go back and tap Add on the products you are selling." />
            <div className="flex justify-center pb-6">
              <button onClick={backToShop} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white">Browse products</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 items-start">
            {/* Everything added so far */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
              {cart.map((l) => {
                const left = stockOf(l) - l.quantity;
                const belowCost = linePrice(l) < Number(l.product.purchase_price);
                const mrp = mrpOf(l);
                const aboveMrp = mrp !== null && linePrice(l) > mrp + 0.004;
                return (
                  <div key={l.product.id} className="px-4 py-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="text-sm font-semibold text-gray-900">{l.product.name}</div>
                      <div className="text-xs text-gray-500">
                        {l.product.brands?.name ?? 'No brand'} ·{' '}
                        <span className={left === 0 ? 'text-amber-700 font-medium' : ''}>{left} left in stock</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <QtyBtn onClick={() => (l.quantity <= 1 ? removeLine(l.product.id) : setQty(l, l.quantity - 1))}><Minus size={14} /></QtyBtn>
                      <input
                        type="number"
                        min={1}
                        max={stockOf(l)}
                        value={l.quantity}
                        onChange={(e) => setQty(l, Number(e.target.value) || 1)}
                        className="w-14 text-center text-sm border border-gray-300 rounded-lg py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-700"
                      />
                      <QtyBtn onClick={() => setQty(l, l.quantity + 1)}><Plus size={14} /></QtyBtn>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-end gap-3 text-[11px] text-gray-500">
                        {mrp !== null && (
                          <>
                            <div className="text-right">
                              MRP
                              <div className="text-sm text-gray-700 tabular-nums py-1.5">{formatMoney(mrp)}</div>
                            </div>
                            <label className="flex flex-col items-end">
                              Discount %
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                inputMode="decimal"
                                value={l.disc}
                                onChange={(e) => setDisc(l.product.id, e.target.value)}
                                className="w-20 text-right text-sm text-gray-900 border border-gray-300 rounded-lg py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-700"
                              />
                            </label>
                          </>
                        )}
                        <label className="flex flex-col items-end">
                          Price ₹ each
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={l.price}
                            onChange={(e) => setPrice(l.product.id, e.target.value)}
                            className="w-24 text-right text-sm text-gray-900 border border-gray-300 rounded-lg py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-700"
                          />
                        </label>
                      </div>
                      {belowCost && <span className="text-[11px] text-amber-700 font-medium">Below your cost</span>}
                      {aboveMrp && <span className="text-[11px] text-amber-700 font-medium">Above the printed MRP</span>}
                      {mrp !== null && !aboveMrp && Number(l.disc) > 0 && (
                        <span className="text-[11px] text-emerald-700">Customer saves {formatMoney(l.quantity * (mrp - linePrice(l)))}</span>
                      )}
                    </div>

                    <div className="w-24 text-right text-sm font-semibold text-gray-900 tabular-nums">{formatMoney(l.quantity * linePrice(l))}</div>

                    <button onClick={() => removeLine(l.product.id)} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove from bill" title="Remove">
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Customer, discount, how they paid */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4 lg:sticky lg:top-4">
              <div>
                <div className="text-xs font-medium text-gray-700 mb-1.5">Customer</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                  <TextInput
                    list="known-customers"
                    placeholder="Name"
                    value={customerName}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCustomerName(v);
                      // Picking a saved customer from the suggestions fills in their phone too.
                      const match = knownCustomers.find((c) => c.name.toLowerCase() === v.trim().toLowerCase());
                      setCustomerId(match?.id ?? null);
                      if (match?.phone) setCustomerPhone(match.phone);
                    }}
                  />
                  <datalist id="known-customers">
                    {knownCustomers.map((c) => <option key={c.id} value={c.name}>{c.phone ?? ''}</option>)}
                  </datalist>
                  <TextInput type="tel" inputMode="tel" placeholder="Phone number" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                </div>
                <div className="text-[11px] text-gray-400 mt-1">Optional for walk-in customers.</div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-700 mb-1.5">Discount</div>
                <div className="flex gap-2">
                  <TextInput
                    type="number"
                    min="0"
                    inputMode="decimal"
                    placeholder="0"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    className="flex-1"
                  />
                  <button
                    onClick={() => setDiscountIsPercent((v) => !v)}
                    className={`px-4 rounded-lg border text-sm font-medium transition-colors ${discountIsPercent ? 'bg-brand-50 border-brand-600 text-brand-700' : 'border-gray-300 text-gray-600'}`}
                    title="Switch between rupees and percent"
                  >
                    {discountIsPercent ? '%' : '₹'}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-700 mb-1.5">How did they pay?</div>
                <div className="grid grid-cols-2 gap-2">
                  {([['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['credit', 'Not paid yet']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setPayment(id)}
                      className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        payment === id
                          ? id === 'credit' ? 'bg-amber-50 border-amber-500 text-amber-800' : 'bg-brand-50 border-brand-600 text-brand-800'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {isCredit && (
                  <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                    <label className="block text-xs font-medium text-amber-900">
                      Received now (optional)
                      <TextInput
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="0 — nothing received yet"
                        value={paidNow}
                        onChange={(e) => setPaidNow(e.target.value)}
                        className="mt-1"
                      />
                    </label>
                    <div className="text-xs text-amber-800">
                      Customer still has to pay <strong className="tabular-nums">{formatMoney(balanceDue)}</strong>. It will show in Pending Payments.
                    </div>
                  </div>
                )}
              </div>

              <div className="text-sm space-y-1 pt-3 border-t border-gray-100">
                {mrpSavings > 0.004 && (
                  <>
                    <Row label="Total at MRP" value={formatMoney(mrpTotal)} />
                    <Row label="Discount on MRP" value={`− ${formatMoney(mrpSavings)}`} />
                  </>
                )}
                <Row label="Subtotal" value={formatMoney(subtotal)} />
                {discount > 0 && <Row label={mrpSavings > 0.004 ? 'Extra discount on bill' : 'Discount'} value={`− ${formatMoney(discount)}`} />}
                <div className="flex justify-between pt-1 border-t border-gray-100">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="font-bold text-brand-800 tabular-nums text-lg">{formatMoney(total)}</span>
                </div>
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-gray-400">Your profit on this bill (not printed)</span>
                  <span className={`tabular-nums font-medium ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatMoney(profit)}</span>
                </div>
              </div>

              <button
                onClick={submitBill}
                disabled={submitting}
                className="w-full py-3.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <ReceiptText size={16} />
                {submitting ? 'Saving…' : `Generate Bill · ${formatMoney(total)}`}
              </button>
            </div>
          </div>
        )}

        {receipt && <ReceiptModal sale={receipt} store={settings} onClose={newBill} />}
      </div>
    );
  }

  // ============================ BROWSE & ADD ============================
  return (
    <div>
      <PageHeader
        title="Create Bill"
        subtitle="Tap Add on the products being sold, then open the bill"
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle view={view} onChange={changeView} />
            <button
              onClick={openCart}
              className="relative inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              aria-label={`Open bill, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
              title="Open bill"
            >
              <ShoppingCart size={18} className={cartCount > 0 ? 'text-brand-700' : 'text-gray-500'} />
              <span className="hidden sm:inline">{cartCount > 0 ? formatMoney(subtotal) : 'Bill'}</span>
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-gold-500 text-brand-900 text-[11px] font-bold flex items-center justify-center tabular-nums">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        }
      />

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <TextInput
          placeholder="Search product by name, brand or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {!searching && (
        <Breadcrumb
          catKey={catKey} brandKey={brandKey} catName={catName} brandName={brandName}
          onAll={() => { setCatKey(null); setBrandKey(null); }}
          onCategory={() => setBrandKey(null)}
        />
      )}

      {loading && products.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-12">Loading products…</div>
      ) : searching ? (
        matches.length === 0 ? (
          <EmptyState icon={<ShoppingCart size={36} />} title="No products found" message="Try a different search." />
        ) : (
          shop(matches.slice(0, 60), (p) => p.name, (p) => `${p.brands?.name ?? 'No brand'} · ${p.sku}`)
        )
      ) : !catKey ? (
        <TileGroup tiles={categoryTiles} view={view} icon={<Layers size={18} />} emptyHint="No products yet — add some in Inventory first." onOpen={(k) => setCatKey(k)} />
      ) : !brandKey ? (
        <TileGroup tiles={brandTiles} view={view} icon={<Tag size={18} />} emptyHint="No products in this category yet." onOpen={(k) => setBrandKey(k)} />
      ) : (
        <div className="space-y-6">
          {lines.map(([line, items]) => (
            <section key={line}>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 truncate">{line}</h3>
              {shop(items, (p) => p.size || 'Standard', () => '')}
            </section>
          ))}
        </div>
      )}

      {/* Always one tap away once something is added */}
      {cartCount > 0 && (
        <div className="sticky bottom-4 mt-6 z-20">
          <button
            onClick={openCart}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 rounded-xl bg-brand-700 hover:bg-brand-800 text-white shadow-lg transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingCart size={18} />
              View bill · {cartCount} item{cartCount === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-2 text-base font-bold tabular-nums">
              {formatMoney(subtotal)} <ChevronRight size={18} />
            </span>
          </button>
        </div>
      )}

      {receipt && <ReceiptModal sale={receipt} store={settings} onClose={newBill} />}
    </div>
  );
}

/** Products as blocks or rows: just the price, how many are left, and add / minus / plus. */
function ShopGroup({ items, view, title, subtitle, qtyOf, onAdd, onRemove }: {
  items: Product[]; view: ViewMode;
  title: (p: Product) => string; subtitle: (p: Product) => string;
  qtyOf: Map<string, number>; onAdd: (p: Product) => void; onRemove: (p: Product) => void;
}) {
  const control = (p: Product) => {
    const qty = qtyOf.get(p.id) ?? 0;
    if (p.stock === 0) return <span className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-50 text-red-700">Out of stock</span>;
    if (qty === 0) {
      return (
        <button onClick={() => onAdd(p)} className="px-5 py-2 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold transition-colors">
          Add
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <QtyBtn onClick={() => onRemove(p)}><Minus size={16} /></QtyBtn>
        <span className="w-8 text-center text-sm font-bold text-gray-900 tabular-nums">{qty}</span>
        <button
          onClick={() => onAdd(p)}
          disabled={qty >= p.stock}
          className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40"
          aria-label="One more"
        >
          <Plus size={16} />
        </button>
      </div>
    );
  };

  const left = (p: Product) => {
    const remaining = p.stock - (qtyOf.get(p.id) ?? 0);
    return (
      <span className={`text-xs ${p.stock === 0 ? 'text-red-600' : remaining <= p.low_stock_threshold ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
        {p.stock === 0 ? 'None left' : `${remaining} left`}
      </span>
    );
  };

  if (view === 'list') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {items.map((p) => (
          <div key={p.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${p.stock === 0 ? 'opacity-60' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{title(p)}</div>
              {subtitle(p) && <div className="text-xs text-gray-500 truncate">{subtitle(p)}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold text-gray-900 tabular-nums">{formatMoney(p.selling_price)}</div>
              {left(p)}
            </div>
            <div className="shrink-0 w-[8.5rem] flex justify-end">{control(p)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {items.map((p) => (
        <div
          key={p.id}
          className={`bg-white rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
            (qtyOf.get(p.id) ?? 0) > 0 ? 'border-brand-600 bg-brand-50/30' : 'border-gray-200'
          } ${p.stock === 0 ? 'opacity-60' : ''}`}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate" title={title(p)}>{title(p)}</div>
            {subtitle(p) && <div className="text-xs text-gray-500 truncate">{subtitle(p)}</div>}
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-base font-bold text-gray-900 tabular-nums">{formatMoney(p.selling_price)}</div>
              {left(p)}
            </div>
            {control(p)}
          </div>
        </div>
      ))}
    </div>
  );
}

function QtyBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="tabular-nums text-gray-800">{value}</span>
    </div>
  );
}
