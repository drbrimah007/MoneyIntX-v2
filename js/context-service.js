// ────────────────────────────────────────────────────────────────────────────
// Context Service — THE single source of truth for app context
// ────────────────────────────────────────────────────────────────────────────
// Rule: No page decides context on its own. Everything flows through here.
//
// Two contexts exist:
//   personal  → user_id = X, business_id IS NULL
//   business  → business_id = Y
//
// Every query, create, and import must use this service.

import { getCurrentUser, getCurrentProfile, getMyBusinessId } from './pages/state.js';

// ═══════════════════════════════════════════════════════════════════════════
// getCurrentContext() — returns the active context object
// ═══════════════════════════════════════════════════════════════════════════
export function getCurrentContext() {
  const user = getCurrentUser();
  const profile = getCurrentProfile();
  const isBs = !!(window._bsActiveContext && window._bsActiveBizId);
  // Debug (disable in production): console.log('[context-service] isBs:', isBs, 'user:', user?.id);

  if (isBs) {
    const bizId = window._bsContext?.businessId || window._bsActiveBizId;
    const bizName = window._getBsSenderName?.() || profile?.company_name || '';
    const bizEmail = window._getBsSenderEmail?.() || user?.email || '';
    return {
      type: 'business',
      id: bizId,
      userId: user?.id,
      businessId: bizId,
      senderContext: 'business',
      senderName: bizName,
      senderEmail: bizEmail,
      senderBusinessName: bizName
    };
  }

  return {
    type: 'personal',
    id: user?.id,
    userId: user?.id,
    businessId: null,
    senderContext: 'personal',
    senderName: profile?.display_name || user?.email?.split('@')[0] || '',
    senderEmail: user?.email || '',
    senderBusinessName: ''
  };
}

export function isPersonalContext() { return getCurrentContext().type === 'personal'; }
export function isBusinessContext() { return getCurrentContext().type === 'business'; }

// ═══════════════════════════════════════════════════════════════════════════
// getContextLogoUrl() — returns correct logo for active context
// Personal context → users.logo_url (personal brand/logo)
// Business context → businesses.logo_url (business brand/logo)
// The two MUST be separate sources — never cross-contaminate.
// ═══════════════════════════════════════════════════════════════════════════
export function getContextLogoUrl() {
  const ctx = getCurrentContext();
  if (ctx.type === 'business') {
    // Business: use the business record's logo (from _bsContext, set on BS enter)
    // This is the businesses table logo — completely separate from user profile
    const bsLogo = window._bsContext?.ownerLogo;
    if (bsLogo) return bsLogo;
    // Fallback: profile logo (only if business logo not loaded yet)
    const profile = getCurrentProfile();
    return profile?.logo_url || null;
  }
  // Personal: user's own profile logo — their personal brand identity
  const profile = getCurrentProfile();
  return profile?.logo_url || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// getSenderSnapshot() — frozen sender identity for entries/invoices/shares
// ═══════════════════════════════════════════════════════════════════════════
export function getSenderSnapshot() {
  const ctx = getCurrentContext();
  return {
    sender_context: ctx.senderContext,
    context_type: ctx.type,
    context_id: ctx.id,
    from_name: ctx.senderName,
    from_email: ctx.senderEmail,
    sender_business_name: ctx.senderBusinessName,
    business_id: ctx.businessId
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Query scope helpers — enforce context isolation at the SQL level
// ═══════════════════════════════════════════════════════════════════════════

// Entries: context_type + context_id
export function applyEntriesScope(query, ctx) {
  if (!ctx) ctx = getCurrentContext();
  if (ctx.type === 'personal') {
    return query.eq('context_type', 'personal').eq('context_id', ctx.userId);
  }
  return query.eq('context_type', 'business').eq('business_id', ctx.businessId);
}

// Contacts: personal = user_id + business_id IS NULL, business = business_id
export function applyContactsScope(query, ctx) {
  if (!ctx) ctx = getCurrentContext();
  if (ctx.type === 'personal') {
    return query.eq('user_id', ctx.userId).is('business_id', null);
  }
  return query.eq('business_id', ctx.businessId);
}

// Templates: same pattern as contacts
export function applyTemplateScope(query, ctx) {
  if (!ctx) ctx = getCurrentContext();
  if (ctx.type === 'personal') {
    return query.eq('user_id', ctx.userId).is('business_id', null);
  }
  return query.eq('business_id', ctx.businessId);
}

// Recurring rules: same pattern as contacts
export function applyRecurringScope(query, ctx) {
  if (!ctx) ctx = getCurrentContext();
  if (ctx.type === 'personal') {
    return query.eq('user_id', ctx.userId).is('business_id', null);
  }
  return query.eq('business_id', ctx.businessId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Debug helper — catches context leaks in development
// ═══════════════════════════════════════════════════════════════════════════
export function assertScopedResult(records, ctx, tableName) {
  if (!records || !records.length) return;
  if (!ctx) ctx = getCurrentContext();
  for (const r of records) {
    if (tableName === 'contacts') {
      if (ctx.type === 'personal' && r.business_id) {
        console.error(`[CONTEXT LEAK] Business contact in personal ${tableName}:`, r.id, r.name);
      }
      if (ctx.type === 'business' && !r.business_id) {
        console.error(`[CONTEXT LEAK] Personal contact in business ${tableName}:`, r.id, r.name);
      }
    }
    if (tableName === 'entries') {
      if (ctx.type === 'personal' && r.context_type !== 'personal') {
        console.error(`[CONTEXT LEAK] Business entry in personal ${tableName}:`, r.id);
      }
      if (ctx.type === 'business' && r.context_type !== 'business') {
        console.error(`[CONTEXT LEAK] Personal entry in business ${tableName}:`, r.id);
      }
    }
  }
}
