import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Users, ReceiptText, Phone, BadgeCheck, MessageCircle, MessageSquare } from 'lucide-react';
import { PageHeader, StatCard, Card } from '@/components/Page';
import { Modal } from '@/components/Modal';
import { Field, TextInput, EmptyState } from '@/components/Form';
import { toastSuccess, toastError } from '@/components/Toast';
import { fetchSales, recordBillPayment, recordCustomerPayment, useSettings } from '@/lib/api';
import { reminderMessage, reminderPhone, smsLink, whatsappLink } from '@/lib/reminder';
import { formatMoney, formatDateTime, PAYMENT_LABELS } from '@/lib/format';
import type { Sale } from '@/lib/types';

interface Group {
  key: string;
  customerId: string | null;
  name: string;
  phone: string;
  bills: Sale[];
  due: number;
}

type Target =
  | { kind: 'bill'; sale: Sale }
  | { kind: 'customer'; group: Group };

/** Everything the shop is still waiting to be paid for, grouped by who owes it. */
export function PendingPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Target | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const { settings } = useSettings();

  const load = useCallback(async () => {
    try {
      setSales(await fetchSales(2000, { due: true }));
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not load pending payments');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const s of sales) {
      const key = s.customer_id
        ?? (s.customer_phone ? `p:${s.customer_phone}` : s.customer_name ? `n:${s.customer_name.toLowerCase()}` : 'walkin');
      const g = map.get(key) ?? {
        key, customerId: s.customer_id, name: s.customer_name || 'Walk-in (no name)', phone: s.customer_phone, bills: [], due: 0,
      };
      g.bills.push(s);
      g.due += Number(s.amount_due);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.due - a.due);
  }, [sales]);

  const totalDue = groups.reduce((s, g) => s + g.due, 0);

  const maxFor = (t: Target) => (t.kind === 'bill' ? Number(t.sale.amount_due) : t.group.due);

  const openReceive = (t: Target) => {
    setTarget(t);
    setAmount(String(Math.round(maxFor(t) * 100) / 100));
  };

  const confirm = async () => {
    if (!target) return;
    const value = Number(amount);
    const max = Math.round(maxFor(target) * 100) / 100;
    if (!(value > 0)) return toastError('Enter the amount received');
    if (value > max) return toastError(`That is more than the ${formatMoney(max)} due`);
    setSaving(true);
    try {
      if (target.kind === 'bill') await recordBillPayment(target.sale.id, value);
      else await recordCustomerPayment(target.group.customerId as string, value);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save payment');
      setSaving(false);
      return;
    }
    // The payment is saved from here on, so a failure to refresh the list must not look like a failed payment.
    toastSuccess(`${formatMoney(value)} received`);
    setTarget(null);
    setSaving(false);
    await load();
  };

  // Opens WhatsApp or the SMS app with the message already typed; the owner just presses Send.
  const reminderFor = (g: Group) => {
    const phone = reminderPhone(g.phone);
    if (!phone) return null;
    const message = reminderMessage({
      customerName: g.bills.find((b) => b.customer_name)?.customer_name ?? '',
      shopName: settings?.store_name || 'Mahaveer Agencies',
      bills: g.bills,
    });
    return { whatsapp: whatsappLink(phone, message), sms: smsLink(phone, message) };
  };

  const targetName = target?.kind === 'bill' ? target.sale.bill_number : target?.group.name;

  return (
    <div>
      <PageHeader title="Pending Payments" subtitle="Bills that customers have not fully paid yet" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-5">
        <StatCard icon={<Wallet size={18} />} label="Yet to collect" value={formatMoney(totalDue)} tone="amber" />
        <StatCard icon={<Users size={18} />} label="Customers who owe" value={String(groups.length)} />
        <StatCard icon={<ReceiptText size={18} />} label="Unpaid bills" value={String(sales.length)} />
      </div>

      {loading && <div className="text-sm text-gray-500 py-10 text-center">Loading…</div>}

      {!loading && groups.length === 0 && (
        <Card>
          <EmptyState
            icon={<BadgeCheck size={36} />}
            title="Everything is paid"
            message="When you bill someone as “Not paid yet”, they will show up here until they pay."
          />
        </Card>
      )}

      <div className="space-y-4">
        {groups.map((g) => {
          const reminder = reminderFor(g);
          return (
          <div key={g.key} className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{g.name}</div>
                {g.phone && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone size={11} /> {g.phone}</div>}
                {g.phone && !reminder && <div className="text-[11px] text-amber-700 mt-0.5">This phone number looks incomplete, so a reminder cannot be sent.</div>}
                {reminder && (
                  <div className="flex items-center gap-2 mt-2">
                    <a
                      href={reminder.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white"
                    >
                      <MessageCircle size={14} /> WhatsApp reminder
                    </a>
                    <a
                      href={reminder.sms}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      <MessageSquare size={14} /> SMS
                    </a>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] text-gray-500">Yet to pay</div>
                <div className="text-base font-bold text-amber-700 tabular-nums">{formatMoney(g.due)}</div>
              </div>
            </div>

            <ul className="divide-y divide-gray-100">
              {g.bills.map((s) => (
                <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">{s.bill_number}</div>
                    <div className="text-xs text-gray-500">
                      {formatDateTime(s.created_at)} · {PAYMENT_LABELS[s.payment_method]}
                    </div>
                    <div className="text-xs text-gray-500 tabular-nums">
                      Bill {formatMoney(s.total)} · paid {formatMoney(s.amount_paid)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-amber-700 tabular-nums">{formatMoney(s.amount_due)}</span>
                    <button
                      onClick={() => openReceive({ kind: 'bill', sale: s })}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      Received
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {g.customerId && g.bills.length > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => openReceive({ kind: 'customer', group: g })}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white"
                >
                  Receive payment for all bills
                </button>
              </div>
            )}
          </div>
          );
        })}
      </div>

      <Modal open={!!target} onClose={() => setTarget(null)} title={`Receive payment — ${targetName ?? ''}`}>
        {target && (
          <>
            <p className="text-sm text-gray-600 mb-4">
              {target.kind === 'customer'
                ? 'The amount goes against their oldest unpaid bills first.'
                : 'Enter how much the customer has paid towards this bill.'}
            </p>
            <Field label={`Amount received (up to ${formatMoney(maxFor(target))})`}>
              <TextInput
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setTarget(null)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={confirm} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50">
                {saving ? 'Saving…' : 'Save payment'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
