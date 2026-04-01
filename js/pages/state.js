// ────────────────────────────────────────────────────────────────────────────
// Shared App State & Utilities
// ────────────────────────────────────────────────────────────────────────────
// This module provides:
// 1. workspaceSession — THE single source of truth for identity & scope
// 2. Legacy user/profile getters (thin wrappers around session)
// 3. Common UI utilities needed by all page renderers
//
// Architecture rule: frontend is a RENDERER, not a decider.
// Identity, business scope, and permissions come from the backend.

import { invalidateEntryCache } from '../entries.js';
import { supabase } from '../supabase.js';
import { toast } from '../ui.js';

// ═══════════════════════════════════════════════════════════════════════════
// WORKSPACE SESSION — single source of truth
// ═══════════════════════════════════════════════════════════════════════════
// Initialized ONCE after auth. Every data fetch reads from here.
// Business Suite can override it for cross-business operation.

const _session = {
  userId: null,
  userEmail: null,
  userDisplayName: null,
  businessId: null,       // the user's OWN business UUID
  businessName: null,
  role: null,             // 'owner' | 'operative' | 'member'
  permissions: null,
  scopes: null,
  isOwner: false,
  profile: null,          // full profile row from users table
  ready: false            // true once initSession completes
};

// Public read-only accessor — everything reads from this
export function getSession() { return _session; }

// Initialize workspace session — call ONCE after auth
export async function initSession(user, profile) {
  _session.userId = user.id;
  _session.userEmail = user.email;
  _session.userDisplayName = profile?.display_name || user.email?.split('@')[0] || '';
  _session.profile = profile;

  // Resolve own business via RPC
  try {
    const { data: bizId } = await supabase.rpc('my_business_id');
    if (bizId) {
      _session.businessId = bizId;
      // Get full workspace info
      const { data: ws } = await supabase.rpc('resolve_workspace', { p_business_id: bizId });
      if (ws && !ws.error) {
        _session.businessName = ws.business_name;
        _session.role = ws.role;
        _session.permissions = ws.permissions;
        _session.scopes = ws.scopes;
        _session.isOwner = ws.is_owner;
      }
    }
  } catch (err) {
    console.error('[initSession] Failed to resolve workspace:', err);
  }

  _session.ready = true;
  console.log('[session] Initialized:', _session.businessId, 'role:', _session.role);
}

// ── Legacy compat — pages still call these, thin wrappers ──────────────────
export function setCurrentUser(u) { if (u) { _session.userId = u.id; _session.userEmail = u.email; } }
export function getCurrentUser() {
  if (!_session.userId) return null;
  return { id: _session.userId, email: _session.userEmail };
}
export function setCurrentProfile(p) { _session.profile = p; }
export function getCurrentProfile() { return _session.profile; }

let _notifChannel = null;
export function setNotifChannel(c) { _notifChannel = c; }
export function getNotifChannel() { return _notifChannel; }

// ── Business ID — always from session, never guessed ───────────────────────
// getMyBusinessId() returns the user's OWN business. Always.
// For BS cross-business context, use getActiveBusinessId().
export function getMyBusinessId() { return _session.businessId; }

// getActiveBusinessId() returns whichever business is "active":
// - In BS: the BS context business (could be someone else's)
// - Otherwise: user's own business
export function getActiveBusinessId() {
  return window._bsContext?.businessId || _session.businessId;
}

// Legacy compat — these just call the same thing now
export async function initBusinessId() { return _session.businessId; }
export async function resolveBusinessId() { return getActiveBusinessId(); }

// ── Contact color: deterministic per ID, stored in localStorage ───────────
// Cache key includes version — bump to invalidate stale colors
const _CC_KEY = 'mxi_cc_v7';

// Soft matte user color palette — 11 tones for better variety (prime count = fewer collisions)
const USER_COLORS = [
  '#D88978','#A98AE0','#63C5B7','#71A8DB','#D5BA78','#D98DA0',
  '#7EAAC4','#C49B7A','#8FBE8F','#B896D4','#7ABFBF'
];

export function contactColor(id) {
  try {
    const stored = JSON.parse(localStorage.getItem(_CC_KEY) || '{}');
    if (stored[id]) return stored[id];
    // FNV-1a hash — much better distribution across colors than simple polynomial
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const color = USER_COLORS[h % USER_COLORS.length];
    stored[id] = color;
    localStorage.setItem(_CC_KEY, JSON.stringify(stored));
    return color;
  } catch (_) { return '#A98AE0'; }
}

// ── Contact avatar HTML ─────────────────────────────────────────────────────
export function contactAvatar(name, id, size = 32) {
  const col = contactColor(id);
  const initial = (name || '?').charAt(0).toUpperCase();
  return `<span class="contact-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.44)}px;background:${col};">${initial}</span>`;
}

// ── Pagination helper ───────────────────────────────────────────────────────
export const PAGE_SIZE = 10;

export function renderPagination(totalItems, currentPage, onClickFn) {
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  if (totalPages <= 1) return '';
  const maxVisible = 5;
  let pages = [];
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  let html = `<div class="pagination no-print">`;
  html += `<button class="pg-btn" ${currentPage===1?'disabled':''} onclick="${onClickFn}(${currentPage-1})">‹</button>`;
  if (start > 1) html += `<button class="pg-btn" onclick="${onClickFn}(1)">1</button>${start > 2 ? '<span style="padding:4px 6px;color:var(--muted);">…</span>' : ''}`;
  pages.forEach(p => { html += `<button class="pg-btn ${p===currentPage?'active':''}" onclick="${onClickFn}(${p})">${p}</button>`; });
  if (end < totalPages) html += `${end < totalPages-1 ? '<span style="padding:4px 6px;color:var(--muted);">…</span>' : ''}<button class="pg-btn" onclick="${onClickFn}(${totalPages})">${totalPages}</button>`;
  html += `<button class="pg-btn" ${currentPage===totalPages?'disabled':''} onclick="${onClickFn}(${currentPage+1})">›</button>`;
  html += `<span style="font-size:12px;color:var(--muted);padding:0 8px;">${totalItems} total</span></div>`;
  return html;
}

// ── Invalidate all entry caches (call after any create/update/delete) ──────
export function _invalidateEntries() {
  invalidateEntryCache(_session.userId);
  window._entriesAll = [];         // force re-fetch next renderEntries call
  window._pendingSharesAll = null; // force re-fetch pending received shares
}

// ── Currency amount formatter (dollars, not cents) ───────────────────────────
export function _fmtAmt(dollarAmount, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(dollarAmount);
  } catch(_) { return `${currency} ${dollarAmount.toFixed(2)}`; }
}

// ── Currency picker functions — exposed to window for onclick handlers ──────
export function setupCurrencyPicker() {
  window.setDefaultCurrency = async function(cur) {
    if (!_session.userId) return;
    // Write to 'users' table — same table getProfile() reads from
    await supabase.from('users').update({ default_currency: cur }).eq('id', _session.userId);
    if (_session.profile) _session.profile.default_currency = cur;
    toast('Default currency set to ' + cur, 'success');
    window.renderDash(); // re-render so hero reflects new currency immediately
  };

  window.toggleCurPicker = function(el) {
    let picker = document.getElementById('hero-cur-picker');
    if (!picker) return;
    const isOpen = picker.style.display !== 'none';
    if (isOpen) { picker.style.display = 'none'; return; }
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight;
    const dropH = Math.min(240, picker.scrollHeight || 240); // estimated height
    const spaceBelow = viewH - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    if (spaceBelow >= dropH || spaceBelow >= spaceAbove) {
      // Open downward — clamp so it never goes below viewport
      picker.style.top    = (rect.bottom + 6) + 'px';
      picker.style.bottom = 'auto';
      picker.style.maxHeight = Math.max(120, spaceBelow - 6) + 'px';
    } else {
      // Flip upward — open from button top upwards
      picker.style.bottom = (viewH - rect.top + 6) + 'px';
      picker.style.top    = 'auto';
      picker.style.maxHeight = Math.max(120, spaceAbove - 6) + 'px';
    }
    picker.style.left    = Math.max(4, Math.min(rect.left, window.innerWidth - 120)) + 'px';
    picker.style.display = 'block';
    // Scroll selected item into view
    const active = picker.querySelector('[data-cur-active]');
    if (active) active.scrollIntoView({ block: 'nearest' });
    setTimeout(() => {
      document.addEventListener('click', function _close(e) {
        if (!picker.contains(e.target) && e.target !== el) picker.style.display = 'none';
        document.removeEventListener('click', _close);
      });
    }, 0);
  };

  window.pickCurrency = async function(cur) {
    const picker = document.getElementById('hero-cur-picker');
    if (picker) picker.style.display = 'none';
    await window.setDefaultCurrency(cur);
  };
}
