// Money IntX v2 — Bulk Actions Module
import { supabase } from './supabase.js';

export async function bulkUpdateStatus(entryIds, status) {
  const { error } = await supabase.from('entries')
    .update({ status, updated_at: new Date().toISOString() })
    .in('id', entryIds);
  if (error) console.error('[bulkUpdateStatus]', error.message);
  return !error;
}

export async function bulkArchive(entryIds) {
  const { error } = await supabase.from('entries')
    .update({ archived_at: new Date().toISOString(), status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', entryIds);
  return !error;
}

export async function bulkNoLedger(entryIds, noLedger) {
  const { error } = await supabase.from('entries')
    .update({ no_ledger: noLedger, updated_at: new Date().toISOString() })
    .in('id', entryIds);
  return !error;
}

export async function bulkDelete(entryIds) {
  // Soft delete — archive all
  return bulkArchive(entryIds);
}
