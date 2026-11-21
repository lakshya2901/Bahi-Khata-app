import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, LayoutGrid, List, PackageX } from 'lucide-react';
import { Card } from '@/components/Page';
import { EmptyState } from '@/components/Form';
import type { Category, Product } from '@/lib/types';
import { parseHash, setParams, useHash } from '@/lib/nav';

// Shared by Inventory and Create Bill: browse Category > Brand > products, as blocks or as a list.

export type ViewMode = 'blocks' | 'list';

/** The product line without its size: "Colgate Max Fresh Blue 150 g" -> "Colgate Max Fresh Blue". */
export function lineName(p: { name: string; size: string }): string {
  const size = (p.size ?? '').trim();
  if (size && p.name.toLowerCase().endsWith(size.toLowerCase())) {
    const base = p.name.slice(0, p.name.length - size.length).trim();
    if (base) return base;
  }
  return p.name;
}

export const isLow = (p: Product) => p.stock > 0 && p.stock <= p.low_stock_threshold;

export function summarize(items: Product[]) {
  return {
    count: items.length,
    units: items.reduce((n, p) => n + p.stock, 0),
    low: items.filter(isLow).length,
    out: items.filter((p) => p.stock === 0).length,
  };
}

/** Blocks or list, remembered between visits and shared by both screens. */
export function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('catalogue-view') ?? localStorage.getItem('inventory-view');
    return saved === 'list' ? 'list' : 'blocks';
  });
  const change = (v: ViewMode) => { setView(v); localStorage.setItem('catalogue-view', v); };
  return [view, change];
}

export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5" role="group" aria-label="View">
      {([['blocks', LayoutGrid, 'Blocks'], ['list', List, 'List']] as const).map(([id, Icon, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={`${label} view`}
          aria-pressed={view === id}
          className={`px-2.5 py-1.5 rounded-md transition-colors ${view === id ? 'bg-brand-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

/** Where you are in Category > Brand, and what to show at each level. 'none' = no category / no brand. */
export function useDrillDown(products: Product[], categories: Category[], hideEmpty: boolean) {
  // Kept in the address (?c=category&b=brand) so the browser's Back button goes up one level at a time.
  const { params } = parseHash(useHash());
  const catKey = params.get('c');
  const brandKey = params.get('b');
  const setCatKey = (key: string | null) => setParams({ c: key, b: null });
  const setBrandKey = (key: string | null) => setParams({ b: key });

  const categoryTiles = useMemo(() => {
    const tiles = [
      ...categories.map((c) => ({ key: c.id, name: c.name })),
      { key: 'none', name: 'No category' },
    ].map((t) => ({ ...t, ...summarize(products.filter((p) => (p.category_id ?? 'none') === t.key)) }));
    // Hide empty ones when a filter is on, and the catch-all; keep the rest so new categories stay visible.
    return tiles
      .filter((t) => t.count > 0 || (t.key !== 'none' && !hideEmpty))
      .sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || a.name.localeCompare(b.name));
  }, [categories, products, hideEmpty]);

  const inCategory = useMemo(
    () => (catKey ? products.filter((p) => (p.category_id ?? 'none') === catKey) : []),
    [products, catKey]
  );

  const brandTiles = useMemo(() => {
    const groups = new Map<string, { name: string; items: Product[] }>();
    for (const p of inCategory) {
      const key = p.brand_id ?? 'none';
      const g = groups.get(key) ?? { name: p.brands?.name ?? 'No brand', items: [] };
      g.items.push(p);
      groups.set(key, g);
    }
    return [...groups.entries()]
      .map(([key, g]) => ({ key, name: g.name, ...summarize(g.items) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inCategory]);

  // Inside a brand: products grouped by line (e.g. "Colgate Max Fresh Blue"), each line listing its sizes.
  const lines = useMemo(() => {
    if (!brandKey) return [];
    const groups = new Map<string, Product[]>();
    for (const p of inCategory.filter((x) => (x.brand_id ?? 'none') === brandKey)) {
      const k = lineName(p);
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    return [...groups.entries()]
      .map(([line, items]) => [line, items.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [inCategory, brandKey]);

  const catName = categoryTiles.find((t) => t.key === catKey)?.name ?? '';
  const brandName = brandTiles.find((t) => t.key === brandKey)?.name ?? '';

  return { catKey, setCatKey, brandKey, setBrandKey, categoryTiles, brandTiles, lines, catName, brandName };
}

export function Breadcrumb({ catKey, brandKey, catName, brandName, onAll, onCategory }: {
  catKey: string | null; brandKey: string | null; catName: string; brandName: string;
  onAll: () => void; onCategory: () => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm mb-4" aria-label="Where you are">
      <Crumb active={!catKey} onClick={onAll}>All categories</Crumb>
      {catKey && (
        <>
          <ChevronRight size={14} className="text-gray-400" />
          <Crumb active={!brandKey} onClick={onCategory}>{catName || 'Category'}</Crumb>
        </>
      )}
      {brandKey && (
        <>
          <ChevronRight size={14} className="text-gray-400" />
          <Crumb active>{brandName || 'Brand'}</Crumb>
        </>
      )}
    </nav>
  );
}

function Crumb({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={active}
      className={`px-2 py-1 rounded-md font-medium transition-colors ${active ? 'text-gray-900 cursor-default' : 'text-brand-700 hover:bg-brand-50'}`}
    >
      {children}
    </button>
  );
}

export function StockBadge({ p }: { p: Product }) {
  const out = p.stock === 0;
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-1 rounded-full tabular-nums ${
      out ? 'bg-red-50 text-red-700' : isLow(p) ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
    }`}>
      {out ? 'Out of stock' : `${p.stock} ${p.unit}`}
    </span>
  );
}

export interface Tile { key: string; name: string; count: number; units: number; low: number; out: number }

/** Category or brand picker, as blocks or as a list. */
export function TileGroup({ tiles, view, icon, emptyHint, onOpen }: {
  tiles: Tile[]; view: ViewMode; icon: ReactNode; emptyHint: string; onOpen: (key: string) => void;
}) {
  if (tiles.length === 0) {
    return <Card><EmptyState icon={<PackageX size={36} />} title="Nothing to show" message={emptyHint || 'No products match the current filters.'} /></Card>;
  }
  const meta = (t: Tile) => (
    <>
      <span>{t.count} product{t.count === 1 ? '' : 's'}</span>
      <span> · {t.units} in stock</span>
    </>
  );
  const flags = (t: Tile) => (
    <span className="flex items-center gap-1.5">
      {t.out > 0 && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">{t.out} out</span>}
      {t.low > 0 && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">{t.low} low</span>}
    </span>
  );

  if (view === 'list') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {tiles.map((t) => (
          <button key={t.key} onClick={() => onOpen(t.key)} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors">
            <span className="flex items-center gap-3 min-w-0">
              <span className="text-brand-700 shrink-0">{icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{t.name}</span>
                <span className="block text-xs text-gray-500">{meta(t)}</span>
              </span>
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {flags(t)}
              <ChevronRight size={16} className="text-gray-300" />
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <button
          key={t.key}
          onClick={() => onOpen(t.key)}
          className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-left hover:border-brand-600 hover:bg-brand-50/30 transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">{icon}</span>
            {flags(t)}
          </div>
          <div className="mt-3 text-sm font-semibold text-gray-900 truncate">{t.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">{meta(t)}</div>
        </button>
      ))}
    </div>
  );
}
