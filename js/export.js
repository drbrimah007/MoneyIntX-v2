// Money IntX v2 — Export Module
import { supabase } from './supabase.js';

export async function exportEntriesToCSV(userId) {
  const { data } = await supabase
    .from('entries')
    .select('*, contact:contacts(name)')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('date', { ascending: false });
  if (!data?.length) return null;

  const headers = ['Date','Contact','Type','Amount','Currency','Status','Invoice #','Note'];
  const TX = {
    they_owe_you:'They Owe Me', you_owe_them:'I Owe Them',
    they_paid_you:'They Settled Me', you_paid_them:'I Settled Them',
    invoice:'Invoice', bill:'Bill',
    owed_to_me:'Owed to Me', i_owe:'I Owe',
    bill_sent:'Bill Sent', bill_received:'Bill Received',
    invoice_sent:'Invoice Sent', invoice_received:'Invoice Received',
    advance_paid:'Advance Out', advance_received:'Advance In',
    payment_recorded:'Payment Recorded'
  };
  const rows = data.map(e => [
    e.date, e.contact?.name || '', TX[e.tx_type] || e.tx_type,
    (e.amount / 100).toFixed(2), e.currency, e.status,
    e.invoice_number || '', (e.note || '').replace(/"/g, '""')
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  downloadFile(csv, 'entries-export.csv', 'text/csv');
  return true;
}

export async function exportLedgerToCSV(userId) {
  const { data } = await supabase.from('ledger_summary').select('*').eq('user_id', userId);
  if (!data?.length) return null;

  const headers = ['Contact','They Owe Me','I Owe Them','Net'];
  const rows = data.map(l => [
    l.contact_name, ((l.they_owe_me || 0) / 100).toFixed(2),
    ((l.i_owe_them || 0) / 100).toFixed(2),
    (((l.they_owe_me || 0) - (l.i_owe_them || 0)) / 100).toFixed(2)
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  downloadFile(csv, 'ledger-export.csv', 'text/csv');
  return true;
}

export async function exportContactsToCSV(userId) {
  const { data } = await supabase.from('contacts').select('*').eq('user_id', userId).is('archived_at', null).order('name');
  if (!data?.length) return null;

  const headers = ['Name','Email','Phone','Address','Notes','Tags'];
  const rows = data.map(c => [
    c.name, c.email || '', c.phone || '', c.address || '',
    (c.notes || '').replace(/"/g, '""'), (c.tags || []).join('; ')
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  downloadFile(csv, 'contacts-export.csv', 'text/csv');
  return true;
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
