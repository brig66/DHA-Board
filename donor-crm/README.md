# DHA Donor CRM

A private web app where Dental Health Arlington staff can see every donor in one
place, record gifts, spot renewal and thank-you opportunities, and email donors
directly. Each email goes out individually and is saved on the donor's record.

This app is separate from the DHA Board Portal. It has its own web address,
its own sign-ins, and its own database.

## What it does

- **One record per donor.** Duplicate entries from the Giving Day reports are
  combined automatically:
  - Records with the same email and first name are combined.
  - Records with the same name plus a matching phone number or street address
    are combined, even when the email changed.
  - The newest address, email, and phone are shown first. Older ones are kept
    as "other emails" and "other phones."
  - Cases the CRM isn't sure about go to the **Possible Duplicates** page.
    There, staff click **Same person** or **Different people**. For example, a
    couple who share one email address would be "different people."
- **Every gift, with its event.** Shows the amount, date, event (for example,
  "NTX Giving Day 2021"), payment method, and fundraiser page. Totals, first
  gift, and last gift are calculated automatically.
- **Sorting and filtering.** Sort by name, email, address, phone, total given,
  or last gift. Filter by event, by year given, by "no gift since…", or by
  "only donors we can email."
- **Email from the CRM.**
  - Pick donors, choose a template, and press Send. Each donor gets a personal
    copy with their name, last gift amount, event, and lifetime total filled in.
  - **Send a test to me** shows exactly what donors will receive.
  - Three starter templates are included: a thank-you, a Giving Day renewal
    request, and a year-end thank-you. You can edit them or save new ones.
- **Dashboard.** Shows:
  - **Needs a thank-you:** recent donors who haven't been emailed since giving.
  - **Renewal opportunities:** past donors who haven't given in 12 months.
  - **Giving by event:** totals for each event.
- **Import.** Upload North Texas Giving Day exports, or any spreadsheet with
  columns like First Name, Last Name, Email, Amount, and Date (.csv or .xlsx).
  - Several files can be uploaded at once.
  - Gifts already in the CRM are skipped, so uploading the same file twice is
    harmless.
  - A blank template is available on the Import page.
- **Download for Excel.** Downloads the donor list (all donors, a filtered
  list, or only the ones you've ticked) as a spreadsheet.
- **Add, edit, or delete** donors and gifts, and mark anyone **Do not email**.

## Who can see it

Only DHA staff who have been activated can see any donor information.

- The first person to sign up becomes the admin.
- Everyone after that waits on the **Settings** page until the admin activates
  them.
- Board members and the public cannot see anything.
- The email service's key is stored where the website can't read it.

## One-time setup

### Step 1: Database (Supabase)

1. Sign in at [supabase.com](https://supabase.com) and click **New project**.
2. Name it `dha-crm` and pick the US East region. Save the database password
   somewhere safe.
3. Once the project is ready, tell Claude "the dha-crm project is created."
   Claude will finish the database setup, turn on email sending, and load the
   donors from the Giving Day files.

If you'd rather do it yourself, see **Manual database setup** at the bottom
of this guide.

### Step 2: Let SMTP2GO send as dentalhealtharlington.org (one time)

Emails are sent through SMTP2GO, the same service AIM already uses. For emails
to arrive "From" `info@dentalhealtharlington.org`, the DHA domain has to be
verified there:

1. In [SMTP2GO](https://app.smtp2go.com), open **Sending → Verified Senders →
   Add Sender Domain**, and enter `dentalhealtharlington.org`.
2. SMTP2GO shows three DNS records (CNAMEs). Add them wherever DHA's domain is
   managed (GoDaddy, Cloudflare, etc.), then click **Verify** in SMTP2GO.

To use a different "From" address, change it in the CRM under **Settings →
Email sending**.

### Step 3: Put the website online (Vercel, free)

1. Go to [vercel.com](https://vercel.com). Sign in with GitHub, then choose
   **Add New… → Project** and select the `dha-board` repository.
2. Next to **Root Directory**, click **Edit** and choose `donor-crm`.
3. Open **Environment Variables** and add these two. The values are in
   Supabase under **Project Settings → API**.

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` `public` key |

4. Click **Deploy**. Vercel gives you the web address for the CRM.
5. In Supabase, go to **Authentication → URL Configuration** and set **Site
   URL** to that web address. This makes the sign-up confirmation emails link
   back to the CRM.

### Step 4: Create your admin account and invite staff

1. Open the CRM's web address, click **Create an account**, confirm your
   email, and sign in. As the first person, you're the admin.
2. Send the address to DHA staff. After they sign up, open **Settings** and
   click **Pending** next to their name to activate them.

### Step 5: Load the donor history (skip if Claude already did)

Open **Import**, click **Choose file(s)**, and select all five
`crm_20XX_ntx_giving_day.csv` files. Then click **Import**. The result should
be:

- 379 gifts
- 203 donors, plus one combined "Anonymous Donors" record
- 8 pairs on the **Possible Duplicates** page to review

## Day to day

- **After each Giving Day**, download the donation report from the North Texas
  Giving Day site and upload it on **Import**. New donors are added, returning
  donors get the new gift, and nothing is entered twice.
- **Thank-yous:** open the Dashboard and click **Email thank-yous**. Check the
  preview and send.
- **Renewals:** before the next Giving Day, use **Email renewal request** on the
  Dashboard. You can also filter the Donors page, for example to "Gave in 2022"
  plus "No gift since 2023," tick the donors, and click **Email selected**.
- **Someone asks to stop receiving emails:** open their record, click **Edit
  details**, and tick **Do not email**. They'll be skipped from then on.
- **One-off gifts by check or cash:** open the donor (or click **+ Add
  donor**), then click **+ Record a gift**.

## Coming in phase 2

Importing directly from the donation software, so new gifts appear without
uploading a spreadsheet.

## Manual database setup (only if not done by Claude)

1. In Supabase, open **SQL Editor → New query**. Paste the whole contents of
   `donor-crm/supabase/setup.sql` and click **Run**.
2. Open **Edge Functions → Deploy a new function → Via Editor**. Name it
   `send-email`, paste the contents of
   `donor-crm/supabase/functions/send-email/index.ts`, and click **Deploy**.
3. Back in **SQL Editor**, run this line with the real SMTP2GO API key
   (SMTP2GO → **Sending → API Keys**):

   ```sql
   insert into private.secrets (name, value) values ('smtp2go_api_key', 'PASTE-KEY-HERE')
   on conflict (name) do update set value = excluded.value;
   ```
