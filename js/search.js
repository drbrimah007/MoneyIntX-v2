// Money IntX v2 — Global Search Module
import { supabase } from './supabase.js';
import { fmtMoney } from './entries.js';

export async function globalSearch(userId, query) {
  if (!query || query.length < 2) return { contacts: [], entries: [] };
  const q = query.toLowerCase();

  // 1. Search contacts by name, email, phone
  const contactsRes = await supabase.from('contacts').select('id, name, email, phone')
    .eq('user_id', userId).is('archived_at', null)
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(10);
  const matchedContacts = contactsRes.data || [];

  // 2. Search entries by invoice_number, note, and from_name
  const entryFilter = `invoice_number.ilike.%${q}%,note.ilike.%${q}%,from_name.ilike.%${q}%`;
  const entriesRes = await supabase.from('entries')
    .select('id, amount, currency, tx_type, status, date, invoice_number, from_name, contact:contacts(name)')
    .eq('user_id', userId).is('archived_at', null)
    .or(entryFilter)
    .limit(15);
  let entries = entriesRes.data || [];

  // 3. If query looks numeric, also search by amount (stored in cents)
  const numVal = parseFloat(q.replace(/[,$\s]/g, ''));
  if (!isNaN(numVal) && numVal > 0) {
    const cents = Math.round(numVal * 100);
    const amtRes = await supabase.from('entries')
      .select('id, amount, currency, tx_type, status, date, invoice_number, from_name, contact:contacts(name)')
      .eq('user_id', userId).is('archived_at', null)
      .eq('amount', cents)
      .limit(10);
    if (amtRes.data?.length) {
      const existingIds = new Set(entries.map(e => e.id));
      amtRes.data.forEach(e => { if (!existingIds.has(e.id)) entries.push(e); });
    }
  }

  // 4. Also find entries by matching contact name (join can't filter via .or)
  if (matchedContacts.length > 0) {
    const contactIds = matchedContacts.map(c => c.id);
    const byContactRes = await supabase.from('entries')
      .select('id, amount, currency, tx_type, status, date, invoice_number, from_name, contact:contacts(name)')
      .eq('user_id', userId).is('archived_at', null)
      .in('contact_id', contactIds)
      .limit(10);
    if (byContactRes.data?.length) {
      const existingIds = new Set(entries.map(e => e.id));
      byContactRes.data.forEach(e => { if (!existingIds.has(e.id)) entries.push(e); });
    }
  }

  return {
    contacts: matchedContacts,
    entries: entries.slice(0, 15)
  };
}
