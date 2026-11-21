import { Layout, type PageId } from '@/components/Layout';
import { ToastContainer } from '@/components/Toast';
import { useSettings } from '@/lib/api';
import { navigate, parseHash, useHash } from '@/lib/nav';
import { DashboardPage } from '@/pages/Dashboard';
import { InventoryPage } from '@/pages/Inventory';
import { PosPage } from '@/pages/Pos';
import { SalesPage } from '@/pages/Sales';
import { CustomersPage } from '@/pages/Customers';
import { PendingPage } from '@/pages/Pending';
import { CategoriesPage } from '@/pages/Categories';
import { SettingsPage } from '@/pages/Settings';

const PAGES: PageId[] = ['dashboard', 'inventory', 'pos', 'sales', 'pending', 'customers', 'categories', 'settings'];

export default function App() {
  const hash = useHash();
  const name = parseHash(hash).page as PageId;
  const page: PageId = PAGES.includes(name) ? name : 'dashboard';
  const { settings } = useSettings();

  const goTo = (p: PageId) => navigate(`#/${p}`);

  return (
    <Layout
      page={page}
      onNavigate={goTo}
      storeName={settings?.store_name ?? 'Mahaveer Agencies'}
      storeSubtitle={settings?.store_subtitle ?? 'Inventory & Billing Management'}
    >
      {page === 'dashboard' && <DashboardPage onNavigate={goTo} />}
      {page === 'inventory' && <InventoryPage />}
      {page === 'pos' && <PosPage />}
      {page === 'sales' && <SalesPage />}
      {page === 'pending' && <PendingPage />}
      {page === 'customers' && <CustomersPage />}
      {page === 'categories' && <CategoriesPage />}
      {page === 'settings' && <SettingsPage settings={settings} />}
      <ToastContainer />
    </Layout>
  );
}
