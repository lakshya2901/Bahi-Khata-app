import { useEffect, useState, type ReactNode } from 'react';
import { LogoMark, useLogo } from '@/components/Logo';
import {
  LayoutDashboard, Package, ShoppingCart, ReceiptText, Users,
  Tags, Settings as SettingsIcon, Menu, X, Wallet,
} from 'lucide-react';

export type PageId =
  | 'dashboard' | 'inventory' | 'pos' | 'sales'
  | 'pending' | 'customers' | 'categories' | 'settings';

export const NAV_ITEMS: { id: PageId; label: string; icon: typeof Package }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'pos', label: 'Create Bill', icon: ShoppingCart },
  { id: 'sales', label: 'Sales History', icon: ReceiptText },
  { id: 'pending', label: 'Pending Payments', icon: Wallet },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'categories', label: 'Categories & Brands', icon: Tags },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

interface LayoutProps {
  page: PageId;
  onNavigate: (p: PageId) => void;
  storeName: string;
  storeSubtitle: string;
  children: ReactNode;
}

export function Layout({ page, onNavigate, storeName, storeSubtitle, children }: LayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [page]);

  const navList = (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = page === id;
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
              active
                ? 'bg-gold-50 text-brand-800 shadow-[inset_3px_0_0_0_#D9A93E]'
                : 'text-gray-600 hover:bg-cream hover:text-brand-800'
            }`}
          >
            <Icon size={18} className={active ? 'text-gold-600' : 'text-gray-400'} />
            {label}
          </button>
        );
      })}
    </nav>
  );

  const { src: logo } = useLogo();

  // Sidebar: the full logo, with the subtitle under it. Without the logo file: a small mark and the name.
  const desktopBrand = logo ? (
    <div className="px-1">
      <img src={logo} alt={storeName} className="w-full h-auto max-h-36 object-contain" />
      <div className="text-[11px] text-gray-500 text-center -mt-1 tracking-wide">{storeSubtitle}</div>
      <div className="mt-3 h-px bg-gradient-to-r from-transparent via-gold-300 to-transparent" />
    </div>
  ) : (
    <div className="flex items-center gap-3 px-1">
      <LogoMark size={40} />
      <div className="min-w-0">
        <div className="text-sm font-bold text-brand-800 leading-tight truncate">{storeName}</div>
        <div className="text-[11px] text-gray-500 leading-tight truncate">{storeSubtitle}</div>
      </div>
    </div>
  );

  const mobileBrand = (
    <div className="flex items-center gap-2 px-1 min-w-0">
      {logo ? <img src={logo} alt={storeName} className="h-11 w-auto" /> : <LogoMark size={34} />}
      {!logo && <div className="text-sm font-bold text-brand-800 truncate">{storeName}</div>}
    </div>
  );

  return (
    <div className="min-h-screen bg-cream">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-white border-r border-gold-200 flex-col px-4 py-5 gap-5 z-30">
        {desktopBrand}
        {navList}
        <div className="mt-auto text-[11px] text-gray-400 px-3">General Store Management</div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-white border-b-2 border-gold-300 px-4 py-2 flex items-center justify-between">
        {mobileBrand}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
          aria-label="Menu"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute top-0 left-0 bottom-0 w-72 bg-white shadow-xl px-4 py-5 flex flex-col gap-6 overflow-y-auto">
            <div className="flex items-center justify-between">
              {mobileBrand}
              <button onClick={() => setMenuOpen(false)} className="p-2 text-gray-500" aria-label="Close menu">
                <X size={18} />
              </button>
            </div>
            {navList}
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-10">{children}</div>
      </main>
    </div>
  );
}
