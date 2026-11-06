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
  - **Copy someone (To, Cc or Bcc):** add more people to each email, here and
    on the In-Kind tab. "Also to" and Cc addresses appear on the donor's email;
    each Bcc address gets its own separate copy the donor doesn't see. The
    donor's history shows who was copied. A copied person's bounce, spam report
    or unsubscribe never changes the donor's record.
  - Three starter templates are included: a thank-you, a Giving Day renewal
    request, and a year-end thank-you. You can edit them or save new ones.
- **Dashboard.** Shows:
  - **Needs a thank-you:** every gift not yet thanked. Tick the gifts, choose
    how they were thanked (letter, card, phone call, and so on) and the date,
    and they leave the list. The record stays on the gift, so the donor's page
    shows when and how each gift was thanked. A thank-you email sent from the
    CRM counts automatically.
  - **Renewal opportunities:** past donors who haven't given in 12 months,
    including ones with no email. **+ Record gift** on any row adds a gift
    when someone renews by check or phone.
  - **Giving by event:** totals for each event. **Total raised** counts each
    auction item once: at what it sold for, or at its market value if it
    didn't sell. Items sold together in a package count once, at the
    package's price.
- **Import.** Upload a .csv or .xlsx file and choose what's in it:
  - **Gifts or event attendees:** North Texas Giving Day exports, the
    donation website's export, any gift spreadsheet, or an attendee list.
    Several files can be uploaded at once.
  - **Volunteers and hours:** a volunteer list, with or without dates and
    hours worked.
  - **People list:** board members, contact updates, and people who asked not
    to be emailed, called, or mailed.
  - **Auction or in-kind items:** OneCause's **Auction Proceeds** and
    **Items Report** exports chosen together, or any list of donated items,
    values, and winners. The OneCause import creates the packages with their
    winning bidders, the donated items with their donors, and links each item
    to the package it sold in. Items it can't place for certain are listed for
    staff to choose before importing. Importing the same files again updates
    buyers, prices, values and donors from OneCause, and keeps what staff
    changed in the CRM (names, descriptions, events, packages, notes). The
    import is saved in small parts so no single save times out.
  - For volunteers, people, and auction items, the CRM shows which column it
    matched to each field, and staff can change any match before importing.
  - Uploading the same file twice is harmless: gifts and hours already in the
    CRM are skipped, and auction items are updated rather than added again.
  - A blank template for each kind is on the Import page.
- **In-Kind tab.** Every donated item or service: who gave it, its market
  value, what it sold for, and who bought it. Each item appears on its donor's
  record as an in-kind gift at market value; the buyer's payment appears on
  the buyer's record as an auction purchase, separate from donations.
  - **Packages:** an auction lot made of several donations is a package. The
    package holds the lot number, value, buyer, and price; each donated item
    inside it keeps its own donor and value. Donor letters name the package
    their gift was part of, and the buyer gets one receipt for the package.
  - A package OneCause lists with no market value shows **Needs a value**, and
    its receipt can't be sent until staff enter one.
  - The database enforces that a package never has a donor and an item inside
    a package never has its own buyer or price, so each sale counts once.
  - Letters for events whose IRS acknowledgment deadline has passed
    (October 15 of the following year) show a warning before sending.
  - **Email thank-you letters** sends each donor a thank-you with a link to a
    PDF acknowledgment letter on DHA letterhead for their tax records. The
    letter describes the item but, as the IRS requires, doesn't state its
    value, and it notes that donated services aren't deductible.
  - **Email buyer receipts** sends each winning bidder a PDF receipt showing
    the amount paid, the item's fair market value, and the part that may be
    deductible.
  - **Download letters to print** makes the same PDFs for donors without an
    email address.
- **Do not email, call, or mail.** Three separate boxes on each person's
  record. Ticking one asks how they asked (phone, in person, mail, and so on)
  and keeps a dated history. Anyone who clicks **Unsubscribe** in an email is
  opted out automatically.
- **Unsubscribed tab.** Everyone who opted out of anything, with their phone
  number, giving history, and call notes, for reactivation calls.
  **Resubscribe** puts someone back on the list and requires a note saying
  how they agreed.
- **Download for Excel.** Downloads the donor list (all donors, a filtered
  list, or only the ones you've ticked) as a spreadsheet.
- **Add, edit, or delete** donors and gifts.
- **Volunteers.** Tick **Volunteer** on anyone's record (or click **+ Add
  volunteer** on the Donors page) to log the time they give: date, hours,
  activity, and notes. Their page shows total hours and hours this year, and
  the Donors page can show only volunteers and download their time log for
  Excel. Volunteers are tracked like donors; they get no access to the CRM.
  An admin can set what one volunteer hour is worth under **Settings →
  Volunteer time** to show a dollar value for grant reports.

## Who can see it

Only DHA staff who have been activated can see any donor information.

- The first person to sign up becomes the admin.
- Everyone after that waits on the **Settings** page until the admin activates
  them.
- Board members and the public cannot see anything.
- The email service's key is stored where the website can't read it.

## One-time setup

The database (Supabase project **DHA-CRM**) is already set up. It holds all
379 gifts from the 2018 to 2022 Giving Day reports and the email-sending
function. Four steps remain.

### Step 1: Run the finishing script (2 minutes)

1. Open [supabase.com](https://supabase.com/dashboard), open the **DHA-CRM**
   project, and click **SQL Editor** in the left sidebar, then **New query**.
2. Open the file `donor-crm/supabase/finish-setup.sql` in this repository.
   Select all of its text, copy it, paste it into the editor, and click
   **Run**. You should see "Setup complete." This turns on the "Same person —
   keep this one" button on the Possible Duplicates page and removes public
   access to internal functions.

### Step 2: Let SMTP2GO send as dentalhealtharlington.org (one time)

Emails are sent through AIM's SMTP2GO account. For emails to arrive "From"
`info@dentalhealtharlington.org`, the DHA domain has to be verified there:

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
3. Open **Environment Variables** and add these two exactly as shown:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://hriclsxzlnekbvuvycba.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyaWNsc3h6bG5la2J2dXZ5Y2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MDk3MTUsImV4cCI6MjEwNjQ4NTcxNX0.1ETtPldtBCbd7CHMIDXcaYYXyoS8N8AplgHUQzCO52w` |

   (This key is designed to be public. On its own it can't read any donor
   information; only activated staff who sign in can.)

4. Click **Deploy**. Vercel gives you the web address for the CRM.
5. Back in Supabase (DHA-CRM project), go to **Authentication → URL
   Configuration** and set **Site URL** to that web address, so sign-up
   confirmation emails link back to the CRM.

### Step 4: Create your admin account and invite staff

1. Open the CRM's web address, click **Create an account**, confirm your
   email, and sign in. As the first person, you're the admin.
2. Send the address to DHA staff. After they sign up, open **Settings** and
   click **Pending** next to their name to activate them.
3. Open **Email**, choose the "Thank you for your gift" template, add yourself
   or one donor, and click **Send a test to me** to confirm emails arrive.

## Day to day

- **After each Giving Day**, download the donation report from the North Texas
  Giving Day site and upload it on **Import**. New donors are added, returning
  donors get the new gift, and nothing is entered twice.
- **Thank-yous:** open the Dashboard. Click **Email thank-yous** to send them
  from the CRM, or, after mailing letters or calling, tick those gifts under
  **Needs a thank-you** and click **Mark thanked**.
- **Renewals:** before the next Giving Day, use **Email renewal request** on the
  Dashboard. You can also filter the Donors page, for example to "Gave in 2022"
  plus "No gift since 2023," tick the donors, and click **Email selected**.
- **Someone asks to stop receiving emails, calls, or mail:** open their record
  and tick the box under **Contact preferences**. Choose how they asked and
  click **Save**. Emails skip them from then on.
- **After an auction:** in OneCause, export **Auction Proceeds** and **Items
  Report** as CSV. On **Import**, choose **Auction or in-kind items** and pick
  both files at once. Name the event, check any items it asks about, and
  import. Then open **In-Kind**, add a value to any package marked **Needs a
  value**, tick the items, and click **Email thank-you letters** and **Email
  buyer receipts**.
- **One-off gifts by check or cash:** open the donor (or click **+ Add
  donor**), then click **+ Record a gift**.
- **Volunteer time:** open the volunteer (or click **+ Add volunteer**), then
  click **+ Log volunteer time**. For a grant report, set **Show** to
  **Volunteers** on the Donors page and click **Download shown volunteers'
  time log**.

## Coming in phase 2

Importing directly from the donation software, so new gifts appear without
uploading a spreadsheet.

## Rebuilding the database from scratch (only if ever needed)

1. In a new Supabase project, run `donor-crm/supabase/setup.sql`, then
   `donor-crm/supabase/finish-setup.sql`, then
   `donor-crm/supabase/add-thankyous-optouts-inkind.sql`, then
   `donor-crm/supabase/add-auction-packages.sql`, then
   `donor-crm/supabase/add-email-copies.sql` in the SQL Editor.
2. Deploy the two functions in `donor-crm/supabase/functions` with the
   Supabase CLI (`supabase functions deploy send-email` and
   `supabase functions deploy email-events --no-verify-jwt`). Both use the
   shared file in `functions/_shared`.
3. In the SQL Editor, store the SMTP2GO API key (SMTP2GO → **Sending → API
   Keys**):

   ```sql
   insert into private.secrets (name, value) values ('smtp2go_api_key', 'PASTE-KEY-HERE')
   on conflict (name) do update set value = excluded.value;
   ```

4. Sign in to the CRM and upload the Giving Day files on the **Import** page.

## Database changes added later

- **Volunteers (October 2026):** `donor-crm/supabase/add-volunteers.sql` adds the
  Volunteer checkbox and the volunteer time log to the existing database. It
  is safe to run more than once. A fresh database built from `setup.sql`
  already includes it.
- **Thank-yous, contact preferences, and in-kind items (November 2026):**
  `donor-crm/supabase/add-thankyous-optouts-inkind.sql` adds thank-you
  tracking on each gift, the Do not call and Do not mail boxes with their
  history, call notes, the In-Kind tab, the PDF letters, and the volunteer,
  people, and auction imports. It is safe to run more than once. Run it after
  `setup.sql` and `finish-setup.sql` when building a fresh database.
- **Auction packages and OneCause import (November 2026):**
  `donor-crm/supabase/add-auction-packages.sql` adds auction packages, links
  donated items to the package they sold in, and adds the two-report OneCause
  import. It is safe to run more than once. Run it after
  `add-thankyous-optouts-inkind.sql`.
- **Copying people on emails (November 2026):**
  `donor-crm/supabase/add-email-copies.sql` adds the columns that record who
  was copied (also to, Cc, Bcc) on each sent email. It is safe to run more
  than once. The `send-email` and `email-events` functions were updated at the
  same time.
