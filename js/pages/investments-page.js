// Money IntX — Investments Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile, getMyBusinessId } from './state.js';
import { esc, toast, fmtDate, openModal, closeModal } from '../ui.js';
import { fmtMoney } from '../entries.js';
import { supabase } from '../supabase.js';
import { listContacts } from '../contacts.js';
import {
  createInvestment, getInvestment, deleteInvestment,
  addInvestmentMember, updateInvestmentMember, removeInvestmentMember,
  addInvestmentTransaction,
  calcInvestmentStats
} from '../investments.js';

let _selectedInvestments = new Set();

// Global investment type/status mappings (expected to be on window)
// INV_TYPES, INV_STATUSES, currentUser, currentProfile should be available

export async function renderInvestments(el) {
  el.innerHTML = '<div class="page-header"><h2>📈 Investments</h2></div><p style="color:var(--muted);padding:20px;">Loading...</p>';

  const currentUser = getCurrentUser();
  let investments = [];
  try {
    // Parallelise: owned investments + membership rows fetched simultaneously
    const [ownedRes, memberRes] = await Promise.all([
      supabase.from('investments')
        .select('*, members:investment_members(*), transactions:investment_transactions(*)')
        .eq('user_id', currentUser.id).is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('investment_members')
        .select('investment_id').eq('user_id', currentUser.id)
    ]);
    const { data, error } = ownedRes;
    if (error) throw error;
    const memberRows = memberRes.data;
    const memberIds = (memberRows || []).map(r => r.investment_id).filter(id => !data?.find(d => d.id === id));
    if (memberIds.length > 0) {
      const { data: memberInvs } = await supabase
        .from('investments')
        .select('*, members:investment_members(*), transactions:investment_transactions(*)')
        .in('id', memberIds)
        .is('archived_at', null);
      investments = [...(data || []), ...(memberInvs || [])];
    } else {
      investments = data || [];
    }
  } catch(err) {
    el.innerHTML = `<div class="page-header"><h2>📈 Investments</h2><button class="btn btn-primary btn-sm" onclick="openNewInvestmentModal()">+ New</button></div>
      <div class="card" style="color:var(--red);padding:20px;">Error loading investments: ${esc(err.message)}<br><small>Make sure the investments table exists (run SQL migration 001_foundation.sql).</small></div>`;
    return;
  }

  let html = `<div class="page-header">
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="investment-logo.png" alt="Investments" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" onerror="this.style.display='none'">
      <div><h2 style="margin:0;">Investments</h2><p style="font-size:13px;color:var(--muted);margin-top:2px;">${investments.length} investment${investments.length !== 1 ? 's' : ''}</p></div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="openNewInvestmentModal()">+ New Investment</button>
  </div>`;

  if (investments.length === 0) {
    html += `<div class="card" style="text-align:center;padding:48px 24px;">
      <div style="font-size:48px;margin-bottom:12px;">📈</div>
      <div style="font-size:17px;font-weight:700;margin-bottom:8px;">No investments yet</div>
      <p style="color:var(--muted);font-size:13px;max-width:360px;margin:0 auto 20px;">Track personal or shared investments — stocks, real estate, business ventures, crypto, and more.</p>
      <button class="btn btn-primary" onclick="openNewInvestmentModal()">+ Create First Investment</button>
    </div>`;
  } else {
    let totalInvested = 0, totalReturns = 0;
    investments.forEach(inv => { const s = window.calcInvestmentStats(inv); totalInvested += s.invested; totalReturns += s.currentVal; });
    const totalGl = totalReturns - totalInvested;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-lbl">Total Invested</div><div class="stat-val" style="font-size:17px;">${fmtMoney(totalInvested)}</div></div>
      <div class="stat-card"><div class="stat-lbl">Current Value</div><div class="stat-val" style="font-size:17px;">${fmtMoney(totalReturns)}</div></div>
      <div class="stat-card"><div class="stat-lbl">Overall G/L</div><div class="stat-val" style="font-size:17px;color:${totalGl>=0?'var(--green)':'var(--red)'};">${totalGl>=0?'+':''}${fmtMoney(totalGl)}</div></div>
    </div>`;

    // Bulk action bar
    if (_selectedInvestments.size > 0) {
      html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--accent);border-radius:8px;margin-bottom:12px;color:#fff;">
        <span style="font-size:13px;font-weight:700;">${_selectedInvestments.size} selected</span>
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button class="bs sm" onclick="bulkDeleteInvestments()" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Delete</button>
          <button class="bs sm" onclick="clearInvestmentSelection()" style="background:rgba(255,255,255,.15);color:#fff;border:none;padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">✕ Clear</button>
        </div>
      </div>`;
    }

    investments.forEach(inv => {
      const stats = window.calcInvestmentStats(inv);
      const isOwner = inv.user_id === currentUser.id;
      const partners = (inv.members || []).filter(m => m.role !== 'owner');
      const statusColors = { active:'badge-green', matured:'badge-blue', closed:'badge-gray', lost:'badge-red' };
      html += `<div class="card" style="margin-bottom:12px;position:relative;">
        <label style="position:absolute;top:10px;right:42px;cursor:pointer;" onclick="event.stopPropagation();"><input type="checkbox" ${_selectedInvestments.has(inv.id)?'checked':''} onchange="toggleInvestmentSel('${inv.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></label>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <h3 style="font-size:16px;margin:0;cursor:pointer;font-weight:700;" onclick="openInvestmentDetail('${inv.id}')">${esc(inv.name)}</h3>
              <span class="badge badge-gray">${esc(window.INV_TYPES[inv.type] || inv.type)}</span>
              <span class="badge ${statusColors[inv.status]||'badge-gray'}">${esc(window.INV_STATUSES[inv.status] || inv.status)}</span>
              ${partners.length > 0 ? `<span class="badge badge-blue">👥 ${partners.length} partner${partners.length!==1?'s':''}</span>` : ''}
            </div>
            ${inv.description ? `<p style="font-size:12px;color:var(--muted);margin-bottom:8px;">${esc(inv.description)}</p>` : ''}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px;margin-top:8px;">
              <div style="background:var(--bg3);border-radius:8px;padding:8px 10px;">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">Invested</div>
                <div style="font-size:15px;font-weight:800;margin-top:1px;">${fmtMoney(stats.invested, inv.currency)}</div>
              </div>
              <div style="background:var(--bg3);border-radius:8px;padding:8px 10px;">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">Current</div>
                <div style="font-size:15px;font-weight:800;margin-top:1px;">${fmtMoney(stats.currentVal, inv.currency)}</div>
              </div>
              <div style="background:${stats.gl>=0?'rgba(74,222,128,.08)':'rgba(248,113,113,.08)'};border-radius:8px;padding:8px 10px;">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">G/L</div>
                <div style="font-size:15px;font-weight:800;margin-top:1px;color:${stats.gl>=0?'var(--green)':'var(--red)'};">${stats.gl>=0?'+':''}${fmtMoney(stats.gl, inv.currency)}</div>
              </div>
              <div style="background:var(--bg3);border-radius:8px;padding:8px 10px;">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">ROI</div>
                <div style="font-size:15px;font-weight:800;margin-top:1px;color:${parseFloat(stats.roi)>=0?'var(--green)':'var(--red)'};">${stats.roi}%</div>
              </div>
            </div>
          </div>
          <div class="action-menu">
            <button class="action-menu-btn" onclick="window.toggleActionMenu(this)">⋮</button>
            <div class="action-dropdown">
              <button onclick="openInvestmentDetail('${inv.id}')">👁 View</button>
              ${isOwner ? `<button onclick="openAddInvTxModal('${inv.id}')">+ Transaction</button>` : ''}
              ${isOwner ? `<button onclick="openAddInvPartnerModal('${inv.id}')">+ Partner</button>` : ''}
              ${isOwner ? `<button onclick="confirmDeleteInvestment('${inv.id}')" style="color:var(--red);">Delete</button>` : ''}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border);margin-top:10px;">
          <button class="btn btn-secondary btn-sm" onclick="openInvestmentDetail('${inv.id}')">View</button>
          ${isOwner ? `<button class="btn btn-secondary btn-sm" onclick="openAddInvTxModal('${inv.id}')">+ Transaction</button>` : ''}
          ${isOwner ? `<button class="btn btn-secondary btn-sm" onclick="openAddInvPartnerModal('${inv.id}')">+ Partner</button>` : ''}
        </div>
      </div>`;
    });
  }
  el.innerHTML = html;
}

// V1-style investment creation modal — name, type, amount, partners, access all at once
window.openNewInvestmentModal = async function() {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const contacts = await listContacts(getMyBusinessId());
  const contactOpts = contacts.map(c => `<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  window._newInvPartners = []; // [{contactId, name}]

  openModal(`
    <div class="modal-title">New Investment</div>

    <div class="form-group"><label>Name *</label><input type="text" id="ni-name" placeholder="e.g. Property Lagos, Tech Portfolio"></div>
    <div class="form-row">
      <div class="form-group"><label>Type</label><select id="ni-type">${Object.entries(window.INV_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="form-group"><label>Status</label><select id="ni-status">
        <option value="active">Active</option><option value="matured">Matured</option>
        <option value="closed">Closed</option><option value="lost">Lost</option>
      </select></div>
    </div>
    <div class="form-group"><label>Description</label><textarea id="ni-desc" rows="2" placeholder="What is this investment about?"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Initial Amount</label><input type="number" id="ni-amount" min="0" step="0.01" placeholder="0.00"></div>
      <div class="form-group"><label>Currency</label><select id="ni-currency">
        ${['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','AED','SAR','BRL','EGP','MAD','TZS','UGX','ETB','XOF'].map(c=>`<option value="${c}" ${(currentProfile?.default_currency||'USD')===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-group"><label>Expected Return %</label><input type="number" id="ni-return" step="0.1" placeholder="e.g. 12.5"></div>

    <!-- Venture type -->
    <div class="form-group" style="margin-top:4px;">
      <label>Venture Type</label>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border-radius:8px;border:2px solid var(--accent);background:rgba(108,99,255,.08);cursor:pointer;font-size:13px;font-weight:600;">
          <input type="radio" name="ni-venture" value="personal" checked style="accent-color:var(--accent);" onchange="document.getElementById('ni-partners-section').style.display='none'"> 👤 Personal
        </label>
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border-radius:8px;border:2px solid var(--border);cursor:pointer;font-size:13px;font-weight:500;">
          <input type="radio" name="ni-venture" value="shared" style="accent-color:var(--accent);" onchange="document.getElementById('ni-partners-section').style.display=''"> 👥 Shared
        </label>
      </div>
    </div>

    <!-- Partners section (shown when shared) -->
    <div id="ni-partners-section" style="display:none;">
      <div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Partners</div>
      <div id="ni-partners-list" style="margin-bottom:8px;"></div>
      <div style="display:flex;gap:6px;">
        <select id="ni-partner-select" style="flex:1;">${contactOpts||'<option value="">No contacts</option>'}</select>
        <button type="button" class="bs sm" onclick="_niAddPartner()">+ Add</button>
      </div>
    </div>


    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn sm" onclick="doCreateInvestment()">Create Investment</button>
    </div>
  `, { maxWidth: '500px' });
};

window._niAddPartner = function() {
  const sel = document.getElementById('ni-partner-select');
  const cId = sel.value;
  const cName = sel.options[sel.selectedIndex]?.dataset?.name || 'Member';
  if (!cId || window._newInvPartners.find(p => p.contactId === cId)) return;
  window._newInvPartners.push({ contactId: cId, name: cName });
  const list = document.getElementById('ni-partners-list');
  if (list) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg3);border-radius:7px;margin-bottom:6px;font-size:13px;';
    div.dataset.cid = cId;
    div.innerHTML = `<span>👤 ${esc(cName)}</span><button type="button" class="bs sm" style="font-size:11px;color:var(--red);padding:2px 8px;" onclick="this.closest('[data-cid]').remove();window._newInvPartners=window._newInvPartners.filter(p=>p.contactId!=='${cId}')">✕</button>`;
    list.appendChild(div);
  }
};

window.doCreateInvestment = async function() {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const name = document.getElementById('ni-name').value.trim();
  if (!name) return toast('Name required.', 'error');
  const ventureType = document.querySelector('input[name="ni-venture"]:checked')?.value || 'personal';
  // Use businessId from BS context if available, otherwise use userId
  // Use BS context business when creating from Business Suite, else own business
  const { getActiveBusinessId } = await import('./state.js');
  const bizUuid = (window._bsCreatingInvestment && window._bsContext?.businessId)
    ? window._bsContext.businessId
    : getActiveBusinessId();
  const inv = await createInvestment(bizUuid, currentUser.id, {
    name,
    description: document.getElementById('ni-desc').value.trim(),
    type: document.getElementById('ni-type').value,
    status: document.getElementById('ni-status').value,
    currency: document.getElementById('ni-currency').value || 'USD',
    ventureType,
    accessMode: ventureType === 'shared' ? 'members_only' : 'private',
    initialAmount: parseFloat(document.getElementById('ni-amount').value) || 0,
    expectedReturn: parseFloat(document.getElementById('ni-return').value) || null
  });
  if (!inv) return toast('Failed to create investment. Check console.', 'error');
  // Add partners
  const partners = window._newInvPartners || [];
  for (const p of partners) {
    await addInvestmentMember(inv.id, { contactId: p.contactId, name: p.name, role: 'partner' });
  }
  closeModal();
  toast(`Investment "${name}" created${partners.length > 0 ? ` with ${partners.length} partner${partners.length!==1?'s':''}` : ''}.`, 'success');

  // Business Suite after-save hook
  if (window._bsCreatingInvestment && inv?.id) {
    if (typeof window._invAfterSave === 'function') window._invAfterSave(inv.id);
    window._bsCreatingInvestment = false;
    if (window._bsNavigate) { window._bsNavigate('bs-investments'); return; }
  }
  window.navTo('investments');
};

window.openInvestmentDetail = async function(id) {
  const currentUser = getCurrentUser();
  const inv = await getInvestment(id);
  if (!inv) return toast('Not found.', 'error');
  const stats = window.calcInvestmentStats(inv);
  const txs = (inv.transactions || []).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const isOwner = inv.user_id === currentUser.id;
  const members = inv.members || [];

  // Fetch notice board posts
  let notices = [];
  try {
    const { data } = await supabase.from('notice_board').select('*').eq('investment_id', id).order('created_at', { ascending: false }).limit(20);
    notices = data || [];
  } catch(_) {}

  // Fetch documents
  let docs = [];
  try {
    const { data } = await supabase.from('investment_documents').select('*').eq('investment_id', id).order('created_at', { ascending: false }).limit(20);
    docs = data || [];
  } catch(_) {}

  const ROLES = ['owner','admin','partner','investor','advisor','observer','member'];
  const membersHtml = members.map(m => {
    const isSelf = m.user_id === currentUser.id;
    const roleSelect = isOwner && !isSelf
      ? `<select onchange="window._changeInvMemberRole('${m.id}','${id}',this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--text);">
          ${ROLES.map(r => `<option value="${r}" ${m.role===r?'selected':''}>${r.charAt(0).toUpperCase()+r.slice(1)}</option>`).join('')}
        </select>`
      : `<span class="badge badge-gray" style="font-size:10px;">${esc(m.role)}</span>`;
    const removeBtn = isOwner && !isSelf
      ? `<button class="bs sm" style="font-size:11px;color:var(--red);" onclick="window._removeInvMember('${m.id}','${id}')">Remove</button>`
      : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <div style="display:flex;align-items:center;gap:8px;"><span style="font-weight:600;">${esc(m.name)}</span>${roleSelect}</div>
      ${removeBtn}
    </div>`;
  }).join('') || '<p style="color:var(--muted);font-size:13px;">No members.</p>';

  const txHtml = txs.length === 0 ? '<p style="color:var(--muted);font-size:13px;">No transactions yet.</p>' :
    txs.slice(0,10).map(t=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <div><span style="font-weight:600;text-transform:capitalize;">${esc(t.type.replace(/_/g,' '))}</span>${t.note?` <span style="color:var(--muted);">— ${esc(t.note)}</span>`:''}
      <div style="font-size:11px;color:var(--muted);">${fmtDate(t.created_at)}</div></div>
      <div style="font-weight:700;color:${['deposit','capital_contribution','revenue','dividend','return'].includes(t.type)?'var(--green)':'var(--red)'};">${['deposit','capital_contribution','revenue','dividend','return'].includes(t.type)?'+':'−'}${fmtMoney(t.amount,inv.currency)}</div>
    </div>`).join('');

  const noticesHtml = notices.length === 0
    ? '<p style="color:var(--muted);font-size:13px;">No notices yet. Post the first update.</p>'
    : notices.map(n => `<div style="padding:10px;background:var(--bg3);border-radius:8px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-weight:600;font-size:13px;">${esc(n.user_name)}</span>
          <span style="font-size:11px;color:var(--muted);">${fmtDate(n.created_at)}</span>
        </div>
        <div style="font-size:13px;white-space:pre-wrap;word-break:break-word;">${esc(n.message)}</div>
      </div>`).join('');

  const docsHtml = docs.length === 0
    ? '<p style="color:var(--muted);font-size:13px;">No documents uploaded yet.</p>'
    : docs.map(d => {
        const sizeKb = d.file_size ? (d.file_size / 1024).toFixed(1) + ' KB' : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--bg3);border-radius:8px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.file_name)}</div>
            <div style="font-size:11px;color:var(--muted);">${sizeKb} · ${fmtDate(d.created_at)}${d.note ? ' · ' + esc(d.note) : ''}</div>
          </div>
          <button class="bs sm" style="flex-shrink:0;font-size:11px;" onclick="window._downloadInvDoc('${d.file_path}','${esc(d.file_name)}')">Download</button>
        </div>`;
      }).join('');

  // Store current investment ID for post/upload handlers
  window._invDetailId = id;

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
      <div>
        <h3 style="margin:0;">${esc(inv.name)}</h3>
        <div style="display:flex;gap:6px;margin-top:4px;">
          <span class="badge badge-gray">${esc(window.INV_TYPES[inv.type]||inv.type)}</span>
          <span class="badge badge-${inv.status==='active'?'green':inv.status==='matured'?'blue':'gray'}">${esc(window.INV_STATUSES[inv.status]||inv.status)}</span>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Close</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-lbl">Invested</div><div class="stat-val" style="font-size:17px;">${fmtMoney(stats.invested,inv.currency)}</div></div>
      <div class="stat-card"><div class="stat-lbl">Current Value</div><div class="stat-val" style="font-size:17px;">${fmtMoney(stats.currentVal,inv.currency)}</div></div>
      <div class="stat-card"><div class="stat-lbl" style="color:${stats.gl>=0?'var(--green)':'var(--red)'};">Gain/Loss</div><div class="stat-val" style="font-size:17px;color:${stats.gl>=0?'var(--green)':'var(--red)'};">${stats.gl>=0?'+':''}${fmtMoney(stats.gl,inv.currency)}</div></div>
      <div class="stat-card"><div class="stat-lbl">ROI</div><div class="stat-val" style="font-size:17px;color:${parseFloat(stats.roi)>=0?'var(--green)':'var(--red)'};">${stats.roi}%</div></div>
    </div>
    ${inv.description?`<p style="color:var(--muted);font-size:13px;margin-bottom:14px;">${esc(inv.description)}</p>`:''}

    <!-- Tabs: Overview | Notice Board | Documents -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:14px;">
      <button class="bs sm inv-detail-tab" data-tab="overview" onclick="window._invDetailTab('overview')" style="border-bottom:2px solid var(--accent);font-weight:700;border-radius:8px 8px 0 0;padding:8px 14px;">Overview</button>
      <button class="bs sm inv-detail-tab" data-tab="notices" onclick="window._invDetailTab('notices')" style="border-radius:8px 8px 0 0;padding:8px 14px;">Notice Board (${notices.length})</button>
      <button class="bs sm inv-detail-tab" data-tab="docs" onclick="window._invDetailTab('docs')" style="border-radius:8px 8px 0 0;padding:8px 14px;">Documents (${docs.length})</button>
    </div>

    <!-- Tab: Overview -->
    <div id="inv-tab-overview">
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h4 style="font-size:14px;font-weight:700;">Partners (${members.length})</h4>
          ${isOwner?`<button class="btn btn-primary btn-sm" style="font-size:11px;" onclick="closeModal();openAddInvPartnerModal('${inv.id}')">+ Partner</button>`:''}
        </div>
        ${membersHtml}
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h4 style="font-size:14px;font-weight:700;">Transactions</h4>
          ${isOwner?`<button class="btn btn-primary btn-sm" style="font-size:11px;" onclick="closeModal();openAddInvTxModal('${inv.id}')">+ Add</button>`:''}
        </div>
        ${txHtml}
      </div>
    </div>

    <!-- Tab: Notice Board -->
    <div id="inv-tab-notices" style="display:none;">
      <div style="margin-bottom:12px;">
        <textarea id="inv-notice-msg" rows="2" placeholder="Post an update or notice…" style="width:100%;box-sizing:border-box;font-size:13px;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg2);color:var(--text);resize:vertical;"></textarea>
        <div style="text-align:right;margin-top:6px;">
          <button class="btn btn-primary btn-sm" onclick="window._postInvNotice('${id}')">Post Notice</button>
        </div>
      </div>
      <div id="inv-notices-list" style="max-height:250px;overflow-y:auto;">
        ${noticesHtml}
      </div>
    </div>

    <!-- Tab: Documents -->
    <div id="inv-tab-docs" style="display:none;">
      <div style="margin-bottom:12px;padding:12px;border:2px dashed var(--border);border-radius:10px;text-align:center;">
        <input type="file" id="inv-doc-upload" multiple onchange="window._handleInvDocUpload('${id}', this.files)" style="display:none;">
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('inv-doc-upload').click()">Choose Files</button>
        <p style="font-size:11px;color:var(--muted);margin-top:6px;">Upload receipts, contracts, or any documents</p>
      </div>
      <div id="inv-docs-list">
        ${docsHtml}
      </div>
    </div>
  `, { maxWidth:'600px' });
};

// ── Investment Detail Tabs ────────────────────────────────────────
window._invDetailTab = function(tab) {
  ['overview','notices','docs'].forEach(t => {
    const el = document.getElementById('inv-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.inv-detail-tab').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.style.borderBottom = isActive ? '2px solid var(--accent)' : '';
    btn.style.fontWeight = isActive ? '700' : '';
  });
};

// ── Post Notice ───────────────────────────────────────────────────
window._postInvNotice = async function(invId) {
  const msgEl = document.getElementById('inv-notice-msg');
  const msg = msgEl?.value?.trim();
  if (!msg) return toast('Write a message first.', 'warning');
  const user = getCurrentUser();
  const profile = getCurrentProfile();
  const { error } = await supabase.from('notice_board').insert({
    investment_id: invId,
    user_id: user.id,
    user_name: profile?.display_name || user.email,
    message: msg
  });
  if (error) return toast('Failed to post: ' + error.message, 'error');
  toast('Notice posted.', 'success');
  closeModal();
  openInvestmentDetail(invId);
};

// ── Upload Investment Documents ───────────────────────────────────
window._handleInvDocUpload = async function(invId, fileList) {
  if (!fileList || !fileList.length) return;
  const user = getCurrentUser();
  let uploaded = 0;
  for (const file of fileList) {
    const path = `${user.id}/${invId}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage.from('investment-docs').upload(path, file);
    if (uploadErr) { toast('Upload failed: ' + uploadErr.message, 'error'); continue; }
    const { error: dbErr } = await supabase.from('investment_documents').insert({
      investment_id: invId,
      user_id: user.id,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type
    });
    if (dbErr) { toast('Failed to save record: ' + dbErr.message, 'error'); continue; }
    uploaded++;
  }
  if (uploaded > 0) {
    toast(`${uploaded} file${uploaded > 1 ? 's' : ''} uploaded.`, 'success');
    closeModal();
    openInvestmentDetail(invId);
  }
};

// ── Download Investment Document ──────────────────────────────────
window._downloadInvDoc = async function(path, fileName) {
  const { data, error } = await supabase.storage.from('investment-docs').download(path);
  if (error || !data) return toast('Download failed: ' + (error?.message || 'unknown'), 'error');
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ── Change Investment Member Role ─────────────────────────────────
window._changeInvMemberRole = async function(memberId, invId, newRole) {
  const result = await updateInvestmentMember(memberId, { role: newRole });
  if (!result) return toast('Failed to update role.', 'error');
  toast('Role updated.', 'success');
};

// ── Remove Investment Member ──────────────────────────────────────
window._removeInvMember = async function(memberId, invId) {
  if (!confirm('Remove this member from the investment?')) return;
  const ok = await removeInvestmentMember(memberId);
  if (!ok) return toast('Failed to remove member.', 'error');
  toast('Member removed.', 'success');
  closeModal();
  openInvestmentDetail(invId);
};

window.openAddInvPartnerModal = async function(invId) {
  const currentUser = getCurrentUser();
  const contacts = await listContacts(getMyBusinessId());

  // Store for searchable typeahead
  window._ipmContacts = contacts;
  window._invAddPartnerInvId = invId;

  openModal(`
    <h3 style="margin-bottom:16px;">Add Partner</h3>
    <div class="form-group">
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>Contact</span>
        <button type="button" onclick="window._bsAddNewContactForInvPartner()" style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;font-weight:700;">+ Add New</button>
      </label>
      <div style="position:relative;">
        <input type="text" id="ipm-contact-search" placeholder="Search contacts…" autocomplete="off"
          style="width:100%;" oninput="window._filterIpmContacts(this.value)" onfocus="window._filterIpmContacts(this.value)">
        <input type="hidden" id="ipm-contact" value="">
        <input type="hidden" id="ipm-contact-name" value="">
        <div id="ipm-contact-list" style="position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border);border-radius:8px;max-height:180px;overflow-y:auto;z-index:999;display:none;"></div>
      </div>
    </div>
    <div class="form-group"><label>Role</label><select id="ipm-role">
      <option value="partner">Partner</option>
      <option value="investor">Investor</option>
      <option value="advisor">Advisor</option>
      <option value="observer">Observer</option>
    </select></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn sm" onclick="doAddInvPartner('${invId}')">Add Partner</button>
    </div>
  `);
};

// Searchable contact picker for investment partner modal
window._filterIpmContacts = function(q) {
  const list = document.getElementById('ipm-contact-list');
  if (!list) return;
  const contacts = window._ipmContacts || [];
  const filtered = q ? contacts.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : contacts;
  if (filtered.length === 0) { list.style.display = 'none'; return; }
  list.innerHTML = filtered.slice(0, 12).map(c =>
    `<div style="padding:8px 12px;cursor:pointer;font-size:13px;" onmousedown="window._selectIpmContact('${c.id}','${esc(c.name)}')"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      ${esc(c.name)}${c.email ? `<span style="color:var(--muted);font-size:11px;margin-left:6px;">${esc(c.email)}</span>` : ''}
    </div>`
  ).join('');
  list.style.display = 'block';
};
window._selectIpmContact = function(id, name) {
  document.getElementById('ipm-contact').value = id;
  document.getElementById('ipm-contact-name').value = name;
  document.getElementById('ipm-contact-search').value = name;
  document.getElementById('ipm-contact-list').style.display = 'none';
};
// Close dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('#ipm-contact-search') && !e.target.closest('#ipm-contact-list')) {
    const list = document.getElementById('ipm-contact-list');
    if (list) list.style.display = 'none';
  }
});

window._bsAddNewContactForInvPartner = async function() {
  if (typeof window._bsAddNewContact === 'function') {
    window._bsAddNewContact(function(c) {
      if (c) {
        // Add to cached contacts and pre-fill
        if (window._ipmContacts) window._ipmContacts.push(c);
        closeModal();
        window.openAddInvPartnerModal(window._invAddPartnerInvId);
        // Pre-fill after modal re-opens
        setTimeout(() => {
          const search = document.getElementById('ipm-contact-search');
          const hidden = document.getElementById('ipm-contact');
          const hiddenName = document.getElementById('ipm-contact-name');
          if (search) search.value = c.name;
          if (hidden) hidden.value = c.id;
          if (hiddenName) hiddenName.value = c.name;
        }, 100);
      }
    });
  }
};

window.doAddInvPartner = async function(invId) {
  const cId = document.getElementById('ipm-contact')?.value;
  const cName = document.getElementById('ipm-contact-name')?.value || 'Partner';
  const role = document.getElementById('ipm-role').value;
  if (!cId) return toast('Search and select a contact first.', 'error');
  try {
    const result = await addInvestmentMember(invId, { contactId: cId, name: cName, role });
    if (!result) return toast('Failed to add partner. Check console.', 'error');
    closeModal();
    toast('Partner added.', 'success');
    // Stay in BS if inside Business Suite
    if (document.getElementById('bs-content') && window._bsNavigate) {
      window._bsNavigate('bs-investments'); return;
    }
    window.navTo('investments');
  } catch (err) {
    console.error('Error adding partner:', err);
    toast('Error: ' + (err.message || 'Unknown error'), 'error');
  }
};

window.openAddInvTxModal = function(invId) {
  openModal(`
    <h3 style="margin-bottom:16px;">Add Transaction</h3>
    <div class="form-group"><label>Type</label><select id="itx-type">
      <option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option>
      <option value="dividend">Dividend</option><option value="return">Return</option>
      <option value="capital_contribution">Capital Contribution</option>
      <option value="expense">Expense</option><option value="revenue">Revenue</option>
      <option value="profit_distribution">Profit Distribution</option>
    </select></div>
    <div class="form-row">
      <div class="form-group"><label>Amount *</label><input type="number" id="itx-amount" min="0" step="0.01" placeholder="0.00"></div>
      <div class="form-group"><label>Date</label><input type="date" id="itx-date" value="${new Date().toISOString().slice(0,10)}"></div>
    </div>
    <div class="form-group"><label>Note</label><input type="text" id="itx-note" placeholder="Optional description"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn sm" onclick="doAddInvTx('${invId}')">Add Transaction</button>
    </div>
  `);
};

window.doAddInvTx = async function(invId) {
  const currentUser = getCurrentUser();
  const amount = parseFloat(document.getElementById('itx-amount').value);
  if (!amount || amount <= 0) return toast('Enter valid amount.', 'error');
  const result = await addInvestmentTransaction(invId, {
    type: document.getElementById('itx-type').value,
    amount,
    note: document.getElementById('itx-note').value.trim(),
    recordedBy: currentUser.id
  });
  if (!result) return toast('Failed to add transaction.', 'error');
  closeModal();
  toast('Transaction added.', 'success');
  if (document.getElementById('bs-content') && window._bsNavigate) {
    window._bsNavigate('bs-investments'); return;
  }
  window.navTo('investments');
};

window.confirmDeleteInvestment = async function(id) {
  if (!confirm('Delete this investment? This cannot be undone.')) return;
  await deleteInvestment(id);
  toast('Investment deleted.', 'success');
  if (document.getElementById('bs-content') && window._bsNavigate) {
    window._bsNavigate('bs-investments'); return;
  }
  window.navTo('investments');
};

window.toggleInvestmentSel = function(id, checked) {
  if (checked) _selectedInvestments.add(id); else _selectedInvestments.delete(id);
  renderInvestments(document.getElementById('content'));
};

window.clearInvestmentSelection = function() {
  _selectedInvestments.clear();
  renderInvestments(document.getElementById('content'));
};

window.bulkDeleteInvestments = async function() {
  if (_selectedInvestments.size === 0) return;
  if (!confirm(`Delete ${_selectedInvestments.size} investment(s)? This cannot be undone.`)) return;
  const ids = [..._selectedInvestments];
  for (const id of ids) {
    await deleteInvestment(id);
  }
  _selectedInvestments.clear();
  toast(`${ids.length} investment(s) deleted`, 'success');
  renderInvestments(document.getElementById('content'));
};
