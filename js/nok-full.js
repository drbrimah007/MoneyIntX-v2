// Money IntX v2 — Full NOK / Trusted Access Module
import { supabase } from './supabase.js';

export async function listTrustees(userId) {
  const { data } = await supabase.from('nok_trustees').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  return data || [];
}

export async function createTrustee(userId, opts) {
  const code = Math.random().toString(36).substr(2, 8).toUpperCase();
  const { data } = await supabase.from('nok_trustees').insert({
    user_id: userId, trustee_name: opts.trusteeName, trustee_email: opts.trusteeEmail,
    relationship: opts.relationship || '', access_level: opts.accessLevel || 'readonly',
    release_type: opts.releaseType || 'manual', inactivity_days: opts.inactivityDays || 90,
    verification_code: code
  }).select().single();
  return data;
}

export async function updateTrustee(id, updates) {
  const { data } = await supabase.from('nok_trustees')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  return data;
}

export async function deleteTrustee(id) {
  await supabase.from('nok_trustees').delete().eq('id', id);
}

export async function verifyTrustee(id) {
  return updateTrustee(id, { verified: true, verified_at: new Date().toISOString() });
}

export async function activateTrustee(id, reason = '') {
  return updateTrustee(id, { activated: true, activated_at: new Date().toISOString(), activation_reason: reason });
}

export async function deactivateTrustee(id) {
  return updateTrustee(id, { activated: false, activated_at: null, activation_reason: '' });
}

// Check inactivity-based activation
export async function checkInactivityActivation(userId) {
  const { data: user } = await supabase.from('users').select('last_activity_at').eq('id', userId).single();
  if (!user?.last_activity_at) return;
  const trustees = await listTrustees(userId);
  const now = Date.now();
  for (const t of trustees) {
    if (t.release_type === 'inactivity' && t.verified && !t.activated) {
      const lastActivity = new Date(user.last_activity_at).getTime();
      const threshold = t.inactivity_days * 86400000;
      if (now - lastActivity > threshold) {
        await activateTrustee(t.id, 'Auto-activated: inactivity threshold exceeded');
      }
    }
  }
}
