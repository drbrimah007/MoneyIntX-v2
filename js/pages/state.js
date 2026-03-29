// ────────────────────────────────────────────────────────────────────────────
// Shared App State & Utilities
// ────────────────────────────────────────────────────────────────────────────
// This module provides shared state (currentUser, currentProfile, notifChannel)
// and common utility functions needed by all page renderers.
// State is set by the main script in index.html after authentication.

import { invalidateEntryCache } from '../entries.js';
import { supabase } from '../supabase.js';
import { toast } from '../ui.js';

// ── Shared app state ────────────────────────────────────────────────────────
let _currentUser = null;
let _currentProfile = null;
let _notifChannel = null;

export function setCurrentUser(u) { _currentUser = u; }
export function getCurrentUser() { return _currentUser; }
export function setCurrentProfile(p) { _currentProfile = p; }
export function getCurrentProfile() { return _currentProfile; }
export function setNotifChannel(c) { _notifChannel = c; }
export function getNotifChannel() { return _notifChannel; }

// ── Contact color: deterministic per ID, stored in localStorage ───────────
// Cache key includes version — bump to invalidate stale colors
const _CC_KEY = 'mxi_cc_v5';

export function contactColor(id) {
  try {
    const stored = JSON.parse(localStorage.getItem(_CC_KEY) || '{}');
    if (stored[id]) return stored[id];
    // Vivid HSL palette — 24 distinct hues
    const VIVID_HUES = [4,15,30,48,140,158,175,196,210,225,240,255,270,285,300,318,330,347,95,115,62,200,80,168];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const hue = VIVID_HUES[h % VIVID_HUES.length];
    // Saturation 65–75%, Lightness 55–63% — vivid on dark bg without looking washed out
    const sat = 65 + (h % 10);
    const lit = 55 + ((h >> 4) % 8);
    const color = `hsl(${hue}, ${sat}%, ${lit}%)`;
    stored[id] = color;
    localStorage.setItem(_CC_KEY, JSON.stringify(stored));
    return color;
  } catch (_) { return '#a5b4fc'; }
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
  invalidateEntryCache(_currentUser?.id);
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
    if (!_currentUser) return;
    // Write to 'users' table — same table getProfile() reads from
    await supabase.from('users').update({ default_currency: cur }).eq('id', _currentUser.id);
    if (_currentProfile) _currentProfile.default_currency = cur;
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
