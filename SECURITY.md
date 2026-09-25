# Security: Anmol Gas Agency demo

This app is a **demo**. It has no server: all data, logins and rules run inside the viewer's browser. That limits how secure it can be. This file separates three things: what the demo already protects, what a browser-only app can never protect, and what the real system must do.

## 1. The one limit that matters

Anyone who opens the browser's developer tools can read and change everything this demo stores (localStorage), including sessions, balances and the activity log. The PIN, OTP, role checks and attempt limits here are **speed bumps and a working prototype of the real flows**. They are not protection against a determined person with access to the device.

So: **don't put real customer data, real money figures or real phone numbers into the demo.** Real security needs the server-side controls in section 4.

## 2. What the demo already does

| Area | Protection |
|---|---|
| Login separation | Owner page (`/`) is PIN protected. Staff, drivers and customers each have their own page (`#staff`, `#driver`, `#customer`) and can only sign in with a registered mobile number. |
| Guessing | 5 wrong PINs or unknown numbers lock the form for 30 s, doubling each time up to 15 min. OTP resend is limited to 3. |
| PIN hygiene | The PIN hint is shown only while the default demo PIN is in use. The Settings field is masked. Obvious PINs (0000, 1111, 0123…) are refused. The PIN is never written to the activity log. |
| Sessions | "Keep me signed in" (default on) lasts 30 days. Unticked, the login lasts until the tab closes, at most 12 hours. Sessions without a valid expiry, or pointing to a deleted user, are ignored. |
| Roles | Every page declares which roles may open it. Drivers only see their own truck and deliveries, and customers only their own data (checked again on invoices). Only a real owner can use "View as". |
| One person, one number | A phone number can belong to only one login. Editing a customer's phone updates their login too (this was a bug, now fixed). |
| Input checks | Every form validates its fields (GSTIN format and state code, 10-digit mobile, length limits, amount limits, whole-number quantities). Stock and money writes (load sheets, deliveries, end-of-day counts, plant receipts, payments, stock state changes) are checked again in the business engine, so a bad value can't be saved even if a form is bypassed. Examples: stock can't go below zero, payments must be ₹1 to ₹1 crore, and a driver can't record more cash than the bill plus dues. |
| Photos | Only real image files are accepted (JPG/PNG/WebP, max 25 MB, re-encoded and shrunk). Anything else stored as a "photo" is never rendered. |
| Activity log | Sign-ins, failed sign-ins, "view as", deliveries, approvals, rejections, load sheets, counts, receipts, payments, stock changes, customer edits, settings changes, Tally syncs and resets are recorded with who and when. The owner sees a failed-sign-in warning. Export to CSV is available. |
| CSV exports | Text starting with `= + - @` is prefixed with `'` so Excel can't run it as a formula (CSV injection). |
| Crash safety | Damaged or tampered saved data is detected and replaced with fresh sample data. A screen error shows a recovery screen instead of a blank page. |
| Web security headers (Vercel) | `vercel.json` sends a Content-Security-Policy (only this site's code, Google Fonts, no framing, no plugins), HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and a Permissions-Policy that allows camera and location only for this site. The automated tests run under these same headers. |
| XSS | React escapes all text. No user text is ever inserted as HTML. The only inline script is a fixed theme snippet. |
| Dependencies | `npm audit`: 0 known vulnerabilities at the time of writing. |

Automated checks (`npm run test:e2e`) try these attacks on every run: wrong PIN, lockout after 5 tries, unknown and malformed numbers, a forged session, a driver opening staff pages, a customer opening another customer's invoice, formula injection through a customer name, a duplicate phone number, and corrupted saved data.

## 3. Known gaps in the demo (by design)

- Data, sessions and the activity log can be edited in the browser (see section 1).
- OTP is simulated: no SMS is sent and any 4 digits work.
- The Content-Security-Policy allows inline scripts, which the static Next.js build needs. The real app should use nonces.
- "Reset demo data" wipes the activity log. The real system must not allow this.
- The preview link on claude.ai ignores `vercel.json` headers; only the Vercel deployment sends them.

## 4. Checklist for the real system

**Identity and access**
- [ ] Server-side authentication. OTP via an Indian SMS provider (e.g. MSG91), 6 digits, 5-minute expiry, single use, rate-limited per number and per IP.
- [ ] Owner and staff: OTP plus a second factor (authenticator app or passkey). No shared PINs.
- [ ] Sessions as `HttpOnly; Secure; SameSite=Strict` cookies, rotated at login, revocable. Log out everywhere. Idle timeout for staff screens.
- [ ] Every API call checks the role and the ownership of the record on the server (a driver's own truck, a customer's own invoices). Never trust the screen.
- [ ] Generic login responses ("if this number is registered we sent a code") to prevent account discovery.

**Data**
- [ ] Postgres with row-level security per role. Encrypted at rest. Daily backups tested by restoring.
- [ ] Money as integer paise. Invoice numbers issued by the database in sequence, never reused. Invoices immutable once issued: corrections via credit notes.
- [ ] Append-only audit log on the server (no update or delete for anyone, including the owner). Exported to separate storage.
- [ ] Photos in private object storage with short-lived signed URLs. Strip EXIF except time and GPS.
- [ ] Validation on the server with the same rules as `src/lib/validate.ts` and the engine guards.

**Operations**
- [ ] HTTPS only. Keep the security headers with a nonce-based CSP.
- [ ] Web application firewall and rate limits on all APIs.
- [ ] Alerts to the owner on: failed sign-in spikes, settings changes, credit limit changes, large payments, approvals outside working hours.
- [ ] Dependency and secret scanning in CI (Dependabot, `npm audit`, secret scanning).
- [ ] Tally connector: a signed, per-device API key, HTTPS only, least privilege (read vouchers only), key rotation.
- [ ] Privacy: follow India's DPDP Act 2023 for customer data (consent, purpose limits, deletion on request).
- [ ] External penetration test before go-live, and again after major changes.
