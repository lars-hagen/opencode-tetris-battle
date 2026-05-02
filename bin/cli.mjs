#!/usr/bin/env node
// Tiny CLI surface for the published plugin.
//
// Subcommands:
//   upgrade   bust the opencode plugin cache and reinstall @latest
//   version   print the installed plugin version
//
// Anything else (or no args) prints usage. We deliberately keep this minimal:
// the plugin itself is the product, this shim just exists so users can run
// `bunx opencode-tetris-battle upgrade` without cloning the repo.
//
// Plain ESM JS so npx/bunx/pnpm dlx can all invoke it without a TS loader.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_NAME = "opencode-tetris-battle";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const usage = () => {
  console.log(`${PKG_NAME} v${pkg.version}

Usage:
  bunx ${PKG_NAME} upgrade    bust opencode plugin cache and reinstall @latest
  bunx ${PKG_NAME} version    print this plugin's installed version
  bunx ${PKG_NAME} --help     show this message
`);
};

const xdgCacheHome = () =>
  process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.trim()
    ? process.env.XDG_CACHE_HOME
    : join(homedir(), ".cache");

const upgrade = () => {
  // 1. Bust opencode's plugin cache (keyed by literal install spec, so
  //    `@latest` sticks to whatever version it first resolved to).
  const cacheRoot = join(xdgCacheHome(), "opencode", "packages");
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

  // 2. Bust npm's metadata cache so `@latest` resolves to the freshly
  //    published version, not whatever arborist last cached. The key is the
  //    full registry URL; `npm cache clean <key> --force` is the only
  //    documented way to evict a single package without nuking everything.
  //    Falls back silently if npm isn't on PATH (the install below may
  //    still pick up the new version once npm's TTL expires).
  const metadataKey = `make-fetch-happen:request-cache:https://registry.npmjs.org/${PKG_NAME}`;
  try {
    console.log(`-> npm cache clean ${PKG_NAME} (metadata)`);
    execSync(`npm cache clean "${metadataKey}" --force`, {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // npm not installed or cache miss; fine to continue.
  }

  // 3. Reinstall.
  console.log(`-> opencode plugin ${PKG_NAME}@latest --global --force`);
  execSync(`opencode plugin ${PKG_NAME}@latest --global --force`, {
    stdio: "inherit",
  });

  console.log(
    `\nready. restart your opencode tui session, then /tetris-battle`,
  );
};

const cmd = process.argv[2];

if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  usage();
  process.exit(0);
}

if (cmd === "version" || cmd === "--version" || cmd === "-v") {
  console.log(pkg.version);
  process.exit(0);
}

if (cmd === "upgrade") {
  upgrade();
  process.exit(0);
}

console.error(`unknown command: ${cmd}\n`);
usage();
process.exit(1);
