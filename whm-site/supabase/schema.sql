-- ============================================================
--  WHM — schema (Supabase / Postgres). Applied to project `mygaahtcnpfixdrwfptw`.
--
--  Stage 1: auth + pairing.
--    Migrations: whm_stage1_auth_pairing, whm_stage1_harden_functions
--    Model: one profile row per auth user. Pairing = both rows' `paired_with`
--    pointing at each other, linked atomically by claim_partner(). The client
--    never writes the users table directly — signup is a trigger, pairing is an RPC.
--
--  Stage 2: cycle tracker + to-dos.
--    Migration: whm_stage2_cycle_todos
--    Model: cycle_settings / period_starts / todos, all owned by HER, readable
--    by her partner via the same private.my_partner() helper Stage 1 uses.
--    Writes gated to role='her' by private.my_role() so a partner account can't
--    accidentally seed its own rows even if the client tried.
-- ============================================================

-- ---- profile table ----
create table public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text not null,
  role         text not null check (role in ('her','partner')),
  paired_with  uuid references public.users(id) on delete set null,
  pairing_code text not null unique,
  created_at   timestamptz not null default now()
);

alter table public.users enable row level security;

-- ---- internal helpers live in a non-API schema ----
create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- unique 6-char pairing code (alphabet excludes 0 O 1 I L)
create or replace function private.gen_pairing_code()
returns text language plpgsql set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text; i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.users where pairing_code = code);
  end loop;
  return code;
end; $$;
revoke all on function private.gen_pairing_code() from public;

-- my partner's id, read without tripping RLS recursion
create or replace function private.my_partner()
returns uuid language sql security definer set search_path = public stable as $$
  select paired_with from public.users where id = auth.uid()
$$;
revoke all on function private.my_partner() from public;
grant execute on function private.my_partner() to anon, authenticated;

-- ---- create profile row on signup, from auth metadata ----
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, display_name, role, pairing_code)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', 'friend'),
    coalesce(new.raw_user_meta_data->>'role', 'partner'),
    private.gen_pairing_code()
  );
  return new;
end; $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- RLS: read own row; read partner's once linked. No direct writes. ----
create policy "read own row" on public.users
  for select using (auth.uid() = id);

create policy "read partner row" on public.users
  for select using (paired_with = auth.uid() or id = private.my_partner());

-- ---- atomic pairing claim (the only write path the client triggers) ----
create or replace function public.claim_partner(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;

  select id into target from public.users
    where pairing_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));

  if target is null then raise exception 'NO_SUCH_CODE'; end if;
  if target = me then raise exception 'OWN_CODE'; end if;

  update public.users set paired_with = target where id = me and paired_with is null;
  if not found then raise exception 'ALREADY_PAIRED'; end if;

  update public.users set paired_with = me where id = target and paired_with is null;
  if not found then raise exception 'PARTNER_TAKEN'; end if;

  return target;
end; $$;
revoke all on function public.claim_partner(text) from public, anon;
grant execute on function public.claim_partner(text) to authenticated;
-- NOTE: the security advisor flags claim_partner as "authenticated can execute"
-- — that's intentional; it's the guarded pairing RPC, safe by its internal checks.

-- ---- realtime: broadcast row changes so both partners flip to "paired" live ----
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
  ) then
    alter publication supabase_realtime add table public.users;
  end if;
end $$;

-- ============================================================
--  Stage 2 — cycle tracker + to-dos
-- ============================================================

-- my role, read without RLS recursion. Used by write policies below to gate
-- inserts/updates to role='her' (the app-level product rule).
create or replace function private.my_role()
returns text language sql security definer set search_path = public stable as $$
  select role from public.users where id = auth.uid()
$$;
revoke all on function private.my_role() from public;
grant execute on function private.my_role() to authenticated;

-- ---- cycle_settings: one row per her-user, tunable defaults ----
create table public.cycle_settings (
  user_id       uuid primary key references public.users(id) on delete cascade,
  cycle_length  int  not null default 28 check (cycle_length between 20 and 45),
  period_length int  not null default 5  check (period_length between 2 and 10),
  updated_at    timestamptz not null default now()
);
alter table public.cycle_settings enable row level security;

create policy "cs read own"     on public.cycle_settings for select
  using (auth.uid() = user_id);
create policy "cs read partner" on public.cycle_settings for select
  using (user_id = private.my_partner());
create policy "cs write own"    on public.cycle_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and private.my_role() = 'her');

-- ---- period_starts: log of period start dates (one per date per user) ----
create table public.period_starts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  start_date date not null,
  notes      text,
  created_at timestamptz not null default now(),
  unique (user_id, start_date)
);
alter table public.period_starts enable row level security;

create policy "ps read own"     on public.period_starts for select
  using (auth.uid() = user_id);
create policy "ps read partner" on public.period_starts for select
  using (user_id = private.my_partner());
create policy "ps write own"    on public.period_starts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and private.my_role() = 'her');

create index period_starts_user_date_idx on public.period_starts (user_id, start_date desc);

-- ---- todos: her's list, partner-readable ----
create table public.todos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null check (char_length(trim(title)) between 1 and 240),
  done       boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.todos enable row level security;

create policy "td read own"     on public.todos for select
  using (auth.uid() = user_id);
create policy "td read partner" on public.todos for select
  using (user_id = private.my_partner());
create policy "td write own"    on public.todos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and private.my_role() = 'her');

create index todos_user_created_idx on public.todos (user_id, created_at desc);

-- ---- realtime for Stage 2 tables ----
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='cycle_settings') then
    alter publication supabase_realtime add table public.cycle_settings;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='period_starts') then
    alter publication supabase_realtime add table public.period_starts;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='todos') then
    alter publication supabase_realtime add table public.todos;
  end if;
end $$;
