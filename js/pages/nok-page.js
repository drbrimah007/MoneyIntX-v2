// Money IntX — NOK/Trusted Access Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile } from './state.js';
import { esc, toast, openModal, closeModal } from '../ui.js';
import { supabase } from '../supabase.js';
import { listTrustees } from '../nok.js';

// LOCKER_TYPES may need to be defined globally
// Various functions like _lockerIsUnlocked, requestLockerOtp, etc. are global window functions

// ── Trusted Access (NOK) ──────────────────────────────────────────
const LOCKER_TYPES = ['physical','personal','digital','financial','legal','other'];

async function renderNokPage(el) {
  el.innerHTML = '<p style="color:var(--muted);padding:20px;">Loading…</p>';
  const [trusteesResult, lockersResult] = await Promise.all([
    listTrustees(currentUser.id),
    supabase.from('asset_lockers').select('id,type,title,asset_key,location,access,notes,primary_trustee,other_trustees').eq('user_id', currentUser.id).order('created_at', { ascending: false })
  ]);
  const trustees = trusteesResult || [];
  const myLockers = lockersResult.data || [];
  const lockersUnlocked = _lockerIsUnlocked();

  let html = `<div class="page-header" style="align-items:center;">
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="font-size:44px;line-height:1;">🔐</div>
      <div>
        <h2 style="margin:0;">Next of Kin <span style="font-size:14px;font-weight:500;color:var(--muted);">(Trusted Access)</span></h2>
        <p style="font-size:13px;color:var(--accent);font-weight:600;margin:2px 0 0;">Information Release &amp; Continuity System</p>
      </div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="openNewTrusteeModal()">+ Add Trusted Contact</button>
  </div>`;

  html += `<div style="background:linear-gradient(135deg,rgba(255,255,255,0.04),rgba(108,99,255,0.07));border:1px solid rgba(255,255,255,0.09);border-radius:12px;padding:14px 18px;margin-bottom:16px;font-size:13px;line-height:1.75;">
    <strong style="color:var(--accent);">"Your financial memory doesn't end with you — not in death, not in incapacity, not in absence."</strong><br>
    <span style="color:var(--muted);">Designate trusted contacts who can access your records when you're gone, incapacitated, or simply unavailable. Set access levels, activation conditions, and stay in full control. This releases <strong>information only</strong> — not money or legal title.</span>
  </div>`;
  if (trustees.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;">
      <div style="font-size:44px;margin-bottom:12px;">🔐</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;">No Trusted Contacts yet</div>
      <div style="font-size:13px;color:var(--muted);max-width:420px;margin:0 auto 20px;">Add trusted people who should be able to access your records if you're unavailable. You control what they can see and when.</div>
      <button class="btn" onclick="openNewTrusteeModal()">+ Designate First Trusted Contact</button>
    </div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:12px;">`;
    trustees.forEach(t => {
      html += `<div class="card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <span style="font-size:16px;font-weight:700;">${esc(t.trustee_name)}</span>
              <span class="badge ${t.verified ? 'badge-green' : 'badge-gray'}">${t.verified ? '✓ Verified' : 'Unverified'}</span>
              <span class="badge badge-blue">${esc(t.access_level || 'view_only')}</span>
              ${t.activated ? '<span class="badge badge-red">ACTIVATED</span>' : ''}
            </div>
            <div style="font-size:13px;color:var(--muted);">${esc(t.trustee_email)}${t.relationship ? ' · ' + esc(t.relationship) : ''}</div>
            <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
              <span style="background:var(--bg3);padding:3px 8px;border-radius:6px;font-size:12px;color:var(--muted);">📄 ${esc(t.release_type || 'manual')}${t.release_type === 'inactivity' ? ' (' + (t.inactivity_days || 90) + 'd)' : ''}</span>
            </div>
          </div>
          <div class="action-menu">
            <button class="action-menu-btn" onclick="toggleActionMenu(this)">⋮</button>
            <div class="action-dropdown">
              ${!t.verified ? `<button onclick="doVerifyTrustee('${t.id}')" style="color:var(--green);">✅ Verify</button>` : ''}
              ${!t.activated ? `<button onclick="doActivateTrustee('${t.id}')">🔓 Activate Access</button>` : ''}
              <button onclick="confirmDeleteTrustee('${t.id}')" style="color:var(--red);">🗑 Remove</button>
            </div>
          </div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── ASSET LOCKERS SECTION (v1 style) ─────────────────────────────
  const lockerBtns = lockersUnlocked
    ? `<button class="bs sm" style="font-size:11px;color:var(--muted);" onclick="_lockLockers()">🔒 Lock</button>
       <button class="btn sm" onclick="openAssetLockerModal()">+ Add Locker</button>`
    : `<button class="btn sm" onclick="requestLockerOtp()">${myLockers.length > 0 ? '🔐 Unlock to View' : '+ Add Locker'}</button>`;

  let lockerListHtml = '';
  if (!lockersUnlocked) {
    const cnt = myLockers.length;
    lockerListHtml = `<div style="text-align:center;padding:32px 20px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;">
      <div style="font-size:40px;margin-bottom:12px;">🔐</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px;">Asset Lockers are Protected</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:6px;">${cnt > 0 ? 'You have <strong>' + cnt + '</strong> locker' + (cnt > 1 ? 's' : '') + ' stored.' : 'No lockers yet.'}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:20px;max-width:340px;margin-left:auto;margin-right:auto;">To view or manage your lockers, you'll need to verify your identity with a one-time code sent to your email.</div>
      <button class="btn" onclick="requestLockerOtp()" style="min-width:160px;">📧 Send Access Code</button>
    </div>`;
  } else if (myLockers.length === 0) {
    lockerListHtml = `<div style="text-align:center;padding:28px 16px;background:var(--bg2);border:1px dashed var(--border);border-radius:12px;color:var(--muted);">
      <div style="font-size:28px;margin-bottom:8px;">🗄</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:6px;">No asset lockers yet</div>
      <div style="font-size:12px;margin-bottom:16px;">Add physical rooms, devices, accounts, or anything a trusted contact may need to find or access.</div>
      <button class="btn sm" onclick="openAssetLockerModal()">+ Add First Locker</button>
    </div>`;
  } else {
    lockerListHtml = '<div style="display:flex;flex-direction:column;gap:10px;">';
    myLockers.forEach(l => {
      // Build trustee block
      const allTrustees = [];
      if (l.primary_trustee?.name) allTrustees.push({ t: l.primary_trustee, label: 'Primary' });
      (l.other_trustees || []).forEach(t => { if (t?.name) allTrustees.push({ t, label: 'Other' }); });
      const trusteeBlock = allTrustees.length > 0
        ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
            ${allTrustees.map(item => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:4px 0;">
              <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);min-width:46px;">${item.label}</span>
              <span style="font-size:13px;font-weight:600;">${esc(item.t.name)}</span>
              ${item.t.email ? `<span style="font-size:12px;color:var(--muted);">${esc(item.t.email)}</span>` : ''}
              ${item.t.phone ? `<span style="font-size:12px;color:var(--muted);">${esc(item.t.phone)}</span>` : ''}
            </div>`).join('')}
          </div>` : '';
      lockerListHtml += `<div class="card" style="padding:14px 18px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;">
              <span style="font-size:15px;font-weight:700;">${esc(l.title)}</span>
              ${l.type ? `<span class="badge badge-gray" style="font-size:11px;">${esc(l.type)}</span>` : ''}
            </div>
            ${l.asset_key ? `<div style="font-size:11px;color:var(--muted);font-family:monospace;margin-bottom:8px;opacity:.7;">${esc(l.asset_key)}</div>` : '<div style="margin-bottom:8px;"></div>'}
            <div style="display:grid;grid-template-columns:60px 1fr;gap:4px 10px;font-size:13px;">
              ${l.location ? `<span style="color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;padding-top:2px;">Location</span><span>${esc(l.location)}</span>` : ''}
              ${l.access  ? `<span style="color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;padding-top:2px;">Access</span><span>${esc(l.access)}</span>` : ''}
            </div>
            ${l.notes ? `<div style="margin-top:8px;font-size:12px;color:var(--muted);font-style:italic;">${esc(l.notes)}</div>` : ''}
            ${trusteeBlock}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="bs sm" onclick="openAssetLockerModal('${l.id}')">✏️</button>
            <button class="bs sm" style="color:var(--red);" onclick="delAssetLocker('${l.id}')">🗑</button>
          </div>
        </div>
      </div>`;
    });
    lockerListHtml += '</div>';
  }

  html += `<div style="margin-top:32px;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
      <div>
        <div style="font-size:17px;font-weight:800;letter-spacing:-.01em;">🗄 Asset Lockers</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">Record what you own, where it is, and how to access it — for those who may need to know.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">${lockerBtns}</div>
    </div>
    <div style="background:rgba(232,30,130,0.06);border:1px solid rgba(232,30,130,0.18);border-radius:10px;padding:10px 14px;font-size:12px;color:var(--muted);line-height:1.65;margin-bottom:14px;">
      🔒 <strong>Security note:</strong> Only store what a trusted person needs to locate and access an asset — not full passwords or private keys. Reference a secure vault (e.g. "credentials in 1Password, entry: Main Server") rather than pasting them here.
    </div>
    ${lockerListHtml}
  </div>`;

  html += `<div style="margin-top:20px;padding:12px 16px;border-radius:10px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);font-size:11px;color:var(--muted);line-height:1.7;">⚠️ <strong>Legal Notice:</strong> This system releases <strong>information only</strong>. It is not a bank, payment processor, legal will, or estate tool. It does not transfer money, assign legal ownership of debts, or create legally binding obligations.</div>`;

  el.innerHTML = html;
}

// ── Locker session OTP gate (session-only, never persisted) ────────
window._lockerOtp       = null;
window._lockerOtpExpiry = 0;
window._lockerUnlocked  = false;

function _lockerIsUnlocked() {
  if (!window._lockerUnlocked) return false;
  if (Date.now() > window._lockerOtpExpiry) { window._lockerUnlocked = false; return false; }
  return true;
}

window._lockLockers = function() {
  window._lockerUnlocked = false;
  window._lockerOtp = null;
  window._lockerOtpExpiry = 0;
  renderNokPage(document.getElementById('content'));
};

window.requestLockerOtp = async function() {
  const email = currentUser.email;
  if (!email) return toast('No email on account.', 'error');

  // Remove any existing dialog
  document.getElementById('lockerOtpBg')?.remove();

  // Show dialog with "sending…" state immediately
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-bg" id="lockerOtpBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:380px;text-align:center;" onclick="event.stopPropagation()">
      <div style="font-size:36px;margin-bottom:12px;">📧</div>
      <div style="font-size:17px;font-weight:800;margin-bottom:6px;">Check Your Email</div>
      <div id="locker-otp-status" style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.6;">
        Sending access code to <strong>${esc(email)}</strong>…
      </div>
      <input id="lockerOtpInput" type="text" inputmode="numeric" maxlength="6"
        placeholder="000000"
        style="text-align:center;font-size:26px;letter-spacing:6px;font-family:monospace;padding:12px 10px;width:180px;margin-bottom:16px;border-radius:10px;border:2px solid var(--border);background:var(--bg3);color:var(--text);"
        onkeydown="if(event.key==='Enter')verifyLockerOtp()">
      <div style="display:flex;flex-direction:column;gap:8px;align-items:center;">
        <button class="btn" onclick="verifyLockerOtp()" style="min-width:160px;">🔓 Unlock</button>
        <button class="bs sm" id="locker-resend-btn" onclick="resendLockerOtp()" style="display:none;">↩ Resend Code</button>
        <button class="bs sm" onclick="document.getElementById('lockerOtpBg').remove()">Cancel</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:14px;">Code expires in 30 minutes.</div>
    </div>
  </div>`);
  setTimeout(() => document.getElementById('lockerOtpInput')?.focus(), 100);

  await _doSendLockerOtp(email);
};

window._doSendLockerOtp = async function(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  window._lockerOtp       = code;
  window._lockerOtpExpiry = Date.now() + 30 * 60 * 1000; // 30 min

  const statusEl  = document.getElementById('locker-otp-status');
  const resendBtn = document.getElementById('locker-resend-btn');

  try {
    const result = await sendOtpEmail(currentUser.id, { to: email, otp: code, lockerName: 'Asset Locker' });
    if (statusEl) {
      if (result?.ok) {
        statusEl.innerHTML = `✅ Code sent to <strong>${esc(email)}</strong>.<br>Enter it below to unlock your Asset Lockers.<br><span style="font-size:11px;color:var(--muted);">Check spam if you don't see it.</span>`;
      } else {
        statusEl.innerHTML = `⚠️ Couldn't send email — check your Vercel <code>RESEND_API_KEY</code> env var.<br><span style="font-size:11px;">Contact: ${esc(email)}</span>`;
        if (resendBtn) resendBtn.style.display = '';
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `⚠️ Email error: ${esc(err?.message || 'Unknown')}.<br>Try again or contact support.`;
      if (resendBtn) resendBtn.style.display = '';
    }
  }
};

window.resendLockerOtp = async function() {
  const email = currentUser.email;
  const statusEl  = document.getElementById('locker-otp-status');
  const resendBtn = document.getElementById('locker-resend-btn');
  if (statusEl) statusEl.innerHTML = `Resending to <strong>${esc(email)}</strong>…`;
  if (resendBtn) resendBtn.style.display = 'none';
  await _doSendLockerOtp(email);
};

window.verifyLockerOtp = function() {
  const entered = (document.getElementById('lockerOtpInput')?.value || '').trim();
  if (!window._lockerOtp) return toast('No code pending — request a new one.', 'error');
  if (Date.now() > window._lockerOtpExpiry) {
    window._lockerOtp = null;
    toast('Code expired. Please request a new one.', 'error');
    document.getElementById('lockerOtpBg')?.remove();
    return;
  }
  if (entered !== window._lockerOtp) {
    const inp = document.getElementById('lockerOtpInput');
    if (inp) { inp.style.borderColor = 'var(--red)'; inp.value = ''; setTimeout(() => { inp.style.borderColor = ''; inp.focus(); }, 600); }
    toast('Incorrect code. Try again.', 'error');
    return;
  }
  window._lockerUnlocked = true;
  window._lockerOtp = null;
  document.getElementById('lockerOtpBg')?.remove();
  toast('🔓 Asset Lockers unlocked for this session.', 'success');
  renderNokPage(document.getElementById('content'));
};

window.openAssetLockerModal = async function(lid) {
  let l = null;
  if (lid) {
    const { data } = await supabase.from('asset_lockers').select('*').eq('id', lid).single();
    l = data;
  }
  const typeOpts = LOCKER_TYPES.map(t =>
    `<option value="${t}" ${(l?.type || 'physical') === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
  ).join('');
  const pt = l?.primary_trustee || {};
  const otherTs = l?.other_trustees || [];
  const otherRowsHtml = otherTs.map((t, i) => _alTrusteeRowHtml(i, t)).join('');

  const modal = document.createElement('div');
  modal.innerHTML = `<div class="modal-bg" id="alModalBg" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="max-width:540px;max-height:90vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-size:17px;font-weight:700;">${l ? 'Edit' : 'Add'} Asset Locker</div>
        <button class="bs sm" onclick="document.getElementById('alModalBg').remove()">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="grid-column:1/-1;"><label>Title *</label><input id="al_title" value="${esc(l?.title || '')}" placeholder="e.g. North Storage Room, Chase Savings"></div>
        <div class="form-group"><label>Type</label><select id="al_type">${typeOpts}</select></div>
        <div class="form-group"><label>Asset Key <span style="font-weight:400;color:var(--muted);font-size:11px;">(optional)</span>
          <span title="Optional structured reference. Format: domain:type:name:id — e.g. physical:room:north-storage:001" style="cursor:help;color:var(--accent);font-size:12px;margin-left:3px;">ℹ️</span></label>
          <input id="al_key" value="${esc(l?.asset_key || '')}" placeholder="physical:room:north:001" style="font-family:monospace;font-size:12px;"></div>
      </div>
      <div class="form-group"><label>Location <span style="font-weight:400;color:var(--muted);">(where to find it)</span></label><input id="al_location" value="${esc(l?.location || '')}" placeholder="e.g. 145 W 18th St, Floor 2, Room B"></div>
      <div class="form-group"><label>Access <span style="font-weight:400;color:var(--muted);">(how to get in or use it)</span></label><input id="al_access" value="${esc(l?.access || '')}" placeholder="e.g. side door, badge required, code: see 1Password"></div>
      <div class="form-group"><label>Notes <span style="font-weight:400;color:var(--muted);">(optional)</span></label><textarea id="al_notes" rows="2" placeholder="Any extra context">${esc(l?.notes || '')}</textarea></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 12px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">Trustees</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;">People who should be able to locate and access this asset. Enter details manually or reference a contact.</div>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px;">Primary Trustee</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
        <input id="al_pt_name"  class="form-input" placeholder="Name"  value="${esc(pt.name || '')}">
        <input id="al_pt_email" class="form-input" type="email" placeholder="Email" value="${esc(pt.email || '')}">
        <input id="al_pt_phone" class="form-input" type="tel" placeholder="Phone" value="${esc(pt.phone || '')}">
      </div>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px;">Other Trustees</div>
      <div id="alOtherTrusteesList">${otherRowsHtml}</div>
      <button type="button" class="bs sm" style="margin-bottom:14px;" onclick="_alAddTrusteeRow()">+ Add Trustee</button>
      <div style="background:rgba(232,30,130,0.06);border:1px solid rgba(232,30,130,0.18);border-radius:8px;padding:9px 13px;font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6;">
        🔒 Do not store full passwords or private keys here. Reference a secure vault instead (e.g. "see 1Password entry: X").
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="bs" onclick="document.getElementById('alModalBg').remove()">Cancel</button>
        <button class="btn" onclick="saveAssetLockerModal('${lid || ''}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal.firstElementChild);
};

function _alTrusteeRowHtml(idx, t) {
  return `<div id="alTrusteeRow_${idx}" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;">
    <input class="form-input al_t_name"  placeholder="Name"  value="${esc(t?.name || '')}">
    <input class="form-input al_t_email" placeholder="Email" type="email" value="${esc(t?.email || '')}">
    <input class="form-input al_t_phone" placeholder="Phone" type="tel" value="${esc(t?.phone || '')}">
    <button class="bs sm" style="color:var(--red);" onclick="this.closest('[id^=alTrusteeRow_]').remove()">✕</button>
  </div>`;
}

window._alAddTrusteeRow = function() {
  const list = document.getElementById('alOtherTrusteesList');
  if (!list) return;
  const idx = list.querySelectorAll('[id^=alTrusteeRow_]').length;
  list.insertAdjacentHTML('beforeend', _alTrusteeRowHtml(idx, null));
  list.querySelector('#alTrusteeRow_' + idx + ' input')?.focus();
};

window.saveAssetLockerModal = async function(lid) {
  const title = document.getElementById('al_title')?.value?.trim();
  if (!title) return toast('Title is required.', 'error');
  const otherRows = Array.from(document.getElementById('alOtherTrusteesList')?.querySelectorAll('[id^=alTrusteeRow_]') || []);
  const otherTrustees = otherRows.map(row => ({
    name:  (row.querySelector('.al_t_name')?.value || '').trim(),
    email: (row.querySelector('.al_t_email')?.value || '').trim(),
    phone: (row.querySelector('.al_t_phone')?.value || '').trim()
  })).filter(t => t.name);
  const ptName  = document.getElementById('al_pt_name')?.value?.trim() || '';
  const ptEmail = document.getElementById('al_pt_email')?.value?.trim() || '';
  const ptPhone = document.getElementById('al_pt_phone')?.value?.trim() || '';
  const payload = {
    title,
    type:            document.getElementById('al_type')?.value || 'physical',
    asset_key:       document.getElementById('al_key')?.value?.trim() || null,
    location:        document.getElementById('al_location')?.value?.trim() || null,
    access:          document.getElementById('al_access')?.value?.trim() || null,
    notes:           document.getElementById('al_notes')?.value?.trim() || null,
    primary_trustee: ptName ? { name: ptName, email: ptEmail, phone: ptPhone } : null,
    other_trustees:  otherTrustees
  };
  let error;
  if (lid) {
    ({ error } = await supabase.from('asset_lockers').update(payload).eq('id', lid));
  } else {
    ({ error } = await supabase.from('asset_lockers').insert({ ...payload, user_id: currentUser.id }));
  }
  if (error) return toast('Save failed: ' + error.message, 'error');
  document.getElementById('alModalBg')?.remove();
  toast(lid ? 'Asset locker updated.' : 'Asset locker added.', 'success');
  renderNokPage(document.getElementById('content'));
};

window.delAssetLocker = async function(lid) {
  if (!confirm('Remove this asset locker?')) return;
  await supabase.from('asset_lockers').delete().eq('id', lid);
  toast('Asset locker removed.', 'success');
  renderNokPage(document.getElementById('content'));
};

window.openNewTrusteeModal = function() {
  openModal(`
    <h3 style="margin-bottom:16px;">Add Trusted Person</h3>
    <div class="form-group"><label>Name *</label><input type="text" id="nk-name" placeholder="Full name"></div>
    <div class="form-group"><label>Email *</label><input type="email" id="nk-email" placeholder="their@email.com"></div>
    <div class="form-group"><label>Relationship</label><input type="text" id="nk-rel" placeholder="Spouse, sibling, lawyer..."></div>
    <div class="form-row">
      <div class="form-group"><label>Access Level</label><select id="nk-access">
        <option value="readonly">Read Only</option><option value="full">Full Access</option><option value="custom">Custom</option>
      </select></div>
      <div class="form-group"><label>Release Trigger</label><select id="nk-release" onchange="document.getElementById('nk-days-wrap').style.display=this.value==='inactivity'?'':'none'">
        <option value="manual">Manual Only</option><option value="inactivity">After Inactivity</option><option value="death">Death Certificate</option>
      </select></div>
    </div>
    <div class="form-group" id="nk-days-wrap" style="display:none;"><label>Inactivity Days</label><input type="number" id="nk-days" value="90" min="7" max="365"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="doCreateTrustee()">Add Trustee</button>
    </div>
  `, { maxWidth: '460px' });
};

window.doCreateTrustee = async function() {
  const name = document.getElementById('nk-name').value.trim();
  const email = document.getElementById('nk-email').value.trim();
  if (!name || !email) return toast('Name and email required.', 'error');
  const trusteeData = await createTrustee(currentUser.id, {
    trusteeName: name, trusteeEmail: email,
    relationship: document.getElementById('nk-rel').value.trim(),
    accessLevel: document.getElementById('nk-access').value,
    releaseType: document.getElementById('nk-release').value,
    inactivityDays: parseInt(document.getElementById('nk-days')?.value) || 90
  });
  // Notify trustee they've been designated
  try {
    await sendNokVerificationEmail(currentUser.id, {
      to: email, fromName: currentProfile?.display_name || currentProfile?.company_name || 'Someone',
      recipientName: name, relationship: document.getElementById('nk-rel').value.trim(),
      accessLevel: document.getElementById('nk-access').value,
      logoUrl: currentProfile?.logo_url, siteUrl: 'https://moneyinteractions.com'
    });
  } catch(e) { console.warn('[NOK] Verification email failed:', e); }
  closeModal(); toast('Trustee added & notified.', 'success'); navTo('nok');
};

window.doVerifyTrustee = async function(id) {
  await verifyTrustee(id);
  toast('Trustee verified.', 'success'); navTo('nok');
};

window.doActivateTrustee = async function(id) {
  if (!confirm('Activate access for this trustee? They will be able to view your records.')) return;
  const reason = prompt('Reason for activation (optional):') || '';
  const trustees = await listTrustees(currentUser.id);
  const trustee  = trustees.find(t => t.id === id);
  await activateTrustee(id, reason);
  // Notify trustee their access is now live
  if (trustee?.trustee_email) {
    try {
      await sendNokActivationEmail(currentUser.id, {
        to: trustee.trustee_email, fromName: currentProfile?.display_name || currentProfile?.company_name || 'Someone',
        recipientName: trustee.trustee_name, relationship: trustee.relationship,
        accessLevel: trustee.access_level, releaseType: trustee.release_type,
        triggerReason: reason ? 'manual' : 'manual',
        logoUrl: currentProfile?.logo_url, siteUrl: 'https://moneyinteractions.com'
      });
    } catch(e) { console.warn('[NOK] Activation email failed:', e); }
  }
  toast('Access activated & trustee notified.', 'success'); navTo('nok');
};

window.confirmDeleteTrustee = async function(id) {
  if (!confirm('Remove this trustee?')) return;
  await deleteTrustee(id);
  toast('Trustee removed.', 'success'); navTo('nok');
};



export { renderNokPage };
