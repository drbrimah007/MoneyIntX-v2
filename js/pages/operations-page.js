// Money IntX — My Ops Hub
// Unified launcher showing all businesses, groups, circles, investments the user belongs to

import { getCurrentUser, getCurrentProfile } from './state.js';
import { esc, toast, openModal, closeModal } from '../ui.js';
import { supabase } from '../supabase.js';

// ── Generate a BizID from any userId (mirrors _getBizId in business-suite-page) ──
function _genBizId(uid) {
  if (!uid) return 'BIZ-000000';
  const hash = uid.replace(/-/g, '').slice(0, 8).toUpperCase();
  return 'BIZ-' + hash;
}

// ── Type icons & labels ──────────────────────────────────────────
const TYPE_META = {
  business: { icon: '💼', label: 'Business', color: 'rgba(99,102,241,.15)', textColor: 'var(--accent,#6366F1)' },
  ledger:   { icon: '📊', label: 'Ledger',   color: 'rgba(99,214,154,.15)', textColor: 'var(--green,#7fe0d0)' },
  group:    { icon: '👥', label: 'Group',     color: 'rgba(251,191,36,.15)', textColor: '#f59e0b' },
  circle:   { icon: '🔄', label: 'Circle',    color: 'rgba(236,72,153,.15)', textColor: '#ec4899' },
  investment:{ icon: '📈', label: 'Investment',color: 'rgba(59,130,246,.15)', textColor: '#3b82f6' },
  custom:   { icon: '🔧', label: 'Custom',    color: 'rgba(156,163,175,.15)',textColor: 'var(--muted)' }
};

// ── Role display ─────────────────────────────────────────────────
function roleBadge(role) {
  const colors = {
    owner:    { bg: 'rgba(99,102,241,.18)', fg: 'var(--accent,#6366F1)' },
    admin:    { bg: 'rgba(236,72,153,.15)', fg: '#ec4899' },
    operative:{ bg: 'rgba(251,191,36,.15)', fg: '#f59e0b' },
    investor: { bg: 'rgba(59,130,246,.15)', fg: '#3b82f6' },
    member:   { bg: 'rgba(156,163,175,.15)',fg: 'var(--muted)' },
    observer: { bg: 'rgba(156,163,175,.12)',fg: 'var(--muted)' }
  };
  const c = colors[role] || colors.member;
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:${c.bg};color:${c.fg};">${label}</span>`;
}

// ── Permission chips ─────────────────────────────────────────────
function permChips(perms) {
  if (!perms || !perms.length) return '';
  return perms.map(p =>
    `<span style="font-size:10px;padding:1px 6px;border-radius:6px;background:var(--bg3,rgba(255,255,255,.06));color:var(--muted);white-space:nowrap;">${esc(p)}</span>`
  ).join(' ');
}

// ── Fetch & normalize all memberships ────────────────────────────
async function fetchOperations(userId) {
  const ops = [];

  // 1) Business panels — owned
  const { data: ownedPanels } = await supabase
    .from('business_panels')
    .select('id, title, currency, session_type, fields, is_public, user_id, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  (ownedPanels || []).forEach(p => {
    ops.push({
      entity_id: p.id,
      entity_type: 'ledger',
      entity_name: p.title,
      role: 'owner',
      owner_user_id: userId,
      permissions: ['Ledger', 'Fields', 'Members', 'Archive'],
      status: 'active',
      currency: p.currency,
      last_active: p.updated_at,
      _nav: { page: 'business', panel: p.id }
    });
  });

  // 2) Business panels — shared with me
  const { data: sharedPanels } = await supabase
    .from('business_panel_members')
    .select('can_add, can_edit, added_at, panel:panel_id(id, title, currency, session_type, user_id, business_id, updated_at)')
    .eq('member_user_id', userId);

  (sharedPanels || []).forEach(s => {
    if (!s.panel) return;
    const perms = ['View'];
    if (s.can_add) perms.push('Add Rows');
    if (s.can_edit) perms.push('Edit Rows');
    ops.push({
      entity_id: s.panel.id,
      entity_type: 'ledger',
      entity_name: s.panel.title,
      role: s.can_edit ? 'operative' : (s.can_add ? 'member' : 'observer'),
      owner_user_id: s.panel.user_id,
      business_id: s.panel.business_id || null,
      permissions: perms,
      status: 'active',
      currency: s.panel.currency,
      last_active: s.panel.updated_at,
      _nav: { page: 'business', panel: s.panel.id }
    });
  });

  // 3) Groups — owned
  const { data: ownedGroups } = await supabase
    .from('groups')
    .select('id, name, currency, use_rotation, frequency, updated_at, user_id')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });

  (ownedGroups || []).forEach(g => {
    const eType = g.use_rotation ? 'circle' : 'group';
    ops.push({
      entity_id: g.id,
      entity_type: eType,
      entity_name: g.name,
      role: 'owner',
      owner_user_id: userId,
      permissions: ['Contributions', 'Rounds', 'Members', 'Notices'],
      status: 'active',
      currency: g.currency,
      last_active: g.updated_at,
      _nav: { page: 'groups', group: g.id }
    });
  });

  // 4) Groups — member of (not owner)
  const { data: groupMemberships } = await supabase
    .from('group_members')
    .select('role, status, joined_at, group:group_id(id, name, currency, use_rotation, user_id, updated_at, archived_at)')
    .eq('user_id', userId)
    .eq('status', 'active');

  (groupMemberships || []).forEach(gm => {
    if (!gm.group || gm.group.archived_at) return;
    // Skip if we already own it
    if (gm.group.user_id === userId) return;
    const eType = gm.group.use_rotation ? 'circle' : 'group';
    ops.push({
      entity_id: gm.group.id,
      entity_type: eType,
      entity_name: gm.group.name,
      role: gm.role || 'member',
      owner_user_id: gm.group.user_id,
      permissions: ['Contributions', 'Notices'],
      status: 'active',
      currency: gm.group.currency,
      last_active: gm.group.updated_at,
      _nav: { page: 'groups', group: gm.group.id }
    });
  });

  // 5) Investments — owned
  const { data: ownedInvestments } = await supabase
    .from('investments')
    .select('id, name, type, venture_type, status, currency, updated_at, user_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false });

  (ownedInvestments || []).forEach(inv => {
    ops.push({
      entity_id: inv.id,
      entity_type: 'investment',
      entity_name: inv.name,
      role: 'owner',
      owner_user_id: userId,
      permissions: ['Transactions', 'Members', 'Files', 'Notices'],
      status: 'active',
      currency: inv.currency,
      investmentType: inv.type,
      last_active: inv.updated_at,
      _nav: { page: 'investments', investment: inv.id }
    });
  });

  // 6) Investments — member of (not owner)
  const { data: investmentMemberships } = await supabase
    .from('investment_members')
    .select('role, joined_at, investment:investment_id(id, name, type, venture_type, status, currency, user_id, updated_at)')
    .eq('user_id', userId);

  (investmentMemberships || []).forEach(im => {
    if (!im.investment || im.investment.status !== 'active') return;
    if (im.investment.user_id === userId) return;
    const perms = ['View'];
    if (im.role === 'admin') perms.push('Transactions', 'Members', 'Files', 'Notices');
    else perms.push('Files', 'Notices');
    ops.push({
      entity_id: im.investment.id,
      entity_type: 'investment',
      entity_name: im.investment.name,
      role: im.role || 'investor',
      owner_user_id: im.investment.user_id,
      permissions: perms,
      status: 'active',
      currency: im.investment.currency,
      investmentType: im.investment.type,
      last_active: im.investment.updated_at,
      _nav: { page: 'investments', investment: im.investment.id }
    });
  });

  // 7) Businesses — from business_members table via RPC
  try {
    const { data: myBiz } = await supabase.rpc('list_my_businesses');
    const bizList = (myBiz && Array.isArray(myBiz)) ? myBiz : (myBiz ? JSON.parse(myBiz) : []);
    bizList.forEach(b => {
      ops.push({
        entity_id: b.business_id,
        entity_type: 'business',
        entity_name: b.name || 'Business',
        role: b.role || 'operative',
        owner_user_id: b.owner_id,
        business_id: b.business_id,
        permissions: b.is_owner ? ['Invoices', 'Bills', 'Clients', 'Suppliers', 'Ledgers', 'Recurring'] : ['View'],
        status: 'active',
        currency: '',
        last_active: new Date().toISOString(),
        _nav: { page: 'business-suite' }
      });
    });
  } catch(e) { console.warn('[ops] list_my_businesses error:', e); }

  // Sort: most recently active first
  ops.sort((a, b) => {
    if (!a.last_active) return 1;
    if (!b.last_active) return -1;
    return new Date(b.last_active) - new Date(a.last_active);
  });

  return ops;
}

// ── Build a single operation card ────────────────────────────────
function opCard(op) {
  const meta = TYPE_META[op.entity_type] || TYPE_META.custom;
  const enterLabel = op.entity_type === 'business' ? 'Enter Business' :
                     op.entity_type === 'ledger' ? 'Open Ledger' :
                     op.entity_type === 'investment' ? 'Open Investment' :
                     op.entity_type === 'circle' ? 'Enter Circle' :
                     op.entity_type === 'group' ? 'Enter Group' : 'Open';

  // Encode nav as base64 to avoid all HTML/JS escaping issues in inline onclick
  const navB64 = btoa(JSON.stringify(op._nav));

  return `<div class="card ops-card" style="padding:16px 18px;display:flex;align-items:center;gap:14px;cursor:pointer;"
    onclick="window._opsEnter(atob('${navB64}'))">
    <div style="width:42px;height:42px;border-radius:12px;background:${meta.color};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${meta.icon}</div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <span style="font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(op.entity_name)}</span>
        <span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px;background:${meta.color};color:${meta.textColor};">${meta.label}</span>
        ${roleBadge(op.role)}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        ${permChips(op.permissions)}
      </div>
    </div>
    <button class="btn btn-primary btn-sm" style="white-space:nowrap;flex-shrink:0;" onclick="event.stopPropagation();window._opsEnter(atob('${navB64}'))">${enterLabel}</button>
  </div>`;
}

// ── Context bar helpers ───────────────────────────────────────────
const _OPS_CTX_KEY = 'mxi_ops_context';

function _showContextBar(entityName, entityType) {
  const bar = document.getElementById('ops-context-bar');
  const label = document.getElementById('ops-context-label');
  if (!bar || !label) return;
  const meta = TYPE_META[entityType] || TYPE_META.custom;
  const profile = getCurrentProfile();
  const userName = profile?.display_name || profile?.email || 'You';
  label.innerHTML = `Signed in as: <strong>${esc(userName)}</strong> &nbsp;·&nbsp; Working in: <strong>${meta.icon} ${esc(entityName)}</strong>`;
  bar.style.display = '';
  window._opsActiveContext = { name: entityName, type: entityType };
  // Persist so it survives page navigation
  try { localStorage.setItem(_OPS_CTX_KEY, JSON.stringify(window._opsActiveContext)); } catch(_) {}
}

function _hideContextBar() {
  const bar = document.getElementById('ops-context-bar');
  if (bar) bar.style.display = 'none';
  window._opsActiveContext = null;
  try { localStorage.removeItem(_OPS_CTX_KEY); } catch(_) {}
}

// Called by navTo in index.html to restore the bar after page switches
window._opsRestoreContextBar = function() {
  try {
    const saved = JSON.parse(localStorage.getItem(_OPS_CTX_KEY) || 'null');
    if (saved && saved.name) {
      _showContextBar(saved.name, saved.type);
    }
  } catch(_) {}
};

window._opsClearContext = function() {
  _hideContextBar();
  window.navTo('operations');
};

// ── Navigation handler ───────────────────────────────────────────
window._opsEnter = function(navJson) {
  try {
    const nav = JSON.parse(navJson);

    // Find the matching op
    const ops = window._opsData || [];
    const match = ops.find(o => JSON.stringify(o._nav) === JSON.stringify(nav));
    if (match) _trackRecent(match.entity_id);

    // ── Set BS context SYNCHRONOUSLY before any navTo ──
    const ownerUserId = match?.owner_user_id || getCurrentUser()?.id || '';
    const _usesBsChrome = nav.page === 'business-suite' || (nav.page === 'business' && nav.panel);
    const currentUserId = getCurrentUser()?.id || '';

    if (_usesBsChrome) {
      // Set minimal context with businessId — renderBusinessSuite will resolve via RPC
      let bizId = match?.business_id || null;
      // Fallback: if shared ledger has no business_id, try to resolve from owner
      if (!bizId && match?.owner_user_id && match.owner_user_id !== currentUserId) {
        // Will be resolved by renderBusinessSuite via resolve_workspace RPC
        // For now store owner_user_id so we can look it up
      }
      window._bsContext = {
        businessId: bizId,
        ownerId: ownerUserId || null,
        ownerName: match?.entity_name || '',
        ownerLogo: null,
        ownerBizId: null,
        businessCurrency: 'USD',
        role: null,
        permissions: {},
        scopes: {},
        isActive: !!bizId
      };
      // One-shot flag: tells navTo this is an ops-routed entry (don't reset identity)
      window._bsOpsRouted = true;
      _hideContextBar();
    } else if (match) {
      _showContextBar(match.entity_name, match.entity_type);
    }

    // ── Route ──
    if (nav.page === 'business-suite') {
      window.navTo('business-suite');
    } else if (nav.page === 'business' && nav.panel) {
      // Route ledgers through Business Suite chrome
      window.navTo('business-suite');
      setTimeout(() => {
        if (window._bsNavigate) window._bsNavigate('bs-panels');
        setTimeout(() => {
          if (window._bpEngine) window._bpEngine.openPanel(nav.panel);
          else console.warn('[opsEnter] _bpEngine not ready for panel', nav.panel);
        }, 300);
      }, 300);
    } else if (nav.page === 'groups' && nav.group) {
      window.navTo('groups');
      setTimeout(() => {
        if (window.openGroupDetail) window.openGroupDetail(nav.group);
      }, 300);
    } else if (nav.page === 'investments' && nav.investment) {
      window.navTo('investments');
      setTimeout(() => {
        if (window.openInvestmentDetail) window.openInvestmentDetail(nav.investment);
      }, 300);
    } else {
      window.navTo(nav.page || 'dash');
    }
  } catch (e) {
    console.error('[opsEnter]', e);
  }
};

// ── Main Render ──────────────────────────────────────────────────
export async function renderOperations(el) {
  const currentUser = getCurrentUser();
  if (!currentUser) { el.innerHTML = '<p style="color:var(--muted);padding:24px;">Please sign in.</p>'; return; }

  el.innerHTML = `<div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
    <h2 style="margin:0;">My Ops</h2>
  </div>
  <p style="color:var(--muted);padding:12px 0 0;font-size:13px;">Loading your operations...</p>`;

  let ops = [];
  try {
    ops = await fetchOperations(currentUser.id);
  } catch (e) {
    console.error('[renderOperations]', e);
    el.innerHTML += `<p style="color:var(--red);padding:20px;">Error loading operations.</p>`;
    return;
  }

  // Store for filtering
  window._opsData = ops;
  window._opsFilter = 'all';
  window._opsSearch = '';

  _renderOpsContent(el, ops);
}

function _renderOpsContent(el, allOps) {
  const filter = window._opsFilter || 'all';
  const search = (window._opsSearch || '').toLowerCase().trim();

  // Apply filter
  let ops = allOps;
  if (filter !== 'all') {
    ops = ops.filter(o => o.entity_type === filter);
  }
  // Apply search
  if (search) {
    ops = ops.filter(o => o.entity_name.toLowerCase().includes(search));
  }

  const active = ops.filter(o => o.status === 'active');
  const pending = ops.filter(o => o.status === 'pending');

  // Recent: last 3 unique entities visited (stored in localStorage)
  const recentIds = _getRecent();
  const recent = recentIds.map(id => allOps.find(o => o.entity_id === id)).filter(Boolean).slice(0, 3);

  // Filter chips
  const types = ['all', 'business', 'ledger', 'group', 'circle', 'investment'];
  const filterBar = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
    ${types.map(t => {
      const isActive = filter === t;
      const label = t === 'all' ? 'All' : (TYPE_META[t]?.label || t);
      const count = t === 'all' ? allOps.length : allOps.filter(o => o.entity_type === t).length;
      if (t !== 'all' && count === 0) return '';
      return `<button onclick="window._opsSetFilter('${t}')"
        style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:${isActive ? '700' : '500'};
        background:${isActive ? 'var(--accent,#6366F1)' : 'var(--bg3,rgba(255,255,255,.06))'};
        color:${isActive ? '#fff' : 'var(--muted)'};border:none;cursor:pointer;">
        ${label} ${count > 0 ? `<span style="opacity:.7;">(${count})</span>` : ''}
      </button>`;
    }).join('')}
  </div>`;

  // Search bar
  const searchBar = `<div style="margin-bottom:16px;">
    <input type="text" id="ops-search" placeholder="Search operations..."
      value="${esc(window._opsSearch || '')}"
      oninput="window._opsSearchInput(this.value)"
      style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:14px;outline:none;">
  </div>`;

  let html = `<div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
    <h2 style="margin:0;">My Ops</h2>
  </div>
  <p style="color:var(--muted);font-size:13px;margin:4px 0 16px;">Everywhere you belong and everywhere you can work.</p>
  ${searchBar}
  ${filterBar}`;

  // Recent section (only when not searching/filtering)
  if (!search && filter === 'all' && recent.length > 0) {
    html += `<div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:0 0 8px;">Recent</div>
      <div style="display:grid;gap:8px;">
        ${recent.map(o => opCard(o)).join('')}
      </div>
    </div>`;
  }

  // Active operations
  if (active.length > 0) {
    html += `<div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:0 0 8px;">Active Operations${filter !== 'all' ? ` — ${TYPE_META[filter]?.label || filter}` : ''}</div>
      <div style="display:grid;gap:8px;">
        ${active.map(o => opCard(o)).join('')}
      </div>
    </div>`;
  }

  // Pending invitations
  if (pending.length > 0) {
    html += `<div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:0 0 8px;">Pending Invitations</div>
      <div style="display:grid;gap:8px;">
        ${pending.map(o => opCard(o)).join('')}
      </div>
    </div>`;
  }

  // Empty state
  if (!active.length && !pending.length) {
    if (search || filter !== 'all') {
      html += `<div class="card" style="text-align:center;padding:40px 24px;">
        <div style="font-size:36px;margin-bottom:10px;">🔍</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px;">No matches</div>
        <p style="color:var(--muted);font-size:13px;">Try a different search or filter.</p>
      </div>`;
    } else {
      html += `<div class="card" style="text-align:center;padding:48px 24px;">
        <div style="font-size:48px;margin-bottom:12px;">🏢</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">No operations yet</div>
        <p style="color:var(--muted);margin-bottom:20px;font-size:14px;">When you create or join businesses, groups, circles, or investments, they'll appear here.</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="navTo('business-suite')">Open Business Suite</button>
          <button class="btn btn-secondary btn-sm" onclick="navTo('groups')">Create Group</button>
          <button class="btn btn-secondary btn-sm" onclick="navTo('investments')">New Investment</button>
        </div>
      </div>`;
    }
  }

  el.innerHTML = html;
}

// ── Filter & search handlers ─────────────────────────────────────
window._opsSetFilter = function(f) {
  window._opsFilter = f;
  const el = document.getElementById('content');
  if (el && window._opsData) _renderOpsContent(el, window._opsData);
};

let _opsSearchTimer = null;
window._opsSearchInput = function(val) {
  window._opsSearch = val;
  clearTimeout(_opsSearchTimer);
  _opsSearchTimer = setTimeout(() => {
    const el = document.getElementById('content');
    if (el && window._opsData) _renderOpsContent(el, window._opsData);
  }, 250);
};

// ── Recent tracking (localStorage) ──────────────────────────────
function _recentKey() {
  const u = getCurrentUser();
  return 'mxi_ops_recent_' + (u?.id || 'default');
}

function _getRecent() {
  try {
    return JSON.parse(localStorage.getItem(_recentKey()) || '[]');
  } catch (_) { return []; }
}

function _trackRecent(entityId) {
  const key = _recentKey();
  let recent = _getRecent().filter(id => id !== entityId);
  recent.unshift(entityId);
  if (recent.length > 10) recent = recent.slice(0, 10);
  try { localStorage.setItem(key, JSON.stringify(recent)); } catch (_) {}
}

// Hide context bar when navigating to operations page
window.addEventListener('hashchange', () => {
  const hash = (window.location.hash || '').replace('#', '').split('?')[0];
  if (hash === 'operations' || hash === 'dash') _hideContextBar();
});
