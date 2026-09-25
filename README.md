# Anmol Gas Agency – LPG distribution demo

Clickable demo for a Bharat Gas distributor in Bangalore: stock by size and state, load sheets, driver deliveries with photo + GPS, approvals, end-of-day truck reconciliation, GST invoices, Tally sync (mock), reports and a customer portal.

**Demo only.** There is no backend, no AI and no paid service. All data is sample data kept in the browser's localStorage, so anything you do survives a refresh. **Settings → Reset demo data** rebuilds a fresh 60-day history that ends today.

Built with Next.js (App Router), TypeScript, Tailwind CSS v4, shadcn/ui (Radix) and Recharts.

## Logins

Each group has its own login address:

| Address | Who | How they sign in |
|---|---|---|
| `/` (main page) | Owner | 4-digit PIN (demo: **1234**, change it in Settings). After the PIN, the owner can open the app as any role. |
| `/#staff` | Warehouse staff | Mobile number + OTP |
| `/#driver` | Drivers | Mobile number + OTP (mobile-first screen) |
| `/#customer` | Customers | Mobile number + OTP |

OTP is simulated: no SMS is sent and any 4 digits work. Each login page lists a few demo numbers you can tap to fill. "Keep me signed in" is ticked by default. Untick it on shared devices and the login lasts only until the browser tab closes. After the PIN, the owner page shows these links with copy buttons.

## Look (new style / classic)

The app ships with two looks. The **new style** (default) has a black top bar, soft grey cards, lime and coral accents and the Urbanist font. The **classic style** is the original blue design. Switch in the sun/moon menu (top right) or in **Settings → Look**. The choice is saved per device. In code, the pre-restyle version is tagged `v1-classic-theme`.

## Run locally

Needs Node.js 20 or newer (https://nodejs.org).

```bash
npm install
npm run dev
```

Open http://localhost:3000. To test the driver screen on a phone, open `http://<your-computer-ip>:3000` on the same Wi-Fi. The browser only allows camera and GPS on `https` or `localhost`; otherwise the app uses the gallery picker and a mock GPS point.

Production build (static files in `out/`):

```bash
npm run build
npx serve out
```

## Deploy free on Vercel

1. Push this repository to GitHub (already done if you are reading this there).
2. Go to https://vercel.com, sign up with GitHub (the Hobby plan is free).
3. Click **Add New… → Project**, pick this repository and click **Import**.
4. Keep the defaults (Framework preset: Next.js). Click **Deploy**.
5. After about a minute you get a link like `https://anmol-gas-demo.vercel.app`. It works on phones too, with real camera and GPS because it is https.

Every push to the branch redeploys automatically. Each visitor gets their own copy of the demo data in their browser.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Static export to `out/` |
| `npm run lint` | ESLint |
| `npm run check:data` | Builds the mock data at several times of day and prints stock and alert checks |
| `npm run test:e2e` | After a build: clicks through driver → approval → load sheet → end of day → Tally → reports → reset |
| `npm run preview:relative` | After a build: copies `out/` to `preview/` with relative asset paths (host under any sub-path) |

## Where things are

- `src/lib/types.ts`: data model (sizes, states, locations, movements, deliveries, invoices…)
- `src/lib/engine.ts`: business rules (load sheet, delivery, approve or reject, reconcile, purchase, GST)
- `src/lib/seed.ts`: 60-day Bangalore demo data (12 trucks and drivers, 40 customers, every alert present)
- `src/lib/selectors.ts`: balances, alerts, dashboard numbers
- `src/lib/store.tsx`: localStorage persistence and roles
- `src/views/*`: screens

Routing uses the URL hash (`/#/approvals`) inside a single App Router page. That keeps the whole app one static bundle that runs the same on Vercel or any static host.

## Notes for the real version

- Replace localStorage with a database (for example Postgres) and real logins with OTP.
- Tally: a small program on the office PC reads vouchers from TallyPrime (XML/ODBC) and posts them to the server on a schedule.
- Photos go to object storage; GPS and timestamps are captured on the phone the same way as here.
