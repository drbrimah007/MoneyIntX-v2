// Money IntX v2 — Business Ledger Engine
// Reuses calculator system from template-engine.js
import { supabase } from './supabase.js';
import { CALC_OPS, _isNumericField, _isPairedField, _isCalcField } from './template-engine.js';
import {
  listPanels, getPanel, createPanel, updatePanel, deletePanel,
  listRows, addRow, updateRow, deleteRow,
  archiveSessionRows, listArchivedRows,
  listPanelMembers, findUserByEmail, addPanelMember, updatePanelMember, removePanelMember,
  getMyMembership, listSharedPanels, listEligibleMembers
} from './business-panels.js';

// ── Constants ─────────────────────────────────────────────────────
const CURRENCIES = ['USD','EUR','GBP','CAD','AUD','JPY','CHF','NGN','GHS','ZAR','INR','CNY'];
const LEDGER_FX  = { '':'None (no ledger)', toy:'They Owe Me (adds)', toy_credit:'They Owe Me credit (reduces)', yot:'I Owe Them (adds)', yot_credit:'I Owe Them credit (reduces)' };
const RUN_SCHED  = { '':'None', weekly:'Run Weekly', monthly:'Run Monthly', custom:'Run Every…' };

// ── Helpers ───────────────────────────────────────────────────────
// Get the correct render target: BS content area (when inside Business Suite) or main content
function _bpEl() { return document.getElementById('bs-content') || document.getElementById('content'); }
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'f' + Math.random().toString(36).slice(2, 14); }

function fmtMoney(n, cur) {
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency:cur||'USD', minimumFractionDigits:2, maximumFractionDigits:2 }).format(n||0); }
  catch(e) { return `${cur||'USD'} ${(n||0).toFixed(2)}`; }
}

// Format number with thousand separators (commas every 3 digits for 4+ digit numbers)
function _cmpct(n) {
  const abs = Math.abs(n), s = n < 0 ? '−' : '';
  return s + abs.toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:2 });
}

// Compact version of fmtFieldVal — used in table cells only
function fmtFieldValC(val, field, panelCur) {
  let n;
  if (typeof val === 'object' && val !== null) { n = parseFloat(val.num) || 0; }
  else { n = parseFloat(val); if (isNaN(n)) return null; }
  const ut = field.unitType || 'none';
  if (ut === 'currency') {
    const sym = (() => { try { return (0).toLocaleString('en-US',{style:'currency',currency:field.unitValue||panelCur||'USD',minimumFractionDigits:0}).replace(/[\d,.\s]/g,'').trim(); } catch(e){ return field.unitValue||panelCur||'$'; } })();
    return sym + _cmpct(n);
  }
  if (ut === 'weight') return `${_cmpct(n)} ${field.unitValue || 'kg'}`;
  return _cmpct(n);
}

// Compact fmtMoney — used in table cells only
function fmtMoneyC(n, cur) {
  const sym = (() => { try { return (0).toLocaleString('en-US',{style:'currency',currency:cur||'USD',minimumFractionDigits:0}).replace(/[\d,.\s]/g,'').trim(); } catch(e){ return cur||'$'; } })();
  return sym + _cmpct(n || 0);
}

const WEIGHT_UNITS = ['kg','lbs','g','oz','t','lb','ton'];

// Per-field output color presets  [ value, bg, label ]
const BP_OUTPUT_COLORS = [
  ['',         'var(--accent)', 'Default'],
  ['#10b981',  '#10b981',       'Green'],
  ['#22c55e',  '#22c55e',       'Lime'],
  ['#3b82f6',  '#3b82f6',       'Blue'],
  ['#0ea5e9',  '#0ea5e9',       'Sky'],
  ['#8b5cf6',  '#8b5cf6',       'Violet'],
  ['#f97316',  '#f97316',       'Orange'],
  ['#ef4444',  '#ef4444',       'Red'],
  ['#f43f5e',  '#f43f5e',       'Rose'],
  ['#f59e0b',  '#f59e0b',       'Amber'],
  ['#6b7280',  '#6b7280',       'Gray'],
];

function _bpPickColor(color) {
  const inp = document.getElementById('bpfl-color');
  if (inp) inp.value = color;
  document.querySelectorAll('.bp-csw').forEach(btn => {
    const sel = btn.dataset.color === color;
    btn.style.boxShadow = sel ? '0 0 0 3px var(--text)' : 'none';
    const chk = btn.querySelector('.bp-csw-chk');
    if (chk) chk.style.display = sel ? 'flex' : 'none';
  });
}

// Format a column field value according to its unitType/unitValue
function fmtFieldVal(val, field, panelCur) {
  let n;
  if (typeof val === 'object' && val !== null) {
    // paired field — use the numeric part
    n = parseFloat(val.num) || 0;
  } else {
    n = parseFloat(val);
    if (isNaN(n)) return null;
  }
  const ut = field.unitType || 'none';
  if (ut === 'currency') {
    return fmtMoney(n, field.unitValue || panelCur || 'USD');
  }
  if (ut === 'weight') {
    return `${n.toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:3 })} ${field.unitValue || 'kg'}`;
  }
  // plain number
  return n.toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:4 });
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── Session key helpers ────────────────────────────────────────────
function getSessionKey(type, dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (type === 'weekly') {
    const day = d.getDay() || 7;
    const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
    const jan4 = new Date(mon.getFullYear(), 0, 4);
    const w1Mon = new Date(jan4); w1Mon.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
    const weekNum = Math.round((mon - w1Mon) / 604800000) + 1;
    return `${mon.getFullYear()}-W${String(weekNum).padStart(2,'0')}`;
  }
  return dateStr.slice(0, 7);
}

function getSessionLabel(key, type) {
  if (type === 'weekly') {
    const [yr, wk] = key.split('-W');
    const year = parseInt(yr), week = parseInt(wk);
    const jan4 = new Date(year, 0, 4);
    const w1Mon = new Date(jan4); w1Mon.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
    const monday = new Date(w1Mon.getTime() + (week - 1) * 7 * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    return `Week of ${fmt(monday)} – ${fmt(sunday)}`;
  }
  const [yr, mo] = key.split('-');
  return new Date(parseInt(yr), parseInt(mo) - 1, 1)
    .toLocaleString('default', { month:'long', year:'numeric' });
}

function getClosedDateLabel(key, type) {
  if (type === 'weekly') {
    const [yr, wk] = key.split('-W');
    const year = parseInt(yr), week = parseInt(wk);
    const jan4 = new Date(year, 0, 4);
    const w1Mon = new Date(jan4); w1Mon.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
    const sunday = new Date(w1Mon.getTime() + (week - 1) * 7 * 86400000 + 6 * 86400000);
    return sunday.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }
  const [yr, mo] = key.split('-');
  const last = new Date(parseInt(yr), parseInt(mo), 0);
  return last.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function isCurrentSession(key, type) {
  return key === getSessionKey(type, todayStr());
}

// ── Calculator operation types ──────────────────────────────────────
const BP_CALC_OPS = {
  add:              'Add  (+)',
  subtract:         'Subtract  (−)',
  multiply:         'Multiply  (×)',
  divide:           'Divide  (÷)',
  aggregate:        'Sum all fields',
  select_aggregate: 'Sum selected fields',
};
const BP_BINARY_OPS = ['add','subtract','multiply','divide'];
const BP_OP_SYMBOL   = { add:'+', subtract:'−', multiply:'×', divide:'÷' };

// ── Computation ────────────────────────────────────────────────────
function _resolveOperand(type, fieldId, constant, colValues, rowId) {
  if (type === 'constant') return parseFloat(constant) || 0;
  // Handle invoice sub-value references like "fieldId.amount", "fieldId.paid", etc.
  if (type === 'invoice_sub' && fieldId) {
    const [fid, subKey] = fieldId.split('.');
    if (fid && subKey && rowId) {
      const link = _curCellLinks.find(cl => cl.row_id === rowId && cl.field_id === fid);
      if (!link) return 0;
      if (subKey === 'amount')      return (parseFloat(link.amount) || 0) / 100;
      if (subKey === 'paid')        return (parseFloat(link.paid_amount) || 0) / 100;
      if (subKey === 'outstanding') return (parseFloat(link.outstanding_amount || link.amount) || 0) / 100;
      return 0;
    }
    return 0;
  }
  const v = colValues[fieldId];
  // If the referenced field is an invoice field, resolve its amount from cell links
  if (v === undefined && rowId) {
    const link = _curCellLinks.find(cl => cl.row_id === rowId && cl.field_id === fieldId);
    if (link) return (parseFloat(link.amount) || 0) / 100; // default to amount
  }
  return typeof v === 'object' ? (parseFloat(v?.num) || 0) : (parseFloat(v) || 0);
}

function computeRowFields(fields, rowValues, rowId) {
  const result = {};
  const rowFields = fields.filter(f => f.direction === 'row');
  const colValues = { ...rowValues };
  rowFields.forEach(f => {
    let val = 0;
    (f.calculators || []).forEach(calc => {
      const op = calc.operation;
      if (BP_BINARY_OPS.includes(op)) {
        // New two-operand format
        if ('leftFieldId' in calc || 'leftType' in calc) {
          const L = _resolveOperand(calc.leftType  || 'field', calc.leftFieldId,  calc.leftConstant,  colValues, rowId);
          const R = _resolveOperand(calc.rightType || 'field', calc.rightFieldId, calc.rightConstant, colValues, rowId);
          val = op === 'add'      ? L + R
              : op === 'subtract' ? L - R
              : op === 'multiply' ? L * R
              : R !== 0 ? L / R : 0;
        } else {
          // Legacy single-target format (backward compat)
          if (op === 'multiply') val = (_resolveOperand('field', calc.targetFieldId, 0, colValues, rowId)) * (parseFloat(calc.operand) || 1);
          else if (op === 'add')      val += _resolveOperand('field', calc.targetFieldId, 0, colValues, rowId);
          else if (op === 'subtract') val -= _resolveOperand('field', calc.targetFieldId, 0, colValues, rowId);
        }
      } else if (op === 'aggregate') {
        val = fields.filter(ff => ff.direction !== 'row' && !ff.excludeFromAggregate && ff.id !== f.id)
                    .reduce((s, ff) => s + _resolveOperand('field', ff.id, 0, colValues, rowId), 0);
      } else if (op === 'select_aggregate') {
        val = (calc.targetFieldIds || []).filter(fid => fid !== f.id)
          .reduce((s, fid) => s + _resolveOperand('field', fid, 0, colValues, rowId), 0);
      }
      if (calc.resultVisible !== false) colValues[f.id] = val;
    });
    result[f.id] = val;
  });
  return result;
}

// Compute column fields that have calculators, in field order so dependencies chain
function computeColFields(fields, rawValues) {
  const vals = { ...rawValues };
  fields.filter(f => f.direction !== 'row' && (f.calculators||[]).length).forEach(f => {
    (f.calculators).forEach(calc => {
      const op = calc.operation;
      let val = 0;
      if (BP_BINARY_OPS.includes(op) && ('leftFieldId' in calc || 'leftType' in calc)) {
        const L = _resolveOperand(calc.leftType  || 'field', calc.leftFieldId,  calc.leftConstant,  vals);
        const R = _resolveOperand(calc.rightType || 'field', calc.rightFieldId, calc.rightConstant, vals);
        val = op === 'add' ? L + R : op === 'subtract' ? L - R : op === 'multiply' ? L * R : R !== 0 ? L / R : 0;
      } else if (op === 'aggregate') {
        val = fields.filter(ff => ff.id !== f.id && !ff.excludeFromAggregate && ff.direction !== 'row')
                    .reduce((s, ff) => s + _resolveOperand('field', ff.id, 0, vals), 0);
      } else if (op === 'select_aggregate') {
        val = (calc.targetFieldIds || []).filter(fid => fid !== f.id).reduce((s, fid) => s + _resolveOperand('field', fid, 0, vals), 0);
      }
      if (calc.resultVisible !== false) vals[f.id] = val;
    });
  });
  return vals;
}

function computeSessionPnL(fields, rows) {
  const rowFields = fields.filter(f => f.direction === 'row' && (f.calculators || []).length > 0);
  if (!rowFields.length) return null;
  let total = 0;
  rows.forEach(row => {
    const computed = computeRowFields(fields, row.values || {}, row.id);
    rowFields.forEach(f => { total += computed[f.id] || 0; });
  });
  return total;
}

// ── State ──────────────────────────────────────────────────────────
let _userId = null;
let _navFn  = null;
let _toastFn = null;
let _curPanel      = null;
let _curRows       = [];
let _curCellLinks  = [];        // invoice cell links for current panel
let _curMembership = null; // null = owner; { can_add, can_edit } = member
let _lastBizId     = null; // tracks which business context the panel was opened in
let _bpFldCalcs    = [];
let _bpFldDir      = 'column';
let _bpRowPrefix   = 'bpr';   // 'bpr' for Add modal, 'bped' for Edit modal
let _bpLastColVals = {};      // cached computed col values for _previewRow

// Get current business UUID — reads from session, never guesses
function _bpBusinessId() {
  // BS context overrides (cross-business operation)
  if (window._bsContext?.businessId) return window._bsContext.businessId;
  // Otherwise: user's own business from session
  if (window.getSession) {
    const s = window.getSession();
    if (s.businessId) return s.businessId;
  }
  // Legacy fallback
  return window._bpOwnBusinessId || null;
}

export function initBpEngine(userId, navFn, toastFn) {
  _userId  = userId;
  _navFn   = navFn;
  _toastFn = toastFn;
}

function toast(msg, type) { if (_toastFn) _toastFn(msg, type); }

// ─────────────────────────────────────────────────────────────────
// PANEL LIST PAGE
// ─────────────────────────────────────────────────────────────────
const _SQL_SETUP = `create table if not exists business_panels (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  title        text not null,
  currency     text not null default 'USD',
  session_type text not null default 'monthly',
  fields       jsonb not null default '[]',
  archived     boolean not null default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table business_panels enable row level security;
create policy "bp_owner_all" on business_panels for all using (auth.uid() = user_id);

create table if not exists business_panel_rows (
  id          uuid default gen_random_uuid() primary key,
  panel_id    uuid references business_panels(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  session_key text not null,
  row_date    date not null default current_date,
  values      jsonb not null default '{}',
  archived    boolean not null default false,
  created_at  timestamptz default now()
);
alter table business_panel_rows enable row level security;
create policy "bpr_owner_all" on business_panel_rows for all using (auth.uid() = user_id);`;

export async function renderBusinessPage(el) {
  el.innerHTML = '<p style="color:var(--muted);padding:24px;">Loading…</p>';

  // ── Resolve user's own business (from session, no extra RPC) ──
  if (!window._bpOwnBusinessId && window.getSession) {
    const _sess = window.getSession();
    if (_sess?.businessId) window._bpOwnBusinessId = _sess.businessId;
  }

  // ── Check if table exists ──────────────────────────────────────
  const { error: chkErr } = await supabase.from('business_panels').select('id').limit(1);
  const _tableOk = !chkErr || (!chkErr.message?.includes('does not exist') && !chkErr.message?.includes('Could not find') && chkErr.code !== '42P01' && chkErr.code !== 'PGRST200' && chkErr.code !== 'PGRST116' && chkErr.code !== '404');
  if (!_tableOk) {
    el.innerHTML = `<div class="page-header"><h2 style="margin:0;">Business Ledgers</h2></div>
    <div class="card" style="border:1px solid var(--amber);background:rgba(251,191,36,.07);">
      <div style="font-size:20px;margin-bottom:8px;">⚙️ One-time setup required</div>
      <p style="font-size:14px;color:var(--muted);margin-bottom:16px;">
        The Business Ledger tables don't exist in your database yet.<br>
        Copy the SQL below and run it in your <strong style="color:var(--text);">Supabase SQL Editor</strong> → then refresh this page.
      </p>
      <details>
        <summary style="cursor:pointer;font-weight:700;font-size:13px;color:var(--accent);margin-bottom:8px;">▶ Show SQL to copy</summary>
        <pre style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;margin-top:8px;">${esc(_SQL_SETUP)}</pre>
      </details>
      <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="window.location.reload()">↺ Refresh after running SQL</button>
    </div>`;
    return;
  }

  // ── Tab state ──
  if (!window._bpPanelTab) window._bpPanelTab = 'mine';
  const _tab = window._bpPanelTab;

  if (_tab === 'public') {
    // ── Public Ledger DB view ──
    await _renderPublicPanelDB(el);
    return;
  }

  // ── My Ledgers tab ──
  const bizId = _bpBusinessId();
  const [panels, sharedPanels] = await Promise.all([
    listPanels(bizId),
    listSharedPanels(_userId)
  ]);

  const _tabBar = `<div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);">
    <button onclick="window._bpPanelTab='mine';window._bpEngine.renderBusinessPage(document.getElementById('bs-content')||document.getElementById('content'));"
      style="padding:10px 20px;font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;cursor:pointer;">
      My Ledgers
    </button>
    <button onclick="window._bpPanelTab='public';window._bpEngine.renderBusinessPage(document.getElementById('bs-content')||document.getElementById('content'));"
      style="padding:10px 20px;font-size:13px;font-weight:500;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;">
      Public Ledger DB
    </button>
  </div>`;

  let html = `<div class="page-header">
    <h2 style="margin:0;">Business Ledgers</h2>
    <button class="btn btn-primary btn-sm" onclick="window._bpEngine.openCreateModal()">+ New Ledger</button>
  </div>
  ${_tabBar}`;

  const _panelCard = (p, badge) => `<div class="card" style="cursor:pointer;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;"
    onclick="window._bpEngine.openPanel('${p.id}')">
    <div>
      <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${esc(p.title)}${badge ? ` <span style="font-size:11px;background:rgba(99,102,241,.15);color:var(--accent);padding:1px 7px;border-radius:10px;font-weight:600;margin-left:6px;">${badge}</span>` : ''}${p.is_public ? ' <span style="font-size:10px;background:rgba(99,214,154,.15);color:var(--green,#7fe0d0);padding:1px 7px;border-radius:10px;font-weight:600;">Public</span>' : ''}</div>
      <div style="font-size:12px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;">
        <span>${p.currency}</span><span>·</span>
        <span>${p.session_type === 'weekly' ? '📅 Weekly' : '📆 Monthly'}</span><span>·</span>
        <span>${(p.fields||[]).length} field${(p.fields||[]).length !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <span style="font-size:22px;color:var(--muted);">›</span>
  </div>`;

  if (!panels.length && !sharedPanels.length) {
    html += `<div class="card" style="text-align:center;padding:48px 24px;">
      <div style="font-size:48px;margin-bottom:12px;">📊</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px;">No business ledgers yet</div>
      <p style="color:var(--muted);margin-bottom:20px;font-size:14px;">Create a ledger to track income, expenses, and sessions.</p>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button class="btn btn-primary" onclick="window._bpEngine.openCreateModal()">Create Your First Ledger</button>
        <button class="btn btn-secondary btn-sm" onclick="window._bpPanelTab='public';window._bpEngine.renderBusinessPage(document.getElementById('bs-content')||document.getElementById('content'));">Browse Public DB</button>
      </div>
    </div>`;
  } else {
    html += `<div style="display:grid;gap:12px;">`;
    panels.forEach(p => { html += _panelCard(p, ''); });
    if (sharedPanels.length) {
      html += `<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:8px 0 4px;">Shared with you</div>`;
      sharedPanels.forEach(p => { html += _panelCard(p, 'Shared'); });
    }
    html += `</div>`;
  }

  el.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC PANEL DB — browse, preview, install (copy) for personal panels
// ─────────────────────────────────────────────────────────────────
async function _renderPublicPanelDB(el) {
  let panels = [];
  try {
    const { data, error } = await supabase
      .from('business_panels')
      .select('id, title, currency, session_type, fields, user_id, business_id, created_at, updated_at, businesses:business_id(name)')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error) panels = data || [];
  } catch(_) {}

  window._publicPanelsCache = panels;

  const _tabBar = `<div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border);">
    <button onclick="window._bpPanelTab='mine';window._bpEngine.renderBusinessPage(document.getElementById('bs-content')||document.getElementById('content'));"
      style="padding:10px 20px;font-size:13px;font-weight:500;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;">
      My Ledgers
    </button>
    <button onclick="window._bpPanelTab='public';window._bpEngine.renderBusinessPage(document.getElementById('bs-content')||document.getElementById('content'));"
      style="padding:10px 20px;font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;cursor:pointer;">
      Public Ledger DB
    </button>
  </div>`;

  el.innerHTML = `
    <div class="page-header">
      <h2 style="margin:0;">Business Ledgers</h2>
      <button class="btn btn-primary btn-sm" onclick="window._bpEngine.openCreateModal()">+ New Ledger</button>
    </div>
    ${_tabBar}
    <div style="margin-bottom:14px;">
      <input id="bp-pub-search" type="text" placeholder="Search public ledgers…" oninput="window._bpEngine.filterPublicPanels(this.value)"
        style="width:100%;max-width:400px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;">
    </div>
    <div id="bp-pub-list"></div>`;

  _renderPublicPanelList(panels);
}

function _renderPublicPanelList(panels) {
  const list = document.getElementById('bp-pub-list');
  if (!list) return;
  if (panels.length === 0) {
    list.innerHTML = `<div class="card" style="text-align:center;padding:40px;">
      <div style="font-size:32px;margin-bottom:12px;">📋</div>
      <p style="color:var(--muted);margin-bottom:12px;">No public ledgers match your search.</p>
    </div>`;
    return;
  }
  list.innerHTML = panels.map(p => {
    const fields = p.fields || [];
    const isOwn = p.user_id === _userId;
    return `<div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-size:15px;font-weight:700;">${esc(p.title)}</span>
            ${isOwn ? '<span class="badge badge-purple" style="font-size:10px;">Yours</span>' : ''}
            <span class="badge badge-blue" style="font-size:11px;">${fields.length} field${fields.length !== 1 ? 's' : ''}</span>
            <span class="badge badge-gray" style="font-size:11px;">${esc(p.session_type === 'weekly' ? 'Weekly' : 'Monthly')}</span>
          </div>
          ${p.businesses?.name ? `<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">by <strong style="color:var(--text);">${esc(p.businesses.name)}</strong></div>` : ''}
          <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">
            ${fields.slice(0,5).map(f => `<span style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:1px 7px;font-size:10px;">${esc(f.name||f.label||'Field')}</span>`).join('')}
            ${fields.length > 5 ? `<span style="font-size:10px;color:var(--muted);">+${fields.length-5} more</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          <button class="btn btn-primary btn-sm" onclick="window._bpEngine.copyPublicPanel('${p.id}')">📋 Install</button>
          <button class="btn btn-secondary btn-sm" onclick="window._bpEngine.previewPublicPanel('${p.id}')">👁 Preview</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterPublicPanels(query) {
  const q = (query || '').toLowerCase();
  const all = window._publicPanelsCache || [];
  const filtered = all.filter(p =>
    !q ||
    (p.title || '').toLowerCase().includes(q) ||
    (p.businesses?.name || '').toLowerCase().includes(q) ||
    (p.fields || []).some(f => ((f.name||f.label)||'').toLowerCase().includes(q))
  );
  _renderPublicPanelList(filtered);
}

function previewPublicPanel(panelId) {
  const p = (window._publicPanelsCache || []).find(x => x.id === panelId);
  if (!p) return;
  const fields = p.fields || [];
  const fieldHtml = fields.length === 0
    ? '<p style="color:var(--muted);">This ledger has no fields defined yet.</p>'
    : `<div style="max-height:300px;overflow-y:auto;">
        ${fields.map((f, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:11px;color:var(--muted);width:20px;text-align:right;">${i+1}.</span>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13px;">${esc(f.name || f.label || 'Unnamed')}</div>
              <div style="font-size:11px;color:var(--muted);">${esc(f.type || 'text')}${f.unitType ? ' · ' + esc(f.unitType + (f.unitValue ? ':'+f.unitValue : '')) : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>`;

  const isOwn = p.user_id === _userId;
  // Use global openModal from ui.js
  const modalHtml = `
    <div style="max-width:480px;">
      <h3 style="margin-bottom:4px;">${esc(p.title)}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">${esc(p.session_type === 'weekly' ? 'Weekly' : 'Monthly')} · ${esc(p.currency || 'USD')} · ${fields.length} field${fields.length !== 1 ? 's' : ''}</div>
      ${fieldHtml}
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-primary btn-sm" onclick="window._bpEngine.copyPublicPanel('${panelId}');if(window.closeModal)closeModal();">📋 Install to My Ledgers</button>
        <button class="bs sm" onclick="if(window.closeModal)closeModal();">Close</button>
      </div>
    </div>`;

  if (typeof window.openModal === 'function') {
    window.openModal(modalHtml);
  } else {
    // Fallback: render inline modal
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.id = 'bpPreviewBg';
    bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
    bg.innerHTML = `<div class="modal" style="max-width:500px;" onclick="event.stopPropagation()">${modalHtml}</div>`;
    document.body.appendChild(bg);
  }
}

async function copyPublicPanel(panelId) {
  // Fetch the public panel, create a copy owned by current user
  const srcPanel = await getPanel(panelId);
  if (!srcPanel) { toast('Ledger not found', 'error'); return; }
  const { data: newPanel, error } = await createPanel(_bpBusinessId(), _userId, {
    title: srcPanel.title + ' (Copy)',
    currency: srcPanel.currency,
    session_type: srcPanel.session_type
  });
  if (error || !newPanel) { toast('Failed to copy ledger', 'error'); return; }
  // Copy fields to the new panel, stripping any instance data
  if (srcPanel.fields && srcPanel.fields.length) {
    const cleanFields = srcPanel.fields.map(f => {
      const clean = { ...f };
      delete clean.value;
      delete clean.defaultValue;
      delete clean.lastValue;
      return clean;
    });
    await updatePanel(newPanel.id, { fields: cleanFields });
  }
  toast('Ledger installed — opening now!', 'success');
  // If inside BS context, add to BS tracker
  if (window._bsCreatingPanel || (window._bsActiveContext && window._bsActiveBizId)) {
    if (typeof window._bpAfterSave === 'function') window._bpAfterSave(newPanel.id);
  }
  // Go straight into the newly installed ledger (ready-to-use zone)
  window._bpPanelTab = 'mine';
  openPanel(newPanel.id);
}

// ─────────────────────────────────────────────────────────────────
// CREATE PANEL MODAL
// ─────────────────────────────────────────────────────────────────
function openCreateModal() {
  const curOpts = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
  const html = `<div class="modal-bg" id="bpCreateBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:500px;" onclick="event.stopPropagation()">
      <div class="modal-title">New Business Ledger</div>
      <div class="fg" style="margin-bottom:12px;">
        <label>Ledger Title *</label>
        <input id="bp-title" placeholder="e.g. Monthly Sales, Weekly Expenses" autofocus>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="fg">
          <label>Currency</label>
          <select id="bp-currency">${curOpts}</select>
        </div>
        <div class="fg">
          <label>Session Type</label>
          <select id="bp-sestype">
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <input type="checkbox" id="bp-public" style="width:auto;accent-color:var(--accent);">
        <label for="bp-public" style="cursor:pointer;font-size:13px;font-weight:500;">Publish to Public Ledger DB</label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;">
        <button class="bs" onclick="document.getElementById('bpCreateBg').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window._bpEngine._doCreate()">Create Ledger →</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function _doCreate() {
  const title = document.getElementById('bp-title')?.value.trim();
  const currency = document.getElementById('bp-currency')?.value || 'USD';
  const session_type = document.getElementById('bp-sestype')?.value || 'monthly';
  const is_public = document.getElementById('bp-public')?.checked || false;
  if (!title) { toast('Ledger title required.', 'error'); return; }
  document.getElementById('bpCreateBg')?.remove();
  const { data: panel, error } = await createPanel(_bpBusinessId(), _userId, { title, currency, session_type });
  if (error || !panel) {
    const msg = error?.message || 'Unknown error';
    toast(`Failed to create ledger: ${msg}`, 'error');
    console.error('[_doCreate] userId:', _userId, 'error:', error);
    return;
  }
  // Set is_public if checkbox was checked
  if (is_public && panel.id) {
    await updatePanel(panel.id, { is_public: true });
  }
  toast('Ledger created');
  // If created from Business Suite context, add to BS tracker and return to BS
  if (window._bsCreatingPanel && panel.id) {
    if (typeof window._bpAfterSave === 'function') window._bpAfterSave(panel.id);
    window._bsCreatingPanel = false;
    if (window._bsNavigate) { window._bsNavigate('bs-panels'); return; }
  }
  openPanel(panel.id);
}

// ─────────────────────────────────────────────────────────────────
// EDIT PANEL MODAL (title, currency, session type, publish toggle)
// ─────────────────────────────────────────────────────────────────
async function openEditPanelModal(panelId) {
  const panel = await getPanel(panelId);
  if (!panel) { toast('Ledger not found', 'error'); return; }
  const curOpts = CURRENCIES.map(c => `<option value="${c}" ${panel.currency===c?'selected':''}>${c}</option>`).join('');
  const html = `<div class="modal-bg" id="bpEditBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:500px;" onclick="event.stopPropagation()">
      <div class="modal-title">Edit Ledger</div>
      <div class="fg" style="margin-bottom:12px;">
        <label>Ledger Title *</label>
        <input id="bp-edit-title" value="${esc(panel.title)}" autofocus>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="fg">
          <label>Currency</label>
          <select id="bp-edit-currency">${curOpts}</select>
        </div>
        <div class="fg">
          <label>Session Type</label>
          <select id="bp-edit-sestype">
            <option value="monthly" ${panel.session_type==='monthly'?'selected':''}>Monthly</option>
            <option value="weekly" ${panel.session_type==='weekly'?'selected':''}>Weekly</option>
          </select>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <input type="checkbox" id="bp-edit-public" ${panel.is_public?'checked':''} style="width:auto;accent-color:var(--accent);">
        <label for="bp-edit-public" style="cursor:pointer;font-size:13px;font-weight:500;">Publish to Public Ledger DB</label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;">
        <button class="bs" onclick="document.getElementById('bpEditBg').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window._bpEngine._doEditPanel('${panelId}')">Save Changes</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function _doEditPanel(panelId) {
  const title = document.getElementById('bp-edit-title')?.value.trim();
  const currency = document.getElementById('bp-edit-currency')?.value || 'USD';
  const session_type = document.getElementById('bp-edit-sestype')?.value || 'monthly';
  const is_public = document.getElementById('bp-edit-public')?.checked || false;
  if (!title) { toast('Ledger title required.', 'error'); return; }
  document.getElementById('bpEditBg')?.remove();
  const ok = await updatePanel(panelId, { title, currency, session_type, is_public });
  if (!ok) { toast('Failed to update panel', 'error'); return; }
  toast(is_public ? 'Ledger updated & published' : 'Ledger updated', 'success');
  // Re-open the panel to refresh the view
  openPanel(panelId);
}

// ─────────────────────────────────────────────────────────────────
// PANEL VIEW
// ─────────────────────────────────────────────────────────────────
async function openPanel(panelId) {
  // If inside Business Suite, render in BS content area instead of main content
  const el = document.getElementById('bs-content') || document.getElementById('content');
  el.innerHTML = '<p style="color:var(--muted);padding:24px;">Loading…</p>';

  // Check if panel has invoice fields — if so, load cell links too
  const [panel, rows, membership] = await Promise.all([
    getPanel(panelId),
    listRows(panelId),
    getMyMembership(panelId, _userId)
  ]);
  if (!panel) { toast('Ledger not found.', 'error'); return; }

  // Load cell links for invoice fields
  const hasInvoiceFields = (panel.fields || []).some(f => f.type === 'invoice');
  if (hasInvoiceFields) {
    const { data: linksData } = await supabase.rpc('get_panel_cell_links', { p_panel_id: panelId });
    _curCellLinks = Array.isArray(linksData) ? linksData : (linksData ? JSON.parse(linksData) : []);
  } else {
    _curCellLinks = [];
  }

  _curPanel      = panel;
  _curRows       = rows;
  // null = owner; { can_add, can_edit } = shared member
  _curMembership = panel.user_id === _userId ? null : (membership || { can_add: false, can_edit: false });
  // Track which business context this panel was opened in
  _lastBizId = panel.business_id || null;
  renderPanelView(el);
}

function renderPanelView(el) {
  const p = _curPanel;
  const rows = _curRows;
  const fields = p.fields || [];
  const todayKey = getSessionKey(p.session_type, todayStr());

  // Group rows by session_key (non-archived)
  const sessionMap = {};
  rows.forEach(r => {
    if (!sessionMap[r.session_key]) sessionMap[r.session_key] = [];
    sessionMap[r.session_key].push(r);
  });

  // Sort session keys newest first
  const allKeys = Object.keys(sessionMap).sort((a, b) => b.localeCompare(a));

  // Make sure current session key exists even if no rows yet
  if (!sessionMap[todayKey]) {
    sessionMap[todayKey] = [];
    if (!allKeys.includes(todayKey)) allKeys.unshift(todayKey);
    allKeys.sort((a, b) => b.localeCompare(a));
  }

  const colFields = fields.filter(f => f.direction !== 'row');
  const rowFields = fields.filter(f => f.direction === 'row');

  const isOwner  = !_curMembership;
  const canAdd   = isOwner || _curMembership?.can_add;
  const canEdit  = isOwner || _curMembership?.can_edit;

  let html = `<div class="page-header">
    <div>
      <button class="gh sm" onclick="window._bpEngine.backToList()" style="margin-bottom:6px;">← Business Ledgers</button>
      <h2 style="margin:0;">${esc(p.title)}</h2>
      <div style="font-size:12px;color:var(--muted);margin-top:3px;">${p.currency} · ${p.session_type === 'weekly' ? 'Weekly' : 'Monthly'} sessions${!isOwner ? ' · <span style="color:var(--accent);">Shared with you</span>' : ''}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${isOwner ? `<button class="bs sm" onclick="window._bpEngine.openFieldBuilder()">⚙ Fields</button>
      <button class="bs sm" onclick="window._bpEngine.openMembersModal()">👥 Members</button>
      <button class="bs sm" onclick="window._bpEngine.openArchiveView('${p.id}')">🗂 Archive</button>
      <button class="bs sm" onclick="window._bpEngine.openEditPanelModal('${p.id}')">✏ Edit</button>
      <button class="bs sm" style="color:var(--red);" onclick="window._bpEngine._bpDeletePanel('${p.id}')">🗑 Delete</button>` : ''}
    </div>
  </div>`;

  if (!fields.length) {
    html += `<div class="card" style="text-align:center;padding:40px 24px;">
      <div style="font-size:36px;margin-bottom:10px;">⚙️</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:6px;">No fields defined</div>
      <p style="color:var(--muted);margin-bottom:16px;font-size:13px;">Add column and row fields to start tracking data.</p>
      <button class="btn btn-primary" onclick="window._bpEngine.openFieldBuilder()">Add Fields</button>
    </div>`;
    el.innerHTML = html;
    return;
  }

  // Render each session (current first, then closed)
  allKeys.forEach(key => {
    const sRows = sessionMap[key] || [];
    const isCurrent = key === todayKey;
    const label = getSessionLabel(key, p.session_type);
    const pnl = computeSessionPnL(fields, sRows);

    if (isCurrent) {
      // Open session — full table
      html += renderOpenSession(p, sRows, colFields, rowFields, key, label);
    } else {
      // Closed session — folded box
      html += renderFoldedSession(p, sRows, key, label, pnl);
    }
  });

  el.innerHTML = html;
}

// ── Open (current) session table ──────────────────────────────────
function renderOpenSession(p, rows, colFields, rowFields, sessionKey, label) {
  const currency = p.currency;
  let html = `<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:rgba(99,102,241,.07);">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--accent);">📂 ${esc(label)} — Current</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window._bpEngine.openAddRowModal('${sessionKey}')">+ Add Row</button>
    </div>`;

  // Always show table headers so users understand the ledger structure
  {
    html += `<div class="tbl-wrap"><table><thead><tr>
      <th style="width:80px;">Date</th>`;
    colFields.forEach(f => {
      const unitHint = f.unitType === 'currency' ? ` <span style="font-size:10px;opacity:.6;">(${f.unitValue||currency})</span>`
        : f.unitType === 'weight' ? ` <span style="font-size:10px;opacity:.6;">(${f.unitValue||'kg'})</span>` : '';
      html += `<th>${esc(f.label)}${unitHint}</th>`;
    });
    rowFields.forEach(f => {
      html += `<th style="color:var(--accent);">${esc(f.label)}</th>`;
    });
    html += `<th style="width:52px;"></th></tr></thead><tbody>`;
  }

  if (!rows.length) {
    html += `<tr><td colspan="${1 + colFields.length + rowFields.length + 1}" style="text-align:center;padding:28px;color:var(--muted);font-size:14px;">No entries yet. Add your first row above.</td></tr>`;
    html += `</tbody></table></div>`;
  } else {

    rows.forEach(row => {
      const allColVals = computeColFields(p.fields, row.values || {});
      const rowComputed = computeRowFields(p.fields, allColVals, row.id);
      html += `<tr>
        <td style="font-size:12px;color:var(--muted);">${fmtDate(row.row_date)}</td>`;
      colFields.forEach(f => {
        if (f.type === 'invoice') {
          // Render invoice linked record card
          const link = _getCellLink(row.id, f.id);
          if (link && link.entry_id && !link.deleted) {
            const amt = (link.amount || 0) / 100;
            const statusLabel = link.status === 'settled' ? 'Paid' : link.status === 'partial' ? 'Partial' : 'Open';
            const statusColor = link.status === 'settled' ? '#10b981' : link.status === 'partial' ? '#f59e0b' : '#ef4444';
            html += `<td style="cursor:pointer;padding:4px 8px;" onclick="window._bpEngine.openInvoicePicker('${f.id}','${row.id}')">
              <div style="border:1px solid ${statusColor}30;border-radius:6px;padding:6px 8px;background:${statusColor}08;min-width:120px;">
                <div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${esc(link.note || link.invoice_number || 'Invoice')}</div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                  <span style="font-weight:700;font-size:12px;">${fmtMoneyC(amt, currency)}</span>
                  <span style="font-size:9px;font-weight:600;color:${statusColor};background:${statusColor}15;padding:1px 5px;border-radius:3px;">${statusLabel}</span>
                </div>
              </div>
            </td>`;
          } else if (link && link.deleted) {
            html += `<td style="padding:4px 8px;">
              <div style="border:2px dashed var(--red);border-radius:6px;padding:6px 8px;color:var(--red);font-size:11px;font-weight:600;">⚠ Deleted</div>
            </td>`;
          } else {
            html += `<td style="cursor:pointer;padding:4px 8px;" onclick="window._bpEngine.openInvoicePicker('${f.id}','${row.id}')">
              <div style="border:2px dashed var(--border);border-radius:6px;padding:8px;text-align:center;color:var(--muted);font-size:11px;">Tap to link</div>
            </td>`;
          }
        } else if (f.type === 'numeric' || f.type === 'paired') {
          const raw = allColVals[f.id] ?? '';
          const fv = fmtFieldValC(raw, f, currency);
          const isAuto = (f.calculators||[]).length > 0;
          const fClr = f.outputColor || (isAuto ? 'var(--accent)' : '');
          html += `<td style="font-weight:600;white-space:nowrap;${fClr?'color:'+fClr+';':''}">${fv !== null ? fv : '<span style="color:var(--muted);">—</span>'}</td>`;
        } else {
          const raw = allColVals[f.id] ?? '';
          html += `<td style="font-size:13px;">${esc(raw)}</td>`;
        }
      });
      rowFields.forEach(f => {
        const val = rowComputed[f.id];
        const rfClr = f.outputColor || 'var(--accent)';
        html += `<td style="font-weight:700;white-space:nowrap;color:${rfClr};">${val !== undefined ? fmtMoneyC(val, currency) : '—'}</td>`;
      });
      const _canEd = !_curMembership || _curMembership.can_edit;
      html += `<td style="text-align:right;white-space:nowrap;">
        ${_canEd ? `<button class="bs sm" onclick="window._bpEngine.openEditRowModal('${row.id}')" style="font-size:11px;padding:3px 8px;white-space:nowrap;">Edit</button>` : ''}
      </td></tr>`;
    });

    html += `</tbody></table></div>`;

    // Session column totals
    const hasTotals = colFields.some(f => (f.type === 'numeric' || f.type === 'paired') && !f.excludeFromAggregate);
    if (hasTotals) {
      html += `<div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 18px 12px;border-top:1px solid var(--border);background:var(--bg3);">`;
      colFields.filter(f => (f.type === 'numeric' || f.type === 'paired') && !f.excludeFromAggregate).forEach(f => {
        const total = rows.reduce((s, r) => {
          const v = r.values?.[f.id];
          return s + (typeof v === 'object' ? (parseFloat(v?.num)||0) : (parseFloat(v)||0));
        }, 0);
        const totalFmt = fmtFieldVal(total, f, currency) ?? total.toLocaleString('en-US', {maximumFractionDigits:2});
        html += `<div style="font-size:12px;color:var(--muted);">
          <span>${esc(f.label)}:</span>
          <strong style="color:var(--text);margin-left:4px;">${totalFmt}</strong>
        </div>`;
      });
      const pnl = computeSessionPnL(p.fields, rows);
      if (pnl !== null) {
        const pnlColor = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--muted)';
        html += `<div style="font-size:13px;font-weight:700;margin-left:auto;color:${pnlColor};">
          Net: ${fmtMoney(pnl, currency)}
        </div>`;
      }
      html += `</div>`;
    }

    // Invoice summary footer
    const invoiceFields = colFields.filter(f => f.type === 'invoice');
    if (invoiceFields.length > 0 && _curCellLinks.length > 0) {
      let totalBilled = 0, totalPaid = 0;
      const rowIds = new Set(rows.map(r => r.id));
      _curCellLinks.forEach(cl => {
        if (!rowIds.has(cl.row_id) || cl.deleted || !cl.entry_id) return;
        totalBilled += (cl.amount || 0) / 100;
        totalPaid   += (cl.paid || 0) / 100;
      });
      const outstanding = totalBilled - totalPaid;
      html += `<div style="display:flex;gap:20px;flex-wrap:wrap;padding:10px 18px 12px;border-top:1px solid rgba(16,185,129,.3);background:rgba(16,185,129,.04);">
        <div style="font-size:12px;color:var(--muted);">Total Billed: <strong style="color:var(--text);margin-left:4px;">${fmtMoney(totalBilled, currency)}</strong></div>
        <div style="font-size:12px;color:var(--muted);">Total Paid: <strong style="color:#10b981;margin-left:4px;">${fmtMoney(totalPaid, currency)}</strong></div>
        <div style="font-size:12px;font-weight:700;margin-left:auto;color:${outstanding > 0 ? '#ef4444' : '#10b981'};">
          Outstanding: ${fmtMoney(outstanding, currency)}
        </div>
      </div>`;
    }
  }

  html += `</div>`;
  return html;
}

// ── Folded (closed) session ───────────────────────────────────────
function renderFoldedSession(p, rows, sessionKey, label, pnl) {
  const pnlColor = pnl === null ? 'var(--muted)' : pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--muted)';
  const pnlLabel = pnl === null ? 'No P/L fields' : pnl > 0 ? `↑ ${fmtMoney(pnl, p.currency)}` : pnl < 0 ? `↓ ${fmtMoney(Math.abs(pnl), p.currency)}` : `— ${fmtMoney(0, p.currency)}`;
  const closedDate = getClosedDateLabel(sessionKey, p.session_type);
  const rowCount = rows.length;

  return `<div class="card" style="margin-bottom:10px;padding:0;overflow:hidden;">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;"
      onclick="window._bpEngine.toggleFoldedSession('${sessionKey}', this)">
      <div style="display:flex;align-items:center;gap:14px;">
        <span style="font-size:18px;">📁</span>
        <div>
          <div style="font-weight:700;font-size:14px;">${esc(label)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">Closed ${closedDate} · ${rowCount} row${rowCount !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;">
        <span style="font-weight:700;font-size:15px;color:${pnlColor};">${pnlLabel}</span>
        <button class="bs sm" onclick="event.stopPropagation();window._bpEngine.archiveSession('${p.id}','${sessionKey}')"
          style="font-size:11px;padding:4px 10px;">Archive</button>
        <span style="color:var(--muted);font-size:18px;" id="bp-fold-arrow-${sessionKey}">›</span>
      </div>
    </div>
    <div id="bp-fold-body-${sessionKey}" style="display:none;border-top:1px solid var(--border);">
      ${renderFoldedBody(p, rows, sessionKey)}
    </div>
  </div>`;
}

function renderFoldedBody(p, rows, sessionKey) {
  if (!rows.length) return `<div style="padding:20px 18px;color:var(--muted);font-size:13px;">No rows in this session.</div>`;

  const colFields = (p.fields || []).filter(f => f.direction !== 'row');
  const rowFields = (p.fields || []).filter(f => f.direction === 'row');
  const currency = p.currency;

  let html = `<div class="tbl-wrap"><table><thead><tr>
    <th style="width:80px;">Date</th>`;
  colFields.forEach(f => {
    const unitHint = f.unitType === 'currency' ? ` <span style="font-size:10px;opacity:.6;">(${f.unitValue||p.currency})</span>`
      : f.unitType === 'weight' ? ` <span style="font-size:10px;opacity:.6;">(${f.unitValue||'kg'})</span>` : '';
    html += `<th>${esc(f.label)}${unitHint}</th>`;
  });
  rowFields.forEach(f => { html += `<th style="color:var(--accent);">${esc(f.label)}</th>`; });
  html += `</tr></thead><tbody>`;

  rows.forEach(row => {
    const allColVals = computeColFields(p.fields, row.values || {});
    const rowComputed = computeRowFields(p.fields, allColVals, row.id);
    html += `<tr><td style="font-size:12px;color:var(--muted);">${fmtDate(row.row_date)}</td>`;
    colFields.forEach(f => {
      const raw = allColVals[f.id] ?? '';
      if (f.type === 'invoice') {
        // Invoice cell in folded view
        const link = _getCellLink(row.id, f.id);
        if (link && link.entry_id) {
          const amt = (link.amount || 0) / 100;
          const statusColor = link.status === 'settled' ? '#10b981' : link.status === 'partial' ? '#f59e0b' : '#ef4444';
          const statusLabel = link.status === 'settled' ? 'Paid' : link.status === 'partial' ? 'Partial' : 'Open';
          html += `<td style="font-size:12px;"><span style="font-weight:600;">${fmtMoney(amt, p.currency)}</span> <span style="color:${statusColor};font-size:10px;font-weight:600;">${statusLabel}</span></td>`;
        } else {
          html += `<td style="color:var(--muted);font-size:11px;">—</td>`;
        }
      } else if (f.type === 'numeric' || f.type === 'paired') {
        const fv = fmtFieldValC(raw, f, currency);
        const isAuto = (f.calculators||[]).length > 0;
        const fClr = f.outputColor || (isAuto ? 'var(--accent)' : '');
        html += `<td style="font-weight:600;white-space:nowrap;${fClr?'color:'+fClr+';':''}">${fv !== null ? fv : '<span style="color:var(--muted);">—</span>'}</td>`;
      } else {
        html += `<td style="font-size:13px;">${esc(raw)}</td>`;
      }
    });
    rowFields.forEach(f => {
      const val = rowComputed[f.id];
      const rfClr = f.outputColor || 'var(--accent)';
      html += `<td style="font-weight:700;white-space:nowrap;color:${rfClr};">${val !== undefined ? fmtMoneyC(val, currency) : '—'}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;

  // Column totals footer
  const hasTotals = colFields.some(f => (f.type === 'numeric' || f.type === 'paired') && !f.excludeFromAggregate);
  if (hasTotals) {
    html += `<div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 18px 12px;border-top:1px solid var(--border);background:var(--bg3);">`;
    colFields.filter(f => (f.type === 'numeric' || f.type === 'paired') && !f.excludeFromAggregate).forEach(f => {
      const total = rows.reduce((s, r) => {
        const v = r.values?.[f.id];
        return s + (typeof v === 'object' ? (parseFloat(v?.num)||0) : (parseFloat(v)||0));
      }, 0);
      const totalFmt = fmtFieldVal(total, f, currency) ?? total.toLocaleString('en-US', {maximumFractionDigits:2});
      html += `<div style="font-size:12px;color:var(--muted);"><span>${esc(f.label)}:</span><strong style="color:var(--text);margin-left:4px;">${totalFmt}</strong></div>`;
    });
    html += `</div>`;
  }

  return html;
}

// ── Toggle folded session ─────────────────────────────────────────
function toggleFoldedSession(key, headerEl) {
  const body  = document.getElementById('bp-fold-body-' + key);
  const arrow = document.getElementById('bp-fold-arrow-' + key);
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display  = open ? '' : 'none';
  if (arrow) arrow.textContent = open ? '˅' : '›';
}

// ── Archive session ───────────────────────────────────────────────
async function archiveSession(panelId, sessionKey) {
  if (!confirm(`Archive all rows for this session? They will move to the Archive view.`)) return;
  await archiveSessionRows(panelId, sessionKey);
  toast('Session archived');
  openPanel(panelId);
}

// ── Archive view ─────────────────────────────────────────────────
async function openArchiveView(panelId) {
  const el = _bpEl();
  el.innerHTML = '<p style="color:var(--muted);padding:24px;">Loading archive…</p>';
  const [panel, rows] = await Promise.all([getPanel(panelId), listArchivedRows(panelId)]);
  if (!panel) return;

  const sessionMap = {};
  rows.forEach(r => {
    if (!sessionMap[r.session_key]) sessionMap[r.session_key] = [];
    sessionMap[r.session_key].push(r);
  });
  const keys = Object.keys(sessionMap).sort((a, b) => b.localeCompare(a));

  let html = `<div class="page-header">
    <div>
      <button class="gh sm" onclick="window._bpEngine.openPanel('${panelId}')" style="margin-bottom:6px;">← ${esc(panel.title)}</button>
      <h2 style="margin:0;">Archive</h2>
    </div>
  </div>`;

  if (!keys.length) {
    html += `<div class="card" style="text-align:center;padding:40px 24px;color:var(--muted);">No archived sessions yet.</div>`;
  } else {
    keys.forEach(key => {
      const sRows = sessionMap[key];
      const label = getSessionLabel(key, panel.session_type);
      const pnl = computeSessionPnL(panel.fields, sRows);
      const pnlColor = pnl === null ? 'var(--muted)' : pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--muted)';
      const pnlLabel = pnl === null ? '' : fmtMoney(pnl, panel.currency);
      html += `<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--bg3);">
          <div>
            <div style="font-weight:700;font-size:14px;">🗂 ${esc(label)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">${sRows.length} rows — read only</div>
          </div>
          ${pnlLabel ? `<span style="font-weight:700;font-size:14px;color:${pnlColor};">${pnlLabel}</span>` : ''}
        </div>
        ${renderFoldedBody(panel, sRows, key)}
      </div>`;
    });
  }
  el.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────
// ADD / EDIT ROW MODAL
// ─────────────────────────────────────────────────────────────────
function openAddRowModal(sessionKey) {
  if (!_curPanel) return;
  const p = _curPanel;
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');
  if (!colFields.length) { toast('Add column fields first via ⚙ Fields.', 'error'); return; }
  _bpRowPrefix   = 'bpr';
  _bpLastColVals = {};

  let fieldsHtml = '';
  colFields.forEach(f => {
    const isAuto = (f.calculators || []).length > 0;
    const _uh = f.unitType === 'currency' ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||p.currency})</span>`
              : f.unitType === 'weight'   ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||'kg'})</span>` : '';
    if (f.type === 'text') {
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}</label>
        <input id="bpr-${f.id}" placeholder="${esc(f.label)}" oninput="window._bpEngine._recomputeColPreview()">${f.hint ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(f.hint)}</div>` : ''}</div>`;
    } else if (f.type === 'numeric') {
      if (isAuto) {
        const aClr = f.outputColor || 'var(--accent)';
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;">
          <label>${esc(f.label)}${_uh} <span style="font-size:11px;color:${aClr};font-weight:600;background:var(--bg3);padding:1px 6px;border-radius:10px;margin-left:4px;">AUTO</span></label>
          <div id="bpr-auto-${f.id}" style="background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px 12px;color:${aClr};font-weight:600;font-size:15px;">—</div>
        </div>`;
      } else {
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}${_uh}</label>
          <input type="number" id="bpr-${f.id}" step="0.01" placeholder="0.00" oninput="window._bpEngine._recomputeColPreview()">${f.hint ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(f.hint)}</div>` : ''}</div>`;
      }
    } else if (f.type === 'paired') {
      if (isAuto) {
        const aClr = f.outputColor || 'var(--accent)';
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;">
          <label>${esc(f.label)}${_uh} <span style="font-size:11px;color:${aClr};font-weight:600;background:var(--bg3);padding:1px 6px;border-radius:10px;margin-left:4px;">AUTO</span></label>
          <div id="bpr-auto-${f.id}" style="background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px 12px;color:${aClr};font-weight:600;font-size:15px;">—</div>
        </div>`;
      } else {
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}${_uh}</label>
          <div style="display:flex;gap:8px;">
            <input id="bpr-${f.id}-text" placeholder="${esc(f.textLabel || 'Item')}" style="flex:2;" oninput="window._bpEngine._recomputeColPreview()">
            <input type="number" id="bpr-${f.id}-num" step="0.01" placeholder="0.00" style="flex:1;" oninput="window._bpEngine._recomputeColPreview()">
          </div></div>`;
      }
    } else if (f.type === 'invoice') {
      // Invoice field — show a link-picker button with display area
      const dirLabel = f.invoiceDirection === 'invoice' ? 'Invoices' : f.invoiceDirection === 'bill' ? 'Bills' : 'Invoices / Bills';
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;">
        <label>${esc(f.label)} <span style="font-size:11px;color:#10b981;font-weight:600;background:rgba(16,185,129,.1);padding:1px 6px;border-radius:10px;margin-left:4px;">🔗 LINKED</span></label>
        <input type="hidden" id="bpr-inv-${f.id}" value="">
        <div id="bpr-inv-display-${f.id}" style="border:2px dashed rgba(16,185,129,.35);border-radius:8px;padding:14px;cursor:pointer;text-align:center;color:var(--muted);font-size:13px;background:rgba(16,185,129,.04);min-height:50px;display:flex;align-items:center;justify-content:center;"
          onclick="window._bpEngine.openInvoicePicker('${f.id}','')">
          Tap to link ${dirLabel}
        </div>
      </div>`;
    }
  });

  const rowFields = (p.fields || []).filter(f => f.direction === 'row' && (f.calculators||[]).length);
  const hasRowFields = rowFields.length > 0;

  const html = `<div class="modal-bg" id="bpAddRowBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:540px;" onclick="event.stopPropagation()">
      <div class="modal-title">Add Row — ${esc(getSessionLabel(sessionKey, p.session_type))}</div>
      <div class="fg" style="margin-bottom:14px;">
        <label>Date</label>
        <input type="date" id="bpr-date" value="${todayStr()}">
      </div>
      ${fieldsHtml}
      ${hasRowFields ? `<div id="bpr-preview" style="background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:12px;margin-bottom:14px;font-size:13px;display:none;">
        <div style="font-weight:700;margin-bottom:8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">Calculated</div>
        ${rowFields.map(f => `<div style="display:flex;justify-content:space-between;padding:3px 0;">
          <span style="color:var(--muted);">${esc(f.label)}</span>
          <strong id="bpr-preview-${f.id}" style="color:var(--accent);">—</strong>
        </div>`).join('')}
      </div>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;">
        <button class="bs" onclick="document.getElementById('bpAddRowBg').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window._bpEngine._doAddRow('${sessionKey}')">Add Row</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(() => _recomputeColPreview(), 50);
}

// Reads manual field inputs → computeColFields → updates AUTO displays → calls _previewRow
function _recomputeColPreview() {
  const p = _curPanel;
  if (!p) return;
  const prefix    = _bpRowPrefix;
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');

  // Gather values from manual (non-auto) fields only
  const rawVals = {};
  colFields.forEach(f => {
    if ((f.calculators || []).length > 0) return; // skip auto fields — no input
    if (f.type === 'invoice') return; // skip invoice fields — linked, not typed
    if (f.type === 'paired') {
      rawVals[f.id] = {
        text: document.getElementById(`${prefix}-${f.id}-text`)?.value.trim() || '',
        num:  parseFloat(document.getElementById(`${prefix}-${f.id}-num`)?.value) || 0
      };
    } else if (f.type === 'numeric') {
      rawVals[f.id] = parseFloat(document.getElementById(`${prefix}-${f.id}`)?.value) || 0;
    } else {
      rawVals[f.id] = document.getElementById(`${prefix}-${f.id}`)?.value.trim() || '';
    }
  });

  // Compute auto-calc column fields
  const allColVals = computeColFields(p.fields, rawVals);
  _bpLastColVals = allColVals;

  // Update the AUTO display divs (color is set on the element at modal-open time)
  colFields.forEach(f => {
    if (!(f.calculators || []).length) return;
    const el = document.getElementById(`${prefix}-auto-${f.id}`);
    if (!el) return;
    const val = allColVals[f.id];
    el.textContent = (val !== undefined && val !== null) ? fmtFieldVal(val, f, p.currency) : '—';
    // Re-apply color in case element was recreated
    el.style.color = f.outputColor || 'var(--accent)';
  });

  // Update row-field preview panel
  _previewRow(allColVals);
}

// Updates the row-field preview panel using precomputed col values (or cached)
function _previewRow(precomputedColVals) {
  const p = _curPanel;
  if (!p) return;
  const rowFields = (p.fields || []).filter(f => f.direction === 'row' && (f.calculators||[]).length);
  if (!rowFields.length) return;

  const colVals  = precomputedColVals || _bpLastColVals;
  const computed = computeRowFields(p.fields, colVals);
  const preview  = document.getElementById('bpr-preview');
  if (preview) preview.style.display = '';
  rowFields.forEach(f => {
    const el = document.getElementById(`bpr-preview-${f.id}`);
    if (el) el.textContent = computed[f.id] !== undefined ? fmtMoney(computed[f.id], p.currency) : '—';
  });
}

async function _doAddRow(sessionKey) {
  const p = _curPanel;
  if (!p) return;
  if (_curMembership && !_curMembership.can_add) { toast('You do not have permission to add rows', 'error'); return; }
  const rowDate   = document.getElementById('bpr-date')?.value || todayStr();
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');

  // Read only manual (non-auto) fields from the DOM
  const rawValues = {};
  colFields.forEach(f => {
    if ((f.calculators || []).length > 0) return; // auto field — no input
    if (f.type === 'invoice') return; // invoice field — linked, not typed
    if (f.type === 'paired') {
      rawValues[f.id] = {
        text: document.getElementById(`bpr-${f.id}-text`)?.value.trim() || '',
        num:  parseFloat(document.getElementById(`bpr-${f.id}-num`)?.value) || 0
      };
    } else if (f.type === 'numeric') {
      rawValues[f.id] = parseFloat(document.getElementById(`bpr-${f.id}`)?.value) || 0;
    } else {
      rawValues[f.id] = document.getElementById(`bpr-${f.id}`)?.value.trim() || '';
    }
  });

  // Compute auto-calc column fields and merge
  const values = computeColFields(p.fields, rawValues);

  // Collect pending invoice links before closing modal
  const pendingInvLinks = [];
  colFields.filter(f => f.type === 'invoice').forEach(f => {
    const entryId = document.getElementById(`bpr-inv-${f.id}`)?.value;
    if (entryId) pendingInvLinks.push({ fieldId: f.id, entryId });
  });

  document.getElementById('bpAddRowBg')?.remove();
  const row = await addRow(p.id, _bpBusinessId(), _userId, sessionKey, rowDate, values);
  if (!row) { toast('Failed to save row.', 'error'); return; }

  // Link any invoice fields to the newly created row
  for (const link of pendingInvLinks) {
    const { data, error } = await supabase.rpc('link_invoice_to_cell', {
      p_business_id: _bpBusinessId(),
      p_panel_id: p.id,
      p_row_id: row.id,
      p_field_id: link.fieldId,
      p_entry_id: link.entryId
    });
    if (!error && data) {
      _curCellLinks.push({ row_id: row.id, field_id: link.fieldId, entry_id: link.entryId, ...data });
    }
  }

  toast('Row added');
  _curRows.push(row);
  renderPanelView(_bpEl());
}

// ── Edit row modal ────────────────────────────────────────────────
async function openEditRowModal(rowId) {
  const row = _curRows.find(r => r.id === rowId);
  if (!row || !_curPanel) return;
  const p = _curPanel;
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');
  _bpRowPrefix = 'bped';

  // Pre-compute auto-calc values from saved data for initial display
  const initColVals = computeColFields(p.fields, row.values || {});
  _bpLastColVals    = initColVals;

  let fieldsHtml = '';
  colFields.forEach(f => {
    const val    = row.values?.[f.id];
    const isAuto = (f.calculators || []).length > 0;
    const _uh    = f.unitType === 'currency' ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||p.currency})</span>`
                 : f.unitType === 'weight'   ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||'kg'})</span>` : '';
    if (f.type === 'text') {
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}</label>
        <input id="bped-${f.id}" value="${esc(val || '')}" oninput="window._bpEngine._recomputeColPreview()">${f.hint ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(f.hint)}</div>` : ''}</div>`;
    } else if (f.type === 'numeric') {
      if (isAuto) {
        const dispVal = initColVals[f.id] !== undefined ? fmtFieldVal(initColVals[f.id], f, p.currency) : '—';
        const eClr = f.outputColor || 'var(--accent)';
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;">
          <label>${esc(f.label)}${_uh} <span style="font-size:11px;color:${eClr};font-weight:600;background:var(--bg3);padding:1px 6px;border-radius:10px;margin-left:4px;">AUTO</span></label>
          <div id="bped-auto-${f.id}" style="background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px 12px;color:${eClr};font-weight:600;font-size:15px;">${dispVal}</div>
        </div>`;
      } else {
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}${_uh}</label>
          <input type="number" id="bped-${f.id}" step="0.01" value="${val !== undefined ? val : ''}" oninput="window._bpEngine._recomputeColPreview()">${f.hint ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(f.hint)}</div>` : ''}</div>`;
      }
    } else if (f.type === 'paired') {
      const tv = typeof val === 'object' ? val : {};
      if (isAuto) {
        const dispVal = initColVals[f.id] !== undefined ? fmtFieldVal(initColVals[f.id], f, p.currency) : '—';
        const eClr = f.outputColor || 'var(--accent)';
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;">
          <label>${esc(f.label)}${_uh} <span style="font-size:11px;color:${eClr};font-weight:600;background:var(--bg3);padding:1px 6px;border-radius:10px;margin-left:4px;">AUTO</span></label>
          <div id="bped-auto-${f.id}" style="background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px 12px;color:${eClr};font-weight:600;font-size:15px;">${dispVal}</div>
        </div>`;
      } else {
        fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}${_uh}</label>
          <div style="display:flex;gap:8px;">
            <input id="bped-${f.id}-text" value="${esc(tv.text || '')}" placeholder="${esc(f.textLabel || 'Item')}" style="flex:2;" oninput="window._bpEngine._recomputeColPreview()">
            <input type="number" id="bped-${f.id}-num" step="0.01" value="${tv.num || ''}" placeholder="0.00" style="flex:1;" oninput="window._bpEngine._recomputeColPreview()">
          </div></div>`;
      }
    } else if (f.type === 'invoice') {
      // Invoice field in edit mode — show linked invoice or picker
      const link = _getCellLink(row.id, f.id);
      const dirLabel = f.invoiceDirection === 'invoice' ? 'Invoices' : f.invoiceDirection === 'bill' ? 'Bills' : 'Invoices / Bills';
      let invDisplay;
      if (link && link.entry_id) {
        const amt = (link.amount || 0) / 100;
        const statusLabel = link.status === 'settled' ? 'Paid' : link.status === 'partial' ? 'Partial' : 'Open';
        const statusColor = link.status === 'settled' ? '#10b981' : link.status === 'partial' ? '#f59e0b' : '#ef4444';
        invDisplay = `<div style="border:1px solid rgba(16,185,129,.4);border-radius:8px;padding:12px;background:rgba(16,185,129,.06);cursor:pointer;"
          onclick="window._bpEngine.openInvoicePicker('${f.id}','${row.id}')">
          <div style="font-weight:600;font-size:13px;">${esc(link.note || link.invoice_number || 'Invoice')}</div>
          <div style="font-size:12px;margin-top:4px;display:flex;gap:8px;align-items:center;">
            <span>${fmtMoney(amt, p.currency)}</span>
            <span style="color:${statusColor};font-weight:600;font-size:11px;background:${statusColor}15;padding:1px 6px;border-radius:4px;">${statusLabel}</span>
            <span style="color:var(--muted);font-size:11px;margin-left:auto;">Tap to change</span>
          </div>
        </div>`;
      } else {
        invDisplay = `<div style="border:2px dashed rgba(16,185,129,.35);border-radius:8px;padding:14px;cursor:pointer;text-align:center;color:var(--muted);font-size:13px;background:rgba(16,185,129,.04);"
          onclick="window._bpEngine.openInvoicePicker('${f.id}','${row.id}')">
          Tap to link ${dirLabel}
        </div>`;
      }
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;">
        <label>${esc(f.label)} <span style="font-size:11px;color:#10b981;font-weight:600;background:rgba(16,185,129,.1);padding:1px 6px;border-radius:10px;margin-left:4px;">🔗 LINKED</span></label>
        ${invDisplay}
      </div>`;
    }
  });

  const html = `<div class="modal-bg" id="bpEditRowBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:540px;" onclick="event.stopPropagation()">
      <div class="modal-title">Edit Row</div>
      <div class="fg" style="margin-bottom:14px;">
        <label>Date</label>
        <input type="date" id="bped-date" value="${row.row_date || todayStr()}">
      </div>
      ${fieldsHtml}
      <div style="display:flex;gap:8px;justify-content:space-between;border-top:1px solid var(--border);padding-top:14px;">
        <button class="bs sm" style="color:var(--red);" onclick="window._bpEngine._doDeleteRow('${rowId}')">Delete Row</button>
        <div style="display:flex;gap:8px;">
          <button class="bs" onclick="document.getElementById('bpEditRowBg').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="window._bpEngine._doSaveRow('${rowId}')">Save</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function _doSaveRow(rowId) {
  const row = _curRows.find(r => r.id === rowId);
  const p   = _curPanel;
  if (!row || !p) return;
  if (_curMembership && !_curMembership.can_edit) { toast('You do not have permission to edit rows', 'error'); return; }
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');

  // Read only manual (non-auto) fields from the DOM
  const rawValues = {};
  colFields.forEach(f => {
    if ((f.calculators || []).length > 0) return; // auto field — no input
    if (f.type === 'invoice') return; // invoice field — linked, not typed
    if (f.type === 'paired') {
      rawValues[f.id] = { text: document.getElementById(`bped-${f.id}-text`)?.value.trim() || '', num: parseFloat(document.getElementById(`bped-${f.id}-num`)?.value) || 0 };
    } else if (f.type === 'numeric') {
      rawValues[f.id] = parseFloat(document.getElementById(`bped-${f.id}`)?.value) || 0;
    } else {
      rawValues[f.id] = document.getElementById(`bped-${f.id}`)?.value.trim() || '';
    }
  });

  // Compute auto-calc column fields and merge
  const values  = computeColFields(p.fields, rawValues);
  const newDate = document.getElementById('bped-date')?.value || row.row_date;
  document.getElementById('bpEditRowBg')?.remove();
  const updated = await updateRow(rowId, values);
  if (!updated) { toast('Failed to save row changes', 'error'); return; }
  const idx = _curRows.findIndex(r => r.id === rowId);
  if (idx >= 0) { _curRows[idx].values = values; _curRows[idx].row_date = newDate; }
  toast('Row updated');
  renderPanelView(_bpEl());
}

async function _doDeleteRow(rowId) {
  if (_curMembership && !_curMembership.can_edit) { toast('You do not have permission to delete rows', 'error'); return; }
  if (!confirm('Delete this row?')) return;
  document.getElementById('bpEditRowBg')?.remove();
  await deleteRow(rowId);
  _curRows = _curRows.filter(r => r.id !== rowId);
  toast('Row deleted');
  renderPanelView(_bpEl());
}

// ─────────────────────────────────────────────────────────────────
// FIELD BUILDER (reuses calculator system from template-engine)
// ─────────────────────────────────────────────────────────────────
function openFieldBuilder() {
  const p = _curPanel;
  if (!p) return;
  const fields = p.fields || [];
  const el = document.getElementById('bs-content') || document.getElementById('content');

  let html = `<div class="page-header">
    <div>
      <button class="gh sm" onclick="window._bpEngine.openPanel('${p.id}')" style="margin-bottom:6px;">← ${esc(p.title)}</button>
      <h2 style="margin:0;">Fields — ${esc(p.title)}</h2>
    </div>
    <button class="btn btn-primary btn-sm" onclick="window._bpEngine.openAddFieldChoice()">+ Add Field</button>
  </div>

  <div class="card">
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">
      <strong style="color:var(--text);">Column fields</strong> appear as columns in the table — users enter data per row.<br>
      <strong style="color:var(--accent);">Row fields</strong> are computed outputs per row, reading across column fields.
    </div>`;

  if (!fields.length) {
    html += `<p style="color:var(--muted);font-size:14px;padding:12px 0;">No fields yet. Add column and row fields above.</p>`;
  } else {
    fields.forEach((f, idx) => {
      const calcs = f.calculators || [];
      const dirTag = f.direction === 'row'
        ? `<span style="background:rgba(99,102,241,.2);color:var(--accent);border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700;">ROW</span>`
        : `<span style="background:rgba(255,255,255,.08);color:var(--muted);border-radius:4px;padding:1px 6px;font-size:11px;">COL</span>`;
      html += `<div style="border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">${dirTag} ${esc(f.label || 'Unnamed')}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;">
              <span>Type: ${f.type === 'numeric' ? 'Number' : f.type === 'paired' ? 'Paired' : f.type === 'invoice' ? '🔗 Invoice' : 'Text'}</span>
              ${f.excludeFromAggregate ? '<span class="badge badge-yellow">Excl. Agg.</span>' : ''}
              ${f.ledgerEffect ? `<span style="color:var(--green);">Ledger: ${LEDGER_FX[f.ledgerEffect] || f.ledgerEffect}</span>` : ''}
              ${f.type === 'invoice' ? `<span style="color:#10b981;font-weight:600;">Dir: ${f.invoiceDirection === 'invoice' ? 'Invoices' : f.invoiceDirection === 'bill' ? 'Bills' : 'Both'}</span>` : ''}
              ${f.runSchedule ? `<span>⏱ ${RUN_SCHED[f.runSchedule] || f.runSchedule}</span>` : ''}
            </div>
            ${calcs.length ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
              ${calcs.map(c => {
                const op = c.operation || '';
                const sym = BP_OP_SYMBOL[op] || '';
                const isBin = BP_BINARY_OPS.includes(op);
                const fldName = id => {
                  if (!id) return '?';
                  const ff = fields.find(x => x.id === id);
                  return ff ? esc(ff.label) : '?';
                };
                let expr = '';
                if (isBin) {
                  const L = c.leftType  === 'constant' ? (c.leftConstant  ?? '0') : fldName(c.leftFieldId);
                  const R = c.rightType === 'constant' ? (c.rightConstant ?? '0') : fldName(c.rightFieldId);
                  expr = `<span style="color:var(--text);">${L}</span> <span style="font-weight:800;">${sym}</span> <span style="color:var(--text);">${R}</span>`;
                } else if (op === 'aggregate') {
                  expr = `<span style="color:var(--muted);">sum all fields</span>`;
                } else if (op === 'select_aggregate') {
                  expr = `<span style="color:var(--muted);">sum: ${(c.targetFieldIds||[]).map(fldName).join(', ') || '—'}</span>`;
                }
                return `<div style="font-size:12px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.18);border-radius:5px;padding:4px 8px;display:flex;gap:8px;align-items:center;">
                  <span style="color:var(--accent);font-weight:700;">⚡ ${esc(c.name||'?')}</span>
                  <span style="color:var(--muted);">=</span>
                  ${expr}
                  ${c.resultVisible===false?'<span style="color:var(--muted);font-size:10px;">(hidden)</span>':''}
                </div>`;
              }).join('')}
            </div>` : ''}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${idx > 0 ? `<button class="bs sm" onclick="window._bpEngine._bpMoveField(${idx},-1)">↑</button>` : ''}
            ${idx < fields.length - 1 ? `<button class="bs sm" onclick="window._bpEngine._bpMoveField(${idx},1)">↓</button>` : ''}
            <button class="bs sm" onclick="window._bpEngine._bpOpenFieldModal('${f.id}')">Edit</button>
            <button class="bs sm" style="color:var(--red);" onclick="window._bpEngine._bpDeleteField('${f.id}')">✕</button>
          </div>
        </div>
      </div>`;
    });
  }
  html += `</div>`;
  el.innerHTML = html;
}

// ── Choose direction first ────────────────────────────────────────
function openAddFieldChoice() {
  const html = `<div class="modal-bg" id="bpFieldChoiceBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:420px;" onclick="event.stopPropagation()">
      <div class="modal-title">Add Field — Choose Type</div>
      <div style="display:grid;gap:12px;margin-bottom:20px;">
        <button class="card" style="padding:20px;text-align:left;cursor:pointer;border:1px solid var(--border);background:var(--bg2);"
          onclick="document.getElementById('bpFieldChoiceBg').remove();window._bpEngine._bpOpenFieldModal(null,'column')">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px;">📊 Column Field</div>
          <div style="font-size:13px;color:var(--muted);">Adds a column to the table. Users enter data per row. Can be Text, Number, or Paired.</div>
        </button>
        <button class="card" style="padding:20px;text-align:left;cursor:pointer;border:1px solid var(--accent);background:rgba(99,102,241,.06);"
          onclick="document.getElementById('bpFieldChoiceBg').remove();window._bpEngine._bpOpenFieldModal(null,'row')">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:var(--accent);">⚡ Row Field</div>
          <div style="font-size:13px;color:var(--muted);">Computed result across columns for each row. Uses calculator logic (aggregate, formula, etc.).</div>
        </button>
        <button class="card" style="padding:20px;text-align:left;cursor:pointer;border:1px solid rgba(16,185,129,.5);background:rgba(16,185,129,.06);"
          onclick="document.getElementById('bpFieldChoiceBg').remove();window._bpEngine._bpOpenFieldModal(null,'column','invoice')">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:#10b981;">🔗 Invoice Field</div>
          <div style="font-size:13px;color:var(--muted);">Links an invoice or bill from Invoice Generator. Exposes amount, paid, outstanding for formulas.</div>
        </button>
      </div>
      <button class="bs" onclick="document.getElementById('bpFieldChoiceBg').remove()" style="width:100%;">Cancel</button>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

// ── Field modal (adapted from template-engine) ────────────────────
function _bpOpenFieldModal(fid, forceDir, forceType) {
  const p = _curPanel;
  if (!p) return;
  const f = fid ? (p.fields || []).find(x => x.id === fid) : null;
  const isNew = !f;
  _bpFldDir   = forceDir || f?.direction || 'column';
  _bpFldCalcs = f ? JSON.parse(JSON.stringify(f.calculators || [])) : [];

  // For row fields, type is always numeric. For column, offer all.
  const isRow = _bpFldDir === 'row';
  const ftype = forceType || (isRow ? 'numeric' : (f?.type || 'numeric'));
  const isInvoice = ftype === 'invoice';

  // (calcRows removed — _bpRenderCalcList() is called after modal insertion)

  const dirBanner = isInvoice
    ? `<div style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.5);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#10b981;font-weight:600;">🔗 Invoice Field — links to an invoice/bill record</div>`
    : isRow
    ? `<div style="background:rgba(99,102,241,.1);border:1px solid var(--accent);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--accent);font-weight:600;">⚡ Row Field — computed across columns per row</div>`
    : `<div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.35);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--muted);">📊 Column Field — user enters data per row</div>`;

  const html = `<div class="modal-bg" id="bpFieldModalBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:680px;max-height:90vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div class="modal-title">${isNew ? 'Add Field' : 'Edit Field'}</div>
      <input type="hidden" id="bpfl-fid" value="${esc(fid||'')}">
      ${dirBanner}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="fg"><label>Field Label *</label>
          <input id="bpfl-label" value="${esc(f?.label||'')}" placeholder="e.g. Revenue, Notes, Items"></div>
        ${isRow ? '' : isInvoice ? `<div class="fg"><label>Field Type</label>
          <input value="Invoice (Linked Record)" disabled style="opacity:.7;"></div>
          <input type="hidden" id="bpfl-type" value="invoice">` : `<div class="fg"><label>Field Type</label>
          <select id="bpfl-type" onchange="window._bpEngine._bpTypeChange(this.value)">
            <option value="numeric" ${ftype==='numeric'?'selected':''}>Number</option>
            <option value="text" ${ftype==='text'?'selected':''}>Text</option>
            <option value="paired" ${ftype==='paired'?'selected':''}>Paired (label + number)</option>
            <option value="invoice" ${ftype==='invoice'?'selected':''}>Invoice (Linked Record)</option>
          </select></div>`}
      </div>

      <!-- FIELD HINT (shown to form fillers) -->
      <div class="fg" style="margin-bottom:12px;">
        <label>Field Hint <span style="color:var(--muted);font-weight:400;">(optional — shown below the field when filling a row)</span></label>
        <input id="bpfl-hint" value="${esc(f?.hint||'')}" placeholder="e.g. Enter weight in kg, Include delivery fee, etc.">
      </div>

      <!-- INVOICE OPTIONS -->
      <div id="bpfl-panel-invoice" style="display:${ftype==='invoice'?'block':'none'}">
        <div style="padding:14px;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.3);border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">🔗 Linked Record Settings</div>
          <div class="fg" style="margin-bottom:10px;">
            <label style="font-size:12px;">Direction Filter</label>
            <select id="bpfl-inv-direction">
              <option value="both" ${(f?.invoiceDirection||'both')==='both'?'selected':''}>Both (Invoices + Bills)</option>
              <option value="invoice" ${f?.invoiceDirection==='invoice'?'selected':''}>Invoices only</option>
              <option value="bill" ${f?.invoiceDirection==='bill'?'selected':''}>Bills only</option>
            </select>
          </div>
          <p style="font-size:12px;color:var(--muted);margin:0;">This field links to existing invoices/bills from the Invoice Generator. Sub-values (<code>invoice.amount</code>, <code>invoice.paid</code>, <code>invoice.outstanding</code>) can be used in Row Field formulas.</p>
        </div>
      </div>

      <!-- TEXT OPTIONS -->
      <div id="bpfl-panel-text" style="display:${!isRow&&ftype==='text'?'block':'none'}">
        <p style="color:var(--muted);font-size:13px;margin-bottom:10px;">Text fields capture descriptive data per row.</p>
      </div>

      <!-- NUMERIC OPTIONS -->
      <div id="bpfl-panel-numeric" style="display:${isRow||ftype==='numeric'?'block':'none'}">
        ${isRow ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;padding:12px;background:rgba(0,0,0,.18);border-radius:8px;border:1px solid rgba(255,255,255,.18);">
          <div class="fg" style="margin:0;"><label style="font-size:12px;">Unit</label>
            <select id="bpfl-unittype" onchange="window._bpEngine._bpUnitTypeChange(this.value)">
              <option value="none" ${(f?.unitType||'none')==='none'?'selected':''}>None</option>
              <option value="currency" ${f?.unitType==='currency'?'selected':''}>Currency</option>
              <option value="weight" ${f?.unitType==='weight'?'selected':''}>Weight</option>
            </select></div>
          <div class="fg" id="bpfl-unit-currency" style="margin:0;display:${f?.unitType==='currency'?'':'none'};">
            <label style="font-size:12px;">Currency</label>
            <select id="bpfl-unitvalue-cur">
              ${CURRENCIES.map(c=>`<option value="${c}" ${f?.unitType==='currency'&&f?.unitValue===c?'selected':''}>${c}</option>`).join('')}
            </select></div>
          <div class="fg" id="bpfl-unit-weight" style="margin:0;display:${f?.unitType==='weight'?'':'none'};">
            <label style="font-size:12px;">Unit</label>
            <select id="bpfl-unitvalue-wt">
              ${WEIGHT_UNITS.map(u=>`<option value="${u}" ${f?.unitType==='weight'&&f?.unitValue===u?'selected':''}>${u}</option>`).join('')}
            </select></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;grid-column:1/-1;">
            <input type="checkbox" id="bpfl-excludeagg" ${f?.excludeFromAggregate?'checked':''} style="width:auto;"> Exclude from aggregate</label>
          <div class="fg" style="margin:0;"><label style="font-size:12px;">Add to Ledger</label>
            <select id="bpfl-ledger">${Object.entries(LEDGER_FX).map(([k,v])=>`<option value="${k}" ${(f?.ledgerEffect||'')===k?'selected':''}>${v}</option>`).join('')}</select>
          </div>
        </div>`}
        <div class="fg" style="margin-bottom:14px;">
          <label>Run Schedule <span style="color:var(--muted);font-weight:400;">(optional)</span></label>
          <select id="bpfl-schedule">
            ${Object.entries(RUN_SCHED).map(([k,v])=>`<option value="${k}" ${(f?.runSchedule||'')===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">⚡ Calculators</div>
          <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">Results chain — each calculator can read from previous results.</p>
          <div id="bpfl-calc-list"></div>
          <button class="bs sm" onclick="window._bpEngine._bpAddCalc()">+ Add Calculator</button>
        </div>
      </div>

      <!-- PAIRED OPTIONS -->
      <div id="bpfl-panel-paired" style="display:${!isRow&&ftype==='paired'?'block':'none'}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
          <div class="fg"><label>Text Label</label><input id="bpfl-textlabel" value="${esc(f?.textLabel||'Item')}" placeholder="Item"></div>
          <div class="fg"><label>Number Label</label><input id="bpfl-numlabel" value="${esc(f?.numericLabel||'Amount')}" placeholder="Amount"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;padding:12px;background:rgba(0,0,0,.18);border-radius:8px;border:1px solid rgba(255,255,255,.18);">
          <div class="fg" style="margin:0;"><label style="font-size:12px;">Unit</label>
            <select id="bpfl-unittype-p" onchange="window._bpEngine._bpUnitTypeChangeP(this.value)">
              <option value="none" ${(f?.unitType||'none')==='none'?'selected':''}>None</option>
              <option value="currency" ${f?.unitType==='currency'?'selected':''}>Currency</option>
              <option value="weight" ${f?.unitType==='weight'?'selected':''}>Weight</option>
            </select></div>
          <div class="fg" id="bpfl-unit-currency-p" style="margin:0;display:${f?.unitType==='currency'?'':'none'};">
            <label style="font-size:12px;">Currency</label>
            <select id="bpfl-unitvalue-cur-p">
              ${CURRENCIES.map(c=>`<option value="${c}" ${f?.unitType==='currency'&&f?.unitValue===c?'selected':''}>${c}</option>`).join('')}
            </select></div>
          <div class="fg" id="bpfl-unit-weight-p" style="margin:0;display:${f?.unitType==='weight'?'':'none'};">
            <label style="font-size:12px;">Unit</label>
            <select id="bpfl-unitvalue-wt-p">
              ${WEIGHT_UNITS.map(u=>`<option value="${u}" ${f?.unitType==='weight'&&f?.unitValue===u?'selected':''}>${u}</option>`).join('')}
            </select></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;grid-column:1/-1;">
            <input type="checkbox" id="bpfl-excludeagg-p" ${f?.excludeFromAggregate?'checked':''} style="width:auto;"> Exclude from aggregate</label>
        </div>
      </div>

      <!-- OUTPUT COLOR -->
      <div style="margin-top:14px;padding:12px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.18);border-radius:8px;">
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">🎨 Display Color</div>
        <input type="hidden" id="bpfl-color" value="${esc(f?.outputColor||'')}">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          ${BP_OUTPUT_COLORS.map(([val, bg, label]) => {
            const sel = (f?.outputColor||'') === val;
            return `<button type="button" class="bp-csw" data-color="${val}"
              onclick="window._bpEngine._bpPickColor('${val}')"
              title="${label}"
              style="width:26px;height:26px;border-radius:50%;background:${bg};border:none;cursor:pointer;position:relative;flex-shrink:0;box-shadow:${sel?'0 0 0 3px var(--text)':'none'};">
              <span class="bp-csw-chk" style="position:absolute;inset:0;display:${sel?'flex':'none'};align-items:center;justify-content:center;font-size:13px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5);">✓</span>
            </button>`;
          }).join('')}
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;border-top:1px solid var(--border);padding-top:16px;">
        <button class="bs" onclick="document.getElementById('bpFieldModalBg').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window._bpEngine._bpSaveField('${fid||''}')">Save Field</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  // Explicitly set select .value after dynamic insertion — browsers don't always
  // honour the 'selected' attribute on <option> elements in insertAdjacentHTML.
  if (f) {
    const ut = f.unitType || 'none';
    const uv = f.unitValue || '';
    const _sv = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    _sv('bpfl-type',         f.type || 'numeric');
    _sv('bpfl-unittype',     ut);
    _sv('bpfl-unittype-p',   ut);
    _sv('bpfl-unitvalue-cur',   ut === 'currency' ? uv : '');
    _sv('bpfl-unitvalue-cur-p', ut === 'currency' ? uv : '');
    _sv('bpfl-unitvalue-wt',    ut === 'weight'   ? uv : '');
    _sv('bpfl-unitvalue-wt-p',  ut === 'weight'   ? uv : '');
    _sv('bpfl-schedule',    f.runSchedule || '');
    _sv('bpfl-ledger',      f.ledgerEffect || '');
    _sv('bpfl-textlabel',   f.textLabel    || '');
    _sv('bpfl-numlabel',    f.numericLabel || '');
    _sv('bpfl-hint',        f.hint         || '');
  }

  // Render calc list with the new expression-builder UI (always — even on first open)
  _bpRenderCalcList();
}

// ── Field modal helpers ───────────────────────────────────────────
function _bpUnitTypeChange(val) {
  document.getElementById('bpfl-unit-currency').style.display = val === 'currency' ? '' : 'none';
  document.getElementById('bpfl-unit-weight').style.display   = val === 'weight'   ? '' : 'none';
}
function _bpUnitTypeChangeP(val) {
  document.getElementById('bpfl-unit-currency-p').style.display = val === 'currency' ? '' : 'none';
  document.getElementById('bpfl-unit-weight-p').style.display   = val === 'weight'   ? '' : 'none';
}
function _bpTypeChange(val) {
  ['text','numeric','paired','invoice'].forEach(t => {
    const el = document.getElementById('bpfl-panel-' + t);
    if (el) el.style.display = t === val ? 'block' : 'none';
  });
}

// Re-renders #bpfl-calc-list in-place from _bpFldCalcs (no modal close/reopen)
function _bpRenderCalcList() {
  const p = _curPanel;
  const selfFid = document.getElementById('bpfl-fid')?.value || '';

  // All column fields the user can pick as operands
  const cands = (p?.fields || []).filter(ff => ff.id !== selfFid && ff.direction !== 'row');

  const _fieldOpts = (selectedId) => {
    if (!cands.length) return '<option value="">— add column fields first —</option>';
    return '<option value="">— choose field —</option>' +
      cands.map(ff => `<option value="${ff.id}" ${selectedId===ff.id?'selected':''}>${esc(ff.label)}</option>`).join('');
  };

  const _saggChecks = (selIds) => {
    if (!cands.length) return '<p style="color:var(--muted);font-size:12px;">No column fields yet.</p>';
    return cands.map(ff => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer;">
      <input type="checkbox" class="bp-sagg-check" value="${ff.id}" ${(selIds||[]).includes(ff.id)?'checked':''}> ${esc(ff.label)}
    </label>`).join('');
  };

  const _operandPicker = (i, side, c) => {
    const type   = side === 'left' ? (c.leftType  || 'field') : (c.rightType  || 'field');
    const fldId  = side === 'left' ? (c.leftFieldId  || '')   : (c.rightFieldId  || '');
    const cstVal = side === 'left' ? (c.leftConstant || 0)    : (c.rightConstant || 0);
    const isConst = type === 'constant';
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:6px;overflow:hidden;width:fit-content;">
        <button onclick="window._bpEngine._bpSetSide(${i},'${side}','field')"
          style="padding:3px 10px;font-size:11px;font-weight:600;border:none;cursor:pointer;background:${!isConst?'var(--accent)':'var(--bg3)'};color:${!isConst?'#fff':'var(--muted)'};">
          Field</button>
        <button onclick="window._bpEngine._bpSetSide(${i},'${side}','constant')"
          style="padding:3px 10px;font-size:11px;font-weight:600;border:none;cursor:pointer;background:${isConst?'var(--accent)':'var(--bg3)'};color:${isConst?'#fff':'var(--muted)'};">
          #</button>
      </div>
      <select id="bpc${side[0]}f_${i}" style="${isConst?'display:none':''}"
        onchange="window._bpEngine._bpUpdCalc(${i},'${side}FieldId',this.value)">
        ${_fieldOpts(fldId)}
      </select>
      <input id="bpc${side[0]}c_${i}" type="number" step="any" placeholder="0"
        value="${cstVal||''}" style="${isConst?'':'display:none'}"
        oninput="window._bpEngine._bpUpdCalc(${i},'${side}Constant',parseFloat(this.value)||0)">
    </div>`;
  };

  const html = _bpFldCalcs.map((c, i) => {
    const op     = c.operation || 'subtract';
    const isBin  = BP_BINARY_OPS.includes(op);
    const isSAgg = op === 'select_aggregate';
    const sym    = BP_OP_SYMBOL[op] || '';

    return `<div style="border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:14px;margin-bottom:12px;background:var(--bg2);" id="bpfc_${i}">
      <!-- Top row: name + op + remove -->
      <div style="display:grid;grid-template-columns:1fr 200px auto;gap:10px;align-items:flex-end;margin-bottom:12px;">
        <div class="fg" style="margin:0;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Result Name *</label>
          <input value="${esc(c.name||'')}" oninput="window._bpEngine._bpUpdCalc(${i},'name',this.value)" placeholder="e.g. Profit" style="margin-top:4px;">
        </div>
        <div class="fg" style="margin:0;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Operation</label>
          <select style="margin-top:4px;" onchange="window._bpEngine._bpUpdCalc(${i},'operation',this.value);window._bpEngine._bpCalcOpChange(${i})">
            ${Object.entries(BP_CALC_OPS).map(([k,v])=>`<option value="${k}" ${op===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <button class="bs sm" style="color:var(--red);margin-bottom:1px;" onclick="window._bpEngine._bpRemCalc(${i})">✕ Remove</button>
      </div>

      <!-- Binary expression: [Left] OP [Right] -->
      <div id="bpc-expr-${i}" style="${isBin?'':'display:none'}">
        <div style="display:grid;grid-template-columns:1fr 32px 1fr;align-items:center;gap:10px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:12px;">
          <div>
            <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:6px;">LEFT</div>
            ${_operandPicker(i, 'left', c)}
          </div>
          <div style="font-size:22px;font-weight:800;color:var(--accent);text-align:center;" id="bpc-sym-${i}">${sym}</div>
          <div>
            <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:6px;">RIGHT</div>
            ${_operandPicker(i, 'right', c)}
          </div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;text-align:center;">Result = LEFT ${sym} RIGHT</div>
      </div>

      <!-- select_aggregate checkboxes -->
      <div id="bpcsagg_${i}" style="${isSAgg?'':'display:none'}">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Fields to sum:</div>
        <div style="border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:10px;background:var(--bg3);max-height:160px;overflow-y:auto;">
          ${_saggChecks(c.targetFieldIds||[])}
        </div>
      </div>

      <!-- Visibility -->
      <div class="fg" style="margin-top:12px;margin-bottom:0;">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Show result in row</label>
        <select style="margin-top:4px;" onchange="window._bpEngine._bpUpdCalc(${i},'resultVisible',this.value==='yes')">
          <option value="yes" ${c.resultVisible!==false?'selected':''}>Yes — visible column</option>
          <option value="no"  ${c.resultVisible===false?'selected':''}>No — hidden (use in next calc)</option>
        </select>
      </div>
    </div>`;
  }).join('');

  const listEl = document.getElementById('bpfl-calc-list');
  if (listEl) listEl.innerHTML = html || '<p style="color:var(--muted);font-size:13px;margin-bottom:8px;">No calculators yet.</p>';
}

function _bpAddCalc() {
  _bpFldCalcs.push({
    name:'', operation:'subtract',
    leftType:'field',  leftFieldId:'',  leftConstant:0,
    rightType:'field', rightFieldId:'', rightConstant:0,
    targetFieldIds:[], resultVisible:true
  });
  _bpRenderCalcList();
}
function _bpUpdCalc(i, key, val) { if (_bpFldCalcs[i]) _bpFldCalcs[i][key] = val; }
function _bpRemCalc(i) {
  _bpFldCalcs.splice(i, 1);
  _bpRenderCalcList();
}
function _bpCalcOpChange(i) {
  const op = _bpFldCalcs[i]?.operation || 'subtract';
  const isBin  = BP_BINARY_OPS.includes(op);
  const isSAgg = op === 'select_aggregate';
  const expr = document.getElementById('bpc-expr-' + i);
  const sagg = document.getElementById('bpcsagg_'  + i);
  const sym  = document.getElementById('bpc-sym-'  + i);
  if (expr) expr.style.display = isBin  ? '' : 'none';
  if (sagg) sagg.style.display = isSAgg ? '' : 'none';
  if (sym)  sym.textContent    = BP_OP_SYMBOL[op] || '';
}

// Toggle an operand side between Field picker and constant input
function _bpSetSide(i, side, type) {
  const c = _bpFldCalcs[i];
  if (!c) return;
  if (side === 'left')  c.leftType  = type;
  else                  c.rightType = type;
  // show/hide field select vs number input
  const letter = side[0]; // 'l' or 'r'
  const fSel = document.getElementById(`bpc${letter}f_${i}`);
  const cInp = document.getElementById(`bpc${letter}c_${i}`);
  if (fSel) fSel.style.display = type === 'field'    ? '' : 'none';
  if (cInp) cInp.style.display = type === 'constant' ? '' : 'none';
  // update the two toggle buttons' colours
  const expr = document.getElementById(`bpc-expr-${i}`);
  if (!expr) return;
  const btns = expr.querySelectorAll(`[onclick*="_bpSetSide(${i},'${side}"]`);
  btns.forEach(b => {
    const isActive = b.textContent.trim() === (type === 'field' ? 'Field' : '#');
    b.style.background = isActive ? 'var(--accent)' : 'var(--bg3)';
    b.style.color      = isActive ? '#fff'           : 'var(--muted)';
  });
}

async function _bpSaveField(fid) {
  const p = _curPanel;
  if (!p) return;
  const label = document.getElementById('bpfl-label')?.value.trim();
  if (!label) { toast('Field label required.', 'error'); return; }

  const isRow = _bpFldDir === 'row';
  const type  = isRow ? 'numeric' : (document.getElementById('bpfl-type')?.value || 'numeric');

  // Sync select_aggregate checkboxes (all other fields self-sync via oninput/onchange)
  _bpFldCalcs.forEach((c, i) => {
    if (c.operation === 'select_aggregate') {
      const row = document.getElementById('bpfc_' + i);
      if (row) c.targetFieldIds = Array.from(row.querySelectorAll('.bp-sagg-check:checked')).map(cb => cb.value);
    }
  });

  let field;
  // Read unit for numeric/paired (not for row fields — they use panel currency)
  const _readUnit = (suffix) => {
    const ut = document.getElementById('bpfl-unittype' + suffix)?.value || 'none';
    const uv = ut === 'currency' ? (document.getElementById('bpfl-unitvalue-cur' + suffix)?.value || 'USD')
             : ut === 'weight'   ? (document.getElementById('bpfl-unitvalue-wt' + suffix)?.value  || 'kg')
             : '';
    return { unitType: ut, unitValue: uv };
  };

  const outputColor = document.getElementById('bpfl-color')?.value || '';
  const hint = document.getElementById('bpfl-hint')?.value.trim() || '';

  if (type === 'invoice') {
    field = {
      id: fid || uuid(), label, type, direction: 'column',
      invoiceDirection: document.getElementById('bpfl-inv-direction')?.value || 'both',
      outputColor, hint,
      excludeFromAggregate: true,  // Invoice fields don't aggregate as simple numbers
      calculators: []
    };
  } else if (type === 'text') {
    field = { id: fid || uuid(), label, type, direction: 'column', outputColor, hint, calculators: [] };
  } else if (type === 'paired') {
    const { unitType, unitValue } = _readUnit('-p');
    field = {
      id: fid || uuid(), label, type, direction: 'column',
      textLabel: document.getElementById('bpfl-textlabel')?.value.trim() || 'Item',
      numericLabel: document.getElementById('bpfl-numlabel')?.value.trim() || 'Amount',
      excludeFromAggregate: document.getElementById('bpfl-excludeagg-p')?.checked || false,
      unitType, unitValue, outputColor, hint,
      calculators: []
    };
  } else {
    const { unitType, unitValue } = isRow ? { unitType:'none', unitValue:'' } : _readUnit('');
    field = {
      id: fid || uuid(), label, type, direction: isRow ? 'row' : 'column',
      excludeFromAggregate: document.getElementById('bpfl-excludeagg')?.checked || false,
      ledgerEffect: document.getElementById('bpfl-ledger')?.value || null,
      runSchedule: document.getElementById('bpfl-schedule')?.value || '',
      unitType, unitValue, outputColor, hint,
      calculators: _bpFldCalcs.filter(c => c.operation)
    };
  }

  const fields = p.fields || [];
  if (fid) {
    const idx = fields.findIndex(x => x.id === fid);
    if (idx >= 0) fields[idx] = field; else fields.push(field);
  } else {
    fields.push(field);
  }

  document.getElementById('bpFieldModalBg')?.remove();
  await updatePanel(p.id, { fields });
  _curPanel.fields = fields;
  toast(fid ? 'Field updated' : 'Field added');
  openFieldBuilder();
}

async function _bpMoveField(idx, dir) {
  const p = _curPanel;
  if (!p) return;
  const arr = p.fields || [];
  const target = idx + dir;
  if (target < 0 || target >= arr.length) return;
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  await updatePanel(p.id, { fields: arr });
  _curPanel.fields = arr;
  openFieldBuilder();
}

async function _bpDeleteField(fid) {
  if (!confirm('Remove this field? Existing row data for this field will remain in storage.')) return;
  const p = _curPanel;
  p.fields = (p.fields || []).filter(f => f.id !== fid);
  await updatePanel(p.id, { fields: p.fields });
  toast('Field removed');
  openFieldBuilder();
}

// ── Reset panel state (no re-render) — safe to call during context switches
function resetPanelState() {
  _curPanel      = null;
  _curRows       = [];
  _curMembership = null;
  _lastBizId     = null;
}

// ── Back to list ──────────────────────────────────────────────────
function backToList() {
  resetPanelState();
  // If inside Business Suite, navigate back to BS panels
  if (document.getElementById('bs-content') && window._bsNavigate) {
    window._bsNavigate('bs-panels');
    return;
  }
  renderBusinessPage(document.getElementById('content'));
}

// ── Members Modal ─────────────────────────────────────────────────
async function _bpDeletePanel(panelId) {
  if (!confirm('Delete this ledger and ALL its rows? This cannot be undone.')) return;
  const { error } = await deletePanel(panelId);
  if (error) { toast('Error deleting panel: ' + error.message, 'error'); return; }
  toast('Ledger deleted.', 'success');
  backToList();
}

async function openMembersModal() {
  const p = _curPanel;
  if (!p) return;
  const [members, eligibleUsers] = await Promise.all([
    listPanelMembers(p.id),
    listEligibleMembers(p.business_id, _userId)
  ]);

  // ── Members list (with inline edit permissions + remove) ──
  const memberRows = members.length ? members.map(m => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">
          ${esc((m.member?.display_name || m.member?.email || '?')[0].toUpperCase())}
        </div>
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.member?.display_name || m.member?.email || '?')}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.member?.email || '')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <label style="font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer;">
          <input type="checkbox" class="bpm-canadd" data-mid="${m.id}" ${m.can_add ? 'checked' : ''} style="width:auto;"> Add
        </label>
        <label style="font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer;">
          <input type="checkbox" class="bpm-canedit" data-mid="${m.id}" ${m.can_edit ? 'checked' : ''} style="width:auto;"> Edit
        </label>
        <button class="bs sm" style="color:var(--red);font-size:11px;padding:2px 6px;" onclick="window._bpEngine._bpmRemove('${m.id}')" title="Remove member">✕</button>
      </div>
    </div>`).join('') : '';

  // Build existing member IDs set so we can hide them from the picker
  const existingMemberUserIds = new Set(members.map(m => m.member_user_id));
  const availableUsers = eligibleUsers.filter(u => !existingMemberUserIds.has(u.id));

  const userOptions = availableUsers.length
    ? `<option value="">— Select a member —</option>` + availableUsers.map(u =>
        `<option value="${u.id}">${esc(u.display_name || u.email)} — ${esc(u.email)}</option>`).join('')
    : `<option value="">No eligible users available</option>`;

  const html = `<div class="modal-bg" id="bpMembersBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:560px;" onclick="event.stopPropagation()">
      <div class="modal-title">👥 Ledger Members — ${esc(p.title)}</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">Members can view this ledger. Control whether they can add or edit rows.</p>

      <!-- Current Members -->
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Current Members (${members.length})</div>
        <div id="bpm-list" style="background:var(--bg2);border-radius:10px;border:1px solid var(--border);overflow:hidden;">
          ${memberRows || `<p style="color:var(--muted);font-size:13px;padding:16px;text-align:center;margin:0;">No members yet. Add someone below.</p>`}
        </div>
        ${members.length > 0 ? `<div style="text-align:right;margin-top:8px;">
          <button class="btn btn-primary btn-sm" onclick="window._bpEngine._bpmSaveAll()">Save Permissions</button>
        </div>` : ''}
      </div>

      <!-- Add Member -->
      <div style="padding-top:14px;border-top:1px solid var(--border);">
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">Add Member</div>

        <!-- Option 1: Pick from business members -->
        <div style="margin-bottom:14px;">
          <label style="font-size:12px;color:var(--muted);margin-bottom:6px;display:block;">From business members:</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select id="bpm-user-pick" style="flex:1;min-width:0;">
              ${userOptions}
            </select>
            <label style="font-size:11px;display:flex;align-items:center;gap:3px;white-space:nowrap;">
              <input type="checkbox" id="bpm-canadd-pick" checked style="width:auto;"> Add rows
            </label>
            <label style="font-size:11px;display:flex;align-items:center;gap:3px;white-space:nowrap;">
              <input type="checkbox" id="bpm-canedit-pick" style="width:auto;"> Edit rows
            </label>
            <button class="btn btn-primary btn-sm" onclick="window._bpEngine._bpmAddByUserId('${p.id}')">Add</button>
          </div>
        </div>

        <!-- Option 2: By email -->
        <div style="padding-top:10px;border-top:1px solid var(--border);">
          <label style="font-size:12px;color:var(--muted);margin-bottom:6px;display:block;">Or by email:</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input id="bpm-email" placeholder="user@example.com" style="flex:1;min-width:120px;" type="email">
            <label style="font-size:11px;display:flex;align-items:center;gap:3px;white-space:nowrap;">
              <input type="checkbox" id="bpm-canadd-new" checked style="width:auto;"> Add rows
            </label>
            <label style="font-size:11px;display:flex;align-items:center;gap:3px;white-space:nowrap;">
              <input type="checkbox" id="bpm-canedit-new" style="width:auto;"> Edit rows
            </label>
            <button class="btn btn-primary btn-sm" onclick="window._bpEngine._bpmAdd('${p.id}')">Add</button>
          </div>
          <span id="bpm-msg" style="font-size:12px;color:var(--red);margin-top:6px;display:block;"></span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;border-top:1px solid var(--border);padding-top:14px;">
        <button class="bs" onclick="document.getElementById('bpMembersBg').remove()">Close</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function _bpmAddByUserId(panelId) {
  const userId  = document.getElementById('bpm-user-pick')?.value;
  const canAdd  = document.getElementById('bpm-canadd-pick')?.checked ?? true;
  const canEdit = document.getElementById('bpm-canedit-pick')?.checked ?? false;
  const msg     = document.getElementById('bpm-msg');
  if (!userId) { if (msg) { msg.textContent = 'Select a user first.'; } return; }
  const { error } = await addPanelMember(panelId, userId, { canAdd, canEdit });
  if (error) { if (msg) msg.textContent = 'Error: ' + error.message; return; }
  toast('Member added');
  document.getElementById('bpMembersBg')?.remove();
  openMembersModal();
}

async function _bpmAdd(panelId) {
  const email   = document.getElementById('bpm-email')?.value.trim();
  const canAdd  = document.getElementById('bpm-canadd-new')?.checked ?? true;
  const canEdit = document.getElementById('bpm-canedit-new')?.checked ?? false;
  const msg     = document.getElementById('bpm-msg');
  if (!email) { if (msg) msg.textContent = 'Enter an email address.'; return; }
  if (msg) msg.textContent = 'Looking up user…';
  const user = await findUserByEmail(email);
  if (!user) { if (msg) msg.textContent = 'No account found for that email.'; return; }
  if (user.id === _userId) { if (msg) msg.textContent = "That's you — you're already the owner."; return; }
  const { error } = await addPanelMember(panelId, user.id, { canAdd, canEdit });
  if (error) { if (msg) msg.textContent = 'Error: ' + error.message; return; }
  toast('Member added');
  document.getElementById('bpMembersBg')?.remove();
  openMembersModal();
}

async function _bpmRemove(memberId) {
  if (!confirm('Remove this member?')) return;
  await removePanelMember(memberId);
  toast('Member removed');
  document.getElementById('bpMembersBg')?.remove();
  openMembersModal();
}

async function _bpmSaveAll() {
  const rows = document.querySelectorAll('.bpm-canadd');
  const saves = [];
  rows.forEach(cb => {
    const mid    = cb.dataset.mid;
    const canAdd = cb.checked;
    const editCb = document.querySelector(`.bpm-canedit[data-mid="${mid}"]`);
    const canEdit = editCb?.checked ?? false;
    saves.push(updatePanelMember(mid, { canAdd, canEdit }));
  });
  await Promise.all(saves);
  toast('Permissions saved');
  document.getElementById('bpMembersBg')?.remove();
}

// ── Publish / Unpublish panel to Public DB ────────────────────────
async function togglePublicPanel(panelId, makePublic) {
  const ok = await updatePanel(panelId, { is_public: makePublic });
  if (ok) {
    toast(makePublic ? 'Ledger published to Public DB' : 'Ledger unpublished', 'success');
    // Refresh view — if inside a panel view, re-open; if BS list view, re-render
    if (_curPanel?.id === panelId) {
      openPanel(panelId);
    } else if (document.getElementById('bs-content') && window._bsNavigate) {
      window._bsNavigate('bs-panels');
    } else {
      openPanel(panelId);
    }
  } else {
    toast('Failed to update ledger visibility', 'error');
  }
}

// ── Invoice Picker Modal ─────────────────────────────────────────
// Opens a modal listing invoices/bills from the Invoice Generator
// for the user to select and link to a ledger cell.
async function openInvoicePicker(fieldId, rowId) {
  const p = _curPanel;
  if (!p) return;
  const f = (p.fields || []).find(x => x.id === fieldId);
  if (!f || f.type !== 'invoice') return;

  const bizId = _bpBusinessId();
  const dirFilter = f.invoiceDirection || 'both';

  // Build tx_type filter based on direction
  let txTypes;
  if (dirFilter === 'invoice') txTypes = ['invoice_sent', 'invoice'];
  else if (dirFilter === 'bill') txTypes = ['bill_sent', 'bill'];
  else txTypes = ['invoice_sent', 'invoice', 'bill_sent', 'bill'];

  // Fetch invoices from entries
  const { data: invoices, error } = await supabase
    .from('entries')
    .select('id, tx_type, amount, paid_amount, outstanding_amount, status, note, date, invoice_number, contact_name, currency')
    .eq('business_id', bizId)
    .in('tx_type', txTypes)
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .limit(100);

  if (error) { toast('Failed to load invoices', 'error'); return; }
  const allInvoices = invoices || [];

  // Mark which are already linked
  const linkedIds = new Set(_curCellLinks.filter(cl => cl.entry_id).map(cl => cl.entry_id));

  const html = `<div class="modal-bg" id="bpInvPickerBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:600px;max-height:85vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div class="modal-title">Link Invoice — ${esc(f.label)}</div>
      <input id="bpInvSearch" placeholder="Search by description, number, or contact…" style="margin-bottom:12px;width:100%;"
        oninput="window._bpEngine._filterInvPicker(this.value)">
      <div id="bpInvList" style="max-height:400px;overflow-y:auto;">
        ${allInvoices.length === 0 ? '<p style="color:var(--muted);text-align:center;padding:20px;">No invoices found. Create invoices in the Invoice Generator first.</p>' :
          allInvoices.map(inv => {
            const isLinked = linkedIds.has(inv.id);
            const amt = (inv.amount || 0) / 100;
            const paid = (inv.paid_amount || 0) / 100;
            const outstanding = (inv.outstanding_amount || inv.amount || 0) / 100;
            const statusColor = inv.status === 'settled' ? '#10b981' : inv.status === 'partial' ? '#f59e0b' : '#ef4444';
            const statusLabel = inv.status === 'settled' ? 'Paid' : inv.status === 'partial' ? 'Partial' : 'Open';
            const typeLabel = inv.tx_type?.includes('bill') ? 'Bill' : 'Invoice';
            return `<div class="bp-inv-item" data-search="${esc((inv.note||'')+(inv.invoice_number||'')+(inv.contact_name||'')).toLowerCase()}"
              style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:${isLinked?'default':'pointer'};opacity:${isLinked?'.5':'1'};background:var(--bg2);"
              ${isLinked ? '' : `onclick="window._bpEngine._selectInvoice('${inv.id}','${fieldId}','${rowId||''}')"`}>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(inv.note || inv.invoice_number || 'Untitled')}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(inv.contact_name || '')} · ${typeLabel} · ${inv.date || ''}</div>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-weight:700;font-size:14px;">${fmtMoney(amt, inv.currency || p.currency)}</div>
                <span style="font-size:10px;font-weight:600;color:${statusColor};background:${statusColor}15;padding:2px 6px;border-radius:4px;">${statusLabel}</span>
              </div>
              ${isLinked ? '<span style="font-size:10px;color:var(--muted);">Already linked</span>' : ''}
            </div>`;
          }).join('')}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
        <button class="bs" onclick="document.getElementById('bpInvPickerBg').remove()">Cancel</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function _filterInvPicker(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('.bp-inv-item').forEach(el => {
    el.style.display = !q || (el.dataset.search || '').includes(q) ? '' : 'none';
  });
}

async function _selectInvoice(entryId, fieldId, rowId) {
  const p = _curPanel;
  if (!p) return;
  const bizId = _bpBusinessId();

  // If rowId is provided, link directly via RPC
  if (rowId) {
    const { data, error } = await supabase.rpc('link_invoice_to_cell', {
      p_business_id: bizId,
      p_panel_id: p.id,
      p_row_id: rowId,
      p_field_id: fieldId,
      p_entry_id: entryId
    });
    if (error || data?.error) {
      toast('Link failed: ' + (error?.message || data?.error), 'error');
      return;
    }
    // Update local cache
    _curCellLinks = _curCellLinks.filter(cl => !(cl.row_id === rowId && cl.field_id === fieldId));
    _curCellLinks.push({ row_id: rowId, field_id: fieldId, entry_id: entryId, ...data });
    document.getElementById('bpInvPickerBg')?.remove();
    toast('Invoice linked');
    renderPanelView(_bpEl());
    return;
  }

  // For add-row modal: store selection in a hidden input and fetch invoice data for display
  const hiddenEl = document.getElementById(`bpr-inv-${fieldId}`);
  if (hiddenEl) hiddenEl.value = entryId;

  // Fetch the invoice entry data for display preview
  const { data: invData } = await supabase
    .from('entries')
    .select('id, amount, paid_amount, outstanding_amount, status, note, invoice_number, currency')
    .eq('id', entryId)
    .single();

  const displayEl = document.getElementById(`bpr-inv-display-${fieldId}`);
  if (displayEl && invData) {
    const amt = (invData.amount || 0) / 100;
    const statusLabel = invData.status === 'settled' ? 'Paid' : invData.status === 'partial' ? 'Partial' : 'Open';
    const statusColor = invData.status === 'settled' ? '#10b981' : invData.status === 'partial' ? '#f59e0b' : '#ef4444';
    displayEl.innerHTML = `<div style="font-weight:600;font-size:13px;">${esc(invData.note || invData.invoice_number || 'Invoice')}</div>
      <div style="font-size:12px;margin-top:2px;">${fmtMoney(amt, p.currency)} <span style="color:${statusColor};font-weight:600;">${statusLabel}</span></div>`;
    displayEl.style.border = '1px solid rgba(16,185,129,.4)';
    displayEl.style.textAlign = 'left';
    displayEl.style.cursor = 'pointer';
  }
  document.getElementById('bpInvPickerBg')?.remove();
}

// Get cell link data for a specific cell
function _getCellLink(rowId, fieldId) {
  return _curCellLinks.find(cl => cl.row_id === rowId && cl.field_id === fieldId);
}

// Invoice sub-value resolution is handled directly in _resolveOperand()
// via the 'invoice_sub' type and rowId-based cell link lookups.

// ── Expose to window ──────────────────────────────────────────────
export function exposeBpEngine() {
  window._bpEngine = {
    renderBusinessPage,
    openCreateModal, _doCreate,
    openEditPanelModal, _doEditPanel,
    openPanel, backToList, resetPanelState,
    get currentPanelId() { return _curPanel?.id || null; },
    get _lastBizId() { return _lastBizId; },
    openFieldBuilder, openAddFieldChoice,
    _bpOpenFieldModal, _bpTypeChange, _bpUnitTypeChange, _bpUnitTypeChangeP, _bpRenderCalcList, _bpAddCalc, _bpUpdCalc, _bpRemCalc, _bpCalcOpChange, _bpSetSide, _bpPickColor, _bpSaveField,
    _bpMoveField, _bpDeleteField,
    openAddRowModal, _recomputeColPreview, _previewRow, _doAddRow,
    openEditRowModal, _doSaveRow, _doDeleteRow,
    toggleFoldedSession, archiveSession,
    openArchiveView,
    openMembersModal, _bpmAdd, _bpmAddByUserId, _bpmRemove, _bpmSaveAll,
    _bpDeletePanel,
    togglePublicPanel,
    filterPublicPanels, previewPublicPanel, copyPublicPanel,
    // Invoice field
    openInvoicePicker, _filterInvPicker, _selectInvoice
  };
}
