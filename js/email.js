// Money IntX v2 — Email Module
// Uses Supabase Edge Functions or direct Resend API for transactional emails
import { supabase } from './supabase.js';

const TX_LABELS = {
  they_owe_you: 'They Owe Me', you_owe_them: 'I Owe Them',
  they_paid_you: 'They Settled Me', you_paid_them: 'I Settled Them',
  invoice: 'Invoice', bill: 'Bill'
};

// Store email record in log
export async function logEmail(userId, { type, recipient, subject, status = 'sent', error = '', entryId = null }) {
  await supabase.from('email_log').insert({
    user_id: userId, type, recipient, subject, status, error, entry_id: entryId
  });
}

// Send notification email (placeholder — wire to Resend or Edge Function)
export async function sendNotificationEmail(userId, { to, fromName, txType, amount, currency = 'USD', message, entryId, isReminder = false }) {
  const label = TX_LABELS[txType] || txType;
  const prefix = isReminder ? 'Reminder: ' : '';
  const subject = `${prefix}${label} — record from ${fromName}`;

  // For now, log the email. In production, call Resend API or Supabase Edge Function.
  await logEmail(userId, {
    type: isReminder ? 'reminder' : 'notification',
    recipient: to, subject, status: 'queued', entryId
  });

  return { ok: true, subject };
}

// Send invoice email
export async function sendInvoiceEmail(userId, { to, fromName, invoiceNumber, amount, currency = 'USD', entryId }) {
  const subject = `Invoice ${invoiceNumber} from ${fromName}`;
  await logEmail(userId, { type: 'invoice', recipient: to, subject, status: 'queued', entryId });
  return { ok: true, subject };
}
