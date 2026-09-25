// Sanity check for the mock data: run with `npx tsx scripts/check-seed.ts`
import { buildSeed } from "../src/lib/seed";
import { computeStock } from "../src/lib/engine";
import { computeAlerts, customerBalances, stockTotals, salesTotals } from "../src/lib/selectors";

const times = process.argv.slice(2).length ? process.argv.slice(2) : ["2026-09-25T09:30:00Z", "2026-09-25T02:00:00Z", "2026-09-24T19:10:00Z"];
for (const t of times) {
  const now = new Date(t).getTime();
  const t0 = Date.now();
  const db = buildSeed(now);
  const ms = Date.now() - t0;
  const stock = computeStock(db.movements);
  const bal = customerBalances(db);
  const alerts = computeAlerts(db, stock, bal, now);
  const neg = Object.entries(stock).flatMap(([loc, s]) => Object.entries(s).flatMap(([size, st]) => Object.entries(st).filter(([, q]) => q < 0 && !["OPENING", "PLANT", "LOSS"].includes(loc) && !loc.startsWith("CUST:")).map(([k, q]) => `${loc} ${size} ${k} ${q}`)));
  const json = JSON.stringify(db);
  const future = db.deliveries.filter((d) => new Date(d.ts).getTime() > now).length + db.movements.filter((m) => new Date(m.ts).getTime() > now).length;
  console.log(`\n== now ${t} built in ${ms}ms, size ${(json.length / 1024).toFixed(0)} KB`);
  console.log(`movements ${db.movements.length}, deliveries ${db.deliveries.length} (pending ${db.deliveries.filter((d) => d.status === "pending").length}, rejected ${db.deliveries.filter((d) => d.status === "rejected").length}), invoices ${db.invoices.length}, payments ${db.payments.length}, loads ${db.loadSheets.length}`);
  console.log("future-dated records:", future, "negative stock:", neg);
  console.log("warehouse:", JSON.stringify(stockTotals(db, stock).warehouse));
  console.log("sales:", salesTotals(db, now));
  const kinds: Record<string, number> = {};
  alerts.forEach((a) => (kinds[a.kind] = (kinds[a.kind] ?? 0) + 1));
  console.log("alerts:", kinds);
  alerts.forEach((a) => console.log("  -", a.title));
}
