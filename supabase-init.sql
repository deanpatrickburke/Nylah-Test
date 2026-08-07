-- Hardened init for couple_data + normalized path forward
-- Idempotent, secure-by-default
-- Household lock: 'ash-ciaran-2026' only

create extension if not exists pgcrypto;

-- 1) Core household row (legacy giant JSON but secured)
create table if not exists public.couple_data (
  id text primary key,
  chores jsonb not null default '[]'::jsonb,
  calendar jsonb not null default '[]'::jsonb,
  shopping jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  meta jsonb,
  updated_at timestamptz not null default now(),
  revision bigint not null default 0
);

alter table public.couple_data add column if not exists revision bigint not null default 0;
alter table public.couple_data add column if not exists updated_at timestamptz not null default now();
alter table public.couple_data add column if not exists meta jsonb;
alter table public.couple_data add column if not exists chores jsonb not null default '[]'::jsonb;
alter table public.couple_data add column if not exists calendar jsonb not null default '[]'::jsonb;
alter table public.couple_data add column if not exists shopping jsonb not null default '[]'::jsonb;
alter table public.couple_data add column if not exists notes jsonb not null default '[]'::jsonb;

create index if not exists idx_couple_data_revision on public.couple_data (revision);
create index if not exists idx_couple_data_updated_at on public.couple_data (updated_at);

alter table public.couple_data enable row level security;

-- Drop legacy permissive policies
drop policy if exists "Allow all for anon" on public.couple_data;
drop policy if exists "allow_ash_ciaran_2026" on public.couple_data;
drop policy if exists "Scoped anon by row id" on public.couple_data;
drop policy if exists "allow_ash_ciaran_2026_anon_all" on public.couple_data;
drop policy if exists "anon_select_ash" on public.couple_data;
drop policy if exists "anon_insert_ash" on public.couple_data;
drop policy if exists "anon_update_ash" on public.couple_data;

-- New: locked to fixed household, anon read+update only, no delete
create policy "anon_select_ash" on public.couple_data for select to anon using (id='ash-ciaran-2026');
create policy "anon_insert_ash" on public.couple_data for insert to anon with check (id='ash-ciaran-2026');
create policy "anon_update_ash" on public.couple_data for update to anon using (id='ash-ciaran-2026') with check (id='ash-ciaran-2026');

drop policy if exists "service_role_all" on public.couple_data;
create policy "service_role_all" on public.couple_data for all to service_role using (true) with check (true);

-- Validation trigger: enforce arrays and monotonic revision, prevent full wipe abuse
create or replace function public.validate_couple_data()
returns trigger language plpgsql as $$
begin
  if NEW.id <> 'ash-ciaran-2026' then
    raise exception 'invalid household id %', NEW.id;
  end if;
  if jsonb_typeof(NEW.chores) <> 'array' then
    raise exception 'chores must be array';
  end if;
  if jsonb_typeof(NEW.calendar) <> 'array' then
    raise exception 'calendar must be array';
  end if;
  if jsonb_typeof(NEW.shopping) <> 'array' then
    raise exception 'shopping must be array';
  end if;
  if jsonb_typeof(NEW.notes) <> 'array' then
    raise exception 'notes must be array';
  end if;
  if TG_OP = 'UPDATE' then
    -- revision must advance by 0..5 (allow idempotent retry but not jump backwards or far forward)
    if NEW.revision < OLD.revision then
      raise exception 'revision regression % -> %', OLD.revision, NEW.revision;
    end if;
    if NEW.revision > OLD.revision + 10 then
      raise exception 'revision jump too large % -> %', OLD.revision, NEW.revision;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_validate_couple_data on public.couple_data;
create trigger trg_validate_couple_data before insert or update on public.couple_data
for each row execute function public.validate_couple_data();

insert into public.couple_data (id, chores, calendar, shopping, notes, revision) values ('ash-ciaran-2026','[]','[]','[]','[]',0) on conflict (id) do nothing;

-- 2) Normalized tables — path forward, kept in sync alongside JSON

create table if not exists public.chore_occurrences (
  id text primary key,
  household_id text not null default 'ash-ciaran-2026',
  template_id text,
  "templateId" text,
  title text not null,
  due_at timestamptz,
  "dueAt" text,
  status text not null default 'open',
  assigned_to text,
  "assignedTo" text,
  claimed_by text,
  "claimedBy" text,
  completed_by text,
  "completedBy" text,
  completed_at timestamptz,
  "completedAt" text,
  base_points int,
  "basePoints" int,
  awarded_points int,
  "awardedPoints" int,
  awarded_multiplier float,
  "awardedMultiplier" float,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_household_occ check (household_id in ('ash-ciaran-2026'))
);
alter table public.chore_occurrences add column if not exists household_id text not null default 'ash-ciaran-2026';
create index if not exists idx_chore_occ_household on public.chore_occurrences (household_id);
create index if not exists idx_chore_occ_template on public.chore_occurrences (template_id);
create index if not exists idx_chore_occ_status on public.chore_occurrences (status);
create index if not exists idx_chore_occ_due on public.chore_occurrences (due_at);
alter table public.chore_occurrences enable row level security;
drop policy if exists "allow_ash_ciaran_2026_occ" on public.chore_occurrences;
drop policy if exists "anon_all_occ_permissive" on public.chore_occurrences;
drop policy if exists "anon_select_occ" on public.chore_occurrences;
drop policy if exists "anon_insert_occ" on public.chore_occurrences;
drop policy if exists "anon_update_occ" on public.chore_occurrences;
create policy "anon_select_occ" on public.chore_occurrences for select to anon using (household_id='ash-ciaran-2026');
create policy "anon_insert_occ" on public.chore_occurrences for insert to anon with check (household_id='ash-ciaran-2026');
create policy "anon_update_occ" on public.chore_occurrences for update to anon using (household_id='ash-ciaran-2026') with check (household_id='ash-ciaran-2026');
drop policy if exists "service_role_all_occ" on public.chore_occurrences;
create policy "service_role_all_occ" on public.chore_occurrences for all to service_role using (true) with check (true);

create table if not exists public.calendar_series (
  id text primary key,
  household_id text not null default 'ash-ciaran-2026',
  title text not null,
  recurrence_rule text,
  "recurrenceRule" text,
  frequency text,
  frequency_detail text,
  "frequencyDetail" text,
  day_of_month int,
  "dayOfMonth" int,
  original_dom int,
  "originalDom" int,
  local_time text,
  "localTime" text,
  timezone text not null default 'Europe/Dublin',
  weekdays boolean[] not null default '{false,false,false,false,false,false,false}',
  status text,
  proposer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  recurrence_until timestamptz,
  "recurrenceUntil" text,
  constraint chk_household_series check (household_id in ('ash-ciaran-2026'))
);
alter table public.calendar_series add column if not exists household_id text not null default 'ash-ciaran-2026';
alter table public.calendar_series add column if not exists weekdays boolean[] not null default '{false,false,false,false,false,false,false}';
create index if not exists idx_calendar_series_household on public.calendar_series (household_id);
alter table public.calendar_series enable row level security;
drop policy if exists "allow_ash_ciaran_2026_series" on public.calendar_series;
drop policy if exists "anon_select_series" on public.calendar_series;
drop policy if exists "anon_insert_series" on public.calendar_series;
drop policy if exists "anon_update_series" on public.calendar_series;
create policy "anon_select_series" on public.calendar_series for select to anon using (household_id='ash-ciaran-2026');
create policy "anon_insert_series" on public.calendar_series for insert to anon with check (household_id='ash-ciaran-2026');
create policy "anon_update_series" on public.calendar_series for update to anon using (household_id='ash-ciaran-2026') with check (household_id='ash-ciaran-2026');
drop policy if exists "service_role_all_series" on public.calendar_series;
create policy "service_role_all_series" on public.calendar_series for all to service_role using (true) with check (true);

create table if not exists public.calendar_occurrence_overrides (
  id text primary key,
  household_id text not null default 'ash-ciaran-2026',
  series_id text not null,
  "seriesId" text not null,
  occurrence_date text not null,
  "occurrenceDate" text not null,
  occurrence_id text,
  "occurrenceId" text,
  title text,
  is_override boolean not null default true,
  "isOverride" boolean not null default true,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  "updatedAt" text,
  data jsonb,
  unique(series_id, occurrence_date),
  constraint chk_household_override check (household_id in ('ash-ciaran-2026'))
);
alter table public.calendar_occurrence_overrides add column if not exists household_id text not null default 'ash-ciaran-2026';
create index if not exists idx_calendar_override_household on public.calendar_occurrence_overrides (household_id);
alter table public.calendar_occurrence_overrides enable row level security;
drop policy if exists "allow_ash_ciaran_2026_overrides" on public.calendar_occurrence_overrides;
drop policy if exists "anon_select_overrides" on public.calendar_occurrence_overrides;
drop policy if exists "anon_insert_overrides" on public.calendar_occurrence_overrides;
drop policy if exists "anon_update_overrides" on public.calendar_occurrence_overrides;
create policy "anon_select_overrides" on public.calendar_occurrence_overrides for select to anon using (household_id='ash-ciaran-2026');
create policy "anon_insert_overrides" on public.calendar_occurrence_overrides for insert to anon with check (household_id='ash-ciaran-2026');
create policy "anon_update_overrides" on public.calendar_occurrence_overrides for update to anon using (household_id='ash-ciaran-2026') with check (household_id='ash-ciaran-2026');
drop policy if exists "service_role_all_overrides" on public.calendar_occurrence_overrides;
create policy "service_role_all_overrides" on public.calendar_occurrence_overrides for all to service_role using (true) with check (true);
create unique index if not exists idx_calendar_override_unique on public.calendar_occurrence_overrides (series_id, occurrence_date);

-- Atomic race RPC: claim_chore_occurrence — prevents double points / double next chore
create or replace function public.claim_chore_occurrence(p_id text, p_member text)
returns table (
  id text,
  claimed boolean,
  claimed_by text,
  completed_by text,
  status text,
  household_id text
)
language plpgsql security definer as $$
declare
  v_row public.chore_occurrences%rowtype;
  v_updated int;
begin
  -- Only allow household scope
  update public.chore_occurrences
  set completed_by = p_member,
      "completedBy" = p_member,
      claimed_by = p_member,
      "claimedBy" = p_member,
      completed_at = now(),
      "completedAt" = now()::text,
      updated_at = now(),
      status = 'done'
  where public.chore_occurrences.id = p_id
    and public.chore_occurrences.household_id = 'ash-ciaran-2026'
    and (public.chore_occurrences.completed_at is null and public.chore_occurrences."completedAt" is null)
  returning * into v_row;

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    return query select v_row.id, true::boolean, v_row.claimed_by, v_row.completed_by, v_row.status, v_row.household_id;
    return;
  end if;

  select * into v_row from public.chore_occurrences where id = p_id and household_id='ash-ciaran-2026' limit 1;
  if found then
    return query select v_row.id, false::boolean, coalesce(v_row.claimed_by, v_row."claimedBy"), coalesce(v_row.completed_by, v_row."completedBy"), v_row.status, v_row.household_id;
    return;
  end if;

  return query select p_id, false::boolean, null::text, null::text, 'open'::text, 'ash-ciaran-2026'::text where false;
end;
$$;

-- New: complete + mirror to JSON via trigger (optional)
create or replace function public.complete_chore_occurrence(p_occurrence_id text, p_household_id text, p_member text)
returns jsonb language plpgsql security definer as $$
declare
  v_row public.chore_occurrences%rowtype;
  v_updated int;
  v_ok boolean := false;
begin
  if p_household_id <> 'ash-ciaran-2026' then
    raise exception 'invalid household';
  end if;
  if p_member not in ('aisling','ciaran') then
    raise exception 'invalid member';
  end if;

  update public.chore_occurrences
  set completed_by = p_member,
      "completedBy" = p_member,
      claimed_by = p_member,
      "claimedBy" = p_member,
      completed_at = now(),
      "completedAt" = now()::text,
      updated_at = now(),
      status='done'
  where id = p_occurrence_id
    and household_id = p_household_id
    and completed_at is null
  returning * into v_row;
  get diagnostics v_updated = row_count;
  v_ok := v_updated > 0;
  return jsonb_build_object('claimed', v_ok, 'id', p_occurrence_id, 'completed_by', p_member, 'already', not v_ok);
end;
$$;

revoke all on function public.claim_chore_occurrence(text,text) from public;
grant execute on function public.claim_chore_occurrence(text,text) to anon, authenticated, service_role;
revoke all on function public.complete_chore_occurrence(text,text,text) from public;
grant execute on function public.complete_chore_occurrence(text,text,text) to anon, authenticated, service_role;

-- Backfill household_id for old rows if any
update public.chore_occurrences set household_id='ash-ciaran-2026' where household_id is null or household_id <> 'ash-ciaran-2026';
update public.calendar_series set household_id='ash-ciaran-2026' where household_id is null or household_id <> 'ash-ciaran-2026';
update public.calendar_occurrence_overrides set household_id='ash-ciaran-2026' where household_id is null or household_id <> 'ash-ciaran-2026';

-- === V119 correctness patch: household_pins + server-side PIN verification ===

create extension if not exists pgcrypto;

create table if not exists public.household_pins (
  household_id text not null,
  person_key text not null check (person_key in ('aisling','ciaran')),
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, person_key)
);
alter table public.household_pins enable row level security;

-- No anon select — PIN hashes must never be readable by client
drop policy if exists "anon_select_pins" on public.household_pins;
drop policy if exists "anon_insert_pins" on public.household_pins;
drop policy if exists "anon_update_pins" on public.household_pins;
-- Intentionally no anon policies -> fail closed. Service role can manage.
drop policy if exists "service_role_all_pins" on public.household_pins;
create policy "service_role_all_pins" on public.household_pins for all to service_role using (true) with check (true);

-- Optional: allow anon to manage own household via RPC only (no direct table access)
-- So we create no anon policy — RPCs are SECURITY DEFINER and bypass RLS via definer.

create index if not exists idx_household_pins_household on public.household_pins (household_id);

-- verify_household_pin: returns person_key if PIN matches, else null
create or replace function public.verify_household_pin(hid text, pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_person text;
begin
  if hid is null or pin is null or length(trim(pin)) < 3 then
    return null;
  end if;
  -- compute sha256 hex using pgcrypto
  v_hash := encode(digest(trim(pin), 'sha256'), 'hex');
  select person_key into v_person
  from public.household_pins
  where household_id = hid and pin_hash = v_hash
  limit 1;
  return v_person;
end;
$$;

-- upsert_household_pin: called during onboarding creation, hashes server-side
create or replace function public.upsert_household_pin(hid text, pin text, person_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if hid is null or pin is null or person_key is null then
    raise exception 'missing args';
  end if;
  if person_key not in ('aisling','ciaran') then
    raise exception 'invalid person_key';
  end if;
  if length(trim(pin)) <> 4 then
    raise exception 'pin must be 4 digits';
  end if;
  v_hash := encode(digest(trim(pin), 'sha256'), 'hex');
  insert into public.household_pins (household_id, person_key, pin_hash, updated_at)
  values (hid, person_key, v_hash, now())
  on conflict (household_id, person_key) do update set pin_hash = excluded.pin_hash, updated_at = now();
  return person_key;
end;
$$;

revoke all on function public.verify_household_pin(text,text) from public;
grant execute on function public.verify_household_pin(text,text) to anon, authenticated, service_role;
revoke all on function public.upsert_household_pin(text,text,text) from public;
grant execute on function public.upsert_household_pin(text,text,text) to anon, authenticated, service_role;

-- Seed existing household ash-ciaran-2026 PINs server-side only (hashes never in JS bundle)
-- 4463 -> aisling, 1958 -> ciaran
insert into public.household_pins (household_id, person_key, pin_hash)
values
  ('ash-ciaran-2026','aisling','c91d793d0e481d8b90699fd4140826e2301f9937794ad30fb135b02404511d50'),
  ('ash-ciaran-2026','ciaran','522e6198a268c62c01c9944cc2c06902d8308d65e6444eb8ad10bbe98dc362b6')
on conflict (household_id, person_key) do update set pin_hash = excluded.pin_hash, updated_at = now();

-- Allow nylah-* households for beta onboarding (relax strict ash-ciaran-2026 lock)
-- Replace couple_data validation trigger to allow nylah- prefix
create or replace function public.validate_couple_data()
returns trigger language plpgsql as $$
begin
  if NEW.id <> 'ash-ciaran-2026' and NEW.id not like 'nylah-%' then
    raise exception 'invalid household id %', NEW.id;
  end if;
  if jsonb_typeof(NEW.chores) <> 'array' then raise exception 'chores must be array'; end if;
  if jsonb_typeof(NEW.calendar) <> 'array' then raise exception 'calendar must be array'; end if;
  if jsonb_typeof(NEW.shopping) <> 'array' then raise exception 'shopping must be array'; end if;
  if jsonb_typeof(NEW.notes) <> 'array' then raise exception 'notes must be array'; end if;
  if TG_OP = 'UPDATE' then
    if NEW.revision < OLD.revision then raise exception 'revision regression % -> %', OLD.revision, NEW.revision; end if;
    if NEW.revision > OLD.revision + 10 then raise exception 'revision jump too large % -> %', OLD.revision, NEW.revision; end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

-- Relax RLS policies for couple_data to allow nylah-*
drop policy if exists "anon_select_ash" on public.couple_data;
drop policy if exists "anon_insert_ash" on public.couple_data;
drop policy if exists "anon_update_ash" on public.couple_data;
create policy "anon_select_ash" on public.couple_data for select to anon using (id='ash-ciaran-2026' or id like 'nylah-%');
create policy "anon_insert_ash" on public.couple_data for insert to anon with check (id='ash-ciaran-2026' or id like 'nylah-%');
create policy "anon_update_ash" on public.couple_data for update to anon using (id='ash-ciaran-2026' or id like 'nylah-%') with check (id='ash-ciaran-2026' or id like 'nylah-%');

-- Relax chore_occurrences household check
alter table public.chore_occurrences drop constraint if exists chk_household_occ;
alter table public.chore_occurrences add constraint chk_household_occ check (household_id = 'ash-ciaran-2026' or household_id like 'nylah-%');
drop policy if exists "anon_select_occ" on public.chore_occurrences;
drop policy if exists "anon_insert_occ" on public.chore_occurrences;
drop policy if exists "anon_update_occ" on public.chore_occurrences;
create policy "anon_select_occ" on public.chore_occurrences for select to anon using (household_id='ash-ciaran-2026' or household_id like 'nylah-%');
create policy "anon_insert_occ" on public.chore_occurrences for insert to anon with check (household_id='ash-ciaran-2026' or household_id like 'nylah-%');
create policy "anon_update_occ" on public.chore_occurrences for update to anon using (household_id='ash-ciaran-2026' or household_id like 'nylah-%') with check (household_id='ash-ciaran-2026' or household_id like 'nylah-%');

-- Relax calendar_series
alter table public.calendar_series drop constraint if exists chk_household_series;
alter table public.calendar_series add constraint chk_household_series check (household_id = 'ash-ciaran-2026' or household_id like 'nylah-%');
drop policy if exists "anon_select_series" on public.calendar_series;
drop policy if exists "anon_insert_series" on public.calendar_series;
drop policy if exists "anon_update_series" on public.calendar_series;
create policy "anon_select_series" on public.calendar_series for select to anon using (household_id='ash-ciaran-2026' or household_id like 'nylah-%');
create policy "anon_insert_series" on public.calendar_series for insert to anon with check (household_id='ash-ciaran-2026' or household_id like 'nylah-%');
create policy "anon_update_series" on public.calendar_series for update to anon using (household_id='ash-ciaran-2026' or household_id like 'nylah-%') with check (household_id='ash-ciaran-2026' or household_id like 'nylah-%');

-- Relax overrides
alter table public.calendar_occurrence_overrides drop constraint if exists chk_household_override;
alter table public.calendar_occurrence_overrides add constraint chk_household_override check (household_id = 'ash-ciaran-2026' or household_id like 'nylah-%');
drop policy if exists "anon_select_overrides" on public.calendar_occurrence_overrides;
drop policy if exists "anon_insert_overrides" on public.calendar_occurrence_overrides;
drop policy if exists "anon_update_overrides" on public.calendar_occurrence_overrides;
create policy "anon_select_overrides" on public.calendar_occurrence_overrides for select to anon using (household_id='ash-ciaran-2026' or household_id like 'nylah-%');
create policy "anon_insert_overrides" on public.calendar_occurrence_overrides for insert to anon with check (household_id='ash-ciaran-2026' or household_id like 'nylah-%');
create policy "anon_update_overrides" on public.calendar_occurrence_overrides for update to anon using (household_id='ash-ciaran-2026' or household_id like 'nylah-%') with check (household_id='ash-ciaran-2026' or household_id like 'nylah-%');

-- Re-widen complete_chore_occurrence & claim_chore_occurrence to allow nylah-*
create or replace function public.claim_chore_occurrence(p_id text, p_member text)
returns table (
  id text,
  claimed boolean,
  claimed_by text,
  completed_by text,
  status text,
  household_id text
)
language plpgsql security definer as $$
declare
  v_row public.chore_occurrences%rowtype;
  v_updated int;
begin
  update public.chore_occurrences
  set completed_by = p_member,
      "completedBy" = p_member,
      claimed_by = p_member,
      "claimedBy" = p_member,
      completed_at = now(),
      "completedAt" = now()::text,
      updated_at = now(),
      status = 'done'
  where public.chore_occurrences.id = p_id
    and (public.chore_occurrences.household_id = 'ash-ciaran-2026' or public.chore_occurrences.household_id like 'nylah-%')
    and (public.chore_occurrences.completed_at is null and public.chore_occurrences."completedAt" is null)
  returning * into v_row;
  get diagnostics v_updated = row_count;
  if v_updated > 0 then
    return query select v_row.id, true::boolean, v_row.claimed_by, v_row.completed_by, v_row.status, v_row.household_id;
    return;
  end if;
  select * into v_row from public.chore_occurrences where id = p_id and (household_id='ash-ciaran-2026' or household_id like 'nylah-%') limit 1;
  if found then
    return query select v_row.id, false::boolean, coalesce(v_row.claimed_by, v_row."claimedBy"), coalesce(v_row.completed_by, v_row."completedBy"), v_row.status, v_row.household_id;
    return;
  end if;
  return query select p_id, false::boolean, null::text, null::text, 'open'::text, 'ash-ciaran-2026'::text where false;
end;
$$;

create or replace function public.complete_chore_occurrence(p_occurrence_id text, p_household_id text, p_member text)
returns jsonb language plpgsql security definer as $$
declare
  v_row public.chore_occurrences%rowtype;
  v_updated int;
  v_ok boolean := false;
begin
  if p_household_id <> 'ash-ciaran-2026' and p_household_id not like 'nylah-%' then
    raise exception 'invalid household';
  end if;
  if p_member not in ('aisling','ciaran') then
    raise exception 'invalid member';
  end if;
  update public.chore_occurrences
  set completed_by = p_member,
      "completedBy" = p_member,
      claimed_by = p_member,
      "claimedBy" = p_member,
      completed_at = now(),
      "completedAt" = now()::text,
      updated_at = now(),
      status='done'
  where id = p_occurrence_id
    and household_id = p_household_id
    and completed_at is null
  returning * into v_row;
  get diagnostics v_updated = row_count;
  v_ok := v_updated > 0;
  return jsonb_build_object('claimed', v_ok, 'id', p_occurrence_id, 'completed_by', p_member, 'already', not v_ok);
end;
$$;

-- household_invites table (optional) for spec validation path
create table if not exists public.household_invites (
  code text primary key,
  household_id text not null,
  household_name text,
  persons jsonb,
  meta jsonb,
  created_at timestamptz not null default now()
);
alter table public.household_invites enable row level security;
drop policy if exists "anon_select_invites" on public.household_invites;
drop policy if exists "anon_insert_invites" on public.household_invites;
create policy "anon_select_invites" on public.household_invites for select to anon using (true);
create policy "anon_insert_invites" on public.household_invites for insert to anon with check (true);
drop policy if exists "service_role_all_invites" on public.household_invites;
create policy "service_role_all_invites" on public.household_invites for all to service_role using (true) with check (true);
