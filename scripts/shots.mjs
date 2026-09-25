// Screenshot helper: node scripts/shots.mjs <outDir> <userId|-> <path> <name> [mobile] ...
// Serves ./out on a local port, logs in via localStorage and captures pages.
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [outDir, ...rest] = process.argv.slice(2);
const jobs = [];
for (let i = 0; i < rest.length; i += 4) jobs.push({ user: rest[i], route: rest[i + 1], name: rest[i + 2], opts: rest[i + 3] ?? "" });

const root = path.resolve("out");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium", ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}) });
fs.mkdirSync(outDir, { recursive: true });
const errors = [];
for (const j of jobs) {
  const mobile = j.opts.includes("mobile");
  const dark = j.opts.includes("dark");
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? "dark" : "light", geolocation: { latitude: 12.925, longitude: 77.594 }, permissions: ["geolocation"] });
  await ctx.addInitScript(({ user, dark, style }) => {
    if (!sessionStorage.getItem("init")) {
      sessionStorage.setItem("init", "1");
      localStorage.setItem("anmol-style", style);
      if (user === "-") localStorage.removeItem("anmol-gas-demo:session");
      else localStorage.setItem("anmol-gas-demo:session", JSON.stringify({ userId: user }));
      localStorage.setItem("anmol-theme", dark ? "dark" : "light");
    }
  }, { user: j.user, dark, style: j.opts.includes("classic") ? "classic" : "studio" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${j.name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${j.name} console: ${m.text()}`); });
  await page.goto(`http://localhost:${port}/#${j.route}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, `${j.name}.png`), fullPage: !j.opts.includes("fold") });
  await ctx.close();
}
await browser.close();
server.close();
console.log(errors.length ? errors.join("\n") : "no page errors");
