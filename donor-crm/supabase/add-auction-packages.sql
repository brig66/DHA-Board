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
--     together. Importing the same files again updates instead of duplicating.
-- =============================================================================

alter table public.inkind_items add column if not exists is_package boolean not null default false;
alter table public.inkind_items add column if not exists package_id uuid references public.inkind_items (id) on delete set null;
alter table public.inkind_items add column if not exists procurement_status text;
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
      notes, source, is_package, package_id)
    values (v_event, nullif(trim(coalesce(p ->> 'item_number', '')), ''), v_title,
      nullif(trim(coalesce(p ->> 'description', '')), ''), v_sale, coalesce((p ->> 'is_service')::boolean, false),
      v_donor, nullif(p ->> 'fair_market_value', '')::numeric,
      nullif(p ->> 'received_date', '')::date,
      case when v_package is null then nullif(p ->> 'buyer_contact_id', '')::uuid end,
      case when v_package is null then nullif(trim(coalesce(p ->> 'bidder_number', '')), '') end,
      case when v_package is null then nullif(p ->> 'sold_amount', '')::numeric end,
      case when v_package is null then nullif(p ->> 'sold_date', '')::date end,
      nullif(trim(coalesce(p ->> 'notes', '')), ''), 'Entered by staff', v_is_package, v_package)
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
-- OneCause import: packages (Auction Proceeds) and donated items (Items Report)
-- ---------------------------------------------------------------------------
create or replace function public.import_onecause(packages jsonb, items jsonb, source_label text default 'OneCause')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_id uuid;
  v_pkg uuid;
  v_person uuid;
  v_created boolean;
  v_sale text;
  v_title text;
  p_added int := 0; p_updated int := 0; i_added int := 0; i_updated int := 0;
  new_people int := 0; matched int := 0; flagged int := 0;
  before_flags int;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  select count(*) into before_flags from public.possible_duplicates;

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

    select id into v_id from public.inkind_items where import_key = r ->> 'key';
    if v_id is null then
      insert into public.inkind_items (event_name, item_number, title, description, sale_type, is_package,
        fair_market_value, buyer_contact_id, bidder_number, sold_amount, sold_date, notes, source, import_key)
      values (coalesce(nullif(trim(coalesce(r ->> 'event_name', '')), ''), 'In-kind donation'),
        nullif(trim(coalesce(r ->> 'item_number', '')), ''), v_title, nullif(trim(coalesce(r ->> 'description', '')), ''),
        v_sale, true, nullif(r ->> 'fair_market_value', '')::numeric, v_person,
        nullif(trim(coalesce(r ->> 'bidder_number', '')), ''), nullif(r ->> 'sold_amount', '')::numeric,
        nullif(r ->> 'sold_date', '')::date, nullif(trim(coalesce(r ->> 'notes', '')), ''), source_label, r ->> 'key')
      returning id into v_id;
      p_added := p_added + 1;
    else
      update public.inkind_items set
        event_name = coalesce(nullif(trim(coalesce(r ->> 'event_name', '')), ''), event_name),
        item_number = coalesce(nullif(trim(coalesce(r ->> 'item_number', '')), ''), item_number),
        title = v_title,
        sale_type = coalesce(v_sale, sale_type),
        is_package = true,
        package_id = null,
        fair_market_value = coalesce(nullif(r ->> 'fair_market_value', '')::numeric, fair_market_value),
        buyer_contact_id = coalesce(v_person, buyer_contact_id),
        bidder_number = coalesce(nullif(trim(coalesce(r ->> 'bidder_number', '')), ''), bidder_number),
        sold_amount = coalesce(nullif(r ->> 'sold_amount', '')::numeric, sold_amount),
        sold_date = coalesce(nullif(r ->> 'sold_date', '')::date, sold_date),
        -- Staff notes are never replaced by a repeat import; OneCause's notes only fill an empty box.
        notes = coalesce(notes, nullif(trim(coalesce(r ->> 'notes', '')), '')),
        updated_at = now()
      where id = v_id;
      p_updated := p_updated + 1;
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
    if coalesce(r ->> 'package_key', '') <> '' then
      select id into v_pkg from public.inkind_items where import_key = r ->> 'package_key' and is_package;
    end if;

    select id into v_id from public.inkind_items where import_key = r ->> 'key';
    if v_id is null then
      insert into public.inkind_items (event_name, title, description, sale_type, donor_contact_id, fair_market_value,
        received_date, package_id, procurement_status, notes, source, import_key)
      values (coalesce(nullif(trim(coalesce(r ->> 'event_name', '')), ''), 'In-kind donation'), v_title,
        nullif(trim(coalesce(r ->> 'description', '')), ''),
        (select sale_type from public.inkind_items where id = v_pkg),
        v_person, nullif(r ->> 'fair_market_value', '')::numeric, nullif(r ->> 'received_date', '')::date, v_pkg,
        nullif(trim(coalesce(r ->> 'procurement_status', '')), ''), nullif(trim(coalesce(r ->> 'notes', '')), ''),
        source_label, r ->> 'key')
      returning id into v_id;
      i_added := i_added + 1;
    else
      update public.inkind_items set
        event_name = coalesce(nullif(trim(coalesce(r ->> 'event_name', '')), ''), event_name),
        title = v_title,
        description = coalesce(nullif(trim(coalesce(r ->> 'description', '')), ''), description),
        donor_contact_id = coalesce(v_person, donor_contact_id),
        fair_market_value = coalesce(nullif(r ->> 'fair_market_value', '')::numeric, fair_market_value),
        received_date = coalesce(nullif(r ->> 'received_date', '')::date, received_date),
        package_id = case when is_package then null else coalesce(v_pkg, package_id) end,
        sale_type = coalesce((select sale_type from public.inkind_items where id = v_pkg), sale_type),
        procurement_status = coalesce(nullif(trim(coalesce(r ->> 'procurement_status', '')), ''), procurement_status),
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
revoke execute on function public.import_onecause(jsonb, jsonb, text) from anon, public;
grant execute on function public.save_inkind_item(jsonb), public.import_onecause(jsonb, jsonb, text) to authenticated;
