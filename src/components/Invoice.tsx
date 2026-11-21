import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Download, RotateCcw, User } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useLogo } from '@/components/Logo';
import { amountInWords, formatAmount, formatMoney, formatDateTime, PAYMENT_LABELS } from '@/lib/format';
import type { Sale, SaleItem, Settings } from '@/lib/types';

interface SheetProps { sale: Sale; store: Settings | null }

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const timeOnly = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** How much is still unpaid on this bill (nothing, once cancelled). */
const dueOf = (sale: Sale) => (sale.status === 'cancelled' ? 0 : Number(sale.amount_due ?? 0));

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{title}</div>
      {children}
    </div>
  );
}

function TotalRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-0.5 ${strong ? 'font-bold text-sm pt-1.5 mt-1 border-t border-brand-200' : ''} ${muted ? 'text-gray-600' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** One sold item with its MRP, what was taken off it, and the rate charged. */
function priced(it: SaleItem) {
  const rate = Number(it.unit_price);
  // An item without a stored MRP (or one sold at/above MRP) simply has no discount to show.
  const mrp = it.mrp !== null && it.mrp !== undefined && Number(it.mrp) > rate ? Number(it.mrp) : rate;
  const saving = (mrp - rate) * it.quantity;
  return { rate, mrp, saving, pct: mrp > 0 ? ((mrp - rate) / mrp) * 100 : 0 };
}

const pctText = (n: number) => `${Math.round(n * 100) / 100}%`;

/** An online-store style invoice: logo header, Sold By / Bill To, MRP and discount for every product, savings summary. */
export function InvoiceSheet({ sale, store }: SheetProps) {
  const { src: logo } = useLogo();
  const items = sale.sale_items ?? [];
  const shop = store?.store_name ?? 'Mahaveer Agencies';
  const due = dueOf(sale);
  const billDiscount = Number(sale.discount);
  const cancelled = sale.status === 'cancelled';

  const rows = items.map((it) => ({ it, ...priced(it) }));
  const mrpTotal = rows.reduce((s, r) => s + r.mrp * r.it.quantity, 0);
  const itemSavings = rows.reduce((s, r) => s + r.saving, 0);
  const lineSum = rows.reduce((s, r) => s + Number(r.it.line_total), 0);
  // The extra discount typed on the whole bill, shown as each product's share so every product shows what it was cut by.
  const shareOf = (lineTotal: number) => (lineSum > 0 ? (billDiscount * lineTotal) / lineSum : 0);

  const showMrp = itemSavings > 0.004;                       // MRP column: only when something was priced below MRP
  const showDiscount = showMrp || billDiscount > 0.004;      // Discount column: whenever any discount was given
  const totalSaved = itemSavings + billDiscount;
  const qtyTotal = rows.reduce((s, r) => s + r.it.quantity, 0);

  const th = 'px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-brand-800';
  const td = 'px-2 py-2.5 align-top';
  const status = cancelled ? 'Cancelled' : due > 0 ? (Number(sale.amount_paid) > 0 ? 'Partly paid' : 'Payment pending') : 'Paid';

  return (
    <div className="bg-white text-gray-900 text-[12px] leading-snug" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-6 pb-3 border-b-2 border-gold-500">
        <div className="flex items-center gap-3 min-w-0">
          {logo && <img src={logo} alt="" className="h-16 w-auto shrink-0" />}
          <div className="min-w-0">
            <div className="text-2xl font-extrabold tracking-tight text-brand-800">{shop}</div>
            {store?.store_subtitle && <div className="text-[11px] text-gray-500">{store.store_subtitle}</div>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-bold text-brand-700 tracking-wide">INVOICE</div>
          {cancelled && <div className="mt-1 inline-block text-red-600 border border-red-600 rounded px-2 py-0.5 text-[11px] font-bold">CANCELLED</div>}
        </div>
      </div>

      {/* Sold by / Bill to / Invoice details */}
      <div className="grid grid-cols-3 border-b border-gray-300 divide-x divide-gray-300">
        <InfoBlock title="Sold By">
          <div className="font-bold">{shop}</div>
          {store?.store_address && <div className="whitespace-pre-line">{store.store_address}</div>}
          {store?.store_phone && <div>Phone: {store.store_phone}</div>}
          {store?.store_gstin && <div>GSTIN: {store.store_gstin}</div>}
        </InfoBlock>
        <InfoBlock title="Bill To">
          <div className="font-bold">{sale.customer_name || 'Walk-in customer'}</div>
          {sale.customer_phone && <div>Phone: {sale.customer_phone}</div>}
        </InfoBlock>
        <InfoBlock title="Invoice Details">
          <div><span className="text-gray-500">Invoice No:</span> <span className="font-bold">{sale.bill_number}</span></div>
          <div><span className="text-gray-500">Date:</span> {dateOnly(sale.created_at)}, {timeOnly(sale.created_at)}</div>
          <div><span className="text-gray-500">Payment:</span> {PAYMENT_LABELS[sale.payment_method]} · <span className="font-semibold">{status}</span></div>
        </InfoBlock>
      </div>

      {/* Items */}
      <table className="w-full border-collapse mt-3">
        <thead>
          <tr className="bg-brand-50 border-y border-brand-200 text-left">
            <th className={`${th} w-9 text-center`}>#</th>
            <th className={th}>Product</th>
            {showMrp && <th className={`${th} w-20 text-right`}>MRP</th>}
            <th className={`${th} w-12 text-right`}>Qty</th>
            {showDiscount && <th className={`${th} w-32 text-right`}>Discount</th>}
            <th className={`${th} w-20 text-right`}>Rate</th>
            <th className={`${th} w-24 text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ it, mrp, saving, pct, rate }, i) => {
            const share = shareOf(Number(it.line_total));
            return (
              <tr key={it.id} className="border-b border-gray-200">
                <td className={`${td} text-center text-gray-500`}>{i + 1}</td>
                <td className={td}>
                  <div className="font-semibold">{it.product_name}</div>
                  <div className="text-[10px] text-gray-500">
                    {[it.product_brand, it.product_sku].filter(Boolean).join(' · ')}
                  </div>
                </td>
                {showMrp && <td className={`${td} text-right tabular-nums text-gray-600`}>{formatAmount(mrp)}</td>}
                <td className={`${td} text-right tabular-nums`}>{it.quantity}</td>
                {showDiscount && (
                  <td className={`${td} text-right tabular-nums`}>
                    {saving > 0.004 && (
                      <>
                        <div className="font-semibold text-brand-800">− {formatAmount(saving)}</div>
                        <div className="text-[10px] text-gray-500">({pctText(pct)} off MRP)</div>
                      </>
                    )}
                    {share > 0.004 && (
                      <div className="text-[10px] text-gray-500">
                        {saving > 0.004 ? '+ ' : ''}bill discount − {formatAmount(share)}
                      </div>
                    )}
                    {saving <= 0.004 && share <= 0.004 && <span className="text-gray-400">—</span>}
                  </td>
                )}
                <td className={`${td} text-right tabular-nums`}>{formatAmount(rate)}</td>
                <td className={`${td} text-right font-semibold tabular-nums`}>{formatAmount(it.line_total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div className="grid grid-cols-[1fr_auto] gap-6 mt-3">
        <div className="pt-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Amount in words</div>
          <div className="font-semibold">{amountInWords(Number(sale.total))}</div>
          <div className="text-[11px] text-gray-500 mt-2">{rows.length} item{rows.length === 1 ? '' : 's'} · {qtyTotal} unit{qtyTotal === 1 ? '' : 's'}</div>
        </div>
        <div className="min-w-[17rem] border border-brand-200 rounded px-3 py-2">
          {showMrp && (
            <>
              <TotalRow label="Total at MRP" value={formatAmount(mrpTotal)} muted />
              <TotalRow label="Discount on MRP" value={`− ${formatAmount(itemSavings)}`} muted />
            </>
          )}
          <TotalRow label="Sub Total" value={formatAmount(sale.subtotal)} />
          {billDiscount > 0 && <TotalRow label="Extra discount" value={`− ${formatAmount(billDiscount)}`} />}
          <TotalRow label="Grand Total" value={`₹ ${formatAmount(sale.total)}`} strong />
          {due > 0 && (
            <>
              <TotalRow label="Paid" value={formatAmount(sale.amount_paid)} />
              <TotalRow label="Balance Due" value={`₹ ${formatAmount(due)}`} strong />
            </>
          )}
        </div>
      </div>

      {totalSaved > 0.004 && (
        <div className="mt-3 rounded bg-gold-50 border border-gold-200 px-3 py-2 text-center font-semibold text-brand-900">
          You saved ₹ {formatAmount(totalSaved)}
          {mrpTotal > 0 && <span className="font-normal text-gray-600"> ({pctText((totalSaved / mrpTotal) * 100)} off the MRP)</span>}
          {' '}on this order
        </div>
      )}

      {/* Footer */}
      <div className="flex items-end justify-between gap-6 mt-6 pt-3 border-t border-gold-300">
        <div className="text-[11px] text-gray-500">
          <div className="font-semibold text-brand-800">Thank you for shopping with {shop}!</div>
          <div>This is a computer-generated invoice.</div>
        </div>
        <div className="text-right">
          <div className="h-10" />
          <div className="border-t border-gray-400 pt-0.5 px-4 text-[11px]">Authorised Signatory · {shop}</div>
        </div>
      </div>
    </div>
  );
}

/** The narrow slip for 58 / 80 mm receipt printers. */
export function ThermalSlip({ sale, store }: SheetProps) {
  const shop = store?.store_name ?? 'Mahaveer Agencies';
  const items = sale.sale_items ?? [];
  const due = dueOf(sale);
  const saved = items.reduce((n, it) => n + priced(it).saving, 0) + Number(sale.discount);
  return (
    <div className="border border-gray-200 rounded-xl p-4 font-mono text-[13px] leading-relaxed bg-gray-50 text-black print:border-0 print:bg-white print:p-0">
      <div className="text-center">
        <div className="font-bold text-base">{shop}</div>
        <div className="text-gray-500 text-xs">General Store</div>
        {store?.store_phone && <div className="text-gray-500 text-xs">{store.store_phone}</div>}
        {store?.store_gstin && <div className="text-gray-500 text-xs">GSTIN: {store.store_gstin}</div>}
      </div>
      <div className="border-t border-dashed border-gray-400 my-2" />
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between"><span>{sale.bill_number}</span><span>{formatDateTime(sale.created_at)}</span></div>
        {sale.customer_name && (
          <div className="flex items-center gap-1"><User size={11} /> {sale.customer_name}{sale.customer_phone ? ` · ${sale.customer_phone}` : ''}</div>
        )}
      </div>
      <div className="border-t border-dashed border-gray-400 my-2" />
      <ul className="space-y-1.5 text-xs">
        {items.map((it) => (
          <li key={it.id}>
            <div className="flex justify-between gap-2">
              <span>{it.product_name}</span>
              <span className="tabular-nums">{formatMoney(it.line_total)}</span>
            </div>
            <div className="text-gray-500">
              {it.quantity} {it.product_unit} × {formatMoney(it.unit_price)}
              {priced(it).saving > 0.004 && ` (MRP ${formatMoney(priced(it).mrp)}, save ${formatMoney(priced(it).saving)})`}
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-dashed border-gray-400 my-2" />
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatMoney(sale.subtotal)}</span></div>
        {Number(sale.discount) > 0 && (
          <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">− {formatMoney(sale.discount)}</span></div>
        )}
        <div className="flex justify-between font-bold text-sm pt-1"><span>Grand Total</span><span className="tabular-nums">{formatMoney(sale.total)}</span></div>
        <div className="flex justify-between text-gray-500"><span>Payment</span><span>{PAYMENT_LABELS[sale.payment_method]}</span></div>
        {saved > 0.004 && <div className="flex justify-between font-semibold"><span>You saved</span><span className="tabular-nums">{formatMoney(saved)}</span></div>}
        {due > 0 && (
          <>
            <div className="flex justify-between"><span>Paid</span><span className="tabular-nums">{formatMoney(sale.amount_paid)}</span></div>
            <div className="flex justify-between font-bold text-sm"><span>Balance Due</span><span className="tabular-nums">{formatMoney(due)}</span></div>
          </>
        )}
      </div>
      <div className="border-t border-dashed border-gray-400 my-2" />
      <div className="text-center text-xs text-gray-500">Thank you for shopping with us!</div>
      {sale.status === 'cancelled' && <div className="text-center text-red-600 font-bold text-sm mt-2">** BILL CANCELLED **</div>}
    </div>
  );
}

/** Shows the bill on screen, and prints exactly the invoice (nothing else on the page). */
export function ReceiptModal({ sale, store, onClose, closeLabel = 'New Bill' }: {
  sale: Sale; store: Settings | null; onClose: () => void; closeLabel?: string;
}) {
  const thermal = (store?.receipt_format ?? 'a4') === 'thermal';

  const print = () => {
    // The paper size depends on the chosen format, so it is set just for this print.
    const style = document.createElement('style');
    style.textContent = thermal ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: A4; margin: 10mm; }';
    document.head.appendChild(style);
    const cleanup = () => {
      style.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const sheet = thermal ? <ThermalSlip sale={sale} store={store} /> : <InvoiceSheet sale={sale} store={store} />;

  return (
    <Modal open onClose={onClose} title={`Invoice ${sale.bill_number}`} wide={!thermal}>
      <div className="overflow-x-auto">
        <div className={thermal ? 'max-w-xs mx-auto' : 'min-w-[640px]'}>{sheet}</div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={print} className="flex-1 min-w-[7rem] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <Printer size={15} /> Print
        </button>
        <button onClick={print} title="Choose “Save as PDF” as the printer" className="flex-1 min-w-[7rem] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <Download size={15} /> Save PDF
        </button>
        <button onClick={onClose} className="flex-1 min-w-[7rem] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium transition-colors">
          <RotateCcw size={15} /> {closeLabel}
        </button>
      </div>

      {/* What actually goes to the printer: only this is visible when printing */}
      {createPortal(
        <div id="print-root" style={thermal ? { width: '74mm' } : undefined}>{sheet}</div>,
        document.body
      )}
    </Modal>
  );
}
