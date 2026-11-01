// Cross-platform `STATIC_EXPORT=1 next build` (works in Windows PowerShell too).
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, STATIC_EXPORT: "1" } });
process.exit(r.status ?? 1);
