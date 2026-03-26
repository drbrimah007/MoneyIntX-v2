// Money IntX v2 — Audit Trail Module
import { supabase } from './supabase.js';

export async function logAction(userId, action, { entityType, entityId, details = {} } = {}) {
  await supabase.from('audit_log').insert({
    user_id: userId, action, entity_type: entityType || null,
    entity_id: entityId || null, details
  });
}

// Auto-audit wrapper — call after any CRUD operation
export function withAudit(userId, action, entityType) {
  return async function(result, entityId) {
    if (result) {
      await logAction(userId, action, { entityType, entityId: entityId || result?.id });
    }
    return result;
  };
}
