// Money IntX — Settings Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile, setCurrentProfile } from './state.js';
import { esc, toast, openModal, closeModal } from '../ui.js';
import { supabase, getProfile } from '../supabase.js';
import { sendAppInviteEmail } from '../email.js';

// Various UI helpers and functions needed from the main app

// ── Settings ──────────────────────────────────────────────────────
async function renderSettings(el) {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const p = currentProfile || {};
  const isAdmin = p.role === 'platform_admin';
  const np = p.notif_prefs || {};
  const CURLIST = ['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','CNY','BRL','MXN','AED','SAR','QAR','KWD','BHD','OMR','EGP','MAD','TZS','UGX','ETB','XOF'];
  let html = `<div class="page-header"><h2>Settings</h2></div>`;

  // ── Profile ────────────────────────────────────────────────────
  html += `<div class="card">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px;">Profile</h3>

    <!-- Profile Photo -->
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);">
      <div style="position:relative;flex-shrink:0;">
        <div id="s-avatar-ring" style="width:72px;height:72px;border-radius:50%;background:var(--bg3);border:2px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;">
          ${p.avatar_url
            ? `<img id="s-avatar-img" src="${esc(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';document.getElementById('s-avatar-initials').style.display='flex';">`
            : ''}
          <div id="s-avatar-initials" style="width:100%;height:100%;display:${p.avatar_url ? 'none' : 'flex'};align-items:center;justify-content:center;font-size:26px;font-weight:800;color:var(--accent);">${(p.display_name || p.email || '?').charAt(0).toUpperCase()}</div>
        </div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Profile Photo</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;">
            📷 Upload Photo
            <input type="file" id="s-photo-file" accept="image/*" style="display:none;" onchange="uploadProfilePhoto(this)">
          </label>
          ${p.avatar_url ? `<button class="bs sm" onclick="clearProfilePhoto()" style="color:var(--red);font-size:12px;">✕ Remove</button>` : ''}
        </div>
        <div id="s-photo-upload-status" style="font-size:11px;color:var(--muted);margin-top:4px;"></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Max 2 MB · JPG, PNG, WebP</div>
        <input type="hidden" id="s-photourl" value="${esc(p.avatar_url || '')}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group"><label>Display Name</label><input type="text" id="s-name" value="${esc(p.display_name || '')}"></div>
      <div class="form-group"><label>Email</label><input type="email" value="${esc(p.email || '')}" disabled style="opacity:0.6;"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Phone</label><input type="text" id="s-phone" value="${esc(p.phone || '')}"></div>
      <div class="form-group"><label>City / Location</label><input type="text" id="s-city" value="${esc(p.city || '')}"></div>
    </div>
    <div class="form-group"><label>Bio / Notes</label><textarea id="s-bio" rows="2">${esc(p.bio || '')}</textarea></div>
    <div class="form-group"><label>Default Currency</label><select id="s-currency">
      ${CURLIST.map(c => `<option value="${c}" ${p.default_currency === c ? 'selected' : ''}>${c}</option>`).join('')}
    </select></div>
    <label style="display:flex;align-items:center;gap:12px;cursor:pointer;padding:10px 0;border-top:1px solid var(--border);margin-top:8px;">
      <input type="checkbox" id="s-searchable" ${p.is_searchable !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex-shrink:0;">
      <div>
        <div style="font-size:14px;font-weight:600;">Searchable Username</div>
        <div style="font-size:12px;color:var(--muted);">Allow other users to find you by your display name</div>
      </div>
    </label>
    <button class="btn btn-primary btn-sm" onclick="saveSettings()">Save Profile</button>
  </div>`;

  // ── Invoice / Branding Info — available to ALL users ──────────
  html += `<div class="card" style="margin-top:12px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:4px;">Invoice & Company Info</h3>
    <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">Shown on your invoices and printed documents.</p>
    <div class="form-group">
      <label>Logo</label>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div id="s-logo-preview" style="${p.logo_url ? '' : 'display:none;'}">
          <img id="s-logo-img" src="${esc(p.logo_url || '')}" style="max-height:56px;max-width:140px;border-radius:8px;border:1px solid var(--border);object-fit:contain;" onerror="this.style.display='none'">
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;">
            <span>📁</span> Upload Logo
            <input type="file" id="s-logo-file" accept="image/*" style="display:none;" onchange="uploadLogoFile(this)">
          </label>
          <div id="s-logo-upload-status" style="font-size:11px;color:var(--muted);"></div>
          <div style="font-size:11px;color:var(--muted);">Max 5 MB · JPG, PNG, WebP, SVG</div>
        </div>
        ${p.logo_url ? `<button class="bs sm" onclick="clearLogo()" style="color:var(--red);font-size:12px;">✕ Remove</button>` : ''}
      </div>
      <input type="hidden" id="s-logourl" value="${esc(p.logo_url || '')}">
    </div>
    <div class="form-row">
      <div class="form-group"><label>Company / Business Name</label><input type="text" id="s-company" value="${esc(p.company_name || '')}"></div>
      <div class="form-group"><label>Company Email</label><input type="email" id="s-comemail" value="${esc(p.company_email || '')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Company Phone</label><input type="text" id="s-comphone" value="${esc(p.company_phone || '')}"></div>
      <div class="form-group"><label>Company Address</label><input type="text" id="s-comaddr" value="${esc(p.company_address || '')}"></div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="saveInvoiceInfo()">Save Invoice Info</button>
  </div>`;

  // ── Notification Preferences ───────────────────────────────────
  html += `<div class="card" style="margin-top:12px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:14px;">Notification Preferences</h3>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
        <div><div style="font-size:14px;font-weight:600;">In-App Notifications</div><div style="font-size:12px;color:var(--muted);">Alerts inside the app</div></div>
        <input type="checkbox" id="np-inapp" ${np.inapp !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;">
      </label>
      <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
        <div><div style="font-size:14px;font-weight:600;">Email Notifications</div><div style="font-size:12px;color:var(--muted);">Sent to your registered email</div></div>
        <input type="checkbox" id="np-email" ${np.email !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;">
      </label>
      <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
        <div><div style="font-size:14px;font-weight:600;">SMS Notifications</div><div style="font-size:12px;color:var(--muted);">Text alerts (requires valid phone)</div></div>
        <input type="checkbox" id="np-sms" ${np.sms ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;">
      </label>
    </div>
    <button class="btn btn-primary btn-sm" style="margin-top:14px;" onclick="saveNotifPrefs()">Save Preferences</button>
  </div>`;

  // ── Email Diagnostics (admin only) ────────────────────────────
  if (isAdmin) html += `<div class="card" style="margin-top:12px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:4px;">Email Diagnostics</h3>
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">Send a test email to verify your Resend API key and domain are set up correctly in Vercel.</p>
    <div style="background:var(--bg3);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--muted);">
      <strong style="color:var(--text);">Setup checklist:</strong>
      <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
        <div>1️⃣ Get API key at <a href="https://resend.com" target="_blank" style="color:var(--accent);">resend.com</a></div>
        <div>2️⃣ Verify domain <code>moneyintx.com</code> in Resend → Domains</div>
        <div>3️⃣ Add <code>RESEND_API_KEY</code> in Vercel → Project → Settings → Environment Variables</div>
        <div>4️⃣ Add <code>EMAIL_FROM</code> = <code>Money IntX &lt;noreply@moneyintx.com&gt;</code> (optional)</div>
        <div>5️⃣ Redeploy on Vercel after adding env vars</div>
      </div>
    </div>
    <button class="btn btn-primary btn-sm" id="s-test-email-btn" onclick="sendTestEmail()">📧 Send Test Email</button>
    <div id="s-test-email-out" style="margin-top:10px;font-size:13px;"></div>
    <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;">Recent Email Log</strong>
        <button class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 10px;" onclick="loadEmailLog()">↻ Refresh</button>
      </div>
      <div id="s-email-log" style="font-size:12px;color:var(--muted);">Loading…</div>
    </div>
  </div>`;  // end admin-only Email Diagnostics

  // ── Invite Friends ─────────────────────────────────────────────
  const inviteLink = `${window.location.origin}${window.location.pathname}?ref=${currentUser?.id || ''}`;
  html += `<div class="card" style="margin-top:12px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:8px;">Invite Friends</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">Share your personal invite link. Friends who sign up with it will be linked to your account.</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="text" value="${esc(inviteLink)}" readonly style="flex:1;min-width:0;font-size:12px;font-family:monospace;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--muted);">
      <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${esc(inviteLink)}').then(()=>toast('Invite link copied!','success'))">Copy Link</button>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="email" id="s-invite-email" placeholder="friend@email.com" style="flex:1;min-width:0;">
      <button class="btn btn-primary btn-sm" onclick="sendEmailInvite()">📧 Send Invite</button>
    </div>
  </div>`;

  // ── Theme picker ───────────────────────────────────────────────
  const currentTheme = (currentUser?.id && localStorage.getItem('mxi_theme_' + currentUser.id)) || localStorage.getItem('mxi_theme') || 'classic';
  const themes = [
    { id: 'navy',           name: 'MoneyIntX',     bg: '#020617', accent: '#3B82F6', light: false },
    { id: 'classic',        name: 'Classic Dark',   bg: '#0A0B0E', accent: '#6366F1', light: false },
    { id: 'dark',           name: 'Deep Black',     bg: '#030303', accent: '#6366F1', light: false },
    { id: 'light',          name: 'Light',          bg: '#F5F7FB', accent: '#6366F1', light: true },
    { id: 'light-sage',     name: 'Sage',           bg: '#F4F7F2', accent: '#5B8C5A', light: true },
    { id: 'light-rose',     name: 'Rose',           bg: '#FBF5F6', accent: '#C06078', light: true },
    { id: 'light-ocean',    name: 'Ocean',          bg: '#F2F8FB', accent: '#2E7D9B', light: true },
    { id: 'light-sand',     name: 'Sand',           bg: '#FAF7F3', accent: '#B07845', light: true },
    { id: 'light-lavender', name: 'Lavender',       bg: '#F7F5FB', accent: '#7C5CBA', light: true }
  ];
  html += `<div class="card" style="margin-top:12px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Theme</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${themes.map(t => {
        const isActive = currentTheme === t.id;
        const isLight = !!t.light;
        return `<button onclick="setTheme('${t.id}')" title="${t.name}" style="
          width:64px;height:64px;border-radius:14px;
          border:${isActive ? '2px solid rgba(99,102,241,.45)' : '1px solid ' + (isLight ? 'rgba(24,32,51,.10)' : 'rgba(255,255,255,.05)')};
          background:${t.bg};cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
          transition:border-color .15s;box-shadow:none;">
          <div style="width:24px;height:24px;border-radius:50%;background:${t.accent};"></div>
          <span style="font-size:9px;font-weight:600;color:${isLight ? '#73819A' : '#8791A2'};letter-spacing:.02em;">${t.name.split(' ')[0]}</span>
        </button>`;
      }).join('')}
    </div>
    <p style="font-size:12px;color:var(--muted);margin-top:8px;">Current: ${themes.find(t => t.id === currentTheme)?.name || 'Classic Dark'}</p>
  </div>`;

  // ── Admin: Branding + Dashboard Tips ──────────────────────────
  if (isAdmin) {
    // Load current tips
    let currentTips = [];
    try {
      const { data: tipRow } = await supabase.from('app_settings').select('value').eq('key','banner_tips').maybeSingle();
      if (tipRow?.value && Array.isArray(tipRow.value)) currentTips = tipRow.value;
    } catch(_) {}

    // Load current site logo from app_settings
    let currentSiteLogo = '';
    try {
      const { data: logoRow } = await supabase.from('app_settings').select('value').eq('key','site_logo').maybeSingle();
      if (logoRow?.value) currentSiteLogo = logoRow.value;
    } catch(_) {}

    html += `<div class="card" style="margin-top:12px;border-color:rgba(251,191,36,.3);">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:4px;">🛠 Admin: Platform Branding</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">These settings apply platform-wide.</p>
      <div class="form-group">
        <label>Site Logo</label>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <div id="s-site-logo-preview" style="${currentSiteLogo ? '' : 'display:none;'}">
            <img id="s-site-logo-img" src="${esc(currentSiteLogo)}" style="max-height:56px;max-width:160px;border-radius:8px;border:1px solid var(--border);object-fit:contain;" onerror="this.style.display='none'">
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;">
              <span>📁</span> Upload Site Logo
              <input type="file" id="s-site-logo-file" accept="image/*" style="display:none;" onchange="uploadSiteLogo(this)">
            </label>
            <div id="s-site-logo-status" style="font-size:11px;color:var(--muted);"></div>
            <div style="font-size:11px;color:var(--muted);">Max 5 MB · JPG, PNG, WebP, SVG — shown in topbar</div>
          </div>
          ${currentSiteLogo ? `<button class="bs sm" onclick="clearSiteLogo()" style="color:var(--red);font-size:12px;">✕ Remove</button>` : ''}
        </div>
        <input type="hidden" id="s-site-logo-url" value="${esc(currentSiteLogo)}">
      </div>
      <div class="form-row">
        <div class="form-group"><label>App / Site Name</label><input type="text" id="s-appname" value="${esc(p.app_name || 'Money IntX')}"></div>
        <div class="form-group"><label>Tagline</label><input type="text" id="s-tagline" value="${esc(p.tagline || '')}"></div>
      </div>
      <div class="form-group"><label>Site URL</label><input type="text" id="s-siteurl" value="${esc(p.site_url || '')}" placeholder="https://moneyinteractions.com"></div>
      <button class="btn btn-primary btn-sm" onclick="saveBranding()">Save Branding</button>
    </div>`;

    // Get current topbar tip text
    const currentTopbarTip = document.getElementById('app-tip-bar')?.textContent?.replace(/^💡\s*/, '') || '(none)';

    html += `<div class="card" style="margin-top:12px;border-color:rgba(251,191,36,.3);">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:4px;">🛠 Admin: Dashboard Tips</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:6px;">One tip is shown at random on each page load. Edit the list here.</p>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Currently showing in topbar</div>
        <div style="font-size:13px;color:var(--text);">💡 ${esc(currentTopbarTip)}</div>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;">${currentTips.length} tip${currentTips.length === 1 ? '' : 's'} saved</div>
      <div id="admin-tips-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
        ${currentTips.map((tip,i) => `
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:11px;color:var(--muted);min-width:20px;text-align:right;">${i+1}.</span>
            <input type="text" value="${esc(tip)}" id="admin-tip-${i}" style="flex:1;font-size:13px;">
            <button class="btn btn-danger btn-sm" style="padding:4px 10px;flex-shrink:0;" onclick="removeAdminTip(${i})">✕</button>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <input type="text" id="admin-tip-new" placeholder="Add new tip…" style="flex:1;font-size:13px;">
        <button class="btn btn-secondary btn-sm" onclick="addAdminTip()">+ Add</button>
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveAdminTips()">💾 Save Tip List</button>
    </div>`;
  }

  // ── Account ────────────────────────────────────────────────────
  html += `<div class="card" style="margin-top:12px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Account</h3>
    <button class="btn btn-danger btn-sm" onclick="app.logOut()">Sign Out</button>
  </div>`;

  // ── Modules ────────────────────────────────────────────────────
  const _savedMods = _getModules();
  html += `<div class="card" style="margin-top:12px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:4px;">Optional Modules</h3>
    <p style="font-size:12px;color:var(--muted);margin-bottom:16px;">Turn modules on or off to keep your nav focused on what you use.</p>
    <div style="display:flex;flex-direction:column;gap:0;">
      ${OPTIONAL_MODULES.map(m => {
        const checked = _savedMods[m.id] !== false; // undefined → true (on by default)
        return `<label style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--border);cursor:pointer;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:22px;width:30px;text-align:center;">${m.icon}</span>
            <div>
              <div style="font-size:14px;font-weight:600;">${m.label}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">${m.desc}</div>
            </div>
          </div>
          <input type="checkbox" id="mod-${m.id}" ${checked ? 'checked' : ''}
            style="width:20px;height:20px;accent-color:var(--accent);cursor:pointer;flex-shrink:0;">
        </label>`;
      }).join('')}
    </div>
    <button class="btn btn-primary btn-sm" style="margin-top:16px;" onclick="saveModules()">Save Modules</button>
  </div>`;
  el.innerHTML = html;
  // Auto-load email log after rendering
  requestAnimationFrame(() => { if (window.loadEmailLog) window.loadEmailLog(); });
}

window.saveSettings = async function() {
  let currentUser = getCurrentUser();
  let currentProfile = getCurrentProfile();
  const photoUrl = (document.getElementById('s-photourl')?.value || '').trim();
  const updates = {
    display_name:  document.getElementById('s-name').value.trim(),
    phone:         document.getElementById('s-phone').value.trim(),
    city:          document.getElementById('s-city').value.trim(),
    bio:           document.getElementById('s-bio').value.trim(),
    default_currency: document.getElementById('s-currency').value,
    is_searchable: document.getElementById('s-searchable').checked,
    updated_at:    new Date().toISOString()
  };
  if (photoUrl !== undefined) updates.avatar_url = photoUrl;
  const { error } = await supabase.from('users').update(updates).eq('id', currentUser.id);
  if (error) return toast(error.message, 'error');
  currentProfile = await getProfile(currentUser.id); setCurrentProfile(currentProfile);
  document.getElementById('sidebar-user-name').textContent = currentProfile.display_name;
  // Update sidebar avatar if it exists
  const sidebarAvatar = document.getElementById('sidebar-avatar-img');
  if (sidebarAvatar && photoUrl) { sidebarAvatar.src = photoUrl; sidebarAvatar.style.display = ''; }
  toast('Profile saved.', 'success');
};

window.saveInvoiceInfo = async function() {
  let currentUser = getCurrentUser();
  let currentProfile = getCurrentProfile();
  const { error } = await supabase.from('users').update({
    logo_url:        document.getElementById('s-logourl').value.trim(),
    company_name:    document.getElementById('s-company').value.trim(),
    company_email:   document.getElementById('s-comemail').value.trim(),
    company_phone:   document.getElementById('s-comphone').value.trim(),
    company_address: document.getElementById('s-comaddr').value.trim(),
    updated_at:      new Date().toISOString()
  }).eq('id', currentUser.id);
  if (error) return toast(error.message, 'error');
  currentProfile = await getProfile(currentUser.id); setCurrentProfile(currentProfile);
  toast('Invoice info saved.', 'success');
};

window.uploadLogoFile = async function(input) {
  const currentUser = getCurrentUser();
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('s-logo-upload-status');
  const previewEl = document.getElementById('s-logo-preview');
  const imgEl    = document.getElementById('s-logo-img');
  if (file.size > 5 * 1024 * 1024) {
    statusEl.textContent = '❌ File too large — max 5 MB';
    input.value = '';
    return;
  }
  statusEl.textContent = '⏳ Uploading…';
  const ext  = file.name.split('.').pop();
  const path = `${currentUser.id}/logo.${ext}`;
  const { error } = await supabase.storage.from('user-logos').upload(path, file, { upsert: true });
  if (error) { statusEl.textContent = '❌ ' + error.message; return; }
  const { data } = supabase.storage.from('user-logos').getPublicUrl(path);
  const url = data.publicUrl + '?t=' + Date.now(); // cache-bust
  document.getElementById('s-logourl').value = url;
  imgEl.src = url;
  imgEl.style.display = '';
  previewEl.style.display = '';
  statusEl.textContent = '✅ Uploaded';
};

window.uploadProfilePhoto = async function(input) {
  const currentUser = getCurrentUser();
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('s-photo-upload-status');
  if (file.size > 2 * 1024 * 1024) {
    statusEl.textContent = '❌ File too large — max 2 MB';
    input.value = '';
    return;
  }
  statusEl.textContent = '⏳ Uploading…';
  const ext  = file.name.split('.').pop();
  const path = `${currentUser.id}/avatar.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
  if (error) { statusEl.textContent = '❌ ' + error.message; return; }
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = data.publicUrl + '?t=' + Date.now();
  document.getElementById('s-photourl').value = url;
  // Update preview ring
  let imgEl = document.getElementById('s-avatar-img');
  const ring = document.getElementById('s-avatar-ring');
  const initials = document.getElementById('s-avatar-initials');
  if (!imgEl) {
    imgEl = document.createElement('img');
    imgEl.id = 's-avatar-img';
    imgEl.style = 'width:100%;height:100%;object-fit:cover;';
    imgEl.onerror = function() { this.style.display='none'; if(initials) initials.style.display='flex'; };
    if (ring) ring.insertBefore(imgEl, ring.firstChild);
  }
  imgEl.src = url;
  imgEl.style.display = '';
  if (initials) initials.style.display = 'none';
  statusEl.textContent = '✅ Photo uploaded — click Save Profile to apply';
};

window.clearProfilePhoto = function() {
  document.getElementById('s-photourl').value = '';
  const imgEl = document.getElementById('s-avatar-img');
  const initials = document.getElementById('s-avatar-initials');
  if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
  if (initials) initials.style.display = 'flex';
  const statusEl = document.getElementById('s-photo-upload-status');
  if (statusEl) statusEl.textContent = 'Photo removed — click Save Profile to apply';
};

window.clearLogo = function() {
  document.getElementById('s-logourl').value = '';
  const previewEl = document.getElementById('s-logo-preview');
  const imgEl    = document.getElementById('s-logo-img');
  if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
  if (previewEl) previewEl.style.display = 'none';
  const statusEl = document.getElementById('s-logo-upload-status');
  if (statusEl) statusEl.textContent = '';
};

window.saveNotifPrefs = async function() {
  let currentUser = getCurrentUser();
  let currentProfile = getCurrentProfile();
  const prefs = {
    inapp: document.getElementById('np-inapp').checked,
    email: document.getElementById('np-email').checked,
    sms:   document.getElementById('np-sms').checked,
  };
  const { error } = await supabase.from('users').update({
    notif_prefs: prefs, updated_at: new Date().toISOString()
  }).eq('id', currentUser.id);
  if (error) return toast(error.message, 'error');
  if (currentProfile) currentProfile.notif_prefs = prefs;
  toast('Notification preferences saved.', 'success');
};

window.loadEmailLog = async function() {
  const currentUser = getCurrentUser();
  const el = document.getElementById('s-email-log');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--muted);">Loading…</span>';
  const { data, error } = await supabase
    .from('email_log')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) { el.innerHTML = '<span style="color:var(--red);">Error: ' + error.message + '</span>'; return; }
  if (!data || !data.length) {
    el.innerHTML = '<span style="color:var(--muted);">No email attempts recorded yet.</span>';
    return;
  }
  const rows = data.map(r => {
    const ts = new Date(r.created_at).toLocaleString();
    const ok = r.status === 'sent';
    const statusBadge = `<span style="display:inline-block;padding:1px 7px;border-radius:20px;font-size:10px;font-weight:700;background:${ok?'#dcfce7':'#fee2e2'};color:${ok?'#166534':'#991b1b'};">${r.status.toUpperCase()}</span>`;
    const errDetail = (!ok && r.error) ? `<div style="color:var(--red);margin-top:2px;font-size:11px;">↳ ${esc(r.error)}</div>` : '';
    return `<div style="padding:6px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ${statusBadge}
        <span style="color:var(--muted);font-size:11px;">${ts}</span>
        <span style="font-weight:600;color:var(--text);">${esc(r.type)}</span>
        <span style="color:var(--muted);">→ ${esc(r.recipient)}</span>
      </div>
      <div style="margin-top:2px;color:var(--muted);font-size:11px;">${esc(r.subject || '')}</div>
      ${errDetail}
    </div>`;
  }).join('');
  el.innerHTML = rows;
};

window.sendTestEmail = async function() {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const btn = document.getElementById('s-test-email-btn');
  const out = document.getElementById('s-test-email-out');
  const toEmail = currentProfile?.email || currentUser?.email;
  if (!toEmail) { out.innerHTML = '<span style="color:var(--red);">No email address found. Please save your profile first.</span>'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (out) out.innerHTML = '<span style="color:var(--muted);">Sending test email to ' + toEmail + '…</span>';
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: toEmail,
        subject: 'Money IntX — Email Test',
        html: '<p style="font-family:sans-serif;font-size:15px;color:#1e293b;">This is a test email from <strong>Money IntX</strong>. If you can see this, your email configuration is working correctly. ✅</p><p style="font-size:12px;color:#64748b;">Sent from: noreply@moneyintx.com via Resend</p>'
      })
    });
    const data = await res.json();
    if (data.ok) {
      if (out) out.innerHTML = '<span style="color:#16a34a;font-weight:600;">✅ Test email sent to ' + toEmail + '! Check your inbox (and spam).</span>';
      toast('Test email sent!', 'success');
    } else {
      const errMsg = data.error || 'Unknown error';
      if (out) out.innerHTML = `<span style="color:var(--red);font-weight:600;">❌ Failed: ${errMsg}</span>`;
      if (errMsg.includes('RESEND_API_KEY')) {
        if (out) out.innerHTML += `<div style="font-size:12px;margin-top:6px;color:var(--muted);">Go to <strong>Vercel → Your Project → Settings → Environment Variables</strong> and add <code>RESEND_API_KEY</code> with your key from <a href="https://resend.com" target="_blank" style="color:var(--accent);">resend.com</a>. Then redeploy.</div>`;
      }
      toast('Email failed: ' + errMsg, 'error');
    }
  } catch (err) {
    if (out) out.innerHTML = '<span style="color:var(--red);">Network error: ' + err.message + '</span>';
    toast('Network error sending email.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📧 Send Test Email'; }
    // Refresh log after test attempt
    setTimeout(() => { if (window.loadEmailLog) window.loadEmailLog(); }, 800);
  }
};

window.sendEmailInvite = async function() {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const emailInput = document.getElementById('s-invite-email');
  const email = emailInput?.value.trim();
  if (!email) return toast('Enter an email address first.', 'error');
  const btn = emailInput?.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  const inviteLink = `${window.location.origin}${window.location.pathname}?register=1&ref=${currentUser?.id || ''}`;
  const name = currentProfile?.display_name || 'A friend';
  try {
    const result = await sendAppInviteEmail(currentUser.id, {
      to: email, fromName: name, inviteLink
    });
    if (result?.ok !== false) {
      toast('Invite sent to ' + email + '!', 'success');
      if (emailInput) emailInput.value = '';
    } else {
      toast('Failed to send: ' + (result?.error || 'Unknown error'), 'error');
    }
  } catch(e) {
    toast('Failed to send invite.', 'error');
    console.error('[sendEmailInvite]', e);
  }
  if (btn) { btn.disabled = false; btn.textContent = '📧 Send Invite'; }
};

window.uploadSiteLogo = async function(input) {
  const currentUser = getCurrentUser();
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('s-site-logo-status');
  const previewEl = document.getElementById('s-site-logo-preview');
  const imgEl = document.getElementById('s-site-logo-img');
  if (file.size > 5 * 1024 * 1024) {
    statusEl.textContent = '❌ File too large — max 5 MB';
    input.value = '';
    return;
  }
  statusEl.textContent = '⏳ Uploading…';
  const ext = file.name.split('.').pop();
  // Use user ID prefix so storage RLS allows the upload
  const path = `${currentUser.id}/site-logo.${ext}`;
  const { error } = await supabase.storage.from('user-logos').upload(path, file, { upsert: true });
  if (error) { statusEl.textContent = '❌ ' + error.message; return; }
  const { data } = supabase.storage.from('user-logos').getPublicUrl(path);
  const url = data.publicUrl + '?t=' + Date.now();
  document.getElementById('s-site-logo-url').value = url;
  if (imgEl) { imgEl.src = url; imgEl.style.display = ''; }
  if (previewEl) previewEl.style.display = '';
  statusEl.textContent = '✅ Uploaded — click Save Branding to apply';
};

window.clearSiteLogo = function() {
  document.getElementById('s-site-logo-url').value = '';
  const previewEl = document.getElementById('s-site-logo-preview');
  const imgEl = document.getElementById('s-site-logo-img');
  if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
  if (previewEl) previewEl.style.display = 'none';
  const statusEl = document.getElementById('s-site-logo-status');
  if (statusEl) statusEl.textContent = 'Logo removed — click Save Branding to apply';
};

window.saveBranding = async function() {
  let currentUser = getCurrentUser();
  let currentProfile = getCurrentProfile();

  // Save user-level branding fields
  const { error } = await supabase.from('users').update({
    app_name:  document.getElementById('s-appname')?.value.trim(),
    tagline:   document.getElementById('s-tagline')?.value.trim(),
    site_url:  document.getElementById('s-siteurl')?.value.trim(),
    updated_at: new Date().toISOString()
  }).eq('id', currentUser.id);
  if (error) return toast(error.message, 'error');

  // Save site logo to app_settings (platform-wide), fallback to user profile
  const siteLogoUrl = document.getElementById('s-site-logo-url')?.value.trim() || '';
  const { error: logoErr } = await supabase.from('app_settings').upsert({
    key: 'site_logo',
    value: siteLogoUrl,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (logoErr) {
    console.warn('[saveBranding] app_settings RLS failed, saving to user profile:', logoErr.message);
    // Fallback: store site_logo_url on admin's user profile
    await supabase.from('users').update({ site_logo_url: siteLogoUrl }).eq('id', currentUser.id);
  }

  // Update topbar logo immediately
  const topbarLogo = document.getElementById('topbar-logo');
  const topbarName = document.getElementById('topbar-brand-name');
  if (topbarLogo) {
    if (siteLogoUrl) {
      topbarLogo.src = siteLogoUrl;
      topbarLogo.style.display = '';
      if (topbarName) topbarName.style.display = 'none';
    } else {
      topbarLogo.src = 'money.png'; // fallback to default
      topbarLogo.style.display = '';
    }
  }

  currentProfile = await getProfile(currentUser.id); setCurrentProfile(currentProfile);
  toast('Branding saved.', 'success');
};



export { renderSettings };
