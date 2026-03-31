// Money IntX v2 — Settlements Module
import { supabase } from './supabase.js';
import { toCents } from './entries.js';

// ── List settlements for an entry ─────────────────────────────────
export async function listSettlements(entryId) {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: false });
  if (error) console.error('[listSettlements]', error.message);
  return data || [];
}

// ── Record a settlement (MUST go through RPC) ────────────────────
export async function createSettlement(entryId, { amount, method = '', note = '', proofUrl = '', recordedBy, status = 'confirmed' }) {
  console.error('[createSettlement] BLOCKED — direct insert removed. Use create_settlement_with_mirror RPC instead.');
  throw new Error('Direct settlement creation is disabled. All settlements must go through create_settlement_with_mirror RPC.');
}

// ── Approve/reject a pending settlement (MUST go through RPC) ────
export async function reviewSettlement(id, { status, reviewedBy }) {
  console.error('[reviewSettlement] BLOCKED — direct update removed. Use confirm/reject RPCs.');
  throw new Error('Direct settlement review is disabled. Use confirm_mirror_settlement or reject_mirror_settlement RPCs.');
}

// ── Delete a settlement (BLOCKED — must go through RPC) ──────────
export async function deleteSettlement(id) {
  console.error('[deleteSettlement] BLOCKED — direct delete removed.');
  throw new Error('Direct settlement deletion is disabled.');
}

// ── Upload proof of payment ───────────────────────────────────────
export async function uploadProof(file, userId) {
  const ext = file.name.split('.').pop();
  const path = `${userId}/proofs/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage
    .from('documents')
    .upload(path, file);
  if (error) {
    console.error('[uploadProof]', error.message);
    return null;
  }
  const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(path);
  return publicUrl;
}
