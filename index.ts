import type { Plugin } from "@opencode-ai/plugin";

// Server-side plugin entry. Two responsibilities:
//
// 1. Register `tetris-battle` as a real opencode command via the
//    `config` hook so the prompt-submit handler in
//    packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:793
//    routes `/tetris-battle update` (with a SPACE) through
//    `client.session.command(...)` and our `command.execute.before`
//    hook fires.
//
// 2. Bridge to the TUI process by POSTing raw JSON to the server's
//    own `/tui/publish` endpoint. We do NOT use
//    `client.tui.executeCommand` — that path was tested through
//    1.0.17–1.0.25 and consistently delivered an envelope with
//    `properties: {}` to the TUI plugin's bus listener, the
//    `command` field stripped somewhere between SDK encode and
//    bus dispatch. `/tui/publish` accepts a Schema.Union of bare
//    `TuiEvent.*.properties` shapes (no rename, no alias map) and
//    is exactly the path `appendPrompt` uses, which works.
//
// Why raw `fetch` and not the SDK: by hand-crafting the JSON and
// posting straight at the HttpApi route, we bypass whatever Effect
// Schema encode step on the SDK side was eating the `command`
// field. The server-side decode step is a plain `Schema.Struct`
// match against `TuiEvent.CommandExecute.properties` ({command:
// String}), so the field arrives intact. The publish handler then
// calls `bus.publish(TuiEvent.CommandExecute, ctx.payload.properties)`
// verbatim, and the TUI's `event.on(TuiEvent.CommandExecute.type,
// evt => command.trigger(evt.properties.command))` listener at
// app.tsx:751 dispatches to our registered TUI plugin command by
// its `value` (`opencode.tetris.battle` or
// `opencode.tetris.battle.update`).

const id = "opencode-tetris-battle";

const SENTINEL = "__TETRIS_BATTLE_HANDLED__";

const publishCommand = async (serverUrl: URL, command: string) => {
  const url = new URL("/tui/publish", serverUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "tui.command.execute",
      properties: { command },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`tui.publish failed ${res.status}: ${text}`);
  }
};

const server: Plugin = async ({ serverUrl }) => {
  return {
    async config(cfg) {
      cfg.command ??= {};
      cfg.command["tetris-battle"] = {
        // Empty template — we never want the LLM to actually run.
        // The `command.execute.before` hook below dispatches to the
        // TUI and then throws the sentinel to abort the prompt
        // fiber before the empty template reaches the model.
        template: "",
        description: "Tetris Battle (use `/tetris-battle update` to update)",
      };
    },
    async "command.execute.before"(input) {
      if (input.command !== "tetris-battle") return;
      const arg = (input.arguments ?? "").trim().split(/\s+/)[0] ?? "";
      const target =
        arg === "update"
          ? "opencode.tetris.battle.update"
          : "opencode.tetris.battle";
      await publishCommand(serverUrl, target);
      // Abort the prompt fiber so the empty template never reaches
      // the LLM. The TUI side has already received the bus event
      // and triggered the registered command's onSelect.
      throw new Error(SENTINEL);
    },
  };
};

export default {
  id,
  server,
};
