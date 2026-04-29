import type { Plugin, PluginInput } from "@opencode-ai/plugin";

// Server-side plugin entry point. This exists because TUI slash commands
// (registered via api.command.register({ slash })) cannot accept arguments
// after the command name — the autocomplete hides the moment a space is
// typed, so something like "/tetris-battle update" never resolves.
//
// Server-side commands DO get split on whitespace (the rest becomes the
// `arguments` string passed to the command.execute.before hook), so we
// register `tetris-battle` as a real opencode command via the `config`
// hook. The hook then bridges back to the TUI by calling
// `client.tui.executeCommand({ command })` with one of two registered
// command values, which the TUI plugin's `command.register` handlers
// pick up and run. After dispatch, throw a sentinel error to suppress
// the prompt from being submitted to the LLM.

const id = "opencode-tetris-battle";

const server: Plugin = async (ctx: PluginInput) => {
  const client = ctx.client;
  return {
    config: async (opencodeConfig: {
      command?: Record<
        string,
        { template: string; description?: string; agent?: string }
      >;
    }) => {
      opencodeConfig.command ??= {};
      opencodeConfig.command["tetris-battle"] = {
        template: "",
        description: "Open Tetris Battle (subcommand: update)",
      };
    },
    "command.execute.before": async (input: {
      command: string;
      sessionID: string;
      arguments: string;
    }) => {
      if (input.command !== "tetris-battle") return;
      const args = (input.arguments || "").trim().split(/\s+/).filter(Boolean);
      const sub = (args[0] || "").toLowerCase();
      const target =
        sub === "update"
          ? "opencode.tetris.battle.update"
          : "opencode.tetris.battle";
      await client.tui.executeCommand({ body: { command: target } });
      // Sentinel error suppresses prompt submission. The opencode prompt
      // runner catches and discards thrown errors from this hook so the
      // user does not see a stack trace; the chat input is left intact
      // but no LLM round-trip is made.
      throw new Error("__TETRIS_BATTLE_HANDLED__");
    },
  };
};

export default {
  id,
  server,
};
