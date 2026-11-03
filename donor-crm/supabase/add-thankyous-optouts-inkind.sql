-- ---------------------------------------------------------------------------
-- November 2026 update
--   1. Thank-you tracking on every gift (date, how, who)
--   2. "Do not call" and "Do not mail", with a history of every opt-out and
--      opt-back-in, plus call notes for reaching out to people who opted out
--   3. In-kind and auction items (donor, market value, sold for, buyer)
--   4. Thank-you letters and buyer receipts, kept as a permanent record and
--      downloadable as PDFs from a private link
--   5. Spreadsheet imports for volunteers, auction items and people lists
--
-- Safe to run more than once. It only adds things; no donor, gift or email
-- record is changed except that each existing in-kind gift gets a matching
-- item on the new In-Kind tab.
-- ---------------------------------------------------------------------------

-- 1. Thank-you tracking -------------------------------------------------------
alter table public.donations add column if not exists thanked_on date;
alter table public.donations add column if not exists thanked_method text;
alter table public.donations add column if not exists thanked_by_name text;
alter table public.donations add column if not exists thanked_note text;
alter table public.donations add column if not exists thanked_recorded_at timestamptz;
create index if not exists donations_unthanked_idx on public.donations (gift_date) where thanked_on is null;

-- 2. Opt-outs, opt-out history and call notes ---------------------------------
alter table public.contacts add column if not exists do_not_call boolean not null default false;
alter table public.contacts add column if not exists do_not_mail boolean not null default false;

create table if not exists public.contact_preference_log (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  channel text not null check (channel in ('email', 'call', 'mail')),
  action text not null check (action in ('opt_out', 'opt_in')),
  method text,
  note text,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists contact_preference_log_contact_idx on public.contact_preference_log (contact_id, created_at desc);

create table if not exists public.outreach_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  note text not null,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists outreach_notes_contact_idx on public.outreach_notes (contact_id, created_at desc);

-- 3. In-kind and auction items ------------------------------------------------
create table if not exists public.inkind_items (
  id uuid primary key default gen_random_uuid(),
  event_name text not null default 'In-kind donation',
  item_number text,
  title text not null,
  description text,
  sale_type text check (sale_type is null or sale_type in ('Silent auction', 'Live auction', 'Raffle', 'Not auctioned')),
  is_service boolean not null default false,
  donor_contact_id uuid references public.contacts (id) on delete set null,
  fair_market_value numeric(12, 2) check (fair_market_value is null or fair_market_value >= 0),
  received_date date,
  buyer_contact_id uuid references public.contacts (id) on delete set null,
  bidder_number text,
  sold_amount numeric(12, 2) check (sold_amount is null or sold_amount >= 0),
  sold_date date,
  notes text,
  -- the matching in-kind gift on the donor's record (amount = market value)
  donation_id uuid unique references public.donations (id) on delete set null,
  -- lets the same spreadsheet be imported again without making duplicates
  import_key text unique,
  source text,
  donor_letter_sent_at timestamptz,
  buyer_receipt_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inkind_items_event_idx on public.inkind_items (event_name);
create index if not exists inkind_items_donor_idx on public.inkind_items (donor_contact_id);
create index if not exists inkind_items_buyer_idx on public.inkind_items (buyer_contact_id);

-- 4. Letters (a frozen copy of exactly what each letter said) ----------------
create table if not exists public.acknowledgment_letters (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('inkind_ack', 'buyer_receipt')),
  contact_id uuid references public.contacts (id) on delete set null,
  item_ids uuid[] not null default '{}',
  snapshot jsonb not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  emailed_at timestamptz
);
create index if not exists acknowledgment_letters_contact_idx on public.acknowledgment_letters (contact_id);

-- Letterhead and signature details (admins can change them on Settings)
alter table public.settings add column if not exists site_url text;
alter table public.settings add column if not exists org_legal_name text not null default 'Dental Health For Arlington, Inc.';
alter table public.settings add column if not exists org_display_name text not null default 'Dental Health Arlington';
alter table public.settings add column if not exists org_ein text not null default '75-2467366';
alter table public.settings add column if not exists org_address text not null default '501 W. Sanford St., Ste. 11';
alter table public.settings add column if not exists org_city_line text not null default 'Arlington, TX 76011';
alter table public.settings add column if not exists org_phone text not null default '817-277-1165';
alter table public.settings add column if not exists letter_signer_name text not null default 'Dr. Kenneth Morgan-Aguilera';
alter table public.settings add column if not exists letter_signer_title text not null default 'Executive Director';
-- the CRM address donors can open without a Vercel sign-in (used in letter links)
update public.settings set site_url = 'https://donor-crm-chi.vercel.app' where id = 1 and site_url is null;

-- 5. Volunteer imports: a key so re-importing the same file adds nothing twice
alter table public.volunteer_hours add column if not exists import_key text;
create unique index if not exists volunteer_hours_import_key_idx on public.volunteer_hours (import_key);

-- Security: only signed-in, activated staff can see or change any of this ----
alter table public.contact_preference_log enable row level security;
alter table public.outreach_notes enable row level security;
alter table public.inkind_items enable row level security;
alter table public.acknowledgment_letters enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['contact_preference_log', 'outreach_notes', 'inkind_items', 'acknowledgment_letters'] loop
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Donor summary: new columns are added at the end so nothing else changes
-- ---------------------------------------------------------------------------
create or replace view public.contact_summary
with (security_invoker = true) as
select
  c.id, c.first_name, c.last_name, c.email, c.alt_emails, c.phone, c.alt_phones,
  c.address, c.city, c.state, c.zip, c.country, c.notes, c.do_not_email, c.is_anonymous,
  c.info_date, c.created_at, c.updated_at,
  coalesce(s.total_given, 0) as total_given,
  coalesce(s.gift_count, 0) as gift_count,
  s.first_gift_date,
  s.last_gift_date,
  s.last_gift_amount,
  s.last_gift_event,
  coalesce(s.events, '') as events,
  coalesce(s.gift_years, '{}') as gift_years,
  e.last_emailed_at,
  c.organization,
  coalesce(a.events_attended, '') as events_attended,
  c.is_board_member,
  c.unsubscribed_at,
  c.unsubscribe_reason,
  c.is_volunteer,
  coalesce(v.volunteer_hours, 0) as volunteer_hours,
  coalesce(v.volunteer_entries, 0) as volunteer_entries,
  v.last_volunteer_date,
  c.do_not_call,
  c.do_not_mail,
  coalesce(p.purchases, 0) as auction_purchases,
  coalesce(p.purchases_total, 0) as auction_purchases_total
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
) e on true
left join lateral (
  select string_agg(x.event_name, '; ' order by x.event_name) as events_attended
  from public.event_attendance x
  where x.contact_id = c.id
) a on true
left join lateral (
  select sum(h.hours) as volunteer_hours, count(*) as volunteer_entries, max(h.work_date) as last_volunteer_date
  from public.volunteer_hours h
  where h.contact_id = c.id
) v on true
left join lateral (
  select count(*) as purchases, sum(i.sold_amount) as purchases_total
  from public.inkind_items i
  where i.buyer_contact_id = c.id and i.sold_amount is not null
) p on true;

-- ---------------------------------------------------------------------------
-- Thank-yous
-- ---------------------------------------------------------------------------
-- Marks gifts as thanked (or clears it when p_method is null)
create or replace function public.mark_gifts_thanked(p_gift_ids uuid[], p_method text, p_on date default null, p_note text default null)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_by text;
  n int;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  select full_name into v_by from public.profiles where id = auth.uid();
  if p_method is null then
    update public.donations set thanked_on = null, thanked_method = null, thanked_by_name = null,
      thanked_note = null, thanked_recorded_at = null
    where id = any(p_gift_ids);
  else
    update public.donations set
      thanked_on = coalesce(p_on, (now() at time zone 'America/Chicago')::date),
      thanked_method = trim(p_method),
      thanked_by_name = v_by,
      thanked_note = nullif(trim(coalesce(p_note, '')), ''),
      thanked_recorded_at = now()
    where id = any(p_gift_ids);
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Opt-outs (email, calls, mail) with history
-- ---------------------------------------------------------------------------
create or replace function public.set_contact_preference(p_contact uuid, p_channel text, p_opt_out boolean,
  p_method text default null, p_note text default null)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_by text;
  v_now timestamptz := now();
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if p_channel not in ('email', 'call', 'mail') then
    raise exception 'Unknown contact preference';
  end if;
  if not p_opt_out and coalesce(trim(p_note), '') = '' then
    raise exception 'Please note when and how they agreed to hear from DHA again.';
  end if;
  select full_name into v_by from public.profiles where id = auth.uid();

  if p_channel = 'email' then
    if p_opt_out then
      update public.contacts set
        do_not_email = true,
        unsubscribed_at = coalesce(unsubscribed_at, v_now),
        unsubscribe_reason = coalesce(unsubscribe_reason, nullif(trim(coalesce(p_method, '')), '')),
        -- staff entered it themselves, so there is nothing left to review
        unsubscribe_reviewed_at = coalesce(unsubscribe_reviewed_at, v_now),
        updated_at = v_now
      where id = p_contact and not is_anonymous;
    else
      update public.contacts set do_not_email = false, unsubscribed_at = null, unsubscribe_reason = null,
        unsubscribe_reviewed_at = null, updated_at = v_now
      where id = p_contact and not is_anonymous;
    end if;
  elsif p_channel = 'call' then
    update public.contacts set do_not_call = p_opt_out, updated_at = v_now where id = p_contact;
  else
    update public.contacts set do_not_mail = p_opt_out, updated_at = v_now where id = p_contact;
  end if;
  if not found then
    raise exception 'That person was not found.';
  end if;

  insert into public.contact_preference_log (contact_id, channel, action, method, note, by_name)
  values (p_contact, p_channel, case when p_opt_out then 'opt_out' else 'opt_in' end,
          nullif(trim(coalesce(p_method, '')), ''), nullif(trim(coalesce(p_note, '')), ''), v_by);
end;
$$;

create or replace function public.add_outreach_note(p_contact uuid, p_note text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_by text;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'The note is empty.';
  end if;
  select full_name into v_by from public.profiles where id = auth.uid();
  insert into public.outreach_notes (contact_id, note, by_name) values (p_contact, trim(p_note), v_by);
end;
$$;

-- ---------------------------------------------------------------------------
-- In-kind items: every save keeps the donor's in-kind gift in step
-- ---------------------------------------------------------------------------
create or replace function public.inkind_sync_gift(p_item uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v public.inkind_items;
  v_gift uuid;
begin
  select * into v from public.inkind_items where id = p_item;
  if v.id is null then
    return;
  end if;
  if v.donor_contact_id is null then
    if v.donation_id is not null then
      update public.inkind_items set donation_id = null where id = v.id;
      delete from public.donations where id = v.donation_id;
    end if;
    return;
  end if;
  if v.donation_id is null then
    insert into public.donations (contact_id, gift_date, amount, event_name, gift_type, payment_method, source, notes)
    values (v.donor_contact_id, coalesce(v.received_date, v.sold_date, (now() at time zone 'America/Chicago')::date),
            coalesce(v.fair_market_value, 0), v.event_name, 'In-kind', 'In-kind', coalesce(v.source, 'In-kind item'), v.title)
    returning id into v_gift;
    update public.inkind_items set donation_id = v_gift where id = v.id;
  else
    update public.donations set
      contact_id = v.donor_contact_id,
      gift_date = coalesce(v.received_date, v.sold_date, gift_date),
      amount = coalesce(v.fair_market_value, 0),
      event_name = v.event_name,
      gift_type = 'In-kind',
      notes = v.title
    where id = v.donation_id;
  end if;
end;
$$;

create or replace function public.save_inkind_item(p jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_title text := nullif(trim(coalesce(p ->> 'title', '')), '');
  v_event text := coalesce(nullif(trim(coalesce(p ->> 'event_name', '')), ''), 'In-kind donation');
  v_sale text := nullif(trim(coalesce(p ->> 'sale_type', '')), '');
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if v_title is null then
    raise exception 'Please enter what the item is.';
  end if;

  if v_id is null then
    insert into public.inkind_items (event_name, item_number, title, description, sale_type, is_service,
      donor_contact_id, fair_market_value, received_date, buyer_contact_id, bidder_number, sold_amount, sold_date,
      notes, source)
    values (v_event, nullif(trim(coalesce(p ->> 'item_number', '')), ''), v_title,
      nullif(trim(coalesce(p ->> 'description', '')), ''), v_sale, coalesce((p ->> 'is_service')::boolean, false),
      nullif(p ->> 'donor_contact_id', '')::uuid, nullif(p ->> 'fair_market_value', '')::numeric,
      nullif(p ->> 'received_date', '')::date, nullif(p ->> 'buyer_contact_id', '')::uuid,
      nullif(trim(coalesce(p ->> 'bidder_number', '')), ''), nullif(p ->> 'sold_amount', '')::numeric,
      nullif(p ->> 'sold_date', '')::date, nullif(trim(coalesce(p ->> 'notes', '')), ''), 'Entered by staff')
    returning id into v_id;
  else
    update public.inkind_items set
      event_name = v_event,
      item_number = nullif(trim(coalesce(p ->> 'item_number', '')), ''),
      title = v_title,
      description = nullif(trim(coalesce(p ->> 'description', '')), ''),
      sale_type = v_sale,
      is_service = coalesce((p ->> 'is_service')::boolean, false),
      donor_contact_id = nullif(p ->> 'donor_contact_id', '')::uuid,
      fair_market_value = nullif(p ->> 'fair_market_value', '')::numeric,
      received_date = nullif(p ->> 'received_date', '')::date,
      buyer_contact_id = nullif(p ->> 'buyer_contact_id', '')::uuid,
      bidder_number = nullif(trim(coalesce(p ->> 'bidder_number', '')), ''),
      sold_amount = nullif(p ->> 'sold_amount', '')::numeric,
      sold_date = nullif(p ->> 'sold_date', '')::date,
      notes = nullif(trim(coalesce(p ->> 'notes', '')), ''),
      updated_at = now()
    where id = v_id;
    if not found then
      raise exception 'That item was not found.';
    end if;
  end if;

  perform public.inkind_sync_gift(v_id);
  return v_id;
end;
$$;

create or replace function public.delete_inkind_item(p_item uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_gift uuid;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  delete from public.inkind_items where id = p_item returning donation_id into v_gift;
  if v_gift is not null then
    delete from public.donations where id = v_gift;
  end if;
end;
$$;

-- In-kind gifts recorded some other way (older records, or a gift spreadsheet
-- with an "In-kind" row) get a matching item on the In-Kind tab. Runs now, and
-- again whenever the In-Kind tab opens.
create or replace function public.adopt_inkind_gifts()
returns int
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  insert into public.inkind_items (event_name, title, donor_contact_id, fair_market_value, received_date, donation_id,
    source, created_at)
  select d.event_name, coalesce(nullif(trim(d.notes), ''), 'In-kind gift'), d.contact_id, d.amount, d.gift_date, d.id,
         coalesce(d.source, 'Gift record'), d.created_at
  from public.donations d
  where d.gift_type = 'In-kind'
    and not exists (select 1 from public.inkind_items i where i.donation_id = d.id);
  get diagnostics n = row_count;
  return n;
end;
$$;
select public.adopt_inkind_gifts();

-- ---------------------------------------------------------------------------
-- Letters: a thank-you acknowledgment for in-kind donors, or a receipt for
-- auction buyers. The letter's wording is saved when it is created, so a
-- later edit to an item never changes a letter someone already received.
-- ---------------------------------------------------------------------------
create or replace function public.create_letter(p_kind text, p_contact uuid, p_item_ids uuid[])
returns uuid
language plpgsql
set search_path = public
as $$
declare
  s public.settings;
  c public.contacts;
  v_items jsonb;
  v_count int;
  v_missing text;
  v_by text;
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if p_kind not in ('inkind_ack', 'buyer_receipt') then
    raise exception 'Unknown letter type';
  end if;
  select * into c from public.contacts where id = p_contact;
  if c.id is null then
    raise exception 'That person was not found.';
  end if;
  select * into s from public.settings where id = 1;
  select full_name into v_by from public.profiles where id = auth.uid();

  select count(*) into v_count
  from public.inkind_items i
  where i.id = any(p_item_ids)
    and case when p_kind = 'inkind_ack' then i.donor_contact_id else i.buyer_contact_id end = p_contact;
  if v_count = 0 or v_count <> coalesce(array_length(p_item_ids, 1), 0) then
    raise exception 'Those items do not all belong to this person.';
  end if;

  if p_kind = 'buyer_receipt' then
    select string_agg(i.title, ', ') into v_missing
    from public.inkind_items i
    where i.id = any(p_item_ids) and (i.sold_amount is null or i.fair_market_value is null);
    if v_missing is not null then
      raise exception 'A buyer receipt needs both the amount paid and the market value. Missing for: %', v_missing;
    end if;
  end if;

  select jsonb_agg(jsonb_build_object(
      'title', i.title,
      'description', i.description,
      'item_number', i.item_number,
      'event_name', i.event_name,
      'is_service', i.is_service,
      'sale_type', i.sale_type,
      'received_date', i.received_date,
      'fair_market_value', i.fair_market_value,
      'sold_amount', i.sold_amount,
      'deductible', greatest(coalesce(i.sold_amount, 0) - coalesce(i.fair_market_value, 0), 0)
    ) order by i.event_name, i.item_number nulls last, i.title)
  into v_items
  from public.inkind_items i
  where i.id = any(p_item_ids);

  insert into public.acknowledgment_letters (kind, contact_id, item_ids, snapshot, created_by_name)
  values (p_kind, p_contact, p_item_ids, jsonb_build_object(
      'kind', p_kind,
      'letter_date', (now() at time zone 'America/Chicago')::date,
      'org', jsonb_build_object(
        'legal_name', s.org_legal_name, 'display_name', s.org_display_name, 'ein', s.org_ein,
        'address', s.org_address, 'city_line', s.org_city_line, 'phone', s.org_phone,
        'signer_name', s.letter_signer_name, 'signer_title', s.letter_signer_title),
      'recipient', jsonb_build_object(
        'first_name', c.first_name, 'last_name', c.last_name, 'organization', c.organization,
        'address', c.address, 'city', c.city, 'state', c.state, 'zip', c.zip),
      'items', v_items),
    v_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- After a letter is emailed: record it, and mark the in-kind gifts thanked
create or replace function public.mark_letter_emailed(p_letter uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  l public.acknowledgment_letters;
  v_by text;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  select * into l from public.acknowledgment_letters where id = p_letter;
  if l.id is null then
    raise exception 'Letter not found';
  end if;
  select full_name into v_by from public.profiles where id = auth.uid();
  update public.acknowledgment_letters set emailed_at = now() where id = p_letter;
  if l.kind = 'inkind_ack' then
    update public.inkind_items set donor_letter_sent_at = now() where id = any(l.item_ids);
    update public.donations d set
      thanked_on = (now() at time zone 'America/Chicago')::date,
      thanked_method = 'Emailed thank-you letter',
      thanked_by_name = v_by,
      thanked_recorded_at = now()
    from public.inkind_items i
    where i.id = any(l.item_ids) and d.id = i.donation_id and d.thanked_on is null;
  else
    update public.inkind_items set buyer_receipt_sent_at = now() where id = any(l.item_ids);
  end if;
end;
$$;

-- The only thing the public can read: one letter, by its private link.
-- The link's id is a random 122-bit number, so letters can't be guessed.
create or replace function public.get_letter(p_letter uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', l.id, 'kind', l.kind, 'snapshot', l.snapshot)
  from public.acknowledgment_letters l
  where l.id = p_letter;
$$;

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------
-- Volunteers: rows with a date and hours add time; rows without are a roster
create or replace function public.import_volunteers(rows jsonb, source_label text default 'Volunteer list')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_contact uuid;
  v_created boolean;
  v_date date;
  v_hours numeric;
  v_activity text;
  v_key text;
  v_was boolean;
  new_people int := 0; matched int := 0; marked int := 0; added int := 0; already int := 0; flagged int := 0;
  before_flags int;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  select count(*) into before_flags from public.possible_duplicates;

  for r in select value from jsonb_array_elements(rows) loop
    select f.contact_id, f.created into v_contact, v_created from public.contact_for_row(r, null) f;
    if v_created then new_people := new_people + 1; else matched := matched + 1; end if;

    select is_volunteer into v_was from public.contacts where id = v_contact;
    if not v_was then
      update public.contacts set is_volunteer = true, updated_at = now() where id = v_contact;
      marked := marked + 1;
    end if;

    v_date := nullif(r ->> 'work_date', '')::date;
    v_hours := nullif(r ->> 'hours', '')::numeric;
    if v_date is not null and v_hours is not null and v_hours > 0 then
      v_activity := coalesce(nullif(trim(coalesce(r ->> 'activity', '')), ''), 'General volunteering');
      v_key := md5(v_contact::text || '|' || v_date::text || '|' || lower(v_activity) || '|' || round(v_hours, 2)::text);
      insert into public.volunteer_hours (contact_id, work_date, hours, activity, notes, source, import_key)
      values (v_contact, v_date, round(v_hours, 2), v_activity, nullif(trim(coalesce(r ->> 'notes', '')), ''),
              source_label, v_key)
      on conflict (import_key) do nothing;
      if found then added := added + 1; else already := already + 1; end if;
    end if;
  end loop;

  select count(*) - before_flags into flagged from public.possible_duplicates;
  return jsonb_build_object(
    'new_people', new_people, 'matched_people', matched, 'marked_volunteer', marked,
    'hours_added', added, 'hours_already_recorded', already, 'possible_duplicates_flagged', flagged);
end;
$$;

-- People lists: adds or matches each person; "Yes" columns tick boxes
create or replace function public.import_people(rows jsonb, source_label text default 'People list')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_contact uuid;
  v_created boolean;
  v_note text;
  new_people int := 0; matched int := 0; flags_set int := 0; flagged int := 0;
  before_flags int;
  ch text;
  v_flag boolean;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  select count(*) into before_flags from public.possible_duplicates;

  for r in select value from jsonb_array_elements(rows) loop
    select f.contact_id, f.created into v_contact, v_created from public.contact_for_row(r, null) f;
    if v_created then new_people := new_people + 1; else matched := matched + 1; end if;

    if coalesce((r ->> 'is_board_member')::boolean, false) then
      update public.contacts set is_board_member = true, updated_at = now() where id = v_contact and not is_board_member;
      if found then flags_set := flags_set + 1; end if;
    end if;
    if coalesce((r ->> 'is_volunteer')::boolean, false) then
      update public.contacts set is_volunteer = true, updated_at = now() where id = v_contact and not is_volunteer;
      if found then flags_set := flags_set + 1; end if;
    end if;
    foreach ch in array array['email', 'call', 'mail'] loop
      if coalesce((r ->> ('do_not_' || ch))::boolean, false) then
        select case ch when 'email' then do_not_email when 'call' then do_not_call else do_not_mail end
          into v_flag from public.contacts where id = v_contact;
        if not v_flag then
          perform public.set_contact_preference(v_contact, ch, true, 'Imported list', source_label);
          flags_set := flags_set + 1;
        end if;
      end if;
    end loop;

    v_note := nullif(trim(coalesce(r ->> 'notes', '')), '');
    if v_note is not null then
      update public.contacts
      set notes = case when notes is null or notes = '' then v_note else notes || E'\n' || v_note end, updated_at = now()
      where id = v_contact and position(v_note in coalesce(notes, '')) = 0;
    end if;
  end loop;

  select count(*) - before_flags into flagged from public.possible_duplicates;
  return jsonb_build_object(
    'new_people', new_people, 'matched_people', matched, 'boxes_ticked', flags_set,
    'possible_duplicates_flagged', flagged);
end;
$$;

-- Auction and in-kind items (for example a OneCause export). Importing the
-- same file again updates the items (say, winners added after the event)
-- instead of adding them twice.
create or replace function public.import_auction_items(rows jsonb, event text, source_label text default 'Auction import')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_event text := trim(coalesce(event, ''));
  v_key text;
  v_id uuid;
  v_donor uuid;
  v_buyer uuid;
  v_created boolean;
  v_sale text;
  added int := 0; updated int := 0; new_people int := 0; matched int := 0; flagged int := 0;
  before_flags int;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if v_event = '' then
    raise exception 'Please enter the event name';
  end if;
  select count(*) into before_flags from public.possible_duplicates;

  for r in select value from jsonb_array_elements(rows) loop
    if coalesce(trim(r ->> 'title'), '') = '' then
      continue;
    end if;
    v_key := lower(v_event) || '|' ||
      coalesce('#' || nullif(lower(trim(coalesce(r ->> 'item_number', ''))), ''), 'title:' || lower(trim(r ->> 'title'))) ||
      coalesce('|' || nullif(r ->> 'dup_index', ''), '');

    v_donor := null;
    if r -> 'donor' is not null and jsonb_typeof(r -> 'donor') = 'object' then
      select f.contact_id, f.created into v_donor, v_created from public.contact_for_row(r -> 'donor', null) f;
      if v_created then new_people := new_people + 1; else matched := matched + 1; end if;
    end if;
    v_buyer := null;
    if r -> 'buyer' is not null and jsonb_typeof(r -> 'buyer') = 'object' then
      select f.contact_id, f.created into v_buyer, v_created from public.contact_for_row(r -> 'buyer', null) f;
      if v_created then new_people := new_people + 1; else matched := matched + 1; end if;
    end if;

    v_sale := nullif(trim(coalesce(r ->> 'sale_type', '')), '');
    if v_sale is not null and v_sale not in ('Silent auction', 'Live auction', 'Raffle', 'Not auctioned') then
      v_sale := null;
    end if;

    select id into v_id from public.inkind_items where import_key = v_key;
    if v_id is null then
      insert into public.inkind_items (event_name, item_number, title, description, sale_type, is_service,
        donor_contact_id, fair_market_value, received_date, buyer_contact_id, bidder_number, sold_amount, sold_date,
        notes, source, import_key)
      values (v_event, nullif(trim(coalesce(r ->> 'item_number', '')), ''), trim(r ->> 'title'),
        nullif(trim(coalesce(r ->> 'description', '')), ''), v_sale, coalesce((r ->> 'is_service')::boolean, false),
        v_donor, nullif(r ->> 'fair_market_value', '')::numeric, nullif(r ->> 'received_date', '')::date,
        v_buyer, nullif(trim(coalesce(r ->> 'bidder_number', '')), ''), nullif(r ->> 'sold_amount', '')::numeric,
        nullif(r ->> 'sold_date', '')::date, nullif(trim(coalesce(r ->> 'notes', '')), ''), source_label, v_key)
      returning id into v_id;
      added := added + 1;
    else
      -- fill in or correct what the file has; keep what it leaves blank
      update public.inkind_items set
        title = trim(r ->> 'title'),
        description = coalesce(nullif(trim(coalesce(r ->> 'description', '')), ''), description),
        sale_type = coalesce(v_sale, sale_type),
        is_service = coalesce((r ->> 'is_service')::boolean, is_service),
        donor_contact_id = coalesce(v_donor, donor_contact_id),
        fair_market_value = coalesce(nullif(r ->> 'fair_market_value', '')::numeric, fair_market_value),
        received_date = coalesce(nullif(r ->> 'received_date', '')::date, received_date),
        buyer_contact_id = coalesce(v_buyer, buyer_contact_id),
        bidder_number = coalesce(nullif(trim(coalesce(r ->> 'bidder_number', '')), ''), bidder_number),
        sold_amount = coalesce(nullif(r ->> 'sold_amount', '')::numeric, sold_amount),
        sold_date = coalesce(nullif(r ->> 'sold_date', '')::date, sold_date),
        notes = coalesce(nullif(trim(coalesce(r ->> 'notes', '')), ''), notes),
        updated_at = now()
      where id = v_id;
      updated := updated + 1;
    end if;
    perform public.inkind_sync_gift(v_id);
  end loop;

  select count(*) - before_flags into flagged from public.possible_duplicates;
  return jsonb_build_object(
    'items_added', added, 'items_updated', updated, 'new_people', new_people, 'matched_people', matched,
    'possible_duplicates_flagged', flagged);
end;
$$;

-- ---------------------------------------------------------------------------
-- Combining duplicate records keeps everything above with the record kept
-- ---------------------------------------------------------------------------
create or replace function public.prepare_merge(keep_id uuid, remove_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if keep_id = remove_id then
    return;
  end if;
  update public.event_attendance x set contact_id = keep_id
  where x.contact_id = remove_id
    and not exists (select 1 from public.event_attendance y where y.contact_id = keep_id and y.event_name = x.event_name);
  update public.volunteer_hours set contact_id = keep_id where contact_id = remove_id;
  update public.inkind_items set donor_contact_id = keep_id where donor_contact_id = remove_id;
  update public.inkind_items set buyer_contact_id = keep_id where buyer_contact_id = remove_id;
  update public.contact_preference_log set contact_id = keep_id where contact_id = remove_id;
  update public.outreach_notes set contact_id = keep_id where contact_id = remove_id;
  update public.acknowledgment_letters set contact_id = keep_id where contact_id = remove_id;
  update public.contacts k set
    organization = coalesce(k.organization, d.organization),
    is_board_member = k.is_board_member or d.is_board_member,
    is_volunteer = k.is_volunteer or d.is_volunteer,
    do_not_call = k.do_not_call or d.do_not_call,
    do_not_mail = k.do_not_mail or d.do_not_mail
  from public.contacts d
  where k.id = keep_id and d.id = remove_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may run what
-- ---------------------------------------------------------------------------
revoke execute on function public.mark_gifts_thanked(uuid[], text, date, text) from anon, public;
revoke execute on function public.set_contact_preference(uuid, text, boolean, text, text) from anon, public;
revoke execute on function public.add_outreach_note(uuid, text) from anon, public;
revoke execute on function public.inkind_sync_gift(uuid) from anon, public;
revoke execute on function public.save_inkind_item(jsonb) from anon, public;
revoke execute on function public.delete_inkind_item(uuid) from anon, public;
revoke execute on function public.adopt_inkind_gifts() from anon, public;
revoke execute on function public.create_letter(text, uuid, uuid[]) from anon, public;
revoke execute on function public.mark_letter_emailed(uuid) from anon, public;
revoke execute on function public.import_volunteers(jsonb, text) from anon, public;
revoke execute on function public.import_people(jsonb, text) from anon, public;
revoke execute on function public.import_auction_items(jsonb, text, text) from anon, public;
revoke execute on function public.prepare_merge(uuid, uuid) from anon, public;
revoke execute on function public.get_letter(uuid) from public;

grant execute on function public.mark_gifts_thanked(uuid[], text, date, text), public.set_contact_preference(uuid, text, boolean, text, text),
  public.add_outreach_note(uuid, text), public.inkind_sync_gift(uuid), public.save_inkind_item(jsonb),
  public.delete_inkind_item(uuid), public.adopt_inkind_gifts(), public.create_letter(text, uuid, uuid[]), public.mark_letter_emailed(uuid),
  public.import_volunteers(jsonb, text), public.import_people(jsonb, text), public.import_auction_items(jsonb, text, text),
  public.prepare_merge(uuid, uuid)
  to authenticated;
grant execute on function public.get_letter(uuid) to anon, authenticated;
