// End-to-end smoke test of the daily flow on the static build (./out).
// Run: npm run build && node scripts/e2e.mjs
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("out");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
// Same security headers as production (vercel.json), minus HTTPS-only ones on localhost
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
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) errors.push(`CSP: ${m.text()}`); });
const step = (s) => console.log("✓", s);
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem("anmol-gas-demo:db")));

// Owner page is PIN protected
await page.goto(base);
await page.getByLabel("PIN digit 1").fill("9999");
await page.getByRole("button", { name: "Unlock" }).click();
await page.getByText("That PIN is not correct").waitFor();
step("owner page rejects a wrong PIN");

// ---------- a brand-new install starts empty ----------
const start = await db();
if (start.customers.length || start.trucks.length || start.deliveries.length || start.movements.length) throw new Error("app should start empty");
await page.getByLabel("PIN digit 1").fill("1234");
await page.getByRole("button", { name: "Unlock" }).click();
await page.getByRole("button", { name: "Open as owner" }).click();
await page.getByText("Stock across locations").waitFor();
step("new install starts completely empty; owner signs in with PIN");

// Set up a business from scratch
await page.goto(base + "#/fleet");
await page.getByText("No trucks yet").waitFor();
await page.getByRole("button", { name: "Add truck & driver" }).click();
let dlg = page.getByRole("dialog");
await dlg.getByLabel("Truck number").fill("KA-05-MN-2024");
await dlg.getByLabel("Driver name").fill("Test Driver");
await dlg.getByLabel("Driver mobile").fill("91234 56780");
await dlg.getByRole("button", { name: "Add", exact: true }).click();
await page.getByText("Truck and driver added").waitFor();
await page.getByRole("button", { name: "Add staff" }).click();
dlg = page.getByRole("dialog");
await dlg.getByLabel("Name").fill("Test Staff");
await dlg.getByLabel("Mobile").fill("91234 56781");
await dlg.getByRole("button", { name: "Add", exact: true }).click();
await page.getByText("Staff member added").waitFor();
// the same phone can't be used twice
await page.getByRole("button", { name: "Add staff" }).click();
dlg = page.getByRole("dialog");
await dlg.getByLabel("Name").fill("Copycat");
await dlg.getByLabel("Mobile").fill("91234 56780");
await dlg.getByRole("button", { name: "Add", exact: true }).click();
await page.getByText("already belongs to another login").waitFor();
await page.keyboard.press("Escape");

await page.goto(base + "#/stock");
await page.getByRole("button", { name: "Opening stock" }).click();
dlg = page.getByRole("dialog");
for (let i = 0; i < 3; i++) await dlg.getByRole("button", { name: "Increase 19 kg Full" }).click();
// 4-digit quantities are kept exactly as typed (no silent cap at 999)
await dlg.getByRole("textbox", { name: "19 kg Empty", exact: true }).fill("1500");
if ((await dlg.getByRole("textbox", { name: "19 kg Empty", exact: true }).inputValue()) !== "1500") throw new Error("4-digit quantity was changed");
await dlg.getByRole("textbox", { name: "14.2 kg Empty", exact: true }).fill("123456");
if ((await dlg.getByRole("textbox", { name: "14.2 kg Empty", exact: true }).inputValue()) !== "1234") throw new Error("quantity should stop at 4 digits");
await dlg.getByRole("textbox", { name: "14.2 kg Empty", exact: true }).fill("0");
await dlg.getByRole("button", { name: "Add 1503 cylinders" }).click();
await page.getByText("Opening stock added: 1503 cylinders").waitFor();
step("quantities take 4 digits as typed and are never silently capped");

// Above what's in stock: the number stays, the box turns red, Save is blocked
await page.goto(base + "#/purchases");
await page.getByRole("button", { name: "Record receipt" }).click();
dlg = page.getByRole("dialog");
await dlg.getByRole("textbox", { name: "19 kg empties", exact: true }).fill("1600");
if ((await dlg.getByRole("textbox", { name: "19 kg empties", exact: true }).inputValue()) !== "1600") throw new Error("over-limit value was changed");
if ((await dlg.getByRole("textbox", { name: "19 kg empties", exact: true }).getAttribute("aria-invalid")) !== "true") throw new Error("over-limit value should be flagged");
await dlg.getByRole("textbox", { name: "19 kg full", exact: true }).fill("10");
if (!(await dlg.getByRole("button", { name: "Save receipt" }).isDisabled())) throw new Error("save must be blocked when above stock");
await dlg.getByRole("textbox", { name: "19 kg empties", exact: true }).fill("1500");
if (await dlg.getByRole("button", { name: "Save receipt" }).isDisabled()) throw new Error("save should work within stock");
step("value above stock is flagged red and blocks Save instead of being changed");

// Upload the plant's receipt with the purchase: photo + PDF; fakes are refused
await dlg.getByRole("textbox", { name: "19 kg empties", exact: true }).fill("0");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DAwMDAwMAAAP4EAf6Vf7kAAAAASUVORK5CYII=", "base64");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
await page.getByLabel("Choose receipt files").setInputFiles([
  { name: "plant-invoice.png", mimeType: "image/png", buffer: png },
  { name: "BPCL-invoice.pdf", mimeType: "application/pdf", buffer: pdf },
  { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script>") },
  { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") },
]);
await page.getByText("fake.pdf: this isn't a real PDF file.").waitFor();
await page.getByText("logo.svg: only JPG or PNG photos and PDF files can be uploaded.").waitFor();
await dlg.getByText("plant-invoice.jpg").waitFor();
await dlg.getByText("BPCL-invoice.pdf").waitFor();
await dlg.getByRole("button", { name: "Save receipt" }).click();
await page.getByText("Stock receipt saved with 2 attached files.").waitFor();
const purchase = (await db()).invoices.filter((i) => i.kind === "purchase").at(-1);
if (purchase.attachments?.length !== 2 || purchase.attachments[0].kind !== "image" || !purchase.attachments[0].dataUrl.startsWith("data:image/jpeg;base64,") || purchase.attachments[1].kind !== "pdf") throw new Error("receipts not saved correctly");
await page.goto(base + `#/invoices/${purchase.id}`);
await page.getByText("2 attached", { exact: true }).waitFor();
await page.getByRole("button", { name: "Open plant-invoice.jpg" }).click();
await page.getByRole("dialog").getByRole("img", { name: "plant-invoice.jpg" }).waitFor();
await page.keyboard.press("Escape");
step("plant receipt photo + PDF uploaded with the purchase; fake PDF and SVG refused");

await page.goto(base + "#/customers");
await page.getByRole("button", { name: "Add customer" }).click();
dlg = page.getByRole("dialog");
await dlg.getByLabel("Contact name").fill("Sharma Tiffins");
await dlg.locator("input[inputmode=tel]").fill("9123456782");
await dlg.getByLabel("GSTIN").fill("29ABCDE1234F1Z5");
await dlg.getByLabel("Amount they owe today (₹)").fill("2500");
await dlg.getByLabel("19 kg already with customer").fill("2");
await dlg.getByRole("button", { name: "Save" }).click();
await page.getByText("Customer added").waitFor();
let setup = await db();
const sharma = setup.customers.find((c) => c.name === "Sharma Tiffins");
const whFull19 = setup.movements.filter((m) => m.to === "WH" && m.size === "19" && m.state === "full").reduce((n, m) => n + m.qty, 0);
const whEmpty19 = setup.movements.filter((m) => m.to === "WH" && m.size === "19" && m.state === "empty").reduce((n, m) => n + m.qty, 0);
if (!sharma || sharma.openingOutstanding !== 2500 || sharma.openingEmpties["19"] !== 2 || whFull19 !== 13 || whEmpty19 !== 1500) throw new Error("setup from empty did not save correctly");
step("from empty: added truck + driver, staff, opening stock and a customer with opening dues");

// The new driver signs in; real numbers are never listed on the login page
await page.evaluate(() => { localStorage.removeItem("anmol-gas-demo:session"); sessionStorage.clear(); });
await page.reload(); await page.goto(base + "#driver");
await page.getByText("Driver login").waitFor();
if (await page.getByText("Demo numbers").count()) throw new Error("demo numbers must not show with real data");
await page.getByLabel("Mobile number").fill("91234 56780");
await page.getByRole("button", { name: "Send OTP" }).click();
await page.getByLabel("OTP digit 1").fill("1111");
await page.getByRole("button", { name: "Verify and log in" }).click();
await page.getByText("On my truck now").waitFor();
step("new driver signs in by phone; no phone numbers shown on the login page");

// Load the sample data for the remaining flows
await page.evaluate(() => { localStorage.removeItem("anmol-gas-demo:session"); sessionStorage.clear(); });
await page.goto(base + "#/"); await page.reload();
await page.getByLabel("PIN digit 1").fill("1234");
await page.getByRole("button", { name: "Unlock" }).click();
await page.getByRole("button", { name: "Open as owner" }).click();
await page.goto(base + "#/settings");
await page.getByRole("button", { name: "Load sample data" }).click();
dlg = page.getByRole("dialog");
await dlg.getByLabel(/Type SAMPLE/).fill("SAMPLE");
await dlg.getByRole("button", { name: "Load sample data" }).click();
await page.getByText("Sample data loaded").waitFor();
if ((await db()).customers.length !== 40) throw new Error("sample data not loaded");
await page.evaluate(() => { localStorage.removeItem("anmol-gas-demo:session"); sessionStorage.clear(); });
step("sample data loaded (owner PIN kept)");

// Driver logs in on their own page with mobile number + OTP
await page.reload(); await page.goto(base + "#driver");
await page.getByLabel("Mobile number").fill("12345 67890");
await page.getByRole("button", { name: "Send OTP" }).click();
await page.getByText("Enter a 10-digit Indian mobile number").waitFor();
await page.getByLabel("Mobile number").fill("90000 00001");
await page.getByRole("button", { name: "Send OTP" }).click();
await page.getByText("isn't registered as a driver").waitFor();
const ravi = (await db()).users.find((u) => u.id === "u-dr1");
await page.getByLabel("Mobile number").fill(ravi.phone);
if (!(await page.getByRole("checkbox", { name: "Keep me signed in" }).isChecked())) throw new Error("keep signed in should default on");
await page.getByRole("button", { name: "Send OTP" }).click();
await page.getByLabel("OTP digit 1").fill("4821");
await page.getByRole("button", { name: "Verify and log in" }).click();
await page.getByText("On my truck now").waitFor();
step("driver logged in with phone + OTP on #driver");
await page.getByRole("link", { name: "New delivery" }).first().click();
await page.getByPlaceholder("Search name, area or phone").fill("tandoor");
await page.getByRole("button", { name: /Tandoor Tales Kitchen/ }).click();
await page.getByRole("button", { name: "Increase 19 kg full given" }).click();
// Split payment: part cash, rest by UPI closes the bill
await page.getByLabel("Cash received").fill("2000");
await page.getByText(/balance → dues/).waitFor();
await page.getByRole("button", { name: "Rest by UPI" }).click();
await page.getByText("✓ Fully paid · entry closed").waitFor();
// Too much is refused (more than bill + old dues)
const upiBefore = await page.getByLabel("UPI received").inputValue();
await page.getByLabel("UPI received").fill("9999999");
await page.getByText(/is more than this bill plus the customer's old dues/).waitFor();
await page.getByLabel("UPI received").fill(upiBefore);
await page.getByText("✓ Fully paid · entry closed").waitFor();
await page.getByRole("button", { name: /Use a sample photo/ }).click();
await page.getByText(/Location (captured|\(demo fallback\))/).waitFor({ timeout: 10000 });
const stickiness = await page.getByRole("button", { name: "Submit delivery" }).evaluate((b) => [getComputedStyle(b).position, getComputedStyle(b.parentElement).position]);
if (stickiness.some((p) => p === "sticky" || p === "fixed")) throw new Error("submit button must not be sticky");
const before = await db();
await page.getByRole("button", { name: "Submit delivery" }).click();
await page.getByText("Delivery saved").waitFor();
let after = await db();
const newD = after.deliveries.at(-1);
if (after.deliveries.length !== before.deliveries.length + 1 || newD.status !== "pending") throw new Error("delivery not created");
if (newD.payment?.mode !== "split" || newD.payment.cash !== 2000 || newD.payment.upi !== newD.payment.amount - 2000) throw new Error("split payment not saved");
step(`driver submitted ${newD.no} with split payment ₹2,000 cash + ₹${newD.payment.upi} UPI (pending, GPS ${newD.gps.mocked ? "mock" : "real"})`);

// Logging out returns the driver to the driver login page
await page.getByRole("button", { name: /RK/ }).click();
await page.getByRole("menuitem", { name: "Log out" }).click();
await page.getByText("Driver login").waitFor();
step("driver log out goes back to #driver");

// Owner unlocks with the PIN, without "keep me signed in" (session only)
await page.goto(base + "#/");
await page.getByLabel("PIN digit 1").fill("1234");
await page.getByRole("checkbox", { name: "Keep me signed in" }).click();
await page.getByRole("button", { name: "Unlock" }).click();
await page.getByRole("button", { name: "Open as owner" }).click();
await page.getByText("Stock across locations").waitFor();
const stored = await page.evaluate(() => [localStorage.getItem("anmol-gas-demo:session"), sessionStorage.getItem("anmol-gas-demo:session")]);
if (stored[0] !== null || !stored[1]) throw new Error("unticked keep-signed-in should use session storage only");
step("owner PIN login; unticked 'keep me signed in' keeps session for this tab only");
await page.goto(base + "#/approvals");
const card = page.locator("[data-slot=card]", { hasText: newD.no });
await card.getByRole("button", { name: "Approve" }).click();
await page.getByText(`Approved ${newD.no}`).waitFor();
after = await db();
const approved = after.deliveries.find((d) => d.id === newD.id);
const inv = after.invoices.find((i) => i.id === approved.invoiceId);
const delPays = after.payments.filter((p) => p.deliveryId === newD.id);
if (approved.status !== "approved" || !inv || delPays.length !== 2 || !delPays.some((p) => p.mode === "cash" && p.amount === 2000) || !delPays.some((p) => p.mode === "upi")) throw new Error("approve failed or split payment not recorded as cash + UPI");
if (Math.round(inv.total) !== newD.payment.amount) throw new Error("split should equal the bill");
step(`owner approved → invoice ${inv.no} ₹${inv.total} (CGST ${inv.cgst} + SGST ${inv.sgst}); cash and UPI recorded as two payments`);

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

// Expenses: owner books one with a bill photo, daily profit = collected − expenses
await page.goto(base + "#/expenses");
const exBefore = (await db()).expenses.length;
await page.getByRole("button", { name: "Book expense" }).first().click();
const exDlg = page.getByRole("dialog");
await exDlg.getByLabel("Expense type").click();
await page.getByRole("option", { name: "Diesel / fuel" }).click();
await exDlg.getByLabel("Amount (₹)").fill("2,5x00");
if ((await exDlg.getByLabel("Amount (₹)").inputValue()) !== "2500") throw new Error("amount box should keep digits only");
await exDlg.getByRole("radio", { name: "UPI" }).click();
await exDlg.getByLabel("Paid to").fill("=HYPERLINK(\"x\")");
await exDlg.locator('input[type=file][multiple]').setInputFiles({ name: "diesel.png", mimeType: "image/png", buffer: png });
await exDlg.getByText("diesel.jpg").waitFor();
await exDlg.getByRole("button", { name: "Book ₹2,500" }).click();
await page.getByText("Expense booked").waitFor();
const ex = (await db()).expenses.at(-1);
if ((await db()).expenses.length !== exBefore + 1 || ex.amount !== 2500 || ex.mode !== "upi" || ex.category !== "Diesel / fuel" || ex.attachments?.length !== 1 || ex.by !== "u-owner") throw new Error("expense not saved right");
step(`owner booked expense ${ex.no} ₹2,500 diesel by UPI with bill photo`);

await page.goto(base + "#/profit");
const pdb = await db();
const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const coll = pdb.payments.filter((p) => p.date === todayKey).reduce((n, p) => n + p.amount, 0);
const spent = pdb.expenses.filter((e) => e.date === todayKey).reduce((n, e) => n + e.amount, 0);
const fmt = (n) => (n < 0 ? "− " : "") + "₹" + Math.abs(n).toLocaleString("en-IN");
await page.getByText(fmt(coll - spent)).first().waitFor();
step(`daily profit today = collected ${fmt(coll)} − expenses ${fmt(spent)} = ${fmt(coll - spent)}`);
const [pdl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
const csvText = fs.readFileSync(await pdl.path(), "utf8");
if (!csvText.includes("Net profit / loss")) throw new Error("profit CSV missing header");
step(`profit CSV export: ${pdl.suggestedFilename()}`);

// Owner deletes the expense: gone, and the activity log keeps it
await page.goto(base + "#/expenses");
await page.getByRole("row", { name: /Diesel \/ fuel.*2,500/ }).first().click();
await page.getByRole("button", { name: "Delete expense" }).click();
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.getByText("Expense deleted").waitFor();
const afterDel = await db();
if (afterDel.expenses.some((e) => e.id === ex.id) || !afterDel.audit.some((a) => a.action === "expense_deleted" && a.detail.includes(ex.no))) throw new Error("expense delete not logged");
step("owner deleted the expense; activity log keeps the record");

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
await page.getByRole("button", { name: "Clear all data" }).click();
dlg = page.getByRole("dialog");
if (!(await dlg.getByRole("button", { name: "Clear everything" }).isDisabled())) throw new Error("clear must need typed confirmation");
await dlg.getByLabel(/Type CLEAR/).fill("CLEAR");
await dlg.getByRole("button", { name: "Clear everything" }).click();
await page.getByText("All data cleared").waitFor();
const cleared = await db();
if (cleared.customers.length || cleared.deliveries.length || cleared.trucks.length || cleared.users.length !== 1 || cleared.users[0].role !== "owner") throw new Error("clear all did not empty the app");
step("clear all data (typed CLEAR) leaves only the owner login");
await page.getByRole("button", { name: "Load sample data" }).click();
dlg = page.getByRole("dialog");
await dlg.getByLabel(/Type SAMPLE/).fill("SAMPLE");
await dlg.getByRole("button", { name: "Load sample data" }).click();
await page.getByText("Sample data loaded").waitFor();

// ---------- attack / misuse cases ----------
const loginAs = async (userId) => {
  await page.evaluate((u) => localStorage.setItem("anmol-gas-demo:session", JSON.stringify({ userId: u, remember: true, expiresAt: Date.now() + 36e5 })), userId);
  await page.goto(base + "#/"); await page.reload();
  await page.getByText(/^Demo( · sample data)?$/).first().waitFor(); // signed-in shell is up
};

// A forged session without a valid expiry is ignored
await page.evaluate(() => { sessionStorage.clear(); localStorage.setItem("anmol-gas-demo:session", JSON.stringify({ userId: "u-owner" })); });
await page.reload();
await page.getByRole("heading", { name: "Owner login", exact: true }).waitFor();
if (await page.getByText("Stock across locations").count()) throw new Error("forged session must not sign in");
step("forged/expired session is ignored (back to login)");

// Plain warehouse staff can't see or book expenses; a manager can, but can't see profit or delete
await loginAs("u-wh2");
if (await page.getByRole("link", { name: "Expenses" }).count()) throw new Error("expenses menu shown to non-manager");
await page.goto(base + "#/expenses");
await page.getByText("Only the owner and warehouse managers can see expenses").waitFor();
const forged = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("anmol-gas-demo:db"));
  return d.users.find((u) => u.id === "u-wh2").manager;
});
if (forged) throw new Error("u-wh2 should not be a manager");
step("non-manager staff: no expenses menu, page blocked");

await loginAs("u-wh1");
await page.goto(base + "#/expenses");
await page.getByRole("button", { name: "Book expense" }).first().click();
const mDlg = page.getByRole("dialog");
await mDlg.getByLabel("Expense type").click();
await page.getByRole("option", { name: "Other" }).click();
await mDlg.getByLabel("Amount (₹)").fill("350");
if (await mDlg.getByRole("button", { name: "Book ₹350" }).isEnabled()) throw new Error("'Other' without a note must be blocked");
await mDlg.getByLabel(/^Note/).fill("Broom and cleaning supplies");
await mDlg.getByRole("button", { name: "Book ₹350" }).click();
await page.getByText("Expense booked").waitFor();
const mEx = (await db()).expenses.at(-1);
if (mEx.by !== "u-wh1" || mEx.amount !== 350) throw new Error("manager expense not saved");
await page.getByRole("row", { name: /Broom/ }).first().click();
if (await page.getByRole("button", { name: "Delete expense" }).count()) throw new Error("manager must not delete expenses");
await page.keyboard.press("Escape");
await page.goto(base + "#/profit");
await page.getByText("This page isn't available for your role.").waitFor();
step(`warehouse manager booked ${mEx.no}; can't delete or open the profit report`);

// Driver can't open staff pages
await loginAs("u-dr1");
await page.goto(base + "#/customers");
await page.getByText("This page isn't available for your role.").waitFor();
await page.goto(base + "#/settings");
await page.getByText("This page isn't available for your role.").waitFor();
step("driver blocked from customers and settings");

// Customer can't open someone else's invoice
const other = (await db()).invoices.find((i) => i.kind === "sale" && i.partyId !== "c1");
await loginAs("u-c1");
await page.goto(base + `#/invoices/${other.id}`);
await page.getByText("Invoice not found").waitFor();
step("customer cannot open another customer's invoice");

// Warehouse staff can attach receipts to existing purchases; only the owner can remove them
const anyPurchase = (await db()).invoices.find((i) => i.kind === "purchase");
await loginAs("u-wh1");
await page.goto(base + `#/invoices/${anyPurchase.id}`);
await page.getByText("No receipt attached yet").waitFor();
await page.getByLabel("Choose receipt files").setInputFiles([{ name: "scan.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DAwMDAwMAAAP4EAf6Vf7kAAAAASUVORK5CYII=", "base64") }]);
await page.getByText("Receipt uploaded", { exact: true }).waitFor();
await page.getByText("1 attached", { exact: true }).waitFor();
if (await page.getByRole("button", { name: /^Remove / }).count()) throw new Error("staff must not remove receipts");
await loginAs("u-c1");
await page.goto(base + `#/invoices/${anyPurchase.id}`);
await page.getByText("Invoice not found").waitFor();
step("warehouse staff attach receipts to past purchases; can't remove; customers can't see them");

// Excel formula injection through a customer name is neutralised in CSV exports
await loginAs("u-owner");
await page.goto(base + "#/customers");
await page.getByRole("button", { name: "Add customer" }).click();
dlg = page.getByRole("dialog");
await dlg.getByLabel("Contact name").fill('=HYPERLINK("http://evil.example","x")');
await dlg.locator("input[inputmode=tel]").fill("9000011122");
await dlg.getByLabel("GSTIN").fill("29ABCDE1234F1Z5");
await dlg.getByRole("button", { name: "Save" }).click();
await page.getByText("Customer added").waitFor();
const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
const csv = fs.readFileSync(await csvDl.path(), "utf8");
if (!csv.includes(`'=HYPERLINK`) || /(^|,)=HYPERLINK/m.test(csv)) throw new Error("CSV formula injection not neutralised");
step("CSV export neutralises formula injection");

// Duplicate phone numbers are refused (would let two people share a login)
await page.getByRole("button", { name: "Add customer" }).click();
await dlg.getByLabel("Contact name").fill("Duplicate Person");
await dlg.locator("input[inputmode=tel]").fill("9000011122");
await dlg.getByRole("button", { name: "Save" }).click();
await dlg.getByText("already belongs to another login").waitFor();
await page.keyboard.press("Escape");
step("duplicate phone number rejected");

// Activity log records what happened, including failed sign-ins
await page.goto(base + "#/activity");
await page.getByText("Customer added").first().waitFor();
await page.getByText("Data cleared / reloaded").first().waitFor();
step("activity log shows who added the customer and who reloaded the data");

// Damaged saved data is replaced instead of crashing the app
await page.evaluate(() => localStorage.setItem("anmol-gas-demo:db", "{not valid json"));
await page.reload();
await page.getByRole("heading", { name: /Owner login|Good day|Activity log/ }).first().waitFor();
await page.evaluate(() => localStorage.setItem("anmol-gas-demo:db", JSON.stringify({ version: 6, users: "oops" })));
await page.reload();
await page.getByText("Saved demo data was damaged").waitFor();
step("corrupted saved data recovered without a crash");

// Guessing the owner PIN locks the form
await page.evaluate(() => { localStorage.removeItem("anmol-gas-demo:session"); sessionStorage.clear(); });
await page.goto(base + "#/"); await page.reload();
for (let i = 0; i < 5; i++) {
  await page.getByLabel("PIN digit 1").fill("9876");
  await page.getByRole("button", { name: "Unlock" }).click();
}
await page.getByText(/Too many wrong PINs\. Try again in/).waitFor();
if (!(await page.getByRole("button", { name: "Unlock" }).isDisabled())) throw new Error("lock should disable the form");
step("5 wrong PINs lock the owner login");

// The failed attempts show up for the owner
await page.evaluate(() => localStorage.removeItem("anmol-gas-demo:attempts:owner-pin"));
await loginAs("u-owner");
await page.goto(base + "#/activity");
await page.getByText(/failed sign-in attempts? in the last 24 hours/).waitFor();
step("owner sees failed sign-in attempts in the activity log");

await browser.close();
server.close();
if (errors.length) { console.error("Page errors:\n" + errors.join("\n")); process.exit(1); }
console.log("All flows passed");
