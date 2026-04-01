// Money IntX — Templates Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile, getMyBusinessId } from './state.js';
import { esc, toast, openModal, closeModal, fmtDate, fmtRelative, TX_LABELS } from '../ui.js';
import { supabase } from '../supabase.js';
import { listContacts } from '../contacts.js';
import { fmtMoney, createEntry } from '../entries.js';
import { listTemplates, createTemplate, updateTemplate, copyPublicTemplate } from '../templates.js';

// Functions from other modules should be available
// TX_LABELS, TX_COLORS, etc. on window

// ── Templates ─────────────────────────────────────────────────────
async function renderTemplatesPage(el) {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  el.innerHTML = '<div class="page-header"><h2>Templates</h2></div><p style="color:var(--muted);">Loading...</p>';
  // Use businessId from BS context if available, otherwise use userId
  const bizUuid = getMyBusinessId();
  const templates = await listTemplates(bizUuid);
  let html = `<div class="page-header"><h2>Templates</h2>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary btn-sm" onclick="openNewTemplateModal()">+ New Template</button>
      <button class="btn btn-secondary btn-sm" onclick="openPublicTemplateDB()">Public DB</button>
    </div>
  </div>`;
  if (templates.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No templates yet.</p></div>`;
  } else {
    templates.forEach(t => {
      const fCount = (t.fields || []).length;
      html += `<div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h3 style="font-size:16px;font-weight:700;">${esc(t.name)} ${t.is_public ? '<span class="badge badge-blue" style="font-size:10px;">Public</span>' : ''}</h3>
            ${t.description ? `<p style="font-size:13px;color:var(--muted);margin-top:2px;">${esc(t.description)}</p>` : ''}
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <span class="badge badge-blue">${fCount} field${fCount !== 1 ? 's' : ''}</span>
              ${t.tx_type ? `<span class="badge badge-gray">${esc(TX_LABELS[t.tx_type] || t.tx_type)}</span>` : ''}
            </div>
          </div>
          <div class="action-menu">
            <button class="action-menu-btn" onclick="toggleActionMenu(this)">⋮</button>
            <div class="action-dropdown">
              <button onclick="openEditTemplate('${t.id}')">Edit Fields</button>
              <button onclick="toggleTemplatePublic('${t.id}',${!t.is_public})">${t.is_public ? 'Make Private' : 'Make Public'}</button>
              <button onclick="confirmDeleteTemplate('${t.id}')" style="color:var(--red);">Delete</button>
            </div>
          </div>
        </div>
        ${fCount > 0 ? `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;display:flex;flex-wrap:wrap;gap:4px;">
          ${(t.fields || []).map(f => {
            const calcDesc = (f.calculators||[]).filter(c=>c.operation&&c.operation!=='').map(c => {
              const target = c.targetFieldId ? (t.fields.find(tf=>tf.id===c.targetFieldId)?.label||'?') : '';
              if (c.operation==='multiply') return `×${c.operand||'?'}${target?' on '+target:''}`;
              if (c.operation==='add') return `+ ${target||'?'}`;
              if (c.operation==='subtract') return `${target||'?'} −`;
              if (c.operation==='aggregate') return 'Σ all';
              if (c.operation==='select_aggregate') return 'Σ selected';
              return c.operation;
            }).join(' · ');
            return `<span style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;">${esc(f.label||'?')} <span style="color:var(--muted);">[${f.type}]</span>${calcDesc?`<span style="color:#60a5fa;"> ${calcDesc}</span>`:''}  </span>`;
          }).join('')}
        </div>` : ''}
        <div style="display:flex;gap:6px;margin-top:8px;">
          ${!t.archived_at ? `<button class="btn btn-primary btn-sm" onclick="useTemplateForEntry('${t.id}')">Use Template</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="openEditTemplate('${t.id}')">Edit Fields</button>
        </div>
      </div>`;
    });
  }
  el.innerHTML = html;
}

// ── Template Builder ──────────────────────────────────────────────
window._tplFields = [];

const FIELD_TYPES = {
  text: 'Text', number: 'Number', date: 'Date', select: 'Dropdown',
  textarea: 'Long Text', currency: 'Currency',
  paired: 'Item + Amount (Paired)'
};
const CALC_TYPES = {
  '': 'None', multiply: 'Multiply by factor', add: 'Add to field',
  subtract: 'Subtract from field',
  aggregate: 'Run Aggregate (all, no excluded)',
  select_aggregate: 'Run Selection Aggregate (choose fields)'
};
const LEDGER_EFFECTS = { '': 'None', toy: 'They Owe (TOY)', toy_credit: 'TOY Credit', yot: 'I Owe (YOT)', yot_credit: 'YOT Credit' };
const CURRENCIES = ['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','CNY','BRL','MXN','AED','SAR','QAR','KWD','EGP','MAD','TZS','UGX','ETB','XOF'];
const CURRENCY_SYMBOLS = { USD:'$', EUR:'€', GBP:'£', NGN:'₦', CAD:'C$', AUD:'A$', JPY:'¥', KES:'KSh', ZAR:'R', GHS:'₵', INR:'₹', CNY:'¥', BRL:'R$', MXN:'$', AED:'د.إ', SAR:'﷼', QAR:'﷼', KWD:'د.ك', EGP:'E£', MAD:'MAD', TZS:'TSh', UGX:'USh', ETB:'Br', XOF:'CFA' };
function _tplFmt(val, currency) {
  const sym = CURRENCY_SYMBOLS[currency] || currency || '$';
  return sym + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function currencySelectHtml(selected) {
  return CURRENCIES.map(c => `<option value="${c}" ${(selected||'USD')===c?'selected':''}>${c}</option>`).join('');
}

// ── Template Builder ──────────────────────────────────────────────
window._tplFields = [];

function _tplModalHtml(title, idPrefix, tpl = {}) {
  const _profile = getCurrentProfile();
  return `
    <h3 style="margin-bottom:16px;">${title}</h3>
    <div class="form-group"><label>Name *</label><input type="text" id="${idPrefix}-name" value="${esc(tpl.name || '')}" placeholder="Invoice Template"></div>
    <div class="form-group"><label>Description <span style="font-size:11px;color:var(--muted);">— shown to users when they pick this template</span></label><textarea id="${idPrefix}-desc" rows="2" placeholder="e.g. Standard service invoice with tax and discount">${esc(tpl.description || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Default Type</label><select id="${idPrefix}-type">
        <option value="">None</option>
        ${Object.entries(TX_LABELS).map(([k,v]) => `<option value="${k}" ${tpl.tx_type===k?'selected':''}>${v}</option>`).join('')}
      </select></div>
      <div class="form-group"><label>Invoice Prefix</label><input type="text" id="${idPrefix}-prefix" value="${esc(tpl.invoice_prefix || 'INV-')}"></div>
      <div class="form-group"><label>Starting # <span style="font-size:11px;color:var(--muted);">Next invoice number</span></label><input type="number" id="${idPrefix}-nextnum" min="1" step="1" value="${tpl.invoice_next_num || 1}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Default Currency</label><select id="${idPrefix}-currency">${currencySelectHtml(tpl.currency || _profile?.default_currency)}</select></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:28px;">
        <input type="checkbox" id="${idPrefix}-public" ${tpl.is_public?'checked':''} style="width:auto;accent-color:var(--accent);">
        <label for="${idPrefix}-public" style="cursor:pointer;font-size:13px;font-weight:500;">Add to Public Template DB</label>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);margin:16px 0;padding-top:16px;">
      <label style="font-weight:700;font-size:14px;display:block;margin-bottom:12px;">Fields (<span id="tpl-fields-count">${window._tplFields.length}</span>)</label>
      <div id="tpl-fields-list"></div>
    </div>`;
}

window.openNewTemplateModal = function() {
  window._tplFields = [];
  openModal(_tplModalHtml('New Template', 'nt') + `
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="doCreateTemplate()">💾 Create Template</button>
    </div>
  `, { maxWidth: '600px' });
  renderFieldList();
};

window.addTemplateField = function() {
  const id = 'f' + Math.random().toString(36).substr(2, 6);
  window._tplFields.push({ id, label: '', type: 'number', required: false, options: '',
    calculators: [], ledgerEffect: '', isFinalTotal: false,
    excludeFromAggregate: false, textLabel: 'Item', numericLabel: 'Amount', defaultValue: '' });
  renderFieldList(true);
};

window.removeTemplateField = function(id) {
  window._tplFields = window._tplFields.filter(f => f.id !== id);
  renderFieldList();
};

window.moveFieldUp = function(id) {
  const idx = window._tplFields.findIndex(f => f.id === id);
  if (idx > 0) { [window._tplFields[idx-1], window._tplFields[idx]] = [window._tplFields[idx], window._tplFields[idx-1]]; renderFieldList(); }
};

window.moveFieldDown = function(id) {
  const idx = window._tplFields.findIndex(f => f.id === id);
  if (idx < window._tplFields.length - 1) { [window._tplFields[idx], window._tplFields[idx+1]] = [window._tplFields[idx+1], window._tplFields[idx]]; renderFieldList(); }
};

function _saveFieldInputs() {
  // Flush any un-blurred input values into _tplFields before re-render
  document.querySelectorAll('[data-field-idx]').forEach(card => {
    const i = parseInt(card.dataset.fieldIdx);
    if (!window._tplFields[i]) return;
    card.querySelectorAll('input[data-fkey]').forEach(inp => {
      window._tplFields[i][inp.dataset.fkey] = inp.type === 'checkbox' ? inp.checked : inp.value;
    });
    card.querySelectorAll('select[data-fkey]').forEach(sel => {
      window._tplFields[i][sel.dataset.fkey] = sel.value;
    });
    card.querySelectorAll('input[data-ckey]').forEach(inp => {
      const [ci, key] = inp.dataset.ckey.split(':');
      if (window._tplFields[i].calculators[ci]) window._tplFields[i].calculators[ci][key] = inp.value;
    });
    // Explicitly capture calc row selects (operation, targetFieldId, operand) from DOM
    card.querySelectorAll('[data-calc-row]').forEach(row => {
      const ci = parseInt(row.dataset.calcRow);
      if (!window._tplFields[i].calculators[ci]) return;
      const opSel = row.querySelector('select:not(.calc-target)');
      if (opSel) window._tplFields[i].calculators[ci].operation = opSel.value;
      const targSel = row.querySelector('.calc-target');
      if (targSel) window._tplFields[i].calculators[ci].targetFieldId = targSel.value || '';
      const factorInp = row.querySelector('.calc-factor');
      if (factorInp) window._tplFields[i].calculators[ci].operand = factorInp.value;
    });
  });
}

function renderFieldList(scrollToBottom) {
  const el = document.getElementById('tpl-fields-list');
  if (!el) return;
  _saveFieldInputs();

  const countEl = document.getElementById('tpl-fields-count');
  if (countEl) countEl.textContent = window._tplFields.length;

  let html = window._tplFields.length === 0
    ? '<p style="color:var(--muted);font-size:13px;margin-bottom:8px;">No fields yet. Add your first field below.</p>'
    : window._tplFields.map((f, i) => {
    const showPaired = f.type === 'paired';
    const showOptions = f.type === 'select';
    const showCalc = ['computed','number','currency','paired'].includes(f.type);
    const calcRows = (f.calculators||[]).map((c, ci) => {
      const isMul = c.operation === 'multiply';
      const hasTarget = ['multiply','add','subtract'].includes(c.operation);
      return `<div data-calc-row="${ci}" style="display:flex;gap:5px;margin-top:6px;align-items:center;flex-wrap:wrap;background:#0a1929;border:1px solid #1e40af;border-radius:6px;padding:6px 8px;">
        <select style="flex:1;min-width:130px;background:#0f2744;border:1px solid #2563eb;color:#93c5fd;border-radius:5px;padding:3px 6px;font-size:12px;"
          onchange="
            window._tplFields[${i}].calculators[${ci}].operation=this.value;
            var r=this.closest('[data-calc-row]');
            var op=this.value;
            r.querySelector('.calc-factor').style.display=op==='multiply'?'':'none';
            r.querySelector('.calc-target').style.display=['multiply','add','subtract'].includes(op)?'':'none';
          ">
          ${Object.entries(CALC_TYPES).map(([k,v]) => `<option value="${k}" ${c.operation===k?'selected':''}>${v}</option>`).join('')}
        </select>
        <input type="number" placeholder="×" value="${esc(String(c.operand||''))}"
          class="calc-factor" oninput="window._tplFields[${i}].calculators[${ci}].operand=this.value"
          style="width:58px;background:#0f2744;border:1px solid #2563eb;color:#93c5fd;border-radius:5px;padding:3px 6px;font-size:12px;${isMul?'':'display:none'}">
        <select class="calc-target"
          style="flex:1;min-width:110px;background:#0f2744;border:1px solid #2563eb;color:#93c5fd;border-radius:5px;padding:3px 6px;font-size:12px;${hasTarget?'':'display:none'}"
          onchange="window._tplFields[${i}].calculators[${ci}].targetFieldId=this.value">
          <option value="">— field —</option>
          ${window._tplFields.filter(tf=>tf.id!==f.id).map(tf=>`<option value="${tf.id}" ${c.targetFieldId===tf.id?'selected':''}>${esc(tf.label||'Untitled')}</option>`).join('')}
        </select>
        <button type="button" onclick="window._tplFields[${i}].calculators.splice(${ci},1);renderFieldList();"
          style="background:none;border:none;color:#f87171;cursor:pointer;font-size:15px;line-height:1;padding:0 2px;" title="Remove">✕</button>
      </div>`;
    }).join('');

    return `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;" data-field-idx="${i}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong style="font-size:13px;color:var(--muted);">Field ${i+1}</strong>
        <div style="display:flex;gap:4px;">
          <button type="button" onclick="moveFieldUp('${f.id}')" class="bs sm" style="padding:3px 8px;font-size:12px;">↑</button>
          <button type="button" onclick="moveFieldDown('${f.id}')" class="bs sm" style="padding:3px 8px;font-size:12px;">↓</button>
          <button type="button" onclick="removeTemplateField('${f.id}')" class="bs sm" style="padding:3px 8px;font-size:12px;color:var(--red);">✕</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label style="font-size:12px;">Field Label *</label>
          <input type="text" placeholder="e.g. Items / Cost / Notes" value="${esc(f.label)}"
            oninput="window._tplFields[${i}].label=this.value" style="margin-top:4px;">
        </div>
        <div>
          <label style="font-size:12px;">Field Type</label>
          <select style="margin-top:4px;"
            onchange="
              window._tplFields[${i}].type=this.value;
              var c=this.closest('[data-field-idx]'), t=this.value;
              var sc=['computed','number','currency','paired'].includes(t);
              c.querySelector('.f-paired').style.display=t==='paired'?'':'none';
              c.querySelector('.f-options').style.display=t==='select'?'':'none';
              c.querySelector('.f-calc').style.display=sc?'':'none';
              c.querySelector('.f-repeatable').style.display=t==='paired'?'':'none';
            ">
            ${Object.entries(FIELD_TYPES).map(([k,v]) => `<option value="${k}" ${f.type===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Paired section -->
      <div class="f-paired" style="${showPaired?'':'display:none'}">
        <p style="font-size:12px;color:var(--muted);margin-bottom:8px;line-height:1.5;">Paired fields create structured rows (text + amount) rendered as a table on the invoice.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div><label style="font-size:12px;">Text Column Label</label>
            <input type="text" value="${esc(f.textLabel||'Item')}" oninput="window._tplFields[${i}].textLabel=this.value" style="margin-top:4px;"></div>
          <div><label style="font-size:12px;">Numeric Column Label</label>
            <input type="text" value="${esc(f.numericLabel||'Amount')}" oninput="window._tplFields[${i}].numericLabel=this.value" style="margin-top:4px;"></div>
        </div>
      </div>

      <!-- Options section -->
      <div class="f-options" style="margin-bottom:10px;${showOptions?'':'display:none'}">
        <label style="font-size:12px;">Options (comma separated)</label>
        <input type="text" placeholder="Option A, Option B, Option C"
          value="${esc(Array.isArray(f.options)?f.options.join(', '):(f.options||''))}"
          oninput="window._tplFields[${i}].options=this.value" style="margin-top:4px;">
      </div>

      <!-- Default Value -->
      <div style="margin-bottom:10px;">
        <label style="font-size:12px;">Default Value</label>
        <p style="font-size:11px;color:var(--muted);margin:3px 0 5px;line-height:1.4;">Pre-filled value shown when creating a new entry. Users can edit or leave it as-is.</p>
        <input type="text" placeholder="e.g. 0, N/A, or a default label" value="${esc(f.defaultValue||'')}"
          oninput="window._tplFields[${i}].defaultValue=this.value" style="margin-top:0;">
      </div>

      <!-- Calculator section — blue, below Default Value -->
      <div class="f-calc" style="margin-bottom:12px;${showCalc?'':'display:none'}">
        <div style="background:#0d1f3c;border:1px solid #2563eb;border-radius:8px;padding:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:11px;font-weight:700;color:#60a5fa;letter-spacing:.04em;">⚡ CALCULATORS</span>
            <button type="button"
              onclick="window._tplFields[${i}].calculators.push({operation:'aggregate',operand:'',targetFieldId:''});renderFieldList(true);"
              style="background:#1d4ed8;border:none;color:#fff;border-radius:5px;padding:2px 10px;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.02em;">+ Add</button>
          </div>
          <p style="font-size:11px;color:#93c5fd;margin:0 0 4px;line-height:1.4;opacity:.8;">Define how this field's value is calculated from other fields. Results update automatically.</p>
          <div class="f-calc-rows">${calcRows}</div>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <label class="f-repeatable" style="display:${showPaired?'flex':'none'};align-items:center;gap:5px;font-size:12px;cursor:pointer;">
          <input type="checkbox" ${f.repeatable?'checked':''} onchange="window._tplFields[${i}].repeatable=this.checked" style="width:auto;accent-color:var(--accent);"> Repeatable rows</label>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;">
          <input type="checkbox" ${f.visibleOnInvoice!==false?'checked':''} onchange="window._tplFields[${i}].visibleOnInvoice=this.checked" style="width:auto;accent-color:var(--accent);"> Visible on invoice</label>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;">
          <input type="checkbox" ${f.excludeFromAggregate?'checked':''} onchange="window._tplFields[${i}].excludeFromAggregate=this.checked" style="width:auto;accent-color:var(--accent);"> Exclude from total</label>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;">
          <input type="checkbox" ${f.isFinalTotal?'checked':''} onchange="window._tplFields[${i}].isFinalTotal=this.checked" style="width:auto;accent-color:var(--accent);">
          Final Total${f.isFinalTotal?' <span style="font-size:10px;color:var(--accent);">(sets entry amount)</span>':''}</label>
      </div>

      <div>
        <label style="font-size:12px;">Add to Ledger</label>
        <select onchange="window._tplFields[${i}].ledgerEffect=this.value" style="margin-top:4px;">
          ${Object.entries(LEDGER_EFFECTS).map(([k,v]) => `<option value="${k}" ${(f.ledgerEffect||'')===k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }).join('');

  // "Add Field" always at the bottom
  html += `<button class="btn btn-secondary btn-sm" style="width:100%;margin-top:4px;" onclick="addTemplateField()">+ Add Field</button>`;
  el.innerHTML = html;

  if (scrollToBottom) {
    setTimeout(() => el.lastElementChild?.previousElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }
}
window.renderFieldList = renderFieldList;

function _collectFields() {
  window._tplFields.forEach((f, i) => {
    const card = document.querySelectorAll('[data-field-idx]')[i];
    if (card) {
      const labelInput = card.querySelector('input[type="text"]');
      if (labelInput) f.label = labelInput.value.trim();
    }
  });
  return window._tplFields.filter(f => f.label).map(f => ({
    id: f.id, label: f.label, type: f.type, required: f.required,
    options: f.type === 'select' ? (f.options || '').split(',').map(o => o.trim()).filter(Boolean) : undefined,
    calculators: (f.calculators || []).filter(c => c.operation).map(c => ({
      operation: c.operation,
      operand: c.operand !== '' ? c.operand : undefined,
      targetFieldId: c.targetFieldId || undefined,
      targetFieldIds: c.targetFieldIds || undefined,
      resultVisible: c.resultVisible !== false
    })),
    defaultValue: f.defaultValue || undefined,
    currency: f.currency || undefined,
    ledgerEffect: f.ledgerEffect || undefined,
    isFinalTotal: f.isFinalTotal || undefined,
    excludeFromAggregate: f.excludeFromAggregate || undefined,
    visibleOnInvoice: f.visibleOnInvoice !== false,
    repeatable: f.repeatable || undefined,
    textLabel: f.type === 'paired' ? (f.textLabel || 'Item') : undefined,
    numericLabel: f.type === 'paired' ? (f.numericLabel || 'Amount') : undefined
  }));
}

window.doCreateTemplate = async function() {
  const currentUser = getCurrentUser();
  const fields = _collectFields();
  const name = document.getElementById('nt-name').value.trim();
  if (!name) return toast('Name required.', 'error');
  // Get businessId from BS context if available, otherwise use userId
  const bizUuid = getMyBusinessId();
  const newTmpl = await createTemplate(bizUuid, currentUser.id, {
    name, description: document.getElementById('nt-desc').value.trim(),
    txType: document.getElementById('nt-type').value || null,
    fields,
    invoicePrefix: document.getElementById('nt-prefix').value.trim(),
    invoiceNextNum: parseInt(document.getElementById('nt-nextnum')?.value) || 1,
    currency: document.getElementById('nt-currency')?.value || 'USD',
    isPublic: document.getElementById('nt-public')?.checked || false
  });
  closeModal(); toast('Template created!', 'success');
  // If created from Business Suite, add to BS tracker and navigate back to BS
  if (window._bsCreatingTemplate && newTmpl?.id) {
    if (typeof window._tmplAfterSave === 'function') window._tmplAfterSave(newTmpl.id);
    window._bsCreatingTemplate = false;
    if (window._bsNavigate) { window._bsNavigate('bs-templates'); return; }
  }
  navTo('templates');
};

// ── Edit Template ────────────────────────────────────────────────
window.openEditTemplate = async function(id) {
  const t = await supabase.from('templates').select('*').eq('id', id).single();
  if (!t.data) return;
  const tpl = t.data;
  window._tplFields = (tpl.fields || []).map(f => ({
    ...f, id: f.id || 'f' + Math.random().toString(36).substr(2, 6),
    calcType: f.calcType || '', calcFactor: f.calcFactor || '',
    ledgerEffect: f.ledgerEffect || '', isFinalTotal: f.isFinalTotal || false,
    textLabel: f.textLabel || 'Item', numericLabel: f.numericLabel || 'Amount',
    options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || '')
  }));
  closeModal();
  openModal(_tplModalHtml('Edit Template', 'et', tpl) + `
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="doSaveTemplate('${id}')">💾 Save Template</button>
    </div>
  `, { maxWidth: '600px' });
  renderFieldList();
};

window.doSaveTemplate = async function(id) {
  const fields = _collectFields();
  await updateTemplate(id, {
    name: document.getElementById('et-name').value.trim(),
    description: document.getElementById('et-desc').value.trim(),
    tx_type: document.getElementById('et-type').value || null,
    fields,
    invoice_prefix: document.getElementById('et-prefix').value.trim(),
    invoice_next_num: parseInt(document.getElementById('et-nextnum')?.value) || 1,
    currency: document.getElementById('et-currency')?.value || 'USD',
    is_public: document.getElementById('et-public')?.checked || false
  });
  closeModal(); toast('Template saved!', 'success');
  if (document.getElementById('bs-content') && window._bsNavigate) { window._bsNavigate('bs-templates'); return; }
  navTo('templates');
};

// ── Use Template for Entry ────────────────────────────────────────
window.useTemplateForEntry = async function(templateId) {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const tpl = await supabase.from('templates').select('*').eq('id', templateId).single();
  if (!tpl.data) return;
  const t = tpl.data;
  // Store for calculator engine
  window._activeTpl = t;
  window._activeTplCurrency = t.currency || currentProfile?.default_currency || 'USD';
  const contacts = await listContacts(getMyBusinessId());
  const fields = t.fields || [];

  // Generate invoice number
  const invNum = (t.invoice_prefix || 'INV-') + String(t.invoice_next_num || 1).padStart(4, '0');

  // Store contacts for typeahead
  window._tfeContacts = contacts;

  let fieldsHtml = fields.map((f, i) => {
    if (f.type === 'text') return `<div class="form-group"><label>${esc(f.label)}${f.required?' *':''}</label><input type="text" id="tf-${f.id}" class="tpl-field"></div>`;
    if (f.type === 'number' || f.type === 'currency') {
      const _hasCalcs = (f.calculators||[]).length > 0;
      // Fields with calculators render as computed display divs so they auto-update
      if (_hasCalcs) {
        const _isFinal = f.isFinalTotal;
        return `<div class="form-group"><label>${esc(f.label)} <span style="font-size:10px;color:${_isFinal?'#22c55e':'#60a5fa'};font-weight:600;">${_isFinal?'✓ TOTAL':'⚡ auto'}</span></label><div id="tf-${f.id}" class="tpl-field" style="padding:12px 16px;background:${_isFinal?'#052e16':'#0d1f3c'};border:2px solid ${_isFinal?'#22c55e':'#2563eb'};border-radius:10px;font-weight:800;font-size:${_isFinal?'22':'16'}px;color:${_isFinal?'#4ade80':'#93c5fd'};" data-computed="0">${_tplFmt(0,window._activeTplCurrency)}</div></div>`;
      }
      return `<div class="form-group"><label>${esc(f.label)}${f.required?' *':''}</label><input type="number" id="tf-${f.id}" step="0.01" class="tpl-field" value="${esc(String(f.defaultValue||''))}" oninput="recalcTemplateFields()"></div>`;
    }
    if (f.type === 'date') return `<div class="form-group"><label>${esc(f.label)}</label><input type="date" id="tf-${f.id}" class="tpl-field" value="${new Date().toISOString().slice(0,10)}"></div>`;
    if (f.type === 'textarea') return `<div class="form-group"><label>${esc(f.label)}</label><textarea id="tf-${f.id}" rows="2" class="tpl-field"></textarea></div>`;
    if (f.type === 'select') return `<div class="form-group"><label>${esc(f.label)}</label><select id="tf-${f.id}" class="tpl-field" onchange="recalcTemplateFields()">${(f.options||[]).map(o => `<option>${esc(o)}</option>`).join('')}</select></div>`;
    if (f.type === 'computed') return `<div class="form-group"><label>${esc(f.label)}</label><div id="tf-${f.id}" class="tpl-field" style="padding:10px 14px;background:var(--bg3);border-radius:10px;font-weight:700;font-size:16px;" data-computed="0">${_tplFmt(0,window._activeTplCurrency)}</div></div>`;
    if (f.type === 'paired') return `<div class="form-group"><label>${esc(f.label)} (${esc(f.textLabel||'Item')} + ${esc(f.numericLabel||'Amount')})</label>
      <div id="tf-${f.id}-rows" class="paired-rows"></div>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="addPairedRow('${f.id}')">+ Add Row</button>
    </div>`;
    return '';
  }).join('');

  openModal(`
    <h3 style="margin-bottom:4px;">New Entry from Template</h3>
    <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">${esc(t.name)} · ${invNum}</p>
    <div class="form-group">
      <label>Contact *</label>
      <div style="position:relative;">
        <input type="text" id="tfe-contact-search" class="tpl-field" placeholder="Search contact..." autocomplete="off"
          style="width:100%;" oninput="filterTfeContacts(this.value)" onfocus="filterTfeContacts(this.value)">
        <input type="hidden" id="tfe-contact" value="">
        <div id="tfe-contact-list" style="position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border);border-radius:8px;max-height:180px;overflow-y:auto;z-index:999;display:none;"></div>
      </div>
    </div>
    <div class="form-group"><label>Type</label><select id="tfe-type">
      ${t.tx_type ? `<option value="${t.tx_type}" selected>${TX_LABELS[t.tx_type]}</option>` : Object.entries(TX_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
    </select></div>
    <div class="inline-row" style="gap:12px;margin-bottom:16px;">
      <div class="fg" style="flex:1;"><label>Issue Date</label><input type="date" id="tfe-date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="fg" style="flex:1;"><label>Due Date <span style="font-weight:400;color:var(--muted);">(optional)</span></label><input type="date" id="tfe-due-date"></div>
    </div>
    <div class="form-group">
      <label>${fields.some(f=>f.isFinalTotal)?'Currency':'Amount'}</label>
      <div class="inline-row">
        <input type="number" id="tfe-amount" step="0.01" placeholder="${fields.some(f=>f.isFinalTotal)?'Auto':'0.00'}" style="flex:1;min-width:0;${fields.some(f=>f.isFinalTotal)?'display:none;':''}" oninput="this._userEdited = this.value !== ''">
        <select id="tfe-currency" style="flex:0 0 86px;padding:10px 4px;" onchange="window._activeTplCurrency=this.value;recalcTemplateFields()">${currencySelectHtml(t.currency || currentProfile?.default_currency)}</select>
      </div>
    </div>
    ${fieldsHtml}
    <div class="form-group"><label>Note</label><textarea id="tfe-note" rows="2"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveTemplateEntry('${templateId}','${invNum}')">Save Entry</button>
    </div>
  `, { maxWidth: '560px' });

  // Add initial paired rows
  fields.filter(f => f.type === 'paired').forEach(f => addPairedRow(f.id));
};

// ── Contact typeahead for template entry form ─────────────────────
window.filterTfeContacts = function(q) {
  const list = document.getElementById('tfe-contact-list');
  if (!list) return;
  const contacts = window._tfeContacts || [];
  const filtered = q ? contacts.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : contacts;
  if (filtered.length === 0) { list.style.display = 'none'; return; }
  list.innerHTML = filtered.slice(0, 12).map(c =>
    `<div style="padding:8px 12px;cursor:pointer;font-size:13px;" onmousedown="selectTfeContact('${c.id}','${esc(c.name)}')"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      ${esc(c.name)}${c.email ? `<span style="color:var(--muted);font-size:11px;margin-left:6px;">${esc(c.email)}</span>` : ''}
    </div>`
  ).join('');
  list.style.display = 'block';
};
window.selectTfeContact = function(id, name) {
  document.getElementById('tfe-contact').value = id;
  document.getElementById('tfe-contact-search').value = name;
  document.getElementById('tfe-contact-list').style.display = 'none';
};
// Close dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('#tfe-contact-search') && !e.target.closest('#tfe-contact-list')) {
    const list = document.getElementById('tfe-contact-list');
    if (list) list.style.display = 'none';
  }
});

window.addPairedRow = function(fieldId) {
  const container = document.getElementById('tf-' + fieldId + '-rows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'paired-row';
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;';
  row.innerHTML = `
    <input type="text" placeholder="Item" class="pr-text" style="flex:2;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
    <input type="number" placeholder="Qty" class="pr-qty" step="1" style="width:60px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;" oninput="recalcTemplateFields()">
    <input type="number" placeholder="Amount" class="pr-num" step="0.01" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;" oninput="recalcTemplateFields()">
    <button onclick="this.parentElement.remove();recalcTemplateFields();" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;">✕</button>
  `;
  container.appendChild(row);
};

// ── Full Calculator Engine (matches v1) ───────────────────────────
// Runs on every numeric input change in template entry form.
// Uses multi-pass convergence to handle cross-field references.
window.recalcTemplateFields = function() {
  const tpl = window._activeTpl;
  if (!tpl || !tpl.fields) {
    // Fallback: simple paired row sum
    let total = 0;
    document.querySelectorAll('.paired-row').forEach(row => {
      const qty = parseFloat(row.querySelector('.pr-qty')?.value) || 1;
      const num = parseFloat(row.querySelector('.pr-num')?.value) || 0;
      total += qty * num;
    });
    document.querySelectorAll('.tpl-field[data-computed]').forEach(el => {
      el.dataset.computed = total;
      el.textContent = _tplFmt(total, window._activeTplCurrency);
    });
    const amtField = document.getElementById('tfe-amount');
    if (amtField && !amtField._userEdited) amtField.value = total > 0 ? total.toFixed(2) : '';
    return;
  }

  const _isPaired = f => f.type === 'paired';
  const _isNumeric = f => ['number','currency'].includes(f.type);

  // Step 1: seed vals from user inputs
  const vals = {};
  tpl.fields.forEach(f => {
    if (_isPaired(f)) {
      const container = document.getElementById('tf-' + f.id + '-rows');
      let total = 0;
      if (container) container.querySelectorAll('.paired-row').forEach(row => {
        const qty = parseFloat(row.querySelector('.pr-qty')?.value) || 1;
        const price = parseFloat(row.querySelector('.pr-num')?.value) || 0;
        total += qty * price;
      });
      vals[f.id] = total;
      return;
    }
    const el = document.getElementById('tf-' + f.id);
    if (!el || el.tagName === 'DIV') return; // skip computed display divs
    vals[f.id] = parseFloat(el.value) || 0;
  });

  // Step 2: multi-pass computation (up to 4 passes, stop on convergence)
  const _runOnePass = () => {
    tpl.fields.forEach(f => {
      const el = document.getElementById('tf-' + f.id);
      if (!el) return;
      const calcs = f.calculators || [];
      // Legacy: single calcType → convert to calculators format
      if (calcs.length === 0 && f.calcType) {
        calcs.push({ operation: f.calcType, operand: f.calcFactor || 0 });
      }
      if (!calcs.length) return; // only process fields that have calculators

      calcs.forEach(c => {
        let val = 0;
        switch (c.operation) {
          case 'multiply': {
            const tv = c.targetFieldId ? (vals[c.targetFieldId] || 0) : (vals[f.id] || 0);
            val = tv * (parseFloat(c.operand) || 0);
            break;
          }
          case 'add': {
            const tv = c.targetFieldId ? (vals[c.targetFieldId] || 0) : 0;
            val = (vals[f.id] || 0) + tv;
            break;
          }
          case 'subtract': {
            const tv = c.targetFieldId ? (vals[c.targetFieldId] || 0) : 0;
            val = tv - (vals[f.id] || 0);
            break;
          }
          case 'aggregate':
            val = 0;
            tpl.fields.forEach(sf => {
              if (sf.id === f.id) return;
              if (sf.excludeFromAggregate) return;
              if (_isNumeric(sf) || _isPaired(sf) || (sf.calculators||[]).length > 0 || sf.calcType)
                val += vals[sf.id] || 0;
            });
            break;
          case 'select_aggregate':
            val = (c.targetFieldIds || []).reduce((s, fid) => {
              if (fid === f.id) return s;
              return s + (vals[fid] || 0);
            }, 0);
            break;
        }
        vals[f.id] = val;
      });
    });
  };

  // Run passes until convergence
  let prev = '';
  for (let pass = 0; pass < 4; pass++) {
    const snap = JSON.stringify(vals);
    if (pass > 0 && snap === prev) break;
    prev = snap;
    _runOnePass();
  }

  // Step 3: write converged vals to DOM
  let finalTotalVal = null;
  tpl.fields.forEach(f => {
    const el = document.getElementById('tf-' + f.id);
    if (!el || el.tagName !== 'DIV') return;
    const displayVal = vals[f.id] || 0;
    el.dataset.computed = displayVal;

    if (f.isFinalTotal) {
      el.style.border = '2px solid var(--green)';
      el.style.fontSize = '20px';
      el.textContent = _tplFmt(displayVal, window._activeTplCurrency);
      finalTotalVal = displayVal;
    } else {
      el.textContent = _tplFmt(displayVal, window._activeTplCurrency);
    }
  });

  // Step 4: auto-fill amount field
  // Priority: isFinalTotal field → last aggregate → sum all computed
  if (finalTotalVal === null) {
    // Find last aggregate computed field
    for (let i = tpl.fields.length - 1; i >= 0; i--) {
      const f = tpl.fields[i];
      const calcs = f.calculators || [];
      if (calcs.some(c => c.operation === 'aggregate' || c.operation === 'select_aggregate') || f.calcType === 'aggregate') {
        finalTotalVal = vals[f.id] || 0;
        break;
      }
    }
  }
  if (finalTotalVal === null) {
    // No computed/aggregate field — sum all numeric and paired input values directly
    finalTotalVal = 0;
    tpl.fields.forEach(f => {
      if (_isNumeric(f) || _isPaired(f)) finalTotalVal += vals[f.id] || 0;
    });
  }

  const amtField = document.getElementById('tfe-amount');
  if (amtField && !amtField._userEdited) amtField.value = finalTotalVal > 0 ? finalTotalVal.toFixed(2) : '';
};

window.saveTemplateEntry = async function(templateId, invNum) {
  const currentUser = getCurrentUser();
  const contactId = document.getElementById('tfe-contact').value;
  const txType = document.getElementById('tfe-type').value;
  const amount = parseFloat(document.getElementById('tfe-amount').value);
  if (!contactId) return toast('Please search and select a contact.', 'error');
  if (!amount || amount <= 0) return toast('Enter an amount.', 'error');

  // Collect template field data
  const tplData = {};
  window._tplFields?.forEach(f => {
    const el = document.getElementById('tf-' + f.id);
    if (el) {
      if (f.type === 'computed') tplData[f.id] = { label: f.label, value: parseFloat(el.dataset.computed) || 0, type: 'computed' };
      else tplData[f.id] = { label: f.label, value: el.value, type: f.type };
    }
    // Paired rows
    const rows = document.getElementById('tf-' + f.id + '-rows');
    if (rows) {
      const items = [];
      rows.querySelectorAll('.paired-row').forEach(row => {
        const text = row.querySelector('.pr-text')?.value || '';
        const qty = parseFloat(row.querySelector('.pr-qty')?.value) || 1;
        const num = parseFloat(row.querySelector('.pr-num')?.value) || 0;
        if (text || num) items.push({ text, qty, numeric: num });
      });
      tplData[f.id] = { label: f.label, type: 'paired', rows: items, value: items.reduce((s, r) => s + (r.qty * r.numeric), 0) };
    }
  });

  // Build metadata for business context if active
  const _bsMeta = window._bsActiveContext && window._bsActiveBizId
    ? { business_id: window._bsActiveBizId } : null;
  const tfeDueDateVal = document.getElementById('tfe-due-date')?.value || null;
  if (_bsMeta && tfeDueDateVal) _bsMeta.due_date = tfeDueDateVal;
  if (_bsMeta && invNum) _bsMeta.inv_number = invNum;

  // Resolve business_id: BS context → explicit biz, else user's own
  const { getActiveBusinessId, getMyBusinessId } = await import('./state.js');
  const _entryBizId = (window._bsActiveContext && window._bsActiveBizId)
    ? window._bsActiveBizId : getActiveBusinessId() || getMyBusinessId();

  let entry;
  try {
    entry = await createEntry(currentUser.id, {
      contactId, txType, amount,
      currency: document.getElementById('tfe-currency')?.value || window._activeTplCurrency || 'USD',
      date: document.getElementById('tfe-date').value,
      note: document.getElementById('tfe-note').value.trim(),
      invoiceNumber: invNum, templateId, templateData: tplData,
      metadata: _bsMeta,
      businessId: _entryBizId
    });
  } catch (err) {
    toast('Failed to create entry: ' + (err.message || 'Unknown error'), 'error');
    return;
  }

  // Post-save: persist contact_name, due_date, category on entry row
  if (entry?.id) {
    const _postUpdates = {};
    // Resolve contact name
    const _cName = entry?.contact?.name || '';
    if (_cName) _postUpdates.contact_name = _cName;
    // Due date
    if (tfeDueDateVal) _postUpdates.due_date = tfeDueDateVal;
    // Category + direction for invoice types
    const _txCat = { invoice_sent: 'invoice_sent', invoice_received: 'bill_received',
      they_owe_you: 'invoice_sent', you_owe_them: 'bill_received' };
    _postUpdates.category = _txCat[txType] || txType;
    _postUpdates.direction_sign = ['they_owe_you','invoice_sent','loan_given'].includes(txType) ? 1 : -1;
    _postUpdates.outstanding_amount = Math.round(amount * 100);
    // BS sender name
    if (window._bsActiveContext) _postUpdates.from_name = window._getBsSenderName?.() || '';
    if (Object.keys(_postUpdates).length) await supabase.from('entries').update(_postUpdates).eq('id', entry.id);
  }

  // Increment template invoice counter
  const { data: tpl } = await supabase.from('templates').select('invoice_next_num').eq('id', templateId).single();
  if (tpl) await supabase.from('templates').update({ invoice_next_num: (tpl.invoice_next_num || 1) + 1 }).eq('id', templateId);

  closeModal(); toast('Entry created from template!', 'success');

  // Navigate back to BS if we came from there, otherwise entries page
  if (window._bsActiveContext) {
    window._bsActiveContext = false;
    window._bsActiveBizId = '';
    if (document.getElementById('bs-content') && window._bsNavigate) {
      window._bsNavigate('bs-invoices');
    } else {
      navTo('business-suite');
    }
  } else {
    _invalidateEntries(); navTo('entries');
  }
};

window._publicTemplatesCache = null;

window.openPublicTemplateDB = async function() {
  const el = document.getElementById('content');
  el.innerHTML = '<p style="padding:20px;color:var(--muted);">Loading public templates…</p>';

  const templates = await listPublicTemplates();
  window._publicTemplatesCache = templates;

  el.innerHTML = `<div class="page-header">
    <h2>Public Template DB</h2>
    <button class="btn btn-secondary btn-sm" onclick="goBack()">← Back</button>
  </div>
  <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <input id="tpl-search" type="text" placeholder="Search templates…" oninput="filterPublicTemplates(this.value)"
      style="flex:1;min-width:180px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;">
    <select id="tpl-type-filter" onchange="filterPublicTemplates(document.getElementById('tpl-search').value)"
      style="padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;">
      <option value="">All types</option>
      ${Object.entries(TX_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
    </select>
  </div>
  <div id="tpl-db-list"></div>`;

  renderPublicTemplateList(templates);
};

function renderPublicTemplateList(templates) {
  const list = document.getElementById('tpl-db-list');
  if (!list) return;
  if (templates.length === 0) {
    list.innerHTML = `<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No templates match your search.</p></div>`;
    return;
  }
  list.innerHTML = templates.map(t => {
    const fCount = (t.fields || []).length;
    const creator = t.creator?.display_name ? `<span style="color:var(--muted);">by ${esc(t.creator.display_name)}</span>` : '';
    const typeLabel = t.tx_type ? `<span class="badge badge-gray" style="font-size:11px;">${esc(TX_LABELS[t.tx_type] || t.tx_type)}</span>` : '';
    return `<div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-size:15px;font-weight:700;">${esc(t.name)}</span>
            ${typeLabel}
            <span class="badge badge-blue" style="font-size:11px;">${fCount} field${fCount !== 1 ? 's' : ''}</span>
          </div>
          ${t.description ? `<p style="font-size:13px;color:var(--muted);margin:0 0 4px;">${esc(t.description)}</p>` : ''}
          <p style="font-size:12px;color:var(--muted);margin:0;">${creator}</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          <button class="btn btn-primary btn-sm" onclick="doCopyTemplate('${t.id}')">📋 Copy</button>
          <button class="btn btn-secondary btn-sm" onclick="previewPublicTemplate('${t.id}')">👁 Preview</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.filterPublicTemplates = function(query) {
  const typeFilter = document.getElementById('tpl-type-filter')?.value || '';
  const q = (query || '').toLowerCase();
  const all = window._publicTemplatesCache || [];
  const filtered = all.filter(t => {
    const matchesText = !q ||
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.creator?.display_name || '').toLowerCase().includes(q) ||
      (t.fields || []).some(f => (f.label || '').toLowerCase().includes(q));
    const matchesType = !typeFilter || t.tx_type === typeFilter;
    return matchesText && matchesType;
  });
  renderPublicTemplateList(filtered);
};

window.previewPublicTemplate = function(id) {
  const t = (window._publicTemplatesCache || []).find(x => x.id === id);
  if (!t) return;
  const fields = (t.fields || []).map(f =>
    `<li style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;"><strong>${esc(f.label)}</strong> <span style="color:var(--muted);">[${f.type}]</span>${f.value ? ` = ${f.value}` : ''}</li>`
  ).join('');
  openModal(`
    <div style="max-width:480px;">
      <h3 style="margin-bottom:4px;">${esc(t.name)}</h3>
      ${t.description ? `<p style="color:var(--muted);font-size:13px;margin-bottom:12px;">${esc(t.description)}</p>` : ''}
      <ul style="list-style:none;padding:0;margin:0 0 16px;">${fields || '<li style="color:var(--muted);">No fields defined.</li>'}</ul>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="doCopyTemplate('${id}');closeModal()">📋 Copy to My Templates</button>
        <button class="bs sm" onclick="closeModal()">Close</button>
      </div>
    </div>
  `);
};

window.doCopyTemplate = async function(id) {
  const currentUser = getCurrentUser();
  // Use businessId from BS context if available, otherwise use userId
  const bizUuid = getMyBusinessId();
  await copyPublicTemplate(bizUuid, currentUser.id, id);
  toast('Template copied!', 'success');
  if (document.getElementById('bs-content') && window._bsNavigate) { window._bsNavigate('bs-templates'); return; }
  navTo('templates');
};
window.toggleTemplatePublic = async function(id, pub) {
  await togglePublic(id, pub);
  toast(pub ? 'Template is now public.' : 'Template is now private.', 'success');
  if (document.getElementById('bs-content') && window._bsNavigate) { window._bsNavigate('bs-templates'); return; }
  navTo('templates');
};
window.confirmDeleteTemplate = async function(id) {
  if (!confirm('Delete this template?')) return;
  await deleteTemplate(id); toast('Deleted.', 'success');
  if (document.getElementById('bs-content') && window._bsNavigate) { window._bsNavigate('bs-templates'); return; }
  navTo('templates');
};



export { renderTemplatesPage };
