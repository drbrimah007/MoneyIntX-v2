// Money IntX v2 — Impersonation Module (Admin only)
import { supabase } from './supabase.js';

let _originalUser = null;
let _impersonating = false;

export function isImpersonating() { return _impersonating; }
export function getOriginalUser() { return _originalUser; }

export async function startImpersonation(adminUser, targetUserId) {
  _originalUser = adminUser;
  _impersonating = true;
  const { data: profile } = await supabase.from('users').select('*').eq('id', targetUserId).single();
  return { id: targetUserId, profile };
}

export function stopImpersonation() {
  const orig = _originalUser;
  _originalUser = null;
  _impersonating = false;
  return orig;
}
