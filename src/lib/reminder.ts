import { formatMoney } from './format';

export interface ReminderBill {
  bill_number: string;
  amount_due: number;
}

/** Digits only, with the country code. Returns null when the number is too short or too long to be real. */
export function reminderPhone(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d; // a plain Indian mobile number
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** A polite payment reminder in Hindi, then English, naming every unpaid invoice. */
export function reminderMessage(opts: { customerName: string; shopName: string; bills: ReminderBill[] }): string {
  const { customerName, shopName, bills } = opts;
  const total = bills.reduce((s, b) => s + Number(b.amount_due), 0);
  const list = bills.map((b) => `${b.bill_number} (${formatMoney(Number(b.amount_due))})`).join(', ');
  const hi = customerName ? `नमस्ते ${customerName},` : 'नमस्ते,';
  const en = customerName ? `Hello ${customerName},` : 'Hello,';
  return [
    hi,
    `${shopName} की ओर से याद दिलाना चाहते हैं कि आपका ${formatMoney(total)} बकाया है।`,
    `इनवॉइस नंबर: ${list}`,
    'कृपया जल्द भुगतान करें। धन्यवाद।',
    '',
    en,
    `This is a reminder from ${shopName} that ${formatMoney(total)} is pending.`,
    `Invoice number: ${list}`,
    'Please pay at your earliest convenience. Thank you.',
  ].join('\n');
}

export const whatsappLink = (phone: string, message: string) => `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
export const smsLink = (phone: string, message: string) => `sms:+${phone}?&body=${encodeURIComponent(message)}`;
