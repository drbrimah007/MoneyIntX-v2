-- Money IntX v2 — Business Panel Member Permissions
-- Run in Supabase SQL Editor after business_panels.sql

-- ── Members table ─────────────────────────────────────────────────
create table if not exists business_panel_members (
  id             uuid default gen_random_uuid() primary key,
  panel_id       uuid references business_panels(id) on delete cascade not null,
  member_user_id uuid references auth.users(id) on delete cascade not null,
  can_add        boolean not null default true,   -- can add rows
  can_edit       boolean not null default false,  -- can edit/delete rows
  added_at       timestamptz default now(),
  unique (panel_id, member_user_id)
);

alter table business_panel_members enable row level security;

-- Panel owner can do everything with their panel's memberships
create policy "bpm_owner_all" on business_panel_members
  for all using (
    exists (
      select 1 from business_panels
      where id = panel_id and user_id = auth.uid()
    )
  );

-- Members can read their own membership record
create policy "bpm_self_read" on business_panel_members
  for select using (member_user_id = auth.uid());

-- ── Extended RLS for business_panels ─────────────────────────────
-- (Original policy already covers owner; add member read access)
create policy "bp_member_read" on business_panels
  for select using (
    exists (
      select 1 from business_panel_members
      where panel_id = id and member_user_id = auth.uid()
    )
  );

-- ── Extended RLS for business_panel_rows ─────────────────────────

-- Members can read rows on panels they belong to
create policy "bpr_member_read" on business_panel_rows
  for select using (
    exists (
      select 1 from business_panel_members
      where panel_id = business_panel_rows.panel_id
        and member_user_id = auth.uid()
    )
  );

-- Members with can_add can insert rows (user_id must be their own)
create policy "bpr_member_insert" on business_panel_rows
  for insert with check (
    auth.uid() = user_id and
    exists (
      select 1 from business_panel_members
      where panel_id = business_panel_rows.panel_id
        and member_user_id = auth.uid()
        and can_add = true
    )
  );

-- Members with can_edit can update rows
create policy "bpr_member_update" on business_panel_rows
  for update using (
    exists (
      select 1 from business_panel_members
      where panel_id = business_panel_rows.panel_id
        and member_user_id = auth.uid()
        and can_edit = true
    )
  );

-- Members with can_edit can delete rows
create policy "bpr_member_delete" on business_panel_rows
  for delete using (
    exists (
      select 1 from business_panel_members
      where panel_id = business_panel_rows.panel_id
        and member_user_id = auth.uid()
        and can_edit = true
    )
  );

-- ── Index ─────────────────────────────────────────────────────────
create index if not exists idx_bpm_panel   on business_panel_members(panel_id);
create index if not exists idx_bpm_member  on business_panel_members(member_user_id);
