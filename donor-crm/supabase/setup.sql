-- Dental Health Arlington Donor CRM — database setup
-- Run this entire file once in the Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste this whole file -> Run).
-- It is safe to run again: every statement is written to be re-runnable.

-- ---------------------------------------------------------------------------
-- Staff accounts
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- The first person to sign up becomes an active admin. Everyone after that
-- starts inactive until an admin activates them on the Settings page.
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
    case when is_first_user then 'admin' else 'staff' end,
    is_first_user
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Donors (contacts) and their gifts
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null default '',
  email text,
  alt_emails text[] not null default '{}',
  phone text,
  alt_phones text[] not null default '{}',
  address text,
  city text,
  state text,
  zip text,
  country text,
  notes text,
  do_not_email boolean not null default false,
  is_anonymous boolean not null default false,
  -- date of the gift whose contact details are currently shown, so an older
  -- import never overwrites a newer address or email
  info_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tracking_no text unique,
  gift_date date not null,
  gift_time time,
  amount numeric(12, 2) not null default 0,
  net_amount numeric(12, 2),
  event_name text not null default 'General donation',
  payment_method text,
  fundraiser_page text,
  recognition_name text,
  dedication text,
  source text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists donations_contact_idx on public.donations (contact_id);
create index if not exists donations_date_idx on public.donations (gift_date);

create table if not exists public.possible_duplicates (
  id uuid primary key default gen_random_uuid(),
  contact_a uuid not null references public.contacts (id) on delete cascade,
  contact_b uuid not null references public.contacts (id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'dismissed')),
  created_at timestamptz not null default now(),
  check (contact_a <> contact_b)
);
create unique index if not exists possible_duplicates_pair_idx
  on public.possible_duplicates (least(contact_a, contact_b), greatest(contact_a, contact_b));

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  template_name text,
  sent_by uuid references public.profiles (id) on delete set null,
  sent_by_name text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists email_log_contact_idx on public.email_log (contact_id);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  sender_name text not null default 'Dental Health Arlington',
  sender_email text not null default 'info@dentalhealtharlington.org',
  reply_to text,
  email_footer text not null default 'Dental Health Arlington · Arlington, TX · Reply to this email if you would prefer not to receive future messages.'
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- API keys live in a schema the website can never read. Only the email
-- sending function (running on Supabase's servers) can fetch them.
create schema if not exists private;
create table if not exists private.secrets (
  name text primary key,
  value text not null
);
revoke all on schema private from public, anon, authenticated;

create or replace function public.get_secret(secret_name text)
returns text
language sql
stable
security definer set search_path = private
as $$
  -- answers only the email function running on Supabase's servers
  select value from private.secrets
  where name = secret_name
    and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;
revoke all on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

-- ---------------------------------------------------------------------------
-- Donor summary (totals, first/last gift, events) used by every list screen
-- ---------------------------------------------------------------------------
create or replace view public.contact_summary
with (security_invoker = true) as
select
  c.*,
  coalesce(s.total_given, 0) as total_given,
  coalesce(s.gift_count, 0) as gift_count,
  s.first_gift_date,
  s.last_gift_date,
  s.last_gift_amount,
  s.last_gift_event,
  coalesce(s.events, '') as events,
  coalesce(s.gift_years, '{}') as gift_years,
  e.last_emailed_at
from public.contacts c
left join lateral (
  select
    sum(d.amount) as total_given,
    count(*) as gift_count,
    min(d.gift_date) as first_gift_date,
    max(d.gift_date) as last_gift_date,
    (array_agg(d.amount order by d.gift_date desc, d.gift_time desc nulls last))[1] as last_gift_amount,
    (array_agg(d.event_name order by d.gift_date desc, d.gift_time desc nulls last))[1] as last_gift_event,
    string_agg(distinct d.event_name, '; ') as events,
    array_agg(distinct extract(year from d.gift_date)::int) as gift_years
  from public.donations d
  where d.contact_id = c.id
) s on true
left join lateral (
  select max(l.sent_at) as last_emailed_at
  from public.email_log l
  where l.contact_id = c.id and l.status = 'sent'
) e on true;

-- ---------------------------------------------------------------------------
-- Matching helpers used for de-duplication
-- ---------------------------------------------------------------------------
create or replace function public.norm_first(t text)
returns text
language sql
immutable
as $$
  with base as (
    select split_part(
      trim(regexp_replace(lower(coalesce(t, '')), '[^a-z ]', '', 'g')),
      ' ', 1
    ) as n
  )
  select case n
    when 'sally' then 'sarah'
    when 'deb' then 'deborah'
    when 'debbie' then 'deborah'
    when 'steve' then 'steven'
    when 'stephen' then 'steven'
    when 'jim' then 'james'
    when 'jimmy' then 'james'
    when 'bob' then 'robert'
    when 'rob' then 'robert'
    when 'bill' then 'william'
    when 'will' then 'william'
    when 'tom' then 'thomas'
    when 'mike' then 'michael'
    when 'margi' then 'margaret'
    when 'margie' then 'margaret'
    when 'peggy' then 'margaret'
    when 'kathy' then 'katherine'
    when 'cathy' then 'catherine'
    when 'chris' then 'christopher'
    when 'dan' then 'daniel'
    when 'hank' then 'henry'
    when 'barb' then 'barbara'
    when 'liz' then 'elizabeth'
    when 'beth' then 'elizabeth'
    else n
  end
  from base;
$$;

create or replace function public.first_compat(a text, b text)
returns boolean
language sql
immutable
as $$
  select case
    when public.norm_first(a) = '' or public.norm_first(b) = '' then false
    when public.norm_first(a) = public.norm_first(b) then true
    when least(length(public.norm_first(a)), length(public.norm_first(b))) >= 3
      and (public.norm_first(a) like public.norm_first(b) || '%'
        or public.norm_first(b) like public.norm_first(a) || '%') then true
    -- one-letter typo in a longer name, e.g. Genesid / Genesis
    when length(public.norm_first(a)) >= 5
      and length(public.norm_first(a)) = length(public.norm_first(b))
      and left(public.norm_first(a), length(public.norm_first(a)) - 1)
        = left(public.norm_first(b), length(public.norm_first(b)) - 1) then true
    else false
  end;
$$;

create or replace function public.norm_last(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(lower(coalesce(t, '')), '\m(jr|sr|ii|iii|iv)\M\.?', '', 'g'),
    '[^a-z]', '', 'g'
  );
$$;

create or replace function public.last_compat(a text, b text)
returns boolean
language sql
immutable
as $$
  select case
    when public.norm_last(a) = '' or public.norm_last(b) = '' then false
    when public.norm_last(a) = public.norm_last(b) then true
    when least(length(public.norm_last(a)), length(public.norm_last(b))) >= 4
      and (position(public.norm_last(a) in public.norm_last(b)) > 0
        or position(public.norm_last(b) in public.norm_last(a)) > 0) then true
    else false
  end;
$$;

create or replace function public.phone_digits(t text)
returns text
language sql
immutable
as $$
  select case
    when length(d) = 11 and left(d, 1) = '1' then right(d, 10)
    when length(d) = 10 then d
    else null
  end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) x;
$$;

-- "1219 Cozby St. E" -> "1219 cozby"; "P.O. Box 1594" -> "pobox 1594"
create or replace function public.addr_key(t text)
returns text
language sql
immutable
as $$
  select case when k ~ '\d' then k else null end
  from (
    select array_to_string((regexp_split_to_array(
      trim(regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(t, '')), 'p\s*\.?\s*o\s*\.?\s*box', 'pobox ', 'g'),
          '[^a-z0-9 ]', ' ', 'g'),
        '\s+', ' ', 'g')),
      ' '))[1:2], ' ') as k
  ) x;
$$;

create or replace function public.contact_has_email(c public.contacts, e text)
returns boolean
language sql
immutable
as $$
  select e is not null and e <> '' and (
    lower(c.email) = lower(e)
    or exists (select 1 from unnest(c.alt_emails) x where lower(x) = lower(e))
  );
$$;

create or replace function public.contact_has_phone(c public.contacts, p text)
returns boolean
language sql
immutable
as $$
  select public.phone_digits(p) is not null and (
    public.phone_digits(c.phone) = public.phone_digits(p)
    or exists (select 1 from unnest(c.alt_phones) x where public.phone_digits(x) = public.phone_digits(p))
  );
$$;

create or replace function public.flag_duplicate(a uuid, b uuid, why text)
returns void
language sql
as $$
  insert into public.possible_duplicates (contact_a, contact_b, reason)
  values (a, b, why)
  on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Import: takes a list of gift rows (already read from a spreadsheet by the
-- website), matches each to an existing donor or creates a new one, and
-- skips any gift that was already imported (same tracking number).
-- ---------------------------------------------------------------------------
create or replace function public.import_donations(rows jsonb, source_label text default 'Spreadsheet import')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_first text; v_last text; v_email text; v_phone text; v_addr text;
  v_date date; v_time time; v_tracking text; v_anon boolean;
  v_contact public.contacts;
  v_match uuid;
  v_other record;
  added int := 0; skipped int := 0; new_contacts int := 0; matched int := 0; flagged int := 0;
  before_flags int;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  select count(*) into before_flags from public.possible_duplicates;

  for r in
    select value from jsonb_array_elements(rows)
    order by (value ->> 'gift_date')::date, coalesce(value ->> 'gift_time', '00:00')
  loop
    v_tracking := nullif(trim(r ->> 'tracking_no'), '');
    if v_tracking is not null and exists (select 1 from public.donations where tracking_no = v_tracking) then
      skipped := skipped + 1;
      continue;
    end if;

    v_first := coalesce(trim(r ->> 'first_name'), '');
    v_last := coalesce(trim(r ->> 'last_name'), '');
    v_email := nullif(lower(trim(r ->> 'email')), '');
    v_phone := nullif(trim(r ->> 'phone'), '');
    v_addr := nullif(trim(r ->> 'address'), '');
    v_date := (r ->> 'gift_date')::date;
    v_time := nullif(r ->> 'gift_time', '')::time;
    v_anon := coalesce((r ->> 'anonymous')::boolean, false);
    v_match := null;

    if v_anon then
      select id into v_match from public.contacts where is_anonymous limit 1;
      if v_match is null then
        insert into public.contacts (first_name, last_name, is_anonymous, do_not_email, notes)
        values ('Anonymous', 'Donors', true, true,
                'All gifts made anonymously are grouped here. The donation platform does not share these donors'' names or contact details.')
        returning id into v_match;
        new_contacts := new_contacts + 1;
      else
        matched := matched + 1;
      end if;
    else
      -- 1) same email and a compatible first name
      select c.id into v_match
      from public.contacts c
      where not c.is_anonymous
        and public.contact_has_email(c, v_email)
        and public.first_compat(c.first_name, v_first)
      order by c.created_at
      limit 1;

      -- 2) same name and the same phone or street address
      if v_match is null then
        select c.id into v_match
        from public.contacts c
        where not c.is_anonymous
          and public.first_compat(c.first_name, v_first)
          and public.last_compat(c.last_name, v_last)
          and (public.contact_has_phone(c, v_phone)
               or (public.addr_key(v_addr) is not null and public.addr_key(c.address) = public.addr_key(v_addr)))
        order by c.created_at
        limit 1;
      end if;

      if v_match is null then
        insert into public.contacts
          (first_name, last_name, email, phone, address, city, state, zip, country, info_date)
        values
          (v_first, v_last, v_email, v_phone, v_addr,
           nullif(trim(r ->> 'city'), ''), nullif(trim(r ->> 'state'), ''),
           nullif(trim(r ->> 'zip'), ''), nullif(trim(r ->> 'country'), ''), v_date)
        returning id into v_match;
        new_contacts := new_contacts + 1;

        -- send uncertain cases to the "Possible duplicates" screen
        for v_other in
          select c.id,
            case
              when public.contact_has_email(c, v_email) then 'Same email address, different first name'
              when public.contact_has_phone(c, v_phone) then 'Same phone number, different name'
              else 'Same name, but no matching phone or address'
            end as why
          from public.contacts c
          where c.id <> v_match and not c.is_anonymous
            and (
              public.contact_has_email(c, v_email)
              or (public.contact_has_phone(c, v_phone) and public.last_compat(c.last_name, v_last))
              or (public.first_compat(c.first_name, v_first) and public.last_compat(c.last_name, v_last))
            )
        loop
          perform public.flag_duplicate(v_other.id, v_match, v_other.why);
        end loop;
      else
        matched := matched + 1;
        select * into v_contact from public.contacts where id = v_match;

        if v_contact.info_date is null or v_date >= v_contact.info_date then
          -- newer gift: its details become the primary ones
          update public.contacts set
            first_name = case when v_first <> '' then v_first else first_name end,
            -- same surname spelled two ways (Odom-Wesley / OdomWesley): keep the fuller one
            last_name = case
              when v_last = '' then last_name
              when public.norm_last(v_last) = public.norm_last(last_name)
                and length(last_name) > length(v_last) then last_name
              else v_last end,
            email = coalesce(v_email, email),
            alt_emails = case
              when v_email is not null and email is not null and lower(email) <> v_email
                and not (email = any(alt_emails)) then array_append(alt_emails, email)
              else alt_emails end,
            phone = case when public.phone_digits(v_phone) is not null then v_phone else coalesce(phone, v_phone) end,
            alt_phones = case
              when public.phone_digits(v_phone) is not null and phone is not null
                and public.phone_digits(phone) is distinct from public.phone_digits(v_phone)
                and not (phone = any(alt_phones)) then array_append(alt_phones, phone)
              else alt_phones end,
            address = coalesce(v_addr, address),
            city = case when v_addr is not null then nullif(trim(r ->> 'city'), '') else city end,
            state = case when v_addr is not null then nullif(trim(r ->> 'state'), '') else state end,
            zip = case when v_addr is not null then nullif(trim(r ->> 'zip'), '') else zip end,
            country = case when v_addr is not null then nullif(trim(r ->> 'country'), '') else country end,
            info_date = v_date,
            updated_at = now()
          where id = v_match;
          -- the old email may now equal the new primary; tidy alternates
          update public.contacts
          set alt_emails = array(select distinct x from unnest(alt_emails) x where lower(x) <> lower(coalesce(email, ''))),
              alt_phones = array(select distinct x from unnest(alt_phones) x
                                 where public.phone_digits(x) is distinct from public.phone_digits(phone))
          where id = v_match;
        else
          -- older gift: keep current details, remember any other email/phone
          update public.contacts set
            email = coalesce(email, v_email),
            alt_emails = case
              when v_email is not null and email is not null and not public.contact_has_email(contacts, v_email)
                then array_append(alt_emails, v_email)
              else alt_emails end,
            phone = coalesce(phone, v_phone),
            alt_phones = case
              when public.phone_digits(v_phone) is not null and phone is not null
                and not public.contact_has_phone(contacts, v_phone) then array_append(alt_phones, v_phone)
              else alt_phones end,
            address = coalesce(address, v_addr),
            updated_at = now()
          where id = v_match;
        end if;
      end if;
    end if;

    insert into public.donations
      (contact_id, tracking_no, gift_date, gift_time, amount, net_amount, event_name, payment_method,
       fundraiser_page, recognition_name, dedication, source, notes)
    values
      (v_match, v_tracking, v_date, v_time,
       coalesce(nullif(r ->> 'amount', '')::numeric, 0),
       nullif(r ->> 'net_amount', '')::numeric,
       coalesce(nullif(trim(r ->> 'event_name'), ''), 'General donation'),
       nullif(trim(r ->> 'payment_method'), ''),
       nullif(trim(r ->> 'fundraiser_page'), ''),
       nullif(trim(r ->> 'recognition_name'), ''),
       nullif(trim(r ->> 'dedication'), ''),
       source_label,
       nullif(trim(r ->> 'notes'), ''));
    added := added + 1;
  end loop;

  select count(*) - before_flags into flagged from public.possible_duplicates;

  return jsonb_build_object(
    'gifts_added', added,
    'gifts_skipped_already_imported', skipped,
    'new_donors', new_contacts,
    'gifts_matched_to_existing_donors', matched,
    'possible_duplicates_flagged', flagged
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Merge two donor records into one (used by the Possible Duplicates screen)
-- ---------------------------------------------------------------------------
create or replace function public.merge_contacts(keep_id uuid, remove_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  k public.contacts;
  d public.contacts;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if keep_id = remove_id then
    return;
  end if;
  select * into k from public.contacts where id = keep_id;
  select * into d from public.contacts where id = remove_id;
  if k.id is null or d.id is null then
    raise exception 'Donor not found';
  end if;

  update public.donations set contact_id = keep_id where contact_id = remove_id;
  update public.email_log set contact_id = keep_id where contact_id = remove_id;

  update public.contacts set
    email = coalesce(k.email, d.email),
    alt_emails = array(
      select distinct x from unnest(k.alt_emails || d.alt_emails || array[d.email]) x
      where x is not null and lower(x) <> lower(coalesce(coalesce(k.email, d.email), ''))
    ),
    phone = coalesce(k.phone, d.phone),
    alt_phones = array(
      select distinct x from unnest(k.alt_phones || d.alt_phones || array[d.phone]) x
      where x is not null
        and public.phone_digits(x) is distinct from public.phone_digits(coalesce(k.phone, d.phone))
    ),
    address = coalesce(k.address, d.address),
    city = case when k.address is null then d.city else k.city end,
    state = case when k.address is null then d.state else k.state end,
    zip = case when k.address is null then d.zip else k.zip end,
    country = case when k.address is null then d.country else k.country end,
    notes = nullif(concat_ws(E'\n', k.notes, d.notes), ''),
    do_not_email = k.do_not_email or d.do_not_email,
    info_date = greatest(k.info_date, d.info_date),
    updated_at = now()
  where id = keep_id;

  -- carry over any other open duplicate pairs, then drop the removed record
  insert into public.possible_duplicates (contact_a, contact_b, reason, status)
  select case when p.contact_a = remove_id then keep_id else p.contact_a end,
         case when p.contact_b = remove_id then keep_id else p.contact_b end,
         p.reason, p.status
  from public.possible_duplicates p
  where (p.contact_a = remove_id or p.contact_b = remove_id)
    and keep_id not in (p.contact_a, p.contact_b)
  on conflict do nothing;

  delete from public.contacts where id = remove_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Security: only signed-in, activated staff can see or change anything
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.donations enable row level security;
alter table public.possible_duplicates enable row level security;
alter table public.email_log enable row level security;
alter table public.email_templates enable row level security;
alter table public.settings enable row level security;

drop policy if exists "profiles: read own or staff" on public.profiles;
create policy "profiles: read own or staff" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff());
drop policy if exists "profiles: admin updates" on public.profiles;
create policy "profiles: admin updates" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "profiles: admin deletes" on public.profiles;
create policy "profiles: admin deletes" on public.profiles
  for delete to authenticated using (public.is_admin() and id <> auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'donations', 'possible_duplicates', 'email_templates'] loop
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t);
  end loop;
end $$;

drop policy if exists "staff read email log" on public.email_log;
create policy "staff read email log" on public.email_log
  for select to authenticated using (public.is_staff());

drop policy if exists "staff read settings" on public.settings;
create policy "staff read settings" on public.settings
  for select to authenticated using (public.is_staff());
drop policy if exists "admin edits settings" on public.settings;
create policy "admin edits settings" on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_staff(), public.is_admin(),
  public.import_donations(jsonb, text), public.merge_contacts(uuid, uuid),
  public.norm_first(text), public.first_compat(text, text), public.norm_last(text),
  public.last_compat(text, text), public.phone_digits(text), public.addr_key(text),
  public.contact_has_email(public.contacts, text), public.contact_has_phone(public.contacts, text),
  public.flag_duplicate(uuid, uuid, text)
  to authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.get_secret(text) to service_role;

-- ---------------------------------------------------------------------------
-- Starter email templates (edit them any time on the Email page)
-- ---------------------------------------------------------------------------
insert into public.email_templates (name, subject, body) values
(
  'Thank you for your gift',
  'Thank you, {{first_name}}!',
  E'Dear {{first_name}},\n\nThank you for your generous gift of {{last_gift_amount}} during {{last_gift_event}}. Your support helps Dental Health Arlington provide dental care to children and families in our community who would otherwise go without.\n\nWe are grateful to have you as part of the DHA family.\n\nWith appreciation,\nThe Dental Health Arlington Team'
),
(
  'North Texas Giving Day renewal',
  'Will you join us again this North Texas Giving Day?',
  E'Dear {{first_name}},\n\nYour past support of Dental Health Arlington, most recently {{last_gift_amount}} during {{last_gift_event}}, has made a real difference for local families who need dental care.\n\nNorth Texas Giving Day is coming up, and we would be honored to count on you again. Every gift, at any amount, helps us keep smiles healthy across Arlington.\n\nThank you for considering a renewed gift.\n\nWarmly,\nThe Dental Health Arlington Team'
),
(
  'Year-end thank you',
  'A year of healthier smiles, thanks to you',
  E'Dear {{first_name}},\n\nAs the year comes to a close, we want to thank you for standing with Dental Health Arlington. Since your first gift in {{first_gift_year}}, you have contributed {{total_given}} to help children and families get the dental care they need.\n\nWe could not do this work without friends like you.\n\nWith gratitude,\nThe Dental Health Arlington Team'
)
on conflict (name) do nothing;
