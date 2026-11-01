# Going live: Supabase + Vercel

This takes about 20 minutes. You need your Supabase, Vercel and GitHub accounts.
Nothing here costs money on the free plans; upgrade later when the business relies on it.

The app has two modes:

- **Live** (this guide): one shared online database. The owner, staff, drivers and customers
  all see the same data on any phone or computer. Logins use mobile number (or e-mail for the
  owner) and a password.
- **Demo**: runs when the Supabase keys below are not set. Data stays in one browser.

---

## 1. Create the database (Supabase)

1. Go to <https://supabase.com/dashboard> and click **New project**.
   - Name: `anmol-gas`
   - Database password: create a strong one and keep it safe (you rarely need it).
   - Region: **South Asia (Mumbai)**.
2. Wait until the project is ready, then open **SQL Editor** (left menu) → **New query**.
3. Open `supabase/migrations/0001_init.sql` from this repository, copy everything, paste it in,
   and click **Run**. You should see "Success. No rows returned".
4. New query again: paste `supabase/migrations/0002_storage_realtime.sql` and **Run**.
5. **Turn off public sign-up** (only you create logins):
   Authentication → Sign In / Providers → **Allow new users to sign up: OFF**.
   Keep the **Email** provider enabled (logins use it behind the scenes).
   Turn **Confirm email: OFF**.

## 2. Create your owner login

1. Authentication → Users → **Add user** → **Create new user**.
   Enter your e-mail and a strong password, tick **Auto Confirm User**, click **Create user**.
2. SQL Editor → New query, paste this (put in your e-mail, name and mobile), then **Run**:

   ```sql
   insert into profiles (id, name, role, phone)
   select id, 'Anmol Mehta', 'owner', '98450 11223'
   from auth.users where email = 'you@example.com';
   ```

   It should say "1 row". You can only have owners you add this way.

## 3. Copy the keys

Project Settings → **API** (or **Data API** / **API Keys**):

| What | Where it goes |
|---|---|
| Project URL (`https://xxxx.supabase.co`) | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` (**secret, never share or put in the browser**) |

## 4. Put the app online (Vercel)

1. Go to <https://vercel.com/new> → **Import** the GitHub repository `mehal45/splitbuddy`.
   (If you don't see it, click "Adjust GitHub App Permissions" and allow this repository.)
2. Framework: **Next.js** (detected automatically). Leave build settings as they are.
3. Open **Environment Variables** and add the three keys from step 3.
4. Click **Deploy**. When it finishes you get a link like `https://splitbuddy-xxxx.vercel.app`.
5. Branch: Vercel builds the repository's main branch. This work is on the branch
   `claude/charming-archimedes-l84bso`; either merge it into `main` on GitHub, or in
   Vercel → Project → Settings → Git → **Production Branch** set that branch name.

## 5. First use

1. Open your Vercel link and sign in with your owner e-mail and password.
2. **Settings**: agency GSTIN, address, cylinder prices, alert hours.
3. **Stock** → **Opening stock**: what's in the warehouse today.
4. **Trucks & drivers**: add each truck with its driver. You set the driver's first password.
5. **Warehouse staff & managers**: add staff; switch on **Manager** for those who book expenses.
6. **Customers**: add customers with any dues and cylinders they already hold. Each gets an app login.
7. Share the sign-in links:
   - Staff: `https://your-link/#staff`
   - Drivers: `https://your-link/#driver`
   - Customers: `https://your-link/#customer`
   They sign in with their **mobile number** and the password you gave them, and can change
   it from their name menu → **Change password**. If someone forgets, go to
   **Trucks & drivers → App logins → New password**. Use **Turn off** when someone leaves.

## 6. Optional

- **Your own web address** (e.g. `app.anmolgas.in`): Vercel → Project → Settings → Domains.
- **Backups**: Supabase free projects have no automatic backups you can restore yourself.
  Once the business depends on the app, move to the Supabase **Pro** plan (daily backups).
- **Phone OTP by SMS**: needs an SMS provider with Indian DLT registration (e.g. MSG91).
  Passwords work until then.

## What is checked where

- Every change (deliveries, approvals, stock, invoices, payments, expenses, orders) runs inside
  the database through checked functions in `0001_init.sql`: role, stock available, amounts,
  dates. A person can't skip the checks by editing the web page.
- Row-level security decides what each person can read. Drivers see only their truck,
  customers only their own account, only the owner sees the activity log and can delete expenses.
- Photos and receipts are in a private storage bucket, opened through links that expire.
- Creating logins and resetting passwords happens on the server (`src/app/api/people`)
  using the secret key, and only for the owner.

To re-check the database rules on any Postgres 16: see `supabase/tests/rpc_test.sql`.
