-- ---------------------------------------------------------------------------
-- Volunteers (added October 2026)
--
-- Adds a "Volunteer" checkbox to each person and a log of volunteer time
-- (date, hours, activity, notes). Safe to run more than once. setup.sql
-- already includes these changes for a fresh database.
-- ---------------------------------------------------------------------------

alter table public.contacts add column if not exists is_volunteer boolean not null default false;

-- Optional dollar value of one volunteer hour, set by an admin on Settings.
-- Left blank, no dollar values are shown.
alter table public.settings add column if not exists volunteer_hour_value numeric(8, 2)
  check (volunteer_hour_value is null or volunteer_hour_value >= 0);

create table if not exists public.volunteer_hours (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  work_date date not null,
  hours numeric(6, 2) not null check (hours > 0),
  activity text not null default 'General volunteering',
  notes text,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists volunteer_hours_contact_idx on public.volunteer_hours (contact_id);
create index if not exists volunteer_hours_date_idx on public.volunteer_hours (work_date);

-- Same rule as every other donor table: only activated staff can see or change it.
alter table public.volunteer_hours enable row level security;
drop policy if exists "staff full access" on public.volunteer_hours;
create policy "staff full access" on public.volunteer_hours
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.volunteer_hours from anon;
revoke all on public.event_attendance from anon;
grant select, insert, update, delete on public.volunteer_hours to authenticated;

-- Donor summary: new columns are added at the end so nothing else changes.
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
  v.last_volunteer_date
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
) v on true;

-- Combining duplicate records keeps their volunteer time and checkbox.
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
  update public.contacts k set
    organization = coalesce(k.organization, d.organization),
    is_board_member = k.is_board_member or d.is_board_member,
    is_volunteer = k.is_volunteer or d.is_volunteer
  from public.contacts d
  where k.id = keep_id and d.id = remove_id;
end;
$$;
revoke execute on function public.prepare_merge(uuid, uuid) from anon, public;
grant execute on function public.prepare_merge(uuid, uuid) to authenticated;
