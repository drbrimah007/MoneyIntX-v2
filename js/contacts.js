// Money IntX v2 — Contacts Module
import { supabase } from './supabase.js';
import { getCurrentContext, applyContactsScope, assertScopedResult } from './context-service.js';

// ── listContacts ─────────────────────────────────────────────────
// Preferred call: listContacts()          — uses current context automatically
// Legacy compat:  listContacts('personal', { userId }) — still works
// Legacy compat:  listContacts(bizUuid)   — still works
export async function listContacts(ctxOrBizId, { archived = false, userId = null } = {}) {
  let query = supabase.from('contacts').select('*');

  // Determine scoping method:
  // 1) No args or explicit context object → use context service
  // 2) String 'personal' or UUID → legacy path (still uses SQL-level scoping)
  if (!ctxOrBizId || (typeof ctxOrBizId === 'object' && ctxOrBizId.type)) {
    // Context-service path: derive context if not passed
    const ctx = (typeof ctxOrBizId === 'object' && ctxOrBizId.type) ? ctxOrBizId : getCurrentContext();
    query = applyContactsScope(query, ctx);
  } else if (ctxOrBizId === 'personal') {
    query = query.is('business_id', null);
    if (userId) query = query.eq('user_id', userId);
  } else {
    // UUID business scope
    query = query.eq('business_id', ctxOrBizId);
  }

  query = query.order('name');
  if (!archived) query = query.is('archived_at', null);
  const { data, error } = await query;
  if (error) console.error('[listContacts]', error.message);

  // Debug: check for context leaks
  if (typeof ctxOrBizId === 'object' && ctxOrBizId.type) {
    assertScopedResult(data, ctxOrBizId, 'contacts');
  }

  return data || [];
}

export async function getContact(id) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single();
  if (error) console.error('[getContact]', error.message);
  return data;
}

// createContact — context-aware. Accepts explicit businessId/userId OR derives from context.
export async function createContact(businessId, userId, { name, email, phone, address, notes, tags }) {
  // If businessId is 'personal', set it to null (personal contacts have NULL business_id)
  const resolvedBizId = (!businessId || businessId === 'personal') ? null : businessId;
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      business_id: resolvedBizId,
      user_id: userId,
      name,
      email: email || '',
      phone: phone || '',
      address: address || '',
      notes: notes || '',
      tags: tags || []
    })
    .select()
    .single();
  if (error) console.error('[createContact]', error.message);
  return data;
}

export async function updateContact(id, updates) {
  const { data, error } = await supabase
    .from('contacts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) console.error('[updateContact]', error.message);
  return data;
}

export async function deleteContact(id) {
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', id);
  if (error) console.error('[deleteContact]', error.message);
  return !error;
}

export async function archiveContact(id) {
  return updateContact(id, { archived_at: new Date().toISOString() });
}

export async function unarchiveContact(id) {
  return updateContact(id, { archived_at: null });
}
