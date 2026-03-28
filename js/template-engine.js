// Money IntX v2 — Template Engine (ported from v1)
// Full template builder, field editor modal, calculator engine
import { supabase } from './supabase.js';

// ── Constants ─────────────────────────────────────────────────────
export const FIELD_TYPES = { paired:'Item + Amount (Paired rows)', numeric:'Numeric / Calculated', text:'Text / Notes' };
export const CALC_OPS = { multiply:'Multiply by factor', add:'Add to field', subtract:'Subtract from field', aggregate:'Run aggregate (sum all)', select_aggregate:'Selection aggregate (pick fields)' };
export const LEDGER_FX = { '':'No ledger effect', toy:'They Owe (adds to balance)', toy_credit:'They Owe credit (reduces balance)', yot:'I Owe (adds to balance)', yot_credit:'I Owe credit (reduces balance)' };

// ── Type helpers ──────────────────────────────────────────────────
export function _isPairedField(f) { return f?.type === 'paired'; }
export function _isNumericField(f) { return f?.type === 'numeric' || f?.type === 'number' || f?.type === 'currency'; }
export function _isTextField(f) { return f?.type === 'text' || f?.type === 'textarea' || f?.type === 'date'; }
export function _isCalcField(f) { return _isNumericField(f) || _isPairedField(f) || (f?.calculators||[]).length > 0; }

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'f' + Math.random().toString(36).substr(2, 12); }

// ── Supabase helpers ──────────────────────────────────────────────
async function loadTemplate(tid) {
  const { data } = await supabase.from('templates').select('*').eq('id', tid).single();
  return data;
}

async function saveTemplate(tid, updates) {
  await supabase.from('templates').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', tid);
}

async function createNewTemplate(userId, meta) {
  const { data } = await supabase.from('templates').insert({
    user_id: userId, name: meta.name, description: meta.desc || '',
    tx_type: meta.txType || 'invoice', fields: [],
    invoice_prefix: meta.invoicePrefix || 'INV-',
    invoice_next_num: meta.invoiceNextNum || 1
  }).select().single();
  return data;
}

// ── State ─────────────────────────────────────────────────────────
let _editTid = null;
let _fldCalcs = [];
let _currentTpl = null;
let _userId = null;
let _renderCallback = null;
let _toastFn = null;

export function initEngine(userId, renderCb, toastCb) {
  _userId = userId;
  _renderCallback = renderCb;
  _toastFn = toastCb;
}

function toast(msg) { if (_toastFn) _toastFn(msg); }

// ── Template Builder Page ─────────────────────────────────────────
export async function openTemplateBuilder(tid, contentEl) {
  _editTid = tid || null;
  if (tid) {
    _currentTpl = await loadTemplate(tid);
  } else {
    _currentTpl = { id: null, name: '', description: '', fields: [], tx_type: 'invoice', invoice_prefix: 'INV-', invoice_next_num: 1 };
  }
  if (!_currentTpl) return;
  renderTemplateBuilder(_currentTpl, contentEl);
}

function renderTemplateBuilder(t, contentEl) {
  const el = contentEl || document.getElementById('content');
  const isNew = !t.id;
  const fields = t.fields || [];

  let html = `<div class="page-header">
    <div>
      <button class="gh sm" onclick="app.navigate('templates')" style="margin-bottom:6px;">← Back to Templates</button>
      <h2>${isNew ? 'New Template' : 'Edit: ' + esc(t.name)}</h2>
    </div>
    ${!isNew ? `<button class="btn sm" onclick="window._tplEngine.saveMeta()">Save Template</button>` : ''}
  </div>

  <div class="card" style="margin-bottom:16px;">
    <div class="section-title">Template Info</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="fg"><label>Template Name *</label><input id="tplname" value="${esc(t.name)}" placeholder="e.g. Service Invoice"></div>
      <div class="fg"><label>Description</label><input id="tpldesc" value="${esc(t.description || '')}" placeholder="Optional description"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px;">
      <div class="fg">
        <label>Transaction Type</label>
        <select id="tpltxtype">
          <option value="invoice" ${(t.tx_type||'invoice')==='invoice'?'selected':''}>Invoice — they owe you</option>
          <option value="bill" ${t.tx_type==='bill'?'selected':''}>Bill — they owe you</option>
          <option value="they_owe_you" ${t.tx_type==='they_owe_you'?'selected':''}>They Owe Me</option>
          <option value="they_paid_you" ${t.tx_type==='they_paid_you'?'selected':''}>They Settled Me</option>
          <option value="you_owe_them" ${t.tx_type==='you_owe_them'?'selected':''}>I Owe Them</option>
          <option value="you_paid_them" ${t.tx_type==='you_paid_them'?'selected':''}>I Settled Them</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px;">
      <div class="fg">
        <label>Document Number Prefix</label>
        <input id="tplprefix" value="${esc(t.invoice_prefix||'INV-')}" placeholder="INV-">
      </div>
      <div class="fg">
        <label>Starting Number</label>
        <input type="number" id="tplstartnum" value="${t.invoice_next_num||1}" min="1" step="1">
      </div>
    </div>
    ${isNew
      ? `<button class="btn sm" style="margin-top:8px;" onclick="window._tplEngine.createAndContinue()">Create & Add Fields →</button>`
      : `<button class="bs sm" style="margin-top:8px;" onclick="window._tplEngine.saveMeta()">Save Info</button>`
    }
  </div>`;

  if (!isNew) {
    html += `<div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="section-title" style="margin:0;border:0;padding:0;">Fields (${fields.length})</div>
        <button class="btn sm" onclick="window._tplEngine.openFieldModal()">+ Add Field</button>
      </div>`;

    // Validation banners
    const hasComputed = fields.some(f => (f.calculators||[]).length > 0);
    const finalTotals = fields.filter(f => f.isFinalTotal);
    if (hasComputed && finalTotals.length === 0) {
      html += `<div style="background:rgba(251,191,36,.1);border:1px solid var(--amber);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;">
        <strong style="color:var(--amber);">⚠️ No Final Total field set.</strong> This template has computed fields but none is marked as the Final Total. Open a computed field and check Final Total.
      </div>`;
    }
    if (finalTotals.length > 1) {
      html += `<div style="background:rgba(248,113,113,.1);border:1px solid var(--red);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;">
        <strong style="color:var(--red);">⚠️ Multiple Final Total fields.</strong> Only one field should be marked as Final Total.
      </div>`;
    }

    if (fields.length === 0) {
      html += `<p style="color:var(--muted);font-size:14px;padding:12px 0;">No fields yet. Add fields to define what this template captures.</p>`;
    } else {
      fields.forEach((f, idx) => {
        const calcs = (f.calculators||[]);
        html += `<div style="border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:10px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div style="flex:1;">
              <div style="font-weight:700;font-size:15px;">${esc(f.label||'Unnamed')}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;">
                <span>Type: ${_isPairedField(f) ? 'Paired' : _isNumericField(f) ? 'Numeric' : 'Text'}</span>
                ${_isPairedField(f) ? `<span style="color:var(--accent);">${esc(f.textLabel||'Item')} + ${esc(f.numericLabel||'Amount')}${f.repeatable!==false?' · Repeatable':''}</span>` : ''}
                ${f.ledgerEffect?`<span style="color:var(--green);">Ledger: ${LEDGER_FX[f.ledgerEffect]||f.ledgerEffect}</span>`:''}
                ${f.excludeFromAggregate?`<span class="badge badge-yellow">Excl. Agg.</span>`:''}
                ${f.isFinalTotal?`<span class="badge" style="background:rgba(74,222,128,.18);color:var(--green);border:1px solid var(--green);">★ Final Total</span>`:''}
                ${f.visible===false?`<span class="badge badge-gray">Hidden</span>`:''}
              </div>
              ${calcs.length>0?`<div style="margin-top:6px;font-size:12px;color:var(--accent);">Calculators: ${calcs.map(c => esc(c.name||c.operation)).join(', ')}</div>`:''}
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              ${idx>0?`<button class="bs sm" onclick="window._tplEngine.moveField(${idx},-1)">↑</button>`:''}
              ${idx<fields.length-1?`<button class="bs sm" onclick="window._tplEngine.moveField(${idx},1)">↓</button>`:''}
              <button class="bs sm" onclick="window._tplEngine.openFieldModal('${f.id}')">Edit</button>
              <button class="bs sm" style="color:var(--red);" onclick="window._tplEngine.deleteField('${f.id}')">✕</button>
            </div>
          </div>
        </div>`;
      });
    }
    html += `</div>`;
  }

  el.innerHTML = html;
}

// ── Read meta fields from DOM ─────────────────────────────────────
function _readMeta() {
  return {
    name: (document.getElementById('tplname')?.value||'').trim(),
    desc: (document.getElementById('tpldesc')?.value||'').trim(),
    txType: document.getElementById('tpltxtype')?.value || 'invoice',
    invoicePrefix: (document.getElementById('tplprefix')?.value||'INV-').trim(),
    invoiceNextNum: parseInt(document.getElementById('tplstartnum')?.value||'1') || 1,
  };
}

// ── Create template and continue to fields ────────────────────────
async function createAndContinue() {
  const meta = _readMeta();
  if (!meta.name) { alert('Template name required'); return; }
  const t = await createNewTemplate(_userId, meta);
  if (!t) return;
  _editTid = t.id;
  _currentTpl = t;
  toast('Template created');
  renderTemplateBuilder(t);
}

// ── Save template meta ────────────────────────────────────────────
async function saveMeta() {
  if (!_editTid || !_currentTpl) return;
  const meta = _readMeta();
  if (!meta.name) { alert('Name required'); return; }
  await saveTemplate(_editTid, {
    name: meta.name, description: meta.desc,
    tx_type: meta.txType, invoice_prefix: meta.invoicePrefix,
    invoice_next_num: meta.invoiceNextNum
  });
  _currentTpl.name = meta.name;
  _currentTpl.description = meta.desc;
  _currentTpl.tx_type = meta.txType;
  _currentTpl.invoice_prefix = meta.invoicePrefix;
  _currentTpl.invoice_next_num = meta.invoiceNextNum;
  toast('Template saved');
  renderTemplateBuilder(_currentTpl);
}

// ── Move field ────────────────────────────────────────────────────
async function moveField(idx, dir) {
  if (!_currentTpl) return;
  const arr = _currentTpl.fields;
  const target = idx + dir;
  if (target < 0 || target >= arr.length) return;
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  await saveTemplate(_editTid, { fields: arr });
  renderTemplateBuilder(_currentTpl);
}

// ── Delete field ──────────────────────────────────────────────────
async function deleteField(fid) {
  if (!_currentTpl || !confirm('Remove this field?')) return;
  _currentTpl.fields = _currentTpl.fields.filter(f => f.id !== fid);
  await saveTemplate(_editTid, { fields: _currentTpl.fields });
  renderTemplateBuilder(_currentTpl);
}

// ── Field Modal ───────────────────────────────────────────────────
function openFieldModal(fid) {
  const t = _currentTpl;
  if (!t) return;
  const f = fid ? t.fields.find(x => x.id === fid) : null;
  const isNew = !f;

  let ftype = f?.type || 'paired';
  if (ftype === 'number' || ftype === 'currency' || ftype === 'dropdown') ftype = 'numeric';
  if (ftype === 'text' && (f?.calculators||[]).length > 0) ftype = 'numeric';
  _fldCalcs = f ? JSON.parse(JSON.stringify(f.calculators || [])) : [];

  const isN = ftype === 'numeric', isP = ftype === 'paired', isT = ftype === 'text';

  // Target field options for calculators
  const targetOpts = (selfFid) => {
    const candidates = (t.fields||[]).filter(ff => ff.id !== selfFid && _isCalcField(ff) && !_isTextField(ff));
    if (!candidates.length) return '<option value="">— no numeric fields yet —</option>';
    return '<option value="">— none —</option>' + candidates.map(ff => {
      const tag = _isPairedField(ff) ? ' [paired]' : (ff.calculators||[]).length > 0 ? ' [result]' : '';
      return `<option value="${ff.id}">${esc(ff.label)}${tag}</option>`;
    }).join('');
  };

  // Select aggregate checkboxes
  const saggChecks = (selfFid, selIds) => {
    const candidates = (t.fields||[]).filter(ff => ff.id !== selfFid && _isCalcField(ff) && !_isTextField(ff));
    if (!candidates.length) return '<p style="color:var(--muted);font-size:12px;">No numeric fields yet.</p>';
    return candidates.map(ff => {
      const checked = (selIds||[]).includes(ff.id) ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer;">
        <input type="checkbox" class="sagg_check" value="${ff.id}" ${checked}> ${esc(ff.label)}
      </label>`;
    }).join('');
  };

  // Calculator rows HTML
  const calcRows = _fldCalcs.map((c, i) => {
    const isSAgg = c.operation === 'select_aggregate';
    const isAgg = c.operation === 'aggregate';
    return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;" id="fcalc_${i}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="fg"><label>Result Name *</label>
          <input value="${esc(c.name||'')}" oninput="window._tplEngine._updateCalc(${i},'name',this.value)" placeholder="e.g. Tax"></div>
        <div class="fg"><label>Operation</label>
          <select onchange="window._tplEngine._updateCalc(${i},'operation',this.value);window._tplEngine._onCalcOpChange(${i})">
            ${Object.entries(CALC_OPS).map(([k,v])=>`<option value="${k}" ${c.operation===k?'selected':''}>${v}</option>`).join('')}
          </select></div>
        <div class="fg" id="coper_${i}" style="${isAgg||isSAgg?'display:none':''}">
          <label>Factor / Operand <span style="color:var(--muted);font-weight:400;">(0.1 = 10%)</span></label>
          <input type="number" value="${c.operand||''}" oninput="window._tplEngine._updateCalc(${i},'operand',this.value)" step="any"></div>
        <div class="fg" id="ctarg_${i}" style="${isAgg||isSAgg?'display:none':''}">
          <label>Apply To Field</label>
          <select onchange="window._tplEngine._updateCalc(${i},'targetFieldId',this.value)">
            ${targetOpts(fid||'')}
          </select></div>
        <div class="fg" id="csagg_${i}" style="${isSAgg?'':'display:none'};grid-column:1/-1;">
          <label>Fields to Include</label>
          <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg3);max-height:160px;overflow-y:auto;">
            ${saggChecks(fid||'', c.targetFieldIds||[])}</div></div>
        <div class="fg" style="grid-column:1/-1;"><label>Show Result</label>
          <select onchange="window._tplEngine._updateCalc(${i},'resultVisible',this.value==='yes')">
            <option value="yes" ${c.resultVisible!==false?'selected':''}>Yes — visible on form</option>
            <option value="no" ${c.resultVisible===false?'selected':''}>No — hidden (usable in later calcs)</option>
          </select></div>
      </div>
      <button class="bs sm" style="color:var(--red);margin-top:4px;" onclick="window._tplEngine._removeCalc(${i})">✕ Remove</button>
    </div>`;
  }).join('');

  const modalHtml = `<div class="modal-bg" id="fieldModalBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:680px;" onclick="event.stopPropagation()">
      <div class="modal-title">${isNew ? 'Add Field' : 'Edit Field'}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="fg"><label>Field Label *</label>
          <input id="fl_label" value="${esc(f?.label||'')}" placeholder="e.g. Items / Cost / Notes"></div>
        <div class="fg"><label>Field Type</label>
          <select id="fl_type" onchange="window._tplEngine._onTypeChange(this.value)">
            ${Object.entries(FIELD_TYPES).map(([k,v])=>`<option value="${k}" ${ftype===k?'selected':''}>${v}</option>`).join('')}
          </select></div>
      </div>

      <!-- TEXT PANEL -->
      <div id="fl_panel_text" style="display:${isT?'block':'none'}">
        <p style="color:var(--muted);font-size:13px;margin-bottom:10px;">Text fields hold descriptive content only.</p>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="fl_visible_t" ${f?.visible!==false?'checked':''} style="width:auto;"> Visible on invoice</label>
      </div>

      <!-- NUMERIC PANEL -->
      <div id="fl_panel_numeric" style="display:${isN?'block':'none'}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
          <div class="fg"><label>Default Value</label>
            <input type="number" id="fl_defval" value="${esc(String(f?.defaultValue||''))}" placeholder="0.00" step="0.01"></div>
          <div class="fg"><label>Add to Ledger</label>
            <select id="fl_ledger">${Object.entries(LEDGER_FX).map(([k,v])=>`<option value="${k}" ${(f?.ledgerEffect||'')===k?'selected':''}>${v}</option>`).join('')}</select>
            <span style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4;">When set, this field's value posts a real balance-affecting record to the contact's ledger. Typically set only on the final total field.</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="fl_visible_n" ${f?.visible!==false?'checked':''} style="width:auto;"> Visible on invoice</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="fl_editable" ${f?.editableAtExecution!==false?'checked':''} style="width:auto;"> Editable at entry time</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;" title="Run Aggregate will skip this field">
            <input type="checkbox" id="fl_excludeagg" ${f?.excludeFromAggregate?'checked':''} style="width:auto;"> Exclude from aggregate</label>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="fl_finaltotal" ${f?.isFinalTotal?'checked':''} style="width:auto;margin-top:2px;">
            <span><strong>Final Total</strong><br><span style="font-size:11px;color:var(--green);">invoice amount basis</span></span></label>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Calculators</div>
          <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">Compute results from other fields. Results can chain into later calculators.</p>
          <div id="fl_calc_list">${calcRows}</div>
          <button class="bs sm" onclick="window._tplEngine._addCalc()">+ Add Calculator</button>
        </div>
      </div>

      <!-- PAIRED PANEL -->
      <div id="fl_panel_paired" style="display:${isP?'block':'none'}">
        <p style="color:var(--muted);font-size:13px;margin-bottom:10px;">Paired fields create structured rows: each row has a text description and a numeric value. They render as a table on the invoice.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
          <div class="fg"><label>Text Column Label</label>
            <input id="fl_textlabel" value="${esc(f?.textLabel||'Item')}" placeholder="Item"></div>
          <div class="fg"><label>Numeric Column Label</label>
            <input id="fl_numlabel" value="${esc(f?.numericLabel||'Amount')}" placeholder="Amount"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="fl_repeat_p" ${f?.repeatable!==false?'checked':''} style="width:auto;"> Repeatable rows</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="fl_visible_p" ${f?.visible!==false?'checked':''} style="width:auto;"> Visible on invoice</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="fl_excludeagg_p" ${f?.excludeFromAggregate?'checked':''} style="width:auto;"> Exclude from aggregate</label>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="fl_finaltotal_p" ${f?.isFinalTotal?'checked':''} style="width:auto;margin-top:2px;">
            <span><strong>Final Total</strong><br><span style="font-size:11px;color:var(--green);">invoice amount basis</span></span></label>
        </div>
        <div class="fg"><label>Add to Ledger (on numeric total)</label>
          <select id="fl_ledger_p">${Object.entries(LEDGER_FX).map(([k,v])=>`<option value="${k}" ${(f?.ledgerEffect||'')===k?'selected':''}>${v}</option>`).join('')}</select>
          <span style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4;">When set, the sum of this field's rows posts a real balance-affecting record to the contact's ledger. Typically set only on the final total field.</span>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;border-top:1px solid var(--border);padding-top:16px;">
        <button class="bs" onclick="document.getElementById('fieldModalBg').remove()">Cancel</button>
        <button class="btn" onclick="window._tplEngine._saveField('${fid||''}')">Save Field</button>
      </div>
    </div></div>`;

  const d = document.createElement('div');
  d.innerHTML = modalHtml;
  document.body.appendChild(d.firstChild);
}

// ── Calculator helpers ────────────────────────────────────────────
function _addCalc() {
  _fldCalcs.push({ name: '', operation: 'multiply', operand: 1, targetFieldId: '', targetFieldIds: [], resultVisible: true });
  // Re-render modal by closing and reopening — simplest approach
  const fid = document.getElementById('fl_label')?.dataset?.fid || '';
  document.getElementById('fieldModalBg')?.remove();
  openFieldModal(fid || null);
}

function _updateCalc(i, key, val) { if (_fldCalcs[i]) _fldCalcs[i][key] = val; }
function _removeCalc(i) { _fldCalcs.splice(i, 1); document.getElementById('fcalc_' + i)?.remove(); }

function _onCalcOpChange(i) {
  const op = _fldCalcs[i]?.operation;
  const isAgg = op === 'aggregate';
  const isSAgg = op === 'select_aggregate';
  const oper = document.getElementById('coper_' + i);
  const targ = document.getElementById('ctarg_' + i);
  const sagg = document.getElementById('csagg_' + i);
  if (oper) oper.style.display = (isAgg || isSAgg) ? 'none' : '';
  if (targ) targ.style.display = (isAgg || isSAgg) ? 'none' : '';
  if (sagg) sagg.style.display = isSAgg ? '' : 'none';
}

function _onTypeChange(val) {
  ['text', 'numeric', 'paired'].forEach(t => {
    const p = document.getElementById('fl_panel_' + t);
    if (p) p.style.display = (t === val) ? 'block' : 'none';
  });
}

// ── Save field from modal ─────────────────────────────────────────
async function _saveField(fid) {
  const t = _currentTpl;
  if (!t) return;
  const label = document.getElementById('fl_label')?.value.trim();
  if (!label) { alert('Field label required.'); return; }
  const type = document.getElementById('fl_type')?.value || 'text';

  // Sync calculator data from DOM
  document.querySelectorAll('[id^=fcalc_]').forEach((row, i) => {
    if (!_fldCalcs[i]) return;
    const inputs = row.querySelectorAll('input:not([type=checkbox])');
    const selects = row.querySelectorAll('select');
    if (inputs[0]) _fldCalcs[i].name = inputs[0].value.trim();
    if (inputs[1]) _fldCalcs[i].operand = parseFloat(inputs[1].value) || 0;
    if (selects[0]) _fldCalcs[i].operation = selects[0].value;
    if (selects[1]) _fldCalcs[i].targetFieldId = selects[1]?.value || '';
    if (selects[2]) _fldCalcs[i].resultVisible = selects[2]?.value !== 'no';
    if (_fldCalcs[i].operation === 'select_aggregate')
      _fldCalcs[i].targetFieldIds = Array.from(row.querySelectorAll('.sagg_check:checked')).map(cb => cb.value);
  });

  let field;
  if (type === 'text') {
    field = { id: fid || uuid(), label, type, visible: document.getElementById('fl_visible_t')?.checked !== false, calculators: [] };
  } else if (type === 'numeric') {
    const isFT = document.getElementById('fl_finaltotal')?.checked || false;
    if (isFT) t.fields.forEach(of => { if (of.id !== fid) of.isFinalTotal = false; });
    field = {
      id: fid || uuid(), label, type,
      defaultValue: document.getElementById('fl_defval')?.value || '',
      ledgerEffect: document.getElementById('fl_ledger')?.value || null,
      visible: document.getElementById('fl_visible_n')?.checked !== false,
      editableAtExecution: document.getElementById('fl_editable')?.checked !== false,
      excludeFromAggregate: document.getElementById('fl_excludeagg')?.checked || false,
      isFinalTotal: isFT,
      calculators: _fldCalcs.filter(c => c.operation)
    };
  } else {
    const isFT = document.getElementById('fl_finaltotal_p')?.checked || false;
    if (isFT) t.fields.forEach(of => { if (of.id !== fid) of.isFinalTotal = false; });
    field = {
      id: fid || uuid(), label, type,
      textLabel: document.getElementById('fl_textlabel')?.value.trim() || 'Item',
      numericLabel: document.getElementById('fl_numlabel')?.value.trim() || 'Amount',
      repeatable: document.getElementById('fl_repeat_p')?.checked !== false,
      visible: document.getElementById('fl_visible_p')?.checked !== false,
      excludeFromAggregate: document.getElementById('fl_excludeagg_p')?.checked || false,
      ledgerEffect: document.getElementById('fl_ledger_p')?.value || null,
      isFinalTotal: isFT,
      calculators: []
    };
  }

  if (fid) {
    const idx = t.fields.findIndex(x => x.id === fid);
    if (idx >= 0) t.fields[idx] = field;
  } else {
    t.fields.push(field);
  }

  await saveTemplate(_editTid, { fields: t.fields });
  document.getElementById('fieldModalBg')?.remove();
  toast(fid ? 'Field updated' : 'Field added');
  renderTemplateBuilder(t);
}

// ── Expose to window for onclick handlers ─────────────────────────
export function exposeToWindow() {
  window._tplEngine = {
    openBuilder: openTemplateBuilder,
    createAndContinue, saveMeta, moveField, deleteField,
    openFieldModal, _addCalc, _updateCalc, _removeCalc,
    _onCalcOpChange, _onTypeChange, _saveField
  };
}
