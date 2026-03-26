// Money IntX v2 — Global Search Module
import { supabase } from './supabase.js';
import { fmtMoney } from './entries.js';

export async function globalSearch(userId, query) {
  if (!query || query.length < 2) return { contacts: [], entries: [] };
  const q = query.toLowerCase();

  const [contacts, entries] = await Promise.all([
    supabase.from('contacts').select('id, name, email, phone')
      .eq('user_id', userId).is('archived_at', null)
      .or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(10),
    supabase.from('entries').select('id, amount, currency, tx_type, status, date, invoice_number, contact:contacts(name)')
      .eq('user_id', userId).is('archived_at', null)
      .or(`invoice_number.ilike.%${q}%,note.ilike.%${q}%`)
      .limit(10)
  ]);

  return {
    contacts: contacts.data || [],
    entries: entries.data || []
  };
}
