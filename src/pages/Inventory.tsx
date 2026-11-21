import { useState, type ReactNode } from 'react';
import {
  Plus, Search, Pencil, Trash2, PackagePlus, RotateCcw, PackageX,
  Layers, Tag,
} from 'lucide-react';
import { PageHeader, Card } from '@/components/Page';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field, TextInput, Select, EmptyState } from '@/components/Form';
import { toastSuccess, toastError } from '@/components/Toast';
import {
  useProducts, useCategories, useBrands,
  createProduct, updateProduct, deleteProduct, archiveProduct, adjustStock,
  type ProductFilters,
} from '@/lib/api';
import { formatMoney, formatDate, UNITS } from '@/lib/format';
import type { Product } from '@/lib/types';
import {
  Breadcrumb, TileGroup, ViewToggle, isLow, lineName, useDrillDown, useViewMode, type ViewMode,
} from '@/components/Catalogue';

interface ProductFormState {
  name: string; size: string; brand_id: string; category_id: string; sku: string;
  mrp: string; discount: string;
  purchase_price: string; selling_price: string; stock: string; unit: string;
  low_stock_threshold: string; expiry_date: string;
}

const emptyForm: ProductFormState = {
  name: '', size: '', brand_id: '', category_id: '', sku: '',
  mrp: '', discount: '', purchase_price: '', selling_price: '', stock: '0', unit: 'piece',
  low_stock_threshold: '5', expiry_date: '',
};

/** What gets saved as the product name: the line plus its size. */
function composeName(base: string, size: string): string {
  const b = base.trim(), z = size.trim();
  if (!z || b.toLowerCase().endsWith(z.toLowerCase())) return b;
  return `${b} ${z}`;
}

// Cost = MRP less the supplier's discount. Only fills in when both numbers are present.
function costFrom(mrp: string, discount: string, current: string): { purchase_price: string } {
  const m = Number(mrp), d = Number(discount);
  if (mrp === '' || discount === '' || !Number.isFinite(m) || !Number.isFinite(d)) return { purchase_price: current };
  return { purchase_price: (Math.round(m * (1 - d / 100) * 100) / 100).toString() };
}

export function InventoryPage() {
  const [filters, setFilters] = useState<ProductFilters>({
    search: '', categoryId: '', brandId: '', stockFilter: 'all', includeArchived: false,
  });
  const { products, loading, patchProduct, upsertProduct, removeProduct } = useProducts(filters);
  const { categories } = useCategories();
  const { brands } = useBrands();

  const [view, changeView] = useViewMode();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Quick stock update: tap the stock figure on any product.
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [stockMode, setStockMode] = useState<StockMode>('add');
  const [stockQty, setStockQty] = useState('');
  const [stockNote, setStockNote] = useState('');
  const [stockCost, setStockCost] = useState('');   // what the new lot cost per unit
  const [stockSell, setStockSell] = useState('');   // optionally a new selling price

  // Quick price change: tap the cost or the selling figure on any product.
  const [priceFor, setPriceFor] = useState<Product | null>(null);
  const [priceCost, setPriceCost] = useState('');
  const [priceSell, setPriceSell] = useState('');

  const [deleting, setDeleting] = useState<Product | null>(null);

  const searching = filters.search.trim() !== '';
  const filtering = filters.stockFilter !== 'all';
  const { catKey, setCatKey, brandKey, setBrandKey, categoryTiles, brandTiles, lines, catName, brandName } =
    useDrillDown(products, categories, filtering);

  const openAdd = (prefill?: { category_id?: string; brand_id?: string; name?: string }) => {
    setEditing(null);
    const here = {
      category_id: prefill?.category_id ?? (catKey && catKey !== 'none' ? catKey : ''),
      brand_id: prefill?.brand_id ?? (brandKey && brandKey !== 'none' ? brandKey : ''),
    };
    setForm({ ...emptyForm, ...here, name: prefill?.name ?? '', low_stock_threshold: '5' });
    setFormOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: lineName(p), size: p.size ?? '', brand_id: p.brand_id ?? '', category_id: p.category_id ?? '',
      sku: p.sku, mrp: p.mrp === null ? '' : String(p.mrp), discount: '',
      purchase_price: String(p.purchase_price), selling_price: String(p.selling_price),
      stock: String(p.stock), unit: p.unit, low_stock_threshold: String(p.low_stock_threshold),
      expiry_date: p.expiry_date ?? '',
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.name.trim()) return toastError('Product name is required');
    if (form.selling_price === '' || Number(form.selling_price) < 0) return toastError('Enter a valid selling price');
    const stockNow = Number(form.stock || 0);
    if (!Number.isInteger(stockNow) || stockNow < 0) return toastError('Stock must be a whole number, 0 or more');
    setSaving(true);
    try {
      const values = {
        name: composeName(form.name, form.size),
        size: form.size.trim(),
        brand_id: form.brand_id || null,
        category_id: form.category_id || null,
        sku: form.sku.trim() || '',
        mrp: form.mrp === '' ? null : Number(form.mrp),
        purchase_price: Number(form.purchase_price || 0),
        selling_price: Number(form.selling_price),
        stock: Number(form.stock || 0),
        unit: form.unit,
        low_stock_threshold: Number(form.low_stock_threshold || 5),
        expiry_date: form.expiry_date || null,
      };
      if (editing) {
        // Stock is never overwritten directly: a changed number is recorded as an adjustment so history stays accurate.
        const diff = Number(form.stock || 0) - editing.stock;
        const [saved, adjusted] = await Promise.all([
          updateProduct(editing.id, values),
          diff !== 0
            ? adjustStock(editing.id, diff > 0 ? 'purchase' : 'correction', diff, 'Changed in product form')
            : Promise.resolve(null),
        ]);
        upsertProduct({ ...saved, stock: adjusted ? adjusted.stock : saved.stock });
        toastSuccess('Product updated');
      } else {
        upsertProduct(await createProduct(values));
        toastSuccess('Product added');
      }
      setFormOpen(false);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save product');
    } finally {
      setSaving(false);
    }
  };

  const openStock = (p: Product) => {
    setStockFor(p);
    setStockMode('add');
    setStockQty('');
    setStockNote('');
    setStockCost(String(p.purchase_price));
    setStockSell(String(p.selling_price));
  };

  const changeStockMode = (mode: StockMode) => {
    setStockMode(mode);
    setStockQty(mode === 'set' && stockFor ? String(stockFor.stock) : '');
  };

  // What the typed number means: how many to add, how many to take away, or what the shelf count is now.
  const stockQtyNum = Number(stockQty);
  const stockDelta = !stockFor ? 0 : stockMode === 'add' ? stockQtyNum : stockMode === 'remove' ? -stockQtyNum : stockQtyNum - stockFor.stock;
  const stockNext = (stockFor?.stock ?? 0) + stockDelta;
  // Buying more at a price: the new cost is the weighted average of what is on the shelf and the new lot.
  const buying = stockMode === 'add' && stockDelta > 0;
  const lotCost = stockCost.trim() === '' ? null : Number(stockCost);
  const lotCostOk = lotCost !== null && Number.isFinite(lotCost) && lotCost >= 0;
  const newSell = stockSell.trim() === '' ? null : Number(stockSell);
  const newSellOk = newSell !== null && Number.isFinite(newSell) && newSell >= 0;
  const pricesOk = stockMode !== 'add' || ((stockCost.trim() === '' || lotCostOk) && (stockSell.trim() === '' || newSellOk));
  const avgCost = stockFor && buying && lotCostOk
    ? round2((stockFor.stock * Number(stockFor.purchase_price) + stockDelta * (lotCost as number)) / (stockFor.stock + stockDelta))
    : null;
  const sellAfter = stockFor ? (buying && newSellOk ? (newSell as number) : Number(stockFor.selling_price)) : 0;
  const costAfter = avgCost ?? Number(stockFor?.purchase_price ?? 0);

  const stockValid = !!stockFor && stockQty !== '' && Number.isInteger(stockQtyNum) && stockQtyNum >= 0 && stockDelta !== 0 && stockNext >= 0 && pricesOk;

  const saveStock = async () => {
    if (!stockFor || !stockValid) return;
    setSaving(true);
    try {
      const type = stockMode === 'add' ? 'purchase' : stockMode === 'remove' ? 'damage' : stockDelta > 0 ? 'purchase' : 'correction';
      const note = stockNote.trim() || (stockMode === 'set' ? `Stock count set to ${stockQtyNum}` : '');
      const priceChange = buying && newSellOk && newSell !== Number(stockFor.selling_price) ? (newSell as number) : undefined;
      const result = await adjustStock(stockFor.id, type, stockDelta, note, buying ? { unitCost: lotCostOk ? (lotCost as number) : undefined, sellingPrice: priceChange } : undefined);
      patchProduct(stockFor.id, { stock: result.stock, purchase_price: result.purchase_price, selling_price: result.selling_price });
      toastSuccess(
        `${stockFor.name}: stock is now ${result.stock} ${stockFor.unit}` +
        (Number(result.purchase_price) !== Number(stockFor.purchase_price) ? ` · average cost ${formatMoney(result.purchase_price)}` : '')
      );
      setStockFor(null);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not update stock');
    } finally {
      setSaving(false);
    }
  };

  const openPrice = (p: Product) => {
    setPriceFor(p);
    setPriceCost(String(p.purchase_price));
    setPriceSell(String(p.selling_price));
  };

  const priceCostNum = Number(priceCost);
  const priceSellNum = Number(priceSell);
  const priceValid = priceCost.trim() !== '' && priceSell.trim() !== '' && priceCostNum >= 0 && priceSellNum >= 0;

  const savePrice = async () => {
    if (!priceFor || !priceValid) return;
    setSaving(true);
    try {
      const saved = await updateProduct(priceFor.id, { purchase_price: priceCostNum, selling_price: priceSellNum });
      upsertProduct(saved);
      toastSuccess(`${priceFor.name}: prices updated`);
      setPriceFor(null);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not update prices');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setSaving(true);
    try {
      await deleteProduct(target.id);
      removeProduct(target.id);
      toastSuccess('Product deleted');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete product';
      if (/sales history/i.test(message)) {
        // Old bills still refer to it, so it cannot be erased. Take it off the list instead.
        try {
          const saved = await archiveProduct(target.id, true);
          if (filters.includeArchived) upsertProduct(saved);
          else removeProduct(target.id);
          toastSuccess(`${target.name} has been sold before, so it can't be erased. It is now hidden from the list.`);
        } catch (e2) {
          toastError(e2 instanceof Error ? e2.message : 'Could not hide product');
        }
      } else {
        toastError(message);
      }
    } finally {
      setDeleting(null);
      setSaving(false);
    }
  };

  const actionsFor = (p: Product): ReactNode => (
    <div className="flex items-center gap-0.5 shrink-0">
      <IconBtn title="Edit" onClick={() => openEdit(p)}><Pencil size={15} /></IconBtn>
      {p.archived && (
        <IconBtn
          title="Show in the list again"
          onClick={async () => {
            try {
              upsertProduct(await archiveProduct(p.id, false));
            } catch (e) {
              toastError(e instanceof Error ? e.message : 'Could not restore product');
            }
          }}
        >
          <RotateCcw size={15} />
        </IconBtn>
      )}
      <IconBtn title="Delete" danger onClick={() => setDeleting(p)}><Trash2 size={15} /></IconBtn>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle={`${products.length} product${products.length === 1 ? '' : 's'}`}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle view={view} onChange={changeView} />
            <button
              onClick={() => openAdd()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Add Product
            </button>
          </div>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <TextInput
              placeholder="Search name, brand or SKU…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="pl-9"
            />
          </div>
          <Select value={filters.stockFilter} onChange={(e) => setFilters((f) => ({ ...f, stockFilter: e.target.value as ProductFilters['stockFilter'] }))}>
            <option value="all">All stock levels</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={(e) => setFilters((f) => ({ ...f, includeArchived: e.target.checked }))}
              className="rounded border-gray-300 text-brand-700 focus:ring-brand-600"
            />
            Show archived products
          </label>
        </div>
      </Card>

      {!searching && (
        <Breadcrumb
          catKey={catKey} brandKey={brandKey} catName={catName} brandName={brandName}
          onAll={() => { setCatKey(null); setBrandKey(null); }}
          onCategory={() => setBrandKey(null)}
        />
      )}

      {loading ? (
        <div className="text-center text-sm text-gray-500 py-12">Loading…</div>
      ) : searching ? (
        products.length === 0 ? (
          <Card><EmptyState icon={<PackageX size={36} />} title="No products found" message="Try a different search." /></Card>
        ) : (
          <ProductGroup
            items={products}
            view={view}
            title={(p) => p.name}
            subtitle={(p) => `${p.brands?.name ?? 'No brand'} · ${p.categories?.name ?? 'No category'} · ${p.sku}`}
            actions={actionsFor}
            onStock={openStock}
            onPrice={openPrice}
          />
        )
      ) : !catKey ? (
        <TileGroup
          tiles={categoryTiles}
          view={view}
          icon={<Layers size={18} />}
          emptyHint="No products yet — tap Add Product to start."
          onOpen={(k) => setCatKey(k)}
        />
      ) : !brandKey ? (
        brandTiles.length === 0 ? (
          <Card>
            <EmptyState icon={<PackageX size={36} />} title={`No products in ${catName}`} message="Add the first one to see its brand here." />
            <div className="flex justify-center pb-4">
              <button onClick={() => openAdd()} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white">Add Product</button>
            </div>
          </Card>
        ) : (
          <TileGroup tiles={brandTiles} view={view} icon={<Tag size={18} />} emptyHint="" onOpen={(k) => setBrandKey(k)} />
        )
      ) : lines.length === 0 ? (
        <Card><EmptyState icon={<PackageX size={36} />} title="Nothing here" message="No products match the current filters." /></Card>
      ) : (
        <div className="space-y-6">
          {lines.map(([line, items]) => (
            <section key={line}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-semibold text-gray-900 min-w-0 truncate">
                  {line}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {items.length} size{items.length === 1 ? '' : 's'}
                  </span>
                </h3>
                <button
                  onClick={() => openAdd({ category_id: items[0].category_id ?? '', brand_id: items[0].brand_id ?? '', name: line })}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900"
                >
                  <Plus size={13} /> Add size
                </button>
              </div>
              <ProductGroup
                items={items}
                view={view}
                title={(p) => p.size || 'Standard'}
                subtitle={(p) => p.sku + (p.expiry_date ? ` · exp ${formatDate(p.expiry_date)}` : '')}
                actions={actionsFor}
            onStock={openStock}
            onPrice={openPrice}
              />
            </section>
          ))}
        </div>
      )}

      {/* Add / edit modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit Product' : 'Add Product'} wide>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Field label="Product Name (without the size)" required>
              <TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Colgate Max Fresh Blue" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Size / Variant (optional)" hint="Each size is its own item with its own stock and price, e.g. 100 g, 200 g, 500 ml">
              <TextInput value={form.size} onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))} placeholder="e.g. 200 ml" />
            </Field>
          </div>
          <Field label="Category">
            <Select value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
              <option value="">— Select —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Brand">
            <Select value={form.brand_id} onChange={(e) => setForm((f) => ({ ...f, brand_id: e.target.value }))}>
              <option value="">— Select —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="SKU / Product Code" hint="Left blank = auto-generated from the name">
            <TextInput value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="Auto" />
          </Field>
          <Field label="Unit">
            <Select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
          <Field label="MRP (printed price)">
            <TextInput
              type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
              value={form.mrp}
              onChange={(e) => setForm((f) => ({ ...f, mrp: e.target.value, ...costFrom(e.target.value, f.discount, f.purchase_price) }))}
            />
          </Field>
          <Field label="Supplier discount %" hint="With MRP, this fills in your cost automatically">
            <TextInput
              type="number" min="0" max="100" step="0.01" inputMode="decimal" placeholder="0"
              value={form.discount}
              onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value, ...costFrom(f.mrp, e.target.value, f.purchase_price) }))}
            />
          </Field>
          <Field label="Average Cost Price" hint="Bought more at a new price? Use the stock button on the card; it works out the average for you">
            <TextInput type="number" min="0" step="0.01" inputMode="decimal" value={form.purchase_price} onChange={(e) => setForm((f) => ({ ...f, purchase_price: e.target.value }))} placeholder="0.00" />
          </Field>
          <Field
            label="Selling Price (what you charge)"
            required
            hint={
              form.selling_price !== '' && form.purchase_price !== ''
                ? `Profit per unit: ${formatMoney(Number(form.selling_price) - Number(form.purchase_price))}` +
                  (Number(form.selling_price) > 0
                    ? ` (${(((Number(form.selling_price) - Number(form.purchase_price)) / Number(form.selling_price)) * 100).toFixed(1)}% margin)`
                    : '')
                : 'You can still change the price on each bill'
            }
          >
            <TextInput type="number" min="0" step="0.01" inputMode="decimal" value={form.selling_price} onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))} placeholder="0.00" />
          </Field>
          <Field label="Current Stock" hint={editing ? 'Changing this is saved as a stock adjustment in the history' : undefined}>
            <TextInput type="number" min="0" inputMode="numeric" value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} />
          </Field>
          <Field label="Low Stock Alert At">
            <TextInput type="number" min="1" inputMode="numeric" value={form.low_stock_threshold} onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Expiry Date (optional)">
              <TextInput type="date" value={form.expiry_date} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={saveForm} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Product'}
          </button>
        </div>
      </Modal>

      {/* Change prices */}
      <Modal open={!!priceFor} onClose={() => setPriceFor(null)} title={`Prices — ${priceFor?.name ?? ''}`}>
        {priceFor && (
          <form onSubmit={(e) => { e.preventDefault(); savePrice(); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost price (per unit)" hint="Your average cost. It updates by itself when you add stock bought at a new price.">
                <TextInput type="number" min="0" step="0.01" inputMode="decimal" autoFocus value={priceCost} onChange={(e) => setPriceCost(e.target.value)} />
              </Field>
              <Field label="Selling price (per unit)">
                <TextInput type="number" min="0" step="0.01" inputMode="decimal" value={priceSell} onChange={(e) => setPriceSell(e.target.value)} />
              </Field>
            </div>
            {priceFor.mrp !== null && (
              <div className="text-xs text-gray-500">Printed MRP: {formatMoney(priceFor.mrp)}{priceValid && priceSellNum > priceFor.mrp ? ' — your selling price is above it' : ''}</div>
            )}
            <div className={`rounded-lg px-3 py-2.5 text-sm ${priceValid ? (priceSellNum >= priceCostNum ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-800') : 'bg-gray-50 text-gray-500'}`}>
              {priceValid ? (
                <>
                  Profit per unit: <strong className="tabular-nums">{formatMoney(priceSellNum - priceCostNum)}</strong>
                  {priceSellNum > 0 && <> ({(((priceSellNum - priceCostNum) / priceSellNum) * 100).toFixed(1)}% margin)</>}
                  {priceSellNum < priceCostNum && ' — selling below cost'}
                </>
              ) : 'Enter both prices.'}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setPriceFor(null)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving || !priceValid} className="px-5 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-40">
                {saving ? 'Saving…' : 'Save prices'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Update stock */}
      <Modal open={!!stockFor} onClose={() => setStockFor(null)} title={`Update stock — ${stockFor?.name ?? ''}`}>
        {stockFor && (
          <form onSubmit={(e) => { e.preventDefault(); saveStock(); }} className="space-y-4">
            <div className="text-center rounded-xl bg-gray-50 border border-gray-200 py-3">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">{stockFor.stock}</div>
              <div className="text-xs text-gray-500">{stockFor.unit} in stock now</div>
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1" role="tablist">
              {([['add', 'Add stock'], ['set', 'Set exact count'], ['remove', 'Remove']] as const).map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  role="tab"
                  aria-selected={stockMode === id}
                  onClick={() => changeStockMode(id)}
                  className={`py-2 rounded-md text-xs font-medium transition-colors ${stockMode === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <Field
              label={stockMode === 'add' ? 'How many did you add?' : stockMode === 'remove' ? 'How many to remove (damaged, expired, lost)?' : 'How many are on the shelf now?'}
              required
            >
              <TextInput
                type="number"
                min="0"
                inputMode="numeric"
                autoFocus
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                className="text-lg"
              />
            </Field>

            {stockMode !== 'set' && (
              <div className="flex flex-wrap gap-2">
                {[1, 5, 10, 25, 50].map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setStockQty(String((Number(stockQty) || 0) + n))}
                    className="px-3 py-1.5 rounded-full border border-gray-300 text-sm font-medium text-gray-700 hover:bg-brand-50 hover:border-brand-600 transition-colors"
                  >
                    {stockMode === 'add' ? '+' : '−'}{n}
                  </button>
                ))}
                {stockQty !== '' && (
                  <button type="button" onClick={() => setStockQty('')} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800">Clear</button>
                )}
              </div>
            )}

            {stockMode === 'add' && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 p-3">
                <Field label="Bought at (per unit)" hint="What you paid for these new units">
                  <TextInput type="number" min="0" step="0.01" inputMode="decimal" value={stockCost} onChange={(e) => setStockCost(e.target.value)} />
                </Field>
                <Field label="Selling price" hint="Change it if the price has moved">
                  <TextInput type="number" min="0" step="0.01" inputMode="decimal" value={stockSell} onChange={(e) => setStockSell(e.target.value)} />
                </Field>
              </div>
            )}

            <div className={`rounded-lg px-3 py-2.5 text-sm ${stockValid ? 'bg-emerald-50 text-emerald-900' : stockQty !== '' && stockNext < 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'}`}>
              {stockQty === '' ? (
                'Enter a number to see the new stock.'
              ) : stockNext < 0 ? (
                `You only have ${stockFor.stock} — that would go below zero.`
              ) : stockDelta === 0 ? (
                'That is the same as the current stock.'
              ) : (
                <div className="space-y-1">
                  <div>
                    New stock: <strong className="tabular-nums">{stockNext} {stockFor.unit}</strong>{' '}
                    <span className="tabular-nums">({stockDelta > 0 ? '+' : '−'}{Math.abs(stockDelta)})</span>
                  </div>
                  {avgCost !== null && (
                    <>
                      <div>
                        Average cost: <strong className="tabular-nums">{formatMoney(avgCost)}</strong>
                        {avgCost !== Number(stockFor.purchase_price) && <span className="text-xs"> (was {formatMoney(stockFor.purchase_price)})</span>}
                      </div>
                      {stockFor.stock > 0 && (
                        <div className="text-xs opacity-80 tabular-nums">
                          ({stockFor.stock} × {formatMoney(stockFor.purchase_price)} + {stockDelta} × {formatMoney(lotCost as number)}) ÷ {stockNext}
                        </div>
                      )}
                    </>
                  )}
                  {buying && (
                    <div className="text-xs opacity-90 tabular-nums">
                      Profit per unit: {formatMoney(sellAfter - costAfter)}
                      {sellAfter > 0 && <> ({(((sellAfter - costAfter) / sellAfter) * 100).toFixed(1)}% margin)</>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <Field label="Note (optional)">
              <TextInput
                value={stockNote}
                onChange={(e) => setStockNote(e.target.value)}
                placeholder={stockMode === 'add' ? 'e.g. New stock from supplier' : stockMode === 'remove' ? 'e.g. Broken in transport' : 'e.g. Counted on the shelf'}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setStockFor(null)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving || !stockValid} className="px-5 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-40">
                {saving ? 'Saving…' : 'Update stock'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete product?"
        message={<>Are you sure you want to delete <strong>{deleting?.name}</strong>? If it has been sold before, old bills still refer to it, so it will be hidden from the list instead of erased.</>}
        confirmLabel="Delete"
        danger
        loading={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-2 rounded-lg transition-colors ${danger ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
    >
      {children}
    </button>
  );
}

type StockMode = 'add' | 'set' | 'remove';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The stock figure on a product. Tapping it opens the quick stock update. */
function StockButton({ p, onClick, wide }: { p: Product; onClick: () => void; wide?: boolean }) {
  const out = p.stock === 0;
  const tone = out
    ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
    : isLow(p)
      ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
      : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
  return (
    <button
      onClick={onClick}
      title="Click to add or change the stock"
      className={`inline-flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-semibold tabular-nums transition-colors ${tone} ${wide ? 'w-full' : ''}`}
    >
      <span>{out ? 'Out of stock' : `${p.stock} ${p.unit}`}</span>
      <span className="inline-flex items-center gap-1 text-[11px] font-medium opacity-80">
        <PackagePlus size={14} /> Update
      </span>
    </button>
  );
}

/** A set of products, as blocks or as a list. Edit / history / delete sit along the top of each one. */
function ProductGroup({ items, view, title, subtitle, actions, onStock, onPrice }: {
  items: Product[]; view: ViewMode;
  title: (p: Product) => string; subtitle: (p: Product) => string; actions: (p: Product) => ReactNode;
  onStock: (p: Product) => void; onPrice: (p: Product) => void;
}) {
  if (view === 'list') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {items.map((p) => (
          <div key={p.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-gray-50 ${p.archived ? 'opacity-50' : ''}`}>
            <div className="min-w-0 flex-1 basis-48">
              <div className="text-sm font-medium text-gray-900 truncate">{title(p)}</div>
              <div className="text-xs text-gray-500 truncate">{subtitle(p)}</div>
            </div>
            <button onClick={() => onPrice(p)} title="Click to change the cost and selling price" className="flex items-center gap-4 rounded-lg px-2 py-1 text-right hover:bg-gray-100 transition-colors">
              <span className="hidden sm:block text-xs text-gray-500 tabular-nums">
                <span className="block">Avg cost {formatMoney(p.purchase_price)}</span>
                {p.mrp !== null && <span className="block">MRP {formatMoney(p.mrp)}</span>}
              </span>
              <span className="text-sm font-semibold text-gray-900 tabular-nums w-24">{formatMoney(p.selling_price)}</span>
            </button>
            <StockButton p={p} onClick={() => onStock(p)} />
            {actions(p)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {items.map((p) => (
        <div key={p.id} className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3 ${p.archived ? 'opacity-50' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate" title={title(p)}>{title(p)}</div>
              <div className="text-xs text-gray-500 truncate">{subtitle(p)}</div>
            </div>
            {actions(p)}
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <button onClick={() => onPrice(p)} title="Click to change the prices" className="bg-gray-50 hover:bg-gray-100 rounded-lg py-1.5 transition-colors">
              <div className="text-sm font-semibold text-gray-700 tabular-nums">{formatMoney(p.purchase_price)}</div>
              <div className="text-[11px] text-gray-500">Avg cost</div>
            </button>
            <button onClick={() => onPrice(p)} title="Click to change the prices" className="bg-brand-50 hover:bg-brand-100 rounded-lg py-1.5 transition-colors">
              <div className="text-sm font-bold text-brand-800 tabular-nums">{formatMoney(p.selling_price)}</div>
              <div className="text-[11px] text-gray-500">Sell</div>
            </button>
          </div>
          <StockButton p={p} onClick={() => onStock(p)} wide />
        </div>
      ))}
    </div>
  );
}
