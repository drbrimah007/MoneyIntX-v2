// ────────────────────────────────────────────────────────────────────────────
// Business Suite Page — Self-contained business environment
// ────────────────────────────────────────────────────────────────────────────
// Left-side menu with business-branded tools:
//   Dashboard, Invoices, Clients, Suppliers, Business Ledgers, Templates,
//   Recurring, Investments, Ledger Public DB, Settings/Tools
// ────────────────────────────────────────────────────────────────────────────

import { getCurrentUser, getCurrentProfile, contactColor, contactAvatar, renderPagination, PAGE_SIZE, _fmtAmt } from './state.js';
import { esc, toast, openModal, closeModal, fmtDate, fmtRelative, statusBadge, TX_LABELS, TX_COLORS } from '../ui.js';
import { supabase } from '../supabase.js';
import { listContacts } from '../contacts.js';
import { fmtMoney, createEntry } from '../entries.js';
import { listTemplates, listPublicTemplates, copyPublicTemplate } from '../templates.js';
import { listRecurring, FREQUENCIES } from '../recurring.js';
import { listPanels } from '../business-panels.js';

// ── State ─────────────────────────────────────────────────────────
let _bsSection = 'bs-dash';       // current active section
let _bsContacts = [];              // cached contacts
let _bsEntries = [];               // cached business entries
let _bsEl = null;                  // content element ref

// ── Business ID ──────────────────────────────────────────────────
// Returns the active workspace's real business UUID from the businesses table.
function _getBizId() {
  const ctx = window._bsContext;
  if (ctx?.isActive && ctx.businessId) return ctx.businessId;
  return null;
}
// Returns short display ID from UUID (for UI display only)
function _getBizDisplayId(bizUuid) {
  if (!bizUuid) return 'BIZ-000000';
  return 'BIZ-' + bizUuid.replace(/-/g,'').slice(0,8).toUpperCase();
}

// ── Business Suite Tool Registry ──────────────────────────────────
const BS_TOOLS = [
  { id: 'bs-dash',       icon: '📊', label: 'Overview',         always: true },
  { id: 'bs-invoices',   icon: '🧾', label: 'Invoices',         always: true },
  { id: 'bs-bills',      icon: '📄', label: 'Bills',            always: true },
  { id: 'bs-clients',    icon: '👥', label: 'Clients',          always: true },
  { id: 'bs-suppliers',  icon: '🏪', label: 'Suppliers',        always: true },
  { id: 'bs-recurring',  icon: '🔁', label: 'Recurring',        always: false },
  { id: 'bs-panels',     icon: '📋', label: 'Ledgers',           always: true },
  { id: 'bs-templates',  icon: '📑', label: 'Templates',        always: false },
  { id: 'bs-investments',icon: '📈', label: 'Investments',      always: false },
  { id: 'bs-branding',   icon: '🏷️', label: 'Branding',          always: false },
  { id: 'bs-operatives', icon: '🔑', label: 'Team & Roles',      always: true },
  { id: 'bs-settings',   icon: '⚙️', label: 'Suite Settings',   always: true },
];

// ── Constants ────────────────────────────────────────────────────
const BS_CURRENCIES = ['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','CNY','BRL','MXN','AED','SAR','QAR','KWD','EGP','MAD','TZS','UGX','ETB','XOF','CHF'];
// tx_type variants: entries-page maps invoice_sent→'invoice', bill_sent→'bill'
// We must query for BOTH to find all business entries regardless of creation path
const BS_INVOICE_TYPES = ['invoice_sent', 'invoice'];
const BS_BILL_TYPES = ['bill_sent', 'bill'];
const BS_ALL_BIZ_TYPES = ['invoice_sent', 'invoice', 'bill_sent', 'bill'];
const BS_EXPENSE_CATEGORIES = ['Stock/Inventory','Transport/Logistics','Utilities','Rent/Lease','Salaries/Wages','Marketing/Ads','Insurance','Professional Services','Office Supplies','Equipment','Maintenance','Travel','Telecommunications','Taxes/Fees','Miscellaneous'];

// ── Business Context Tracker (LEGACY — now handled by business_id column) ──
// These are kept as no-ops for backward compatibility with any code that calls them.
// Everything is now scoped by business_id on the database tables themselves.
function _getBsItems() { return { templates: [], panels: [], recurring: [], investments: [] }; }
function _addBsItem(_type, _id) {}
function _removeBsItem(_type, _id) {}
function _isBsItem(_type, _id) { return true; } // Everything in the query IS a business item now

// ── Helpers ───────────────────────────────────────────────────────
function _bsModKey() { return 'mxi_bs_tools_' + (getCurrentUser()?.id || 'def'); }

function _getBsTools() {
  try {
    const raw = localStorage.getItem(_bsModKey());
    if (raw) return JSON.parse(raw);
  } catch(_) {}
  // Default: all tools enabled
  const d = {};
  BS_TOOLS.forEach(t => { d[t.id] = true; });
  try { localStorage.setItem(_bsModKey(), JSON.stringify(d)); } catch(_) {}
  return d;
}

function _setBsTools(obj) {
  try { localStorage.setItem(_bsModKey(), JSON.stringify(obj)); } catch(_) {}
}

function _isBsToolEnabled(id) {
  const t = BS_TOOLS.find(x => x.id === id);
  if (t?.always) return true;
  return _getBsTools()[id] !== false;
}

// ── Expose BS tracker functions to window for external modules ──────
window._addBsItem = _addBsItem;
window._removeBsItem = _removeBsItem;
window._isBsItem = _isBsItem;
window._getBsItems = _getBsItems;
window._getBizId = _getBizId;

// ── Context-aware data scoping ───────────────────────────────────
// Returns the active business UUID for all data queries.
// This is THE canonical way to scope any query in BS.
function _bsBusinessId() {
  const ctx = window._bsContext;
  if (ctx?.businessId) return ctx.businessId;
  // Fallback to session's own business
  if (window.getSession) return window.getSession().businessId || null;
  return null;
}
// Legacy compat shim — old code that calls _bsDataOwnerId() still works
function _bsDataOwnerId() {
  const ctx = window._bsContext;
  return ctx?.ownerId || getCurrentUser()?.id;
}
function _bsDataBizId() { return _bsBusinessId(); }

// ── Centralized Business Context ─────────────────────────────────
// Single source of truth for all BS identity state.
// Populated by resolve_workspace() RPC — never manually assembled.
window._bsContext = {
  businessId: null,     // UUID from businesses table — THE key
  ownerId: null,        // owner's auth.uid
  ownerName: null,
  ownerLogo: null,
  ownerBizId: null,     // display-only short ID
  businessCurrency: 'USD',
  role: null,           // 'owner' | 'admin' | 'operative'
  permissions: {},
  scopes: {},
  isActive: false
};

// Set context from resolve_workspace() RPC result
window.setBsContext = function(wsData) {
  window._bsContext = {
    businessId: wsData.business_id,
    ownerId: wsData.owner_id,
    ownerName: wsData.business_name || 'Business Suite',
    ownerLogo: wsData.business_logo || null,
    ownerBizId: _getBizDisplayId(wsData.business_id),
    businessCurrency: wsData.business_currency || 'USD',
    businessEmail: wsData.business_email || '',
    businessPhone: wsData.business_phone || '',
    businessWebsite: wsData.business_website || '',
    businessAddress: wsData.business_address || '',
    role: wsData.role || 'owner',
    permissions: wsData.permissions || {},
    scopes: wsData.scopes || {},
    isActive: true
  };
  // Legacy shims
  window._bsActiveContext = true;
  window._bsActiveBizId = window._bsContext.ownerBizId;
  window._bsOwnerUserId = wsData.owner_id;
  window._bsIsOwnBusiness = (wsData.role === 'owner');
  // Persist operative's working business so it survives page navigation
  if (wsData.role !== 'owner') {
    try { sessionStorage.setItem('mxi_bs_operative_biz', wsData.business_id); } catch(_) {}
  } else {
    try { sessionStorage.removeItem('mxi_bs_operative_biz'); } catch(_) {}
  }
};

window.clearBsContext = function() {
  window._bsContext = {
    businessId: null, ownerId: null, ownerName: null, ownerLogo: null,
    ownerBizId: null, businessCurrency: 'USD', role: null,
    permissions: {}, scopes: {}, isActive: false
  };
  if (typeof window.clearBsAccess === 'function') window.clearBsAccess();
  window._bsActiveContext = false;
  window._bsActiveBizId = '';
  window._bsOwnerUserId = null;
  window._bsIsOwnBusiness = true;
  window._bsOpsRouted = false;
  // Hard-reset ledger panel state so foreign panels don't persist
  if (window._bpEngine?.resetPanelState) window._bpEngine.resetPanelState();
  // Clear ALL BS transient state: selections, filters, pages, search
  window._bsSel = {};
  window._bsPg = {};
  window._bsInvFilter = 'all';  window._bsInvSearch = '';
  window._bsBillFilter = 'all'; window._bsBillSearch = '';
  window._bsRecFilter = 'all';
  window._bsTmplTab = 'mine';   window._bsTmplSearch = '';
  window._bsPanelTab = 'mine';
  window._bsMembersCache = [];
};

// ── Business Access Context (Layer 2: Permissions) ───────────────
// Separate from identity — controls what the acting user can do.
const FULL_OWNER_PERMISSIONS = {
  clients_read: true, clients_write: true,
  invoices_read: true, invoices_create: true, invoices_edit: true,
  bills_read: true, bills_create: true, bills_edit: true,
  ledgers_read: true, ledgers_write: true,
  templates_read: true, templates_create: true,
  recurring_read: true, recurring_create: true,
  investments_read: true, investments_write: true,
  branding_manage: true, operatives_manage: true, settings_manage: true
};

const DEFAULT_OPERATIVE_PERMISSIONS = {
  clients_read: true, clients_write: false,
  invoices_read: true, invoices_create: false, invoices_edit: false,
  bills_read: true, bills_create: false, bills_edit: false,
  ledgers_read: true, ledgers_write: false,
  templates_read: true, templates_create: false,
  recurring_read: true, recurring_create: false,
  investments_read: false, investments_write: false,
  branding_manage: false, operatives_manage: false, settings_manage: false
};

window._bsAccess = {
  actingUserId: null,
  ownerId: null,
  sharedPanelId: null,
  permissions: { ...DEFAULT_OPERATIVE_PERMISSIONS },
  isOperative: false
};

window.setBsAccess = function({ actingUserId, ownerId, sharedPanelId, permissions, isOperative }) {
  window._bsAccess = {
    actingUserId: actingUserId || null,
    ownerId: ownerId || null,
    sharedPanelId: sharedPanelId || null,
    permissions: permissions || { ...DEFAULT_OPERATIVE_PERMISSIONS },
    isOperative: !!isOperative
  };
};

window.clearBsAccess = function() {
  window._bsAccess = {
    actingUserId: null,
    ownerId: null,
    sharedPanelId: null,
    permissions: { ...DEFAULT_OPERATIVE_PERMISSIONS },
    isOperative: false
  };
};

// Check a specific permission — returns true if allowed
window.bsCanDo = function(action) {
  const ctx = window._bsContext;
  if (!ctx?.isActive) return false;
  // Owner and admin have all permissions
  if (ctx.role === 'owner' || ctx.role === 'admin') return true;
  // Operatives check against their permission grant from business_members
  return !!ctx.permissions?.[action];
};

// Expose constants for external modules
window.FULL_OWNER_PERMISSIONS = FULL_OWNER_PERMISSIONS;
window.DEFAULT_OPERATIVE_PERMISSIONS = DEFAULT_OPERATIVE_PERMISSIONS;

// ── Business sender identity ──────────────────────────────────────
// Returns the business name ONLY when BS context is active; otherwise null.
// Callers must provide their own personal-name fallback.
window._getBsSenderName = function() {
  const ctx = window._bsContext;
  if (ctx?.isActive && ctx.ownerName) return ctx.ownerName;
  // NOT in BS context — return null so callers use personal identity
  if (!window._bsActiveContext || !window._bsActiveBizId) return null;
  const profile = getCurrentProfile() || {};
  return profile.company_name || null;
};
window._getBsSenderEmail = function() {
  if (!window._bsActiveContext || !window._bsActiveBizId) {
    return getCurrentUser()?.email || '';
  }
  const profile = getCurrentProfile() || {};
  return profile.company_email || getCurrentUser()?.email || '';
};

// ── Main Render ───────────────────────────────────────────────────
export async function renderBusinessSuite(el) {
  _bsEl = el;
  const currentUser = getCurrentUser();
  if (!currentUser) { el.innerHTML = '<p style="color:var(--muted);padding:20px;">Please log in.</p>'; return; }

  // Show loading state immediately to prevent flash of previous page content
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:60px 20px;gap:12px;">
    <div style="width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;"></div>
    <span style="color:var(--muted);font-size:14px;">Loading Business Suite…</span>
  </div>`;

  // Expand content area for suite layout (remove max-width constraint)
  const contentEl = document.getElementById('content');
  if (contentEl) { contentEl.style.maxWidth = 'none'; contentEl.style.margin = '0'; }
  const mainEl = document.getElementById('main');
  if (mainEl) { mainEl.style.padding = '0'; }

  // ── Resolve workspace via RPC ──
  // Determines which business we're in and what permissions the user has.
  // If _bsContext.businessId is already set (e.g. by ops entry), use it.
  // Otherwise resolve the user's own business.
  let ctx = window._bsContext;
  let targetBizId = ctx?.businessId || null;

  if (!targetBizId) {
    // Check if operative was previously working in a foreign business
    try {
      const savedOpBiz = sessionStorage.getItem('mxi_bs_operative_biz');
      if (savedOpBiz) targetBizId = savedOpBiz;
    } catch(_) {}
  }

  if (!targetBizId) {
    // No business selected — resolve user's own business via RPC
    // my_business_id now checks both owned + member businesses
    const { data: myBiz, error: myBizErr } = await supabase.rpc('my_business_id');
    if (myBizErr || !myBiz) {
      console.error('[BS] Could not resolve own business:', myBizErr?.message);
      el.innerHTML = '<p style="color:var(--red);padding:20px;">Could not load business. Please refresh.</p>';
      return;
    }
    targetBizId = myBiz;
  }

  // Fetch all businesses the user belongs to (for switcher UI)
  let _allMyBizzes = [];
  try {
    const { data: bizList } = await supabase.rpc('my_businesses');
    _allMyBizzes = bizList || [];
  } catch(_) {}
  window._bsAllBusinesses = _allMyBizzes;

  // Call resolve_workspace RPC — single call gets business info + role + permissions
  const { data: wsData, error: wsErr } = await supabase.rpc('resolve_workspace', { p_business_id: targetBizId });
  if (wsErr || !wsData || wsData.error) {
    console.error('[BS] resolve_workspace failed:', wsErr?.message || wsData?.error);
    el.innerHTML = '<p style="color:var(--red);padding:20px;">Access denied or business not found.</p>';
    return;
  }

  // Set the full context from RPC result
  setBsContext(wsData);
  ctx = window._bsContext;

  const bizName = ctx.ownerName || 'Business Suite';
  const bizLogo = ctx.ownerLogo || '';
  const bizId = ctx.ownerBizId || 'BIZ-000000';
  const isOwnBusiness = ctx.role === 'owner';

  // Set legacy access context for backward compat
  setBsAccess({
    actingUserId: currentUser.id,
    ownerId: ctx.ownerId,
    sharedPanelId: null,
    permissions: ctx.permissions || FULL_OWNER_PERMISSIONS,
    isOperative: ctx.role === 'operative'
  });

  // Build logo HTML — show image if available, else first letter
  const logoHtml = bizLogo
    ? `<img src="${esc(bizLogo)}" style="width:36px;height:36px;border-radius:8px;object-fit:contain;flex-shrink:0;" alt="">`
    : `<div style="width:36px;height:36px;border-radius:8px;background:var(--accent,#6366F1);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;flex-shrink:0;">${bizName.charAt(0).toUpperCase()}</div>`;

  // Operative badge — show when working in someone else's business
  const opBadge = !isOwnBusiness
    ? `<div style="font-size:10px;color:var(--accent,#6366F1);font-weight:600;margin-top:2px;">⚡ Operative</div>`
    : '';

  // Restore last section
  try { _bsSection = localStorage.getItem('mxi_bs_section') || 'bs-dash'; } catch(_) {}

  const enabledTools = _getBsTools();

  // Permission map: sidebar section → required permission
  const SECTION_PERMS = {
    'bs-dash': null,              // always visible
    'bs-invoices': 'invoices_read',
    'bs-bills': 'bills_read',
    'bs-clients': 'clients_read',
    'bs-suppliers': 'clients_read',  // suppliers share client permission
    'bs-recurring': 'recurring_read',
    'bs-panels': 'ledgers_read',
    'bs-templates': 'templates_read',
    'bs-investments': 'investments_read',
    'bs-branding': 'branding_manage',
    'bs-operatives': 'operatives_manage',
    'bs-settings': 'settings_manage'
  };

  // Build sidebar — hide sections the user can't access
  const sidebarHtml = BS_TOOLS
    .filter(t => enabledTools[t.id] !== false)
    .filter(t => {
      const perm = SECTION_PERMS[t.id];
      if (!perm) return true; // no permission needed
      return window.bsCanDo(perm);
    })
    .map(t => `
      <button class="bs-nav-btn ${_bsSection === t.id ? 'bs-nav-active' : ''}" data-bs-section="${t.id}"
        onclick="window._bsNavigate('${t.id}')">
        <span class="bs-nav-icon">${t.icon}</span>
        <span class="bs-nav-label">${t.label}</span>
      </button>
    `).join('');

  el.innerHTML = `
    <div class="bs-shell">
      <div class="bs-sidebar" id="bs-sidebar">
        <div class="bs-sidebar-header" style="display:flex;align-items:center;gap:10px;">
          ${logoHtml}
          <div style="min-width:0;">
            <div style="font-size:16px;font-weight:800;letter-spacing:-.02em;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(bizName)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:1px;">${bizId}</div>
            ${opBadge}
          </div>
        </div>
        ${_allMyBizzes.length > 1 ? `
        <div style="padding:4px 12px 8px;">
          <select onchange="window._bsSwitchBusiness(this.value)" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;">
            ${_allMyBizzes.map(b => `<option value="${b.business_id}" ${b.business_id === targetBizId ? 'selected' : ''}>${esc(b.business_name)}${b.is_owner ? '' : ' (Team)'}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="bs-sidebar-nav" id="bs-sidebar-nav">
          ${sidebarHtml}
          <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;">
            <button class="bs-nav-btn" onclick="window._bsNavigate('bs-back')" style="color:var(--muted);">
              <span class="bs-nav-icon">←</span>
              <span class="bs-nav-label">${isOwnBusiness ? 'Back to Personal' : 'Exit to My Ops'}</span>
            </button>
          </div>
        </div>
      </div>
      <div class="bs-main" id="bs-main">
        <div class="bs-mobile-header" id="bs-mobile-header" style="display:flex;align-items:center;gap:8px;">
          <button class="bs-hamburger" onclick="document.getElementById('bs-sidebar').classList.toggle('bs-sidebar-open')">☰</button>
          <span style="font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(bizName)}</span>
          ${!isOwnBusiness ? '<span style="font-size:10px;color:var(--accent);font-weight:500;padding:2px 6px;background:rgba(99,102,241,.12);border-radius:6px;">⚡ Operative</span>' : ''}
        </div>
        ${!isOwnBusiness ? `<div style="background:rgba(99,102,241,.08);border-bottom:1px solid rgba(99,102,241,.2);padding:8px 24px;display:flex;align-items:center;gap:8px;font-size:12px;">
          <span style="font-weight:700;color:var(--accent,#6366F1);">⚡ Working as ${esc(ctx.role || 'operative')}</span>
          <span style="color:var(--muted);">in</span>
          <span style="font-weight:700;color:var(--text);">${esc(bizName)}</span>
          <span style="color:var(--muted);font-family:monospace;font-size:11px;">${bizId}</span>
        </div>` : ''}
        <div id="bs-content" style="padding:20px 24px;max-width:1100px;padding-bottom:80px;">
          <p style="color:var(--muted);">Loading…</p>
        </div>
        <nav class="bs-mobile-bottom-nav" id="bs-mobile-bottom-nav">
          <button class="bs-mobile-nav-btn" onclick="window._bsNavigate('bs-dash')" title="Overview">📊</button>
          <button class="bs-mobile-nav-btn" onclick="window._bsNavigate('bs-invoices')" title="Invoices">🧾</button>
          <button class="bs-mobile-nav-btn" onclick="window._bsNavigate('bs-bills')" title="Bills">📄</button>
          <button class="bs-mobile-nav-btn bs-mobile-nav-plus" onclick="openModal(\`<div style='text-align:center;padding:20px;'><p style='font-weight:700;margin-bottom:16px;'>Quick Actions</p><div style='display:flex;flex-direction:column;gap:8px;'><button class='btn btn-primary' onclick='closeModal();window._bsNavigate(&quot;bs-clients&quot;)'>New Client</button><button class='btn btn-primary' onclick='closeModal();window._bsNavigate(&quot;bs-suppliers&quot;)'>New Supplier</button></div></div>\`)" title="Add">+</button>
          <button class="bs-mobile-nav-btn" onclick="window._bsNavigate('bs-clients')" title="Clients">👥</button>
          <button class="bs-mobile-nav-btn" onclick="window._bsNavigate('bs-back')" title="Back to Personal">←</button>
        </nav>
      </div>
    </div>
  `;

  // Inject CSS if not already present
  if (!document.getElementById('bs-suite-styles')) {
    const style = document.createElement('style');
    style.id = 'bs-suite-styles';
    style.textContent = BS_CSS;
    document.head.appendChild(style);
  }

  // Navigate to section
  _bsRenderSection(_bsSection);
}

// ── Section Navigation ────────────────────────────────────────────
// Switch to a different business (from the sidebar dropdown)
window._bsSwitchBusiness = function(bizId) {
  if (!bizId || bizId === window._bsContext?.businessId) return;
  clearBsContext();
  window._bsContext = { businessId: bizId, isActive: false };
  try { sessionStorage.setItem('mxi_bs_operative_biz', bizId); } catch(_) {}
  if (_bsEl) renderBusinessSuite(_bsEl);
};

window._bsNavigate = function(section) {
  if (section === 'bs-back') {
    const wasOwn = window._bsContext?.role === 'owner';
    try { sessionStorage.removeItem('mxi_bs_operative_biz'); } catch(_) {}
    clearBsContext();
    // Close sidebar on mobile
    document.getElementById('bs-sidebar')?.classList.remove('bs-sidebar-open');
    // If was in someone else's business, go back to My Ops; otherwise dashboard
    if (wasOwn) {
      if (window.app?.navigate) window.app.navigate('dash');
    } else {
      if (window.app?.navigate) window.app.navigate('operations');
    }
    return;
  }
  _bsSection = section;
  try { localStorage.setItem('mxi_bs_section', section); } catch(_) {}

  // Update active state
  document.querySelectorAll('.bs-nav-btn').forEach(btn => {
    btn.classList.toggle('bs-nav-active', btn.dataset.bsSection === section);
  });
  // Close sidebar on mobile
  document.getElementById('bs-sidebar')?.classList.remove('bs-sidebar-open');

  _bsRenderSection(section);
};

async function _bsRenderSection(section) {
  const el = document.getElementById('bs-content');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--muted);">Loading…</p>';

  switch(section) {
    case 'bs-dash':        await _bsRenderDash(el); break;
    case 'bs-invoices':    await _bsRenderInvoices(el); break;
    case 'bs-bills':       await _bsRenderBills(el); break;
    case 'bs-clients':     await _bsRenderClients(el); break;
    case 'bs-suppliers':   await _bsRenderSuppliers(el); break;
    case 'bs-recurring':   await _bsRenderRecurring(el); break;
    case 'bs-panels':      await _bsRenderPanels(el); break;
    case 'bs-templates':   await _bsRenderTemplates(el); break;
    case 'bs-investments': await _bsRenderInvestments(el); break;
    // bs-panel-db removed — Public DB is now a tab inside bs-panels
    case 'bs-branding':    _bsRenderBranding(el); break;
    case 'bs-operatives':  await _bsRenderOperatives(el); break;
    case 'bs-settings':    _bsRenderSettings(el); break;
    default:               await _bsRenderDash(el); break;
  }
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Overview / Dashboard
// ══════════════════════════════════════════════════════════════════
async function _bsRenderDash(el) {
  const user = getCurrentUser();
  const profile = getCurrentProfile();
  const cur = profile?.default_currency || 'USD';

  // Use business_id for all data scoping
  const bizUuid = _bsBusinessId();

  // Fetch business entries — only those explicitly created in BS context
  const { data: entries } = await supabase
    .from('entries')
    .select('id,tx_type,amount,currency,status,contact_name,contact_id,created_at,metadata,settled_amount,reminder_count,contact:contacts(name)')
    .eq('business_id', bizUuid)
    .eq('context_type', 'business')
    .in('tx_type', BS_ALL_BIZ_TYPES)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  // Resolve display name from join, falling back to stored contact_name
  const biz = (entries || []).map(e => ({
    ...e,
    contact_name: e.contact?.name || e.contact_name || e.metadata?.client_name || e.metadata?.supplier_name || ''
  }));
  const invoicesSent = biz.filter(e => BS_INVOICE_TYPES.includes(e.tx_type));
  const billsSent = biz.filter(e => BS_BILL_TYPES.includes(e.tx_type));
  const totalOutstanding = invoicesSent
    .filter(e => e.status !== 'settled' && e.status !== 'voided' && (e.currency || 'USD') === cur)
    .reduce((s,e) => s + (e.amount || 0), 0);
  const totalBills = billsSent
    .filter(e => e.status !== 'settled' && e.status !== 'voided' && (e.currency || 'USD') === cur)
    .reduce((s,e) => s + (e.amount || 0), 0);

  const userName = profile?.display_name?.split(' ')[0] || 'there';

  // Compute additional KPIs
  const paidInvoices = invoicesSent.filter(e => e.status === 'settled');
  const paidTotal = paidInvoices.filter(e => (e.currency||'USD') === cur).reduce((s,e) => s + (e.amount||0), 0);
  const overdueInv = invoicesSent.filter(e => e.status !== 'settled' && e.status !== 'voided' && e.metadata?.due_date && new Date(e.metadata.due_date) < new Date());
  const netPosition = totalOutstanding - totalBills;

  // Today / this week / this month activity breakdown
  const now = new Date();
  const todayStr = now.toISOString().slice(0,10);
  const weekAgo = new Date(now - 7*24*60*60*1000);
  const monthAgo = new Date(now - 30*24*60*60*1000);
  const todayEntries = biz.filter(e => (e.created_at||'').slice(0,10) === todayStr);
  const weekEntries = biz.filter(e => new Date(e.created_at) >= weekAgo);
  const monthEntries = biz.filter(e => new Date(e.created_at) >= monthAgo);

  // First-time onboarding check — show setup wizard if no business name set
  const isNewBusiness = !profile?.company_name && biz.length === 0;

  el.innerHTML = `
    ${isNewBusiness ? `
    <!-- Welcome Onboarding -->
    <div class="card" style="padding:28px;text-align:center;margin-bottom:24px;background:linear-gradient(135deg, rgba(99,102,241,.08), rgba(99,102,241,.02));border:1px solid rgba(99,102,241,.15);">
      <div style="font-size:42px;margin-bottom:12px;">🏢</div>
      <h2 style="font-size:22px;font-weight:800;margin:0 0 8px;">Welcome to Your Business Suite</h2>
      <p style="color:var(--muted);font-size:14px;max-width:480px;margin:0 auto 20px;">Your business environment starts completely fresh — separate from your personal records. Set up your branding to get started.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="window._bsNavigate('bs-branding')" style="padding:12px 24px;font-size:14px;font-weight:700;">Set Up Business Branding</button>
        <button class="btn btn-secondary" onclick="window._bsQuickAction('invoice')" style="padding:12px 24px;font-size:14px;">Create First Invoice</button>
      </div>
      <div style="display:flex;gap:16px;justify-content:center;margin-top:20px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">
          <span style="color:var(--green,#7fe0d0);">✓</span> Separate from personal data
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">
          <span style="color:var(--green,#7fe0d0);">✓</span> Install templates from Public DB
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">
          <span style="color:var(--green,#7fe0d0);">✓</span> Invite team operatives
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Business header -->
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap;">
      <div style="flex:1;min-width:0;">
        <h2 style="font-size:22px;font-weight:700;margin:0;">Overview</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">Welcome back, ${esc(userName)} · <span style="font-family:monospace;font-size:12px;">${window._bsContext?.ownerBizId || 'BIZ-000000'}</span></p>
      </div>
      <div style="display:flex;gap:8px;">
        ${window.bsCanDo('branding_manage') ? `<button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-branding')" style="white-space:nowrap;">Edit Branding</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-dash')" title="Refresh" style="padding:6px 10px;">↻</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
      <div class="card" style="padding:18px;border-left:3px solid var(--green,#7fe0d0);cursor:pointer;" onclick="window._bsNavigate('bs-invoices')">
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Receivables</div>
        <div style="font-size:24px;font-weight:800;margin-top:4px;color:var(--green,#7fe0d0);">${fmtMoney(totalOutstanding, cur)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${invoicesSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length} unpaid invoice${invoicesSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length!==1?'s':''}</div>
      </div>
      <div class="card" style="padding:18px;border-left:3px solid var(--blue,#8fa8d6);cursor:pointer;" onclick="window._bsNavigate('bs-bills')">
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Payables</div>
        <div style="font-size:24px;font-weight:800;margin-top:4px;color:var(--blue,#8fa8d6);">${fmtMoney(totalBills, cur)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${billsSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length} pending bill${billsSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length!==1?'s':''}</div>
      </div>
      <div class="card" style="padding:18px;border-left:3px solid ${netPosition >= 0 ? 'var(--green,#7fe0d0)' : 'var(--red,#d07878)'};">
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Net Position</div>
        <div style="font-size:24px;font-weight:800;margin-top:4px;color:${netPosition >= 0 ? 'var(--green,#7fe0d0)' : 'var(--red,#d07878)'};">${fmtMoney(netPosition, cur)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">receivables − payables</div>
      </div>
      <div class="card" style="padding:18px;border-left:3px solid var(--gold,#d6b97a);">
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Collected</div>
        <div style="font-size:24px;font-weight:800;margin-top:4px;color:var(--gold,#d6b97a);">${fmtMoney(paidTotal, cur)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${paidInvoices.length} settled${overdueInv.length > 0 ? ` · <span style="color:var(--red,#d07878);">${overdueInv.length} overdue</span>` : ''}</div>
      </div>
    </div>

    <!-- Quick Actions (permission-gated) -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:28px;">
      ${window.bsCanDo('invoices_create') ? `<button class="btn btn-primary" onclick="window._bsQuickAction('invoice')" style="padding:12px;font-size:13px;font-weight:600;border-radius:10px;">+ New Invoice</button>` : `<button class="btn btn-secondary" disabled style="padding:12px;font-size:13px;font-weight:600;border-radius:10px;opacity:.4;cursor:not-allowed;">+ New Invoice</button>`}
      ${window.bsCanDo('bills_create') ? `<button class="btn btn-secondary" onclick="window._bsReceiveBill?window._bsReceiveBill():window._bsQuickAction('bill')" style="padding:12px;font-size:13px;font-weight:600;border-radius:10px;">+ Receive Bill</button>` : `<button class="btn btn-secondary" disabled style="padding:12px;font-size:13px;font-weight:600;border-radius:10px;opacity:.4;cursor:not-allowed;">+ Receive Bill</button>`}
      ${window.bsCanDo('clients_read') ? `<button class="btn btn-secondary" onclick="window._bsNavigate('bs-clients')" style="padding:12px;font-size:13px;font-weight:600;border-radius:10px;">Clients</button>` : ''}
      ${window.bsCanDo('ledgers_read') ? `<button class="btn btn-secondary" onclick="window._bsNavigate('bs-panels')" style="padding:12px;font-size:13px;font-weight:600;border-radius:10px;">Ledgers</button>` : ''}
    </div>

    <!-- Activity Summary -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
      <div style="padding:12px 14px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);text-align:center;">
        <div style="font-size:20px;font-weight:800;">${todayEntries.length}</div>
        <div style="font-size:11px;color:var(--muted);">Today</div>
      </div>
      <div style="padding:12px 14px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);text-align:center;">
        <div style="font-size:20px;font-weight:800;">${weekEntries.length}</div>
        <div style="font-size:11px;color:var(--muted);">This Week</div>
      </div>
      <div style="padding:12px 14px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);text-align:center;">
        <div style="font-size:20px;font-weight:800;">${monthEntries.length}</div>
        <div style="font-size:11px;color:var(--muted);">This Month</div>
      </div>
    </div>

    <!-- Monthly Revenue Trend (last 6 months) -->
    ${(() => {
      const months = [];
      const now2 = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
        months.push({ key: d.toISOString().slice(0,7), label: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }), invoiced: 0, billed: 0 });
      }
      biz.forEach(e => {
        const m = (e.created_at||'').slice(0,7);
        const mo = months.find(x => x.key === m);
        if (!mo) return;
        if (BS_INVOICE_TYPES.includes(e.tx_type)) mo.invoiced += (e.amount || 0);
        else if (BS_BILL_TYPES.includes(e.tx_type)) mo.billed += (e.amount || 0);
      });
      const maxVal = Math.max(...months.map(m => Math.max(m.invoiced, m.billed)), 1);
      return months.some(m => m.invoiced > 0 || m.billed > 0) ? `
      <div class="card" style="padding:18px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:700;">Monthly Trend</div>
          <div style="display:flex;gap:12px;font-size:11px;">
            <span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:var(--green,#7fe0d0);"></span> Invoiced</span>
            <span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:var(--red,#d07878);"></span> Billed</span>
          </div>
        </div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:100px;">
          ${months.map(m => {
            const invH = Math.max(2, Math.round((m.invoiced / maxVal) * 90));
            const bilH = Math.max(2, Math.round((m.billed / maxVal) * 90));
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
              <div style="display:flex;gap:2px;align-items:flex-end;height:90px;">
                <div style="width:12px;height:${invH}px;background:var(--green,#7fe0d0);border-radius:3px 3px 0 0;" title="Invoiced: ${fmtMoney(m.invoiced, cur)}"></div>
                <div style="width:12px;height:${bilH}px;background:var(--red,#d07878);border-radius:3px 3px 0 0;" title="Billed: ${fmtMoney(m.billed, cur)}"></div>
              </div>
              <div style="font-size:10px;color:var(--muted);white-space:nowrap;">${m.label}</div>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';
    })()}

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="font-size:16px;font-weight:700;margin:0;">Recent Business Activity</h3>
      <a onclick="window._bsNavigate('bs-invoices')" style="font-size:13px;cursor:pointer;color:var(--accent);font-weight:600;">View all →</a>
    </div>
    ${biz.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:40px;margin-bottom:12px;">📊</div>
          <p style="font-weight:700;font-size:15px;margin-bottom:6px;">No business entries yet</p>
          <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">Create your first invoice or bill to start tracking your business finances.</p>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('invoice')">Create Invoice</button>
            <button class="btn btn-secondary btn-sm" onclick="window._bsReceiveBill?window._bsReceiveBill():window._bsQuickAction('bill')">Receive Bill</button>
          </div>
        </div>`
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Contact</th><th>Amount</th><th>Status</th></tr></thead><tbody>
          ${biz.slice(0,15).map(e => `<tr style="cursor:pointer;" onclick="window._bsViewEntry('${e.id}')">
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td><span style="color:${TX_COLORS[e.tx_type]||'var(--text)'};font-weight:600;font-size:13px;">${esc(_bsTxLabel(e.tx_type))}</span></td>
            <td style="font-weight:600;font-size:13px;">${esc(e.contact_name || '—')}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td>${statusBadge(e.status || 'draft')}${e.reminder_count > 0 ? `<span class="badge badge-red" style="margin-left:4px;">🚩${e.reminder_count}</span>` : ''}</td>
          </tr>`).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// Business-branded TX labels
function _bsTxLabel(type) {
  const map = {
    invoice_sent: 'Invoice Sent',
    invoice_received: 'Invoice Received',
    invoice: 'Invoice',
    bill_sent: 'Bill Sent',
    bill_received: 'Bill Received',
    bill: 'Bill',
    owed_to_me: 'Receivable',
    i_owe: 'Payable',
    advance_paid: 'Advance Out',
    advance_received: 'Advance In',
    payment_recorded: 'Payment'
  };
  return map[type] || TX_LABELS[type] || type;
}

// Quick action — opens new entry modal with business presets
// Sets _bsActiveContext so saveNewEntry knows to return to BS (not personal entries)
// ── Add Client from BS — tags contact as business_client ──
window._bsAddClient = function() {
  openModal(`
    <h3 style="margin-bottom:16px;">Add Business Client</h3>
    <div class="form-group"><label>Name *</label><input type="text" id="nc-name" placeholder="Client name"></div>
    <div class="form-group"><label>Email</label><input type="email" id="nc-email" placeholder="email@example.com"></div>
    <div class="form-group"><label>Phone</label><input type="tel" id="nc-phone" placeholder="+1 555 000 0000"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('modal')?.remove()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="window._bsSaveClient()">Save</button>
    </div>
  `);
};

window._bsSaveClient = async function() {
  const currentUser = getCurrentUser();
  const bizUuid = _bsBusinessId();
  const name = document.getElementById('nc-name').value.trim();
  const email = document.getElementById('nc-email').value.trim().toLowerCase();
  if (!name) return toast('Name is required.', 'error');
  // Check duplicate email in this business
  if (email) {
    const { data: dup } = await supabase.from('contacts')
      .select('id,name').eq('business_id', bizUuid).eq('email', email).maybeSingle();
    if (dup) return toast(`Email already used by "${dup.name}".`, 'error');
  }
  const { data: newContact, error } = await supabase
    .from('contacts')
    .insert({
      business_id: bizUuid,
      user_id:     currentUser.id,
      name,
      email:       email || '',
      phone:       document.getElementById('nc-phone').value.trim() || '',
      tags:        ['business_client']
    })
    .select()
    .single();
  if (error) return toast('Failed: ' + error.message, 'error');
  closeModal();
  toast('Client added.', 'success');
  window._bsNavigate('bs-clients');
};

window._bsQuickAction = function(type) {
  window._bsActiveContext = true;
  window._bsActiveBizId = _bsDataBizId();
  if (type === 'invoice') {
    if (window.openNewEntryModal) window.openNewEntryModal('invoice');
  } else if (type === 'bill') {
    if (window.openNewEntryModal) window.openNewEntryModal('bill');
  }
};

// ══════════════════════════════════════════════════════════════════
// SECTION: BS Pagination & Bulk Selection State
// ══════════════════════════════════════════════════════════════════
window._bsPg = window._bsPg || {};
function _bsPage(section) { return window._bsPg[section] || 1; }
function _bsSetPage(section, pg) { window._bsPg[section] = pg; }
const BS_PAGE_SIZE = 10;

// BS Bulk selection state
window._bsSel = window._bsSel || {};
window._bsSelectMode = window._bsSelectMode || {};
function _bsInSelectMode(section) { return !!window._bsSelectMode[section]; }
function _bsSelected(section) { return window._bsSel[section] || new Set(); }
function _bsToggleSel(section, id, checked) {
  if (!window._bsSel[section]) window._bsSel[section] = new Set();
  if (checked) window._bsSel[section].add(id); else window._bsSel[section].delete(id);
}
function _bsSelAll(section, ids, checked) {
  if (!window._bsSel[section]) window._bsSel[section] = new Set();
  if (checked) ids.forEach(id => window._bsSel[section].add(id));
  else ids.forEach(id => window._bsSel[section].delete(id));
}
function _bsClearSel(section) { window._bsSel[section] = new Set(); }

// Map section key → valid navigation route
// suppliers-bills and suppliers-dir are sub-tabs of bs-suppliers
function _bsRoute(section) {
  if (section === 'suppliers-bills' || section === 'suppliers-dir') return 'bs-suppliers';
  return 'bs-' + section;
}

// Enter select mode for a section
window._bsEnterSelect = function(section) {
  window._bsSelectMode[section] = true;
  _bsClearSel(section);
  window._bsNavigate(_bsRoute(section));
};
// Exit select mode for a section
window._bsExitSelect = function(section) {
  window._bsSelectMode[section] = false;
  _bsClearSel(section);
  window._bsNavigate(_bsRoute(section));
};
// Helper: select button or cancel button depending on mode
function _bsSelectBtn(section) {
  if (_bsInSelectMode(section)) {
    return `<button class="bs sm" onclick="window._bsExitSelect('${section}')" style="padding:5px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:var(--red,#d07878);color:#fff;border:none;">✕ Cancel</button>`;
  }
  return `<button class="bs sm" onclick="window._bsEnterSelect('${section}')" style="padding:5px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg3);color:var(--text);">☐ Select</button>`;
}

// Pagination HTML helper
function _bsPagination(section, total, navFnName) {
  const page = _bsPage(section);
  const totalPages = Math.ceil(total / BS_PAGE_SIZE);
  if (totalPages <= 1) return '';
  return `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 0;">
    <button class="bs sm" onclick="${navFnName}(${page-1})" ${page<=1?'disabled':''} style="padding:5px 12px;border-radius:6px;font-size:12px;">← Prev</button>
    <span style="font-size:13px;color:var(--muted);">Page ${page} of ${totalPages} · ${total} items</span>
    <button class="bs sm" onclick="${navFnName}(${page+1})" ${page>=totalPages?'disabled':''} style="padding:5px 12px;border-radius:6px;font-size:12px;">Next →</button>
  </div>`;
}

// Bulk actions bar HTML helper — only shows when in select mode
function _bsBulkBar(section, count, actions) {
  if (!_bsInSelectMode(section)) return '';
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:${count > 0 ? 'var(--accent)' : 'var(--bg3)'};border:1px solid ${count > 0 ? 'var(--accent)' : 'var(--border)'};border-radius:8px;margin-bottom:12px;color:${count > 0 ? '#fff' : 'var(--text)'};">
    <span style="font-size:13px;font-weight:700;">${count > 0 ? count + ' selected' : 'Select items below'}</span>
    <div style="display:flex;gap:6px;margin-left:auto;">
      ${count > 0 ? actions.map(a => `<button class="bs sm" onclick="${a.onclick}" style="background:${count > 0 ? 'rgba(255,255,255,.2)' : 'var(--bg3)'};color:${count > 0 ? '#fff' : 'var(--text)'};border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">${a.label}</button>`).join('') : ''}
      <button class="bs sm" onclick="window._bsExitSelect('${section}')" style="background:${count > 0 ? 'rgba(255,255,255,.15)' : 'var(--bg3)'};color:${count > 0 ? '#fff' : 'var(--text)'};border:1px solid ${count > 0 ? 'transparent' : 'var(--border)'};padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">✕ Done</button>
    </div>
  </div>`;
}

// Clear selection, exit select mode, and refresh
window._bsClearAndRefresh = function(section) {
  window._bsSelectMode[section] = false;
  _bsClearSel(section);
  window._bsNavigate(_bsRoute(section));
};

// Toggle selection and refresh
window._bsToggle = function(section, id, checked) {
  _bsToggleSel(section, id, checked);
  window._bsNavigate(_bsRoute(section));
};

// Bulk delete action (entries — soft delete via RPC to bypass RLS WITH CHECK)
window._bsBulkDelete = async function(section) {
  const sel = _bsSelected(section);
  if (sel.size === 0) return;
  if (!confirm(`Delete ${sel.size} item(s)? This cannot be undone.`)) return;
  const ids = [...sel];
  const { data, error } = await supabase.rpc('soft_delete_entries', { p_entry_ids: ids });
  window._bsSelectMode[section] = false;
  _bsClearSel(section);
  if (error) { toast('Delete failed: ' + error.message, 'error'); }
  else if (data?.fail > 0) { toast(`${data.ok} deleted, ${data.fail} failed`, 'error'); }
  else { toast(`${data?.ok || ids.length} item(s) deleted`, 'success'); }
  window._bsNavigate(_bsRoute(section));
};

// Single entry delete (soft delete via RPC to bypass RLS WITH CHECK)
window._bsDeleteEntry = async function(entryId, section) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  const { error } = await supabase.rpc('soft_delete_entry', { p_entry_id: entryId });
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Entry deleted', 'success');
  window._bsNavigate(_bsRoute(section));
};

// Single contact delete
window._bsDeleteContact = async function(contactId, section) {
  if (!confirm('Delete this contact? This cannot be undone.')) return;
  const { error } = await supabase.from('contacts').delete().eq('id', contactId);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Contact deleted', 'success');
  window._bsNavigate(_bsRoute(section));
};

// Bulk archive action
window._bsBulkArchive = async function(section) {
  const sel = _bsSelected(section);
  if (sel.size === 0) return;
  if (!confirm(`Archive ${sel.size} item(s)?`)) return;
  const ids = [...sel];
  for (const id of ids) {
    await supabase.from('entries').update({ archived_at: new Date().toISOString() }).eq('id', id);
  }
  window._bsSelectMode[section] = false;
  _bsClearSel(section);
  toast(`${ids.length} item(s) archived`, 'success');
  window._bsNavigate(_bsRoute(section));
};

// Bulk mark paid action
window._bsBulkMarkPaid = async function(section) {
  const sel = _bsSelected(section);
  if (sel.size === 0) return;
  const ids = [...sel];
  for (const id of ids) {
    await supabase.from('entries').update({ status: 'settled' }).eq('id', id);
  }
  window._bsSelectMode[section] = false;
  _bsClearSel(section);
  toast(`${ids.length} item(s) marked as paid`, 'success');
  window._bsNavigate(_bsRoute(section));
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Invoices
// ══════════════════════════════════════════════════════════════════
async function _bsRenderInvoices(el) {
  const user = getCurrentUser();
  const cur = getCurrentProfile()?.default_currency || 'USD';
  const bizUuid = _bsBusinessId();

  const { data } = await supabase
    .from('entries')
    .select('id,tx_type,amount,currency,status,contact_name,contact_id,invoice_number,entry_number,created_at,metadata,settled_amount,reminder_count,contact:contacts(name)')
    .eq('business_id', bizUuid)
    .eq('context_type', 'business')
    .in('tx_type', BS_INVOICE_TYPES)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  // Resolve display name: prefer contact join, fall back to contact_name column
  const inv = (data || []).map(e => ({
    ...e,
    contact_name: e.contact?.name || e.contact_name || e.metadata?.client_name || ''
  }));
  const unpaid = inv.filter(e => e.status !== 'settled' && e.status !== 'voided');
  const overdue = unpaid.filter(e => e.metadata?.due_date && new Date(e.metadata.due_date) < new Date());
  const totalUnpaid = unpaid.filter(e => (e.currency||'USD') === cur).reduce((s,e) => s+(e.amount||0), 0);

  // Filter state
  if (!window._bsInvFilter) window._bsInvFilter = 'all';
  if (!window._bsInvSearch) window._bsInvSearch = '';
  const f = window._bsInvFilter;
  const q = window._bsInvSearch.toLowerCase();
  let filtered = f === 'all' ? inv
    : f === 'unpaid' ? unpaid
    : f === 'overdue' ? overdue
    : f === 'settled' ? inv.filter(e => e.status === 'settled')
    : inv;
  // Apply search
  if (q) filtered = filtered.filter(e =>
    (e.contact_name||'').toLowerCase().includes(q) ||
    (e.invoice_number||e.metadata?.inv_number||'').toLowerCase().includes(q) ||
    String(e.amount||'').includes(q)
  );

  // Reset pagination when filter/search changes
  if (q || f) _bsSetPage('invoices', 1);

  // Pagination
  const page = _bsPage('invoices');
  const totalFiltered = filtered.length;
  const pageItems = filtered.slice((page - 1) * BS_PAGE_SIZE, page * BS_PAGE_SIZE);
  const sel = _bsSelected('invoices');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Invoices</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${inv.length} total · ${unpaid.length} unpaid${overdue.length > 0 ? ` · <span style="color:var(--red,#d07878);">${overdue.length} overdue</span>` : ''} · ${fmtMoney(totalUnpaid, cur)} outstanding</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('invoice')">+ New Invoice</button>
      </div>
    </div>
    <!-- Search + Filters -->
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
      <input type="text" placeholder="Search invoices…" value="${esc(window._bsInvSearch||'')}"
        oninput="window._bsInvSearch=this.value;window._bsNavigate('bs-invoices');"
        style="flex:1;min-width:180px;padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${['all','unpaid','overdue','settled'].map(v => `
          <button class="bs sm" onclick="window._bsInvFilter='${v}';window._bsNavigate('bs-invoices');"
            style="font-weight:${f===v?'700':'500'};background:${f===v?'var(--accent)':'var(--bg3)'};color:${f===v?'#fff':'var(--text)'};border:1px solid ${f===v?'var(--accent)':'var(--border)'};border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;">
            ${v.charAt(0).toUpperCase()+v.slice(1)}${v==='all'?' ('+inv.length+')':v==='unpaid'?' ('+unpaid.length+')':v==='overdue'?' ('+overdue.length+')':' ('+inv.filter(e=>e.status==='settled').length+')'}
          </button>`).join('')}
      </div>
      ${_bsSelectBtn('invoices')}
    </div>
    ${filtered.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:36px;margin-bottom:10px;">🧾</div>
          <p style="color:var(--muted);margin-bottom:12px;">${q ? 'No invoices match your search.' : 'No invoices match this filter.'}</p>
          ${!q ? '<button class="btn btn-primary btn-sm" onclick="window._bsQuickAction(\'invoice\')">Create First Invoice</button>' : ''}
        </div>`
      : `
        ${_bsBulkBar('invoices', sel.size, [
          { label: 'Delete', onclick: "window._bsBulkDelete('invoices')" },
          { label: 'Archive', onclick: "window._bsBulkArchive('invoices')" },
          { label: 'Mark Paid', onclick: "window._bsBulkMarkPaid('invoices')" }
        ])}
        <div class="card"><div class="tbl-wrap"><table><thead><tr>${_bsInSelectMode('invoices') ? `<th style="width:36px;"><input type="checkbox" onchange="window._bsSelAllInv(this.checked)" style="cursor:pointer;accent-color:var(--accent);"></th>` : ''}<th>Date</th><th>Client</th><th>Ref #</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th style="width:120px;">Actions</th></tr></thead><tbody>
          ${pageItems.map(e => {
            const isOverdue = e.status !== 'settled' && e.status !== 'voided' && e.metadata?.due_date && new Date(e.metadata.due_date) < new Date();
            const settled = e.settled_amount || 0;
            const remaining = e.amount - settled;
            const isPaid = e.status === 'settled';
            const refNum = e.invoice_number || e.metadata?.inv_number || (e.entry_number ? '#' + String(e.entry_number).padStart(4,'0') : '—');
            return `<tr style="cursor:pointer;${isOverdue?'background:rgba(208,120,120,.06);':''}" onclick="window._bsViewEntry('${e.id}')">
            ${_bsInSelectMode('invoices') ? `<td style="width:36px;text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" ${sel.has(e.id)?'checked':''} onchange="window._bsToggle('invoices','${e.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></td>` : ''}
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td style="font-weight:600;">${esc(e.contact_name || '—')}</td>
            <td style="color:var(--accent);font-size:13px;font-weight:600;">${esc(refNum)}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td style="font-size:13px;color:${settled > 0 ? 'var(--green,#6ec77a)' : 'var(--muted-2)'};">${settled > 0 ? fmtMoney(settled, e.currency) : '—'}</td>
            <td style="font-size:13px;font-weight:600;color:${remaining > 0 && !isPaid ? 'var(--text)' : 'var(--muted-2)'};">${isPaid ? '0' : fmtMoney(remaining, e.currency)}</td>
            <td style="color:${isOverdue?'var(--red,#d07878)':'var(--muted)'};font-size:13px;font-weight:${isOverdue?'600':'400'};">${fmtDate(e.metadata?.due_date)}${isOverdue?' ⚠':''}
            </td>
            <td>${statusBadge(e.status || 'draft')}${e.reminder_count > 0 ? `<span class="badge badge-red" style="margin-left:4px;">🚩${e.reminder_count}</span>` : ''}</td>
            <td style="white-space:nowrap;" onclick="event.stopPropagation();">
              ${!isPaid ? `<button class="bs sm" onclick="window._bsRecordPayment?.('${e.id}')||window._bsBulkMarkPaid?.('invoices')" style="font-size:11px;padding:3px 8px;cursor:pointer;color:var(--green,#5fd39a);">💰 Pay</button>` : ''}
            </td>
          </tr>`}).join('')}
        </tbody></table></div></div>
        ${_bsPagination('invoices', totalFiltered, 'window._bsInvPage')}
      `
    }
  `;
}

// View entry detail — reuse the main app's detail modal
window._bsViewEntry = function(entryId) {
  if (window.openEntryDetail) window.openEntryDetail(entryId);
};

// Invoices page navigation
window._bsInvPage = function(pg) {
  _bsSetPage('invoices', pg);
  window._bsNavigate('bs-invoices');
};

// Invoices select all on page
window._bsSelAllInv = function(checked) {
  // Extract IDs from row checkboxes via their onchange attribute
  const ids = [...document.querySelectorAll('tbody input[type="checkbox"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'invoices','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('invoices', ids, checked);
  window._bsNavigate('bs-invoices');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Bills
// ══════════════════════════════════════════════════════════════════
async function _bsRenderBills(el) {
  const user = getCurrentUser();
  const cur = getCurrentProfile()?.default_currency || 'USD';
  const bizUuid = _bsBusinessId();

  const { data } = await supabase
    .from('entries')
    .select('id,tx_type,amount,currency,status,contact_name,contact_id,invoice_number,entry_number,created_at,metadata,settled_amount,reminder_count,contact:contacts(name)')
    .eq('business_id', bizUuid)
    .eq('context_type', 'business')
    .in('tx_type', BS_BILL_TYPES)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const bills = (data || []).map(e => ({
    ...e,
    contact_name: e.contact?.name || e.contact_name || e.metadata?.supplier_name || ''
  }));
  const unpaid = bills.filter(e => e.status !== 'settled' && e.status !== 'voided');
  const overdue = unpaid.filter(e => e.metadata?.due_date && new Date(e.metadata.due_date) < new Date());
  const totalUnpaid = unpaid.filter(e => (e.currency||'USD') === cur).reduce((s,e) => s+(e.amount||0), 0);

  if (!window._bsBillFilter) window._bsBillFilter = 'all';
  if (!window._bsBillSearch) window._bsBillSearch = '';
  const f = window._bsBillFilter;
  const q = window._bsBillSearch.toLowerCase();
  let filtered = f === 'all' ? bills
    : f === 'unpaid' ? unpaid
    : f === 'overdue' ? overdue
    : f === 'settled' ? bills.filter(e => e.status === 'settled')
    : bills;
  if (q) filtered = filtered.filter(e =>
    (e.contact_name||'').toLowerCase().includes(q) ||
    (e.metadata?.ref_number||'').toLowerCase().includes(q) ||
    String(e.amount||'').includes(q)
  );

  // Reset pagination when filter/search changes
  if (q || f) _bsSetPage('bills', 1);

  // Pagination
  const page = _bsPage('bills');
  const totalFiltered = filtered.length;
  const pageItems = filtered.slice((page - 1) * BS_PAGE_SIZE, page * BS_PAGE_SIZE);
  const sel = _bsSelected('bills');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Bills</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${bills.length} total · ${unpaid.length} unpaid${overdue.length > 0 ? ` · <span style="color:var(--red,#d07878);">${overdue.length} overdue</span>` : ''} · ${fmtMoney(totalUnpaid, cur)} outstanding</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsReceiveBill?window._bsReceiveBill():window._bsQuickAction('bill')">+ Receive Bill</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
      <input type="text" placeholder="Search bills…" value="${esc(window._bsBillSearch||'')}"
        oninput="window._bsBillSearch=this.value;window._bsNavigate('bs-bills');"
        style="flex:1;min-width:180px;padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${['all','unpaid','overdue','settled'].map(v => `
          <button class="bs sm" onclick="window._bsBillFilter='${v}';window._bsNavigate('bs-bills');"
            style="font-weight:${f===v?'700':'500'};background:${f===v?'var(--accent)':'var(--bg3)'};color:${f===v?'#fff':'var(--text)'};border:1px solid ${f===v?'var(--accent)':'var(--border)'};border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;">
            ${v.charAt(0).toUpperCase()+v.slice(1)}${v==='all'?' ('+bills.length+')':v==='unpaid'?' ('+unpaid.length+')':v==='overdue'?' ('+overdue.length+')':' ('+bills.filter(e=>e.status==='settled').length+')'}
          </button>`).join('')}
      </div>
      ${_bsSelectBtn('bills')}
    </div>
    ${filtered.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:36px;margin-bottom:10px;">📄</div>
          <p style="color:var(--muted);margin-bottom:12px;">${q ? 'No bills match your search.' : 'No bills match this filter.'}</p>
          ${!q ? '<button class="btn btn-primary btn-sm" onclick="window._bsReceiveBill?window._bsReceiveBill():window._bsQuickAction(\'bill\')">Receive First Bill</button>' : ''}
        </div>`
      : `
        ${_bsBulkBar('bills', sel.size, [
          { label: 'Delete', onclick: "window._bsBulkDelete('bills')" },
          { label: 'Archive', onclick: "window._bsBulkArchive('bills')" },
          { label: 'Mark Paid', onclick: "window._bsBulkMarkPaid('bills')" }
        ])}
        <div class="card"><div class="tbl-wrap"><table><thead><tr>${_bsInSelectMode('bills') ? `<th style="width:36px;"><input type="checkbox" onchange="window._bsSelAllBill(this.checked)" style="cursor:pointer;accent-color:var(--accent);"></th>` : ''}<th>Date</th><th>Supplier</th><th>Ref #</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th style="width:120px;">Actions</th></tr></thead><tbody>
          ${pageItems.map(e => {
            const isOverdue = e.status !== 'settled' && e.status !== 'voided' && e.metadata?.due_date && new Date(e.metadata.due_date) < new Date();
            const settled = e.settled_amount || 0;
            const remaining = e.amount - settled;
            const isPaid = e.status === 'settled';
            const refNum = e.metadata?.ref_number || e.invoice_number || (e.entry_number ? '#' + String(e.entry_number).padStart(4,'0') : '—');
            return `<tr style="cursor:pointer;${isOverdue?'background:rgba(208,120,120,.06);':''}" onclick="window._bsViewEntry('${e.id}')">
            ${_bsInSelectMode('bills') ? `<td style="width:36px;text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" ${sel.has(e.id)?'checked':''} onchange="window._bsToggle('bills','${e.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></td>` : ''}
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td style="font-weight:600;">${esc(e.contact_name || '—')}</td>
            <td style="color:var(--muted);font-size:13px;">${esc(refNum)}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td style="font-size:13px;color:${settled > 0 ? 'var(--green,#6ec77a)' : 'var(--muted-2)'};">${settled > 0 ? fmtMoney(settled, e.currency) : '—'}</td>
            <td style="font-size:13px;font-weight:600;color:${remaining > 0 && !isPaid ? 'var(--text)' : 'var(--muted-2)'};">${isPaid ? '0' : fmtMoney(remaining, e.currency)}</td>
            <td style="color:${isOverdue?'var(--red,#d07878)':'var(--muted)'};font-size:13px;font-weight:${isOverdue?'600':'400'};">${fmtDate(e.metadata?.due_date)}${isOverdue?' ⚠':''}</td>
            <td>${statusBadge(e.status || 'draft')}${e.reminder_count > 0 ? `<span class="badge badge-red" style="margin-left:4px;">🚩${e.reminder_count}</span>` : ''}</td>
            <td style="white-space:nowrap;" onclick="event.stopPropagation();">
              ${!isPaid ? `<button class="bs sm" onclick="window._bsRecordPayment?.('${e.id}')" style="font-size:11px;padding:3px 8px;cursor:pointer;color:var(--green,#5fd39a);">💰 Pay</button>` : ''}
            </td>
          </tr>`}).join('')}
        </tbody></table></div></div>
        ${_bsPagination('bills', totalFiltered, 'window._bsBillPage')}
      `
    }
  `;
}

// Bills page navigation
window._bsBillPage = function(pg) {
  _bsSetPage('bills', pg);
  window._bsNavigate('bs-bills');
};

// Bills select all on page
window._bsSelAllBill = function(checked) {
  const ids = [...document.querySelectorAll('tbody input[type="checkbox"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'bills','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('bills', ids, checked);
  window._bsNavigate('bs-bills');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Clients
// ══════════════════════════════════════════════════════════════════
async function _bsRenderClients(el) {
  const user = getCurrentUser();
  const bizUuid = _bsBusinessId();
  const contacts = await listContacts(bizUuid);
  _bsContacts = contacts;

  // Include ALL business transaction types so any interacted contact appears as a client
  const { data: invoices } = await supabase
    .from('entries')
    .select('contact_id,contact_name,amount,currency,status,tx_type,created_at')
    .eq('business_id', bizUuid)
    .eq('context_type', 'business')
    .in('tx_type', [...BS_INVOICE_TYPES, ...BS_BILL_TYPES, 'owed_to_me', 'i_owe', 'they_owe_you', 'you_owe_them'])
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const clientMap = {};
  (invoices || []).forEach(inv => {
    if (!inv.contact_id) return;
    if (!clientMap[inv.contact_id]) {
      clientMap[inv.contact_id] = { name: inv.contact_name, total: 0, unpaid: 0, count: 0, lastDate: inv.created_at };
    }
    clientMap[inv.contact_id].count++;
    clientMap[inv.contact_id].total += (inv.amount || 0);
    if (inv.status !== 'settled' && inv.status !== 'voided') {
      clientMap[inv.contact_id].unpaid += (inv.amount || 0);
    }
  });

  // Enrich with contact details + include contacts with no entries yet
  const clients = Object.entries(clientMap).map(([id, c]) => {
    const contact = contacts.find(ct => ct.id === id);
    return { id, ...c, email: contact?.email || '', phone: contact?.phone || '' };
  });
  // Add contacts tagged as 'business_client' that have no entries yet
  contacts.forEach(ct => {
    if (!clientMap[ct.id] && (ct.tags || []).includes('business_client')) {
      clients.push({ id: ct.id, name: ct.name, email: ct.email || '', phone: ct.phone || '', total: 0, unpaid: 0, count: 0, lastDate: ct.created_at });
    }
  });
  clients.sort((a,b) => b.unpaid - a.unpaid);
  const cur = getCurrentProfile()?.default_currency || 'USD';
  const totalReceivable = clients.reduce((s,c) => s + c.unpaid, 0);

  // Search
  if (!window._bsClientSearch) window._bsClientSearch = '';
  const cq = window._bsClientSearch.toLowerCase();
  let displayClients = cq ? clients.filter(c => (c.name||'').toLowerCase().includes(cq) || (c.email||'').toLowerCase().includes(cq)) : clients;

  // Reset pagination when search changes
  if (cq) _bsSetPage('clients', 1);

  // Pagination
  const page = _bsPage('clients');
  const totalFiltered = displayClients.length;
  displayClients = displayClients.slice((page - 1) * BS_PAGE_SIZE, page * BS_PAGE_SIZE);
  const sel = _bsSelected('clients');

  const topClients = clients.slice(0, 3);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Clients</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${clients.length} client${clients.length!==1?'s':''} · ${fmtMoney(totalReceivable, cur)} total receivable</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-secondary btn-sm" onclick="window._bsAddClient()">+ Add Client</button>
        <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('invoice')">+ Invoice Client</button>
      </div>
    </div>

    <!-- Top Clients summary -->
    ${topClients.length > 0 ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">
      ${topClients.map(c => `
        <div class="card" style="padding:14px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            ${contactAvatar(c.name, c.id, 28)}
            <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.name)}</div>
          </div>
          <div style="font-size:18px;font-weight:800;color:${c.unpaid > 0 ? 'var(--green,#7fe0d0)' : 'var(--muted)'};">${fmtMoney(c.unpaid, cur)}</div>
          <div style="font-size:11px;color:var(--muted);">${c.count} invoice${c.count!==1?'s':''} · owed</div>
        </div>
      `).join('')}
    </div>` : ''}

    <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
      <input type="text" placeholder="Search clients…" value="${esc(window._bsClientSearch||'')}"
        oninput="window._bsClientSearch=this.value;window._bsNavigate('bs-clients');"
        style="flex:1;min-width:180px;max-width:320px;padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;">
      <div style="margin-left:auto;">${_bsSelectBtn('clients')}</div>
    </div>

    ${displayClients.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:36px;margin-bottom:10px;">👥</div>
          <p style="color:var(--muted);margin-bottom:12px;">${cq ? 'No clients match your search.' : 'No clients yet. Clients appear here automatically when you send your first invoice.'}</p>
          ${!cq ? '<button class="btn btn-primary btn-sm" onclick="window._bsQuickAction(\'invoice\')">Send First Invoice</button>' : ''}
        </div>`
      : `
        ${_bsBulkBar('clients', sel.size, [
          { label: 'Delete', onclick: "window._bsBulkDeleteContact('clients')" }
        ])}
        <div class="card"><div class="tbl-wrap"><table><thead><tr>${_bsInSelectMode('clients') ? `<th style="width:36px;"><input type="checkbox" onchange="window._bsSelAllClient(this.checked)" style="cursor:pointer;accent-color:var(--accent);"></th>` : ''}<th>Client</th><th>Contact</th><th>Invoices</th><th>Total Billed</th><th>Outstanding</th><th>Last Invoice</th><th style="width:120px;">Actions</th></tr></thead><tbody>
          ${displayClients.map(c => `<tr style="cursor:pointer;" onclick="window._bsEditContact('${c.id}')">
            ${_bsInSelectMode('clients') ? `<td style="width:36px;text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" ${sel.has(c.id)?'checked':''} onchange="window._bsToggle('clients','${c.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></td>` : ''}
            <td style="font-weight:600;">${contactAvatar(c.name, c.id, 28)} ${esc(c.name)}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(c.email || c.phone || '—')}</td>
            <td style="text-align:center;">${c.count}</td>
            <td>${fmtMoney(c.total, cur)}</td>
            <td style="font-weight:700;color:${c.unpaid > 0 ? 'var(--green,#7fe0d0)' : 'var(--muted)'};">${fmtMoney(c.unpaid, cur)}</td>
            <td style="color:var(--muted);font-size:12px;">${fmtRelative(c.lastDate)}</td>
            <td style="white-space:nowrap;" onclick="event.stopPropagation();">
              <button class="bs sm" onclick="window._bsQuickAction('invoice','${c.id}')" style="font-size:11px;padding:3px 8px;cursor:pointer;">🧾 Invoice</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div></div>
        ${_bsPagination('clients', totalFiltered, 'window._bsClientPage')}
      `
    }
  `;
}

// Bulk delete contacts
window._bsBulkDeleteContact = async function(section) {
  const sel = _bsSelected(section);
  if (sel.size === 0) return;
  if (!confirm(`Delete ${sel.size} contact(s)? This cannot be undone.`)) return;
  const ids = [...sel];
  let ok = 0, fail = 0;
  for (const id of ids) {
    const { error } = await supabase.from('contacts').delete().eq('id', id);
    if (error) fail++; else ok++;
  }
  window._bsSelectMode[section] = false;
  _bsClearSel(section);
  if (fail > 0) toast(`${ok} deleted, ${fail} failed`, 'error');
  else toast(`${ok} contact(s) deleted`, 'success');
  window._bsNavigate(_bsRoute(section));
};

// Clients page navigation
window._bsClientPage = function(pg) {
  _bsSetPage('clients', pg);
  window._bsNavigate('bs-clients');
};

// Clients select all on page
window._bsSelAllClient = function(checked) {
  const ids = [...document.querySelectorAll('tbody input[type="checkbox"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'clients','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('clients', ids, checked);
  window._bsNavigate('bs-clients');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Suppliers
// ══════════════════════════════════════════════════════════════════
async function _bsRenderSuppliers(el) {
  const user = getCurrentUser();
  const cur = getCurrentProfile()?.default_currency || 'USD';
  const bizUuid = _bsBusinessId();
  const contacts = _bsContacts.length ? _bsContacts : await listContacts(bizUuid);
  _bsContacts = contacts;

  // Fetch ALL supplier bills (received bills, bills you owe) — business only
  const { data: bills } = await supabase
    .from('entries')
    .select('id,tx_type,amount,currency,status,contact_id,contact_name,invoice_number,entry_number,created_at,metadata,settled_amount')
    .eq('business_id', bizUuid)
    .eq('context_type', 'business')
    .in('tx_type', [...BS_BILL_TYPES, 'i_owe'])
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const allBills = bills || [];
  const unpaidBills = allBills.filter(e => e.status !== 'settled' && e.status !== 'voided');
  const paidBills = allBills.filter(e => e.status === 'settled');
  const totalPayable = unpaidBills.filter(e => (e.currency||'USD') === cur).reduce((s,e) => s + (e.amount||0), 0);
  const totalPaid = paidBills.filter(e => (e.currency||'USD') === cur).reduce((s,e) => s + (e.amount||0), 0);

  // Build supplier map
  const supplierMap = {};
  allBills.forEach(b => {
    if (!b.contact_id) return;
    if (!supplierMap[b.contact_id]) {
      supplierMap[b.contact_id] = { name: b.contact_name, total: 0, unpaid: 0, count: 0, lastDate: b.created_at };
    }
    supplierMap[b.contact_id].count++;
    supplierMap[b.contact_id].total += (b.amount || 0);
    if (b.status !== 'settled' && b.status !== 'voided') {
      supplierMap[b.contact_id].unpaid += (b.amount || 0);
    }
  });
  const suppliers = Object.entries(supplierMap).map(([id, c]) => {
    const contact = contacts.find(ct => ct.id === id);
    return { id, ...c, email: contact?.email || '', phone: contact?.phone || '' };
  });
  suppliers.sort((a,b) => b.unpaid - a.unpaid);

  // Tab/filter state
  if (!window._bsSupTab) window._bsSupTab = 'bills';   // bills | suppliers
  if (!window._bsSupFilter) window._bsSupFilter = 'all';
  if (!window._bsSupSearch) window._bsSupSearch = '';
  const tab = window._bsSupTab;
  const sf = window._bsSupFilter;
  const sq = window._bsSupSearch.toLowerCase();

  // Filter bills
  let displayBills = sf === 'all' ? allBills
    : sf === 'unpaid' ? unpaidBills
    : sf === 'paid' ? paidBills
    : allBills;
  if (sq) displayBills = displayBills.filter(e =>
    (e.contact_name||'').toLowerCase().includes(sq) ||
    (e.metadata?.ref_number||'').toLowerCase().includes(sq) ||
    (e.metadata?.expense_category||'').toLowerCase().includes(sq) ||
    String(e.amount||'').includes(sq)
  );

  // Reset pagination when filter/search changes
  if (sq || sf) _bsSetPage('suppliers-bills', 1);

  // Pagination for Bills Log
  const billPage = _bsPage('suppliers-bills');
  const billsTotal = displayBills.length;
  const billsPageItems = displayBills.slice((billPage - 1) * BS_PAGE_SIZE, billPage * BS_PAGE_SIZE);
  const billSel = _bsSelected('suppliers-bills');

  // Filter suppliers for supplier tab
  let displaySuppliers = sq ? suppliers.filter(c => (c.name||'').toLowerCase().includes(sq) || (c.email||'').toLowerCase().includes(sq)) : suppliers;

  // Reset pagination when search changes for suppliers tab
  if (sq) _bsSetPage('suppliers-dir', 1);

  // Pagination for Supplier Directory
  const supPage = _bsPage('suppliers-dir');
  const suppliersTotal = displaySuppliers.length;
  displaySuppliers = displaySuppliers.slice((supPage - 1) * BS_PAGE_SIZE, supPage * BS_PAGE_SIZE);
  const supSel = _bsSelected('suppliers-dir');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Suppliers & Bills</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${suppliers.length} supplier${suppliers.length!==1?'s':''} · ${allBills.length} bill${allBills.length!==1?'s':''} · ${fmtMoney(totalPayable, cur)} outstanding</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsReceiveBill()">+ Receive Bill</button>
      </div>
    </div>

    <!-- KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px;">
      <div class="card" style="padding:14px;border-left:3px solid var(--red,#d07878);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Outstanding</div>
        <div style="font-size:22px;font-weight:800;color:var(--red,#d07878);margin-top:4px;">${fmtMoney(totalPayable, cur)}</div>
        <div style="font-size:11px;color:var(--muted);">${unpaidBills.length} unpaid bill${unpaidBills.length!==1?'s':''}</div>
      </div>
      <div class="card" style="padding:14px;border-left:3px solid var(--green,#7fe0d0);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Paid</div>
        <div style="font-size:22px;font-weight:800;color:var(--green,#7fe0d0);margin-top:4px;">${fmtMoney(totalPaid, cur)}</div>
        <div style="font-size:11px;color:var(--muted);">${paidBills.length} settled</div>
      </div>
      <div class="card" style="padding:14px;border-left:3px solid var(--accent,#6366F1);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Suppliers</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${suppliers.length}</div>
        <div style="font-size:11px;color:var(--muted);">active vendors</div>
      </div>
    </div>

    <!-- Expense Category Breakdown -->
    ${(() => {
      const catMap = {};
      allBills.filter(e => (e.currency||'USD') === cur).forEach(e => {
        const cat = e.metadata?.expense_category || 'Uncategorized';
        if (!catMap[cat]) catMap[cat] = { total: 0, count: 0 };
        catMap[cat].total += (e.amount || 0);
        catMap[cat].count++;
      });
      const cats = Object.entries(catMap).sort((a,b) => b[1].total - a[1].total);
      const maxTotal = cats.length > 0 ? cats[0][1].total : 1;
      if (cats.length === 0) return '';
      return `<div class="card" style="padding:16px;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">Expense Breakdown</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${cats.slice(0,8).map(([cat, data]) => {
            const pct = Math.round((data.total / maxTotal) * 100);
            return `<div style="display:flex;align-items:center;gap:10px;">
              <div style="width:130px;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${cat}">${cat}</div>
              <div style="flex:1;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:var(--accent,#6366F1);border-radius:4px;transition:width .3s;"></div>
              </div>
              <div style="width:90px;text-align:right;font-size:12px;font-weight:600;">${fmtMoney(data.total, cur)}</div>
              <div style="width:30px;text-align:right;font-size:11px;color:var(--muted);">${data.count}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    })()}

    <!-- Tabs: Bills Log vs Supplier Directory -->
    <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);">
      <button onclick="window._bsSupTab='bills';window._bsNavigate('bs-suppliers');"
        style="padding:10px 20px;font-size:13px;font-weight:${tab==='bills'?'700':'500'};color:${tab==='bills'?'var(--accent)':'var(--muted)'};background:none;border:none;border-bottom:2px solid ${tab==='bills'?'var(--accent)':'transparent'};margin-bottom:-2px;cursor:pointer;">
        Bills Log
      </button>
      <button onclick="window._bsSupTab='suppliers';window._bsNavigate('bs-suppliers');"
        style="padding:10px 20px;font-size:13px;font-weight:${tab==='suppliers'?'700':'500'};color:${tab==='suppliers'?'var(--accent)':'var(--muted)'};background:none;border:none;border-bottom:2px solid ${tab==='suppliers'?'var(--accent)':'transparent'};margin-bottom:-2px;cursor:pointer;">
        Supplier Directory
      </button>
    </div>

    <!-- Search + Filters -->
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
      <input type="text" placeholder="Search…" value="${esc(window._bsSupSearch||'')}"
        oninput="window._bsSupSearch=this.value;window._bsNavigate('bs-suppliers');"
        style="flex:1;min-width:180px;padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;">
      ${tab === 'bills' ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${['all','unpaid','paid'].map(v => `
          <button class="bs sm" onclick="window._bsSupFilter='${v}';window._bsNavigate('bs-suppliers');"
            style="font-weight:${sf===v?'700':'500'};background:${sf===v?'var(--accent)':'var(--bg3)'};color:${sf===v?'#fff':'var(--text)'};border:1px solid ${sf===v?'var(--accent)':'var(--border)'};border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;">
            ${v.charAt(0).toUpperCase()+v.slice(1)} (${v==='all'?allBills.length:v==='unpaid'?unpaidBills.length:paidBills.length})
          </button>`).join('')}
      </div>` : ''}
      ${_bsSelectBtn(tab === 'suppliers' ? 'suppliers-dir' : 'suppliers-bills')}
    </div>

    ${tab === 'bills' ? `
      <!-- Bills Log Tab -->
      ${displayBills.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;">
            <div style="font-size:36px;margin-bottom:10px;">📄</div>
            <p style="color:var(--muted);margin-bottom:12px;">${sq ? 'No bills match your search.' : 'No bills received yet. Log your first supplier bill.'}</p>
            ${!sq ? '<button class="btn btn-primary btn-sm" onclick="window._bsReceiveBill()">Receive First Bill</button>' : ''}
          </div>`
        : `
          ${_bsBulkBar('suppliers-bills', billSel.size, [
            { label: 'Delete', onclick: "window._bsBulkDelete('suppliers-bills')" },
            { label: 'Archive', onclick: "window._bsBulkArchive('suppliers-bills')" },
            { label: 'Mark Paid', onclick: "window._bsBulkMarkPaid('suppliers-bills')" }
          ])}
          <div class="card"><div class="tbl-wrap"><table><thead><tr>${_bsInSelectMode('suppliers-bills') ? `<th style="width:36px;"><input type="checkbox" onchange="window._bsSelAllSupBill(this.checked)" style="cursor:pointer;accent-color:var(--accent);"></th>` : ''}<th>Date</th><th>Supplier</th><th>Description</th><th>Category</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
            ${billsPageItems.map(e => {
              const isPaid = e.status === 'settled';
              return `<tr style="cursor:pointer;" onclick="window._bsViewEntry('${e.id}')">
              ${_bsInSelectMode('suppliers-bills') ? `<td style="width:36px;text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" ${billSel.has(e.id)?'checked':''} onchange="window._bsToggle('suppliers-bills','${e.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></td>` : ''}
              <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
              <td style="font-weight:600;">${esc(e.contact_name || '—')}</td>
              <td style="font-size:12px;color:var(--muted);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(e.metadata?.description || e.metadata?.ref_number || '—')}</td>
              <td>${e.metadata?.expense_category ? `<span class="badge badge-gray" style="font-size:10px;">${esc(e.metadata.expense_category)}</span>` : '<span style="color:var(--muted);font-size:12px;">—</span>'}</td>
              <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
              <td>${statusBadge(e.status || 'draft')}</td>
              <td style="white-space:nowrap;" onclick="event.stopPropagation();">
                ${!isPaid ? `<button class="bs sm" onclick="window._bsRecordPayment('${e.id}')" style="font-size:11px;color:var(--green,#5fd39a);" title="Record payment">💰 Pay</button>` : ''}
              </td>
            </tr>`}).join('')}
          </tbody></table></div></div>
          ${_bsPagination('suppliers-bills', billsTotal, 'window._bsSupBillPage')}
        `
      }
    ` : `
      <!-- Supplier Directory Tab -->
      ${displaySuppliers.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;">
            <div style="font-size:36px;margin-bottom:10px;">🏪</div>
            <p style="color:var(--muted);margin-bottom:12px;">${sq ? 'No suppliers match your search.' : 'No suppliers yet. Suppliers appear automatically when you log a bill.'}</p>
          </div>`
        : `
          ${_bsBulkBar('suppliers-dir', supSel.size, [
            { label: 'Delete', onclick: "window._bsBulkDeleteContact('suppliers-dir')" }
          ])}
          <div class="card"><div class="tbl-wrap"><table><thead><tr>${_bsInSelectMode('suppliers-dir') ? `<th style="width:36px;"><input type="checkbox" onchange="window._bsSelAllSupDir(this.checked)" style="cursor:pointer;accent-color:var(--accent);"></th>` : ''}<th>Supplier</th><th>Contact</th><th>Bills</th><th>Total Billed</th><th>Outstanding</th><th>Last Bill</th><th style="width:100px;">Actions</th></tr></thead><tbody>
            ${displaySuppliers.map(c => `<tr style="cursor:pointer;" onclick="window._bsEditContact('${c.id}')">
              ${_bsInSelectMode('suppliers-dir') ? `<td style="width:36px;text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" ${supSel.has(c.id)?'checked':''} onchange="window._bsToggle('suppliers-dir','${c.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></td>` : ''}
              <td style="font-weight:600;">${contactAvatar(c.name, c.id, 28)} ${esc(c.name)}</td>
              <td style="font-size:12px;color:var(--muted);">${esc(c.email || c.phone || '—')}</td>
              <td style="text-align:center;">${c.count}</td>
              <td>${fmtMoney(c.total, cur)}</td>
              <td style="font-weight:700;color:${c.unpaid > 0 ? 'var(--red,#d07878)' : 'var(--muted)'};">${fmtMoney(c.unpaid, cur)}</td>
              <td style="color:var(--muted);font-size:12px;">${fmtRelative(c.lastDate)}</td>
              <td style="white-space:nowrap;" onclick="event.stopPropagation();">
                <button class="bs sm" onclick="window._bsEditContact('${c.id}')" style="font-size:11px;padding:3px 8px;cursor:pointer;">✏ Edit</button>
              </td>
            </tr>`).join('')}
          </tbody></table></div></div>
          ${_bsPagination('suppliers-dir', suppliersTotal, 'window._bsSupDirPage')}
        `
      }
    `}
  `;
}

// Suppliers Bills Log page navigation
window._bsSupBillPage = function(pg) {
  _bsSetPage('suppliers-bills', pg);
  window._bsNavigate('bs-suppliers');
};

// Suppliers Bills Log select all on page
window._bsSelAllSupBill = function(checked) {
  const ids = [...document.querySelectorAll('tbody input[type="checkbox"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'suppliers-bills','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('suppliers-bills', ids, checked);
  window._bsNavigate('bs-suppliers');
};

// Suppliers Directory page navigation
window._bsSupDirPage = function(pg) {
  _bsSetPage('suppliers-dir', pg);
  window._bsNavigate('bs-suppliers');
};

// Suppliers Directory select all on page
window._bsSelAllSupDir = function(checked) {
  const ids = [...document.querySelectorAll('tbody input[type="checkbox"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'suppliers-dir','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('suppliers-dir', ids, checked);
  window._bsNavigate('bs-suppliers');
};

// ── Reusable Add New Contact Function ──────────────────────────────
// Opens a modal to create a new contact with Name + Email fields
// Calls the provided callback with the newly created contact object
window._bsAddNewContact = async function(callback) {
  openModal(`
    <h3 style="margin-bottom:16px;">Add New Contact</h3>
    <div class="form-group">
      <label>Name *</label>
      <input type="text" id="bs-new-contact-name" placeholder="Full name" autofocus>
    </div>
    <div class="form-group">
      <label>Email (optional)</label>
      <input type="email" id="bs-new-contact-email" placeholder="email@example.com">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary sm" onclick="window._bsDoAddNewContact(${typeof callback === 'function'})">Add Contact</button>
    </div>
  `, { maxWidth: '440px' });

  // Store the callback for use in _bsDoAddNewContact
  window._bsNewContactCallback = callback;
};

window._bsDoAddNewContact = async function() {
  const name = (document.getElementById('bs-new-contact-name')?.value || '').trim();
  const email = (document.getElementById('bs-new-contact-email')?.value || '').trim();

  if (!name) { toast('Name is required', 'error'); return; }

  const user = getCurrentUser();
  const { data: newContact, error } = await supabase
    .from('contacts')
    .insert({ user_id: user.id, business_id: _bsBusinessId(), name, email: email || null })
    .select().single();

  if (error) { toast('Failed to add contact: ' + error.message, 'error'); return; }

  closeModal();
  toast(`Added ${name}`, 'success');

  // Call the callback if provided
  if (typeof window._bsNewContactCallback === 'function') {
    window._bsNewContactCallback(newContact);
  }
  window._bsNewContactCallback = null;
};

// ── Edit Contact / Business Partner Detail ──────────────────────
window._bsEditContact = async function(contactId) {
  const { data: c, error } = await supabase.from('contacts').select('*').eq('id', contactId).single();
  if (error || !c) { toast('Contact not found', 'error'); return; }
  openModal(`
    <h3 style="margin-bottom:4px;">Edit Contact</h3>
    <p style="color:var(--muted);font-size:12px;margin-bottom:16px;">Update business details for this contact</p>
    <div class="form-group"><label>Name *</label><input type="text" id="bsc-name" value="${esc(c.name)}" placeholder="Full name or business name"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label>Email</label><input type="email" id="bsc-email" value="${esc(c.email || '')}" placeholder="email@example.com"></div>
      <div class="form-group"><label>Phone</label><input type="tel" id="bsc-phone" value="${esc(c.phone || '')}" placeholder="+1 234 567 8900"></div>
    </div>
    <div class="form-group"><label>Business Address</label><input type="text" id="bsc-address" value="${esc(c.address || '')}" placeholder="123 Main St, City, State"></div>
    <div class="form-group"><label>Notes</label><textarea id="bsc-notes" rows="2" placeholder="Any extra notes about this contact…" style="width:100%;resize:vertical;">${esc(c.notes || '')}</textarea></div>
    <div class="form-group"><label>Tags</label><input type="text" id="bsc-tags" value="${esc((c.tags || []).join(', '))}" placeholder="e.g. supplier, client, vendor"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary sm" onclick="window._bsSaveContact('${contactId}')">Save Changes</button>
    </div>
  `, { maxWidth: '520px' });
};

window._bsSaveContact = async function(contactId) {
  const name = (document.getElementById('bsc-name')?.value || '').trim();
  if (!name) { toast('Name is required', 'error'); return; }
  const updates = {
    name,
    email: (document.getElementById('bsc-email')?.value || '').trim(),
    phone: (document.getElementById('bsc-phone')?.value || '').trim(),
    address: (document.getElementById('bsc-address')?.value || '').trim(),
    notes: (document.getElementById('bsc-notes')?.value || '').trim(),
    tags: (document.getElementById('bsc-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean)
  };
  const { error } = await supabase.from('contacts').update(updates).eq('id', contactId);
  if (error) { toast('Save failed: ' + error.message, 'error'); return; }
  closeModal();
  toast('Contact updated', 'success');
  _bsContacts = []; // clear cache
  // Refresh current section
  if (_bsEl && _bsSection) _bsNavigate(_bsSection);
};

// ── Receive Bill modal — Log an incoming supplier bill ─────────
window._bsReceiveBill = function() {
  const cur = getCurrentProfile()?.default_currency || 'USD';
  // Check if we have a preselected contact from add-new flow
  const preContact = window._bsRbPreselectedContact || null;
  if (preContact) window._bsRbPreselectedContact = null; // consume once
  openModal(`
    <div class="modal-title">Receive Bill</div>
    <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">Log an incoming bill from a supplier. Record what it's for, the amount, and tag the expense category.</p>

    <div class="form-group">
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>Supplier *</span>
        <button type="button" onclick="window._bsAddNewContact(function(c){if(c){window._bsRbPreselectedContact=c;}closeModal();window._bsReceiveBill();})" style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;font-weight:700;">+ Add New</button>
      </label>
      <input type="text" id="bs-rb-supplier" placeholder="Search or enter supplier name…" autocomplete="off"
        oninput="window._bsRbSearchContact(this.value)" style="width:100%;">
      <div id="bs-rb-contact-results" style="max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:4px;display:none;"></div>
      <input type="hidden" id="bs-rb-contact-id" value="">
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label>Amount *</label>
        <div style="display:flex;gap:6px;">
          <select id="bs-rb-currency" style="flex:0 0 90px;">
            ${BS_CURRENCIES.map(c => `<option value="${c}" ${c===cur?'selected':''}>${c}</option>`).join('')}
          </select>
          <input type="number" id="bs-rb-amount" placeholder="0.00" step="0.01" min="0" style="flex:1;">
        </div>
      </div>
      <div class="form-group">
        <label>Bill Date</label>
        <input type="date" id="bs-rb-date" value="${new Date().toISOString().slice(0,10)}">
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label>Due Date</label>
        <input type="date" id="bs-rb-due">
      </div>
      <div class="form-group">
        <label>Supplier Phone</label>
        <input type="tel" id="bs-rb-phone" placeholder="e.g. +1 555-0100" style="width:100%;">
      </div>
    </div>

    <div class="form-group">
      <label>What's it for? (Description)</label>
      <input type="text" id="bs-rb-desc" placeholder="e.g. Office supplies, Q1 inventory shipment…" style="width:100%;">
    </div>

    <div class="form-group">
      <label>Expense Category</label>
      <select id="bs-rb-category" style="width:100%;">
        <option value="">— Select category —</option>
        ${BS_EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>

    <div class="form-group">
      <label>Reference / Invoice # (optional)</label>
      <input type="text" id="bs-rb-ref" placeholder="e.g. INV-12345" style="width:100%;">
    </div>

    <div class="form-group">
      <label>Notes (optional)</label>
      <textarea id="bs-rb-notes" rows="2" placeholder="Any extra notes…" style="width:100%;resize:vertical;"></textarea>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="bs sm" style="color:var(--amber,#f59e0b);border-color:var(--amber,#f59e0b);" onclick="window._bsSaveReceivedBill('draft')">Save Draft</button>
      <button class="btn btn-primary sm" onclick="window._bsSaveReceivedBill()">Create Bill</button>
    </div>
  `, { maxWidth: '520px' });
  // Apply preselected contact if returning from add-new flow
  if (preContact) {
    const sEl = document.getElementById('bs-rb-supplier');
    const idEl = document.getElementById('bs-rb-contact-id');
    if (sEl) sEl.value = preContact.name || '';
    if (idEl) idEl.value = preContact.id || '';
  }
};

// Contact search for Receive Bill
window._bsRbSearchContact = async function(query) {
  const el = document.getElementById('bs-rb-contact-results');
  if (!el) return;
  if (!query || query.length < 1) { el.style.display = 'none'; return; }
  const contacts = _bsContacts.length ? _bsContacts : await listContacts(_bsBusinessId());
  _bsContacts = contacts;
  const q = query.toLowerCase();
  const matches = contacts.filter(c =>
    (c.name||'').toLowerCase().includes(q) ||
    (c.email||'').toLowerCase().includes(q)
  ).slice(0, 8);

  let html = matches.map(c => `
    <div onclick="document.getElementById('bs-rb-supplier').value='${esc(c.name)}';document.getElementById('bs-rb-contact-id').value='${c.id}';document.getElementById('bs-rb-contact-results').style.display='none';"
      style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);"
      onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''">
      ${contactAvatar(c.name, c.id, 24)}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${esc(c.name)}</div>
        ${c.email ? `<div style="font-size:11px;color:var(--muted);">${esc(c.email)}</div>` : ''}
      </div>
    </div>
  `).join('');

  // Always show "Add new" option at bottom
  const exactMatch = matches.some(c => (c.name||'').toLowerCase() === q);
  if (!exactMatch && query.length >= 2) {
    html += `
      <div onclick="document.getElementById('bs-rb-supplier').value='${esc(query)}';document.getElementById('bs-rb-contact-id').value='';document.getElementById('bs-rb-contact-results').style.display='none';"
        style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;background:rgba(99,102,241,.06);border-top:1px solid var(--border);"
        onmouseenter="this.style.background='rgba(99,102,241,.12)'" onmouseleave="this.style.background='rgba(99,102,241,.06)'">
        <span style="font-size:16px;">➕</span>
        <div>
          <div style="font-weight:600;font-size:13px;color:var(--accent,#6366F1);">Add "${esc(query)}" as new supplier</div>
          <div style="font-size:11px;color:var(--muted);">Will create a new contact automatically</div>
        </div>
      </div>`;
  }

  if (!html) {
    html = `<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">Type to search contacts or add a new supplier</div>`;
  }
  el.innerHTML = html;
  el.style.display = 'block';
};

// Save received bill as a bill_sent entry
window._bsSaveReceivedBill = async function(saveAs) {
  const isDraft = saveAs === 'draft';
  const supplierName = (document.getElementById('bs-rb-supplier')?.value || '').trim();
  const contactId = (document.getElementById('bs-rb-contact-id')?.value || '').trim();
  const amount = parseFloat(document.getElementById('bs-rb-amount')?.value) || 0;
  const currency = document.getElementById('bs-rb-currency')?.value || 'USD';
  const billDate = document.getElementById('bs-rb-date')?.value || new Date().toISOString().slice(0,10);
  const dueDate = document.getElementById('bs-rb-due')?.value || '';
  const description = (document.getElementById('bs-rb-desc')?.value || '').trim();
  const category = document.getElementById('bs-rb-category')?.value || '';
  const refNum = (document.getElementById('bs-rb-ref')?.value || '').trim();
  const notes = (document.getElementById('bs-rb-notes')?.value || '').trim();
  const phone = (document.getElementById('bs-rb-phone')?.value || '').trim();

  if (!supplierName) { toast('Supplier is required', 'error'); return; }
  if (amount <= 0) { toast('Amount must be greater than 0', 'error'); return; }

  const user = getCurrentUser();

  // If no existing contact, create one
  let finalContactId = contactId;
  if (!finalContactId) {
    const contactInsert = { user_id: user.id, business_id: _bsBusinessId(), name: supplierName, tags: ['supplier'] };
    if (phone) contactInsert.phone = phone;
    const { data: newContact, error: cErr } = await supabase
      .from('contacts')
      .insert(contactInsert)
      .select().single();
    if (cErr) { toast('Failed to create supplier contact', 'error'); return; }
    finalContactId = newContact.id;
    _bsContacts = []; // clear cache
  } else if (phone && finalContactId) {
    // Update existing contact's phone if provided
    await supabase.from('contacts').update({ phone }).eq('id', finalContactId);
  }

  const metadata = {};
  if (dueDate) metadata.due_date = dueDate;
  if (description) metadata.description = description;
  if (category) metadata.expense_category = category;
  if (refNum) metadata.ref_number = refNum;
  if (notes) metadata.notes = notes;

  // Use createEntry for proper entry_number counter tracking
  let entry;
  try {
    entry = await createEntry(user.id, {
      contactId: finalContactId,
      txType: 'bill_received',
      amount,
      currency,
      date: billDate,
      note: description || '',
      invoiceNumber: refNum || '',
      status: isDraft ? 'draft' : 'posted',
      metadata: Object.keys(metadata).length ? metadata : null,
      businessId: _bsBusinessId()
    });
  } catch (err) {
    console.error('[_bsSaveReceivedBill] createEntry threw:', err);
    toast('Save failed: ' + (err.sbError?.message || err.message || 'unknown error'), 'error');
    return;
  }

  if (!entry) { toast('Failed to log bill', 'error'); return; }
  // Update contact_name on the entry (createEntry doesn't set it)
  await supabase.from('entries').update({ contact_name: supplierName }).eq('id', entry.id);
  closeModal();
  toast(isDraft ? 'Draft saved.' : 'Bill logged from ' + supplierName, 'success');
  window._bsNavigate('bs-bills');
};

// Record payment against a bill
window._bsRecordPayment = async function(entryId) {
  const { data: entry } = await supabase.from('entries').select('*').eq('id', entryId).single();
  if (!entry) { toast('Bill not found', 'error'); return; }

  openModal(`
    <div class="modal-title">Record Payment</div>
    <div style="padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);margin-bottom:14px;">
      <div style="font-weight:700;font-size:14px;">${esc(entry.contact_name || 'Supplier')}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:2px;">${entry.metadata?.description || entry.metadata?.ref_number || 'Bill'} · ${fmtMoney(entry.amount, entry.currency)}</div>
      ${entry.metadata?.expense_category ? `<span class="badge badge-gray" style="font-size:10px;margin-top:4px;">${esc(entry.metadata.expense_category)}</span>` : ''}
    </div>
    <div class="form-group">
      <label>Payment Date</label>
      <input type="date" id="bs-pay-date" value="${new Date().toISOString().slice(0,10)}">
    </div>
    <div class="form-group">
      <label>Payment Note (optional)</label>
      <input type="text" id="bs-pay-note" placeholder="e.g. Bank transfer ref #1234" style="width:100%;">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary sm" onclick="window._bsConfirmPayment('${entryId}')">Mark as Paid</button>
    </div>
  `, { maxWidth: '440px' });
};

window._bsConfirmPayment = async function(entryId) {
  const payDate = document.getElementById('bs-pay-date')?.value || new Date().toISOString().slice(0,10);
  const payNote = (document.getElementById('bs-pay-note')?.value || '').trim();

  const { data: entry } = await supabase.from('entries').select('metadata').eq('id', entryId).single();
  const meta = entry?.metadata || {};
  // Defensively ensure business_id is preserved on the entry row
  if (!entry.business_id) {
    await supabase.from('entries').update({ business_id: _bsBusinessId() }).eq('id', entry.id);
  }
  meta.paid_date = payDate;
  if (payNote) meta.payment_note = payNote;

  const { error } = await supabase.from('entries')
    .update({ status: 'settled', metadata: meta })
    .eq('id', entryId);

  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  closeModal();
  toast('Bill marked as paid', 'success');
  window._bsNavigate('bs-bills');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Recurring Billing
// ══════════════════════════════════════════════════════════════════
async function _bsRenderRecurring(el) {
  const user = getCurrentUser();
  const cur = getCurrentProfile()?.default_currency || 'USD';
  const bizUuid = _bsBusinessId();
  const rules = await listRecurring(bizUuid);

  // All rules returned are already scoped to this business_id via RLS
  const bizRules = rules;
  const activeRules = bizRules.filter(r => r.active);
  const pausedRules = bizRules.filter(r => !r.active);
  const totalRecurring = activeRules.reduce((s,r) => s + (r.amount||0), 0);

  if (!window._bsRecFilter) window._bsRecFilter = 'all';
  const rf = window._bsRecFilter;
  const displayRules = rf === 'all' ? bizRules : rf === 'active' ? activeRules : pausedRules;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Recurring Billing</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${bizRules.length} rule${bizRules.length!==1?'s':''} · ${activeRules.length} active · ${fmtMoney(totalRecurring, cur)} recurring revenue</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsCreateRecurring()">+ New Rule</button>
      </div>
    </div>

    <!-- Summary cards -->
    ${bizRules.length > 0 ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px;">
      <div class="card" style="padding:14px;border-left:3px solid var(--green,#7fe0d0);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Active Rules</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${activeRules.length}</div>
      </div>
      <div class="card" style="padding:14px;border-left:3px solid var(--gold,#d6b97a);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Recurring Total</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${fmtMoney(totalRecurring, cur)}</div>
      </div>
      <div class="card" style="padding:14px;border-left:3px solid var(--border);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Paused</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${pausedRules.length}</div>
      </div>
    </div>` : ''}

    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
      ${['all','active','paused'].map(v => `
        <button class="bs sm" onclick="window._bsRecFilter='${v}';window._bsNavigate('bs-recurring');"
          style="font-weight:${rf===v?'700':'500'};background:${rf===v?'var(--accent)':'var(--bg3)'};color:${rf===v?'#fff':'var(--text)'};border:1px solid ${rf===v?'var(--accent)':'var(--border)'};border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;">
          ${v.charAt(0).toUpperCase()+v.slice(1)} (${v==='all'?bizRules.length:v==='active'?activeRules.length:pausedRules.length})
        </button>`).join('')}
      <div style="margin-left:auto;">${_bsSelectBtn('recurring')}</div>
    </div>

    ${displayRules.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:36px;margin-bottom:10px;">🔁</div>
          <p style="color:var(--muted);margin-bottom:12px;">${bizRules.length === 0 ? 'No recurring billing rules yet. Set up automatic invoices or bills on a schedule.' : 'No rules match this filter.'}</p>
          ${bizRules.length === 0 ? '<button class="btn btn-primary btn-sm" onclick="window._bsCreateRecurring()">Create First Rule</button>' : ''}
        </div>`
      : `
          ${_bsBulkBar('recurring', _bsSelected('recurring').size, [
            { label: 'Delete', onclick: 'window._bsBulkDeleteRecurring()' }
          ])}
          <div class="card"><div class="tbl-wrap"><table><thead><tr>${_bsInSelectMode('recurring') ? `<th style="width:36px;"><input type="checkbox" onchange="window._bsSelAllRecurring(this.checked)" style="cursor:pointer;accent-color:var(--accent);"></th>` : ''}<th>Contact</th><th>Type</th><th>Amount</th><th>Frequency</th><th>Next Run</th><th>Status</th><th style="width:120px;">Actions</th></tr></thead><tbody>
          ${displayRules.map(r => `<tr>
            ${_bsInSelectMode('recurring') ? `<td style="width:36px;text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" ${_bsSelected('recurring').has(r.id)?'checked':''} onchange="window._bsToggle('recurring','${r.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></td>` : ''}
            <td style="font-weight:600;">${esc(r.contact?.name || 'Self')}</td>
            <td style="font-size:13px;">${esc(_bsTxLabel(r.tx_type))}</td>
            <td style="font-weight:700;">${fmtMoney(r.amount, r.currency)}</td>
            <td>${esc(FREQUENCIES[r.frequency] || r.frequency)}</td>
            <td style="color:var(--muted);font-size:13px;">${fmtDate(r.next_run_at)}</td>
            <td><span class="badge ${r.active ? 'badge-green' : 'badge-gray'}">${r.active ? 'Active' : 'Paused'}</span></td>
            <td style="white-space:nowrap;">
              <button class="bs sm" onclick="event.stopPropagation();window._bsToggleRecurring('${r.id}',${!r.active})" style="font-size:11px;padding:3px 8px;cursor:pointer;">${r.active ? '⏸ Pause' : '▶ Resume'}</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// ── Recurring rule actions ────────────────────────────────────────
window._bsToggleRecurring = async function(ruleId, setActive) {
  const { error } = await supabase
    .from('recurring_rules')
    .update({ active: setActive, updated_at: new Date().toISOString() })
    .eq('id', ruleId);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast(setActive ? 'Rule resumed' : 'Rule paused', 'success');
  window._bsNavigate('bs-recurring');
};

window._bsDeleteRecurring = async function(ruleId) {
  if (!confirm('Delete this recurring rule? This cannot be undone.')) return;
  const { error } = await supabase
    .from('recurring_rules')
    .delete()
    .eq('id', ruleId);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Recurring rule deleted', 'success');
  window._bsNavigate('bs-recurring');
};

// Bulk delete recurring rules
window._bsBulkDeleteRecurring = async function() {
  const sel = _bsSelected('recurring');
  if (sel.size === 0) return;
  if (!confirm(`Delete ${sel.size} recurring rule(s)? This cannot be undone.`)) return;
  const ids = [...sel];
  let ok = 0, fail = 0;
  for (const id of ids) {
    const { error } = await supabase.from('recurring_rules').delete().eq('id', id);
    if (error) fail++; else ok++;
  }
  window._bsSelectMode['recurring'] = false;
  _bsClearSel('recurring');
  if (fail > 0) toast(`${ok} deleted, ${fail} failed`, 'error');
  else toast(`${ok} rule(s) deleted`, 'success');
  window._bsNavigate('bs-recurring');
};

// Recurring select all
window._bsSelAllRecurring = function(checked) {
  const ids = [...document.querySelectorAll('tbody input[type="checkbox"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'recurring','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('recurring', ids, checked);
  window._bsNavigate('bs-recurring');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Business Ledgers (Form Generator)
// ══════════════════════════════════════════════════════════════════
async function _bsRenderPanels(el) {
  // If a panel was open, re-open ONLY if it belongs to the current business context
  const activePanelId = window._bpEngine?.currentPanelId;
  if (activePanelId) {
    const cachedBiz = window._bpEngine._lastBizId;
    const currentBiz = _bsDataOwnerId() || (window.getSession ? window.getSession().businessId : null);
    if (cachedBiz && currentBiz && cachedBiz === currentBiz) {
      window._bpEngine.openPanel(activePanelId);
      return;
    }
    // Stale context — reset and fall through to list
    window._bpEngine.resetPanelState();
  }

  const user = getCurrentUser();
  const ownerId = _bsDataOwnerId();
  if (!window._bsPanelTab) window._bsPanelTab = 'mine';
  const tab = window._bsPanelTab;

  if (tab === 'public') {
    // ── Public Panel DB (moved here from separate sidebar item) ──
    let panels = [];
    try {
      const { data, error } = await supabase
        .from('business_panels')
        .select('id, title, currency, session_type, fields, user_id, created_at, updated_at')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error) panels = data || [];
    } catch(_) {}

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;margin:0;">Business Ledgers</h2>
          <p style="color:var(--muted);font-size:13px;margin-top:2px;">${panels.length} public ledger${panels.length!==1?'s':''} available</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="window._bsCreatePanel()">+ New Ledger</button>
      </div>
      <!-- Tabs -->
      <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);">
        <button onclick="window._bsPanelTab='mine';window._bsNavigate('bs-panels');"
          style="padding:10px 20px;font-size:13px;font-weight:500;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;">
          My Ledgers
        </button>
        <button onclick="window._bsPanelTab='public';window._bsNavigate('bs-panels');"
          style="padding:10px 20px;font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;cursor:pointer;">
          Public DB
        </button>
      </div>
      ${panels.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;">
            <div style="font-size:32px;margin-bottom:12px;">📋</div>
            <p style="color:var(--muted);margin-bottom:12px;">No public ledgers available yet.</p>
            <p style="color:var(--muted);font-size:12px;">Publish one of your ledgers to share it here.</p>
          </div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">
            ${panels.map(p => {
              const fields = p.fields || [];
              const isOwn = p.user_id === ownerId;
              return `
              <div class="card" style="padding:18px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                  <div style="font-size:16px;font-weight:700;">${esc(p.title)}</div>
                  ${isOwn ? '<span class="badge badge-purple" style="font-size:10px;">Yours</span>' : ''}
                </div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(p.session_type || 'Standard')} · ${esc(p.currency || 'USD')}</div>
                <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                  ${fields.slice(0,5).map(f => `<span class="badge badge-gray" style="font-size:10px;">${esc(f.name||f.label||'Field')}</span>`).join('')}
                  ${fields.length > 5 ? `<span class="badge badge-gray" style="font-size:10px;">+${fields.length-5} more</span>` : ''}
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:6px;">Published ${fmtRelative(p.created_at)}</div>
                <div style="margin-top:10px;display:flex;gap:6px;">
                  <button class="btn btn-primary btn-sm" onclick="window._bsCopyPanel('${p.id}')">📋 Install</button>
                  <button class="bs sm" onclick="window._bsPreviewPanel('${p.id}')" style="font-size:12px;">👁 Preview</button>
                </div>
              </div>`;
            }).join('')}
          </div>`
      }
    `;
    return;
  }

  // ── My Ledgers tab ──
  const bizUuid = _bsBusinessId();
  const allPanels = await listPanels(bizUuid);
  // All panels returned by listPanels are already scoped to this business_id via RLS
  const panels = allPanels;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Business Ledgers</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${panels.length} panel${panels.length!==1?'s':''} · ${panels.filter(p=>p.is_public).length} published</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsCreatePanel()">+ New Ledger</button>
      </div>
    </div>
    <!-- Tabs + Select -->
    <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);align-items:center;">
      <button onclick="window._bsPanelTab='mine';window._bsNavigate('bs-panels');"
        style="padding:10px 20px;font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;cursor:pointer;">
        My Ledgers
      </button>
      <button onclick="window._bsPanelTab='public';window._bsNavigate('bs-panels');"
        style="padding:10px 20px;font-size:13px;font-weight:500;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;">
        Public DB
      </button>
      <div style="margin-left:auto;padding-bottom:4px;">${_bsSelectBtn('panels')}</div>
    </div>
    ${panels.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:36px;margin-bottom:10px;">📋</div>
          <p style="font-weight:700;font-size:15px;margin-bottom:6px;">No business ledgers yet</p>
          <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">Your business starts fresh. Create a new ledger or import one from the Public DB.</p>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button class="btn btn-primary btn-sm" onclick="window._bsCreatePanel()">Create Ledger</button>
            <button class="btn btn-secondary btn-sm" onclick="window._bsPanelTab='public';window._bsNavigate('bs-panels');">Browse Public DB</button>
          </div>
        </div>`
      : `
          ${_bsBulkBar('panels', _bsSelected('panels').size, [
            { label: 'Delete', onclick: 'window._bsBulkDeletePanels()' }
          ])}
          ${_bsInSelectMode('panels') ? `<div style="margin-bottom:10px;"><label style="cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;color:var(--muted);"><input type="checkbox" onchange="window._bsSelAllPanels(this.checked)" style="cursor:pointer;accent-color:var(--accent);"> Select All</label></div>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${panels.map(p => `
            <div class="card" style="padding:18px;${_bsInSelectMode('panels')?'position:relative;':''}">
              ${_bsInSelectMode('panels') ? `<label style="position:absolute;top:10px;right:10px;cursor:pointer;" onclick="event.stopPropagation();"><input type="checkbox" ${_bsSelected('panels').has(p.id)?'checked':''} onchange="window._bsToggle('panels','${p.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></label>` : ''}
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="font-size:16px;font-weight:700;cursor:pointer;flex:1;" onclick="if(window._bpEngine?.openPanel)window._bpEngine.openPanel('${p.id}');else toast('Ledger engine not loaded','error');">${esc(p.title)}</div>
                ${p.is_public ? '<span class="badge badge-blue" style="font-size:10px;flex-shrink:0;">Public</span>' : ''}
              </div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(p.session_type || 'Standard')} · ${esc(p.currency || 'USD')}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:6px;">${(p.fields||[]).length} field${(p.fields||[]).length!==1?'s':''} · Updated ${fmtRelative(p.updated_at || p.created_at)}</div>
              <div style="display:flex;gap:6px;margin-top:10px;">
                <button class="bs sm" onclick="if(window._bpEngine?.openPanel)window._bpEngine.openPanel('${p.id}');" style="font-size:12px;">Open</button>
                <button class="bs sm" onclick="if(window._bpEngine?.openEditPanelModal)window._bpEngine.openEditPanelModal('${p.id}');" style="font-size:12px;">✏ Edit</button>
              </div>
            </div>
          `).join('')}
        </div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Templates
// ══════════════════════════════════════════════════════════════════
async function _bsRenderTemplates(el) {
  const user = getCurrentUser();
  const ownerId = _bsDataOwnerId();

  // Tab state: my templates vs public DB
  if (!window._bsTmplTab) window._bsTmplTab = 'mine';
  if (!window._bsTmplSearch) window._bsTmplSearch = '';
  const tab = window._bsTmplTab;
  const tq = window._bsTmplSearch.toLowerCase();

  if (tab === 'public') {
    // ── Public Template DB ──────────────────────────────
    const publicTemplates = await listPublicTemplates();
    const display = tq ? publicTemplates.filter(t => (t.name||'').toLowerCase().includes(tq) || (t.description||'').toLowerCase().includes(tq)) : publicTemplates;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <div>
          <h2 style="font-size:20px;font-weight:800;margin:0;">Template Public DB</h2>
          <p style="color:var(--muted);font-size:13px;margin-top:2px;">${publicTemplates.length} public template${publicTemplates.length!==1?'s':''} available</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="window._bsCreateTemplate()">+ New Template</button>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);">
        <button onclick="window._bsTmplTab='mine';window._bsNavigate('bs-templates');"
          style="padding:10px 20px;font-size:13px;font-weight:500;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;">
          My Templates
        </button>
        <button onclick="window._bsTmplTab='public';window._bsNavigate('bs-templates');"
          style="padding:10px 20px;font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;cursor:pointer;">
          Public DB
        </button>
      </div>

      <input type="text" placeholder="Search public templates…" value="${esc(window._bsTmplSearch||'')}"
        oninput="window._bsTmplSearch=this.value;window._bsNavigate('bs-templates');"
        style="width:100%;max-width:320px;padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;margin-bottom:14px;">

      ${display.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;">
            <div style="font-size:36px;margin-bottom:10px;">📑</div>
            <p style="color:var(--muted);margin-bottom:12px;">${tq ? 'No templates match your search.' : 'No public templates available yet. Publish one of your templates to share it here.'}</p>
          </div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">
            ${display.map(t => {
              const isOwn = t.user_id === ownerId;
              const fCount = (t.fields||[]).length;
              const creator = t.creator?.display_name || '';
              return `
              <div class="card" style="padding:18px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                  <div style="font-size:16px;font-weight:700;">${esc(t.name)}</div>
                  ${isOwn ? '<span class="badge badge-purple" style="font-size:10px;">Yours</span>' : ''}
                </div>
                ${t.description ? `<p style="font-size:12px;color:var(--muted);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(t.description)}</p>` : ''}
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                  <span class="badge badge-blue">${fCount} field${fCount!==1?'s':''}</span>
                  ${t.tx_type ? `<span class="badge badge-gray">${esc(_bsTxLabel(t.tx_type))}</span>` : ''}
                </div>
                ${creator ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;">by ${esc(creator)}</div>` : ''}
                <div style="margin-top:10px;display:flex;gap:6px;">
                  ${!isOwn ? `<button class="btn btn-primary btn-sm" onclick="window._bsCopyTemplate('${t.id}')">+ Install</button>` : `<button class="btn btn-secondary btn-sm" onclick="if(window.openEditTemplate)window.openEditTemplate('${t.id}')">Edit</button>`}
                  <button class="bs sm" onclick="window._bsPreviewTemplate('${t.id}')" style="font-size:12px;">Preview</button>
                </div>
              </div>`;
            }).join('')}
          </div>`
      }
    `;
    return;
  }

  // ── My Templates tab — only show business-tracked templates ──
  const bizUuid = _bsBusinessId();
  const allTemplates = await listTemplates(bizUuid);
  // All templates returned are already scoped to this business_id via RLS
  const templates = allTemplates;
  const display = tq ? templates.filter(t => (t.name||'').toLowerCase().includes(tq) || (t.description||'').toLowerCase().includes(tq)) : templates;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Templates</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${templates.length} template${templates.length!==1?'s':''} · Reusable invoice and form layouts</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsCreateTemplate()">+ New Template</button>
      </div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);">
      <button onclick="window._bsTmplTab='mine';window._bsNavigate('bs-templates');"
        style="padding:10px 20px;font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;cursor:pointer;">
        My Templates
      </button>
      <button onclick="window._bsTmplTab='public';window._bsNavigate('bs-templates');"
        style="padding:10px 20px;font-size:13px;font-weight:500;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;">
        Public DB
      </button>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
      <input type="text" placeholder="Search my templates…" value="${esc(window._bsTmplSearch||'')}"
        oninput="window._bsTmplSearch=this.value;window._bsNavigate('bs-templates');"
        style="flex:1;min-width:180px;max-width:320px;padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;">
      <div style="margin-left:auto;">${_bsSelectBtn('templates')}</div>
    </div>

    ${display.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:36px;margin-bottom:10px;">📑</div>
          <p style="font-weight:700;font-size:15px;margin-bottom:6px;">${tq ? 'No templates match your search' : 'No templates yet'}</p>
          <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">Create your own or install one from the Public DB.</p>
          <div style="display:flex;gap:8px;justify-content:center;">
            ${!tq ? '<button class="btn btn-primary btn-sm" onclick="window._bsCreateTemplate()">Create Template</button>' : ''}
            <button class="btn btn-secondary btn-sm" onclick="window._bsTmplTab=\'public\';window._bsNavigate(\'bs-templates\')">Browse Public DB</button>
          </div>
        </div>`
      : `
          ${_bsBulkBar('templates', _bsSelected('templates').size, [
            { label: 'Delete', onclick: 'window._bsBulkDeleteTemplates()' }
          ])}
          ${_bsInSelectMode('templates') ? `<div style="margin-bottom:10px;"><label style="cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;color:var(--muted);"><input type="checkbox" onchange="window._bsSelAllTemplates(this.checked)" style="cursor:pointer;accent-color:var(--accent);"> Select All</label></div>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${display.map(t => `
            <div class="card" style="padding:18px;${_bsInSelectMode('templates')?'position:relative;':''}">
              ${_bsInSelectMode('templates') ? `<label style="position:absolute;top:10px;right:10px;cursor:pointer;" onclick="event.stopPropagation();"><input type="checkbox" ${_bsSelected('templates').has(t.id)?'checked':''} onchange="window._bsToggle('templates','${t.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></label>` : ''}
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div style="font-size:16px;font-weight:700;">${esc(t.name)}</div>
                ${t.is_public ? '<span class="badge badge-blue" style="font-size:10px;">Public</span>' : '<span class="badge badge-gray" style="font-size:10px;">Private</span>'}
              </div>
              ${t.description ? `<p style="font-size:12px;color:var(--muted);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(t.description)}</p>` : ''}
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                <span class="badge badge-blue">${(t.fields||[]).length} field${(t.fields||[]).length!==1?'s':''}</span>
                ${t.tx_type ? `<span class="badge badge-gray">${esc(_bsTxLabel(t.tx_type))}</span>` : ''}
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:8px;">Updated ${fmtRelative(t.updated_at || t.created_at)}</div>
              <div style="margin-top:12px;display:flex;gap:6px;">
                <button class="btn btn-primary btn-sm" onclick="window._bsActiveContext=true;window._bsActiveBizId=window._getBizId?.()??'';if(window.useTemplateForEntry)window.useTemplateForEntry('${t.id}')">Use</button>
                <button class="btn btn-secondary btn-sm" onclick="if(window.openEditTemplate)window.openEditTemplate('${t.id}')">Edit</button>
              </div>
            </div>
          `).join('')}
        </div>`
    }
  `;
}

// ── Business context creation hooks ──────────────────────────────
// When creating panels/templates from BS, set a flag so the creation
// flow tags the new item into the business context tracker.
window._bsCreatePanel = function() {
  window._bsCreatingPanel = true;
  if (window._bpEngine?.openCreateModal) window._bpEngine.openCreateModal();
  else toast('Ledger engine not loaded', 'error');
};

window._bsDeletePanel = async function(panelId, title) {
  if (!confirm(`Delete ledger "${title}"? This cannot be undone.`)) return;
  const { error } = await supabase
    .from('business_panels')
    .delete()
    .eq('id', panelId);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Ledger deleted', 'success');
  window._bsNavigate('bs-panels');
};

// Bulk delete panels
window._bsBulkDeletePanels = async function() {
  const sel = _bsSelected('panels');
  if (sel.size === 0) return;
  if (!confirm(`Delete ${sel.size} ledger(s)? This cannot be undone.`)) return;
  const ids = [...sel];
  let ok = 0, fail = 0;
  for (const id of ids) {
    const { error } = await supabase.from('business_panels').delete().eq('id', id);
    if (error) fail++; else ok++;
  }
  window._bsSelectMode['panels'] = false;
  _bsClearSel('panels');
  if (fail > 0) toast(`${ok} deleted, ${fail} failed`, 'error');
  else toast(`${ok} ledger(s) deleted`, 'success');
  window._bsNavigate('bs-panels');
};

// Select all panels (card grid)
window._bsSelAllPanels = function(checked) {
  const ids = [...document.querySelectorAll('input[type="checkbox"][onchange*="panels"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'panels','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('panels', ids, checked);
  window._bsNavigate('bs-panels');
};

// Select all templates (card grid)
window._bsSelAllTemplates = function(checked) {
  const ids = [...document.querySelectorAll('input[type="checkbox"][onchange*="templates"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'templates','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('templates', ids, checked);
  window._bsNavigate('bs-templates');
};

// Select all investments (card grid)
window._bsSelAllInvestments = function(checked) {
  const ids = [...document.querySelectorAll('input[type="checkbox"][onchange*="investments"]')].map(cb => {
    const m = cb.getAttribute('onchange')?.match(/'investments','([^']+)'/);
    return m ? m[1] : null;
  }).filter(Boolean);
  _bsSelAll('investments', ids, checked);
  window._bsNavigate('bs-investments');
};

// Bulk delete templates
window._bsBulkDeleteTemplates = async function() {
  const sel = _bsSelected('templates');
  if (sel.size === 0) return;
  if (!confirm(`Delete ${sel.size} template(s)? This cannot be undone.`)) return;
  const ids = [...sel];
  let ok = 0, fail = 0;
  for (const id of ids) {
    const { error } = await supabase.from('templates').delete().eq('id', id);
    if (error) fail++; else ok++;
  }
  window._bsSelectMode['templates'] = false;
  _bsClearSel('templates');
  if (fail > 0) toast(`${ok} deleted, ${fail} failed`, 'error');
  else toast(`${ok} template(s) deleted`, 'success');
  window._bsNavigate('bs-templates');
};

window._bsDeleteTemplate = async function(templateId, name) {
  if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', templateId);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Template deleted', 'success');
  window._bsNavigate('bs-templates');
};

window._bsCreateTemplate = async function() {
  window._bsCreatingTemplate = true;
  // Ensure template module is loaded before calling
  if (!window.openNewTemplateModal) {
    try {
      await import('./templates-page.js');
    } catch(_) {}
  }
  if (window.openNewTemplateModal) {
    try { window.openNewTemplateModal(); }
    catch(e) { console.error('[_bsCreateTemplate]', e); toast('Error opening template builder: ' + e.message, 'error'); }
  } else {
    toast('Template builder not loaded — please refresh the page.', 'error');
  }
};

window._bsCreateRecurring = async function() {
  window._bsCreatingRecurring = true;
  if (!window.openNewRecurringModal) {
    try { await import('./recurring-page.js'); } catch(_) {}
  }
  if (window.openNewRecurringModal) {
    try { window.openNewRecurringModal(); }
    catch(e) { console.error('[_bsCreateRecurring]', e); toast('Error opening recurring form: ' + e.message, 'error'); }
  } else {
    toast('Recurring module not loaded — please refresh the page.', 'error');
  }
};

window._bsCreateInvestment = async function() {
  window._bsCreatingInvestment = true;
  // Set business context flags so the entry/investment knows it's from BS
  window._bsActiveContext = true;
  window._bsActiveBizId = _getBizDisplayId(_bsBusinessId());
  // Ensure investment module is loaded before calling
  if (!window.openNewInvestmentModal) {
    try {
      await import('./investments-page.js');
    } catch(_) {}
  }
  if (window.openNewInvestmentModal) {
    try { window.openNewInvestmentModal(); }
    catch(e) { console.error('[_bsCreateInvestment]', e); toast('Error opening investment form: ' + e.message, 'error'); }
  } else {
    toast('Investment module not loaded — please refresh the page.', 'error');
  }
};

// After panel save, check flag and track
const _origBpAfterSave = window._bpAfterSave;
window._bpAfterSave = function(panelId) {
  if (window._bsCreatingPanel && panelId) {
    _addBsItem('panels', panelId);
    window._bsCreatingPanel = false;
    // Navigate back to BS panels
    setTimeout(() => window._bsNavigate('bs-panels'), 100);
  }
  if (typeof _origBpAfterSave === 'function') _origBpAfterSave(panelId);
};

// After template save, check flag and track
const _origTmplAfterSave = window._tmplAfterSave;
window._tmplAfterSave = function(templateId) {
  if (window._bsCreatingTemplate && templateId) {
    _addBsItem('templates', templateId);
    window._bsCreatingTemplate = false;
    setTimeout(() => window._bsNavigate('bs-templates'), 100);
  }
  if (typeof _origTmplAfterSave === 'function') _origTmplAfterSave(templateId);
};

// After recurring rule save, check flag and track
const _origRecAfterSave = window._recAfterSave;
window._recAfterSave = function(ruleId) {
  if (window._bsCreatingRecurring && ruleId) {
    _addBsItem('recurring', ruleId);
    window._bsCreatingRecurring = false;
    setTimeout(() => window._bsNavigate('bs-recurring'), 100);
  }
  if (typeof _origRecAfterSave === 'function') _origRecAfterSave(ruleId);
};

// After investment save, check flag and track
const _origInvAfterSave = window._invAfterSave;
window._invAfterSave = function(investmentId) {
  if (window._bsCreatingInvestment && investmentId) {
    _addBsItem('investments', investmentId);
    window._bsCreatingInvestment = false;
    setTimeout(() => window._bsNavigate('bs-investments'), 100);
  }
  if (typeof _origInvAfterSave === 'function') _origInvAfterSave(investmentId);
};

// Copy/install a public template
window._bsCopyTemplate = async function(templateId) {
  const user = getCurrentUser();
  const bizUuid = _bsBusinessId();
  const newTmpl = await copyPublicTemplate(bizUuid, user.id, templateId);
  // Track the newly installed template in business context
  if (newTmpl?.id) _addBsItem('templates', newTmpl.id);
  toast('Template installed to your business library', 'success');
  window._bsTmplTab = 'mine';
  window._bsNavigate('bs-templates');
};

// Preview a public template's fields
window._bsPreviewTemplate = async function(templateId) {
  const { getTemplate } = await import('../templates.js');
  const t = await getTemplate(templateId);
  if (!t) { toast('Template not found', 'error'); return; }
  const fields = t.fields || [];
  openModal(`
    <div class="modal-title">${esc(t.name)} — Preview</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">${esc(t.tx_type ? _bsTxLabel(t.tx_type) : 'General')} · ${fields.length} field${fields.length!==1?'s':''}</div>
    ${t.description ? `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">${esc(t.description)}</p>` : ''}
    ${fields.length === 0 ? '<p style="color:var(--muted);">This template has no fields.</p>' : `
      <div style="max-height:300px;overflow-y:auto;">
        ${fields.map((f, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:11px;color:var(--muted);width:20px;text-align:right;">${i+1}.</span>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13px;">${esc(f.name || f.label || 'Unnamed')}</div>
              <div style="font-size:11px;color:var(--muted);">${esc(f.type || 'text')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Close</button>
      ${t.user_id !== getCurrentUser()?.id ? `<button class="btn btn-primary sm" onclick="closeModal();window._bsCopyTemplate('${templateId}')">+ Install</button>` : ''}
    </div>
  `, { maxWidth: '500px' });
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Investments
// ══════════════════════════════════════════════════════════════════
async function _bsRenderInvestments(el) {
  const user = getCurrentUser();
  const cur = getCurrentProfile()?.default_currency || 'USD';

  const { data: investments } = await supabase
    .from('investments')
    .select('id,name,description,currency,created_at,archived_at, members:investment_members(id), transactions:investment_transactions(id)')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  // All investments returned are already scoped to this business_id via RLS
  const inv = investments || [];
  const totalMembers = inv.reduce((s,i) => s + (i.members||[]).length, 0);
  const totalTx = inv.reduce((s,i) => s + (i.transactions||[]).length, 0);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Investments</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${inv.length} investment${inv.length!==1?'s':''} · ${totalMembers} member${totalMembers!==1?'s':''} · ${totalTx} transaction${totalTx!==1?'s':''}</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsCreateInvestment()">+ New Investment</button>
      </div>
    </div>

    ${inv.length > 0 ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;">
      <div class="card" style="padding:14px;border-left:3px solid var(--accent,#6366F1);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Pools</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${inv.length}</div>
      </div>
      <div class="card" style="padding:14px;border-left:3px solid var(--green,#7fe0d0);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Members</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${totalMembers}</div>
      </div>
      <div class="card" style="padding:14px;border-left:3px solid var(--gold,#d6b97a);">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Transactions</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${totalTx}</div>
      </div>
    </div>` : ''}

    ${inv.length > 0 ? `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">${_bsSelectBtn('investments')}</div>` : ''}

    ${inv.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:36px;margin-bottom:10px;">📈</div>
          <p style="font-weight:700;font-size:15px;margin-bottom:6px;">No investments yet</p>
          <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">Your business starts fresh. Create a new investment pool or manage existing ones here.</p>
          <button class="btn btn-primary btn-sm" onclick="window._bsCreateInvestment()">Create First Investment</button>
        </div>`
      : `
          ${_bsBulkBar('investments', _bsSelected('investments').size, [
            { label: 'Delete', onclick: 'window._bsBulkDeleteInvestments()' }
          ])}
          ${_bsInSelectMode('investments') ? `<div style="margin-bottom:10px;"><label style="cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;color:var(--muted);"><input type="checkbox" onchange="window._bsSelAllInvestments(this.checked)" style="cursor:pointer;accent-color:var(--accent);"> Select All</label></div>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${inv.map(i => {
            const memberCount = (i.members||[]).length;
            const txCount = (i.transactions||[]).length;
            return `<div class="card" style="padding:18px;cursor:pointer;transition:border-color .15s;${_bsInSelectMode('investments')?'position:relative;':''}" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor=''" onclick="if(window.openInvestmentDetail)window.openInvestmentDetail('${i.id}');">
              ${_bsInSelectMode('investments') ? `<label style="position:absolute;top:10px;right:10px;cursor:pointer;" onclick="event.stopPropagation();"><input type="checkbox" ${_bsSelected('investments').has(i.id)?'checked':''} onchange="window._bsToggle('investments','${i.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></label>` : ''}
              <div style="font-size:16px;font-weight:700;">${esc(i.name)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(i.type || 'Standard')}</div>
              <div style="display:flex;gap:8px;margin-top:8px;">
                <span class="badge badge-blue">${memberCount} member${memberCount!==1?'s':''}</span>
                <span class="badge badge-gray">${txCount} tx</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
                <div style="font-size:11px;color:var(--muted);">Created ${fmtRelative(i.created_at)}</div>
              </div>
            </div>`;
          }).join('')}
        </div>`
    }
  `;
}

window._bsDeleteInvestment = async function(invId, name) {
  if (!confirm(`Delete investment "${name}"? This cannot be undone.`)) return;
  const { error } = await supabase
    .from('investments')
    .delete()
    .eq('id', invId);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Investment deleted', 'success');
  window._bsNavigate('bs-investments');
};

// Bulk delete investments
window._bsBulkDeleteInvestments = async function() {
  const sel = _bsSelected('investments');
  if (sel.size === 0) return;
  if (!confirm(`Delete ${sel.size} investment(s)? This cannot be undone.`)) return;
  const ids = [...sel];
  let ok = 0, fail = 0;
  for (const id of ids) {
    const { error } = await supabase.from('investments').delete().eq('id', id);
    if (error) fail++; else ok++;
  }
  window._bsSelectMode['investments'] = false;
  _bsClearSel('investments');
  if (fail > 0) toast(`${ok} deleted, ${fail} failed`, 'error');
  else toast(`${ok} investment(s) deleted`, 'success');
  window._bsNavigate('bs-investments');
};

// Legacy _bsRenderPanelDB removed — Public DB is now a tab inside _bsRenderPanels

// Preview panel fields in a modal
window._bsPreviewPanel = async function(panelId) {
  const { data: panel } = await supabase
    .from('business_panels')
    .select('*')
    .eq('id', panelId)
    .single();
  if (!panel) { toast('Ledger not found', 'error'); return; }

  const fields = panel.fields || [];
  openModal(`
    <div class="modal-title">${esc(panel.title)} — Fields Preview</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">${esc(panel.session_type || 'Standard')} · ${esc(panel.currency || 'USD')} · ${fields.length} field${fields.length!==1?'s':''}</div>
    ${fields.length === 0 ? '<p style="color:var(--muted);">This ledger has no fields defined yet.</p>' : `
      <div style="max-height:300px;overflow-y:auto;">
        ${fields.map((f, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:11px;color:var(--muted);width:20px;text-align:right;">${i+1}.</span>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13px;">${esc(f.name || f.label || 'Unnamed')}</div>
              <div style="font-size:11px;color:var(--muted);">${esc(f.type || 'text')}${f.unitType ? ' · ' + esc(f.unitType + (f.unitValue ? ':'+f.unitValue : '')) : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Close</button>
      ${panel.user_id !== getCurrentUser()?.id ? `<button class="btn btn-primary btn-sm" onclick="closeModal();window._bsCopyPanel('${panelId}')">📋 Copy to My Ledgers</button>` : ''}
    </div>
  `, { maxWidth: '500px' });
};

window._bsCopyPanel = async function(panelId) {
  const user = getCurrentUser();
  const bizId = _bsBusinessId();
  if (!bizId) { toast('No business context — please refresh', 'error'); return; }

  const { data: source } = await supabase
    .from('business_panels')
    .select('*')
    .eq('id', panelId)
    .single();

  if (!source) { toast('Ledger not found', 'error'); return; }

  const { data, error } = await supabase
    .from('business_panels')
    .insert({
      business_id: bizId,
      user_id: user.id,
      title: source.title + ' (Copy)',
      currency: source.currency,
      session_type: source.session_type,
      fields: source.fields || []
    })
    .select()
    .single();

  if (error) { toast('Failed to copy: ' + error.message, 'error'); return; }
  toast('Ledger installed successfully', 'success');
  window._bsNavigate('bs-panels');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Branding — Invoice customization & business identity
// ══════════════════════════════════════════════════════════════════
function _bsRenderBranding(el) {
  // Read branding from the business context (businesses table), NOT user profile
  const ctx = window._bsContext || {};
  const p = {
    logo_url:         ctx.ownerLogo || '',
    company_name:     ctx.ownerName || '',
    company_email:    ctx.businessEmail || '',
    company_phone:    ctx.businessPhone || '',
    company_website:  ctx.businessWebsite || '',
    company_address:  ctx.businessAddress || '',
    default_currency: ctx.businessCurrency || 'USD',
    display_name:     ctx.ownerName || ''
  };
  const bizId = ctx.ownerBizId || 'BIZ-000000';

  el.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:20px;font-weight:800;margin:0;">Business Branding</h2>
      <p style="color:var(--muted);font-size:13px;margin-top:2px;">Customize how your business appears on invoices, bills, and shared documents</p>
    </div>

    <!-- Business Identity Card -->
    <div class="card" style="padding:20px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="width:64px;height:64px;border-radius:12px;border:2px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg3);flex-shrink:0;">
          ${p.logo_url
            ? `<img src="${esc(p.logo_url)}" style="width:100%;height:100%;object-fit:contain;">`
            : `<span style="font-size:28px;font-weight:800;color:var(--accent);">${(p.company_name||p.display_name||'B').charAt(0).toUpperCase()}</span>`}
        </div>
        <div style="flex:1;">
          <div style="font-size:18px;font-weight:700;">${esc(p.company_name || 'Your Business Name')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;font-family:monospace;">${bizId}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:var(--muted);">
        <div>Email: <span style="color:var(--text);font-weight:500;">${esc(p.company_email || '—')}</span></div>
        <div>Phone: <span style="color:var(--text);font-weight:500;">${esc(p.company_phone || '—')}</span></div>
        <div>Website: <span style="color:var(--text);font-weight:500;">${p.company_website ? `<a href="${esc(p.company_website)}" target="_blank" style="color:var(--accent);">${esc(p.company_website)}</a>` : '—'}</span></div>
        <div style="grid-column:span 2;">Address: <span style="color:var(--text);font-weight:500;">${esc(p.company_address || '—')}</span></div>
      </div>
    </div>

    <!-- Edit Branding Form -->
    <div class="card" style="padding:20px;margin-bottom:16px;">
      <h3 style="font-size:15px;font-weight:700;margin:0 0 14px;">Edit Business Info</h3>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
        <div id="bs-brand-logo-box" style="width:72px;height:72px;border-radius:10px;border:2px dashed var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg3);flex-shrink:0;">
          ${p.logo_url
            ? `<img id="bs-brand-logo-img" src="${esc(p.logo_url)}" style="width:100%;height:100%;object-fit:contain;">`
            : `<span style="font-size:12px;color:var(--muted);">Logo</span>`}
        </div>
        <div>
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;">
            Upload Logo
            <input type="file" accept="image/*" style="display:none;" onchange="window._bsUploadLogo(this)">
          </label>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">Max 5 MB · JPG, PNG, WebP, SVG</div>
          <div id="bs-brand-logo-status" style="font-size:11px;margin-top:2px;"></div>
        </div>
      </div>
      <input type="hidden" id="bs-brand-logo-url" value="${esc(p.logo_url || '')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label>Business Name</label><input type="text" id="bs-brand-name" value="${esc(p.company_name || '')}" placeholder="Your Company Ltd."></div>
        <div class="form-group"><label>Business Email</label><input type="email" id="bs-brand-email" value="${esc(p.company_email || '')}" placeholder="billing@company.com"></div>
        <div class="form-group"><label>Business Phone</label><input type="text" id="bs-brand-phone" value="${esc(p.company_phone || '')}" placeholder="+1 234 567 8900"></div>
        <div class="form-group"><label>Website</label><input type="url" id="bs-brand-website" value="${esc(p.company_website || '')}" placeholder="https://yourcompany.com"></div>
        <div class="form-group" style="grid-column:span 2;"><label>Business Address</label><input type="text" id="bs-brand-addr" value="${esc(p.company_address || '')}" placeholder="123 Main St, City"></div>
        <div class="form-group">
          <label>Default Currency</label>
          <select id="bs-brand-currency" style="width:100%;">
            ${BS_CURRENCIES.map(c => `<option value="${c}" ${(p.default_currency||'USD')===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsSaveBranding()">Save Branding</button>
      </div>
    </div>

    <!-- Invoice Preview — always white like a real printed invoice -->
    <div class="card" style="padding:20px;">
      <h3 style="font-size:15px;font-weight:700;margin:0 0 14px;">Invoice Preview</h3>
      <div style="background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e0e0e0;color:#1a1a1a;box-shadow:0 2px 8px rgba(0,0,0,.06);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
          <div>
            ${p.logo_url ? `<img src="${esc(p.logo_url)}" style="max-height:40px;max-width:100px;margin-bottom:6px;object-fit:contain;">` : ''}
            <div style="font-size:16px;font-weight:800;color:#1a1a1a;">${esc(p.company_name || 'Your Business')}</div>
            <div style="font-size:11px;color:#666;">${esc(p.company_address || 'Business Address')}</div>
            <div style="font-size:11px;color:#666;">${esc(p.company_email || 'email@business.com')} · ${esc(p.company_phone || 'Phone')}</div>
            ${p.company_website ? `<div style="font-size:11px;color:#4338ca;">${esc(p.company_website)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:800;color:#4338ca;">INVOICE</div>
            <div style="font-size:11px;color:#888;margin-top:4px;">#INV-0001</div>
            <div style="font-size:11px;color:#888;">Date: ${new Date().toLocaleDateString()}</div>
          </div>
        </div>
        <div style="border-top:2px solid #e5e7eb;padding-top:12px;margin-top:8px;">
          <div style="display:flex;padding:6px 0;font-size:12px;color:#888;border-bottom:1px solid #e5e7eb;">
            <span style="flex:2;font-weight:600;">Item</span><span style="width:40px;text-align:center;font-weight:600;">Qty</span><span style="width:80px;text-align:right;font-weight:600;">Price</span><span style="width:90px;text-align:right;font-weight:600;">Total</span>
          </div>
          ${(() => {
            // Try to find a real recent invoice with line items for preview
            const sampleItems = window._bsBrandPreviewItems || [
              { description: 'Your item or service', qty: 1, price: 100 },
              { description: 'Another line item', qty: 2, price: 75 }
            ];
            const cur = p.default_currency || 'USD';
            const fmt = (v) => new Intl.NumberFormat('en-US', { style:'currency', currency: cur, minimumFractionDigits:2 }).format(v);
            let total = 0;
            const rows = sampleItems.map(li => {
              const lineTotal = (li.qty || 1) * (li.price || 0);
              total += lineTotal;
              return `<div style="display:flex;padding:8px 0;font-size:13px;color:#1a1a1a;border-bottom:1px solid #e5e7eb;">
                <span style="flex:2;">${li.description || '—'}</span>
                <span style="width:40px;text-align:center;color:#888;">${li.qty || 1}</span>
                <span style="width:80px;text-align:right;">${fmt(li.price || 0)}</span>
                <span style="width:90px;text-align:right;font-weight:600;">${fmt(lineTotal)}</span>
              </div>`;
            }).join('');
            return rows + `<div style="display:flex;justify-content:flex-end;padding:12px 0;font-size:15px;font-weight:800;color:#1a1a1a;">Total: ${fmt(total)}</div>`;
          })()}
        </div>
        <div style="font-size:10px;color:#aaa;margin-top:8px;text-align:center;font-family:monospace;">${bizId} · Powered by Money IntX</div>
      </div>
    </div>
  `;
}

window._bsUploadLogo = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('bs-brand-logo-status');
  if (file.size > 5 * 1024 * 1024) { statusEl.textContent = 'File too large — max 5 MB'; statusEl.style.color = 'var(--red)'; return; }
  statusEl.textContent = 'Uploading…'; statusEl.style.color = 'var(--muted)';
  const uid = getCurrentUser().id;
  const ext = file.name.split('.').pop();
  const path = `${uid}/logo.${ext}`;
  const { error } = await supabase.storage.from('user-logos').upload(path, file, { upsert: true });
  if (error) { statusEl.textContent = 'Upload failed: ' + error.message; statusEl.style.color = 'var(--red)'; return; }
  const { data } = supabase.storage.from('user-logos').getPublicUrl(path);
  const url = data.publicUrl + '?t=' + Date.now();
  document.getElementById('bs-brand-logo-url').value = url;
  const box = document.getElementById('bs-brand-logo-box');
  if (box) box.innerHTML = `<img id="bs-brand-logo-img" src="${url}" style="width:100%;height:100%;object-fit:contain;">`;
  statusEl.textContent = 'Uploaded!'; statusEl.style.color = 'var(--green)';
};

window._bsSaveBranding = async function() {
  const bizId = window._bsContext?.businessId;
  if (!bizId) { toast('No active business', 'error'); return; }

  const logoUrl    = (document.getElementById('bs-brand-logo-url')?.value || '').trim();
  const name       = (document.getElementById('bs-brand-name')?.value || '').trim();
  const email      = (document.getElementById('bs-brand-email')?.value || '').trim();
  const phone      = (document.getElementById('bs-brand-phone')?.value || '').trim();
  const website    = (document.getElementById('bs-brand-website')?.value || '').trim();
  const address    = (document.getElementById('bs-brand-addr')?.value || '').trim();
  const currency   = (document.getElementById('bs-brand-currency')?.value || 'USD');

  // Save to the businesses table (the source of truth for BS branding)
  const { error } = await supabase.from('businesses').update({
    logo_url:         logoUrl,
    name:             name,
    email:            email,
    phone:            phone,
    website:          website,
    address:          address,
    default_currency: currency,
    updated_at:       new Date().toISOString()
  }).eq('id', bizId);
  if (error) { toast('Failed to save: ' + error.message, 'error'); return; }

  // Update in-memory BS context so re-render shows new values immediately
  if (window._bsContext) {
    window._bsContext.ownerName       = name || 'Business Suite';
    window._bsContext.ownerLogo       = logoUrl || null;
    window._bsContext.businessEmail   = email;
    window._bsContext.businessPhone   = phone;
    window._bsContext.businessWebsite = website;
    window._bsContext.businessAddress = address;
    window._bsContext.businessCurrency = currency;
  }

  toast('Branding saved', 'success');
  // Re-render to show updated preview
  _bsRenderBranding(document.getElementById('bs-content'));
  // Update sidebar header
  const hdr = document.querySelector('.bs-sidebar-header');
  if (hdr) {
    hdr.innerHTML = `
      <div style="font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--text);">${esc(name || 'Business Suite')}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${window._bsContext?.ownerBizId || 'BIZ-000000'}</div>
    `;
  }
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Operatives — Team roles & permissions
// ══════════════════════════════════════════════════════════════════

const BS_ROLES = [
  { id: 'owner',   label: 'Owner',   badge: 'badge-purple', desc: 'Full control — manage team, settings, all tools' },
  { id: 'admin',   label: 'Admin',   badge: 'badge-blue',   desc: 'Manage entries, clients, ledgers — cannot delete suite' },
  { id: 'manager', label: 'Manager', badge: 'badge-gray',   desc: 'Create entries, view clients, limited editing' },
  { id: 'viewer',  label: 'Viewer',  badge: 'badge-yellow', desc: 'Read-only access to all data' }
];

const BS_ROLE_PERMS = {
  owner:   { canManageTeam: true,  canManageTools: true,  canCreateEntries: true, canEditEntries: true, canDeleteEntries: true, canManagePanels: true, canViewAll: true, canExport: true },
  admin:   { canManageTeam: true,  canManageTools: false, canCreateEntries: true, canEditEntries: true, canDeleteEntries: true, canManagePanels: true, canViewAll: true, canExport: true },
  manager: { canManageTeam: false, canManageTools: false, canCreateEntries: true, canEditEntries: false,canDeleteEntries: false,canManagePanels: false,canViewAll: true, canExport: false },
  viewer:  { canManageTeam: false, canManageTools: false, canCreateEntries: false,canEditEntries: false,canDeleteEntries: false,canManagePanels: false,canViewAll: true, canExport: false }
};

// Cached members list — refreshed on each render
let _bsMembersCache = [];

async function _fetchBusinessMembers() {
  const bizId = _bsBusinessId();
  if (!bizId) return [];
  const currentUserId = getCurrentUser()?.id;
  // Fetch members first (no join — FK points to auth.users, not public.users)
  const { data, error } = await supabase
    .from('business_members')
    .select('id, user_id, role, permissions, created_at')
    .eq('business_id', bizId)
    .order('created_at');
  if (error) { console.error('[fetchMembers]', error.message); return []; }
  // Resolve user profiles in a separate query
  const userIds = (data || []).map(m => m.user_id).filter(Boolean);
  let userMap = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from('users').select('id, display_name, email').in('id', userIds);
    (profiles || []).forEach(p => { userMap[p.id] = p; });
  }
  _bsMembersCache = (data || []).map(m => {
    const profile = userMap[m.user_id] || {};
    return {
    id: m.id,
    user_id: m.user_id,
    name: profile.display_name || profile.email || 'Unknown',
    email: profile.email || '',
    role: m.role,
    permissions: m.permissions || {},
    status: 'active',
    added_at: m.created_at,
    is_self: m.user_id === currentUserId
  };});
  return _bsMembersCache;
}

async function _bsRenderOperatives(el) {
  const operatives = await _fetchBusinessMembers();
  const currentUserIsOwner = operatives.some(o => o.is_self && o.role === 'owner');
  const currentUserIsAdmin = operatives.some(o => o.is_self && (o.role === 'owner' || o.role === 'admin'));

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Team & Roles</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">Manage team members and their roles within your business</p>
      </div>
      ${(currentUserIsAdmin || window.bsCanDo('operatives_manage')) ? `<button class="btn btn-primary sm" onclick="window._bsAddOperative()">+ Add Member</button>` : ''}
    </div>

    <!-- Role legend -->
    <div class="card" style="padding:16px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px;">Role Permissions</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
        ${BS_ROLES.map(r => `
          <div style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);">
            <span class="badge ${r.badge}" style="font-size:11px;">${r.label}</span>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">${r.desc}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Operatives list -->
    <div class="card" style="padding:0;overflow:hidden;">
      ${operatives.length === 0 ? `
        <div style="padding:40px;text-align:center;color:var(--muted);">No operatives yet</div>
      ` : operatives.map(op => {
        // Resolve display role: check permissions._ui_role first, then map legacy 'operative' → 'manager'
        const displayRole = op.permissions?._ui_role || (op.role === 'operative' ? 'manager' : op.role);
        const role = BS_ROLES.find(r => r.id === displayRole) || BS_ROLES[3];
        const perms = BS_ROLE_PERMS[displayRole] || BS_ROLE_PERMS.viewer;
        return `
          <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);">
            <div style="width:38px;height:38px;border-radius:50%;background:${op.is_self ? 'var(--accent,#6366F1)' : 'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#fff;flex-shrink:0;border:2px solid var(--border);">
              ${esc((op.name||'?').charAt(0).toUpperCase())}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:14px;">${esc(op.name)} ${op.is_self ? '<span style="font-size:11px;color:var(--muted);">(You)</span>' : ''}</div>
              <div style="font-size:12px;color:var(--muted);">${esc(op.email || 'No email')}</div>
            </div>
            <span class="badge ${role.badge}" style="font-size:11px;">${role.label}</span>
            <span class="badge ${op.status === 'active' ? 'badge-blue' : op.status === 'invited' ? 'badge-yellow' : 'badge-gray'}" style="font-size:10px;">${op.status === 'active' ? 'Active' : op.status === 'invited' ? 'Invited' : op.status || 'Active'}</span>
            ${currentUserIsAdmin && !op.is_self ? `
              <div style="display:flex;gap:4px;">
                <button class="bs sm" onclick="window._bsEditOperative('${op.id}')" title="Edit role">✏️</button>
                <button class="bs sm" onclick="window._bsRemoveOperative('${op.id}')" title="Remove" style="color:var(--red,#e57373);">✕</button>
              </div>
            ` : ''}
            ${op.is_self && op.role !== 'owner' ? `
              <button class="bs sm" onclick="window._bsLeaveBusiness('${op.id}')" title="Leave this business" style="color:var(--red,#d07878);font-size:12px;">Leave</button>
            ` : ''}
          </div>`;
      }).join('')}
    </div>

    <!-- Permissions matrix -->
    <div class="card" style="padding:16px;margin-top:16px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px;">Permissions Matrix</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="text-align:left;padding:8px 10px;color:var(--muted);font-weight:600;">Permission</th>
              ${BS_ROLES.map(r => `<th style="text-align:center;padding:8px 6px;font-weight:600;">${r.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${Object.keys(BS_ROLE_PERMS.owner).map(perm => {
              const label = perm.replace(/^can/, '').replace(/([A-Z])/g, ' $1').trim();
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:8px 10px;color:var(--text);font-weight:500;">${label}</td>
                ${BS_ROLES.map(r => {
                  const has = BS_ROLE_PERMS[r.id]?.[perm];
                  return `<td style="text-align:center;padding:8px 6px;">${has ? '<span style="color:var(--green,#5fd39a);">✓</span>' : '<span style="color:var(--muted);">—</span>'}</td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

window._bsAddOperative = function() {
  openModal(`
    <div class="modal-title">Add Operative</div>
    <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">Search your contacts or enter an exact email to invite a team member. They must already have an account on the platform.</p>
    <div class="form-group">
      <label>Search Member *</label>
      <input type="text" id="bs-op-search" placeholder="Search contacts or enter email…" autocomplete="off" style="width:100%;"
        oninput="window._bsSearchMembers(this.value)">
      <div id="bs-op-search-results" style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:4px;display:none;"></div>
      <input type="hidden" id="bs-op-user-id" value="">
      <input type="hidden" id="bs-op-name" value="">
      <input type="hidden" id="bs-op-email" value="">
      <div id="bs-op-selected" style="display:none;margin-top:8px;padding:10px 12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div id="bs-op-sel-avatar" style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;"></div>
          <div>
            <div id="bs-op-sel-name" style="font-weight:600;font-size:13px;"></div>
            <div id="bs-op-sel-email" style="font-size:11px;color:var(--muted);"></div>
          </div>
          <button class="bs sm" onclick="window._bsClearOpSelection()" style="margin-left:auto;font-size:11px;color:var(--red);">✕</button>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Role *</label>
      <select id="bs-op-role" style="width:100%;">
        ${BS_ROLES.filter(r => r.id !== 'owner').map(r => `<option value="${r.id}">${r.label} — ${r.desc}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary sm" onclick="window._bsSaveNewOperative()">Invite Operative</button>
    </div>
  `, { maxWidth: '480px' });
};

window._bsSearchMembers = async function(query) {
  const resultsEl = document.getElementById('bs-op-search-results');
  if (!resultsEl) return;
  if (!query || query.length < 3) { resultsEl.style.display = 'none'; return; }

  // Only search among the owner's own contacts who have linked_user_id (platform users)
  // This prevents exposing all platform users to any business owner
  const bizOwnerId = window._bsContext?.ownerId || getCurrentUser().id;
  const { data: contactUsers } = await supabase
    .from('contacts')
    .select('linked_user_id')
    .eq('user_id', bizOwnerId)
    .not('linked_user_id', 'is', null);
  const linkedIds = (contactUsers || []).map(c => c.linked_user_id).filter(Boolean);

  // Also search by exact email match (for inviting users not yet in contacts)
  const isEmail = query.includes('@');
  let users = [];
  if (linkedIds.length > 0) {
    const { data } = await supabase
      .from('users')
      .select('id, display_name, email, avatar_url')
      .in('id', linkedIds)
      .or(`display_name.ilike.%${query}%,email.ilike.%${query}%`)
      .neq('id', getCurrentUser().id)
      .limit(10);
    users = data || [];
  }
  // If searching by email and no match found in contacts, allow exact email lookup
  if (isEmail && users.length === 0) {
    const { data } = await supabase
      .from('users')
      .select('id, display_name, email, avatar_url')
      .ilike('email', query.trim())
      .neq('id', getCurrentUser().id)
      .limit(5);
    users = data || [];
  }

  const existingIds = new Set(_bsMembersCache.filter(o => o.user_id).map(o => o.user_id));

  if (users.length === 0) {
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">No match found. Try entering their full email address, or add them as a contact first.</div>';
    resultsEl.style.display = 'block';
    return;
  }

  resultsEl.innerHTML = users.map(u => {
    const already = existingIds.has(u.id);
    return `<div onclick="${already ? '' : `window._bsSelectOpMember('${u.id}','${esc(u.display_name||'')}','${esc(u.email||'')}')`}"
      style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:${already?'default':'pointer'};border-bottom:1px solid var(--border);opacity:${already?'0.5':'1'};"
      ${already ? '' : 'onmouseenter="this.style.background=\'var(--bg3)\'" onmouseleave="this.style.background=\'\'"'}>
      <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;">
        ${(u.display_name||u.email||'?').charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${esc(u.display_name || 'Unnamed')}</div>
        <div style="font-size:11px;color:var(--muted);">${esc(u.email || '')}</div>
      </div>
      ${already ? '<span class="badge badge-gray" style="font-size:10px;">Already added</span>' : ''}
    </div>`;
  }).join('');
  resultsEl.style.display = 'block';
};

window._bsSelectOpMember = function(userId, name, email) {
  document.getElementById('bs-op-user-id').value = userId;
  document.getElementById('bs-op-name').value = name;
  document.getElementById('bs-op-email').value = email;
  document.getElementById('bs-op-search-results').style.display = 'none';
  document.getElementById('bs-op-search').style.display = 'none';

  const sel = document.getElementById('bs-op-selected');
  sel.style.display = 'block';
  document.getElementById('bs-op-sel-avatar').textContent = (name||email||'?').charAt(0).toUpperCase();
  document.getElementById('bs-op-sel-name').textContent = name || 'Unnamed';
  document.getElementById('bs-op-sel-email').textContent = email || '';
};

window._bsClearOpSelection = function() {
  document.getElementById('bs-op-user-id').value = '';
  document.getElementById('bs-op-name').value = '';
  document.getElementById('bs-op-email').value = '';
  document.getElementById('bs-op-selected').style.display = 'none';
  const searchEl = document.getElementById('bs-op-search');
  searchEl.style.display = '';
  searchEl.value = '';
  searchEl.focus();
};

window._bsSaveNewOperative = async function() {
  const userId = (document.getElementById('bs-op-user-id')?.value || '').trim();
  const name = (document.getElementById('bs-op-name')?.value || '').trim();
  const email = (document.getElementById('bs-op-email')?.value || '').trim();
  const role = document.getElementById('bs-op-role')?.value || 'viewer';
  if (!userId || !name) { toast('Please search and select a member first', 'error'); return; }

  const bizId = _bsBusinessId();
  // Map UI role to permission set
  const perms = role === 'admin' ? FULL_OWNER_PERMISSIONS
    : role === 'manager' ? { ...DEFAULT_OPERATIVE_PERMISSIONS, invoices_create: true, bills_create: true, clients_write: true }
    : { ...DEFAULT_OPERATIVE_PERMISSIONS };

  const { error } = await supabase
    .from('business_members')
    .upsert({
      business_id: bizId,
      user_id: userId,
      role: role === 'owner' ? 'operative' : (role === 'admin' ? 'admin' : 'operative'),
      permissions: perms,
      invited_by: getCurrentUser()?.id
    }, { onConflict: 'business_id,user_id' });

  if (error) { toast('Failed to add operative: ' + error.message, 'error'); return; }
  closeModal();

  // Send invitation email
  const profile = getCurrentProfile();
  const bizName = profile?.company_name || profile?.display_name || 'A business';
  const roleLabel = BS_ROLES.find(r => r.id === role)?.label || role;
  try {
    await fetch('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: `${bizName} has invited you as a Business ${roleLabel}`,
        type: 'notification',
        data: {
          heading: `You've been invited!`,
          body: `${bizName} has invited you to join their business as a <strong>${roleLabel}</strong> on Money IntX. Log in to your account to view and manage business operations.`,
          cta_text: 'Go to Money IntX',
          cta_url: 'https://moneyinteractions.com'
        }
      })
    });
  } catch(_) { /* email send is best-effort */ }

  toast(`${name} invited as ${roleLabel}`, 'success');
  _bsRenderOperatives(document.getElementById('bs-content'));
};

window._bsEditOperative = function(opId) {
  const ops = _bsMembersCache;
  const op = ops.find(o => o.id === opId);
  if (!op) return;
  // Resolve actual UI role from permissions._ui_role or legacy mapping
  const effectiveRole = op.permissions?._ui_role || (op.role === 'operative' ? 'manager' : op.role);
  const currentRole = BS_ROLES.find(r => r.id === effectiveRole) || BS_ROLES[3];

  openModal(`
    <div class="modal-title">Edit Operative Role</div>
    <div style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);margin-bottom:16px;">
      <div style="width:38px;height:38px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#fff;flex-shrink:0;">
        ${esc((op.name||'?').charAt(0).toUpperCase())}
      </div>
      <div>
        <div style="font-weight:700;font-size:14px;">${esc(op.name)}</div>
        <div style="font-size:12px;color:var(--muted);">${esc(op.email || 'No email')}</div>
      </div>
      <span class="badge ${currentRole.badge}" style="margin-left:auto;">${currentRole.label}</span>
    </div>
    <div class="form-group">
      <label>Change Role</label>
      <select id="bs-op-role" style="width:100%;">
        ${BS_ROLES.filter(r => r.id !== 'owner').map(r => `<option value="${r.id}" ${r.id===effectiveRole?'selected':''}>${r.label} — ${r.desc}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary sm" onclick="window._bsSaveEditOperative('${opId}')">Update Role</button>
    </div>
  `, { maxWidth: '440px' });
};

window._bsSaveEditOperative = async function(opId) {
  const uiRole = document.getElementById('bs-op-role')?.value || 'viewer';
  const perms = uiRole === 'admin' ? FULL_OWNER_PERMISSIONS
    : uiRole === 'manager' ? { ...DEFAULT_OPERATIVE_PERMISSIONS, invoices_create: true, bills_create: true, clients_write: true }
    : { ...DEFAULT_OPERATIVE_PERMISSIONS };
  // DB constraint only allows owner|admin|operative — store UI role in permissions.ui_role
  const dbRole = uiRole === 'admin' ? 'admin' : 'operative';
  perms._ui_role = uiRole; // persist manager vs viewer distinction

  const { error } = await supabase
    .from('business_members')
    .update({
      role: dbRole,
      permissions: perms,
      updated_at: new Date().toISOString()
    })
    .eq('id', opId);

  if (error) { toast('Failed to update role: ' + error.message, 'error'); return; }
  closeModal();
  toast('Role updated to ' + (BS_ROLES.find(r=>r.id===uiRole)?.label || uiRole), 'success');
  _bsMembersCache = []; // clear cache to force fresh fetch
  _bsRenderOperatives(document.getElementById('bs-content'));
};

window._bsRemoveOperative = async function(opId) {
  if (!confirm('Remove this operative?')) return;
  const { error } = await supabase
    .from('business_members')
    .delete()
    .eq('id', opId);
  if (error) { toast('Failed to remove: ' + error.message, 'error'); return; }
  toast('Operative removed', 'success');
  _bsRenderOperatives(document.getElementById('bs-content'));
};

window._bsLeaveBusiness = async function(membershipId) {
  if (!confirm('Leave this business? You will lose access to all shared data. This cannot be undone.')) return;
  const { error } = await supabase
    .from('business_members')
    .delete()
    .eq('id', membershipId);
  if (error) { toast('Failed to leave: ' + error.message, 'error'); return; }
  toast('You have left this business', 'success');
  // Clear BS context and return to dashboard
  clearBsContext();
  if (window.navTo) window.navTo('dashboard');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Suite Settings / Tool Selection
// ══════════════════════════════════════════════════════════════════
function _bsRenderSettings(el) {
  const tools = _getBsTools();
  const profile = getCurrentProfile() || {};
  const bizId = window._bsContext?.ownerBizId || 'BIZ-000000';

  el.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-size:20px;font-weight:800;margin:0;">Suite Settings</h2>
      <p style="color:var(--muted);font-size:13px;margin-top:2px;">Configure your Business Suite preferences</p>
    </div>

    <!-- Business Info Summary -->
    <div class="card" style="padding:18px;margin-bottom:16px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px;">Business Information</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
        <div>
          <span style="color:var(--muted);">Business Name:</span>
          <span style="font-weight:600;margin-left:4px;">${esc(profile.company_name || '—')}</span>
        </div>
        <div>
          <span style="color:var(--muted);">Business ID:</span>
          <span style="font-weight:600;font-family:monospace;margin-left:4px;">${bizId}</span>
        </div>
        <div>
          <span style="color:var(--muted);">Email:</span>
          <span style="font-weight:600;margin-left:4px;">${esc(profile.company_email || '—')}</span>
        </div>
        <div>
          <span style="color:var(--muted);">Currency:</span>
          <span style="font-weight:600;margin-left:4px;">${esc(profile.default_currency || 'USD')}</span>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-branding')" style="margin-top:12px;">Edit Branding</button>
    </div>

    <!-- Sidebar Tools -->
    <div class="card" style="padding:18px;margin-bottom:16px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:4px;">Sidebar Tools</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">Choose which tools appear in your Business Suite sidebar. Changes apply after refreshing.</p>
      ${BS_TOOLS.map(t => {
        const checked = tools[t.id] !== false;
        const disabled = t.always ? 'disabled' : '';
        return `<label style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:${t.always?'default':'pointer'};">
          <input type="checkbox" ${checked?'checked':''} ${disabled}
            onchange="window._bsToggleTool('${t.id}',this.checked)"
            style="width:18px;height:18px;accent-color:var(--accent,#6366F1);">
          <span style="font-size:18px;">${t.icon}</span>
          <div style="flex:1;">
            <span style="font-weight:600;font-size:14px;">${t.label}</span>
          </div>
          ${t.always ? '<span class="badge badge-gray" style="font-size:10px;">Always on</span>' : ''}
        </label>`;
      }).join('')}
    </div>

    <!-- Data & Privacy -->
    <div class="card" style="padding:18px;margin-bottom:16px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px;">Data & Privacy</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
          <div>
            <div style="font-weight:600;font-size:13px;">Export Business Data</div>
            <div style="font-size:11px;color:var(--muted);">Download all invoices, bills, and contacts as CSV</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="window._bsExportData()">Export</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
          <div>
            <div style="font-weight:600;font-size:13px;">Operatives</div>
            <div style="font-size:11px;color:var(--muted);">Manage team access and roles</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-operatives')">Manage</button>
        </div>
      </div>
    </div>

    <!-- Danger Zone -->
    <div class="card" style="padding:18px;margin-bottom:16px;border:1px solid var(--red,#d07878);">
      <div style="font-size:14px;font-weight:700;margin-bottom:4px;color:var(--red,#d07878);">Danger Zone</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">These actions are irreversible. Proceed with caution.</p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(208,120,120,.06);border-radius:8px;border:1px solid rgba(208,120,120,.2);">
          <div>
            <div style="font-weight:600;font-size:13px;">Clear Business Tracker</div>
            <div style="font-size:11px;color:var(--muted);">Remove all business ledger/template/recurring/investment associations (data remains, just unlinked from BS)</div>
          </div>
          <button class="btn btn-sm" style="background:var(--red,#d07878);color:#fff;border:none;" onclick="window._bsClearTracker()">Clear</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(208,120,120,.06);border-radius:8px;border:1px solid rgba(208,120,120,.2);">
          <div>
            <div style="font-weight:600;font-size:13px;">Reset Operatives</div>
            <div style="font-size:11px;color:var(--muted);">Remove all team members except yourself (Owner)</div>
          </div>
          <button class="btn btn-sm" style="background:var(--red,#d07878);color:#fff;border:none;" onclick="window._bsResetOperatives()">Reset</button>
        </div>
      </div>
    </div>

    <!-- Exit to Personal -->
    <div class="card" style="padding:18px;margin-bottom:16px;text-align:center;">
      <button class="btn btn-primary" onclick="window._bsNavigate('bs-back')" style="width:100%;padding:14px;font-size:15px;font-weight:700;">
        ← Exit to Personal Dashboard
      </button>
      <p style="font-size:11px;color:var(--muted);margin-top:8px;">Leave Business Suite and return to your personal dashboard</p>
    </div>

    <!-- Legal Notice -->
    <div style="padding:14px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);font-size:11px;color:var(--muted);line-height:1.5;">
      <strong>Legal Disclaimer:</strong> Money IntX is a financial tracking and information system. It does not hold, transfer, or process money. It is not a bank, payment processor, escrow service, or estate planning tool. All financial data is user-defined and for recordkeeping purposes only.
    </div>
  `;
}

// Export business data as CSV
window._bsExportData = async function() {
  const user = getCurrentUser();
  const bizUuid = _bsBusinessId();
  toast('Preparing export…', 'info');
  const { data: entries } = await supabase
    .from('entries')
    .select('*')
    .eq('business_id', bizUuid)
    .eq('context_type', 'business')
    .in('tx_type', BS_ALL_BIZ_TYPES)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (!entries || entries.length === 0) { toast('No business data to export', 'info'); return; }
  const headers = ['Date','Type','Contact','Amount','Currency','Status','Invoice #','Due Date'];
  const rows = entries.map(e => [
    (e.created_at||'').slice(0,10),
    _bsTxLabel(e.tx_type),
    e.contact_name || '',
    e.amount || 0,
    e.currency || 'USD',
    e.status || 'draft',
    e.invoice_number || e.metadata?.inv_number || e.metadata?.ref_number || '',
    e.metadata?.due_date || ''
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `business-export-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Export downloaded', 'success');
};

window._bsClearTracker = function() {
  if (!confirm('Clear all business ledger, template, recurring, and investment associations? Your data remains — items are just unlinked from the Business Suite.')) return;
  _saveBsItems({ templates: [], panels: [], recurring: [], investments: [] });
  toast('Business tracker cleared', 'success');
  window._bsNavigate('bs-settings');
};

window._bsResetOperatives = async function() {
  if (!confirm('Remove all operatives except yourself? This cannot be undone.')) return;
  const bizId = _bsBusinessId();
  const currentUserId = getCurrentUser()?.id;
  // Delete all members except the current user
  const { error } = await supabase
    .from('business_members')
    .delete()
    .eq('business_id', bizId)
    .neq('user_id', currentUserId);
  if (error) { toast('Failed to reset: ' + error.message, 'error'); return; }
  toast('Operatives reset — only you remain', 'success');
  window._bsNavigate('bs-settings');
};

window._bsToggleTool = function(id, enabled) {
  const tools = _getBsTools();
  tools[id] = enabled;
  _setBsTools(tools);
  const label = BS_TOOLS.find(t => t.id === id)?.label || id;
  toast(`${label} ${enabled ? 'enabled' : 'disabled'} — will update on next visit`, 'info');
};

// ══════════════════════════════════════════════════════════════════
// CSS — Business Suite Layout
// ══════════════════════════════════════════════════════════════════
const BS_CSS = `
/* Business Suite Shell */
.bs-shell {
  display: flex;
  min-height: 100vh;
  background: var(--bg);
}

/* Sidebar */
.bs-sidebar {
  width: 230px;
  min-width: 230px;
  background: var(--bg2, #0a1528);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

.bs-sidebar-header {
  padding: 20px 18px 14px;
  border-bottom: 1px solid var(--border);
}

.bs-sidebar-nav {
  flex: 1;
  padding: 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* bs-sidebar-footer removed — "Back to Personal" is now inside bs-sidebar-nav */

.bs-nav-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background .15s, color .15s;
}
.bs-nav-btn:hover {
  background: rgba(255,255,255,.04);
  color: var(--text);
}
.bs-nav-btn.bs-nav-active {
  background: rgba(99,102,241,.12);
  color: var(--text);
  font-weight: 700;
}
.bs-nav-icon {
  font-size: 16px;
  width: 22px;
  text-align: center;
  flex-shrink: 0;
}
.bs-nav-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Main content area */
.bs-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

/* Mobile header (hidden on desktop) */
.bs-mobile-header {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}
.bs-hamburger {
  background: none;
  border: none;
  color: var(--text);
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
}

/* Mobile bottom navigation — hidden on desktop, shown via media query */
.bs-mobile-bottom-nav {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 64px;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  justify-content: space-around;
  align-items: center;
  z-index: 1000;
}
.bs-mobile-nav-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: none;
  border: none;
  color: var(--muted);
  font-size: 22px;
  cursor: pointer;
  transition: color .15s;
}
.bs-mobile-nav-btn:hover {
  color: var(--text);
}
.bs-mobile-nav-plus {
  font-size: 28px;
  font-weight: 700;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .bs-sidebar {
    position: fixed;
    left: -260px;
    top: 0;
    bottom: 0;
    z-index: 9000;
    transition: left .25s ease;
    height: 100vh;
  }
  .bs-sidebar.bs-sidebar-open {
    left: 0;
    box-shadow: 4px 0 24px rgba(0,0,0,.5);
  }
  .bs-mobile-header {
    display: flex;
  }
  .bs-mobile-bottom-nav {
    display: flex !important;
  }
  #bs-content {
    padding: 16px !important;
    padding-bottom: 80px !important;
  }
}
`;

// renderBusinessSuite is already exported at function definition
