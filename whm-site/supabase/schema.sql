-- ============================================================
--  WHM — Stage 1 schema (Supabase / Postgres)
--  Auth + pairing. This is the consolidated, already-applied schema for
--  project ref `mygaahtcnpfixdrwfptw`. Applied via two migrations:
--    whm_stage1_auth_pairing, whm_stage1_harden_functions
--
--  Model: one profile row per auth user. Pairing = both rows' `paired_with`
--  pointing at each other, linked atomically by claim_partner(). The client
--  never writes the table directly — signup is a trigger, pairing is an RPC.
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
