-- Vitality v2 — initial schema (Phase 0 of the Supabase migration).
--
-- Tenancy: closed family/small-group (≤10 users). Public sign-ups are
-- expected to be disabled in the Supabase Auth dashboard; allowlisted
-- accounts are provisioned manually via Auth → Users → Invite.
--
-- All app-owned tables enable RLS with a single "own data only" policy
-- keyed off auth.uid(). The telemetry table allows authenticated inserts
-- but no client-side reads.

-- ─────────────────────────────────────────────────────────────────────
-- days — one row per (user, calendar date). Mirrors the dayHistory entry.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.days (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  day_date     date not null,
  gaps_closed  smallint,
  energy       smallint check (energy is null or energy between 1 and 5),
  digestion    smallint check (digestion is null or digestion between 1 and 5),
  notes        text,
  totals       jsonb,
  carryover    jsonb,
  updated_at   timestamptz not null default now(),
  unique (user_id, day_date)
);

-- Generated calorie column for fast aggregate queries.
alter table public.days
  add column if not exists calories int
  generated always as (
    (
      coalesce((totals->>'protein')::numeric, 0) * 4 +
      coalesce((totals->>'carbs')::numeric,   0) * 4 +
      coalesce((totals->>'fat')::numeric,     0) * 9
    )::int
  ) stored;

create index if not exists days_user_date_idx
  on public.days (user_id, day_date desc);

-- ─────────────────────────────────────────────────────────────────────
-- day_entries — append-only meal entries. Soft-delete via deleted_at so
-- cross-device LWW stays merge-safe (Pillar 3, Phase 5).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.day_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  day_date          date not null,
  idempotency_key   text not null,
  recipe_id         text,
  name              text not null,
  emoji             text,
  nutrients         jsonb not null,
  ingredient_states jsonb,
  logged_at         timestamptz not null,
  synced_at         timestamptz not null default now(),
  deleted_at        timestamptz,
  -- idempotency_key is `${client_id}:${genId()}`, globally unique.
  unique (idempotency_key)
);

create index if not exists day_entries_user_date_idx
  on public.day_entries (user_id, day_date, deleted_at);

-- ─────────────────────────────────────────────────────────────────────
-- telemetry_spans — append-only span sink for the OTel-shaped tracer.
-- Edge Function /observe inserts here; clients never read.
-- 30-day retention enforced via pg_cron (set up out-of-band; see notes).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.telemetry_spans (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users on delete set null,
  trace_id   text,
  span_id    text,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists telemetry_spans_created_at_idx
  on public.telemetry_spans (created_at);

-- ─────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────
alter table public.days            enable row level security;
alter table public.day_entries     enable row level security;
alter table public.telemetry_spans enable row level security;

drop policy if exists "days own data only"        on public.days;
drop policy if exists "day_entries own data only" on public.day_entries;
drop policy if exists "spans insert own only"     on public.telemetry_spans;
drop policy if exists "spans no client read"      on public.telemetry_spans;

create policy "days own data only"
  on public.days
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "day_entries own data only"
  on public.day_entries
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Telemetry: allow authenticated insert keyed to self, no select to clients.
-- Service-role key bypasses RLS for ad-hoc dashboard queries.
create policy "spans insert own only"
  on public.telemetry_spans
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- Notes (run manually after this migration applies):
--   1. Auth → Providers: disable public email sign-ups.
--   2. Auth → Users → Invite each allowlisted family member.
--   3. Schedule retention:
--        select cron.schedule(
--          'telemetry_spans_retention_30d', '17 3 * * *',
--          $$ delete from public.telemetry_spans
--             where created_at < now() - interval '30 days' $$
--        );
--      (Requires the pg_cron extension; enable in Database → Extensions.)
-- ─────────────────────────────────────────────────────────────────────
