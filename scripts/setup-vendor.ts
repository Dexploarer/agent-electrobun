#!/usr/bin/env bun
// Initialise vendor submodules with shallow clones to minimise disk usage.
// Usage: bun scripts/setup-vendor.ts [--webkit]
//
// By default only electrobun-dawn and dawn are fetched (~425 MB combined).
// Pass --webkit to also fetch the WebKit fork (~11.6 GB).

import { spawn } from "bun";

const includeWebKit = process.argv.includes("--webkit");

const modules = [
  "vendor/electrobun-dawn",
  "vendor/dawn",
  ...(includeWebKit ? ["vendor/WebKit"] : []),
];

for (const mod of modules) {
  console.log(`[setup] Initialising ${mod}...`);
  const proc = spawn(
    ["git", "submodule", "update", "--init", "--depth", "1", mod],
    { stdio: ["pipe", "inherit", "inherit"], cwd: import.meta.dir + "/.." },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`[setup] Failed to init ${mod} (exit ${code})`);
    process.exit(1);
  }
}

console.log(`[setup] Done. ${modules.length} vendor submodule(s) ready.`);
if (!includeWebKit) {
  console.log("[setup] Tip: run with --webkit to also fetch vendor/WebKit (~11.6 GB).");
}
