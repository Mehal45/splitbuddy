// Builds preview/: a portable copy of the app (index.html + app.js + app.css)
// that runs from any URL or sub-path, e.g. a shared preview link.
// Uses the same source as the Next.js app; Vercel deploys use `next build`.
// Run after `npm run build` (reuses the compiled Tailwind CSS from out/).
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const dst = path.resolve("preview");
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst);

const cssDir = path.resolve("out/_next/static/chunks");
const css = fs.readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(cssDir, f), "utf8")).join("\n");
fs.writeFileSync(path.join(dst, "app.css"), css);

await build({
  entryPoints: ["scripts/preview-entry.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  alias: { "@": path.resolve("src") },
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: path.join(dst, "app.js"),
  logLevel: "error",
});

const theme = `(function(){try{var t=localStorage.getItem('anmol-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;
fs.writeFileSync(path.join(dst, "index.html"), `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anmol Gas Agency</title>
<meta name="description" content="Demo: stock, deliveries, approvals and billing for a Bharat Gas distributor in Bangalore.">
<script>${theme}</script>
<link rel="stylesheet" href="app.css">
</head>
<body class="min-h-dvh antialiased">
<div id="root"></div>
<script src="app.js"></script>
</body>
</html>
`);
for (const f of fs.readdirSync(dst)) console.log(f, (fs.statSync(path.join(dst, f)).size / 1024).toFixed(0) + " KB");
