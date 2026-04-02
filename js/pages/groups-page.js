// Money IntX — Groups Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile, getMyBusinessId } from './state.js';
import { esc, toast, fmtDate, openModal, closeModal } from '../ui.js';
import { fmtMoney } from '../entries.js';
import { supabase } from '../supabase.js';
import { listContacts } from '../contacts.js';
import { createGroup, getGroup, deleteGroup, calcGroupStats, addGroupMember, removeGroupMember, createRound, markContributionPaid, postNotice, getNoticeBoard } from '../groups.js';

let _selectedGroups = new Set();

// Global function: calcGroupStats should be available on window

// ── Groups ────────────────────────────────────────────────────────
export async function renderGroups(el) {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();

  el.innerHTML = '<div class="page-header"><h2>👥 Groups</h2></div><p style="color:var(--muted);padding:20px;">Loading...</p>';
  let groups = [];
  try {
    // Parallelise: owned groups + membership rows fetched simultaneously
    const [ownedRes, memberRes] = await Promise.all([
      supabase.from('groups')
        .select('*, members:group_members(*), rounds:group_rounds(*, contributions:group_contributions(*))')
        .eq('user_id', currentUser.id).is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('group_members')
        .select('group_id').eq('user_id', currentUser.id).eq('status', 'active')
    ]);
    const { data, error } = ownedRes;
    if (error) throw error;
    const memberRows = memberRes.data;
    const memberGroupIds = (memberRows || []).map(r => r.group_id).filter(id => !data?.find(d => d.id === id));
    if (memberGroupIds.length > 0) {
      const { data: memberGroups } = await supabase
        .from('groups')
        .select('*, members:group_members(*), rounds:group_rounds(*, contributions:group_contributions(*))')
        .in('id', memberGroupIds)
        .is('archived_at', null);
      groups = [...(data || []), ...(memberGroups || [])];
    } else {
      groups = data || [];
    }
  } catch(err) {
    el.innerHTML = `<div class="page-header"><h2>👥 Groups</h2><button class="btn btn-primary btn-sm" onclick="openNewGroupModal()">+ New Group</button></div>
      <div class="card" style="color:var(--red);padding:20px;">Error loading groups: ${esc(err.message)}<br><small>Make sure the groups table exists (run SQL migration 001_foundation.sql).</small></div>`;
    return;
  }

  let html = `<div class="page-header">
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="group-logo.png" alt="Groups" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" onerror="this.style.display='none'">
      <div><h2 style="margin:0;">Group Savings</h2><p style="font-size:13px;color:var(--muted);margin-top:2px;">${groups.length} group${groups.length!==1?'s':''}</p></div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="openNewGroupModal()">+ New Group</button>
  </div>`;

  if (groups.length === 0) {
    html += `<div class="card" style="text-align:center;padding:48px 24px;">
      <div style="font-size:48px;margin-bottom:12px;">👥</div>
      <div style="font-size:17px;font-weight:700;margin-bottom:8px;">No groups yet</div>
      <p style="color:var(--muted);font-size:13px;max-width:360px;margin:0 auto 20px;">Create savings circles, ajo, susu, chamas, or any group contribution scheme.</p>
      <button class="btn btn-primary" onclick="openNewGroupModal()">+ Create First Group</button>
    </div>`;
  } else {
    // Bulk action bar
    if (_selectedGroups.size > 0) {
      html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--accent);border-radius:8px;margin-bottom:12px;color:#fff;">
        <span style="font-size:13px;font-weight:700;">${_selectedGroups.size} selected</span>
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button class="bs sm" onclick="bulkDeleteGroups()" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Delete</button>
          <button class="bs sm" onclick="clearGroupSelection()" style="background:rgba(255,255,255,.15);color:#fff;border:none;padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">✕ Clear</button>
        </div>
      </div>`;
    }

    groups.forEach(g => {
      const stats = calcGroupStats(g);
      const isOwner = g.user_id === currentUser.id;
      const activeMembers = (g.members || []).filter(m => m.status === 'active');
      const totalCollected = stats.totalCollected;
      html += `<div class="card" style="margin-bottom:12px;position:relative;">
        <label style="position:absolute;top:10px;right:42px;cursor:pointer;" onclick="event.stopPropagation();"><input type="checkbox" ${_selectedGroups.has(g.id)?'checked':''} onchange="toggleGroupSel('${g.id}',this.checked)" style="cursor:pointer;accent-color:var(--accent);"></label>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;">
            <h3 style="font-size:16px;margin:0 0 4px;cursor:pointer;font-weight:700;" onclick="openGroupDetail('${g.id}')">${esc(g.name)}</h3>
            ${g.description?`<p style="font-size:12px;color:var(--muted);margin-bottom:8px;">${esc(g.description)}</p>`:''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
              <span class="badge badge-blue">👥 ${activeMembers.length} member${activeMembers.length!==1?'s':''}</span>
              <span class="badge badge-green">💰 ${fmtMoney(g.amount,g.currency)} / ${esc(g.frequency)}</span>
              <span class="badge badge-gray">🔄 ${stats.roundCount} round${stats.roundCount!==1?'s':''}</span>
              ${g.use_rotation?'<span class="badge badge-yellow">⟳ Rotation</span>':''}
            </div>
            ${totalCollected > 0 ? `<div style="font-size:12px;color:var(--green);font-weight:700;">Total collected: ${fmtMoney(totalCollected,g.currency)}</div>` : ''}
            ${stats.currentRound?`<p style="font-size:12px;color:var(--muted);margin-top:4px;">Round ${stats.currentRound.round_number}: ${stats.paidInRound}/${activeMembers.length} paid</p>`:''}
          </div>
          <div class="action-menu">
            <button class="action-menu-btn" onclick="window.toggleActionMenu(this)">⋮</button>
            <div class="action-dropdown">
              <button onclick="openGroupDetail('${g.id}')">👁 View</button>
              ${isOwner?`<button onclick="openAddMemberModal('${g.id}')">+ Add Member</button>`:''}
              ${isOwner?`<button onclick="doCreateRound('${g.id}')">New Round</button>`:''}
              ${isOwner?`<button onclick="confirmDeleteGroup('${g.id}')" style="color:var(--red);">Delete</button>`:''}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border);margin-top:4px;">
          <button class="btn btn-secondary btn-sm" onclick="openGroupDetail('${g.id}')">View</button>
          ${isOwner?`<button class="btn btn-secondary btn-sm" onclick="openAddMemberModal('${g.id}')">+ Member</button>`:''}
          ${isOwner?`<button class="btn btn-secondary btn-sm" onclick="doCreateRound('${g.id}')">+ Round</button>`:''}
        </div>
      </div>`;
    });
  }
  el.innerHTML = html;
}

// V1-style group creation — name, amount, frequency, initial members, rotation all at once
window.openNewGroupModal = async function() {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const contacts = await listContacts(getMyBusinessId());
  const contactOpts = contacts.map(c=>`<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  window._newGroupMembers = []; // [{contactId, name}]

  openModal(`
    <div class="modal-title">New Group</div>

    <div class="form-group"><label>Group Name *</label><input type="text" id="ng-name" placeholder="e.g. Friday Savings, Lagos Ajo Club"></div>
    <div class="form-group"><label>Description</label><textarea id="ng-desc" rows="2" placeholder="Purpose or rules of this group…"></textarea></div>

    <div class="form-row">
      <div class="form-group"><label>Contribution Amount</label><input type="number" id="ng-amount" min="0" step="0.01" placeholder="e.g. 5000"></div>
      <div class="form-group"><label>Currency</label><select id="ng-currency">
        ${['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','AED','SAR','BRL','EGP','MAD','TZS','UGX','ETB','XOF'].map(c=>`<option value="${c}" ${(currentProfile?.default_currency||'USD')===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Frequency</label><select id="ng-freq">
        <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
        <option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="custom">Custom</option>
      </select></div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" id="ng-rotation" style="width:auto;accent-color:var(--accent);"> Rotation (Ajo/Susu)
      </label>
      <p style="font-size:11px;color:var(--muted);margin-top:4px;">Each member receives the pot in turn</p></div>
    </div>

    <!-- Initial members -->
    <div style="margin-top:4px;">
      <div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Add Initial Members</div>
      <div id="ng-members-list" style="margin-bottom:8px;"></div>
      <div style="display:flex;gap:6px;">
        <select id="ng-member-select" style="flex:1;">${contactOpts||'<option value="">No contacts — add some first</option>'}</select>
        <button type="button" class="bs sm" onclick="_ngAddMember()">+ Add</button>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;">You are automatically added as the owner.</p>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn sm" onclick="doCreateGroup()">Create Group</button>
    </div>
  `, { maxWidth: '500px' });
};

window._ngAddMember = function() {
  const sel = document.getElementById('ng-member-select');
  const cId = sel.value;
  const cName = sel.options[sel.selectedIndex]?.dataset?.name || 'Member';
  if (!cId || window._newGroupMembers.find(m => m.contactId === cId)) return;
  window._newGroupMembers.push({ contactId: cId, name: cName });
  const list = document.getElementById('ng-members-list');
  if (list) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg3);border-radius:7px;margin-bottom:6px;font-size:13px;';
    div.dataset.cid = cId;
    div.innerHTML = `<span>👤 ${esc(cName)}</span><button type="button" class="bs sm" style="font-size:11px;color:var(--red);padding:2px 8px;" onclick="this.closest('[data-cid]').remove();window._newGroupMembers=window._newGroupMembers.filter(m=>m.contactId!=='${cId}')">✕</button>`;
    list.appendChild(div);
  }
};

window.doCreateGroup = async function() {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const name = document.getElementById('ng-name').value.trim();
  if (!name) return toast('Name required.', 'error');
  const g = await createGroup(currentUser.id, {
    name,
    description: document.getElementById('ng-desc').value.trim(),
    amount: parseFloat(document.getElementById('ng-amount').value) || 0,
    currency: document.getElementById('ng-currency').value || (currentProfile?.default_currency || 'USD'),
    frequency: document.getElementById('ng-freq').value,
    useRotation: document.getElementById('ng-rotation').checked
  });
  if (!g) return toast('Failed to create group. Check console.', 'error');
  // Add initial members
  const members = window._newGroupMembers || [];
  for (const m of members) {
    await addGroupMember(g.id, { contactId: m.contactId, name: m.name, role: 'member' });
  }
  closeModal();
  toast(`Group "${name}" created${members.length>0?` with ${members.length} member${members.length!==1?'s':''}`:''}. You are the owner.`, 'success');
  window.navTo('groups');
};

// ── Group Detail ──────────────────────────────────────────────────
// Role permission matrix
const GROUP_ROLE_PERMS = {
  owner:   { label: 'Owner',   badge: 'badge-purple', canManageMembers: true,  canManageRounds: true,  canEditGroup: true,  canPost: true, canUploadDocs: true, canViewAll: true },
  admin:   { label: 'Admin',   badge: 'badge-blue',   canManageMembers: true,  canManageRounds: true,  canEditGroup: true,  canPost: true, canUploadDocs: true, canViewAll: true },
  member:  { label: 'Member',  badge: 'badge-gray',   canManageMembers: false, canManageRounds: false, canEditGroup: false, canPost: true, canUploadDocs: true, canViewAll: true },
  invitee: { label: 'Invitee', badge: 'badge-yellow', canManageMembers: false, canManageRounds: false, canEditGroup: false, canPost: false, canUploadDocs: false, canViewAll: false }
};
function getMyGroupRole(g) {
  const currentUser = getCurrentUser();
  if (g.user_id === currentUser.id) return 'owner';
  const me = (g.members || []).find(m => m.user_id === currentUser.id || m.contact_id === currentUser.id);
  return me?.role || 'member';
}

window.openGroupDetail = async function(id) {
  const g = await getGroup(id);
  if (!g) return toast('Group not found.', 'error');
  const stats = calcGroupStats(g);
  const members = (g.members || []).filter(m => m.status === 'active' || m.status === 'invited');
  const rounds = g.rounds || [];
  const notices = await getNoticeBoard(id);
  const myRole  = getMyGroupRole(g);
  const myPerms = GROUP_ROLE_PERMS[myRole] || GROUP_ROLE_PERMS.member;
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'admin' || isOwner;
  const rotationLocked = g.rotation_locked ?? false;

  const ROLE_BADGE = { owner: 'badge-purple', admin: 'badge-blue', member: 'badge-gray', invitee: 'badge-yellow' };
  const membersHtml = members.map(m => {
    const rBadge = ROLE_BADGE[m.role] || 'badge-gray';
    const isInvitee = m.status === 'invited' || m.role === 'invitee';
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
      <div>
        <span style="font-weight:600;">${esc(m.name)}</span>
        <span class="badge ${rBadge}" style="margin-left:6px;font-size:10px;">${esc(GROUP_ROLE_PERMS[m.role]?.label || m.role)}</span>
        ${isInvitee ? '<span class="badge badge-yellow" style="margin-left:4px;font-size:10px;">Pending invite</span>' : ''}
        ${m.role === 'member' ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">Can post, upload docs, view all data, leave group</div>' : ''}
        ${m.role === 'admin'  ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">Full control (cannot delete group)</div>' : ''}
        ${isInvitee           ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">Invited to join — no permissions until accepted</div>' : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${isAdmin && m.role !== 'owner' ? `
          <select onchange="doChangeRole('${m.id}','${id}',this.value)" style="font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);">
            <option value="member" ${m.role==='member'?'selected':''}>Member</option>
            <option value="admin"  ${m.role==='admin'?'selected':''}>Admin</option>
            <option value="invitee" ${m.role==='invitee'?'selected':''}>Invitee</option>
          </select>
          <button class="bs sm" style="font-size:11px;color:var(--red);" onclick="doRemoveMember('${m.id}','${esc(m.name)}','${id}')">✕</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--muted);font-size:13px;">No members yet.</p>';

  const recentRounds = rounds.slice(-3).reverse();
  const roundsHtml = recentRounds.map(r => {
    const contribs = r.contributions || [];
    const paid = contribs.filter(c => c.paid).length;
    return `<div style="background:var(--bg3);border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="font-weight:700;">Round ${r.round_number}</span>
        <span class="badge ${r.status==='completed'?'badge-green':'badge-blue'}">${paid}/${contribs.length} paid</span>
      </div>
      ${contribs.map(c => {
        const mem = members.find(m => m.id === c.member_id);
        return `<div style="display:flex;justify-content:space-between;padding:3px 0;">
          <span style="color:var(--muted);">${esc(mem?.name||'—')}</span>
          ${c.paid ? '<span style="color:var(--green);font-weight:600;">✓ Paid</span>' :
            isOwner ? `<button class="btn btn-primary btn-sm" style="padding:2px 8px;font-size:11px;" onclick="doMarkPaid('${c.id}','${id}')">Mark Paid</button>` :
            '<span style="color:var(--amber);">Pending</span>'}
        </div>`;
      }).join('')}
    </div>`;
  }).join('') || '<p style="color:var(--muted);font-size:13px;">No rounds yet.</p>';

  const noticesHtml = notices.slice(0,5).map(n => `
    <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <div style="display:flex;justify-content:space-between;"><span style="font-weight:600;">${esc(n.user_name)}</span><span style="color:var(--muted);font-size:11px;">${fmtDate(n.created_at)}</span></div>
      <p style="margin-top:2px;color:var(--text);">${esc(n.message)}</p>
    </div>`).join('') || '<p style="color:var(--muted);font-size:13px;">No messages yet.</p>';

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
      <div>
        <h3 style="margin:0;">${esc(g.name)}</h3>
        <p style="color:var(--muted);font-size:13px;margin-top:2px;">${esc(g.description||'')}${g.use_rotation?' · ⟳ Rotation':''}${g.frequency?' · '+esc(g.frequency):''}</p>
        <span class="badge ${GROUP_ROLE_PERMS[myRole]?.badge||'badge-gray'}" style="margin-top:4px;display:inline-block;">You: ${GROUP_ROLE_PERMS[myRole]?.label||myRole}</span>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Close</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-lbl">Members</div><div class="stat-val">${stats.memberCount}</div></div>
      <div class="stat-card"><div class="stat-lbl">Rounds</div><div class="stat-val">${stats.roundCount}</div></div>
      <div class="stat-card"><div class="stat-lbl">Collected</div><div class="stat-val" style="font-size:14px;">${fmtMoney(stats.totalCollected,g.currency)}</div></div>
    </div>
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h4 style="font-size:14px;font-weight:700;">Members</h4>
        ${isAdmin?`<button class="bs sm" style="font-size:11px;" onclick="closeModal();openAddMemberModal('${id}')">+ Add Member</button>`:''}
      </div>
      ${membersHtml}
    </div>
    ${g.use_rotation && isAdmin ? `
    <div style="margin-bottom:16px;padding:12px 14px;background:var(--bg3);border-radius:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:13px;font-weight:700;">⟳ Rotation Order</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${rotationLocked ? '🔒 Locked — order cannot be changed by members' : '🔓 Unlocked — you can reorder members'}</div>
        </div>
        ${rotationLocked
          ? `<button class="bs sm" style="color:var(--amber);font-size:12px;" onclick="doSetRotationLock('${id}',false)">🔓 Unlock Rotation Order</button>`
          : `<button class="btn sm" style="font-size:12px;padding:6px 14px;" onclick="doSetRotationLock('${id}',true)">🔒 Lock Rotation Order</button>`
        }
      </div>
    </div>` : ''}
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h4 style="font-size:14px;font-weight:700;">Recent Rounds</h4>
        ${isAdmin?`<button class="bs sm" style="font-size:11px;" onclick="doCreateRound('${id}');closeModal();">+ New Round</button>`:''}
      </div>
      ${roundsHtml}
    </div>
    <div>
      <h4 style="font-size:14px;font-weight:700;margin-bottom:8px;">Notice Board</h4>
      <div style="max-height:200px;overflow-y:auto;">${noticesHtml}</div>
      ${myPerms.canPost ? `
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="notice-msg" placeholder="Write a message to the group…" style="flex:1;">
        <button class="btn btn-primary btn-sm" onclick="doPostNotice('${id}')">Post</button>
      </div>` : '<p style="font-size:12px;color:var(--muted);margin-top:8px;">Accept your invite to post on the notice board.</p>'}
    </div>
  `, { maxWidth: '580px' });
};

window.openAddMemberModal = async function(groupId) {
  const contacts = await listContacts(getMyBusinessId());
  const opts = contacts.map(c=>`<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  openModal(`
    <h3 style="margin-bottom:16px;">Add Member</h3>
    <div class="form-group"><label>Contact</label><select id="am-contact">${opts||'<option value="">No contacts</option>'}</select></div>
    <div class="form-group"><label>Role</label>
      <select id="am-role">
        <option value="member">Member — can post, upload docs, view all data, leave</option>
        <option value="admin">Admin — full control (cannot delete group)</option>
        <option value="invitee">Invitee — pending acceptance, no permissions yet</option>
      </select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn sm" onclick="doAddMember('${groupId}')">Add Member</button>
    </div>
  `);
};

window.doAddMember = async function(groupId) {
  const sel = document.getElementById('am-contact');
  const contactId = sel.value;
  const name = sel.options[sel.selectedIndex]?.dataset?.name || 'Member';
  const role = document.getElementById('am-role')?.value || 'member';
  if (!contactId) return toast('Select a contact.', 'error');
  const result = await addGroupMember(groupId, { contactId, name, role });
  if (!result) return toast('Failed to add member.', 'error');
  closeModal();
  toast('Member added.', 'success');
  window.navTo('groups');
};

window.doRemoveMember = async function(memberId, name, groupId) {
  if (!confirm(`Remove ${name} from the group?`)) return;
  await removeGroupMember(memberId);
  toast('Member removed.', 'success');
  closeModal();
  if (groupId) openGroupDetail(groupId);
  else navTo('groups');
};

window.doChangeRole = async function(memberId, groupId, newRole) {
  const { error } = await supabase.from('group_members').update({ role: newRole }).eq('id', memberId);
  if (error) { toast('Failed to update role.', 'error'); return; }
  toast(`Role updated to ${newRole}.`, 'success');
  closeModal();
  openGroupDetail(groupId);
};

window.doSetRotationLock = async function(groupId, lock) {
  const { error } = await supabase.from('groups').update({ rotation_locked: lock }).eq('id', groupId);
  if (error) { toast('Failed to update rotation lock.', 'error'); return; }
  toast(lock ? '🔒 Rotation order locked.' : '🔓 Rotation order unlocked.', 'success');
  closeModal();
  openGroupDetail(groupId);
};

window.doCreateRound = async function(groupId) {
  const round = await createRound(groupId);
  if (!round) return toast('Failed to create round.', 'error');
  toast('New round created.', 'success');
  navTo('groups');
};

window.doMarkPaid = async function(contributionId, groupId) {
  await markContributionPaid(contributionId);
  toast('Marked as paid.', 'success');
  closeModal();
  openGroupDetail(groupId);
};

window.doPostNotice = async function(groupId) {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();
  const msg = document.getElementById('notice-msg').value.trim();
  if (!msg) return toast('Enter a message.', 'error');
  await postNotice(groupId, currentUser.id, currentProfile?.display_name || 'User', msg);
  document.getElementById('notice-msg').value = '';
  closeModal();
  window.openGroupDetail(groupId);
};

window.confirmDeleteGroup = async function(id) {
  if (!confirm('Delete this group? All rounds and member data will be lost.')) return;
  await deleteGroup(id);
  toast('Group deleted.', 'success');
  window.navTo('groups');
};

window.toggleGroupSel = function(id, checked) {
  if (checked) _selectedGroups.add(id); else _selectedGroups.delete(id);
  renderGroups(document.getElementById('content'));
};

window.clearGroupSelection = function() {
  _selectedGroups.clear();
  renderGroups(document.getElementById('content'));
};

window.bulkDeleteGroups = async function() {
  if (_selectedGroups.size === 0) return;
  if (!confirm(`Delete ${_selectedGroups.size} group(s)? All rounds and member data will be lost.`)) return;
  const ids = [..._selectedGroups];
  for (const id of ids) {
    await deleteGroup(id);
  }
  _selectedGroups.clear();
  toast(`${ids.length} group(s) deleted`, 'success');
  renderGroups(document.getElementById('content'));
};

