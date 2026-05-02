#!/usr/bin/env bun
// Stable upgrade entry point for the published plugin.
//
// `opencode plugin <spec>` keys its package cache by literal install spec, so
// re-running with `@latest` after a new release is a no-op until the cache is
// busted. This script wipes every cached `opencode-tetris-battle@*` entry
// (including the sticky `@latest` one) and then re-runs the install.
//
// Run with:  bunx opencode-tetris-battle upgrade
// or, from a clone:  bun run upgrade
//
// Restart your opencode TUI session afterwards so the new plugin code loads.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PKG_NAME = "opencode-tetris-battle";

const cacheRoot = join(homedir(), ".cache", "opencode", "packages");
if (existsSync(cacheRoot)) {
  const stale = readdirSync(cacheRoot).filter((entry) =>
    entry.startsWith(`${PKG_NAME}@`),
  );
  for (const entry of stale) {
    console.log(`-> rm ${entry}`);
    rmSync(join(cacheRoot, entry), { recursive: true, force: true });
  }
  if (stale.length === 0) {
    console.log(`-> cache clean (no entries for ${PKG_NAME})`);
  }
} else {
  console.log(`-> no opencode cache yet at ${cacheRoot}`);
}

console.log(`-> opencode plugin ${PKG_NAME}@latest --global --force`);
execSync(`opencode plugin ${PKG_NAME}@latest --global --force`, {
  stdio: "inherit",
});

console.log(`\nready. restart your opencode tui session, then /tetris-battle`);
