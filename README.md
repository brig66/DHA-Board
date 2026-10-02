# DHA Board Portal

A private web app for Dental Health Arlington's board: staff upload monthly
reports into a meeting "packet," board members review them and leave comments
pinned to the exact spot on the page, and the board president can see who
reviewed what before each meeting.

Nothing below requires editing any code. It's a sequence of sign-ups and
copy/paste steps in two other companies' websites (Supabase and Vercel), both
free for a board this size.

## What you'll end up with

- A private web address (like `dha-board.vercel.app`) that only people you
  activate can sign into.
- Everyone signs in with their own email and password.
- The first person to sign up automatically becomes the admin (that should be
  you). Everyone else starts "pending" until you activate them and choose
  their role, from the **Utilization & Access** page.
- Two roles beyond admin: **Staff** (can create meetings and upload reports)
  and **Board member** (can view packets and comment).

## One-time setup (about 15 minutes)

### Step 1 — Create a free Supabase account and project

Supabase is the database and login system behind the app. Use a DHA email for
this account (not a personal or agency one), since it will hold board
documents and comments.

1. Go to [supabase.com](https://supabase.com) and sign up (free plan).
2. Click **New project**. Name it `dha-board`, choose a database password
   (save it somewhere safe — you likely won't need it again), and pick a
   region close to Arlington, TX (e.g. US East).
3. Wait a minute or two for the project to finish setting up.

### Step 2 — Run the database setup script

1. In your new Supabase project, click **SQL Editor** in the left sidebar,
   then **New query**.
2. Open the file `supabase/migrations/0001_init.sql` in this repository,
   select all of its text, and copy it.
3. Paste it into the SQL Editor and click **Run**. You should see
   "Success. No rows returned." This creates everything the app needs:
   tables, security rules, and the file storage area for uploaded reports.

### Step 3 — Get your project's connection details

1. In Supabase, click the gear icon **Project Settings**, then **API**.
2. Copy the **Project URL** (looks like `https://xxxxx.supabase.co`).
3. Copy the **anon public** key (a long string of letters and numbers).
   You'll paste both into Vercel in the next step.

### Step 4 — Deploy the app on Vercel (free)

1. Go to [vercel.com](https://vercel.com) and sign up, choosing **Continue
   with GitHub** and authorizing access to your GitHub account.
2. Click **Add New… → Project**, and select the `dha-board` repository.
3. Before clicking Deploy, open **Environment Variables** and add these
   three (paste the values you copied from Supabase in Step 3):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL from Step 3 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key from Step 3 |
   | `NEXT_PUBLIC_ORG_NAME` | `Dental Health Arlington` |

4. Click **Deploy**. After a minute, Vercel gives you a live web address.

### Step 5 — Create your admin account

1. Open the web address Vercel gave you and click **Create an account**.
2. Sign up with your own name, email, and a password. Because you're the
   very first person to sign up, you're automatically made an active admin —
   no waiting.
3. Sign in. You'll land on the **Meetings** page with a **Utilization &
   Access** tab visible (only admins see that tab).

### Step 6 — Invite your staff and board members

1. Send everyone the web address from Step 4 and ask them to click **Create
   an account**.
2. After each person signs up, go to **Utilization & Access** in the app,
   find their name, set their **Role** (Staff or Board member), and click
   their status pill to switch it from **Pending** to **Active**. They can
   then sign in and see meeting materials.

## Using the app day to day

- **Staff**: on the Meetings page, click **+ New meeting**, give it a title
  and date, then open it and use **Upload a report** to add each document
  (PDF, Word, Excel, or image files all work).
- **Board members**: open a meeting, click a document to open it. On PDFs
  and images, click **+ Add pinned comment**, then click the exact spot on
  the page you want to comment on. Replies show up as a thread under each
  comment. Word and Excel files don't yet support pinned comments — you can
  download them and leave a general comment instead.
- **You (admin)**: the **Utilization & Access** page shows, for each recent
  meeting, how many of a board member's documents they've opened
  (e.g. "3/4"), so you can see who came prepared. The same page is where you
  activate new sign-ups and change anyone's role.

## Known limitations (v1)

- "Came prepared" tracking is based on whether someone *opened* a document,
  not how long they read it or whether they read every page.
- Word and Excel documents can be uploaded and commented on as a whole, but
  don't yet support in-page previews or pinned, page-specific comments the
  way PDFs and images do.
- There's no email notification yet when a new report is uploaded or a
  comment is left — board members need to check the site themselves.
- Deleting a meeting or document isn't yet available from the interface
  (only staff/admins can currently add them); let your developer know if
  you need removal.

If you want any of these addressed, or want features like email digests,
agendas, or e-signatures for meeting minutes, that's a natural next phase.

## Donor CRM

The `donor-crm` folder holds a separate app: the DHA Donor CRM, for tracking
donors, gifts, and thank-you and renewal emails. It has its own database and
web address. Setup steps are in [`donor-crm/README.md`](donor-crm/README.md).
