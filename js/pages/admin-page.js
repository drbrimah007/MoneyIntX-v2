// Money IntX — Admin Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile } from './state.js';
import { esc, toast, fmtDate, fmtRelative } from '../ui.js';
import { supabase } from '../supabase.js';
import { getPlatformStats, listAllUsers, getAuditLog, updateUserRole, updateUserStatus, logAudit } from '../admin.js';

// ── Admin ─────────────────────────────────────────────────────────
export async function renderAdmin(el) {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();

  if (currentProfile?.role !== 'platform_admin') {
    el.innerHTML = '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--red);">Admin access required.</p></div>';
    return;
  }
  el.innerHTML = '<div class="page-header"><h2>Admin</h2></div><p style="color:var(--muted);">Loading...</p>';
  const [stats, users, audit] = await Promise.all([
    getPlatformStats(),
    listAllUsers(),
    getAuditLog({ limit: 20 })
  ]);

  let html = `<div class="page-header"><h2>Admin Dashboard</h2></div>`;

  // Platform stats
  html += `<div class="grid3" style="margin-bottom:16px;">
    <div class="stat-card"><div class="stat-lbl">Users</div><div class="stat-val">${stats.userCount}</div></div>
    <div class="stat-card"><div class="stat-lbl">Entries</div><div class="stat-val">${stats.entryCount}</div></div>
    <div class="stat-card"><div class="stat-lbl">Contacts</div><div class="stat-val">${stats.contactCount}</div></div>
  </div>
  <div class="grid3" style="margin-bottom:16px;">
    <div class="stat-card"><div class="stat-lbl">Groups</div><div class="stat-val">${stats.groupCount}</div></div>
    <div class="stat-card"><div class="stat-lbl">Investments</div><div class="stat-val">${stats.investmentCount}</div></div>
    <div class="stat-card"><div class="stat-lbl">Platform</div><div class="stat-val" style="font-size:14px;">Money IntX v2</div></div>
  </div>`;

  // Users table
  html += `<div class="card" style="margin-bottom:16px;">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Users</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>`;
  users.forEach(u => {
    html += `<tr>
      <td style="font-weight:600;">${esc(u.display_name || '—')}</td>
      <td style="font-size:13px;color:var(--muted);">${esc(u.email)}</td>
      <td><select onchange="changeUserRole('${u.id}',this.value)" class="text-sm" style="padding:2px 6px;border:1px solid var(--border);border-radius:6px;">
        ${['platform_admin','standard','contact'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select></td>
      <td><span class="badge ${u.status === 'active' ? 'badge-green' : u.status === 'suspended' ? 'badge-red' : 'badge-gray'}">${u.status}</span></td>
      <td style="font-size:13px;color:var(--muted);">${fmtDate(u.created_at)}</td>
      <td>
        ${u.status === 'active'
          ? `<button class="bs sm" onclick="suspendUser('${u.id}')" style="font-size:11px;color:var(--amber);">Suspend</button>`
          : `<button class="bs sm" onclick="activateUser('${u.id}')" style="font-size:11px;color:var(--green);">Activate</button>`}
        <button class="bs sm" onclick="impersonateUser('${u.id}','${esc(u.display_name)}')" style="font-size:11px;margin-left:4px;">View As</button>
      </td>
    </tr>`;
  });
  html += `</tbody></table></div></div>`;

  // Audit log
  html += `<div class="card">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Recent Activity</h3>
    <div class="tbl-wrap"><table><thead><tr><th>User</th><th>Action</th><th>Entity</th><th>Time</th></tr></thead><tbody>`;
  audit.forEach(a => {
    html += `<tr>
      <td style="font-size:13px;">${esc(a.user?.display_name || '—')}</td>
      <td style="font-size:13px;font-weight:600;">${esc(a.action)}</td>
      <td style="font-size:13px;color:var(--muted);">${esc(a.entity_type || '—')}</td>
      <td style="font-size:12px;color:var(--muted);">${fmtRelative(a.created_at)}</td>
    </tr>`;
  });
  html += `</tbody></table></div></div>`;

  // Reconciliation section
  html += `<div class="card" style="margin-top:16px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="font-size:16px;font-weight:700;">Balance Reconciliation</h3>
      <button class="bp sm" onclick="runReconciliation()" id="recon-btn">Run Reconciliation</button>
    </div>
    <div id="recon-results"><p style="font-size:13px;color:var(--muted);">Click "Run Reconciliation" to compare balances between all linked user pairs.</p></div>
  </div>`;

  el.innerHTML = html;
}

window.runReconciliation = async function() {
  const btn = document.getElementById('recon-btn');
  const el = document.getElementById('recon-results');
  if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
  el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Checking all linked pairs...</p>';
  try {
    const resp = await fetch('/api/reconcile', { credentials: 'include' });
    const data = await resp.json();
    if (!data.ok) { el.innerHTML = `<p style="color:var(--red);">${esc(data.error || 'Failed')}</p>`; return; }

    const { pairs, mismatches, total } = data;
    let html = `<div class="grid3" style="margin-bottom:14px;">
      <div class="stat-card"><div class="stat-lbl">Linked Pairs</div><div class="stat-val">${total}</div></div>
      <div class="stat-card"><div class="stat-lbl">Mismatches</div><div class="stat-val" style="color:${mismatches > 0 ? 'var(--red)' : 'var(--green)'};">${mismatches}</div></div>
      <div class="stat-card"><div class="stat-lbl">Balanced</div><div class="stat-val" style="color:var(--green);">${total - mismatches}</div></div>
    </div>`;

    if (pairs.length === 0) {
      html += '<p style="font-size:13px;color:var(--muted);">No linked user pairs found. Share records with other platform users to create linked pairs.</p>';
    } else {
      html += `<div class="tbl-wrap"><table><thead><tr>
        <th>User A</th><th>User B</th>
        <th>A→B (Owed)</th><th>B→A (Owed)</th>
        <th>Difference</th><th>Status</th><th>Shares</th>
      </tr></thead><tbody>`;
      pairs.forEach(p => {
        const nameA = esc(p.userA.name || p.userA.email || '?');
        const nameB = esc(p.userB.name || p.userB.email || '?');
        const diff = p.difference.toFixed(2);
        const statusBadge = p.mismatch
          ? `<span class="badge badge-red">Mismatch</span>`
          : `<span class="badge badge-green">Balanced</span>`;
        html += `<tr style="${p.mismatch ? 'background:var(--red-bg,#fff5f5);' : ''}">
          <td style="font-weight:600;font-size:13px;">${nameA}</td>
          <td style="font-weight:600;font-size:13px;">${nameB}</td>
          <td style="font-size:13px;">$${p.balanceA.toy.toFixed(2)} / $${p.balanceA.yot.toFixed(2)}</td>
          <td style="font-size:13px;">$${p.balanceB.toy.toFixed(2)} / $${p.balanceB.yot.toFixed(2)}</td>
          <td style="font-size:13px;font-weight:700;color:${p.mismatch ? 'var(--red)' : 'var(--green)'};">$${diff}</td>
          <td>${statusBadge}</td>
          <td style="font-size:13px;text-align:center;">${p.tokens}</td>
        </tr>`;
        if (p.warning) {
          html += `<tr><td colspan="7" style="font-size:11px;color:var(--amber);padding:4px 12px;">⚠ ${esc(p.warning)}</td></tr>`;
        }
      });
      html += `</tbody></table></div>`;
    }
    el.innerHTML = html;
  } catch(e) {
    console.error('[reconciliation]', e);
    el.innerHTML = `<p style="color:var(--red);">Error: ${esc(e.message || 'Network error')}</p>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Reconciliation'; }
  }
};

window.changeUserRole = async function(userId, role) {
  await updateUserRole(userId, role);
  await logAudit(currentUser.id, 'change_role', { entityType: 'user', entityId: userId, details: { role } });
  toast('Role updated.', 'success');
};
window.suspendUser = async function(userId) {
  if (!confirm('Suspend this user?')) return;
  await updateUserStatus(userId, 'suspended');
  await logAudit(currentUser.id, 'suspend_user', { entityType: 'user', entityId: userId });
  toast('User suspended.', 'success'); navTo('admin');
};
window.activateUser = async function(userId) {
  await updateUserStatus(userId, 'active');
  await logAudit(currentUser.id, 'activate_user', { entityType: 'user', entityId: userId });
  toast('User activated.', 'success'); navTo('admin');
};

