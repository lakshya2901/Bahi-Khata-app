export function formatMoney(n: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency + ' ';
  return symbol + Number(n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  credit: 'Credit / Udhaar',
};

export const MOVEMENT_LABELS: Record<string, string> = {
  purchase: 'Stock Added',
  sale: 'Sale',
  correction: 'Correction',
  damage: 'Damaged',
  return: 'Customer Return',
  sale_cancel: 'Bill Cancelled',
};

export const UNITS = [
  'piece', 'packet', 'bottle', 'box', 'kg', 'gram', 'litre', 'ml', 'jar', 'pouch', 'dozen', 'meter',
];

/** 1234.5 -> "1,234.50" (no currency symbol), as written in an invoice's amount column. */
export function formatAmount(n: number): string {
  return Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  const r = n % 100;
  if (r > 0) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`);
  return parts.join(' ');
}

/** 1250.5 -> "Indian Rupees One Thousand Two Hundred Fifty and Fifty Paise Only" (lakh / crore grouping). */
export function amountInWords(amount: number): string {
  const paise = Math.round(Math.abs(Number(amount) || 0) * 100);
  let rupees = Math.floor(paise / 100);
  const ps = paise % 100;

  const groups: [number, string][] = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']];
  const words: string[] = [];
  for (const [size, label] of groups) {
    if (rupees >= size) {
      words.push(`${belowThousand(Math.floor(rupees / size))} ${label}`);
      rupees %= size;
    }
  }
  if (rupees > 0) words.push(belowThousand(rupees));

  const rupeeWords = words.join(' ');
  let out = 'Indian Rupees';
  if (rupeeWords) out += ` ${rupeeWords}`;
  if (ps > 0) out += `${rupeeWords ? ' and' : ''} ${belowThousand(ps)} Paise`;
  else if (!rupeeWords) out += ' Zero';
  return `${out} Only`;
}
