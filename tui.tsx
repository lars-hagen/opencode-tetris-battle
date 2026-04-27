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
        onClose={() => api.ui.dialog.clear()}
      />
    ))
    api.ui.dialog.setSize("xlarge")
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
  ])
  api.lifecycle.onDispose(unregister)
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
