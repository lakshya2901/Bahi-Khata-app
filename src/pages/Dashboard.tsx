import { useMemo, useState } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
  type ChartOptions, type TooltipItem,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  IndianRupee, ReceiptText, ShoppingCart, AlertTriangle, TrendingUp, CalendarDays, ArrowRight, Wallet, Phone, Package,
} from 'lucide-react';
import { PageHeader, StatCard, Card } from '@/components/Page';
import { EmptyState } from '@/components/Form';
import { useDashboard, type DashboardData } from '@/lib/api';
import { formatMoney, formatDateTime, PAYMENT_LABELS } from '@/lib/format';
import type { PageId } from '@/components/Layout';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
];

const NAVY = '#17497F';
const NAVY_LIGHT = '#B6CDEA';
const NAVY_DARK = '#0D2B4B';
const PALETTE = ['#17497F', '#D9A93E', '#F28C2C', '#5B9BD5', '#2A9D8F', '#64748B', '#C8553D', '#8B5E9B'];

type Metric = 'revenue' | 'profit' | 'bills';
const METRICS: { id: Metric; label: string }[] = [
  { id: 'revenue', label: 'Sales' },
  { id: 'profit', label: 'Profit' },
  { id: 'bills', label: 'Bills' },
];

const compact = (n: number) => (Math.abs(n) >= 100000 ? `${(n / 100000).toFixed(1)}L` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const longDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** Daily points for short ranges, monthly totals for a long one so the chart stays readable. */
function bucketSeries(series: DashboardData['series'], days: number) {
  const day = (d: string) => d.slice(0, 10);
  if (days <= 92) {
    return series.map((p) => ({ key: day(p.d), label: shortDay(p.d), full: longDay(p.d), revenue: Number(p.revenue), profit: Number(p.profit), bills: Number(p.bills) }));
  }
  const months = new Map<string, { key: string; label: string; full: string; revenue: number; profit: number; bills: number }>();
  for (const p of series) {
    const k = day(p.d).slice(0, 7);
    const m = months.get(k) ?? { key: k, label: monthLabel(p.d), full: new Date(p.d).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), revenue: 0, profit: 0, bills: 0 };
    m.revenue += Number(p.revenue); m.profit += Number(p.profit); m.bills += Number(p.bills);
    months.set(k, m);
  }
  return [...months.values()];
}

function Segmented<T extends string | number>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${value === o.id ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NoData({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">{text}</div>;
}

export function DashboardPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const [days, setDays] = useState(7);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [topBy, setTopBy] = useState<'qty' | 'revenue' | 'profit'>('qty');
  const [picked, setPicked] = useState<number | null>(null);
  const { dashboard, loading } = useDashboard(days);

  const points = useMemo(() => (dashboard ? bucketSeries(dashboard.series, days) : []), [dashboard, days]);

  if (!dashboard) {
    return (
      <div className="text-sm text-gray-500 py-16 text-center">
        {loading ? 'Loading dashboard…' : 'Could not load the dashboard. Check your connection and refresh the page.'}
      </div>
    );
  }

  const { kpis, payments, top, categories, alerts, owing, recent } = dashboard;
  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? `${days} days`;
  const hasSales = kpis.bills > 0;
  const stockIssues = kpis.out_count + kpis.low_count;
  const metricName = METRICS.find((m) => m.id === metric)?.label ?? '';
  const fmt = (n: number) => (metric === 'bills' ? String(n) : formatMoney(n));

  const selected = picked !== null && picked < points.length ? points[picked] : null;

  // ---- sales over time ----
  const barData = {
    labels: points.map((p) => p.label),
    datasets: [{
      label: metricName,
      data: points.map((p) => p[metric]),
      backgroundColor: points.map((_, i) => (picked === i ? NAVY_DARK : NAVY)),
      hoverBackgroundColor: NAVY_DARK,
      borderRadius: 4,
      maxBarThickness: 34,
    }],
  };
  const barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e, elements) => setPicked(elements.length ? elements[0].index : null),
    onHover: (e, elements) => { const t = e.native?.target as HTMLElement | undefined; if (t) t.style.cursor = elements.length ? 'pointer' : 'default'; },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<'bar'>[]) => points[items[0].dataIndex]?.full ?? '',
          label: (item: TooltipItem<'bar'>) => ` ${metricName}: ${fmt(Number(item.raw))}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      y: { beginAtZero: true, ticks: { callback: (v) => (metric === 'bills' ? String(v) : `₹${compact(Number(v))}`), precision: 0 } },
    },
  };

  // ---- payment methods ----
  const payData = {
    labels: payments.map((p) => PAYMENT_LABELS[p.method] ?? p.method),
    datasets: [{ data: payments.map((p) => Number(p.revenue)), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }],
  };
  const doughnutOptions = (total: number): ChartOptions<'doughnut'> => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<'doughnut'>) => ` ${item.label}: ${formatMoney(Number(item.raw))} (${total ? Math.round((Number(item.raw) / total) * 100) : 0}%)`,
        },
      },
    },
  });
  const payTotal = payments.reduce((s, p) => s + Number(p.revenue), 0);

  // ---- categories ----
  const catData = {
    labels: categories.map((c) => c.name),
    datasets: [{ data: categories.map((c) => Number(c.revenue)), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }],
  };
  const catTotal = categories.reduce((s, c) => s + Number(c.revenue), 0);

  // ---- best sellers ----
  const topSorted = [...top].sort((a, b) => Number(b[topBy]) - Number(a[topBy]));
  const topData = {
    labels: topSorted.map((t) => (t.name.length > 28 ? `${t.name.slice(0, 27)}…` : t.name)),
    datasets: [{
      label: topBy === 'qty' ? 'Units sold' : topBy === 'revenue' ? 'Sales' : 'Profit',
      data: topSorted.map((t) => Number(t[topBy])),
      backgroundColor: NAVY_LIGHT,
      hoverBackgroundColor: NAVY,
      borderRadius: 4,
    }],
  };
  const topOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<'bar'>[]) => topSorted[items[0].dataIndex]?.name ?? '',
          label: (item: TooltipItem<'bar'>) => ` ${topBy === 'qty' ? `${item.raw} sold` : formatMoney(Number(item.raw))}`,
        },
      },
    },
    scales: {
      x: { beginAtZero: true, ticks: { callback: (v) => (topBy === 'qty' ? String(v) : `₹${compact(Number(v))}`), precision: 0 } },
      y: { grid: { display: false } },
    },
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of your store"
        actions={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Segmented value={days} onChange={(d) => { setDays(d); setPicked(null); }} options={RANGES.map((r) => ({ id: r.days, label: r.label }))} />
            <button
              onClick={() => onNavigate('pos')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium transition-colors"
            >
              <ShoppingCart size={16} /> New Bill
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <StatCard icon={<IndianRupee size={18} />} label={`Sales · ${rangeLabel}`} value={formatMoney(kpis.revenue)} tone="green" />
        <StatCard icon={<TrendingUp size={18} />} label={`Profit · ${rangeLabel}`} value={formatMoney(kpis.profit)} tone="green" />
        <StatCard icon={<ReceiptText size={18} />} label={`Bills · ${rangeLabel}`} value={String(kpis.bills)} />
        <StatCard icon={<CalendarDays size={18} />} label={`Today · ${kpis.today_bills} bill${kpis.today_bills === 1 ? '' : 's'}`} value={formatMoney(kpis.today_revenue)} />
        <StatCard icon={<Wallet size={18} />} label="Yet to collect" value={formatMoney(kpis.to_collect)} tone={kpis.to_collect > 0 ? 'amber' : 'default'} />
        <StatCard icon={<AlertTriangle size={18} />} label={`Out ${kpis.out_count} · Low ${kpis.low_count}`} value={String(stockIssues)} tone={stockIssues ? 'amber' : 'default'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <div className="xl:col-span-2">
          <Card
            title={`${metricName} over time`}
            action={<Segmented value={metric} onChange={(m) => setMetric(m)} options={METRICS} />}
          >
            <div className="h-64">
              {hasSales ? <Bar data={barData} options={barOptions} /> : <NoData text={`No sales in the last ${rangeLabel}.`} />}
            </div>
            {hasSales && (
              <div className="mt-3 text-xs text-gray-500 min-h-[2.25rem]">
                {selected ? (
                  <div className="rounded-lg bg-brand-50 text-brand-900 px-3 py-2">
                    <span className="font-semibold">{selected.full}</span> — sales {formatMoney(selected.revenue)} · profit {formatMoney(selected.profit)} · {selected.bills} bill{selected.bills === 1 ? '' : 's'}
                  </div>
                ) : (
                  'Hover a bar for details, or click it to pin the figures here.'
                )}
              </div>
            )}
          </Card>
        </div>

        <Card title="How customers paid">
          <div className="h-64">
            {payTotal > 0 ? <Doughnut data={payData} options={doughnutOptions(payTotal)} /> : <NoData text="No payments in this period." />}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <Card
          title="Best sellers"
          action={<Segmented value={topBy} onChange={(v) => setTopBy(v)} options={[{ id: 'qty', label: 'Units' }, { id: 'revenue', label: 'Sales' }, { id: 'profit', label: 'Profit' }]} />}
        >
          <div className="h-72">
            {top.length > 0 ? <Bar data={topData} options={topOptions} /> : <NoData text="Your best sellers will show up here once you start billing." />}
          </div>
        </Card>

        <Card title="Sales by category">
          <div className="h-72">
            {catTotal > 0 ? <Doughnut data={catData} options={doughnutOptions(catTotal)} /> : <NoData text="No category sales in this period." />}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <Card title="Stock alerts" action={linkBtnRef('Open inventory', 'inventory', onNavigate)}>
          <div className="text-xs text-gray-500 mb-2">
            Stock is worth {formatMoney(kpis.inventory_cost)} at cost ({formatMoney(kpis.inventory_retail)} at selling price)
          </div>
          {alerts.length === 0 ? (
            <EmptyState icon={<Package size={36} />} title="All stocked up" message="Nothing you stock is low or out right now." />
          ) : (
            <ul className="divide-y divide-gray-100 -mx-1">
              {alerts.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2.5 px-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.sku}</div>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ml-3 ${p.stock === 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    {p.stock === 0 ? 'Out of stock' : `${p.stock} ${p.unit} left`}
                  </span>
                </li>
              ))}
              {stockIssues > alerts.length && (
                <li className="py-2.5 px-1 text-xs text-gray-500">…and {stockIssues - alerts.length} more in Inventory</li>
              )}
            </ul>
          )}
        </Card>

        <Card title="Customers yet to pay" action={linkBtnRef('Pending payments', 'pending', onNavigate)}>
          {owing.length === 0 ? (
            <EmptyState icon={<Wallet size={36} />} title="Nobody owes you" message="Bills marked “Not paid yet” will show here until they are paid." />
          ) : (
            <ul className="divide-y divide-gray-100 -mx-1">
              {owing.map((o, i) => (
                <li key={`${o.name}-${i}`} className="flex items-center justify-between py-2.5 px-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{o.name}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      {o.phone ? <><Phone size={10} /> {o.phone} · </> : null}{o.bills} bill{o.bills === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-amber-700 tabular-nums shrink-0 ml-3">{formatMoney(o.due)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="xl:col-span-2">
          <Card title="Recent sales" action={linkBtnRef('View all', 'sales', onNavigate)}>
            {recent.length === 0 ? (
              <EmptyState icon={<ReceiptText size={36} />} title="No sales yet" message="Bills you create will appear here." />
            ) : (
              <ul className="divide-y divide-gray-100 -mx-1">
                {recent.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2.5 px-1">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">{s.bill_number}</div>
                      <div className="text-xs text-gray-500 truncate">{s.customer_name || 'Walk-in customer'} · {formatDateTime(s.created_at)}</div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-sm font-semibold text-gray-900 tabular-nums">{formatMoney(s.total)}</div>
                      <div className="text-xs text-gray-500">
                        {PAYMENT_LABELS[s.payment_method]}
                        {Number(s.amount_due) > 0 && <span className="text-amber-700 font-medium"> · due {formatMoney(s.amount_due)}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function linkBtnRef(label: string, page: PageId, onNavigate: (p: PageId) => void) {
  return (
    <button onClick={() => onNavigate(page)} className="text-xs font-medium text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
      {label} <ArrowRight size={12} />
    </button>
  );
}
