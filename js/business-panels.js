// Money IntX v2 — Business Panel Data Layer
import { supabase } from './supabase.js';

// ── Panels ────────────────────────────────────────────────────────
export async function listPanels(userId) {
  const { data, error } = await supabase
    .from('business_panels')
    .select('*')
    .eq('user_id', userId)
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

export async function createPanel(userId, { title, currency, session_type }) {
  const { data, error } = await supabase
    .from('business_panels')
    .insert({ user_id: userId, title, currency, session_type, fields: [] })
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

export async function addRow(panelId, userId, sessionKey, rowDate, values) {
  const { data, error } = await supabase
    .from('business_panel_rows')
    .insert({ panel_id: panelId, user_id: userId, session_key: sessionKey, row_date: rowDate, values })
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
