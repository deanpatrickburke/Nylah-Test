-- push_subscriptions for Nylah OS
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id text default 'ash-ciaran-2026',
  user_key text not null check (user_key in ('aisling','ciaran')),
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists allow_all on push_subscriptions;
create policy allow_all on push_subscriptions for all using (true) with check (true);
grant all on push_subscriptions to anon, authenticated, service_role;
