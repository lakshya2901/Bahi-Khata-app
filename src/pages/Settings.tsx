import { useEffect, useState } from 'react';
import { Mail, Save, Send } from 'lucide-react';
import { PageHeader, Card } from '@/components/Page';
import { Field, TextInput, Select } from '@/components/Form';
import { toastSuccess, toastError } from '@/components/Toast';
import { sendTestEmail, updateSettings } from '@/lib/api';
import type { Settings } from '@/lib/types';

export function SettingsPage({ settings }: { settings: Settings | null }) {
  const [form, setForm] = useState({
    store_name: 'Mahaveer Agencies',
    store_subtitle: 'Inventory & Billing Management',
    store_phone: '',
    store_address: '',
    store_gstin: '',
    default_discount: '0',
    receipt_format: 'a4' as 'thermal' | 'a4',
    low_stock_default: '5',
    currency: 'INR',
    email_to: '',
    email_time: '20:00',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [togglingEmail, setTogglingEmail] = useState(false);
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'Asia/Kolkata'; } })();

  useEffect(() => {
    if (!settings) return;
    setForm({
      store_name: settings.store_name,
      store_subtitle: settings.store_subtitle,
      store_phone: settings.store_phone ?? '',
      store_address: settings.store_address ?? '',
      store_gstin: settings.store_gstin ?? '',
      default_discount: String(settings.default_discount),
      receipt_format: settings.receipt_format,
      low_stock_default: String(settings.low_stock_default),
      currency: settings.currency,
      email_to: settings.email_to ?? '',
      email_time: settings.email_time ?? '20:00',
    });
  }, [settings]);

  const save = async () => {
    if (!form.store_name.trim()) return toastError('Store name is required');
    setSaving(true);
    try {
      await updateSettings({
        store_name: form.store_name.trim(),
        store_subtitle: form.store_subtitle.trim(),
        store_phone: form.store_phone.trim(),
        store_address: form.store_address.trim(),
        store_gstin: form.store_gstin.trim(),
        default_discount: Number(form.default_discount || 0),
        receipt_format: form.receipt_format,
        low_stock_default: Number(form.low_stock_default || 5),
        currency: form.currency,
        email_to: form.email_to.trim(),
        email_time: form.email_time || '20:00',
        email_tz: zone,
      });
      toastSuccess('Settings saved');
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const emailOn = settings?.email_enabled ?? false;
  const emailReady = settings?.email_configured ?? false;

  // The switch takes effect immediately, together with the address and time currently on screen.
  const toggleEmail = async () => {
    setTogglingEmail(true);
    try {
      await updateSettings({
        email_enabled: !emailOn,
        email_to: form.email_to.trim(),
        email_time: form.email_time || '20:00',
        email_tz: zone,
      });
      toastSuccess(!emailOn ? `Daily email switched on — you will get it every day at ${form.email_time || '20:00'}` : 'Daily email switched off');
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not change the email setting');
    } finally {
      setTogglingEmail(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await sendTestEmail(form.email_to.trim() || undefined);
      toastSuccess(`Test email sent to ${r.sent_to} — check the inbox (and the spam folder)`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not send the test email');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Store details and billing preferences" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <Card title="Store Details">
          <div className="space-y-4">
            <Field label="Store Name" required>
              <TextInput value={form.store_name} onChange={(e) => setForm((f) => ({ ...f, store_name: e.target.value }))} />
            </Field>
            <Field label="Subtitle">
              <TextInput value={form.store_subtitle} onChange={(e) => setForm((f) => ({ ...f, store_subtitle: e.target.value }))} />
            </Field>
            <Field label="Phone Number">
              <TextInput type="tel" value={form.store_phone} onChange={(e) => setForm((f) => ({ ...f, store_phone: e.target.value }))} />
            </Field>
            <Field label="Address" hint="Printed at the top of the invoice">
              <TextInput value={form.store_address} onChange={(e) => setForm((f) => ({ ...f, store_address: e.target.value }))} />
            </Field>
            <Field label="GSTIN (optional)" hint="Printed on the invoice when filled in">
              <TextInput value={form.store_gstin} onChange={(e) => setForm((f) => ({ ...f, store_gstin: e.target.value.toUpperCase() }))} placeholder="e.g. 29ABCDE1234F1Z5" />
            </Field>
          </div>
        </Card>

        <Card title="Billing Preferences">
          <div className="space-y-4">
            <Field label="Default Discount (₹ per bill)">
              <TextInput type="number" min="0" step="0.01" value={form.default_discount} onChange={(e) => setForm((f) => ({ ...f, default_discount: e.target.value }))} />
            </Field>
            <Field label="Receipt Format" hint="Invoice style suits normal printers; thermal suits 58 mm / 80 mm receipt printers">
              <Select value={form.receipt_format} onChange={(e) => setForm((f) => ({ ...f, receipt_format: e.target.value as 'thermal' | 'a4' }))}>
                <option value="a4">Tax-invoice style, A4 (like Tally)</option>
                <option value="thermal">Small thermal receipt (58 / 80 mm)</option>
              </Select>
            </Field>
            <Field label="Default Low-Stock Threshold">
              <TextInput type="number" min="1" value={form.low_stock_default} onChange={(e) => setForm((f) => ({ ...f, low_stock_default: e.target.value }))} />
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="AED">AED</option>
              </Select>
            </Field>
          </div>
        </Card>

        <div className="xl:col-span-2">
          <Card title="Daily email report">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <Mail size={16} className="text-brand-700" /> Email me every day
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  A short report of what is <strong>out of stock</strong>, what is <strong>running low</strong>, and which <strong>customers still have to pay</strong>.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={emailOn}
                aria-label="Daily email on or off"
                onClick={toggleEmail}
                disabled={togglingEmail}
                className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-60 ${emailOn ? 'bg-brand-700' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${emailOn ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
              <Field label="Send the report to" hint="Your own email address, where you want to read it">
                <TextInput type="email" inputMode="email" placeholder="you@gmail.com" value={form.email_to} onChange={(e) => setForm((f) => ({ ...f, email_to: e.target.value }))} />
              </Field>
              <Field label="Send it at" hint={`Every day at this time (${zone}). Press Save Settings after changing it.`}>
                <TextInput type="time" value={form.email_time} onChange={(e) => setForm((f) => ({ ...f, email_time: e.target.value }))} />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button
                onClick={sendTest}
                disabled={testing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Send size={14} /> {testing ? 'Sending…' : 'Send a test email now'}
              </button>
              <span className={`text-xs ${emailReady ? 'text-brand-700' : 'text-amber-700'}`}>
                {emailReady ? 'Sending account is connected.' : 'The sending Gmail account is not set up yet (see below).'}
              </span>
            </div>

            {settings?.email_last_sent && !settings.email_last_error && (
              <p className="text-xs text-gray-500 mt-3">Last sent: {new Date(settings.email_last_sent).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            )}
            {settings?.email_last_error && (
              <p className="text-xs text-red-600 mt-3">Last attempt failed: {settings.email_last_error}</p>
            )}

            {!emailReady && (
              <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
                <div className="font-semibold">One-time setup of the sending Gmail</div>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>On the Gmail account that will <em>send</em> the report, turn on 2-Step Verification.</li>
                  <li>Open Google Account → Security → App passwords and create one (name it “Mahaveer Agencies”).</li>
                  <li>In the project's <code>.env</code> file add <code>GMAIL_USER=that.gmail@gmail.com</code> and <code>GMAIL_APP_PASSWORD=the 16-letter password</code>, then restart the app.</li>
                </ol>
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Save size={15} /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
