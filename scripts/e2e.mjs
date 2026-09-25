// End-to-end smoke test of the daily flow on the static build (./out).
// Run: npm run build && node scripts/e2e.mjs
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("out");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const step = (s) => console.log("✓", s);
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem("anmol-gas-demo:db")));

await page.goto(base);
await page.getByRole("button", { name: "Log in as driver" }).click();
await page.getByRole("link", { name: "New delivery" }).first().click();
await page.getByPlaceholder("Search name, area or phone").fill("tandoor");
await page.getByRole("button", { name: /Tandoor Tales Kitchen/ }).click();
await page.getByRole("button", { name: "Increase 19 kg full given" }).click();
await page.getByRole("button", { name: "Full amount" }).click();
await page.getByRole("button", { name: "UPI" }).click();
await page.getByRole("button", { name: /Use a sample photo/ }).click();
await page.getByText(/Location (captured|\(demo fallback\))/).waitFor({ timeout: 10000 });
const before = await db();
await page.getByRole("button", { name: "Submit delivery" }).click();
await page.getByText("Delivery saved").waitFor();
let after = await db();
const newD = after.deliveries.at(-1);
if (after.deliveries.length !== before.deliveries.length + 1 || newD.status !== "pending") throw new Error("delivery not created");
step(`driver submitted ${newD.no} (pending, GPS ${newD.gps.mocked ? "mock" : "real"})`);

// Owner approves it
await page.getByRole("button", { name: /Ravi Kumar/ }).click();
await page.getByRole("menuitem", { name: "Log out" }).click();
await page.getByRole("button", { name: "Log in as owner" }).click();
await page.goto(base + "#/approvals");
const card = page.locator("[data-slot=card]", { hasText: newD.no });
await card.getByRole("button", { name: "Approve" }).click();
await page.getByText(`Approved ${newD.no}`).waitFor();
after = await db();
const approved = after.deliveries.find((d) => d.id === newD.id);
const inv = after.invoices.find((i) => i.id === approved.invoiceId);
if (approved.status !== "approved" || !inv || !after.payments.some((p) => p.deliveryId === newD.id)) throw new Error("approve failed");
step(`owner approved → invoice ${inv.no} ₹${inv.total} (CGST ${inv.cgst} + SGST ${inv.sgst}) and payment recorded`);

// Reload: data persists
await page.reload();
await page.getByText("Delivery approvals").waitFor();
if (!(await db()).deliveries.find((d) => d.id === newD.id && d.status === "approved")) throw new Error("not persisted");
step("state persisted after page refresh");

// Reject flow on another pending delivery
const pend = (await db()).deliveries.find((d) => d.status === "pending");
if (pend) {
  const c2 = page.locator("[data-slot=card]", { hasText: pend.no });
  await c2.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("button", { name: "Stamp missing on acknowledgement" }).click();
  await page.getByRole("button", { name: "Reject delivery" }).click();
  await page.getByText(`Rejected ${pend.no}`).waitFor();
  step(`rejected ${pend.no} with reason`);
}

// Load sheet
await page.goto(base + "#/loads");
await page.getByRole("button", { name: "New load sheet" }).click();
await page.getByRole("combobox").first().click();
await page.getByRole("option").nth(2).click();
await page.getByRole("button", { name: "Increase 14.2 kg" }).click();
await page.getByRole("button", { name: "Increase 14.2 kg" }).click();
await page.getByRole("button", { name: /Load 2 cylinders/ }).click();
await page.getByText(/Loaded 2 cylinders/).waitFor();
step("load sheet created");

// End of day for a truck still on the road
await page.goto(base + "#/reconciliation");
await page.getByRole("button", { name: "Enter returned counts" }).first().click();
await page.getByRole("button", { name: "Save counts" }).click();
await page.getByText(/Truck returned|mismatch/).first().waitFor();
step("end-of-day counts saved");

// Tally sync
await page.goto(base + "#/tally");
const syncs = (await db()).syncLog.length;
await page.getByRole("button", { name: "Sync now" }).click();
await page.getByText(/Imported \d+ vouchers/).waitFor({ timeout: 10000 });
if ((await db()).syncLog.length !== syncs + 1) throw new Error("tally sync failed");
step("Tally sync imported vouchers");

// Reports export
await page.goto(base + "#/reports");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
step(`CSV export: ${dl.suggestedFilename()}`);

// Customer portal only sees own data; view-as
await page.getByRole("button", { name: /Anmol Mehta/ }).click();
await page.getByRole("menuitem", { name: /View as another role/ }).click();
await page.getByRole("button", { name: "Customer", exact: true }).click();
await page.getByRole("button", { name: /View as customer/ }).click();
await page.getByText(/Owner preview/).waitFor();
await page.goto(base + "#/customers");
await page.getByText("This page isn't available for your role.").waitFor();
step("owner 'view as' customer works and staff pages are blocked");
await page.getByRole("button", { name: "Back to owner view" }).click();

// Reset
await page.goto(base + "#/settings");
await page.getByRole("button", { name: "Reset demo data" }).click();
await page.getByRole("button", { name: "Reset", exact: true }).click();
await page.getByText(/Demo data reset/).waitFor();
if ((await db()).deliveries.some((d) => d.id === newD.id && d.customerId === newD.customerId && d.payment?.mode === "upi" && d.ts === newD.ts)) throw new Error("reset failed");
step("reset demo data");

await browser.close();
server.close();
if (errors.length) { console.error("Page errors:\n" + errors.join("\n")); process.exit(1); }
console.log("All flows passed");
