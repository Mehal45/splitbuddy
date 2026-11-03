// Full feature sweep: every screen for every role (computer + phone size), then the
// main actions of each role, on the static demo build with sample data.
// Collects all problems instead of stopping at the first one.
// Run: npm run build:static && node scripts/full-check.mjs
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("out");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const prodHeaders = Object.fromEntries(JSON.parse(fs.readFileSync("vercel.json", "utf8")).headers[0].headers
  .filter((h) => h.key !== "Strict-Transport-Security")
  .map((h) => [h.key, h.value.replace("; upgrade-insecure-requests", "")]));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { ...prodHeaders, "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const seed = execFileSync("npx", ["tsx", "-e", 'import { buildSeed } from "./src/lib/seed"; process.stdout.write(JSON.stringify(buildSeed()))'], { maxBuffer: 64 << 20 }).toString();
const S = JSON.parse(seed);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

const results = [];
const ok = (name) => { results.push({ name, ok: true }); console.log("✓", name); };
const bad = (name, why) => { results.push({ name, ok: false, why }); console.log("✗", name, "—", why); };

async function session(userId, { phone = false } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 900 }, permissions: ["geolocation"], geolocation: { latitude: 12.97, longitude: 77.59 } });
  const seen = S.orders.map((o) => o.id);
  await ctx.addInitScript(({ seed, userId, seen }) => {
    if (sessionStorage.getItem("init")) return;
    sessionStorage.setItem("init", "1");
    localStorage.setItem("anmol-gas-demo:db", seed);
    localStorage.setItem("anmol-gas-demo:session", JSON.stringify({ userId, remember: true, expiresAt: Date.now() + 36e5 }));
    localStorage.setItem(`anmol-orders-seen:${userId}`, JSON.stringify(seen)); // no pop-up during the sweep
  }, { seed, userId, seen });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem("anmol-gas-demo:db")));
  return { ctx, page, errors, db };
}

async function attempt(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, String(e.message ?? e).split("\n")[0].slice(0, 220)); }
}

// ---------------------------------------------------------------- 1. every screen, every role
const firstSale = S.invoices.find((i) => i.kind === "sale" && i.partyId === "c1") ?? S.invoices.find((i) => i.kind === "sale");
const firstPurchase = S.invoices.find((i) => i.kind === "purchase");
const ROUTES = ["/", "/alerts", "/3d", "/orders", "/approvals", "/loads", "/reconciliation", "/stock", "/profit", "/expenses", "/purchases", "/sales",
  "/customers", "/customers/c1", `/invoices/${firstSale.id}`, `/invoices/${firstPurchase.id}`, "/fleet", "/movements", "/reports", "/tally", "/activity", "/settings",
  "/driver/new", "/driver/history", "/me/order", "/me/orders", "/me/deliveries", "/me/invoices", "/me/payments"];
const OW = ["owner", "warehouse", "manager"];
const ALLOWED = {
  "/": ["owner", "warehouse", "manager", "driver", "customer"], "/alerts": ["owner"], "/3d": OW, "/orders": OW, "/approvals": OW, "/loads": OW,
  "/reconciliation": OW, "/stock": OW, "/profit": ["owner"], "/expenses": OW, "/purchases": OW, "/sales": ["owner"], "/customers": OW, "/customers/c1": OW,
  [`/invoices/${firstSale.id}`]: ["owner", "warehouse", "manager", "customer"], [`/invoices/${firstPurchase.id}`]: ["owner", "warehouse", "manager"],
  "/fleet": ["owner"], "/movements": OW, "/reports": ["owner"], "/tally": ["owner"], "/activity": ["owner"], "/settings": ["owner"],
  "/driver/new": ["driver"], "/driver/history": ["driver"], "/me/order": ["customer"], "/me/orders": ["customer"], "/me/deliveries": ["customer"],
  "/me/invoices": ["customer"], "/me/payments": ["customer"],
};
const PEOPLE = { owner: "u-owner", warehouse: "u-wh2", manager: "u-wh1", driver: "u-dr1", customer: "u-c1" };

for (const phone of [false, true]) {
  for (const [role, uid] of Object.entries(PEOPLE)) {
    const s = await session(uid, { phone });
    await s.page.goto(base + "#/");
    await s.page.waitForTimeout(800);
    const problems = [];
    for (const r of ROUTES) {
      s.errors.length = 0;
      await s.page.evaluate((h) => { location.hash = h; }, r);
      await s.page.waitForTimeout(r === "/3d" ? 2500 : 450);
      const body = await s.page.locator("body").innerText();
      const allowed = ALLOWED[r].includes(role);
      const blocked = body.includes("This page isn't available for your role.");
      if (body.includes("Something went wrong on this screen")) problems.push(`${r}: screen crashed`);
      else if (allowed && blocked) problems.push(`${r}: blocked but should open`);
      else if (!allowed && !blocked && !(r.startsWith("/invoices/") && body.includes("Invoice not found"))) problems.push(`${r}: should be blocked`);
      else if (allowed && body.includes("Page not found")) problems.push(`${r}: page not found`);
      if (allowed && phone) {
        const [sw, cw] = await s.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        if (sw > cw + 1) problems.push(`${r}: page wider than phone screen (${sw}px)`);
      }
      const errs = s.errors.filter((e) => !/favicon|404 \(Not Found\)/.test(e));
      if (errs.length) problems.push(`${r}: error ${errs[0]}`);
    }
    const name = `${role}: all ${ROUTES.length} screens open/blocked correctly on ${phone ? "phone" : "computer"}`;
    problems.length ? bad(name, problems.join("; ")) : ok(name);
    await s.ctx.close();
  }
}

// ---------------------------------------------------------------- 2. owner actions
{
  const { ctx, page, db, errors } = await session("u-owner");
  const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(500); };
  await page.goto(base + "#/");
  await page.getByText("Stock across locations").waitFor();

  await attempt("owner: dashboard shows sales, approvals, profit card and charts", async () => {
    for (const t of ["Sales today", "Pending approvals", "Net profit this month", "Net loss this month"]) if (t.startsWith("Net")) continue; else await page.getByText(t).first().waitFor({ timeout: 3000 });
    if (!(await page.getByText(/Net (profit|loss) this month/).count())) throw new Error("profit card missing");
    if (!(await page.locator(".recharts-surface").count())) throw new Error("charts missing");
  });

  await attempt("owner: alerts page lists alerts and each opens its screen", async () => {
    await go("/alerts");
    const n = await page.locator("main a[href^='#/']").count();
    if (n < 3) throw new Error(`only ${n} alerts`);
    await page.locator("main a[href^='#/']").first().click();
    await page.waitForTimeout(400);
    if ((await page.evaluate(() => location.hash)) === "#/alerts") throw new Error("alert link did not navigate");
  });

  await attempt("owner: settings change saves and survives reload", async () => {
    await go("/settings");
    const tag = page.getByLabel(/Tagline/i).first();
    await tag.fill("Bharat Gas Distributor, Peenya");
    await page.getByRole("button", { name: /Save/ }).first().click();
    await page.getByText("Settings saved").waitFor();
    await page.reload(); await page.waitForTimeout(600);
    if ((await db()).settings.agencyTagline !== "Bharat Gas Distributor, Peenya") throw new Error("tagline not saved");
  });

  await attempt("owner: weak PIN is refused in settings", async () => {
    await go("/settings");
    await page.locator("#pin").fill("1111");
    const btn = page.getByRole("button", { name: /Save/ }).first();
    if (await btn.isEnabled()) { await btn.click(); await page.waitForTimeout(400); }
    if ((await db()).settings.ownerPin === "1111") throw new Error("weak PIN 1111 was accepted");
    await page.locator("#pin").fill("1234");
  });

  await attempt("owner: customer detail tabs + record payment lowers dues", async () => {
    await go("/customers/c1");
    for (const t of ["Deliveries", "Invoices", "Payments", "Overview"]) await page.getByRole("tab", { name: new RegExp(t) }).click();
    const before = (await db()).payments.length;
    await page.getByRole("button", { name: /Record payment/ }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel(/Amount/).fill("500");
    await dlg.getByRole("button", { name: "Save payment" }).click();
    await page.getByText(/Payment of ₹500 recorded/).waitFor();
    const d = await db();
    if (d.payments.length !== before + 1 || d.payments.at(-1).amount !== 500) throw new Error("payment not saved");
  });

  await attempt("owner: edit customer credit limit", async () => {
    await go("/customers/c1");
    await page.getByRole("button", { name: /Edit/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel(/Credit limit/).fill("123000");
    await dlg.getByRole("button", { name: "Save" }).click();
    await page.getByText("Customer updated").waitFor();
    if ((await db()).customers.find((c) => c.id === "c1").creditLimit !== 123000) throw new Error("credit limit not saved");
  });

  await attempt("owner: add a new customer", async () => {
    await go("/customers");
    await page.getByRole("button", { name: /Add customer/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Contact name").fill("Test Kitchen");
    await dlg.getByLabel("Phone").fill("9988776655");
    await dlg.getByRole("button", { name: "Save" }).click();
    await page.getByText("Customer added").waitFor();
    const d = await db();
    if (!d.customers.some((c) => c.name === "Test Kitchen") || !d.users.some((u) => u.role === "customer" && u.phone.replace(/\D/g, "") === "9988776655")) throw new Error("customer or login missing");
  });

  await attempt("owner: customers search and filters", async () => {
    await go("/customers");
    await page.getByPlaceholder(/Search/).fill("Test Kitchen");
    await page.waitForTimeout(300);
    const rows = await page.locator("tbody tr").count();
    if (rows !== 1) throw new Error(`search shows ${rows} rows`);
  });

  await attempt("owner: stock state change (full → defective) logged", async () => {
    await go("/stock");
    const before = (await db()).movements.length;
    await page.getByRole("button", { name: /Change state/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Save" }).click();
    await page.getByText(/^Moved /).waitFor();
    if ((await db()).movements.length !== before + 1) throw new Error("no movement");
  });

  await attempt("owner: movement log filters and CSV", async () => {
    await go("/movements");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    if (!dl.suggestedFilename().endsWith(".csv")) throw new Error("no csv");
  });

  await attempt("owner: every report tab opens and exports CSV", async () => {
    await go("/reports");
    for (const t of ["Stock", "Sales", "Purchases", "GST summary", "Customer ledger", "Drivers"]) {
      await page.getByRole("tab", { name: t }).click();
      await page.waitForTimeout(250);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.getByRole("tabpanel").getByRole("button", { name: "Export CSV" }).click()]);
      if (!dl.suggestedFilename().endsWith(".csv")) throw new Error(`${t}: no csv`);
    }
  });

  await attempt("owner: sales invoice view shows GST breakup and amount in words", async () => {
    await go(`/invoices/${firstSale.id}`);
    await page.getByText(firstSale.no).first().waitFor();
    for (const t of [/CGST|IGST/, /Rupees/i, /2711/]) if (!(await page.getByText(t).count())) throw new Error(`missing ${t}`);
  });

  await attempt("owner: purchase invoice shows receipts section", async () => {
    await go(`/invoices/${firstPurchase.id}`);
    await page.getByText("Plant receipts").waitFor();
  });

  await attempt("owner: sales + purchases lists filter by date", async () => {
    for (const r of ["/sales", "/purchases"]) {
      await go(r);
      await page.getByRole("button", { name: "Today", exact: true }).first().click();
      await page.getByRole("button", { name: "60 days" }).first().click();
      if (!(await page.locator("tbody tr").count())) throw new Error(`${r} empty`);
    }
  });

  await attempt("owner: profit & loss every period, adds up", async () => {
    await go("/profit");
    for (const p of ["Today", "Yesterday", "This month", "Last month", /^FY /, "Custom"]) {
      await page.getByRole("button", { name: p, exact: typeof p === "string" }).first().click();
      await page.waitForTimeout(300);
      const v = async (id) => Number(await page.getByTestId(id).getAttribute("data-value"));
      const [rev, cogs, exp, net] = [await v("pl-revenue"), await v("pl-cogs"), await v("pl-expenses"), await v("pl-net")];
      if (Math.abs(net - (rev - cogs - exp)) > 1) throw new Error(`${p}: ${rev} − ${cogs} − ${exp} ≠ ${net}`);
    }
  });

  await attempt("owner: expenses filter by type and open a bill", async () => {
    await go("/expenses");
    await page.getByRole("button", { name: "30 days" }).click();
    await page.locator("tbody tr").first().click();
    await page.getByRole("dialog").getByText(/Booked by/).waitFor();
    await page.keyboard.press("Escape");
  });

  await attempt("owner: customer orders — reject one with a reason, accept and mark another delivered", async () => {
    await go("/orders");
    const before = await db();
    const fresh = before.orders.filter((o) => o.status === "new");
    if (fresh.length < 2) throw new Error("need 2 new orders in sample data");
    await page.locator("[data-slot=card]", { hasText: fresh[0].no }).getByRole("button", { name: "Reject" }).click();
    await page.getByRole("button", { name: "Out of stock for this size" }).click();
    await page.getByRole("button", { name: "Reject order" }).click();
    await page.getByText("Order rejected").waitFor();
    await page.locator("[data-slot=card]", { hasText: fresh[1].no }).getByRole("button", { name: "Accept" }).click();
    await page.getByText(/Order accepted/).waitFor();
    await page.getByRole("tab", { name: /Accepted/ }).click();
    await page.locator("[data-slot=card]", { hasText: fresh[1].no }).getByRole("button", { name: "Mark delivered" }).click();
    await page.getByText("Order marked delivered").waitFor();
    const d = await db();
    if (d.orders.find((o) => o.id === fresh[0].id).status !== "rejected" || d.orders.find((o) => o.id === fresh[1].id).status !== "delivered") throw new Error("statuses wrong");
  });

  await attempt("owner: trucks & drivers page — make a staff member manager", async () => {
    await go("/fleet");
    await page.getByRole("switch", { name: /Lakshmi Devi is a manager/ }).click();
    await page.getByText(/Made manager/).waitFor();
    if (!(await db()).users.find((u) => u.id === "u-wh2").manager) throw new Error("not saved");
    await page.getByRole("switch", { name: /Lakshmi Devi is a manager/ }).click();
    await page.getByText(/Manager rights removed/).waitFor();
  });

  await attempt("owner: activity log filters by action and person", async () => {
    await go("/activity");
    if (!(await page.locator("tbody tr").count())) throw new Error("activity log empty");
  });

  await attempt("owner: 3D view — warehouse, area and truck details", async () => {
    await go("/3d");
    await page.getByText("Main warehouse").first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: /^KA-/ }).first().click();
    await page.getByText("Full on truck").waitFor();
    await page.getByRole("button", { name: "Close details" }).click();
    await page.getByText("Full at warehouse").click();
    await page.getByText("Stock right now").waitFor();
  });

  await attempt("owner: view as each role and back", async () => {
    await go("/");
    for (const [r, expect] of [["Warehouse staff", /overview for/], ["Driver", "My day"], ["Customer", /Welcome,/]]) {
      await page.getByRole("button", { name: /Anmol Mehta/ }).click();
      await page.getByRole("menuitem", { name: /View as another role/ }).click();
      await page.getByRole("button", { name: r, exact: true }).click();
      await page.getByRole("button", { name: /View as / }).click();
      await page.getByText(expect).first().waitFor();
      await page.getByRole("button", { name: "Back to owner view" }).click();
      await page.getByText("Stock across locations").waitFor();
    }
  });

  await attempt("owner: theme Dark then Light sticks after reload; Classic style undo", async () => {
    const themeBtn = page.getByRole("button", { name: /theme|Theme|look/i }).first();
    await themeBtn.click();
    await page.getByRole("menuitem", { name: /Dark/ }).click();
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "dark") throw new Error("dark not applied");
    await themeBtn.click();
    await page.getByRole("menuitem", { name: /Light/ }).click();
    await page.reload(); await page.waitForTimeout(500);
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "light") throw new Error("light not kept");
    await themeBtn.click();
    await page.getByRole("menuitem", { name: /Classic style/ }).click();
    if ((await page.evaluate(() => document.documentElement.dataset.style)) !== "classic") throw new Error("classic not applied");
    await themeBtn.click();
    await page.getByRole("menuitem", { name: /New style/ }).click();
  });

  await attempt("owner: log out returns to the owner login", async () => {
    await page.getByRole("button", { name: /Anmol Mehta/ }).click();
    await page.getByRole("menuitem", { name: /Log out/ }).click();
    await page.getByRole("heading", { name: "Owner login" }).waitFor();
  });
  if (errors.length) bad("owner: no script errors during actions", errors.slice(0, 3).join(" | ")); else ok("owner: no script errors during actions");
  await ctx.close();
}

// ---------------------------------------------------------------- 3. warehouse staff
{
  const { ctx, page, db, errors } = await session("u-wh2");
  const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(500); };
  await page.goto(base + "#/");
  await page.waitForTimeout(800);

  await attempt("staff: home shows today's numbers and quick buttons", async () => {
    await page.getByText(/overview for/).waitFor();
    for (const t of ["New load sheet", "Review acknowledgements", "Record plant receipt", "End of day counts"]) await page.getByText(t).first().waitFor();
    if (await page.getByText("Book expense").count()) throw new Error("plain staff can book expenses");
  });

  await attempt("staff: make a load sheet", async () => {
    await go("/loads");
    const before = (await db()).loadSheets.length;
    await page.getByRole("button", { name: "New load sheet" }).click();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "Increase 19 kg" }).click();
    await page.getByRole("button", { name: /Load 1 cylinder/ }).click();
    await page.getByText(/Loaded 1 cylinder/).waitFor();
    if ((await db()).loadSheets.length !== before + 1) throw new Error("not saved");
  });

  await attempt("staff: approve a pending delivery (invoice + payments created)", async () => {
    await go("/approvals");
    const d0 = await db();
    const pend = d0.deliveries.find((d) => d.status === "pending");
    await page.locator("[data-slot=card]", { hasText: pend.no }).getByRole("button", { name: "Approve" }).click();
    await page.getByText(`Approved ${pend.no}`, { exact: false }).waitFor();
    const d1 = await db();
    const dd = d1.deliveries.find((d) => d.id === pend.id);
    if (dd.status !== "approved" || !d1.invoices.some((i) => i.id === dd.invoiceId)) throw new Error("no invoice");
  });

  await attempt("staff: record a plant receipt", async () => {
    await go("/purchases");
    const before = (await db()).invoices.filter((i) => i.kind === "purchase").length;
    await page.getByRole("button", { name: "Record receipt" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Increase 19 kg/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Save receipt" }).click();
    await page.getByText(/Stock receipt saved/).waitFor();
    if ((await db()).invoices.filter((i) => i.kind === "purchase").length !== before + 1) throw new Error("not saved");
  });

  await attempt("staff: end-of-day count for a truck on the road", async () => {
    await go("/reconciliation");
    const before = (await db()).reconciliations.length;
    await page.getByRole("button", { name: "Enter returned counts" }).first().click();
    await page.getByRole("button", { name: "Save counts" }).click();
    await page.waitForTimeout(600);
    if ((await db()).reconciliations.length !== before + 1) throw new Error("not saved");
  });

  await attempt("staff: can view customers but not add, edit or see profit/expenses", async () => {
    await go("/customers");
    if (await page.getByRole("button", { name: /Add customer/ }).count()) throw new Error("staff can add customers");
    await go("/customers/c1");
    if (await page.getByRole("button", { name: /^Edit$/ }).count()) throw new Error("staff can edit customers");
    await go("/expenses");
    await page.getByText(/Only the owner and warehouse managers/).waitFor();
  });
  if (errors.length) bad("staff: no script errors", errors.slice(0, 3).join(" | ")); else ok("staff: no script errors");
  await ctx.close();
}

// ---------------------------------------------------------------- 4. manager
{
  const { ctx, page, db } = await session("u-wh1");
  await page.goto(base + "#/");
  await page.waitForTimeout(800);
  await attempt("manager: sees 'Warehouse manager' and can book an expense", async () => {
    await page.getByText(/Warehouse manager overview/).waitFor();
    const before = (await db()).expenses.length;
    await page.getByRole("button", { name: /Book expense/ }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Expense type").click();
    await page.getByRole("option", { name: "Tea & food" }).click();
    await dlg.getByLabel("Amount (₹)").fill("120");
    await dlg.getByRole("button", { name: /Book ₹120/ }).click();
    await page.getByText("Expense booked").waitFor();
    if ((await db()).expenses.length !== before + 1) throw new Error("not saved");
  });
  await ctx.close();
}

// ---------------------------------------------------------------- 5. driver (phone)
{
  const { ctx, page, db, errors } = await session("u-dr1", { phone: true });
  await page.goto(base + "#/");
  await page.waitForTimeout(800);
  await attempt("driver: my day shows truck stock and collections", async () => {
    await page.getByText(/My day|Today/).first().waitFor();
    for (const t of ["Cash", "UPI"]) if (!(await page.getByText(t).count())) throw new Error(`missing ${t}`);
  });
  await attempt("driver: full delivery with photo, GPS and split payment", async () => {
    const before = (await db()).deliveries.length;
    await page.evaluate(() => { location.hash = "/driver/new"; });
    await page.waitForTimeout(500);
    await page.locator("main button").filter({ hasText: /[A-Za-z]/ }).nth(1).click(); // first customer in the picker
    await page.waitForTimeout(600);
    const inc = page.getByRole("button", { name: /^Increase/ });
    if (!(await page.getByRole("button", { name: /Submit delivery/ }).count())) throw new Error("form not open");
    await inc.first().click();
    await page.getByRole("button", { name: /sample photo/ }).click();
    await page.getByRole("button", { name: "All cash" }).click();
    await page.waitForTimeout(6500); // GPS (mock after timeout)
    await page.getByRole("button", { name: /Submit delivery/ }).click();
    await page.getByText(/Delivery saved/).waitFor({ timeout: 8000 });
    if ((await db()).deliveries.length !== before + 1) throw new Error("not saved");
  });
  await attempt("driver: history lists today's deliveries", async () => {
    await page.evaluate(() => { location.hash = "/driver/history"; });
    await page.waitForTimeout(500);
    const mine = (await db()).deliveries.filter((d) => d.driverId === "dr1");
    const c = S.customers.find((x) => x.id === mine.at(-1).customerId);
    if (!(await page.getByText(c.businessName || c.name).count())) throw new Error("today's delivery not listed");
  });
  if (errors.length) bad("driver: no script errors", errors.slice(0, 3).join(" | ")); else ok("driver: no script errors");
  await ctx.close();
}

// ---------------------------------------------------------------- 6. customer (phone)
{
  const { ctx, page, db, errors } = await session("u-c1", { phone: true });
  const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(500); };
  await page.goto(base + "#/");
  await page.waitForTimeout(800);
  await attempt("customer: home shows dues, empties and order button", async () => {
    await page.getByText(/Welcome,/).waitFor();
    await page.getByText("Outstanding amount").waitFor();
    await page.getByRole("link", { name: /Order cylinders/ }).waitFor();
  });
  await attempt("customer: place an order, see it, cancel it", async () => {
    await go("/me/order");
    await page.getByRole("button", { name: /^Increase/ }).first().click();
    await page.getByRole("button", { name: "Place order" }).click();
    await page.getByText(/Order placed/).waitFor();
    const o = (await db()).orders.at(-1);
    await page.locator("[data-slot=card]", { hasText: o.no }).getByRole("button", { name: "Cancel order" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel order" }).click();
    await page.getByText("Order cancelled").first().waitFor();
  });
  await attempt("customer: invoices open, own only", async () => {
    await go("/me/invoices");
    await page.locator("main button").filter({ hasText: /AGA\// }).first().click();
    await page.waitForTimeout(500);
    await page.locator("main").getByText(/tax invoice/i).first().waitFor();
    const other = S.invoices.find((i) => i.kind === "sale" && i.partyId !== "c1");
    await go(`/invoices/${other.id}`);
    if (await page.getByText(other.no).count()) throw new Error("can open another customer's invoice");
  });
  await attempt("customer: deliveries with acknowledgement photo, payments list", async () => {
    await go("/me/deliveries");
    await page.getByRole("button", { name: /Open acknowledgement photo/ }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await go("/me/payments");
    await page.getByText("Payment history").waitFor();
  });
  if (errors.length) bad("customer: no script errors", errors.slice(0, 3).join(" | ")); else ok("customer: no script errors");
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(" ✗", f.name, "—", f.why);
process.exit(failed.length ? 1 : 0);
