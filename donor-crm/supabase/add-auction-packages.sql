-- =============================================================================
-- DHA Donor CRM: auction packages and the OneCause import
--
-- Run this once in the Supabase SQL Editor, AFTER add-thankyous-optouts-inkind.sql.
-- It is safe to run more than once.
--
-- What it adds:
--   * Packages: an auction lot made up of several donated items. The package
--     holds what sold, to whom and for how much; each donated item points to
--     the package it went into.
--   * import_onecause(): brings in OneCause's Auction Proceeds report (the
--     packages and winners) and Items Report (the donated items and donors)
--     together. Importing the same files again updates instead of duplicating,
--     and keeps what staff changed in the CRM (names, events, packages, notes).
--   * A rule on every save: a package never has a donor, and an item inside a
--     package never has its own buyer or price, so no sale is counted twice.
-- =============================================================================

alter table public.inkind_items add column if not exists is_package boolean not null default false;
alter table public.inkind_items add column if not exists package_id uuid references public.inkind_items (id) on delete set null;
alter table public.inkind_items add column if not exists procurement_status text;
-- the OneCause key of an item first added by another import, which keeps its own key in import_key
alter table public.inkind_items add column if not exists onecause_key text;
create index if not exists inkind_items_onecause_key_idx on public.inkind_items (onecause_key);
-- true once staff chose an item's package (on the In-Kind tab or the import's review list);
-- an import never moves such an item into or out of a package after that
alter table public.inkind_items add column if not exists package_locked boolean not null default false;
create index if not exists inkind_items_package_idx on public.inkind_items (package_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inkind_items_package_not_nested') then
    alter table public.inkind_items add constraint inkind_items_package_not_nested
      check (not (is_package and package_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inkind_items_package_not_self') then
    alter table public.inkind_items add constraint inkind_items_package_not_self
      check (package_id is null or package_id <> id);
  end if;
end $$;

-- Every save, from any screen or import: a package is sold, not donated, and an
-- item sold inside a package is bought through the package. This keeps each
-- sale counted once and each gift on the right donor.
create or replace function public.inkind_items_package_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_package then
    new.donor_contact_id := null;
    new.package_id := null;
    new.onecause_key := null; -- its donated item is added on its own again, inside it
  elsif new.package_id is not null then
    if not exists (select 1 from public.inkind_items where id = new.package_id and is_package) then
      raise exception 'That package was not found.';
    end if;
    new.buyer_contact_id := null;
    new.bidder_number := null;
    new.sold_amount := null;
    new.sold_date := null;
  end if;
  return new;
end;
$$;

drop trigger if exists inkind_items_package_rules on public.inkind_items;
create trigger inkind_items_package_rules
  before insert or update on public.inkind_items
  for each row execute function public.inkind_items_package_rules();

-- a package that somehow still carries an in-kind gift loses it
create or replace function public.inkind_items_package_gift()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_package and new.donation_id is not null then
    perform public.inkind_sync_gift(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists inkind_items_package_gift on public.inkind_items;
create trigger inkind_items_package_gift
  after insert or update of is_package, donation_id on public.inkind_items
  for each row execute function public.inkind_items_package_gift();

-- ---------------------------------------------------------------------------
-- Saving an item or package from the In-Kind tab
-- ---------------------------------------------------------------------------
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
  v_is_package boolean := coalesce((p ->> 'is_package')::boolean, false);
  v_package uuid := nullif(p ->> 'package_id', '')::uuid;
  v_donor uuid := nullif(p ->> 'donor_contact_id', '')::uuid;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if v_title is null then
    raise exception 'Please enter what the item is.';
  end if;
  if v_is_package then
    -- a package is sold, not donated: its donors are on the items inside it
    v_package := null;
    v_donor := null;
  elsif v_package is not null then
    if v_package = v_id or not exists (select 1 from public.inkind_items where id = v_package and is_package) then
      raise exception 'That package was not found.';
    end if;
  end if;
  if v_id is not null and not v_is_package and exists (select 1 from public.inkind_items where package_id = v_id) then
    raise exception 'This package still has donated items in it. Move them to another package first.';
  end if;

  if v_id is null then
    insert into public.inkind_items (event_name, item_number, title, description, sale_type, is_service,
      donor_contact_id, fair_market_value, received_date, buyer_contact_id, bidder_number, sold_amount, sold_date,
      notes, source, is_package, package_id, package_locked)
    values (v_event, nullif(trim(coalesce(p ->> 'item_number', '')), ''), v_title,
      nullif(trim(coalesce(p ->> 'description', '')), ''), v_sale, coalesce((p ->> 'is_service')::boolean, false),
      v_donor, nullif(p ->> 'fair_market_value', '')::numeric,
      nullif(p ->> 'received_date', '')::date,
      case when v_package is null then nullif(p ->> 'buyer_contact_id', '')::uuid end,
      case when v_package is null then nullif(trim(coalesce(p ->> 'bidder_number', '')), '') end,
      case when v_package is null then nullif(p ->> 'sold_amount', '')::numeric end,
      case when v_package is null then nullif(p ->> 'sold_date', '')::date end,
      nullif(trim(coalesce(p ->> 'notes', '')), ''), 'Entered by staff', v_is_package, v_package, v_package is not null)
    returning id into v_id;
  else
    update public.inkind_items set
      event_name = v_event,
      item_number = nullif(trim(coalesce(p ->> 'item_number', '')), ''),
      title = v_title,
      description = nullif(trim(coalesce(p ->> 'description', '')), ''),
      sale_type = v_sale,
      is_service = coalesce((p ->> 'is_service')::boolean, false),
      donor_contact_id = v_donor,
      fair_market_value = nullif(p ->> 'fair_market_value', '')::numeric,
      received_date = nullif(p ->> 'received_date', '')::date,
      -- an item sold as part of a package is bought through the package
      buyer_contact_id = case when v_package is null then nullif(p ->> 'buyer_contact_id', '')::uuid end,
      bidder_number = case when v_package is null then nullif(trim(coalesce(p ->> 'bidder_number', '')), '') end,
      sold_amount = case when v_package is null then nullif(p ->> 'sold_amount', '')::numeric end,
      sold_date = case when v_package is null then nullif(p ->> 'sold_date', '')::date end,
      notes = nullif(trim(coalesce(p ->> 'notes', '')), ''),
      is_package = v_is_package,
      package_id = v_package,
      package_locked = package_locked or package_id is distinct from v_package,
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


-- ---------------------------------------------------------------------------
-- Finding the person on an imported row. Whether a donor name is a person or a
-- business is a guess, so before adding anyone the other reading is checked
-- too: a business row matches the same business, then the one person with that
-- name ("Min Park"), then anyone with its email; a person row matches a
-- business with exactly that name ("Pinstack Bowl") before the usual matching.
-- ---------------------------------------------------------------------------
create or replace function public.import_contact(r jsonb, out contact_id uuid, out created boolean)
language plpgsql
set search_path = public
as $$
declare
  v_email text := nullif(lower(trim(coalesce(r ->> 'email', ''))), '');
  v_first text := coalesce(trim(r ->> 'first_name'), '');
  v_last text := coalesce(trim(r ->> 'last_name'), '');
  v_pf text;
  v_pl text;
begin
  created := false;
  if v_first = '' and v_last <> '' then
    -- a business: the same business by name or email
    select c.id into contact_id from public.contacts c
    where not c.is_anonymous and c.first_name = ''
      and (regexp_replace(lower(c.last_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v_last), '[^a-z0-9]', '', 'g')
           or public.contact_has_email(c, v_email))
    order by c.created_at limit 1;
    if contact_id is not null then
      return;
    end if;
    -- a person whose name was read as a business ("Min Park"): the one person with exactly that name
    if v_last ~ '\s' then
      v_pf := regexp_replace(lower(regexp_replace(v_last, '\s+\S+$', '')), '[^a-z0-9]', '', 'g');
      v_pl := regexp_replace(lower(regexp_replace(v_last, '^.*\s', '')), '[^a-z0-9]', '', 'g');
      select min(c.id::text)::uuid into contact_id from public.contacts c
      where not c.is_anonymous and c.first_name <> ''
        and regexp_replace(lower(c.first_name), '[^a-z0-9]', '', 'g') = v_pf
        and regexp_replace(lower(c.last_name), '[^a-z0-9]', '', 'g') = v_pl
        and (v_email is null or public.contact_has_email(c, v_email))
      having count(*) = 1;
      if contact_id is not null then
        return;
      end if;
    end if;
  end if;
  -- no first name (a business not found above, or just an email): whoever has that email
  if v_first = '' and v_email is not null then
    select c.id into contact_id from public.contacts c
    where not c.is_anonymous and lower(c.email) = v_email
    order by c.created_at limit 1;
    if contact_id is null then
      select c.id into contact_id from public.contacts c
      where not c.is_anonymous and public.contact_has_email(c, v_email)
      order by c.created_at limit 1;
    end if;
    if contact_id is not null then
      return;
    end if;
  end if;
  -- a business whose name was read as a person's ("Pinstack Bowl"): the business with that exact
  -- name, but only when no person has that name and the row's email (if any) is the business's
  if v_first <> '' and v_last <> ''
     and not exists (select 1 from public.contacts p
                     where not p.is_anonymous and p.first_name <> ''
                       and regexp_replace(lower(p.first_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v_first), '[^a-z0-9]', '', 'g')
                       and regexp_replace(lower(p.last_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v_last), '[^a-z0-9]', '', 'g')) then
    select c.id into contact_id from public.contacts c
    where not c.is_anonymous and c.first_name = ''
      and regexp_replace(lower(c.last_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v_first || v_last), '[^a-z0-9]', '', 'g')
      and (v_email is null or public.contact_has_email(c, v_email))
    order by c.created_at limit 1;
    if contact_id is not null then
      return;
    end if;
  end if;
  select f.contact_id, f.created into contact_id, created from public.contact_for_row(r, null) f;
end;
$$;

-- ---------------------------------------------------------------------------
-- OneCause import: packages (Auction Proceeds) and donated items (Items Report)
--
-- The screen sends the files in small parts (packages first). all_item_keys
-- lists every item in the whole import, so an item already in the CRM under
-- another key is only taken over when no other row of this import is its own.
--
-- On a repeat import, OneCause updates the sale and the donation: buyers,
-- prices, market values, donors and procurement status. What staff set in the
-- CRM stays: names, descriptions, events, notes, a package staff chose for an
-- item, and a lot staff turned into a single item (or the reverse). An item
-- not yet in any package is put in the one it sold in.
-- ---------------------------------------------------------------------------
drop function if exists public.import_onecause(jsonb, jsonb, text);
create or replace function public.import_onecause(packages jsonb, items jsonb, source_label text default 'OneCause',
  all_item_keys text[] default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_id uuid;
  v_cur public.inkind_items;
  v_pkg public.inkind_items;
  v_person uuid;
  v_created boolean;
  v_sale text;
  v_title text;
  v_event text;
  v_value numeric;
  v_link boolean;
  v_adopted boolean;
  v_lot public.inkind_items;
  v_reviewed boolean;
  v_note text;
  v_lot_item boolean;
  v_keys text[];
  p_added int := 0; p_updated int := 0; i_added int := 0; i_updated int := 0;
  new_people int := 0; matched int := 0; flagged int := 0;
  before_flags int;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  select count(*) into before_flags from public.possible_duplicates;
  v_keys := coalesce(all_item_keys,
    array(select value ->> 'key' from jsonb_array_elements(coalesce(items, '[]'::jsonb))));

  -- packages first, so items can point to them
  for r in select value from jsonb_array_elements(coalesce(packages, '[]'::jsonb)) loop
    v_title := nullif(trim(coalesce(r ->> 'title', '')), '');
    if v_title is null or coalesce(trim(r ->> 'key'), '') = '' then
      continue;
    end if;
    v_person := null;
    if jsonb_typeof(r -> 'buyer') = 'object' then
      select f.contact_id, f.created into v_person, v_created from public.import_contact(r -> 'buyer') f;
      if v_created then new_people := new_people + 1; else matched := matched + 1; end if;
    end if;
    v_sale := nullif(trim(coalesce(r ->> 'sale_type', '')), '');
    if v_sale is not null and v_sale not in ('Silent auction', 'Live auction', 'Raffle', 'Not auctioned') then
      v_sale := null;
    end if;

    select * into v_cur from public.inkind_items where import_key = r ->> 'key';
    if v_cur.id is null then
      insert into public.inkind_items (event_name, item_number, title, description, sale_type, is_package,
        fair_market_value, buyer_contact_id, bidder_number, sold_amount, sold_date, notes, source, import_key)
      values (coalesce(nullif(trim(coalesce(r ->> 'event_name', '')), ''), 'In-kind donation'),
        nullif(trim(coalesce(r ->> 'item_number', '')), ''), v_title, nullif(trim(coalesce(r ->> 'description', '')), ''),
        v_sale, true, nullif(r ->> 'fair_market_value', '')::numeric, v_person,
        nullif(trim(coalesce(r ->> 'bidder_number', '')), ''), nullif(r ->> 'sold_amount', '')::numeric,
        nullif(r ->> 'sold_date', '')::date, nullif(trim(coalesce(r ->> 'notes', '')), ''), source_label, r ->> 'key')
      returning id into v_id;
      p_added := p_added + 1;
    elsif v_cur.is_package then
      v_id := v_cur.id;
      update public.inkind_items set
        item_number = coalesce(item_number, nullif(trim(coalesce(r ->> 'item_number', '')), '')),
        sale_type = coalesce(sale_type, v_sale),
        fair_market_value = coalesce(nullif(r ->> 'fair_market_value', '')::numeric, fair_market_value),
        buyer_contact_id = coalesce(v_person, buyer_contact_id),
        bidder_number = coalesce(nullif(trim(coalesce(r ->> 'bidder_number', '')), ''), bidder_number),
        sold_amount = coalesce(nullif(r ->> 'sold_amount', '')::numeric, sold_amount),
        sold_date = coalesce(nullif(r ->> 'sold_date', '')::date, sold_date),
        notes = coalesce(notes, nullif(trim(coalesce(r ->> 'notes', '')), '')),
        updated_at = now()
      where id = v_id;
      p_updated := p_updated + 1;
    else
      -- staff made this lot a single item on the In-Kind tab; leave it as they set it
      continue;
    end if;
    perform public.inkind_sync_gift(v_id);
  end loop;

  for r in select value from jsonb_array_elements(coalesce(items, '[]'::jsonb)) loop
    v_title := nullif(trim(coalesce(r ->> 'title', '')), '');
    if v_title is null or coalesce(trim(r ->> 'key'), '') = '' then
      continue;
    end if;
    v_person := null;
    if jsonb_typeof(r -> 'donor') = 'object' then
      select f.contact_id, f.created into v_person, v_created from public.import_contact(r -> 'donor') f;
      if v_created then new_people := new_people + 1; else matched := matched + 1; end if;
    end if;
    v_pkg := null;
    v_lot := null;
    if coalesce(r ->> 'package_key', '') <> '' then
      select * into v_pkg from public.inkind_items where import_key = r ->> 'package_key' and is_package;
      if v_pkg.id is null then
        -- staff made this lot a single item: that item is this donated item
        select * into v_lot from public.inkind_items where import_key = r ->> 'package_key' and not is_package;
      end if;
    end if;
    v_event := coalesce(v_pkg.event_name, v_lot.event_name, nullif(trim(coalesce(r ->> 'event_name', '')), ''), 'In-kind donation');
    v_value := nullif(r ->> 'fair_market_value', '')::numeric;
    v_reviewed := coalesce((r ->> 'reviewed')::boolean, false);

    v_adopted := false;
    select * into v_cur from public.inkind_items where import_key = r ->> 'key' or onecause_key = r ->> 'key' limit 1;
    if v_cur.id is null and v_lot.id is not null then
      -- Staff made this lot a single item. It is this donated item when the donor (or, with no
      -- donor set, the value) matches. Any other item of that lot isn't added on its own, which
      -- would count the lot twice; it is noted on the single item for staff to see.
      if v_lot.onecause_key is null
         and (v_lot.donor_contact_id = v_person
              or (v_lot.donor_contact_id is null and v_value is not null and v_lot.fair_market_value = v_value)) then
        update public.inkind_items set onecause_key = r ->> 'key' where id = v_lot.id;
        select * into v_cur from public.inkind_items where id = v_lot.id;
      else
        v_note := format('OneCause also lists %s from %s in this lot.', v_title,
          coalesce(nullif(trim(concat_ws(' ', r -> 'donor' ->> 'first_name', r -> 'donor' ->> 'last_name')), ''), 'no donor'));
        update public.inkind_items set notes = concat_ws(' ', notes, v_note)
        where id = v_lot.id and position(v_note in coalesce(notes, '')) = 0;
        continue;
      end if;
    end if;
    -- Not from an earlier OneCause import under this key: the same gift may already be here from
    -- a gift spreadsheet, another item list, or an older export. Take it over only when it is
    -- clearly the same gift: same donor, event and name (or an unnamed "In-kind gift" of the same
    -- value), not sold on its own, not a lot, and not claimed by another OneCause row.
    if v_cur.id is null and v_person is not null then
      select * into v_cur from public.inkind_items i
      where not i.is_package
        and i.donor_contact_id = v_person
        and i.event_name = v_event
        and i.buyer_contact_id is null and i.sold_amount is null
        and i.onecause_key is null
        and (i.import_key is null
             or (i.import_key like 'oc-item|%' and not (i.import_key = any (v_keys)))
             or i.import_key not like 'oc-%')
        and (lower(trim(i.title)) in (lower(v_title), lower(regexp_replace(v_title, '\s*\(\d+\)$', '')))
             or (lower(trim(i.title)) = 'in-kind gift' and v_value is not null and i.fair_market_value = v_value))
      order by (lower(trim(i.title)) = lower(v_title)) desc, i.created_at
      limit 1;
      if v_cur.id is not null then
        v_adopted := true;
        -- another import's key stays, so that import still finds its row; OneCause's goes alongside
        update public.inkind_items set
          import_key = case when import_key is null or import_key like 'oc-item|%' then r ->> 'key' else import_key end,
          onecause_key = case when import_key is null or import_key like 'oc-item|%' then null else r ->> 'key' end,
          title = case when lower(trim(title)) = 'in-kind gift' then v_title else title end
        where id = v_cur.id;
      end if;
    end if;

    if v_cur.id is null then
      insert into public.inkind_items (event_name, title, description, sale_type, donor_contact_id, fair_market_value,
        received_date, package_id, procurement_status, notes, source, import_key, package_locked)
      values (v_event, v_title, nullif(trim(coalesce(r ->> 'description', '')), ''), v_pkg.sale_type,
        v_person, v_value, nullif(r ->> 'received_date', '')::date, v_pkg.id,
        nullif(trim(coalesce(r ->> 'procurement_status', '')), ''), nullif(trim(coalesce(r ->> 'notes', '')), ''),
        source_label, r ->> 'key', v_reviewed)
      returning id into v_id;
      i_added := i_added + 1;
    elsif v_cur.is_package then
      -- staff made this item into a package; leave it as they set it
      continue;
    else
      v_id := v_cur.id;
      -- An item not yet in a package goes into the one it sold in (for example when the Items
      -- Report was imported before the Auction Proceeds), unless staff chose its package
      -- themselves or it was sold on its own. An item already in a package stays there.
      v_link := not v_cur.package_locked and v_cur.package_id is null and v_pkg.id is not null
                and v_cur.buyer_contact_id is null and v_cur.sold_amount is null;
      -- a lot staff made into one item keeps the donor and value they gave it
      v_lot_item := v_cur.import_key like 'oc-lot|%';
      update public.inkind_items set
        description = coalesce(description, nullif(trim(coalesce(r ->> 'description', '')), '')),
        donor_contact_id = case when v_lot_item then donor_contact_id else coalesce(v_person, donor_contact_id) end,
        fair_market_value = case when v_lot_item then fair_market_value else coalesce(v_value, fair_market_value) end,
        package_id = case when v_link then v_pkg.id else package_id end,
        event_name = case when v_link then v_pkg.event_name else event_name end,
        sale_type = case when v_link then coalesce(v_pkg.sale_type, sale_type) else sale_type end,
        received_date = case when v_link then coalesce(nullif(r ->> 'received_date', '')::date, received_date)
                             else coalesce(received_date, nullif(r ->> 'received_date', '')::date) end,
        procurement_status = coalesce(nullif(trim(coalesce(r ->> 'procurement_status', '')), ''), procurement_status),
        package_locked = package_locked or v_reviewed,
        updated_at = now()
      where id = v_id;
      i_updated := i_updated + 1;
    end if;
    perform public.inkind_sync_gift(v_id);
  end loop;

  select count(*) - before_flags into flagged from public.possible_duplicates;
  return jsonb_build_object(
    'packages_added', p_added, 'packages_updated', p_updated, 'items_added', i_added, 'items_updated', i_updated,
    'new_people', new_people, 'matched_people', matched, 'possible_duplicates_flagged', flagged);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may run what
-- ---------------------------------------------------------------------------
revoke execute on function public.save_inkind_item(jsonb) from anon, public;
revoke execute on function public.import_onecause(jsonb, jsonb, text, text[]) from anon, public;
revoke execute on function public.inkind_items_package_rules() from anon, public;
revoke execute on function public.inkind_items_package_gift() from anon, public;
revoke execute on function public.import_contact(jsonb) from anon, public;
grant execute on function public.save_inkind_item(jsonb), public.import_onecause(jsonb, jsonb, text, text[]) to authenticated;
