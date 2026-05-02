#!/usr/bin/env bun
// Dogfooding helper: point the opencode plugin cache at this local checkout
// instead of the published npm version. After restarting your opencode TUI
// session, /tetris-battle loads code straight from this repo. To switch back
// to the upstream release, run:
//
//   bunx opencode-tetris-battle upgrade
//
// The upgrade command nukes the cache entry (which removes our symlink, not
// the repo it points at) and reinstalls @latest from npm. Symmetric.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const pkg = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
) as { name: string; version: string };

const PKG_NAME = pkg.name;
// We mimic the canonical install spec opencode uses on `opencode plugin
// <name>@latest`. Our `upgrade` CLI nukes anything matching `<name>@*`, so the
// exact spec doesn't matter for the round-trip, but `@latest` keeps things
// recognisable in the cache listing.
const SPEC = `${PKG_NAME}@latest`;

const xdgCacheHome = () =>
  process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.trim()
    ? process.env.XDG_CACHE_HOME
    : join(homedir(), ".cache");

const cacheDir = join(xdgCacheHome(), "opencode", "packages", SPEC);
const moduleDir = join(cacheDir, "node_modules", PKG_NAME);

console.log(`-> repo:  ${repoRoot}`);
console.log(`-> cache: ${cacheDir}`);

// Ensure the cache scaffolding exists. opencode normally creates this on its
// first install, but on a clean machine the directory may not be there yet.
if (!existsSync(cacheDir)) {
  console.log(`-> creating cache dir`);
  mkdirSync(cacheDir, { recursive: true });
  // Minimal manifest so npm/opencode can `read` this dir without choking.
  writeFileSync(
    join(cacheDir, "package.json"),
    JSON.stringify({ dependencies: { [PKG_NAME]: "link:local" } }, null, 2),
  );
}
mkdirSync(dirname(moduleDir), { recursive: true });

// Remove the existing module directory (real install OR a stale link from a
// previous `dev:link`). `rmSync` on a symlink removes the link itself, never
// the target, so this is safe even if `moduleDir` already points at our repo.
if (existsSync(moduleDir)) {
  console.log(`-> removing existing ${moduleDir}`);
  rmSync(moduleDir, { recursive: true, force: true });
}

// Junction on Windows: works for directories, no admin/Developer Mode
// required. Plain symlink elsewhere.
const linkType = platform() === "win32" ? "junction" : "dir";
console.log(`-> linking (${linkType}) ${moduleDir} -> ${repoRoot}`);
symlinkSync(repoRoot, moduleDir, linkType);

console.log(`
linked. restart your opencode tui session, then /tetris-battle loads from
this repo. to switch back to the upstream release:

  bunx ${PKG_NAME} upgrade
`);
