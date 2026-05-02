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

const upgrade = () => {
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
