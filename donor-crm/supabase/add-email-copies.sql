-- =============================================================================
-- DHA Donor CRM: copying people on outgoing emails (November 2026)
--
-- Run once in the Supabase SQL Editor before merging the matching update.
-- It is safe to run more than once.
--
-- Staff can now add more "To" recipients, Cc and Bcc addresses when they send
-- an email from the Email page or the In-Kind tab. These columns record who was
-- copied, so the donor's email history and the Sent Emails page show it.
-- =============================================================================

alter table public.email_log add column if not exists also_to text[];
alter table public.email_log add column if not exists cc text[];
alter table public.email_log add column if not exists bcc text[];

-- let the CRM see the new columns right away
notify pgrst, 'reload schema';
