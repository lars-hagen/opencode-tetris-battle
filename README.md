# opencode-tetris-battle

Multiplayer Tetris Battle for the OpenCode TUI.

Play side-by-side terminal Tetris with live opponent boards, garbage attacks, private room codes, and quick matchmaking. The game uses a hosted Convex backend for rooms, reactive board sync, attacks, and match results.

## Install

```sh
opencode plugin opencode-tetris-battle@latest --global
```

Restart OpenCode, then run:

```text
/tetris-battle
```

## Upgrade

The OpenCode plugin cache keys installs by literal spec, so re-running
`opencode plugin ...@latest` after a release is a no-op until the cache is
busted. Use either of the following to pull a new version cleanly:

From any shell (no clone needed):

```sh
bunx opencode-tetris-battle upgrade
```

(equivalent: `npx opencode-tetris-battle upgrade`, `pnpm dlx opencode-tetris-battle upgrade`)

From inside OpenCode:

```text
/tetris-battle-update
```

From a clone of this repo:

```sh
bun run upgrade
```

Restart your OpenCode TUI session afterwards so the new plugin code loads.

## Play

### Matchmaking

1. Open `/tetris-battle` in two OpenCode windows.
2. Press `M` in both windows.
3. Press `R` in both windows when paired.

### Private room

1. Host presses `N` to create a numeric room code.
2. Guest presses `J`, types the room code, then presses Enter.
3. Both players press `R` to ready.

## Controls

Splash:

- Any key enters the lobby.
- `Q` closes the dialog.

Lobby:

- `N` creates a private room.
- `J` enters room-code typing mode (4 numeric digits).
- `Enter` joins the typed room code.
- `M` starts matchmaking.
- `R` toggles ready.
- `Q` opens the quit confirm; press `Q` again to confirm or `Esc` to cancel.

Room (waiting / countdown):

- `R` toggles ready.
- `L` opens the leave-to-lobby confirm; press `L` again to confirm or `Esc` to cancel.
- `Q` opens the quit confirm.

Game:

- `←` / `A` moves left.
- `→` / `D` moves right.
- `↑` / `W` rotates.
- `↓` / `S` soft drops.
- `Space` hard drops.
- `C` holds.
- `P` pauses.
- `L` returns to the lobby (double-press to confirm).
- `Q` quits (double-press to confirm).

Pause:

- `P` resumes — only `P`, `L`, and `Q` do anything while paused; other keys are ignored.
- `L` opens the leave-to-lobby confirm.
- `Q` opens the quit confirm.

Match over:

- `R` rematches in the same room.
- `L` returns to the lobby.
- `Q` quits.

## Hosted backend

The plugin works out of the box with the public hosted Tetris Battle backend.

## Development

```sh
bun install
bun run typecheck
bunx convex dev --once --typecheck=disable
```

## License

MIT
