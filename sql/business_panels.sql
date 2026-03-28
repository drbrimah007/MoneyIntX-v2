-- Money IntX v2 — Business Panel Migration
-- Run this in your Supabase SQL editor

-- ── Panels table ──────────────────────────────────────────────────
create table if not exists business_panels (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  title        text not null,
  currency     text not null default 'USD',
  session_type text not null default 'monthly', -- 'weekly' | 'monthly'
  fields       jsonb not null default '[]',
  archived     boolean not null default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table business_panels enable row level security;

create policy "bp_owner_all" on business_panels
  for all using (auth.uid() = user_id);

-- ── Rows table ────────────────────────────────────────────────────
create table if not exists business_panel_rows (
  id          uuid default gen_random_uuid() primary key,
  panel_id    uuid references business_panels(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  session_key text not null,      -- e.g. '2026-03' or '2026-W12'
  row_date    date not null default current_date,
  values      jsonb not null default '{}',   -- { field_id: value }
  archived    boolean not null default false,
  created_at  timestamptz default now()
);

alter table business_panel_rows enable row level security;

create policy "bpr_owner_all" on business_panel_rows
  for all using (auth.uid() = user_id);

-- ── Indexes ───────────────────────────────────────────────────────
create index if not exists idx_bp_user on business_panels(user_id);
create index if not exists idx_bpr_panel on business_panel_rows(panel_id);
create index if not exists idx_bpr_session on business_panel_rows(panel_id, session_key);
