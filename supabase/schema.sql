-- Gaelic Stats Logger - Supabase schema (redacted server storage)
-- Apply this in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Design goals:
-- - Do NOT store identifying data (team names, player names, competition, venue).
-- - Attribute rows to the authenticated user (auth.users).
-- - Support soft delete (deleted_at) for matches and stats.
-- - Support consent tracking (accept + revoke).

-- Enable required extensions (usually enabled by default)
create extension if not exists pgcrypto;

-- Matches (server-side, redacted)
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  public_match_id text not null, -- numeric string generated client-side
  match_date date not null,
  code text not null check (code in ('GAA','LGFA')),
  level text not null check (level in ('Intercounty','Senior','Intermediate','Junior','Minor','Other')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists matches_user_public_match_id_uniq
  on public.matches(user_id, public_match_id);

-- Stat entries (server-side, redacted)
create table if not exists public.stat_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  public_match_id text not null,

  stat_type text not null,
  is_pass boolean not null default false,
  half text not null check (half in ('first','second','et_first','et_second')),
  timestamp timestamptz not null,

  x_position double precision not null,
  y_position double precision not null,
  end_x_position double precision null,
  end_y_position double precision null,

  raw_x_position double precision null,
  raw_y_position double precision null,
  raw_end_x_position double precision null,
  raw_end_y_position double precision null,

  player_number integer null,
  recipient_number integer null,
  team_side text null check (team_side in ('home','away','unknown')),

  extra_data jsonb null,

  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists stat_entries_match_id_idx on public.stat_entries(match_id);
create index if not exists stat_entries_user_id_idx on public.stat_entries(user_id);
create index if not exists stat_entries_timestamp_idx on public.stat_entries(timestamp);

-- Consent tracking (server-side)
create table if not exists public.user_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_version text not null,
  accepted_at timestamptz null,
  revoked_at timestamptz null,
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.matches enable row level security;
alter table public.stat_entries enable row level security;
alter table public.user_consents enable row level security;

-- RLS policies: only the authenticated user can access their own rows
drop policy if exists matches_select_own on public.matches;
create policy matches_select_own on public.matches
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists matches_insert_own on public.matches;
create policy matches_insert_own on public.matches
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists matches_update_own on public.matches;
create policy matches_update_own on public.matches
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists stat_entries_select_own on public.stat_entries;
create policy stat_entries_select_own on public.stat_entries
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists stat_entries_insert_own on public.stat_entries;
create policy stat_entries_insert_own on public.stat_entries
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists stat_entries_update_own on public.stat_entries;
create policy stat_entries_update_own on public.stat_entries
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_consents_select_own on public.user_consents;
create policy user_consents_select_own on public.user_consents
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_consents_upsert_own on public.user_consents;
create policy user_consents_upsert_own on public.user_consents
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_consents_update_own on public.user_consents;
create policy user_consents_update_own on public.user_consents
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

