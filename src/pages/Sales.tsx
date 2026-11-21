import { useState } from 'react';
import { Search, Eye, Ban, ReceiptText, Trash2 } from 'lucide-react';
import { PageHeader, Card } from '@/components/Page';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { TextInput, Select, EmptyState } from '@/components/Form';
import { toastSuccess, toastError } from '@/components/Toast';
import { cancelSale, clearSales, deleteSale, useSales, useSettings } from '@/lib/api';
import { formatMoney, formatDateTime, PAYMENT_LABELS } from '@/lib/format';
import { ReceiptModal } from '@/components/Invoice';
import type { Sale } from '@/lib/types';

export function PayBadge({ sale }: { sale: Sale }) {
  if (sale.status === 'cancelled') return null;
  const due = Number(sale.amount_due ?? 0);
  if (due <= 0) return <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Paid</span>;
  const partly = Number(sale.amount_paid) > 0;
  return (
    <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
      {partly ? 'Partly paid' : 'Not paid'} · due {formatMoney(due)}
    </span>
  );
}

export function SalesPage() {
  const [search, setSearch] = useState('');
  const [payment, setPayment] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [due, setDue] = useState('');
  const { sales, loading, reload } = useSales({ search, payment, status, from, to, due });

  const [viewing, setViewing] = useState<Sale | null>(null);
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [working, setWorking] = useState(false);
  const { settings } = useSettings();

  // Deleting removes a bill from the log for good (cancelling keeps it, marked cancelled).
  const [deleting, setDeleting] = useState<Sale | null>(null);
  const [restoreStock, setRestoreStock] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearRestore, setClearRestore] = useState(true);
  const [typed, setTyped] = useState('');

  const confirmDelete = async () => {
    if (!deleting) return;
    setWorking(true);
    try {
      const putBack = deleting.status === 'completed' && restoreStock;
      await deleteSale(deleting.id, putBack);
      toastSuccess(`${deleting.bill_number} deleted${putBack ? ' — items put back in stock' : ''}`);
      setDeleting(null);
      reload();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not delete bill');
    } finally {
      setWorking(false);
    }
  };

  const confirmClear = async () => {
    if (typed.trim() !== 'DELETE') return;
    setWorking(true);
    try {
      const { deleted } = await clearSales(clearRestore);
      toastSuccess(`${deleted} bill${deleted === 1 ? '' : 's'} deleted — the next bill will be INV-000001`);
      setClearOpen(false);
      setTyped('');
      reload();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not clear the sales log');
    } finally {
      setWorking(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelling) return;
    setWorking(true);
    try {
      await cancelSale(cancelling.id);
      toastSuccess(`${cancelling.bill_number} cancelled — stock restored`);
      setCancelling(null);
      reload();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not cancel bill');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Sales History"
        subtitle={`${sales.length} bill${sales.length === 1 ? '' : 's'}`}
        actions={
          <button
            onClick={() => { setClearOpen(true); setClearRestore(true); setTyped(''); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 bg-white text-red-700 text-sm font-medium hover:bg-red-50 transition-colors"
          >
            <Trash2 size={15} /> Clear sales log
          </button>
        }
      />

      <Card className="mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <TextInput
              placeholder="Search bill no. or customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Select value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">All payments</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="credit">Credit</option>
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All status</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
          <Select value={due} onChange={(e) => setDue(e.target.value)}>
            <option value="">Paid &amp; unpaid</option>
            <option value="true">Not fully paid</option>
          </Select>
        </div>
      </Card>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3">Bill No.</th>
              <th className="px-4 py-3">Date &amp; Time</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3 text-right">Items</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Profit</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">Loading…</td></tr>
            ) : sales.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon={<ReceiptText size={36} />} title="No bills found" message="Try changing the filters." /></td></tr>
            ) : (
              sales.map((s) => (
                <tr key={s.id} className={`hover:bg-gray-50 ${s.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {s.bill_number}
                    {s.status === 'cancelled' && <span className="ml-2 text-xs font-semibold text-red-600">Cancelled</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDateTime(s.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600">{s.customer_name || 'Walk-in'}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{s.sale_items?.length ?? 0}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{formatMoney(s.total)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${s.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatMoney(s.profit)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {PAYMENT_LABELS[s.payment_method]}
                    <PayBadge sale={s} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setViewing(s)} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="View bill">
                        <Eye size={15} />
                      </button>
                      {s.status === 'completed' && (
                        <button onClick={() => setCancelling(s)} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Cancel bill">
                          <Ban size={15} />
                        </button>
                      )}
                      <button onClick={() => { setDeleting(s); setRestoreStock(true); }} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete bill from the log">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading && <div className="text-center text-sm text-gray-500 py-8">Loading…</div>}
        {!loading && sales.length === 0 && (
          <Card><EmptyState icon={<ReceiptText size={36} />} title="No bills found" message="Try changing the filters." /></Card>
        )}
        {sales.map((s) => (
          <div key={s.id} className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 ${s.status === 'cancelled' ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-gray-900">{s.bill_number}</div>
                <div className="text-xs text-gray-500 mt-0.5">{formatDateTime(s.created_at)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-gray-900 tabular-nums">{formatMoney(s.total)}</div>
                <div className="text-xs text-gray-500">{PAYMENT_LABELS[s.payment_method]}</div>
                <div className={`text-xs tabular-nums ${s.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>Profit {formatMoney(s.profit)}</div>
                <PayBadge sale={s} />
              </div>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-gray-600">{s.customer_name || 'Walk-in'} · {s.sale_items?.length ?? 0} items{s.status === 'cancelled' ? ' · Cancelled' : ''}</span>
              <div className="flex gap-1">
                <button onClick={() => setViewing(s)} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Eye size={15} /></button>
                {s.status === 'completed' && (
                  <button onClick={() => setCancelling(s)} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Cancel bill"><Ban size={15} /></button>
                )}
                <button onClick={() => { setDeleting(s); setRestoreStock(true); }} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete bill from the log"><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {viewing && (
        <ReceiptModal sale={viewing} store={settings} onClose={() => setViewing(null)} closeLabel="Close" />
      )}

      <ConfirmDialog
        open={!!cancelling}
        title="Cancel this bill?"
        message={<>Bill <strong>{cancelling?.bill_number}</strong> for {formatMoney(cancelling?.total ?? 0)} will be marked cancelled and all sold quantities will be returned to stock. The record is kept for history.</>}
        confirmLabel="Cancel Bill"
        danger
        loading={working}
        onConfirm={confirmCancel}
        onCancel={() => setCancelling(null)}
      />

      {/* Delete one bill */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.bill_number ?? 'bill'}?`}>
        {deleting && (
          <>
            <p className="text-sm text-gray-600">
              This removes the bill for {formatMoney(deleting.total)}{deleting.customer_name ? ` (${deleting.customer_name})` : ''} from the sales log for good. It cannot be undone.
            </p>
            {deleting.status === 'completed' ? (
              <label className="flex items-start gap-3 mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200 cursor-pointer">
                <input type="checkbox" checked={restoreStock} onChange={(e) => setRestoreStock(e.target.checked)} className="mt-0.5 rounded border-gray-300 text-brand-700 focus:ring-brand-600" />
                <span className="text-sm">
                  <span className="font-medium text-gray-900">Put the items back into stock</span>
                  <span className="block text-xs text-gray-500 mt-0.5">Tick this if the bill was a mistake or a test. Leave it unticked if the goods really were sold and you only want to remove the record.</span>
                </span>
              </label>
            ) : (
              <p className="mt-4 text-xs text-gray-500 rounded-lg bg-gray-50 border border-gray-200 p-3">This bill was already cancelled, so its items were put back in stock earlier.</p>
            )}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setDeleting(null)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Keep it</button>
              <button onClick={confirmDelete} disabled={working} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
                {working ? 'Deleting…' : 'Delete bill'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Clear everything */}
      <Modal open={clearOpen} onClose={() => setClearOpen(false)} title="Clear the whole sales log?">
        <p className="text-sm text-gray-600">
          Every bill will be deleted for good, and numbering starts again from INV-000001. Customers' purchase totals and the amounts they owe are worked out from their bills, so those reset too. This cannot be undone.
        </p>
        <label className="flex items-start gap-3 mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200 cursor-pointer">
          <input type="checkbox" checked={clearRestore} onChange={(e) => setClearRestore(e.target.checked)} className="mt-0.5 rounded border-gray-300 text-brand-700 focus:ring-brand-600" />
          <span className="text-sm">
            <span className="font-medium text-gray-900">Put all sold items back into stock</span>
            <span className="block text-xs text-gray-500 mt-0.5">Best when clearing test bills. If these were real sales, untick it so your stock numbers stay as they are.</span>
          </span>
        </label>
        <label className="block mt-4 text-xs font-medium text-gray-700">
          Type DELETE to confirm
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" className="mt-1" />
        </label>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={() => setClearOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={confirmClear} disabled={working || typed.trim() !== 'DELETE'} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">
            {working ? 'Deleting…' : 'Delete all bills'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
