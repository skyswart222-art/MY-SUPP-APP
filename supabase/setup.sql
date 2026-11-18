-- My Supp App: database setup.
-- Paste all of this into Supabase → SQL Editor → New query → Run.
-- It's safe to run again: every step checks what's already there.

-- ---------- Profiles: one per account, holding the display name and photo ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (display_name ~ '^[A-Za-z0-9_.]{3,20}$'),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Names are unique regardless of capitals ("Sky" and "sky" clash).
create unique index if not exists profiles_display_name_unique on public.profiles (lower(display_name));

-- ---------- Per-user settings (theme and other preferences) as one JSON blob ----------
create table if not exists public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Everything the planner saves: supplements, meals, workouts, cycle, progress, skincare ----------
-- One row per saved item. "path" is the list it belongs to (for example "supplements/items"),
-- "doc_id" is the item's own id, and "data" is the item itself.
create table if not exists public.user_docs (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path       text not null check (length(path) between 1 and 200),
  doc_id     text not null check (length(doc_id) between 1 and 200),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, path, doc_id)
);
create index if not exists user_docs_path on public.user_docs (user_id, path);

-- Users can't change their own id or created date; updated_at is stamped automatically.
create or replace function public.guard_profile_update() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.created_at <> old.created_at then raise exception 'Not allowed.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update before update on public.profiles for each row execute function public.guard_profile_update();

-- Saved items: the owner can't be swapped, and updated_at is stamped automatically.
create or replace function public.guard_doc_update() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'Not allowed.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists user_docs_guard on public.user_docs;
create trigger user_docs_guard before insert or update on public.user_docs for each row execute function public.guard_doc_update();
drop trigger if exists user_settings_guard on public.user_settings;
create trigger user_settings_guard before insert or update on public.user_settings for each row execute function public.guard_doc_update();

-- New account → profile created with the display name chosen at sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Lets the sign-up form check a name before the account exists (callable while logged out).
create or replace function public.name_available(name text) returns boolean
language sql stable security definer set search_path = public as $$
  select name ~ '^[A-Za-z0-9_.]{3,20}$'
     and not exists (select 1 from public.profiles p where lower(p.display_name) = lower(name) and p.id is distinct from auth.uid());
$$;
grant execute on function public.name_available(text) to anon, authenticated;

-- ---------- Row Level Security: each person only ever sees and changes their own rows ----------
alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_docs     enable row level security;

drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read own docs" on public.user_docs;
create policy "read own docs"   on public.user_docs for select to authenticated using (user_id = auth.uid());
drop policy if exists "add own docs" on public.user_docs;
create policy "add own docs"    on public.user_docs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "change own docs" on public.user_docs;
create policy "change own docs" on public.user_docs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- The planner lets people delete things (a supplement, a meal, a blood test), so deleting is allowed for your own rows.
drop policy if exists "delete own docs" on public.user_docs;
create policy "delete own docs" on public.user_docs for delete to authenticated using (user_id = auth.uid());

-- ---------- Profile photos: public "avatars" bucket, each user writes only in their own folder ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar read own folder" on storage.objects;
create policy "avatar read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar replace own folder" on storage.objects;
create policy "avatar replace own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Private photos (supplement labels, blood test pages, skincare products) ----------
-- Private bucket: nobody can open these without being logged in as the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/webm', 'audio/ogg', 'audio/mpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "uploads read own folder" on storage.objects;
create policy "uploads read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "uploads add own folder" on storage.objects;
create policy "uploads add own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "uploads delete own folder" on storage.objects;
create policy "uploads delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- AI photo reading: a simple log so one account can't run up the bill ----------
-- The server adds a row each time someone uses a "read this photo" or "review" button,
-- and refuses once an account passes the hourly limit. Rows can't be edited or deleted by users.
create table if not exists public.ai_usage (
  id      bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists ai_usage_user_at on public.ai_usage (user_id, at desc);
alter table public.ai_usage enable row level security;
drop policy if exists "read own ai usage" on public.ai_usage;
create policy "read own ai usage" on public.ai_usage for select to authenticated using (user_id = auth.uid());
drop policy if exists "add own ai usage" on public.ai_usage;
create policy "add own ai usage" on public.ai_usage for insert to authenticated with check (user_id = auth.uid());
