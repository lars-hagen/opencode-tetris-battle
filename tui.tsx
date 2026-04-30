/** @jsxImportSource @opentui/solid */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import pkg from "./package.json" with { type: "json" };
import { TetrisBattle } from "./tetris-battle.tsx";

const id = "opencode-tetris-battle";
const convexUrlKey = "opencode.tetris-battle.convex-url";
const defaultConvexUrl = "https://useful-vulture-937.convex.cloud";
const npmName = "opencode-tetris-battle";
const currentVersion: string = pkg.version;

const enabled = (options: unknown): boolean => {
  if (!options || typeof options !== "object" || Array.isArray(options))
    return true;
  const value = (options as Record<string, unknown>).enabled;
  return typeof value === "boolean" ? value : true;
};

const fetchLatestVersion = async (): Promise<string | null> => {
  // npm registry returns the package metadata; the `dist-tags.latest` field
  // is the current "latest" tag. AbortController guards against a hung request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`https://registry.npmjs.org/${npmName}`, {
      signal: controller.signal,
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { "dist-tags"?: { latest?: string } };
    return data["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Compare two semver strings naively. Returns true if `a` < `b`.
const isOlder = (a: string, b: string): boolean => {
  const parse = (s: string) => s.split(".").map((n) => parseInt(n, 10) || 0);
  const aa = parse(a);
  const bb = parse(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
};

const tui: TuiPlugin = async (api: TuiPluginApi, options: unknown) => {
  if (!enabled(options)) return;

  const checkUpdate = async () => {
    const latest = await fetchLatestVersion();
    if (!latest) return null;
    if (!isOlder(currentVersion, latest)) return null;
    return latest;
  };

  const installUpdate = async (version: string) => {
    api.ui.toast({
      variant: "info",
      title: "Tetris Battle",
      message: `installing v${version}...`,
    });
    const result = await api.plugins.install(`${npmName}@${version}`, {
      global: true,
    });
    if (!result.ok) {
      api.ui.toast({
        variant: "error",
        title: "Tetris Battle",
        message: result.message,
      });
      return false;
    }
    api.ui.toast({
      variant: "success",
      title: "Tetris Battle",
      message: `installed v${version} · restart opencode to load`,
      duration: 8000,
    });
    return true;
  };

  const open = () => {
    api.ui.dialog.replace(() => (
      <TetrisBattle
        api={api}
        convexUrlKey={convexUrlKey}
        defaultConvexUrl={defaultConvexUrl}
        currentVersion={currentVersion}
        checkUpdate={checkUpdate}
        installUpdate={installUpdate}
        onClose={() => api.ui.dialog.clear()}
      />
    ));
    api.ui.dialog.setSize("xlarge");
  };

  const runUpdate = async () => {
    api.ui.toast({
      variant: "info",
      title: "Tetris Battle",
      message: `checking for updates · current v${currentVersion}`,
    });
    const latest = await fetchLatestVersion();
    if (!latest) {
      api.ui.toast({
        variant: "warning",
        title: "Tetris Battle",
        message: "could not reach npm registry",
      });
      return;
    }
    if (!isOlder(currentVersion, latest)) {
      api.ui.toast({
        variant: "success",
        title: "Tetris Battle",
        message: `already on v${currentVersion} · latest is v${latest}`,
      });
      return;
    }
    await installUpdate(latest);
  };

  // Slash commands register straight from the TUI plugin via the
  // `slash` field on `TuiCommand`. Opencode parses `/tetris-battle`
  // and `/tetris-battle-update` and invokes the matching `onSelect`.
  // No server-side bridge needed.
  const unregister = api.command.register(() => [
    {
      title: "Tetris Battle",
      value: "opencode.tetris.battle",
      category: "Game",
      slash: { name: "tetris-battle" },
      onSelect() {
        open();
      },
    },
    {
      title: "Tetris Battle · update",
      value: "opencode.tetris.battle.update",
      category: "Game",
      slash: { name: "tetris-battle-update" },
      onSelect() {
        void runUpdate();
      },
    },
  ]);
  api.lifecycle.onDispose(unregister);
};

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default plugin;
