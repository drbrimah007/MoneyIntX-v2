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
          <div style="font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--text);">Business Suite</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Money IntX for Business</div>
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
    .in('tx_type', ['invoice_sent','bill_sent','bill_received','invoice_received'])
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

  el.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:22px;font-weight:800;margin:0;">Business Overview</h2>
      <p style="color:var(--muted);font-size:13px;margin-top:4px;">Welcome back, ${esc(userName)}</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px;">
      <div class="card" style="padding:20px;border-left:3px solid var(--green,#7fe0d0);">
        <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Outstanding Invoices</div>
        <div style="font-size:26px;font-weight:800;margin-top:6px;color:var(--green,#7fe0d0);">${fmtMoney(totalOutstanding, cur)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;">${invoicesSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length} unpaid</div>
      </div>
      <div class="card" style="padding:20px;border-left:3px solid var(--blue,#8fa8d6);">
        <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Outstanding Bills</div>
        <div style="font-size:26px;font-weight:800;margin-top:6px;color:var(--blue,#8fa8d6);">${fmtMoney(totalBills, cur)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;">${billsSent.filter(e=>e.status!=='settled'&&e.status!=='voided').length} pending</div>
      </div>
      <div class="card" style="padding:20px;border-left:3px solid var(--gold,#d6b97a);">
        <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Total Activity</div>
        <div style="font-size:26px;font-weight:800;margin-top:6px;color:var(--gold,#d6b97a);">${biz.length}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;">business entries</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:28px;">
      <button class="btn btn-primary" onclick="window._bsQuickAction('invoice')" style="padding:14px;font-size:14px;font-weight:700;border-radius:10px;">+ New Invoice</button>
      <button class="btn btn-secondary" onclick="window._bsQuickAction('bill')" style="padding:14px;font-size:14px;font-weight:700;border-radius:10px;">+ New Bill</button>
      <button class="btn btn-secondary" onclick="window._bsNavigate('bs-clients')" style="padding:14px;font-size:14px;font-weight:700;border-radius:10px;">View Clients</button>
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
    invoice_received: 'Invoice Received',
    bill_received: 'Bill Received',
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
    if (window.openNewEntryModal) window.openNewEntryModal('you_owe_them');
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

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Invoices</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${inv.length} total invoice${inv.length!==1?'s':''}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('invoice')">+ New Invoice</button>
    </div>
    ${inv.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No invoices yet. Click "+ New Invoice" to create one.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Invoice #</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>
          ${inv.map(e => `<tr style="cursor:pointer;" onclick="window._bsViewEntry('${e.id}')">
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td style="font-weight:600;">${esc(e.contact_name || '—')}</td>
            <td style="color:var(--muted);font-size:13px;">${esc(e.metadata?.inv_number || '—')}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.metadata?.due_date)}</td>
            <td>${statusBadge(e.status || 'draft')}</td>
          </tr>`).join('')}
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

  const { data } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', user.id)
    .eq('tx_type', 'bill_sent')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const bills = data || [];

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Bills</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${bills.length} total bill${bills.length!==1?'s':''}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window._bsQuickAction('bill')">+ New Bill</button>
    </div>
    ${bills.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No bills yet. Click "+ New Bill" to create one.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Contact</th><th>Ref #</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>
          ${bills.map(e => `<tr style="cursor:pointer;" onclick="window._bsViewEntry('${e.id}')">
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.created_at)}</td>
            <td style="font-weight:600;">${esc(e.contact_name || '—')}</td>
            <td style="color:var(--muted);font-size:13px;">${esc(e.metadata?.ref_number || '—')}</td>
            <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
            <td style="color:var(--muted);font-size:13px;">${fmtDate(e.metadata?.due_date)}</td>
            <td>${statusBadge(e.status || 'draft')}</td>
          </tr>`).join('')}
        </tbody></table></div></div>`
    }
  `;
}

// ══════════════════════════════════════════════════════════════════
// SECTION: Clients
// ══════════════════════════════════════════════════════════════════
async function _bsRenderClients(el) {
  const user = getCurrentUser();

  // Get contacts who have been invoiced (clients)
  const contacts = await listContacts(user.id);
  _bsContacts = contacts;

  // Get all invoice_sent entries to identify clients
  const { data: invoices } = await supabase
    .from('entries')
    .select('contact_id, contact_name, amount, currency, status')
    .eq('user_id', user.id)
    .eq('tx_type', 'invoice_sent')
    .is('archived_at', null);

  // Build client map: contact_id → { name, totalInvoiced, unpaid }
  const clientMap = {};
  (invoices || []).forEach(inv => {
    if (!inv.contact_id) return;
    if (!clientMap[inv.contact_id]) {
      clientMap[inv.contact_id] = { name: inv.contact_name, total: 0, unpaid: 0, count: 0 };
    }
    clientMap[inv.contact_id].count++;
    clientMap[inv.contact_id].total += (inv.amount || 0);
    if (inv.status !== 'settled' && inv.status !== 'voided') {
      clientMap[inv.contact_id].unpaid += (inv.amount || 0);
    }
  });

  const clients = Object.entries(clientMap).map(([id, c]) => ({ id, ...c }));
  clients.sort((a,b) => b.unpaid - a.unpaid);

  const cur = getCurrentProfile()?.default_currency || 'USD';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Clients</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${clients.length} client${clients.length!==1?'s':''} with invoices</p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window._bsQuickAction('invoice')">+ Invoice Client</button>
    </div>
    ${clients.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No clients yet. Clients appear here automatically when you send your first invoice.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Client</th><th>Invoices</th><th>Total Invoiced</th><th>Unpaid</th></tr></thead><tbody>
          ${clients.map(c => `<tr>
            <td style="font-weight:600;">${contactAvatar(c.name, c.id, 28)} ${esc(c.name)}</td>
            <td style="color:var(--muted);">${c.count}</td>
            <td>${fmtMoney(c.total, cur)}</td>
            <td style="font-weight:700;color:${c.unpaid > 0 ? 'var(--green,#7fe0d0)' : 'var(--muted)'};">${fmtMoney(c.unpaid, cur)}</td>
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

  // Get contacts you've sent bills to or recorded purchases against
  const { data: bills } = await supabase
    .from('entries')
    .select('contact_id, contact_name, amount, currency, status')
    .eq('user_id', user.id)
    .in('tx_type', ['bill_sent','i_owe'])
    .is('archived_at', null);

  const supplierMap = {};
  (bills || []).forEach(b => {
    if (!b.contact_id) return;
    if (!supplierMap[b.contact_id]) {
      supplierMap[b.contact_id] = { name: b.contact_name, total: 0, unpaid: 0, count: 0 };
    }
    supplierMap[b.contact_id].count++;
    supplierMap[b.contact_id].total += (b.amount || 0);
    if (b.status !== 'settled' && b.status !== 'voided') {
      supplierMap[b.contact_id].unpaid += (b.amount || 0);
    }
  });

  const suppliers = Object.entries(supplierMap).map(([id, c]) => ({ id, ...c }));
  suppliers.sort((a,b) => b.unpaid - a.unpaid);

  const cur = getCurrentProfile()?.default_currency || 'USD';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="font-size:20px;font-weight:800;margin:0;">Suppliers</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${suppliers.length} supplier${suppliers.length!==1?'s':''}</p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window._bsQuickAction('bill')">+ New Bill</button>
    </div>
    ${suppliers.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No suppliers yet. Suppliers appear here automatically when you create a bill or record a payable.</p></div>'
      : `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Supplier</th><th>Bills</th><th>Total Billed</th><th>Unpaid</th></tr></thead><tbody>
          ${suppliers.map(c => `<tr>
            <td style="font-weight:600;">${contactAvatar(c.name, c.id, 28)} ${esc(c.name)}</td>
            <td style="color:var(--muted);">${c.count}</td>
            <td>${fmtMoney(c.total, cur)}</td>
            <td style="font-weight:700;color:${c.unpaid > 0 ? 'var(--red,#d07878)' : 'var(--muted)'};">${fmtMoney(c.unpaid, cur)}</td>
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
  const bizTypes = new Set(['invoice_sent','bill_sent','invoice_received','bill_received']);
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
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${panels.length} panel${panels.length!==1?'s':''}</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="if(window.bpCreatePanel)window.bpCreatePanel();else window._bsNavigate('bs-panels');">+ New Panel</button>
        <button class="btn btn-secondary btn-sm" onclick="window._bsNavigate('bs-panel-db')">Panel Public DB</button>
      </div>
    </div>
    ${panels.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No business panels yet. Create a custom panel to track structured business data.</p></div>'
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${panels.map(p => `
            <div class="card" style="padding:18px;cursor:pointer;" onclick="if(window.bpOpenPanel)window.bpOpenPanel('${p.id}')">
              <div style="font-size:16px;font-weight:700;">${esc(p.title)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(p.session_type || 'Standard')} · ${esc(p.currency || 'USD')}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:6px;">${(p.fields||[]).length} field${(p.fields||[]).length!==1?'s':''} · Updated ${fmtRelative(p.updated_at || p.created_at)}</div>
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
    <div style="margin-bottom:20px;">
      <h2 style="font-size:20px;font-weight:800;margin:0;">Panel Public DB</h2>
      <p style="color:var(--muted);font-size:13px;margin-top:2px;">Browse publicly shared business panels</p>
    </div>
    ${panels.length === 0
      ? '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No public business panels available yet. Publish your panels to share them here.</p></div>'
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
          ${panels.map(p => `
            <div class="card" style="padding:18px;">
              <div style="font-size:16px;font-weight:700;">${esc(p.title)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(p.session_type || 'Standard')} · ${esc(p.currency || 'USD')} · ${(p.fields||[]).length} fields</div>
              <div style="margin-top:12px;">
                <button class="btn btn-secondary btn-sm" onclick="window._bsCopyPanel('${p.id}')">+ Copy to My Panels</button>
              </div>
            </div>
          `).join('')}
        </div>`
    }
  `;
}

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

export { renderBusinessSuite };
