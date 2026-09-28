-- Dental Health Arlington board management tool
-- Run this entire file once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste this whole file -> Run).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles: one row per person, linked to Supabase's built-in auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'board_member' check (role in ('admin', 'staff', 'board_member')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Automatically create a profile row whenever someone signs up.
-- The very first person to ever sign up becomes an active admin;
-- everyone after that is created as an inactive board member until
-- an admin activates their account and sets their role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_first_user boolean;
begin
  select not exists (select 1 from public.profiles) into is_first_user;

  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email,
    case when is_first_user then 'admin' else 'board_member' end,
    is_first_user
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  meeting_date date not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Documents (the board packet items attached to a meeting)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  title text not null,
  file_path text not null,
  file_type text not null check (file_type in ('pdf', 'image', 'office')),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Document views (utilization / "came prepared" tracking)
-- ---------------------------------------------------------------------------
create table if not exists public.document_views (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count int not null default 1,
  unique (document_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Comments (pinned to a page + x/y position for PDFs and images;
-- page/x/y are null for a general, document-level comment)
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  page_number int,
  x numeric,
  y numeric,
  body text not null,
  parent_id uuid references public.comments (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Records (or updates) a view of a document by the current user in one
-- atomic call, so the app doesn't need to read-then-write from the client.
create or replace function public.record_document_view(p_document_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.document_views (document_id, user_id, first_viewed_at, last_viewed_at, view_count)
  values (p_document_id, auth.uid(), now(), now(), 1)
  on conflict (document_id, user_id)
  do update set last_viewed_at = now(), view_count = public.document_views.view_count + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.documents enable row level security;
alter table public.document_views enable row level security;
alter table public.comments enable row level security;

-- helper: is the current user an active admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

-- helper: is the current user active at all (admin, staff, or board member)?
create or replace function public.is_active_user()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

-- helper: is the current user active staff or admin (can publish content)?
create or replace function public.is_active_staff()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('admin', 'staff')
  );
$$;

-- profiles: everyone active can see everyone's name/role (small board, needed
-- for @-crediting comments and the utilization dashboard). Only admins can
-- change someone else's role/active flag; anyone can update their own name.
drop policy if exists "profiles are readable by active users" on public.profiles;
create policy "profiles are readable by active users"
  on public.profiles for select
  using (auth.uid() = id or public.is_active_user());

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin());

-- A user can update their own row (e.g. to change their display name), but
-- only an admin may change anyone's role or activation state. This trigger
-- silently reverts those two fields if a non-admin tries to change them,
-- rather than relying on a self-referencing RLS check (which can't reliably
-- compare old vs. new values within the same statement).
create or replace function public.protect_role_and_activation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_role_and_activation on public.profiles;
create trigger protect_role_and_activation
  before update on public.profiles
  for each row execute procedure public.protect_role_and_activation();

-- meetings: active users can read; only active staff/admin can create
drop policy if exists "meetings readable by active users" on public.meetings;
create policy "meetings readable by active users"
  on public.meetings for select
  using (public.is_active_user());

drop policy if exists "staff can create meetings" on public.meetings;
create policy "staff can create meetings"
  on public.meetings for insert
  with check (public.is_active_staff() and created_by = auth.uid());

drop policy if exists "staff can update meetings" on public.meetings;
create policy "staff can update meetings"
  on public.meetings for update
  using (public.is_active_staff());

drop policy if exists "staff can delete meetings" on public.meetings;
create policy "staff can delete meetings"
  on public.meetings for delete
  using (public.is_active_staff());

-- documents: active users can read; only active staff/admin can upload
drop policy if exists "documents readable by active users" on public.documents;
create policy "documents readable by active users"
  on public.documents for select
  using (public.is_active_user());

drop policy if exists "staff can upload documents" on public.documents;
create policy "staff can upload documents"
  on public.documents for insert
  with check (public.is_active_staff() and uploaded_by = auth.uid());

drop policy if exists "staff can delete documents" on public.documents;
create policy "staff can delete documents"
  on public.documents for delete
  using (public.is_active_staff());

-- document_views: everyone can log/see their own views; admins see all
drop policy if exists "users manage own views" on public.document_views;
create policy "users manage own views"
  on public.document_views for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- comments: active users can read all comments and write their own
drop policy if exists "comments readable by active users" on public.comments;
create policy "comments readable by active users"
  on public.comments for select
  using (public.is_active_user());

drop policy if exists "active users can comment" on public.comments;
create policy "active users can comment"
  on public.comments for insert
  with check (public.is_active_user() and user_id = auth.uid());

drop policy if exists "users can edit own comments" on public.comments;
create policy "users can edit own comments"
  on public.comments for update
  using (user_id = auth.uid());

drop policy if exists "users can delete own comments" on public.comments;
create policy "users can delete own comments"
  on public.comments for delete
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage bucket for uploaded packet files
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('board-documents', 'board-documents', false)
on conflict (id) do nothing;

drop policy if exists "active users can read board documents" on storage.objects;
create policy "active users can read board documents"
  on storage.objects for select
  using (bucket_id = 'board-documents' and public.is_active_user());

drop policy if exists "staff can upload board documents" on storage.objects;
create policy "staff can upload board documents"
  on storage.objects for insert
  with check (bucket_id = 'board-documents' and public.is_active_staff());

drop policy if exists "staff can delete board documents" on storage.objects;
create policy "staff can delete board documents"
  on storage.objects for delete
  using (bucket_id = 'board-documents' and public.is_active_staff());
