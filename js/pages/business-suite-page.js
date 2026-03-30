// ────────────────────────────────────────────────────────────────────────────
// Business Suite Page — Self-contained business environment
// ────────────────────────────────────────────────────────────────────────────
// Left-side menu with business-branded tools:
//   Dashboard, Invoices, Clients, Suppliers, Business Panels, Templates,
//   Recurring, Investments, Panel Public DB, Settings/Tools
// ────────────────────────────────────────────────────────────────────────────

import { getCurrentUser, getCurrentProfile, contactColor, contactAvatar, renderPagination, PAGE_SIZE, _fmtAmt } from './state.js';
import { esc, toast, openModal, closeModal, fmtDate, fmtRelative, statusBadge, TX_LABELS, TX_COLORS } from '../ui.js';
import { supabase } from '../supabase.js';
import { listContacts } from '../contacts.js';
import { fmtMoney } from '../entries.js';
import { listTemplates } from '../templates.js';
import { listRecurring, FREQUENCIES } from '../recurring.js';
import { listPanels } from '../business-panels.js';

// ── State ─────────────────────────────────────────────────────────
let _bsSection = 'bs-dash';       // current active section
let _bsContacts = [];              // cached contacts
let _bsEntries = [];               // cached business entries
let _bsEl = null;                  // content element ref

// ── Business ID ──────────────────────────────────────────────────
function _getBizId() {
  const uid = getCurrentUser()?.id;
  if (!uid) return 'BIZ-000000';
  const key = 'mxi_business_id_' + uid;
  let id = localStorage.getItem(key);
  if (id) return id;
  // Generate a stable Business ID from user UUID
  const hash = uid.replace(/-/g,'').slice(0,8).toUpperCase();
  id = 'BIZ-' + hash;
  localStorage.setItem(key, id);
  return id;
}

// ── Business Suite Tool Registry ──────────────────────────────────
const BS_TOOLS = [
  { id: 'bs-dash',       icon: '📊', label: 'Overview',         always: true },
  { id: 'bs-invoices',   icon: '🧾', label: 'Invoices',         always: true },
  { id: 'bs-bills',      icon: '📄', label: 'Bills',            always: true },
  { id: 'bs-clients',    icon: '👥', label: 'Clients',          always: true },
  { id: 'bs-suppliers',  icon: '🏪', label: 'Suppliers',        always: true },
  { id: 'bs-recurring',  icon: '🔁', label: 'Recurring',        always: true },
  { id: 'bs-panels',     icon: '📋', label: 'Business Panels',  always: true },
  { id: 'bs-templates',  icon: '📑', label: 'Templates',        always: true },
  { id: 'bs-investments',icon: '📈', label: 'Investments',      always: true },
  { id: 'bs-panel-db',   icon: '🌐', label: 'Panel Public DB',  always: true },
  { id: 'bs-branding',   icon: '🏷️', label: 'Branding',          always: true },
  { id: 'bs-operatives', icon: '🔑', label: 'Operatives',       always: true },
  { id: 'bs-settings',   icon: '⚙️', label: 'Suite Settings',   always: true },
];

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

// ── Main Render ───────────────────────────────────────────────────
export async function renderBusinessSuite(el) {
  _bsEl = el;
  const currentUser = getCurrentUser();
  if (!currentUser) { el.innerHTML = '<p style="color:var(--muted);padding:20px;">Please log in.</p>'; return; }

  // Expand content area for suite layout (remove max-width constraint)
  const contentEl = document.getElementById('content');
  if (contentEl) { contentEl.style.maxWidth = 'none'; contentEl.style.margin = '0'; }
  const mainEl = document.getElementById('main');
  if (mainEl) { mainEl.style.padding = '0'; }

  // Restore last section
  try { _bsSection = localStorage.getItem('mxi_bs_section') || 'bs-dash'; } catch(_) {}

  const enabledTools = _getBsTools();

  // Build sidebar
  const sidebarHtml = BS_TOOLS
    .filter(t => enabledTools[t.id] !== false)
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
        <div class="bs-sidebar-header">
          <div style="font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--text);">${esc(getCurrentProfile()?.company_name || 'Business Suite')}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${_getBizId()}</div>
        </div>
        <div class="bs-sidebar-nav" id="bs-sidebar-nav">
          ${sidebarHtml}
        </div>
        <div class="bs-sidebar-footer">
          <button class="bs-nav-btn" onclick="window._bsNavigate('bs-back')" style="color:var(--muted);">
            <span class="bs-nav-icon">←</span>
            <span class="bs-nav-label">Back to Personal</span>
          </button>
        </div>
      </div>
      <div class="bs-main" id="bs-main">
        <div class="bs-mobile-header" id="bs-mobile-header">
          <button class="bs-hamburger" onclick="document.getElementById('bs-sidebar').classList.toggle('bs-sidebar-open')">☰</button>
          <span style="font-weight:700;font-size:15px;">Business Suite</span>
        </div>
        <div id="bs-content" style="padding:20px 24px;max-width:1100px;">
          <p style="color:var(--muted);">Loading…</p>
        </div>
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
window._bsNavigate = function(section) {
  if (section === 'bs-back') {
    // Close sidebar on mobile
    document.getElementById('bs-sidebar')?.classList.remove('bs-sidebar-open');
    if (window.app?.navigate) window.app.navigate('dash');
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
    case 'bs-panel-db':    await _bsRenderPanelDB(el); break;
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

  // Fetch business entries (invoices, bills)
  const { data: entries } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', user.id)
    .in('tx_type', ['invoice_sent','bill_sent'])
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  const biz = entries || [];
  const invoicesSent = biz.filter(e => e.tx_type === 'invoice_sent');
  const billsSent = biz.filter(e => e.tx_type === 'bill_sent');
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

  el.innerHTML = `
    <!-- Business header with branding -->
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap;">
      ${profile?.logo_url ? `<img src="${esc(profile.logo_url)}" style="max-height:48px;max-width:120px;border-radius:8px;object-fit:contain;">` : ''}
      <div style="flex:1;min-width:0;">
        <h2 style="font-size:22px;font-weight:800;margin:0;">${esc(profile?.company_name || 'Business Overview')}</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">Welcome back, ${esc(userName)} · <span style="font-family:monospace;font-size:12px;">${_getBizId()}</span></p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-branding')" style="white-space:nowrap;">Edit Branding</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
      <div class="card" style="padding:18px;border-left:3px solid var(--green,#7fe0d0);">
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Receivables</div>
        <div style="font-size:24px;font-weight:800;margin-top:4px;color:var(--green,#7fe0d0);">${fmtMoney(totalOutstanding, cur)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${invoicesSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length} unpaid invoice${invoicesSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length!==1?'s':''}</div>
      </div>
      <div class="card" style="padding:18px;border-left:3px solid var(--blue,#8fa8d6);">
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

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:28px;">
      <button class="btn btn-primary" onclick="window._bsQuickAction('invoice')" style="padding:12px;font-size:13px;font-weight:700;border-radius:10px;">+ New Invoice</button>
      <button class="btn btn-secondary" onclick="window._bsQuickAction('bill')" style="padding:12px;font-size:13px;font-weight:700;border-radius:10px;">+ New Bill</button>
      <button class="btn btn-secondary" onclick="window._bsNavigate('bs-clients')" style="padding:12px;font-size:13px;font-weight:700;border-radius:10px;">Clients</button>
      <button class="btn btn-secondary" onclick="window._bsNavigate('bs-panels')" style="padding:12px;font-size:13px;font-weight:700;border-radius:10px;">Panels</button>
    </div>

    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Recent Business Activity</h3>
    ${biz.length === 0
      ? '<div class="card" style="text-align:center;padding:32px;"><p style="color:var(--muted);">No business entries yet. Create your first invoice or bill to get started.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Contact</th><th>Amount</th><th>Status</th></tr></thead><tbody>
          ${biz.slice(0,15).map(e => `<tr>
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td><span style="color:${TX_COLORS[e.tx_type]||'var(--text)'};font-weight:600;font-size:13px;">${esc(_bsTxLabel(e.tx_type))}</span></td>
            <td style="font-weight:600;font-size:13px;">${esc(e.contact_name || '—')}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td>${statusBadge(e.status || 'draft')}</td>
          </tr>`).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// Business-branded TX labels
function _bsTxLabel(type) {
  const map = {
    invoice_sent: 'Invoice',
    bill_sent: 'Bill',
    owed_to_me: 'Receivable',
    i_owe: 'Payable',
    advance_paid: 'Advance Out',
    advance_received: 'Advance In',
    payment_recorded: 'Payment'
  };
  return map[type] || TX_LABELS[type] || type;
}

// Quick action — opens new entry modal with business presets
window._bsQuickAction = function(type) {
  if (type === 'invoice') {
    if (window.openNewEntryModal) window.openNewEntryModal('invoice');
  } else if (type === 'bill') {
    if (window.openNewEntryModal) window.openNewEntryModal('bill');
  }
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Invoices
// ══════════════════════════════════════════════════════════════════
async function _bsRenderInvoices(el) {
  const user = getCurrentUser();
  const cur = getCurrentProfile()?.default_currency || 'USD';

  const { data } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', user.id)
    .eq('tx_type', 'invoice_sent')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const inv = data || [];
  const unpaid = inv.filter(e => e.status !== 'settled' && e.status !== 'voided');
  const overdue = unpaid.filter(e => e.metadata?.due_date && new Date(e.metadata.due_date) < new Date());
  const totalUnpaid = unpaid.filter(e => (e.currency||'USD') === cur).reduce((s,e) => s+(e.amount||0), 0);

  // Filter state
  if (!window._bsInvFilter) window._bsInvFilter = 'all';
  const f = window._bsInvFilter;
  const filtered = f === 'all' ? inv
    : f === 'unpaid' ? unpaid
    : f === 'overdue' ? overdue
    : f === 'settled' ? inv.filter(e => e.status === 'settled')
    : inv;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Invoices</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${inv.length} total · ${unpaid.length} unpaid${overdue.length > 0 ? ` · <span style="color:var(--red,#d07878);">${overdue.length} overdue</span>` : ''} · ${fmtMoney(totalUnpaid, cur)} outstanding</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('invoice')">+ New Invoice</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
      ${['all','unpaid','overdue','settled'].map(v => `
        <button class="bs sm" onclick="window._bsInvFilter='${v}';window._bsNavigate('bs-invoices');"
          style="font-weight:${f===v?'700':'500'};background:${f===v?'var(--accent)':'var(--bg3)'};color:${f===v?'#fff':'var(--text)'};border:1px solid ${f===v?'var(--accent)':'var(--border)'};border-radius:6px;padding:5px 12px;font-size:12px;">
          ${v.charAt(0).toUpperCase()+v.slice(1)}${v==='all'?' ('+inv.length+')':v==='unpaid'?' ('+unpaid.length+')':v==='overdue'?' ('+overdue.length+')':' ('+inv.filter(e=>e.status==='settled').length+')'}
        </button>`).join('')}
    </div>
    ${filtered.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No invoices match this filter.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Invoice #</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>
          ${filtered.map(e => {
            const isOverdue = e.status !== 'settled' && e.status !== 'voided' && e.metadata?.due_date && new Date(e.metadata.due_date) < new Date();
            return `<tr style="cursor:pointer;${isOverdue?'background:rgba(208,120,120,.06);':''}" onclick="window._bsViewEntry('${e.id}')">
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td style="font-weight:600;">${esc(e.contact_name || '—')}</td>
            <td style="color:var(--accent);font-size:13px;font-weight:600;">${esc(e.metadata?.inv_number || '—')}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td style="color:${isOverdue?'var(--red,#d07878)':'var(--muted)'};font-size:13px;font-weight:${isOverdue?'600':'400'};">${fmtDate(e.metadata?.due_date)}${isOverdue?' ⚠':''}
            </td>
            <td>${statusBadge(e.status || 'draft')}</td>
          </tr>`}).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// View entry detail — reuse the main app's detail modal
window._bsViewEntry = function(entryId) {
  if (window.openEntryDetail) window.openEntryDetail(entryId);
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Bills
// ══════════════════════════════════════════════════════════════════
async function _bsRenderBills(el) {
  const user = getCurrentUser();
  const cur = getCurrentProfile()?.default_currency || 'USD';

  const { data } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', user.id)
    .eq('tx_type', 'bill_sent')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const bills = data || [];
  const unpaid = bills.filter(e => e.status !== 'settled' && e.status !== 'voided');
  const overdue = unpaid.filter(e => e.metadata?.due_date && new Date(e.metadata.due_date) < new Date());
  const totalUnpaid = unpaid.filter(e => (e.currency||'USD') === cur).reduce((s,e) => s+(e.amount||0), 0);

  if (!window._bsBillFilter) window._bsBillFilter = 'all';
  const f = window._bsBillFilter;
  const filtered = f === 'all' ? bills
    : f === 'unpaid' ? unpaid
    : f === 'overdue' ? overdue
    : f === 'settled' ? bills.filter(e => e.status === 'settled')
    : bills;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Bills</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${bills.length} total · ${unpaid.length} unpaid${overdue.length > 0 ? ` · <span style="color:var(--red,#d07878);">${overdue.length} overdue</span>` : ''} · ${fmtMoney(totalUnpaid, cur)} outstanding</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('bill')">+ New Bill</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
      ${['all','unpaid','overdue','settled'].map(v => `
        <button class="bs sm" onclick="window._bsBillFilter='${v}';window._bsNavigate('bs-bills');"
          style="font-weight:${f===v?'700':'500'};background:${f===v?'var(--accent)':'var(--bg3)'};color:${f===v?'#fff':'var(--text)'};border:1px solid ${f===v?'var(--accent)':'var(--border)'};border-radius:6px;padding:5px 12px;font-size:12px;">
          ${v.charAt(0).toUpperCase()+v.slice(1)}${v==='all'?' ('+bills.length+')':v==='unpaid'?' ('+unpaid.length+')':v==='overdue'?' ('+overdue.length+')':' ('+bills.filter(e=>e.status==='settled').length+')'}
        </button>`).join('')}
    </div>
    ${filtered.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No bills match this filter.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Supplier</th><th>Ref #</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>
          ${filtered.map(e => {
            const isOverdue = e.status !== 'settled' && e.status !== 'voided' && e.metadata?.due_date && new Date(e.metadata.due_date) < new Date();
            return `<tr style="cursor:pointer;${isOverdue?'background:rgba(208,120,120,.06);':''}" onclick="window._bsViewEntry('${e.id}')">
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td style="font-weight:600;">${esc(e.contact_name || '—')}</td>
            <td style="color:var(--muted);font-size:13px;">${esc(e.metadata?.ref_number || '—')}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td style="color:${isOverdue?'var(--red,#d07878)':'var(--muted)'};font-size:13px;font-weight:${isOverdue?'600':'400'};">${fmtDate(e.metadata?.due_date)}${isOverdue?' ⚠':''}</td>
            <td>${statusBadge(e.status || 'draft')}</td>
          </tr>`}).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Clients
// ══════════════════════════════════════════════════════════════════
async function _bsRenderClients(el) {
  const user = getCurrentUser();
  const contacts = await listContacts(user.id);
  _bsContacts = contacts;

  const { data: invoices } = await supabase
    .from('entries')
    .select('contact_id, contact_name, amount, currency, status, created_at')
    .eq('user_id', user.id)
    .eq('tx_type', 'invoice_sent')
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

  // Enrich with contact details
  const clients = Object.entries(clientMap).map(([id, c]) => {
    const contact = contacts.find(ct => ct.id === id);
    return { id, ...c, email: contact?.email || '', phone: contact?.phone || '' };
  });
  clients.sort((a,b) => b.unpaid - a.unpaid);
  const cur = getCurrentProfile()?.default_currency || 'USD';
  const totalReceivable = clients.reduce((s,c) => s + c.unpaid, 0);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Clients</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${clients.length} client${clients.length!==1?'s':''} · ${fmtMoney(totalReceivable, cur)} total receivable</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('invoice')">+ Invoice Client</button>
    </div>
    ${clients.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No clients yet. Clients appear here automatically when you send your first invoice.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Invoices</th><th>Total</th><th>Outstanding</th><th>Last Invoice</th></tr></thead><tbody>
          ${clients.map(c => `<tr>
            <td style="font-weight:600;">${contactAvatar(c.name, c.id, 28)} ${esc(c.name)}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(c.email || c.phone || '—')}</td>
            <td style="text-align:center;">${c.count}</td>
            <td>${fmtMoney(c.total, cur)}</td>
            <td style="font-weight:700;color:${c.unpaid > 0 ? 'var(--green,#7fe0d0)' : 'var(--muted)'};">${fmtMoney(c.unpaid, cur)}</td>
            <td style="color:var(--muted);font-size:12px;">${fmtRelative(c.lastDate)}</td>
          </tr>`).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Suppliers
// ══════════════════════════════════════════════════════════════════
async function _bsRenderSuppliers(el) {
  const user = getCurrentUser();
  const contacts = _bsContacts.length ? _bsContacts : await listContacts(user.id);

  const { data: bills } = await supabase
    .from('entries')
    .select('contact_id, contact_name, amount, currency, status, created_at')
    .eq('user_id', user.id)
    .in('tx_type', ['bill_sent','i_owe'])
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const supplierMap = {};
  (bills || []).forEach(b => {
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
  const cur = getCurrentProfile()?.default_currency || 'USD';
  const totalPayable = suppliers.reduce((s,c) => s + c.unpaid, 0);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Suppliers</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${suppliers.length} supplier${suppliers.length!==1?'s':''} · ${fmtMoney(totalPayable, cur)} total payable</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('bill')">+ New Bill</button>
    </div>
    ${suppliers.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No suppliers yet. Suppliers appear here automatically when you create a bill or record a payable.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th>Bills</th><th>Total</th><th>Outstanding</th><th>Last Bill</th></tr></thead><tbody>
          ${suppliers.map(c => `<tr>
            <td style="font-weight:600;">${contactAvatar(c.name, c.id, 28)} ${esc(c.name)}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(c.email || c.phone || '—')}</td>
            <td style="text-align:center;">${c.count}</td>
            <td>${fmtMoney(c.total, cur)}</td>
            <td style="font-weight:700;color:${c.unpaid > 0 ? 'var(--red,#d07878)' : 'var(--muted)'};">${fmtMoney(c.unpaid, cur)}</td>
            <td style="color:var(--muted);font-size:12px;">${fmtRelative(c.lastDate)}</td>
          </tr>`).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Recurring Billing
// ══════════════════════════════════════════════════════════════════
async function _bsRenderRecurring(el) {
  const user = getCurrentUser();
  const rules = await listRecurring(user.id);

  // Filter to business-relevant types
  const bizTypes = new Set(['invoice_sent','bill_sent']);
  const bizRules = rules.filter(r => bizTypes.has(r.tx_type));

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Recurring Billing</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${bizRules.length} recurring rule${bizRules.length!==1?'s':''}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="if(window.openNewRecurringModal)window.openNewRecurringModal()">+ New Rule</button>
    </div>
    ${bizRules.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No recurring billing rules yet. Set up automatic invoices or bills on a schedule.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Contact</th><th>Type</th><th>Amount</th><th>Frequency</th><th>Next Run</th><th>Status</th></tr></thead><tbody>
          ${bizRules.map(r => `<tr>
            <td style="font-weight:600;">${esc(r.contact?.name || 'Self')}</td>
            <td style="font-size:13px;">${esc(_bsTxLabel(r.tx_type))}</td>
            <td style="font-weight:700;">${fmtMoney(r.amount)}</td>
            <td>${esc(FREQUENCIES[r.frequency] || r.frequency)}</td>
            <td style="color:var(--muted);font-size:13px;">${fmtDate(r.next_run_at)}</td>
            <td><span class="badge ${r.active ? 'badge-green' : 'badge-gray'}">${r.active ? 'Active' : 'Paused'}</span></td>
          </tr>`).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Business Panels (Form Generator)
// ══════════════════════════════════════════════════════════════════
async function _bsRenderPanels(el) {
  const user = getCurrentUser();
  const panels = await listPanels(user.id);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Business Panels</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${panels.length} panel${panels.length!==1?'s':''} · ${panels.filter(p=>p.is_public).length} published</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="if(window._bpEngine?.openCreateModal)window._bpEngine.openCreateModal();else toast('Panel engine not loaded','error');">+ New Panel</button>
        <button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-panel-db')">Browse Public DB</button>
      </div>
    </div>
    ${panels.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No business panels yet. Create a custom panel to track structured business data, or import one from the Public DB.</p></div>'
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${panels.map(p => `
            <div class="card" style="padding:18px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="font-size:16px;font-weight:700;cursor:pointer;flex:1;" onclick="if(window._bpEngine?.openPanel)window._bpEngine.openPanel('${p.id}');else toast('Panel engine not loaded','error');">${esc(p.title)}</div>
                ${p.is_public ? '<span class="badge badge-blue" style="font-size:10px;flex-shrink:0;">Public</span>' : ''}
              </div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(p.session_type || 'Standard')} · ${esc(p.currency || 'USD')}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:6px;">${(p.fields||[]).length} field${(p.fields||[]).length!==1?'s':''} · Updated ${fmtRelative(p.updated_at || p.created_at)}</div>
              <div style="display:flex;gap:6px;margin-top:10px;">
                <button class="bs sm" onclick="if(window._bpEngine?.openPanel)window._bpEngine.openPanel('${p.id}');" style="font-size:12px;">Open</button>
                <button class="bs sm" onclick="if(window._bpEngine?.togglePublicPanel)window._bpEngine.togglePublicPanel('${p.id}',${!p.is_public});" style="font-size:12px;">${p.is_public ? '🔒 Unpublish' : '🌐 Publish'}</button>
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
  const templates = await listTemplates(user.id);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Templates</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">Invoice and form templates</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="if(window.openNewTemplateModal)window.openNewTemplateModal()">+ New Template</button>
        <button class="btn btn-secondary btn-sm" onclick="if(window.openPublicTemplateDB)window.openPublicTemplateDB()">Public DB</button>
      </div>
    </div>
    ${templates.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No templates yet. Create reusable templates for your invoices and forms.</p></div>'
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${templates.map(t => `
            <div class="card" style="padding:18px;cursor:pointer;" onclick="if(window.openEditTemplate)window.openEditTemplate('${t.id}')">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div style="font-size:16px;font-weight:700;">${esc(t.name)}</div>
                ${t.is_public ? '<span class="badge badge-blue" style="font-size:10px;">Public</span>' : ''}
              </div>
              ${t.description ? `<p style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(t.description)}</p>` : ''}
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                <span class="badge badge-blue">${(t.fields||[]).length} field${(t.fields||[]).length!==1?'s':''}</span>
                ${t.tx_type ? `<span class="badge badge-gray">${esc(_bsTxLabel(t.tx_type))}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Investments
// ══════════════════════════════════════════════════════════════════
async function _bsRenderInvestments(el) {
  const user = getCurrentUser();

  const { data: investments } = await supabase
    .from('investments')
    .select('*, members:investment_members(*), transactions:investment_transactions(*)')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const inv = investments || [];

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Investments</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${inv.length} investment${inv.length!==1?'s':''}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="if(window.openNewInvestmentModal)window.openNewInvestmentModal()">+ New Investment</button>
    </div>
    ${inv.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No investments yet. Track investment pools and returns here.</p></div>'
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${inv.map(i => {
            const memberCount = (i.members||[]).length;
            const txCount = (i.transactions||[]).length;
            return `<div class="card" style="padding:18px;cursor:pointer;" onclick="if(window.openInvestmentDetail)window.openInvestmentDetail('${i.id}')">
              <div style="font-size:16px;font-weight:700;">${esc(i.name)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(i.type || 'Standard')}</div>
              <div style="display:flex;gap:8px;margin-top:8px;">
                <span class="badge badge-blue">${memberCount} member${memberCount!==1?'s':''}</span>
                <span class="badge badge-gray">${txCount} transaction${txCount!==1?'s':''}</span>
              </div>
            </div>`;
          }).join('')}
        </div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Panel Public DB
// ══════════════════════════════════════════════════════════════════
async function _bsRenderPanelDB(el) {
  const userId = getCurrentUser()?.id;
  // Fetch public business panels (is_public column may not exist yet — graceful fallback)
  let panels = [];
  try {
    const { data, error } = await supabase
      .from('business_panels')
      .select('id, title, currency, session_type, fields, user_id, created_at, updated_at')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error) panels = data || [];
  } catch(_) { /* is_public column may not exist yet */ }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Panel Public DB</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${panels.length} published panel${panels.length!==1?'s':''} available</p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-panels')">My Panels</button>
    </div>
    ${panels.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:32px;margin-bottom:12px;">📋</div>
          <p style="color:var(--muted);margin-bottom:12px;">No public panels available yet.</p>
          <p style="color:var(--muted);font-size:12px;">Publish one of your panels from the Business Panels section to share it here.</p>
          <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="window._bsNavigate('bs-panels')">Go to My Panels</button>
        </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">
          ${panels.map(p => {
            const fields = p.fields || [];
            const isOwn = p.user_id === userId;
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
                ${!isOwn ? `<button class="btn btn-primary btn-sm" onclick="window._bsCopyPanel('${p.id}')">+ Import to My Panels</button>` : `<button class="btn btn-secondary btn-sm" onclick="if(window._bpEngine?.openPanel)window._bpEngine.openPanel('${p.id}');">Open</button>`}
                <button class="bs sm" onclick="window._bsPreviewPanel('${p.id}')" style="font-size:12px;">Preview Fields</button>
              </div>
            </div>`;
          }).join('')}
        </div>`
    }
  `;
}

// Preview panel fields in a modal
window._bsPreviewPanel = async function(panelId) {
  const { data: panel } = await supabase
    .from('business_panels')
    .select('*')
    .eq('id', panelId)
    .single();
  if (!panel) { toast('Panel not found', 'error'); return; }

  const fields = panel.fields || [];
  openModal(`
    <div class="modal-title">${esc(panel.title)} — Fields Preview</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">${esc(panel.session_type || 'Standard')} · ${esc(panel.currency || 'USD')} · ${fields.length} field${fields.length!==1?'s':''}</div>
    ${fields.length === 0 ? '<p style="color:var(--muted);">This panel has no fields defined yet.</p>' : `
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
      ${panel.user_id !== getCurrentUser()?.id ? `<button class="btn btn-primary sm" onclick="closeModal();window._bsCopyPanel('${panelId}')">+ Import</button>` : ''}
    </div>
  `, { maxWidth: '500px' });
};

window._bsCopyPanel = async function(panelId) {
  const user = getCurrentUser();
  const { data: source } = await supabase
    .from('business_panels')
    .select('*')
    .eq('id', panelId)
    .single();

  if (!source) { toast('Panel not found', 'error'); return; }

  const { data, error } = await supabase
    .from('business_panels')
    .insert({
      user_id: user.id,
      title: source.title + ' (Copy)',
      currency: source.currency,
      session_type: source.session_type,
      fields: source.fields || []
    })
    .select()
    .single();

  if (error) { toast('Failed to copy: ' + error.message, 'error'); return; }
  toast('Panel copied to your Business Panels', 'success');
  window._bsNavigate('bs-panels');
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Branding — Invoice customization & business identity
// ══════════════════════════════════════════════════════════════════
function _bsRenderBranding(el) {
  const p = getCurrentProfile() || {};
  const bizId = _getBizId();

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
        <div class="form-group"><label>Business Address</label><input type="text" id="bs-brand-addr" value="${esc(p.company_address || '')}" placeholder="123 Main St, City"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-primary btn-sm" onclick="window._bsSaveBranding()">Save Branding</button>
      </div>
    </div>

    <!-- Invoice Preview -->
    <div class="card" style="padding:20px;">
      <h3 style="font-size:15px;font-weight:700;margin:0 0 14px;">Invoice Preview</h3>
      <div style="background:var(--bg3);border-radius:10px;padding:20px;border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
          <div>
            ${p.logo_url ? `<img src="${esc(p.logo_url)}" style="max-height:40px;max-width:100px;margin-bottom:6px;object-fit:contain;">` : ''}
            <div style="font-size:16px;font-weight:800;">${esc(p.company_name || 'Your Business')}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(p.company_address || 'Business Address')}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(p.company_email || 'email@business.com')} · ${esc(p.company_phone || 'Phone')}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:800;color:var(--accent);">INVOICE</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">#INV-0001</div>
            <div style="font-size:11px;color:var(--muted);">Date: ${new Date().toLocaleDateString()}</div>
          </div>
        </div>
        <div style="border-top:2px solid var(--border);padding-top:12px;margin-top:8px;">
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border);">
            <span style="font-weight:600;">Item</span><span style="font-weight:600;">Amount</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid var(--border);">
            <span>Sample line item</span><span style="font-weight:600;">${p.default_currency||'USD'} 100.00</span>
          </div>
          <div style="display:flex;justify-content:flex-end;padding:10px 0;font-size:14px;font-weight:800;">
            Total: ${p.default_currency||'USD'} 100.00
          </div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:8px;text-align:center;font-family:monospace;">${bizId} · Powered by Money IntX</div>
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
  const uid = getCurrentUser().id;
  const updates = {
    logo_url:        (document.getElementById('bs-brand-logo-url')?.value || '').trim(),
    company_name:    (document.getElementById('bs-brand-name')?.value || '').trim(),
    company_email:   (document.getElementById('bs-brand-email')?.value || '').trim(),
    company_phone:   (document.getElementById('bs-brand-phone')?.value || '').trim(),
    company_address: (document.getElementById('bs-brand-addr')?.value || '').trim(),
    updated_at:      new Date().toISOString()
  };
  const { error } = await supabase.from('users').update(updates).eq('id', uid);
  if (error) { toast('Failed to save: ' + error.message, 'error'); return; }
  // Refresh profile in state
  const { data: fresh } = await supabase.from('users').select('*').eq('id', uid).single();
  if (fresh) {
    const { setCurrentProfile } = await import('./state.js');
    setCurrentProfile(fresh);
  }
  toast('Branding saved', 'success');
  // Re-render to show updated preview
  _bsRenderBranding(document.getElementById('bs-content'));
  // Update sidebar header
  const hdr = document.querySelector('.bs-sidebar-header');
  if (hdr) {
    hdr.innerHTML = `
      <div style="font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--text);">${esc(updates.company_name || 'Business Suite')}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${_getBizId()}</div>
    `;
  }
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Operatives — Team roles & permissions
// ══════════════════════════════════════════════════════════════════

const BS_ROLES = [
  { id: 'owner',   label: 'Owner',   badge: 'badge-purple', desc: 'Full control — manage team, settings, all tools' },
  { id: 'admin',   label: 'Admin',   badge: 'badge-blue',   desc: 'Manage entries, clients, panels — cannot delete suite' },
  { id: 'manager', label: 'Manager', badge: 'badge-gray',   desc: 'Create entries, view clients, limited editing' },
  { id: 'viewer',  label: 'Viewer',  badge: 'badge-yellow', desc: 'Read-only access to all data' }
];

const BS_ROLE_PERMS = {
  owner:   { canManageTeam: true,  canManageTools: true,  canCreateEntries: true, canEditEntries: true, canDeleteEntries: true, canManagePanels: true, canViewAll: true, canExport: true },
  admin:   { canManageTeam: true,  canManageTools: false, canCreateEntries: true, canEditEntries: true, canDeleteEntries: true, canManagePanels: true, canViewAll: true, canExport: true },
  manager: { canManageTeam: false, canManageTools: false, canCreateEntries: true, canEditEntries: false,canDeleteEntries: false,canManagePanels: false,canViewAll: true, canExport: false },
  viewer:  { canManageTeam: false, canManageTools: false, canCreateEntries: false,canEditEntries: false,canDeleteEntries: false,canManagePanels: false,canViewAll: true, canExport: false }
};

function _bsOpKey() { return 'mxi_bs_operatives_' + (getCurrentUser()?.id || 'def'); }

function _getOperatives() {
  try {
    const raw = localStorage.getItem(_bsOpKey());
    if (raw) return JSON.parse(raw);
  } catch(_) {}
  // Default: current user is Owner
  const u = getCurrentUser();
  const p = getCurrentProfile();
  const defaults = [{
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
    name: p?.display_name || u?.email || 'You',
    email: u?.email || '',
    role: 'owner',
    status: 'active',
    added_at: new Date().toISOString(),
    is_self: true
  }];
  try { localStorage.setItem(_bsOpKey(), JSON.stringify(defaults)); } catch(_) {}
  return defaults;
}

function _saveOperatives(ops) {
  try { localStorage.setItem(_bsOpKey(), JSON.stringify(ops)); } catch(_) {}
}

async function _bsRenderOperatives(el) {
  const operatives = _getOperatives();
  const currentUserIsOwner = operatives.some(o => o.is_self && o.role === 'owner');
  const currentUserIsAdmin = operatives.some(o => o.is_self && (o.role === 'owner' || o.role === 'admin'));

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Operatives</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">Manage team members and their roles within your business</p>
      </div>
      ${currentUserIsAdmin ? `<button class="btn btn-primary sm" onclick="window._bsAddOperative()">+ Add Operative</button>` : ''}
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
        const role = BS_ROLES.find(r => r.id === op.role) || BS_ROLES[3];
        const perms = BS_ROLE_PERMS[op.role] || BS_ROLE_PERMS.viewer;
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
            ${currentUserIsAdmin && !op.is_self ? `
              <div style="display:flex;gap:4px;">
                <button class="bs sm" onclick="window._bsEditOperative('${op.id}')" title="Edit role">✏️</button>
                <button class="bs sm" onclick="window._bsRemoveOperative('${op.id}')" title="Remove" style="color:var(--red,#e57373);">✕</button>
              </div>
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
    <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">Search for an existing Money IntX member by name or email. They must already have an account on the platform.</p>
    <div class="form-group">
      <label>Search Member *</label>
      <input type="text" id="bs-op-search" placeholder="Search by name or email…" autocomplete="off" style="width:100%;"
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
  if (!query || query.length < 2) { resultsEl.style.display = 'none'; return; }

  // Search users by display_name or email
  const { data } = await supabase
    .from('users')
    .select('id, display_name, email, avatar_url')
    .or(`display_name.ilike.%${query}%,email.ilike.%${query}%`)
    .neq('id', getCurrentUser().id)
    .limit(10);

  const users = data || [];
  const ops = _getOperatives();
  const existingIds = new Set(ops.filter(o => o.user_id).map(o => o.user_id));

  if (users.length === 0) {
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">No members found. They must have a Money IntX account first.</div>';
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

  const ops = _getOperatives();
  if (ops.some(o => o.user_id === userId)) { toast('This member is already an operative', 'error'); return; }

  ops.push({
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
    user_id: userId,
    name, email, role,
    status: 'invited',
    added_at: new Date().toISOString(),
    is_self: false
  });
  _saveOperatives(ops);
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
  const ops = _getOperatives();
  const op = ops.find(o => o.id === opId);
  if (!op) return;

  openModal(`
    <div class="modal-title">Edit Operative</div>
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="bs-op-name" value="${esc(op.name)}" style="width:100%;">
    </div>
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="bs-op-email" value="${esc(op.email||'')}" style="width:100%;">
    </div>
    <div class="form-group">
      <label>Role</label>
      <select id="bs-op-role" style="width:100%;">
        ${BS_ROLES.filter(r => r.id !== 'owner').map(r => `<option value="${r.id}" ${r.id===op.role?'selected':''}>${r.label} — ${r.desc}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary sm" onclick="window._bsSaveEditOperative('${opId}')">Save</button>
    </div>
  `, { maxWidth: '440px' });
};

window._bsSaveEditOperative = function(opId) {
  const name = (document.getElementById('bs-op-name')?.value || '').trim();
  const email = (document.getElementById('bs-op-email')?.value || '').trim();
  const role = document.getElementById('bs-op-role')?.value || 'viewer';
  if (!name) { toast('Name is required', 'error'); return; }

  const ops = _getOperatives();
  const idx = ops.findIndex(o => o.id === opId);
  if (idx < 0) return;
  ops[idx].name = name;
  ops[idx].email = email;
  ops[idx].role = role;
  _saveOperatives(ops);
  closeModal();
  toast('Operative updated', 'success');
  _bsRenderOperatives(document.getElementById('bs-content'));
};

window._bsRemoveOperative = function(opId) {
  if (!confirm('Remove this operative?')) return;
  const ops = _getOperatives().filter(o => o.id !== opId);
  _saveOperatives(ops);
  toast('Operative removed', 'success');
  _bsRenderOperatives(document.getElementById('bs-content'));
};

// ══════════════════════════════════════════════════════════════════
// SECTION: Suite Settings / Tool Selection
// ══════════════════════════════════════════════════════════════════
function _bsRenderSettings(el) {
  const tools = _getBsTools();

  el.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-size:20px;font-weight:800;margin:0;">Suite Settings</h2>
      <p style="color:var(--muted);font-size:13px;margin-top:2px;">Choose which tools appear in your Business Suite sidebar</p>
    </div>
    <div class="card" style="padding:20px;">
      ${BS_TOOLS.map(t => {
        const checked = tools[t.id] !== false;
        const disabled = t.always ? 'disabled' : '';
        return `<label style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:${t.always?'default':'pointer'};">
          <input type="checkbox" ${checked?'checked':''} ${disabled}
            onchange="window._bsToggleTool('${t.id}',this.checked)"
            style="width:18px;height:18px;accent-color:var(--accent,#6366F1);">
          <span style="font-size:18px;">${t.icon}</span>
          <span style="font-weight:600;font-size:14px;">${t.label}</span>
          ${t.always ? '<span class="badge badge-gray" style="font-size:10px;margin-left:auto;">Always on</span>' : ''}
        </label>`;
      }).join('')}
    </div>
  `;
}

window._bsToggleTool = function(id, enabled) {
  const tools = _getBsTools();
  tools[id] = enabled;
  _setBsTools(tools);
  toast(`${enabled ? 'Enabled' : 'Disabled'} — refresh sidebar to apply`, 'info');
};

// ══════════════════════════════════════════════════════════════════
// CSS — Business Suite Layout
// ══════════════════════════════════════════════════════════════════
const BS_CSS = `
/* Business Suite Shell */
.bs-shell {
  display: flex;
  min-height: calc(100vh - 120px);
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
  height: calc(100vh - 120px);
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

.bs-sidebar-footer {
  padding: 8px;
  border-top: 1px solid var(--border);
}

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
  #bs-content {
    padding: 16px !important;
  }
}
`;

// renderBusinessSuite is already exported at function definition
