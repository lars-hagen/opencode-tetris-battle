#!/usr/bin/env bun
// End-to-end install dry-run for the published plugin:
//  1. Waits for npm to expose the version listed in package.json.
//  2. Wipes every cached `opencode-tetris-battle@*` entry under the opencode
//     plugin cache (the cache is keyed by literal install spec and never
//     re-resolved, so without this step `opencode plugin` is a no-op).
//  3. Invokes `opencode plugin <name>@<version>` to perform a clean install.
//
// Run with:  bun run install:test
// Restart your opencode TUI session afterwards so the new plugin code loads.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

const spec = `${pkg.name}@${pkg.version}`;
console.log(`-> install dry-run for ${spec}`);

// 1. Wait until npm has the version. CI publishes on tag push and usually
//    takes < 60s; we poll up to 5min before giving up.
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const startedAt = Date.now();

const npmHasVersion = (): boolean => {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["view", spec, "version"],
    { encoding: "utf8" },
  );
  return result.status === 0 && result.stdout.trim() === pkg.version;
};

process.stdout.write(`-> polling npm for ${spec}`);
while (!npmHasVersion()) {
  if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
    console.error("\n   timed out after 5 minutes");
    process.exit(1);
  }
  process.stdout.write(".");
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
console.log(` ok`);

// 2. Bust every cached entry for this plugin (any version, any spec).
const cacheRoot = join(homedir(), ".cache", "opencode", "packages");
if (existsSync(cacheRoot)) {
  const stale = readdirSync(cacheRoot).filter((entry) =>
    entry.startsWith(`${pkg.name}@`),
  );
  for (const entry of stale) {
    console.log(`-> rm ${entry}`);
    rmSync(join(cacheRoot, entry), { recursive: true, force: true });
  }
  if (stale.length === 0) {
    console.log(`-> cache clean (no entries for ${pkg.name})`);
  }
}

// 3. Run opencode plugin install. Inherit stdio so output streams live.
console.log(`-> opencode plugin ${spec}`);
execSync(`opencode plugin ${spec}`, { stdio: "inherit" });

console.log(`\nready. restart your opencode tui session, then /tetris-battle`);
