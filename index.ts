import type { Plugin } from "@opencode-ai/plugin";

// Server-side plugin. Two responsibilities:
//
//   1. `config` hook registers `tetris-battle` as a real opencode
//      command. Without this, `/tetris-battle` is treated as raw
//      prompt text and `command.execute.before` never fires.
//
//   2. `command.execute.before` hook intercepts `/tetris-battle`
//      and `/tetris-battle update`, publishes a TUI command-execute
//      event through the in-process SDK client, then throws the
//      sentinel to suppress the empty prompt template from going
//      to the LLM.
//
// The SDK's `client.tui.publish` routes through Server.Default()
// .app.fetch in-process, so no real bound port is needed. The TUI
// app subscribes to `tui.command.execute` and dispatches via its
// command registry to the matching `onSelect` in tui.tsx.
//
// Note: the legacy `/tui/execute-command` Hono route at
// packages/opencode/src/server/routes/instance/tui.ts:280-298 has
// a bug where unknown command aliases drop the `command` field to
// undefined, which JSON.stringify strips, leaving the TUI with
// `{properties: {}}`. We avoid that route entirely by publishing
// the bus event directly via /tui/publish.

const id = "opencode-tetris-battle";
const SENTINEL = "__TETRIS_BATTLE_HANDLED__";

declare const require: ((m: string) => unknown) | undefined;
declare const process: { env?: Record<string, string | undefined> } | undefined;

const requireDyn = (mod: string): unknown => {
  try {
    return typeof require === "function" ? require(mod) : null;
  } catch {
    return null;
  }
};

interface FsLike {
  mkdirSync: (p: string, opts: { recursive: boolean }) => void;
  appendFileSync: (p: string, data: string, enc: string) => void;
}
interface OsLike {
  homedir: () => string;
}
interface PathLike {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
}

const fsMod = (requireDyn("node:fs") ?? requireDyn("fs")) as FsLike | null;
const osMod = (requireDyn("node:os") ?? requireDyn("os")) as OsLike | null;
const pathMod = (requireDyn("node:path") ??
  requireDyn("path")) as PathLike | null;

const HOME: string =
  osMod?.homedir() ?? process?.env?.USERPROFILE ?? process?.env?.HOME ?? ".";

const LOG_PATH: string = pathMod
  ? pathMod.join(
      HOME,
      ".local",
      "share",
      "opencode",
      "log",
      "tetris-bridge.log",
    )
  : `${HOME}/.local/share/opencode/log/tetris-bridge.log`;

const log = (line: string) => {
  if (!fsMod || !pathMod) return;
  try {
    fsMod.mkdirSync(pathMod.dirname(LOG_PATH), { recursive: true });
    fsMod.appendFileSync(
      LOG_PATH,
      `${new Date().toISOString()} ${line}\n`,
      "utf8",
    );
  } catch {
    // ignore — diagnostic only.
  }
};

const server: Plugin = async (ctx) => {
  log(`server plugin init id=${id} directory=${ctx.directory}`);

  // Publish a `tui.command.execute` bus event through the SDK
  // client. ctx.client uses a custom fetch that routes via
  // Server.Default().app.fetch so this is fully in-process.
  // Must be called as a method on `client.tui` so the SDK's
  // internal `this._client` binding resolves; extracting the
  // function to a local reference loses `this`.
  const publishToTui = async (target: string): Promise<boolean> => {
    const client = ctx.client as unknown as {
      tui?: {
        publish?: (args: {
          body: { type: string; properties: Record<string, unknown> };
        }) => Promise<{ response?: { ok?: boolean; status?: number } }>;
      };
    };
    if (typeof client?.tui?.publish !== "function") {
      log(`publishToTui client.tui.publish unavailable`);
      return false;
    }
    try {
      const result = await client.tui.publish({
        body: {
          type: "tui.command.execute",
          properties: { command: target },
        },
      });
      const ok = result?.response?.ok ?? true;
      log(`publishToTui target=${target} ok=${ok}`);
      return ok;
    } catch (err) {
      log(`publishToTui error=${(err as Error).message}`);
      return false;
    }
  };

  return {
    async config(cfg) {
      cfg.command ??= {};
      cfg.command["tetris-battle"] = {
        template: "",
        description: "Tetris Battle (use `/tetris-battle update` to update)",
      };
      log(`config hook registered tetris-battle command`);
    },
    async "command.execute.before"(input) {
      if (input.command !== "tetris-battle") return;
      const arg = (input.arguments ?? "").trim().split(/\s+/)[0] ?? "";
      const target =
        arg === "update"
          ? "opencode.tetris.battle.update"
          : "opencode.tetris.battle";
      log(`command.execute.before arg=${arg} target=${target}`);
      await publishToTui(target);
      // Sentinel suppresses the prompt fiber so the empty template
      // never reaches the LLM. The TUI side has already received
      // the bus event and triggered the right action.
      throw new Error(SENTINEL);
    },
  };
};

export default {
  id,
  server,
};
