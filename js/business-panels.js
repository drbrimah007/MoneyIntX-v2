// Money IntX v2 — Business Panel Data Layer
import { supabase } from './supabase.js';

// ── Panels ────────────────────────────────────────────────────────
export async function listPanels(businessId) {
  const { data, error } = await supabase
    .from('business_panels')
    .select('*')
    .eq('business_id', businessId)
    .eq('archived', false)
    .order('created_at', { ascending: false });
  if (error) console.error('[listPanels]', error.message);
  return data || [];
}

export async function getPanel(panelId) {
  const { data, error } = await supabase
    .from('business_panels')
    .select('*')
    .eq('id', panelId)
    .single();
  if (error) console.error('[getPanel]', error.message);
  return data;
}

export async function createPanel(businessId, userId, { title, currency, session_type }) {
  const { data, error } = await supabase
    .from('business_panels')
    .insert({ business_id: businessId, user_id: userId, title, currency, session_type, fields: [] })
    .select()
    .single();
  if (error) console.error('[createPanel]', error.code, error.message);
  return { data, error };
}

export async function updatePanel(panelId, updates) {
  const { error } = await supabase
    .from('business_panels')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', panelId);
  if (error) console.error('[updatePanel]', error.message);
  return !error;
}

export async function deletePanel(panelId) {
  const { error } = await supabase
    .from('business_panels')
    .delete()
    .eq('id', panelId);
  if (error) console.error('[deletePanel]', error.message);
  return !error;
}

// ── Rows ──────────────────────────────────────────────────────────
export async function listRows(panelId, { includeArchived = false } = {}) {
  let q = supabase
    .from('business_panel_rows')
    .select('*')
    .eq('panel_id', panelId)
    .order('row_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (!includeArchived) q = q.eq('archived', false);
  const { data, error } = await q;
  if (error) console.error('[listRows]', error.message);
  return data || [];
}

export async function addRow(panelId, businessId, userId, sessionKey, rowDate, values) {
  const { data, error } = await supabase
    .from('business_panel_rows')
    .insert({ panel_id: panelId, business_id: businessId, user_id: userId, session_key: sessionKey, row_date: rowDate, values })
    .select()
    .single();
  if (error) console.error('[addRow]', error.message);
  return data;
}

export async function updateRow(rowId, values) {
  const { error } = await supabase
    .from('business_panel_rows')
    .update({ values })
    .eq('id', rowId);
  if (error) console.error('[updateRow]', error.message);
  return !error;
}

export async function deleteRow(rowId) {
  const { error } = await supabase
    .from('business_panel_rows')
    .delete()
    .eq('id', rowId);
  if (error) console.error('[deleteRow]', error.message);
  return !error;
}

export async function archiveSessionRows(panelId, sessionKey) {
  const { error } = await supabase
    .from('business_panel_rows')
    .update({ archived: true })
    .eq('panel_id', panelId)
    .eq('session_key', sessionKey);
  if (error) console.error('[archiveSessionRows]', error.message);
  return !error;
}

export async function listArchivedRows(panelId) {
  const { data, error } = await supabase
    .from('business_panel_rows')
    .select('*')
    .eq('panel_id', panelId)
    .eq('archived', true)
    .order('row_date', { ascending: true });
  if (error) console.error('[listArchivedRows]', error.message);
  return data || [];
}
// ── Panel Members ─────────────────────────────────────────────────

/** Returns all members for a panel (owner-only query) */
export async function listPanelMembers(panelId) {
  const { data, error } = await supabase
    .from('business_panel_members')
    .select('*, member:member_user_id(id, email, display_name)')
    .eq('panel_id', panelId)
    .order('added_at', { ascending: true });
  if (error) console.error('[listPanelMembers]', error.message);
  return data || [];
}

/** Look up a user by email (for invite flow) */
export async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, display_name')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (error) console.error('[findUserByEmail]', error.message);
  return data;
}

/** Add a member to a panel */
export async function addPanelMember(panelId, memberUserId, { canAdd = true, canEdit = false } = {}) {
  const { data, error } = await supabase
    .from('business_panel_members')
    .upsert({ panel_id: panelId, member_user_id: memberUserId, can_add: canAdd, can_edit: canEdit },
             { onConflict: 'panel_id,member_user_id' })
    .select()
    .single();
  if (error) console.error('[addPanelMember]', error.message);
  return { data, error };
}

/** Update a member's permissions */
export async function updatePanelMember(memberId, { canAdd, canEdit }) {
  const { error } = await supabase
    .from('business_panel_members')
    .update({ can_add: canAdd, can_edit: canEdit })
    .eq('id', memberId);
  if (error) console.error('[updatePanelMember]', error.message);
  return !error;
}

/** Remove a member from a panel */
export async function removePanelMember(memberId) {
  const { error } = await supabase
    .from('business_panel_members')
    .delete()
    .eq('id', memberId);
  if (error) console.error('[removePanelMember]', error.message);
  return !error;
}

/** Returns the current user's membership on a panel (null = not a member / is owner) */
export async function getMyMembership(panelId, userId) {
  const { data, error } = await supabase
    .from('business_panel_members')
    .select('*')
    .eq('panel_id', panelId)
    .eq('member_user_id', userId)
    .maybeSingle();
  if (error) console.error('[getMyMembership]', error.message);
  return data;
}

/** List panels the current user is a MEMBER of (not owner) */
export async function listSharedPanels(userId) {
  const { data, error } = await supabase
    .from('business_panel_members')
    .select('panel:panel_id(*), can_add, can_edit')
    .eq('member_user_id', userId);
  if (error) console.error('[listSharedPanels]', error.message);
  return (data || []).map(r => ({ ...r.panel, _membership: { can_add: r.can_add, can_edit: r.can_edit } }));
}

/** List all registered users (for member picker) */
/**
 * List users eligible to be added as ledger members.
 * Returns business members of the same business (not all site users).
 * Falls back to user's contacts with linked accounts if no business context.
 */
export async function listEligibleMembers(businessId, excludeUserId) {
  if (businessId) {
    // Get business members → resolve their user profiles
    const { data: bm, error } = await supabase
      .from('business_members')
      .select('user_id, user:user_id(id, email, display_name)')
      .eq('business_id', businessId)
      .neq('user_id', excludeUserId);
    if (error) console.error('[listEligibleMembers]', error.message);
    return (bm || []).map(r => r.user).filter(Boolean).sort((a, b) => (a.display_name || a.email || '').localeCompare(b.display_name || b.email || ''));
  }
  // Fallback: user's contacts that have matching user accounts (by email)
  const { data: contacts } = await supabase
    .from('contacts')
    .select('email')
    .eq('user_id', excludeUserId)
    .not('email', 'is', null);
  if (!contacts || contacts.length === 0) return [];
  const emails = contacts.map(c => c.email.toLowerCase().trim()).filter(Boolean);
  const { data: users } = await supabase
    .from('users')
    .select('id, email, display_name')
    .in('email', emails)
    .neq('id', excludeUserId);
  return (users || []).sort((a, b) => (a.display_name || a.email || '').localeCompare(b.display_name || b.email || ''));
}

/** @deprecated Use listEligibleMembers instead */
export async function listAllUsers(excludeUserId) {
  return listEligibleMembers(null, excludeUserId);
}
