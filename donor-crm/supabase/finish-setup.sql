-- DHA Donor CRM: final setup step
-- Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
-- (Everything else was already set up. This adds the "merge two donors"
-- feature and removes public access to internal functions.)

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

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
revoke execute on function public.get_secret(text) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
grant execute on function public.is_staff(), public.is_admin(),
  public.import_donations(jsonb, text), public.merge_contacts(uuid, uuid),
  public.norm_first(text), public.first_compat(text, text), public.norm_last(text),
  public.last_compat(text, text), public.phone_digits(text), public.addr_key(text),
  public.contact_has_email(public.contacts, text), public.contact_has_phone(public.contacts, text),
  public.flag_duplicate(uuid, uuid, text)
  to authenticated;
grant execute on function public.get_secret(text) to service_role;

select 'Setup complete' as result;
