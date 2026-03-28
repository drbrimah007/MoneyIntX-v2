// Money IntX v2 — Business Panel Engine
// Reuses calculator system from template-engine.js
import { supabase } from './supabase.js';
import { CALC_OPS, _isNumericField, _isPairedField, _isCalcField } from './template-engine.js';
import {
  listPanels, getPanel, createPanel, updatePanel, deletePanel,
  listRows, addRow, updateRow, deleteRow,
  archiveSessionRows, listArchivedRows
} from './business-panels.js';

// ── Constants ─────────────────────────────────────────────────────
const CURRENCIES = ['USD','EUR','GBP','CAD','AUD','JPY','CHF','NGN','GHS','ZAR','INR','CNY'];
const LEDGER_FX  = { '':'None (no ledger)', toy:'They Owe Me (adds)', toy_credit:'They Owe Me credit (reduces)', yot:'I Owe Them (adds)', yot_credit:'I Owe Them credit (reduces)' };
const RUN_SCHED  = { '':'None', weekly:'Run Weekly', monthly:'Run Monthly', custom:'Run Every…' };

// ── Helpers ───────────────────────────────────────────────────────
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'f' + Math.random().toString(36).slice(2, 14); }

function fmtMoney(n, cur) {
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency:cur||'USD', minimumFractionDigits:2, maximumFractionDigits:2 }).format(n||0); }
  catch(e) { return `${cur||'USD'} ${(n||0).toFixed(2)}`; }
}

const WEIGHT_UNITS = ['kg','lbs','g','oz','t','lb','ton'];

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
function _resolveOperand(type, fieldId, constant, colValues) {
  if (type === 'constant') return parseFloat(constant) || 0;
  const v = colValues[fieldId];
  return typeof v === 'object' ? (parseFloat(v?.num) || 0) : (parseFloat(v) || 0);
}

function computeRowFields(fields, rowValues) {
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
          const L = _resolveOperand(calc.leftType  || 'field', calc.leftFieldId,  calc.leftConstant,  colValues);
          const R = _resolveOperand(calc.rightType || 'field', calc.rightFieldId, calc.rightConstant, colValues);
          val = op === 'add'      ? L + R
              : op === 'subtract' ? L - R
              : op === 'multiply' ? L * R
              : R !== 0 ? L / R : 0;
        } else {
          // Legacy single-target format (backward compat)
          if (op === 'multiply') val = (_resolveOperand('field', calc.targetFieldId, 0, colValues)) * (parseFloat(calc.operand) || 1);
          else if (op === 'add')      val += _resolveOperand('field', calc.targetFieldId, 0, colValues);
          else if (op === 'subtract') val -= _resolveOperand('field', calc.targetFieldId, 0, colValues);
        }
      } else if (op === 'aggregate') {
        val = fields.filter(ff => ff.direction !== 'row' && !ff.excludeFromAggregate && ff.id !== f.id)
                    .reduce((s, ff) => s + _resolveOperand('field', ff.id, 0, colValues), 0);
      } else if (op === 'select_aggregate') {
        val = (calc.targetFieldIds || [])
          .reduce((s, fid) => s + _resolveOperand('field', fid, 0, colValues), 0);
      }
      if (calc.resultVisible !== false) colValues[f.id] = val;
    });
    result[f.id] = val;
  });
  return result;
}

function computeSessionPnL(fields, rows) {
  const rowFields = fields.filter(f => f.direction === 'row' && (f.calculators || []).length > 0);
  if (!rowFields.length) return null;
  let total = 0;
  rows.forEach(row => {
    const computed = computeRowFields(fields, row.values || {});
    rowFields.forEach(f => { total += computed[f.id] || 0; });
  });
  return total;
}

// ── State ──────────────────────────────────────────────────────────
let _userId = null;
let _navFn  = null;
let _toastFn = null;
let _curPanel = null;
let _curRows  = [];
let _bpFldCalcs = [];
let _bpFldDir   = 'column';

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

  // ── Check if table exists ──────────────────────────────────────
  const { error: chkErr } = await supabase.from('business_panels').select('id').limit(1);
  const _tableOk = !chkErr || (!chkErr.message?.includes('does not exist') && !chkErr.message?.includes('Could not find') && chkErr.code !== '42P01' && chkErr.code !== 'PGRST200' && chkErr.code !== 'PGRST116' && chkErr.code !== '404');
  if (!_tableOk) {
    el.innerHTML = `<div class="page-header"><h2 style="margin:0;">Business Panels</h2></div>
    <div class="card" style="border:1px solid var(--amber);background:rgba(251,191,36,.07);">
      <div style="font-size:20px;margin-bottom:8px;">⚙️ One-time setup required</div>
      <p style="font-size:14px;color:var(--muted);margin-bottom:16px;">
        The Business Panel tables don't exist in your database yet.<br>
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

  const panels = await listPanels(_userId);

  let html = `<div class="page-header">
    <h2 style="margin:0;">Business Panels</h2>
    <button class="btn btn-primary btn-sm" onclick="window._bpEngine.openCreateModal()">+ New Panel</button>
  </div>`;

  if (!panels.length) {
    html += `<div class="card" style="text-align:center;padding:48px 24px;">
      <div style="font-size:48px;margin-bottom:12px;">📊</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px;">No business panels yet</div>
      <p style="color:var(--muted);margin-bottom:20px;font-size:14px;">Create a panel to track income, expenses, and sessions.</p>
      <button class="btn btn-primary" onclick="window._bpEngine.openCreateModal()">Create Your First Panel</button>
    </div>`;
  } else {
    html += `<div style="display:grid;gap:12px;">`;
    panels.forEach(p => {
      html += `<div class="card" style="cursor:pointer;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;"
        onclick="window._bpEngine.openPanel('${p.id}')">
        <div>
          <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${esc(p.title)}</div>
          <div style="font-size:12px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;">
            <span>${p.currency}</span>
            <span>·</span>
            <span>${p.session_type === 'weekly' ? '📅 Weekly sessions' : '📆 Monthly sessions'}</span>
            <span>·</span>
            <span>${(p.fields||[]).length} field${(p.fields||[]).length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <span style="font-size:22px;color:var(--muted);">›</span>
      </div>`;
    });
    html += `</div>`;
  }

  el.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────
// CREATE PANEL MODAL
// ─────────────────────────────────────────────────────────────────
function openCreateModal() {
  const curOpts = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
  const html = `<div class="modal-bg" id="bpCreateBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:500px;" onclick="event.stopPropagation()">
      <div class="modal-title">New Business Panel</div>
      <div class="fg" style="margin-bottom:12px;">
        <label>Panel Title *</label>
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
      <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;">
        <button class="bs" onclick="document.getElementById('bpCreateBg').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window._bpEngine._doCreate()">Create Panel →</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function _doCreate() {
  const title = document.getElementById('bp-title')?.value.trim();
  const currency = document.getElementById('bp-currency')?.value || 'USD';
  const session_type = document.getElementById('bp-sestype')?.value || 'monthly';
  if (!title) { toast('Panel title required.', 'error'); return; }
  document.getElementById('bpCreateBg')?.remove();
  const { data: panel, error } = await createPanel(_userId, { title, currency, session_type });
  if (error || !panel) {
    const msg = error?.message || 'Unknown error';
    toast(`Failed to create panel: ${msg}`, 'error');
    console.error('[_doCreate] userId:', _userId, 'error:', error);
    return;
  }
  toast('Panel created');
  openPanel(panel.id);
}

// ─────────────────────────────────────────────────────────────────
// PANEL VIEW
// ─────────────────────────────────────────────────────────────────
async function openPanel(panelId) {
  const el = document.getElementById('content');
  el.innerHTML = '<p style="color:var(--muted);padding:24px;">Loading…</p>';
  const [panel, rows] = await Promise.all([
    getPanel(panelId),
    listRows(panelId)
  ]);
  if (!panel) { toast('Panel not found.', 'error'); return; }
  _curPanel = panel;
  _curRows  = rows;
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

  let html = `<div class="page-header">
    <div>
      <button class="gh sm" onclick="window._bpEngine.backToList()" style="margin-bottom:6px;">← Business Panels</button>
      <h2 style="margin:0;">${esc(p.title)}</h2>
      <div style="font-size:12px;color:var(--muted);margin-top:3px;">${p.currency} · ${p.session_type === 'weekly' ? 'Weekly' : 'Monthly'} sessions</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="bs sm" onclick="window._bpEngine.openFieldBuilder()">⚙ Fields</button>
      <button class="bs sm" onclick="window._bpEngine.openArchiveView('${p.id}')">🗂 Archive</button>
      <button class="btn btn-primary btn-sm" onclick="window._bpEngine.openAddRowModal('${todayKey}')">+ Add Row</button>
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

  if (!rows.length) {
    html += `<div style="text-align:center;padding:32px;color:var(--muted);font-size:14px;">No entries yet. Add your first row above.</div>`;
  } else {
    // Table
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

    rows.forEach(row => {
      const computed = computeRowFields(p.fields, row.values || {});
      html += `<tr>
        <td style="font-size:12px;color:var(--muted);">${fmtDate(row.row_date)}</td>`;
      colFields.forEach(f => {
        const raw = row.values?.[f.id] ?? '';
        if (f.type === 'numeric' || f.type === 'paired') {
          const fv = fmtFieldVal(raw, f, currency);
          html += `<td style="font-weight:600;">${fv !== null ? fv : '<span style="color:var(--muted);">—</span>'}</td>`;
        } else {
          html += `<td style="font-size:13px;">${esc(raw)}</td>`;
        }
      });
      rowFields.forEach(f => {
        const val = computed[f.id];
        html += `<td style="font-weight:700;color:var(--accent);">${val !== undefined ? fmtMoney(val, currency) : '—'}</td>`;
      });
      html += `<td style="text-align:right;">
        <button class="bs sm" onclick="window._bpEngine.openEditRowModal('${row.id}')" style="font-size:11px;padding:3px 8px;">Edit</button>
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
    const computed = computeRowFields(p.fields, row.values || {});
    html += `<tr><td style="font-size:12px;color:var(--muted);">${fmtDate(row.row_date)}</td>`;
    colFields.forEach(f => {
      const raw = row.values?.[f.id] ?? '';
      if (f.type === 'numeric' || f.type === 'paired') {
        const fv = fmtFieldVal(raw, f, currency);
        html += `<td style="font-weight:600;">${fv !== null ? fv : '<span style="color:var(--muted);">—</span>'}</td>`;
      } else {
        html += `<td style="font-size:13px;">${esc(raw)}</td>`;
      }
    });
    rowFields.forEach(f => {
      const val = computed[f.id];
      html += `<td style="font-weight:700;color:var(--accent);">${val !== undefined ? fmtMoney(val, currency) : '—'}</td>`;
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
  const el = document.getElementById('content');
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

  let fieldsHtml = '';
  colFields.forEach(f => {
    if (f.type === 'text') {
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}</label>
        <input id="bpr-${f.id}" placeholder="${esc(f.label)}"></div>`;
    } else if (f.type === 'numeric') {
      const _uh = f.unitType === 'currency' ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||p.currency})</span>`
                : f.unitType === 'weight'   ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||'kg'})</span>` : '';
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}${_uh}</label>
        <input type="number" id="bpr-${f.id}" step="0.01" placeholder="0.00" oninput="window._bpEngine._previewRow()"></div>`;
    } else if (f.type === 'paired') {
      const _uh = f.unitType === 'currency' ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||p.currency})</span>`
                : f.unitType === 'weight'   ? ` <span style="color:var(--muted);font-weight:400;">(${f.unitValue||'kg'})</span>` : '';
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}${_uh}</label>
        <div style="display:flex;gap:8px;">
          <input id="bpr-${f.id}-text" placeholder="${esc(f.textLabel || 'Item')}" style="flex:2;">
          <input type="number" id="bpr-${f.id}-num" step="0.01" placeholder="0.00" style="flex:1;" oninput="window._bpEngine._previewRow()">
        </div></div>`;
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
      ${hasRowFields ? `<div id="bpr-preview" style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px;font-size:13px;display:none;">
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
  if (hasRowFields) setTimeout(() => _previewRow(), 50);
}

function _previewRow() {
  const p = _curPanel;
  if (!p) return;
  const rowFields = (p.fields || []).filter(f => f.direction === 'row' && (f.calculators||[]).length);
  if (!rowFields.length) return;

  const colFields = (p.fields || []).filter(f => f.direction !== 'row');
  const vals = {};
  colFields.forEach(f => {
    if (f.type === 'paired') {
      vals[f.id] = parseFloat(document.getElementById(`bpr-${f.id}-num`)?.value) || 0;
    } else {
      vals[f.id] = parseFloat(document.getElementById(`bpr-${f.id}`)?.value) || 0;
    }
  });
  const computed = computeRowFields(p.fields, vals);
  const preview = document.getElementById('bpr-preview');
  if (preview) preview.style.display = '';
  rowFields.forEach(f => {
    const el = document.getElementById(`bpr-preview-${f.id}`);
    if (el) el.textContent = computed[f.id] !== undefined ? fmtMoney(computed[f.id], p.currency) : '—';
  });
}

async function _doAddRow(sessionKey) {
  const p = _curPanel;
  if (!p) return;
  const rowDate = document.getElementById('bpr-date')?.value || todayStr();
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');
  const values = {};
  colFields.forEach(f => {
    if (f.type === 'paired') {
      values[f.id] = {
        text: document.getElementById(`bpr-${f.id}-text`)?.value.trim() || '',
        num: parseFloat(document.getElementById(`bpr-${f.id}-num`)?.value) || 0
      };
    } else if (f.type === 'numeric') {
      values[f.id] = parseFloat(document.getElementById(`bpr-${f.id}`)?.value) || 0;
    } else {
      values[f.id] = document.getElementById(`bpr-${f.id}`)?.value.trim() || '';
    }
  });

  document.getElementById('bpAddRowBg')?.remove();
  const row = await addRow(p.id, _userId, sessionKey, rowDate, values);
  if (!row) { toast('Failed to save row.', 'error'); return; }
  toast('Row added');
  _curRows.push(row);
  renderPanelView(document.getElementById('content'));
}

// ── Edit row modal ────────────────────────────────────────────────
async function openEditRowModal(rowId) {
  const row = _curRows.find(r => r.id === rowId);
  if (!row || !_curPanel) return;
  const p = _curPanel;
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');

  let fieldsHtml = '';
  colFields.forEach(f => {
    const val = row.values?.[f.id];
    if (f.type === 'text') {
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}</label>
        <input id="bped-${f.id}" value="${esc(val || '')}"></div>`;
    } else if (f.type === 'numeric') {
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}</label>
        <input type="number" id="bped-${f.id}" step="0.01" value="${val !== undefined ? val : ''}"></div>`;
    } else if (f.type === 'paired') {
      const tv = typeof val === 'object' ? val : {};
      fieldsHtml += `<div class="fg" style="margin-bottom:12px;"><label>${esc(f.label)}</label>
        <div style="display:flex;gap:8px;">
          <input id="bped-${f.id}-text" value="${esc(tv.text || '')}" placeholder="${esc(f.textLabel || 'Item')}" style="flex:2;">
          <input type="number" id="bped-${f.id}-num" step="0.01" value="${tv.num || ''}" placeholder="0.00" style="flex:1;">
        </div></div>`;
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
  const p = _curPanel;
  if (!row || !p) return;
  const colFields = (p.fields || []).filter(f => f.direction !== 'row');
  const values = {};
  colFields.forEach(f => {
    if (f.type === 'paired') {
      values[f.id] = { text: document.getElementById(`bped-${f.id}-text`)?.value.trim() || '', num: parseFloat(document.getElementById(`bped-${f.id}-num`)?.value) || 0 };
    } else if (f.type === 'numeric') {
      values[f.id] = parseFloat(document.getElementById(`bped-${f.id}`)?.value) || 0;
    } else {
      values[f.id] = document.getElementById(`bped-${f.id}`)?.value.trim() || '';
    }
  });

  const newDate = document.getElementById('bped-date')?.value || row.row_date;
  document.getElementById('bpEditRowBg')?.remove();
  await updateRow(rowId, values);
  const idx = _curRows.findIndex(r => r.id === rowId);
  if (idx >= 0) { _curRows[idx].values = values; _curRows[idx].row_date = newDate; }
  toast('Row updated');
  renderPanelView(document.getElementById('content'));
}

async function _doDeleteRow(rowId) {
  if (!confirm('Delete this row?')) return;
  document.getElementById('bpEditRowBg')?.remove();
  await deleteRow(rowId);
  _curRows = _curRows.filter(r => r.id !== rowId);
  toast('Row deleted');
  renderPanelView(document.getElementById('content'));
}

// ─────────────────────────────────────────────────────────────────
// FIELD BUILDER (reuses calculator system from template-engine)
// ─────────────────────────────────────────────────────────────────
function openFieldBuilder() {
  const p = _curPanel;
  if (!p) return;
  const fields = p.fields || [];
  const el = document.getElementById('content');

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
      html += `<div style="border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">${dirTag} ${esc(f.label || 'Unnamed')}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;">
              <span>Type: ${f.type === 'numeric' ? 'Number' : f.type === 'paired' ? 'Paired' : 'Text'}</span>
              ${f.excludeFromAggregate ? '<span class="badge badge-yellow">Excl. Agg.</span>' : ''}
              ${f.ledgerEffect ? `<span style="color:var(--green);">Ledger: ${LEDGER_FX[f.ledgerEffect] || f.ledgerEffect}</span>` : ''}
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
      </div>
      <button class="bs" onclick="document.getElementById('bpFieldChoiceBg').remove()" style="width:100%;">Cancel</button>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

// ── Field modal (adapted from template-engine) ────────────────────
function _bpOpenFieldModal(fid, forceDir) {
  const p = _curPanel;
  if (!p) return;
  const f = fid ? (p.fields || []).find(x => x.id === fid) : null;
  const isNew = !f;
  _bpFldDir   = forceDir || f?.direction || 'column';
  _bpFldCalcs = f ? JSON.parse(JSON.stringify(f.calculators || [])) : [];

  // For row fields, type is always numeric. For column, offer all.
  const isRow = _bpFldDir === 'row';
  const ftype = isRow ? 'numeric' : (f?.type || 'numeric');

  // (calcRows removed — _bpRenderCalcList() is called after modal insertion)

  const dirBanner = isRow
    ? `<div style="background:rgba(99,102,241,.1);border:1px solid var(--accent);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--accent);font-weight:600;">⚡ Row Field — computed across columns per row</div>`
    : `<div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--muted);">📊 Column Field — user enters data per row</div>`;

  const html = `<div class="modal-bg" id="bpFieldModalBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:680px;max-height:90vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div class="modal-title">${isNew ? 'Add Field' : 'Edit Field'}</div>
      <input type="hidden" id="bpfl-fid" value="${esc(fid||'')}">
      ${dirBanner}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="fg"><label>Field Label *</label>
          <input id="bpfl-label" value="${esc(f?.label||'')}" placeholder="e.g. Revenue, Notes, Items"></div>
        ${isRow ? '' : `<div class="fg"><label>Field Type</label>
          <select id="bpfl-type" onchange="window._bpEngine._bpTypeChange(this.value)">
            <option value="numeric" ${ftype==='numeric'?'selected':''}>Number</option>
            <option value="text" ${ftype==='text'?'selected':''}>Text</option>
            <option value="paired" ${ftype==='paired'?'selected':''}>Paired (label + number)</option>
          </select></div>`}
      </div>

      <!-- TEXT OPTIONS -->
      <div id="bpfl-panel-text" style="display:${!isRow&&ftype==='text'?'block':'none'}">
        <p style="color:var(--muted);font-size:13px;margin-bottom:10px;">Text fields capture descriptive data per row.</p>
      </div>

      <!-- NUMERIC OPTIONS -->
      <div id="bpfl-panel-numeric" style="display:${isRow||ftype==='numeric'?'block':'none'}">
        ${isRow ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
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
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
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

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;border-top:1px solid var(--border);padding-top:16px;">
        <button class="bs" onclick="document.getElementById('bpFieldModalBg').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window._bpEngine._bpSaveField('${fid||''}')">Save Field</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
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
  ['text','numeric','paired'].forEach(t => {
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

    return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px;background:var(--bg2);" id="bpfc_${i}">
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
        <div style="display:grid;grid-template-columns:1fr 32px 1fr;align-items:center;gap:10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;">
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
        <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg3);max-height:160px;overflow-y:auto;">
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

  if (type === 'text') {
    field = { id: fid || uuid(), label, type, direction: 'column', calculators: [] };
  } else if (type === 'paired') {
    const { unitType, unitValue } = _readUnit('-p');
    field = {
      id: fid || uuid(), label, type, direction: 'column',
      textLabel: document.getElementById('bpfl-textlabel')?.value.trim() || 'Item',
      numericLabel: document.getElementById('bpfl-numlabel')?.value.trim() || 'Amount',
      excludeFromAggregate: document.getElementById('bpfl-excludeagg-p')?.checked || false,
      unitType, unitValue,
      calculators: []
    };
  } else {
    const { unitType, unitValue } = isRow ? { unitType:'none', unitValue:'' } : _readUnit('');
    field = {
      id: fid || uuid(), label, type, direction: isRow ? 'row' : 'column',
      excludeFromAggregate: document.getElementById('bpfl-excludeagg')?.checked || false,
      ledgerEffect: document.getElementById('bpfl-ledger')?.value || null,
      runSchedule: document.getElementById('bpfl-schedule')?.value || '',
      unitType, unitValue,
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

// ── Back to list ──────────────────────────────────────────────────
function backToList() {
  _curPanel = null;
  _curRows  = [];
  renderBusinessPage(document.getElementById('content'));
}

// ── Expose to window ──────────────────────────────────────────────
export function exposeBpEngine() {
  window._bpEngine = {
    renderBusinessPage,
    openCreateModal, _doCreate,
    openPanel, backToList,
    openFieldBuilder, openAddFieldChoice,
    _bpOpenFieldModal, _bpTypeChange, _bpUnitTypeChange, _bpUnitTypeChangeP, _bpRenderCalcList, _bpAddCalc, _bpUpdCalc, _bpRemCalc, _bpCalcOpChange, _bpSetSide, _bpSaveField,
    _bpMoveField, _bpDeleteField,
    openAddRowModal, _previewRow, _doAddRow,
    openEditRowModal, _doSaveRow, _doDeleteRow,
    toggleFoldedSession, archiveSession,
    openArchiveView
  };
}
