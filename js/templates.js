// Money IntX v2 — Templates Module
import { supabase } from './supabase.js';

export async function listTemplates(businessId) {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('business_id', businessId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) console.error('[listTemplates]', error.message);
  return data || [];
}

export async function listPublicTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('*, creator:users(display_name)')
    .eq('is_public', true)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) console.error('[listPublicTemplates]', error.message);
  return data || [];
}

export async function getTemplate(id) {
  const { data, error } = await supabase.from('templates').select('*').eq('id', id).single();
  if (error) console.error('[getTemplate]', error.message);
  return data;
}

export async function createTemplate(businessId, userId, { name, description = '', txType = null, fields = [], invoicePrefix = 'INV-', invoiceNextNum = 1, currency = 'USD', isPublic = false }) {
  const { data, error } = await supabase.from('templates').insert({
    business_id: businessId,
    user_id: userId, name, description, tx_type: txType, fields,
    invoice_prefix: invoicePrefix, invoice_next_num: invoiceNextNum,
    currency, is_public: isPublic
  }).select().single();
  if (error) console.error('[createTemplate]', error.message);
  return data;
}

export async function updateTemplate(id, updates) {
  const { data, error } = await supabase.from('templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) console.error('[updateTemplate]', error.message);
  return data;
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  return !error;
}

export async function copyPublicTemplate(businessId, userId, templateId) {
  // Try getTemplate first (works when RLS allows public reads)
  let original = await getTemplate(templateId);
  // Fallback: if getTemplate failed due to RLS, try fetching from public list
  if (!original) {
    const publicList = await listPublicTemplates();
    original = publicList.find(t => t.id === templateId);
  }
  if (!original) { console.error('[copyPublicTemplate] Template not found:', templateId); return null; }
  return createTemplate(businessId, userId, {
    name: original.name + ' (Copy)',
    description: original.description,
    txType: original.tx_type,
    fields: original.fields,
    invoicePrefix: original.invoice_prefix,
    currency: original.currency
  });
}

export async function togglePublic(id, isPublic) {
  return updateTemplate(id, { is_public: isPublic });
}

export async function archiveTemplate(id) {
  return updateTemplate(id, { archived_at: new Date().toISOString() });
}
