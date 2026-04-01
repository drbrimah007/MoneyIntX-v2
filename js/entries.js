// Money IntX v2 — Entries Module
import { supabase } from './supabase.js';

// Amount helpers: UI works in dollars, DB stores cents
export function toCents(dollars) { return Math.round(parseFloat(dollars) * 100); }
export function toDollars(cents) { return (cents / 100).toFixed(2); }
export function fmtMoney(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency,
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(cents / 100);
  } catch (_) {
    return '$' + (cents / 100).toFixed(2);
  }
}

// ── In-memory cache (15-second TTL) ──────────────────────────────
const _cache = {};
function _cacheGet(key) {
  const v = _cache[key];
  if (!v) return null;
  if (Date.now() - v.ts > 15000) { delete _cache[key]; return null; }
  return v.data;
}
function _cacheSet(key, data) { _cache[key] = { ts: Date.now(), data }; }
export function invalidateEntryCache(userId) { delete _cache['entries_' + userId]; }

// ── List entries ──────────────────────────────────────────────────
export async function listEntries(userId, { status, txType, contactId, limit, offset = 0, orderBy = 'updated_at', ascending = false } = {}) {
  // For full list (no filters, no explicit limit), use cache
  const useCache = !status && !txType && !contactId && !limit && !offset;
  const cacheKey = 'entries_' + userId;
  if (useCache) {
    const cached = _cacheGet(cacheKey);
    if (cached) return cached;
  }

  let query = supabase
    .from('entries')
    .select('*, contact:contacts(id, name, email, linked_user_id)')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order(orderBy, { ascending });

  if (status) query = query.eq('status', status);
  if (txType) query = query.eq('tx_type', txType);
  if (contactId) query = query.eq('contact_id', contactId);
  // Only apply range if explicitly requested
  if (typeof limit === 'number') query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) console.error('[listEntries]', error.message);
  const result = data || [];
  if (useCache) _cacheSet(cacheKey, result);
  return result;
}

// ── Recent entries (dashboard) — uses cache when available ────────
export async function recentEntries(userId, limit = 15) {
  // Reuse full entry cache if available (avoid duplicate query)
  const all = _cacheGet('entries_' + userId);
  if (all) return all.slice(0, limit);
  const { data, error } = await supabase
    .from('entries')
    .select('*, contact:contacts(id, name, email, linked_user_id)')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('[recentEntries]', error.message);
  return data || [];
}

// ── Get single entry ──────────────────────────────────────────────
export async function getEntry(id) {
  const { data, error } = await supabase
    .from('entries')
    .select('*, contact:contacts(id, name, email, linked_user_id), settlements(*)')
    .eq('id', id)
    .single();
  if (error) console.error('[getEntry]', error.message);
  return data;
}

// ── Create entry ──────────────────────────────────────────────────
export async function createEntry(userId, {
  contactId, txType, amount, currency = 'USD', note = '',
  date, invoiceNumber = '', templateId = null, templateData = {},
  status = 'posted', metadata = null, source = 'manual', recurringRuleId = null,
  businessId = null
}) {
  // Guard: every entry MUST have a contact
  if (!contactId) {
    const err = new Error('Cannot create entry without a contact');
    err.sbError = { message: 'contact_id is required' };
    throw err;
  }
  // Atomically increment counter via RPC (1 round-trip instead of 2)
  let nextNum = 1;
  const { data: counterData, error: counterErr } = await supabase
    .rpc('increment_entry_counter', { p_user_id: userId });
  if (counterErr) {
    // Fallback: two-step if RPC not yet deployed
    const { data: u } = await supabase.from('users').select('entry_counter').eq('id', userId).single();
    nextNum = (u?.entry_counter || 0) + 1;
    await supabase.from('users').update({ entry_counter: nextNum }).eq('id', userId);
  } else {
    nextNum = counterData;
  }

  // Build insert payload — only include optional columns when they have values
  const insertPayload = {
    user_id: userId,
    contact_id: contactId,
    tx_type: txType,
    amount: toCents(amount),
    currency,
    note,
    date: date || new Date().toISOString().slice(0, 10),
    invoice_number: invoiceNumber,
    entry_number: nextNum,
    status,
    source: source || 'manual'
  };
  // Always resolve business_id — required NOT NULL column
  if (businessId) {
    insertPayload.business_id = businessId;
  } else {
    // Fallback: use active business (BS context or user's own)
    const { getActiveBusinessId } = await import('./pages/state.js');
    insertPayload.business_id = getActiveBusinessId();
  }
  if (recurringRuleId) insertPayload.recurring_rule_id = recurringRuleId;
  if (templateId) insertPayload.template_id = templateId;
  if (templateId && templateData && Object.keys(templateData).length > 0) insertPayload.template_data = templateData;
  if (metadata) insertPayload.metadata = metadata;

  const { data, error } = await supabase
    .from('entries')
    .insert(insertPayload)
    .select('*, contact:contacts(id, name, email, linked_user_id)')
    .single();
  if (error) {
    console.error('[createEntry]', error.message, error.details, error.hint);
    // Expose error for callers that want to surface it
    if (!data) {
      const err = new Error(error.message);
      err.sbError = error;
      throw err;
    }
  }
  return data;
}

// ── Update entry ──────────────────────────────────────────────────
export async function updateEntry(id, updates) {
  // Convert amount to cents if provided
  if (updates.amount !== undefined) updates.amount = toCents(updates.amount);
  const { data, error } = await supabase
    .from('entries')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, contact:contacts(id, name, email)')
    .single();
  if (error) console.error('[updateEntry]', error.message);
  return data;
}

// ── Delete entry (soft archive — never hard-delete) ──────────────
// Hard-deleting entries would orphan mirrors and break audit trail.
// Instead, archive the entry so it's hidden but recoverable.
export async function deleteEntry(id) {
  const { data, error } = await supabase.from('entries')
    .update({ archived_at: new Date().toISOString(), status: 'voided', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) console.error('[deleteEntry]', error.message);
  return !error;
}

// ── Restore entry (admin — unarchive) ─────────────────────────────
export async function restoreEntry(id) {
  const { data, error } = await supabase.from('entries')
    .update({ archived_at: null, status: 'posted', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) console.error('[restoreEntry]', error.message);
  return !!data;
}

// ── List archived/deleted entries (admin only) ────────────────────
export async function listArchivedEntries(userId) {
  const { data, error } = await supabase.from('entries')
    .select('*, contact:contacts(id, name)')
    .eq('user_id', userId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (error) console.error('[listArchivedEntries]', error.message);
  return data || [];
}

// ── Archive / Unarchive ───────────────────────────────────────────
export async function archiveEntry(id) {
  return updateEntry(id, { archived_at: new Date().toISOString() });
}
export async function unarchiveEntry(id) {
  return updateEntry(id, { archived_at: null });
}

// ── Void entry ────────────────────────────────────────────────────
export async function voidEntry(id) {
  return updateEntry(id, { status: 'voided' });
}

// ── Record settlement (MUST go through RPC) ──────────────────────
// Direct inserts are blocked by RLS. Use create_settlement_with_mirror RPC.
export async function recordSettlement(entryId, { amount, method = '', note = '', proofUrl = '', recordedBy }) {
  console.error('[recordSettlement] BLOCKED — direct insert removed. Use create_settlement_with_mirror RPC instead.');
  throw new Error('Direct settlement recording is disabled. All settlements must go through create_settlement_with_mirror RPC.');
}

// ── Get settlements for entry ─────────────────────────────────────
export async function getSettlements(entryId) {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: false });
  if (error) console.error('[getSettlements]', error.message);
  return data || [];
}

// ── Dashboard totals ──────────────────────────────────────────────
export async function getDashboardTotals(userId) {
  const { data, error } = await supabase
    .from('dashboard_totals')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[getDashboardTotals]', error.message);
  return data || { total_they_owe_me: 0, total_i_owe_them: 0, total_net: 0 };
}

// ── Ledger per contact ────────────────────────────────────────────
export async function getLedgerSummary(userId) {
  const { data, error } = await supabase
    .from('ledger_summary')
    .select('*')
    .eq('user_id', userId);
  if (error) console.error('[getLedgerSummary]', error.message);
  return data || [];
}

// ── Currency ledger (dashboard currency cards) ────────────────────
// Queries entries directly — no dependency on the currency_ledger DB view
// (view may not be deployed). Computes per-currency totals in JavaScript.
// Returns ALL currencies the user has any entries in, even if balance is zero,
// so the hero always shows the correct default currency (never hides it).
export async function getCurrencyLedger(userId) {
  const TERMINAL = new Set(['voided', 'cancelled', 'settled', 'fulfilled']);

  // First try the fast DB view (if deployed)
  try {
    const { data: vData, error: vErr } = await supabase
      .from('currency_ledger')
      .select('currency, owed_to_me, i_owe, active_count')
      .eq('user_id', userId);
    // View exists and returned data — use it (no active_count filter so all currencies appear)
    if (!vErr && Array.isArray(vData)) return vData;
  } catch (_) { /* view not deployed — fall through */ }

  // Fallback: query entries table directly and compute in JS
  const { data, error } = await supabase
    .from('entries')
    .select('currency, tx_type, amount, settled_amount, status, no_ledger')
    .eq('user_id', userId)
    .is('archived_at', null);

  if (error) {
    console.error('[getCurrencyLedger fallback]', error.message);
    return [];
  }

  const map = {};
  for (const e of (data || [])) {
    const cur = e.currency || 'USD';
    if (!map[cur]) map[cur] = { currency: cur, owed_to_me: 0, i_owe: 0, active_count: 0 };
    if (e.no_ledger) continue;
    const remaining = Math.max((e.amount || 0) - (e.settled_amount || 0), 0);
    if (!TERMINAL.has(e.status)) {
      if (['they_owe_you', 'invoice', 'bill'].includes(e.tx_type)) {
        map[cur].owed_to_me += remaining;
        map[cur].active_count++;
      } else if (e.tx_type === 'you_owe_them') {
        map[cur].i_owe += remaining;
        map[cur].active_count++;
      }
    }
  }
  return Object.values(map);
}
