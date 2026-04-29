import type { Plugin } from "@opencode-ai/plugin";

// Server-side plugin entry. Currently a no-op shell, kept so the
// package's `exports['./server']` target stays valid for opencode's
// dual-target plugin loader (so a single `opencode plugin install`
// call wires the plugin into both opencode.json and tui.json on
// fresh installs). All command registrations live on the TUI side
// (see tui.tsx) — server->TUI bus bridging proved unreliable and
// the dual-slash pattern is what battle-tested plugins like
// opencode-secrets use.

const id = "opencode-tetris-battle";

const server: Plugin = async () => {
  return {};
};

export default {
  id,
  server,
};
