import nodemailer, { type Transporter } from 'nodemailer';
import { query } from './db.js';

// Daily stock / pending-payment email.
// The sending Gmail account comes from .env (GMAIL_USER + GMAIL_APP_PASSWORD); who receives it, whether it is
// on, and at what time are settings changed in the app.

export class MailError extends Error {}

export const emailConfigured = () => Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

type Transport = Pick<Transporter, 'sendMail'>;
let testTransport: Transport | null = null;
/** Lets a test capture the email instead of sending it. */
export const __setTransport = (t: Transport | null) => { testTransport = t; };

function getTransport(): Transport {
  if (testTransport) return testTransport;
  if (!emailConfigured()) {
    throw new MailError('The sending Gmail account is not set up. Add GMAIL_USER and GMAIL_APP_PASSWORD to the .env file and restart.');
  }
  // Gmail by default. SMTP_HOST / SMTP_PORT exist so the sending can be tried out against any other mail server.
  const port = Number(process.env.SMTP_PORT ?? 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

interface StockItem { name: string; brand: string; stock?: number; unit?: string; low_stock_threshold?: number }
interface Owing { name: string; phone: string | null; due: number; bills: number; oldest: string }

export interface ReportData {
  shop: string;
  outTotal: number; out: StockItem[];
  lowTotal: number; low: StockItem[];
  owingTotal: number; owingCustomers: number; owing: Owing[];
}

// Products that were never stocked (just catalogue entries with no stock movement yet) are left out,
// otherwise a freshly imported catalogue would report every item as "out of stock".
const STOCKED = 'EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = p.id)';

export async function buildReport(): Promise<ReportData> {
  const rows = await query<{ data: any }>(
    `SELECT json_build_object(
       'shop', (SELECT store_name FROM settings WHERE id = 1),
       'out_total', (SELECT count(*) FROM products p WHERE NOT p.archived AND p.stock = 0 AND ${STOCKED}),
       'out', (SELECT coalesce(json_agg(x), '[]'::json) FROM (
                 SELECT p.name, coalesce(b.name, '') AS brand FROM products p LEFT JOIN brands b ON b.id = p.brand_id
                  WHERE NOT p.archived AND p.stock = 0 AND ${STOCKED} ORDER BY p.name LIMIT 60) x),
       'low_total', (SELECT count(*) FROM products p WHERE NOT p.archived AND p.stock > 0 AND p.stock <= p.low_stock_threshold),
       'low', (SELECT coalesce(json_agg(x), '[]'::json) FROM (
                 SELECT p.name, coalesce(b.name, '') AS brand, p.stock, p.unit, p.low_stock_threshold
                   FROM products p LEFT JOIN brands b ON b.id = p.brand_id
                  WHERE NOT p.archived AND p.stock > 0 AND p.stock <= p.low_stock_threshold
                  ORDER BY p.stock, p.name LIMIT 60) x),
       'owing_total', (SELECT coalesce(sum(total - amount_paid), 0) FROM sales WHERE status = 'completed' AND amount_paid < total),
       'owing_customers', (SELECT count(*) FROM (
                 SELECT 1 FROM sales s WHERE s.status = 'completed' AND s.amount_paid < s.total
                  GROUP BY coalesce(s.customer_id::text, nullif(s.customer_phone, ''), lower(nullif(s.customer_name, '')), 'walkin')) g),
       'owing', (SELECT coalesce(json_agg(x), '[]'::json) FROM (
                 SELECT coalesce(c.name, nullif(s.customer_name, ''), 'Walk-in (no name)') AS name,
                        coalesce(c.phone, nullif(s.customer_phone, '')) AS phone,
                        sum(s.total - s.amount_paid) AS due, count(*)::int AS bills, min(s.created_at) AS oldest
                   FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
                  WHERE s.status = 'completed' AND s.amount_paid < s.total
                  GROUP BY coalesce(s.customer_id::text, nullif(s.customer_phone, ''), lower(nullif(s.customer_name, '')), 'walkin'),
                           c.name, c.phone, s.customer_name, s.customer_phone
                  ORDER BY due DESC LIMIT 40) x)
     ) AS data`
  );
  const d = rows[0].data;
  return {
    shop: d.shop ?? 'Mahaveer Agencies',
    outTotal: Number(d.out_total), out: d.out,
    lowTotal: Number(d.low_total), low: d.low,
    owingTotal: Number(d.owing_total), owingCustomers: Number(d.owing_customers),
    owing: d.owing.map((o: any) => ({ ...o, due: Number(o.due) })),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateText = (iso: string, tz: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz });

export function renderEmail(data: ReportData, tz: string, now = new Date()) {
  const today = now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: tz });
  const nothing = data.outTotal === 0 && data.lowTotal === 0 && data.owingTotal === 0;
  const subject = nothing
    ? `${data.shop}: all good today (${today})`
    : `${data.shop}: ${data.outTotal} out of stock, ${data.lowTotal} low, ${money(data.owingTotal)} to collect`;

  const more = (shown: number, total: number) => (total > shown ? `…and ${total - shown} more (open the app to see all)` : '');
  const cell = 'padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;';
  const head = 'padding:6px 10px;text-align:left;font-size:12px;color:#6b7280;background:#f3f4f6;';

  const section = (title: string, color: string, count: string, body: string) => `
    <h2 style="margin:24px 0 6px;font-size:16px;color:${color};">${title} <span style="font-weight:normal;color:#6b7280;">· ${count}</span></h2>${body}`;

  const outHtml = data.outTotal === 0
    ? '<p style="color:#6b7280;margin:4px 0;">Nothing is out of stock.</p>'
    : `<table style="border-collapse:collapse;width:100%;"><tr><th style="${head}">Product</th><th style="${head}">Brand</th></tr>${
        data.out.map((p) => `<tr><td style="${cell}">${esc(p.name)}</td><td style="${cell}color:#6b7280;">${esc(p.brand)}</td></tr>`).join('')}</table>
       <p style="color:#6b7280;font-size:13px;">${more(data.out.length, data.outTotal)}</p>`;

  const lowHtml = data.lowTotal === 0
    ? '<p style="color:#6b7280;margin:4px 0;">Nothing is running low.</p>'
    : `<table style="border-collapse:collapse;width:100%;"><tr><th style="${head}">Product</th><th style="${head}">Brand</th><th style="${head}text-align:right;">Left</th></tr>${
        data.low.map((p) => `<tr><td style="${cell}">${esc(p.name)}</td><td style="${cell}color:#6b7280;">${esc(p.brand)}</td><td style="${cell}text-align:right;font-weight:bold;">${p.stock} ${esc(p.unit ?? '')}</td></tr>`).join('')}</table>
       <p style="color:#6b7280;font-size:13px;">${more(data.low.length, data.lowTotal)}</p>`;

  const owingHtml = data.owingTotal === 0
    ? '<p style="color:#6b7280;margin:4px 0;">Nobody owes you anything.</p>'
    : `<table style="border-collapse:collapse;width:100%;"><tr><th style="${head}">Customer</th><th style="${head}">Phone</th><th style="${head}">Since</th><th style="${head}text-align:right;">Yet to pay</th></tr>${
        data.owing.map((o) => `<tr><td style="${cell}">${esc(o.name)}</td><td style="${cell}color:#6b7280;">${esc(o.phone ?? '')}</td><td style="${cell}color:#6b7280;">${dateText(o.oldest, tz)}</td><td style="${cell}text-align:right;font-weight:bold;color:#b45309;">${money(o.due)}</td></tr>`).join('')}</table>
       <p style="color:#6b7280;font-size:13px;">${more(data.owing.length, data.owingCustomers)}</p>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:680px;margin:0 auto;padding:24px;background:#ffffff;">
      <div style="font-size:22px;font-weight:bold;">${esc(data.shop)}</div>
      <div style="color:#6b7280;font-size:13px;">Daily report · ${esc(today)}</div>
      ${nothing ? '<p style="margin-top:20px;font-size:15px;">Everything looks fine today: nothing is out of stock or low, and no payments are pending.</p>' : ''}
      ${section('Out of stock', '#b91c1c', `${data.outTotal} item${data.outTotal === 1 ? '' : 's'}`, outHtml)}
      ${section('Running low', '#b45309', `${data.lowTotal} item${data.lowTotal === 1 ? '' : 's'}`, lowHtml)}
      ${section('Customers yet to pay', '#92400e', `${money(data.owingTotal)} from ${data.owingCustomers} customer${data.owingCustomers === 1 ? '' : 's'}`, owingHtml)}
      <p style="margin-top:28px;color:#9ca3af;font-size:12px;">Sent automatically. You can switch this email off any time in Settings.</p>
    </div></body></html>`;

  const lines = [
    `${data.shop} — daily report (${today})`, '',
    `OUT OF STOCK (${data.outTotal})`,
    ...(data.out.length ? data.out.map((p) => `  - ${p.name}${p.brand ? ` (${p.brand})` : ''}`) : ['  none']),
    ...(data.outTotal > data.out.length ? [`  …and ${data.outTotal - data.out.length} more`] : []), '',
    `RUNNING LOW (${data.lowTotal})`,
    ...(data.low.length ? data.low.map((p) => `  - ${p.name}: ${p.stock} ${p.unit ?? ''} left`) : ['  none']),
    ...(data.lowTotal > data.low.length ? [`  …and ${data.lowTotal - data.low.length} more`] : []), '',
    `CUSTOMERS YET TO PAY (${money(data.owingTotal)})`,
    ...(data.owing.length ? data.owing.map((o) => `  - ${o.name}${o.phone ? ` (${o.phone})` : ''}: ${money(o.due)}`) : ['  none']),
  ];

  return { subject, html, text: lines.join('\n') };
}

/** Builds today's report and emails it. */
export async function sendReport(opts: { to?: string } = {}) {
  const [settings] = await query<{ email_to: string; email_tz: string }>('SELECT email_to, email_tz FROM settings WHERE id = 1');
  const to = (opts.to || settings?.email_to || '').trim();
  if (!to) throw new MailError('Enter the email address to send the report to.');

  const transport = getTransport();
  const mail = renderEmail(await buildReport(), settings?.email_tz || 'Asia/Kolkata');
  try {
    await transport.sendMail({
      from: `"Mahaveer Agencies reports" <${process.env.GMAIL_USER ?? 'reports@localhost'}>`,
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  } catch (e: any) {
    if (e?.code === 'EAUTH' || /Invalid login|Username and Password not accepted/i.test(e?.message ?? '')) {
      throw new MailError('Gmail rejected the login. Use a Google "App Password" for GMAIL_APP_PASSWORD (not the normal password), with 2-Step Verification turned on.');
    }
    console.error('[email] send failed:', e);
    throw new MailError(`Could not send the email: ${e?.message ?? 'unknown error'}`, { cause: e });
  }
  return { sent_to: to, subject: mail.subject };
}

function localNow(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// In-memory copy of the email settings so the timer doesn't hit the database on every tick. It is best-effort and
// per server instance (on serverless every cold instance starts empty); correctness comes from the database
// claim in runScheduledEmail, not from this cache.
interface Schedule {
  enabled: boolean; to: string; time: string; tz: string; lastSent: string | null;
  loadedOn: string;  // the local date this was read, so a new day always re-reads it
  loadedAt: number;
}
let schedule: Schedule | null = null;

/** Forget the remembered schedule (called when the settings are saved, so the change is seen at once). */
export const invalidateSchedule = () => { schedule = null; };

async function loadSchedule(now: Date): Promise<Schedule> {
  const [s] = await query<{
    email_enabled: boolean; email_to: string; email_time: string; email_tz: string; email_last_sent: string | null;
  }>("SELECT email_enabled, email_to, email_time, email_tz, to_char(email_last_sent, 'YYYY-MM-DD') AS email_last_sent FROM settings WHERE id = 1");
  const tz = s?.email_tz || 'Asia/Kolkata';
  schedule = {
    enabled: Boolean(s?.email_enabled), to: s?.email_to ?? '', time: s?.email_time ?? '20:00', tz,
    lastSent: s?.email_last_sent ?? null, loadedOn: localNow(tz, now).date, loadedAt: now.getTime(),
  };
  return schedule;
}

/**
 * Called every minute (by the dev server) or every few minutes (by an outside timer hitting the cron address).
 * Sends at most one email a day, once the chosen time has passed, and only while the toggle is on.
 *
 * The timer must not keep the database awake all day, so the schedule is remembered in memory and the database is
 * only asked when something could actually be due: the first run, a new day, or once the send time has arrived.
 */
export async function runScheduledEmail(now = new Date()): Promise<{ sent: boolean; failed?: boolean; reason?: string }> {
  let s = schedule;
  if (s) {
    const { date, minutes } = localNow(s.tz, now);
    const [h, m] = s.time.split(':').map(Number);
    const stale =
      date !== s.loadedOn ||                                              // a new day
      (!s.enabled && now.getTime() - s.loadedAt > 6 * 3600_000) ||        // switched off: look again now and then
      (s.enabled && s.lastSent !== date && minutes >= h * 60 + m);        // the send time has come
    if (stale) s = null;
  }
  if (!s) s = await loadSchedule(now);

  if (!s.enabled || !s.to) return { sent: false, reason: 'switched off' };
  if (!testTransport && !emailConfigured()) return { sent: false, reason: 'sender Gmail not set up' };

  const { date, minutes } = localNow(s.tz, now);
  const [h, m] = s.time.split(':').map(Number);
  if (minutes < h * 60 + m) return { sent: false, reason: 'not time yet' };
  if (s.lastSent === date) return { sent: false, reason: 'already sent today' };

  // Claim today's send first, so two copies of the app running at once cannot both send it.
  // A failed attempt is retried after 15 minutes.
  const claimed = await query(
    `UPDATE settings SET email_last_attempt = now()
      WHERE id = 1 AND email_enabled AND (email_last_sent IS DISTINCT FROM $1::date)
        AND (email_last_attempt IS NULL OR email_last_attempt < now() - interval '15 minutes')
      RETURNING id`,
    [date]
  );
  if (!claimed.length) return { sent: false, reason: 'another run is handling it' };

  // Sending and recording the result are separate steps: once the email has gone out, a database hiccup while
  // noting it down must never be reported as "could not send" (the retry would then email the report twice).
  try {
    await sendReport();
  } catch (e) {
    console.error('[email] daily report failed:', e);
    const message = e instanceof Error ? e.message : 'Could not send';
    try {
      await query('UPDATE settings SET email_last_error = $1 WHERE id = 1', [message]);
    } catch (e2) {
      console.error('[email] could not record the failure:', e2);
    }
    return { sent: false, failed: true, reason: message };
  }
  try {
    await query("UPDATE settings SET email_last_sent = $1::date, email_last_error = '' WHERE id = 1", [date]);
  } catch (e) {
    console.error('[email] report sent, but could not record it as sent (it may be sent again):', e);
  }
  if (schedule) schedule.lastSent = date;
  return { sent: true };
}
