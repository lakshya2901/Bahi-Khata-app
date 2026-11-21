import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users, ReceiptText, Phone } from 'lucide-react';
import { PageHeader, Card } from '@/components/Page';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field, TextInput, EmptyState } from '@/components/Form';
import { toastSuccess, toastError } from '@/components/Toast';
import {
  useCustomers, createCustomer, updateCustomer, deleteCustomer, fetchCustomerSales,
} from '@/lib/api';
import { formatMoney, formatDate, formatDateTime, PAYMENT_LABELS } from '@/lib/format';
import type { Customer, Sale } from '@/lib/types';

interface FormState { name: string; phone: string; address: string }

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const { customers, loading, reload } = useCustomers(search);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', phone: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [historyFor, setHistoryFor] = useState<Customer | null>(null);
  const [historySales, setHistorySales] = useState<Sale[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', phone: '', address: '' });
    setFormOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone ?? '', address: c.address ?? '' });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toastError('Customer name is required');
    setSaving(true);
    try {
      const values = { name: form.name.trim(), phone: form.phone.trim() || null, address: form.address.trim() };
      if (editing) {
        await updateCustomer(editing.id, values);
        toastSuccess('Customer updated');
      } else {
        await createCustomer(values);
        toastSuccess('Customer added');
      }
      setFormOpen(false);
      reload();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save customer');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await deleteCustomer(deleting.id);
      toastSuccess('Customer deleted');
      setDeleting(null);
      reload();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not delete customer');
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (c: Customer) => {
    setHistoryFor(c);
    setHistoryLoading(true);
    try {
      setHistorySales(await fetchCustomerSales(c.id));
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not load purchase history');
    }
    setHistoryLoading(false);
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customer${customers.length === 1 ? '' : 's'}`}
        actions={
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium transition-colors">
            <Plus size={16} /> Add Customer
          </button>
        }
      />

      <Card className="mb-5">
        <TextInput placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {loading && <div className="text-sm text-gray-500 py-8 text-center sm:col-span-2 xl:col-span-3">Loading…</div>}
        {!loading && customers.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <EmptyState
              icon={<Users size={36} />}
              title="No customers yet"
              message="Customers can be added here or automatically during billing. Walk-in customers never need registration."
            />
          </Card>
        )}
        {customers.map((c) => (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{c.name}</div>
                {c.phone && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone size={11} /> {c.phone}</div>}
                {c.address && <div className="text-xs text-gray-400 truncate mt-0.5">{c.address}</div>}
              </div>
              {c.outstanding > 0 && (
                <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700">
                  Yet to pay {formatMoney(c.outstanding)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div className="bg-gray-50 rounded-lg py-2">
                <div className="text-sm font-bold text-gray-900 tabular-nums">{formatMoney(c.total_purchases)}</div>
                <div className="text-[11px] text-gray-500">Bought</div>
              </div>
              <div className="bg-emerald-50 rounded-lg py-2">
                <div className={`text-sm font-bold tabular-nums ${c.profit < 0 ? 'text-red-600' : 'text-emerald-800'}`}>{formatMoney(c.profit)}</div>
                <div className="text-[11px] text-gray-500">Your profit</div>
              </div>
              <div className="bg-gray-50 rounded-lg py-2">
                <div className="text-sm font-bold text-gray-900 tabular-nums">{c.bill_count}</div>
                <div className="text-[11px] text-gray-500">Bills</div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-gray-400">Since {formatDate(c.created_at)}</span>
              <div className="flex gap-1">
                <button onClick={() => openHistory(c)} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Purchase history"><ReceiptText size={15} /></button>
                <button onClick={() => openEdit(c)} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Edit"><Pencil size={15} /></button>
                <button onClick={() => setDeleting(c)} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete"><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit Customer' : 'Add Customer'}>
        <div className="space-y-4">
          <Field label="Customer Name" required>
            <TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Phone Number">
            <TextInput type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Address (optional)">
            <TextInput value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Customer'}
          </button>
        </div>
      </Modal>

      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title={`Purchase History — ${historyFor?.name ?? ''}`} wide>
        {historyLoading ? (
          <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
        ) : historySales.length === 0 ? (
          <EmptyState icon={<ReceiptText size={36} />} title="No purchases yet" message="Bills for this customer will appear here." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {historySales.map((s) => (
              <li key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{s.bill_number}{s.status === 'cancelled' && <span className="ml-2 text-xs text-red-600 font-semibold">Cancelled</span>}</div>
                  <div className="text-xs text-gray-500">{formatDateTime(s.created_at)} · {PAYMENT_LABELS[s.payment_method]}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-gray-900 tabular-nums">{formatMoney(s.total)}</div>
                  {s.status === 'completed' && (
                    <div className="text-[11px] text-gray-500 tabular-nums">
                      profit <span className={s.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatMoney(s.profit)}</span>
                      {Number(s.amount_due) > 0 && <span className="text-amber-700 font-semibold"> · due {formatMoney(s.amount_due)}</span>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete customer?"
        message={<>Are you sure you want to delete <strong>{deleting?.name}</strong>? Their past bills are kept in sales history.</>}
        confirmLabel="Delete"
        danger
        loading={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
