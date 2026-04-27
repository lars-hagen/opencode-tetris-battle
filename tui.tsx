/** @jsxImportSource @opentui/solid */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui"
import { TetrisBattle } from "./tetris-battle.tsx"

const id = "opencode-tetris-battle"
const convexUrlKey = "opencode.tetris-battle.convex-url"
const defaultConvexUrl = "https://useful-vulture-937.convex.cloud"

const enabled = (options: unknown): boolean => {
  if (!options || typeof options !== "object" || Array.isArray(options)) return true
  const value = (options as Record<string, unknown>).enabled
  return typeof value === "boolean" ? value : true
}

const tui: TuiPlugin = async (api: TuiPluginApi, options: unknown) => {
  if (!enabled(options)) return
  const open = () => {
    api.ui.dialog.replace(() => (
      <TetrisBattle
        api={api}
        convexUrlKey={convexUrlKey}
        defaultConvexUrl={defaultConvexUrl}
        onConfigureUrl={configureUrl}
        onClose={() => api.ui.dialog.clear()}
      />
    ))
    api.ui.dialog.setSize("xlarge")
  }

  const configureUrl = () => {
    const Prompt = api.ui.DialogPrompt
    api.ui.dialog.replace(() => (
      <Prompt
        title="Tetris Battle Convex URL"
        placeholder="https://your-deployment.convex.cloud"
        value={String(api.kv.get(convexUrlKey, defaultConvexUrl))}
        description={() => (
          <box flexDirection="column">
            <text>Paste a compatible Convex deployment URL here.</text>
            <text>Leave unchanged to use the hosted public Tetris Battle backend.</text>
          </box>
        )}
        onCancel={open}
        onConfirm={(value) => {
          const url = value.trim()
          if (url) api.kv.set(convexUrlKey, url)
          open()
        }}
      />
    ))
    api.ui.dialog.setSize("medium")
  }

  const unregister = api.command.register(() => [
    {
      title: "Tetris Battle",
      value: "opencode.tetris.battle",
      category: "Game",
      slash: { name: "tetris-battle" },
      onSelect() {
        open()
      },
    },
    {
      title: "Tetris Battle Convex URL",
      value: "opencode.tetris.battle.convex-url",
      category: "Game",
      slash: { name: "tetris-battle-url" },
      onSelect() {
        configureUrl()
      },
    },
  ])
  api.lifecycle.onDispose(unregister)
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
