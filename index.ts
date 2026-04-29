import type { Plugin, PluginInput } from "@opencode-ai/plugin";

// Server-side plugin entry. Registers `tetris-battle` as a real opencode
// command (so trailing args like "update" actually parse), then bridges
// back to the TUI by name via client.tui.executeCommand. The TUI side
// registers two `command.register` entries by VALUE (no slash field, to
// avoid duplicating the autocomplete entry the server config already
// produces). One value opens the dialog, the other runs the update flow.

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
      // Bridge to the TUI by command value. The TUI listens on
      // TuiEvent.CommandExecute and dispatches via command.trigger(value)
      // which matches the registered entries by .value.
      await client.tui.executeCommand({ body: { command: target } });
      // Sentinel error suppresses prompt submission to the LLM. The
      // opencode prompt runner catches and discards thrown errors from
      // this hook so the user does not see a stack trace.
      throw new Error("__TETRIS_BATTLE_HANDLED__");
    },
  };
};

export default {
  id,
  server,
};
