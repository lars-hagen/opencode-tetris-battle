#!/usr/bin/env bun
// lbfa-tetris-screens.ts — 5 ANSI mockups of every screen in the
// `lbfa-tetris-battle` opencode plugin. Run: bun lbfa-tetris-screens.ts
//
// One mockup per screen. Pure stdout, only `bunx figlet` as an external dep.
// Target width ~120 cols. Truecolor 24-bit ANSI throughout.

// ─── ANSI primitives ──────────────────────────────────────────────────────
const ESC = "\x1b["
const RESET = `${ESC}0m`
const BOLD = `${ESC}1m`
const DIM = `${ESC}2m`
const ITALIC = `${ESC}3m`
const UNDERLINE = `${ESC}4m`
const REV = `${ESC}7m`

const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`
const bgRgb = (r: number, g: number, b: number) => `${ESC}48;2;${r};${g};${b}m`

// Strip ANSI for width math
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")
const visLen = (s: string) => [...stripAnsi(s)].length
const padR = (s: string, n: number) => s + " ".repeat(Math.max(0, n - visLen(s)))
const padL = (s: string, n: number) => " ".repeat(Math.max(0, n - visLen(s))) + s
const padC = (s: string, n: number) => {
  const slack = Math.max(0, n - visLen(s))
  const l = Math.floor(slack / 2)
  return " ".repeat(l) + s + " ".repeat(slack - l)
}

const BLINK_INDICATOR = "▏" // thin caret-like glyph for input focus

// ─── Canonical Tetris palette (24-bit, official guideline colors) ──────────
// Spec values per Tetris Guideline. We render them at full saturation; the
// dimmed `ghostGlyph` palette below carries its own scaled-down values for
// projection cells, so we don't lose contrast on the live pieces.
const PIECE = {
  I: rgb(0, 255, 255), //  cyan
  O: rgb(255, 255, 0), //  yellow
  T: rgb(170, 0, 255), //  purple
  S: rgb(0, 255, 0), //  green
  Z: rgb(255, 0, 0), //  red
  J: rgb(0, 0, 255), //  blue
  L: rgb(255, 127, 0), //  orange
} as const
type Piece = keyof typeof PIECE

const PIECE_BG = {
  I: bgRgb(0, 200, 200),
  O: bgRgb(210, 200, 0),
  T: bgRgb(140, 0, 210),
  S: bgRgb(0, 200, 0),
  Z: bgRgb(210, 0, 0),
  J: bgRgb(20, 20, 220),
  L: bgRgb(220, 140, 0),
} as const

const C = {
  ink: rgb(232, 232, 240),
  inkSoft: rgb(180, 184, 200),
  muted: rgb(120, 124, 140),
  faint: rgb(80, 84, 100),
  ghost: rgb(96, 100, 120),
  empty: rgb(48, 50, 64),
  panel: rgb(28, 30, 42),
  panelLine: rgb(70, 74, 96),
  dim: rgb(58, 60, 76), // single tertiary shade for dimmed underlays
  accent: rgb(255, 90, 220), // hot pink — brand
  warn: rgb(255, 170, 60),
  ok: rgb(110, 240, 150),
  bad: rgb(255, 70, 90),
  garbage: rgb(145, 145, 155),
  garbageDim: rgb(95, 95, 110),
  // ─── secondary semantic palette (canonical) ──────────────────────────────
  win: rgb(110, 240, 150), // outgoing attacks, success states
  info: rgb(120, 180, 255), // join / lobby / informational
  loss: rgb(255, 110, 130), // opponent / quit / defeat
  gold: rgb(255, 220, 120), // score, prized stats
  cool: rgb(120, 220, 255), // "you" indicator, APM, cool stats
}

const PIECE_ORDER: Piece[] = ["I", "O", "T", "S", "Z", "J", "L"]

// ─── figlet wrapper (cached) ───────────────────────────────────────────────
const figletCache = new Map<string, string[]>()
function figlet(text: string, font = "ANSI Shadow", width = 200): string[] {
  const key = `${font}::${width}::${text}`
  const cached = figletCache.get(key)
  if (cached) return cached
  const proc = Bun.spawnSync(["bunx", "figlet", "-f", font, "-w", String(width), text], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = new TextDecoder().decode(proc.stdout)
  const lines = out.split("\n")
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
  // strip leading entirely-blank lines
  while (lines.length && lines[0].trim() === "") lines.shift()
  // trim shared left padding
  const minLead = Math.min(...lines.filter((l) => l.trim().length).map((l) => l.match(/^ */)![0].length))
  const out2 = lines.map((l) => l.slice(minLead))
  figletCache.set(key, out2)
  return out2
}

function colorBlockGradient(lines: string[], stops: Array<[number, number, number]>): string[] {
  if (stops.length === 0) return lines
  return lines.map((line, i) => {
    const t = lines.length === 1 ? 0 : i / (lines.length - 1)
    const seg = t * (stops.length - 1)
    const a = Math.floor(seg)
    const b = Math.min(stops.length - 1, a + 1)
    const f = seg - a
    const r = Math.round(stops[a][0] + (stops[b][0] - stops[a][0]) * f)
    const g = Math.round(stops[a][1] + (stops[b][1] - stops[a][1]) * f)
    const bl = Math.round(stops[a][2] + (stops[b][2] - stops[a][2]) * f)
    return rgb(r, g, bl) + line + RESET
  })
}

function rainbowPiecesBlock(lines: string[]): string[] {
  // Each consecutive non-space cluster gets next tetromino color
  const cols = PIECE_ORDER.map((p) => PIECE[p])
  return lines.map((line) => {
    let out = ""
    let i = 0
    let prevSpace = true
    for (const ch of line) {
      if (ch === " ") {
        out += ch
        prevSpace = true
      } else {
        if (prevSpace) i = (i + 1) % cols.length
        out += cols[i] + ch
        prevSpace = false
      }
    }
    return out + RESET
  })
}

// ─── Screen separator (the 7-tetromino strip + label) ──────────────────────
function separator(label: string, sub: string): string {
  const pieceStrip = PIECE_ORDER.map((p) => PIECE[p] + "██████" + RESET).join("")
  // label segment
  const left = `${rgb(255, 255, 255)}${BOLD}${label}${RESET}`
  const right = `${C.muted}${sub}${RESET}`
  const lineW = 120
  const inner = ` ${left}  ${C.faint}┃${RESET}  ${right} `
  const dashLen = lineW - visLen(inner) - 2
  const dashes = `${C.panelLine}${"━".repeat(Math.max(0, dashLen))}${RESET}`
  return [
    "",
    `${C.faint}╔${"═".repeat(lineW - 2)}╗${RESET}`,
    `${C.faint}║${RESET}${padR(inner + dashes, lineW - 2)}${C.faint}║${RESET}`,
    `${C.faint}╠${"═".repeat(lineW - 2)}╣${RESET}`,
    `${C.faint}║${RESET}  ${pieceStrip}  ${C.muted}${"·".repeat(60)}${RESET}${padR("", lineW - 2 - visLen("  " + pieceStrip + "  " + "·".repeat(60)))}${C.faint}║${RESET}`,
    `${C.faint}╚${"═".repeat(lineW - 2)}╝${RESET}`,
    "",
  ].join("\n")
}

// ─── Generic chrome / window frame ─────────────────────────────────────────
function windowFrame(title: string, body: string[], width = 120): string[] {
  const top = `${C.panelLine}╭${"─".repeat(width - 2)}╮${RESET}`
  const bot = `${C.panelLine}╰${"─".repeat(width - 2)}╯${RESET}`
  // mac-style dots + title + breadcrumbs
  const dots = `${rgb(255, 95, 86)}●${RESET} ${rgb(255, 189, 46)}●${RESET} ${rgb(39, 201, 63)}●${RESET}`
  const titleSeg = ` ${dots}  ${C.ink}${title}${RESET}  ${C.muted}— opencode tui${RESET}`
  const right = `${C.muted}v1.0.7  •  useful-vulture-937.convex.cloud${RESET} `
  const slack = width - 2 - visLen(titleSeg) - visLen(right)
  const titleBar = `${C.panelLine}│${RESET}${titleSeg}${" ".repeat(Math.max(1, slack))}${right}${C.panelLine}│${RESET}`
  const sep = `${C.panelLine}├${"─".repeat(width - 2)}┤${RESET}`
  const padded = body.map((l) => `${C.panelLine}│${RESET} ${padR(l, width - 4)} ${C.panelLine}│${RESET}`)
  return [top, titleBar, sep, ...padded, bot]
}

// ─── Tetromino board renderer ──────────────────────────────────────────────
// Cell language:  null=empty   "G"=garbage
// "i" "o" "t" "s" "z" "j" "l" = piece colors (filled ██)
// Ghost cells are passed via `opts.ghost` to renderBoard, not stored here.
type Cell = null | "G" | "i" | "o" | "t" | "s" | "z" | "j" | "l"

function cellGlyph(cell: Cell): string {
  if (cell === null) return `${C.empty}· ${RESET}`
  if (cell === "G") return `${C.garbage}▓▓${RESET}`
  const p = cell.toUpperCase() as Piece
  return `${PIECE[p]}██${RESET}`
}

// cleaner ghost glyph — separated so we can tweak independently
function ghostGlyph(p: Piece): string {
  // ~45% intensity of the canonical piece color so projection reads as
  // "where it lands" without competing with the live piece.
  const m: Record<Piece, [number, number, number]> = {
    I: [0, 115, 115],
    O: [120, 120, 0],
    T: [85, 0, 125],
    S: [0, 125, 0],
    Z: [125, 0, 0],
    J: [0, 0, 130],
    L: [125, 65, 0],
  }
  const [r, g, b] = m[p]
  return `${rgb(r, g, b)}░░${RESET}`
}

function emptyBoard(rows = 20, cols = 10): Cell[][] {
  return Array.from({ length: rows }, () => Array<Cell>(cols).fill(null))
}

function renderBoard(
  board: Cell[][],
  opts: {
    ghost?: { piece: Piece; cells: [number, number][] }
    activePiece?: { piece: Piece; cells: [number, number][] }
  } = {},
): string[] {
  const rows = board.length
  const cols = board[0].length
  const ghostSet = new Map<string, Piece>()
  for (const [r, c] of opts.ghost?.cells ?? []) ghostSet.set(`${r},${c}`, opts.ghost!.piece)
  const activeSet = new Map<string, Piece>()
  for (const [r, c] of opts.activePiece?.cells ?? []) activeSet.set(`${r},${c}`, opts.activePiece!.piece)

  const lines: string[] = []
  // top border
  const inner = cols * 2
  lines.push(`${C.panelLine}┌${"─".repeat(inner)}┐${RESET}`)
  for (let r = 0; r < rows; r++) {
    let row = `${C.panelLine}│${RESET}`
    for (let c = 0; c < cols; c++) {
      const aKey = `${r},${c}`
      if (activeSet.has(aKey)) {
        row += `${PIECE[activeSet.get(aKey)!]}██${RESET}`
      } else if (ghostSet.has(aKey)) {
        row += ghostGlyph(ghostSet.get(aKey)!)
      } else {
        row += cellGlyph(board[r][c])
      }
    }
    row += `${C.panelLine}│${RESET}`
    lines.push(row)
  }
  lines.push(`${C.panelLine}└${"─".repeat(inner)}┘${RESET}`)
  return lines
}

// Same as renderBoard but half-scale (one char per cell, no double width)
function renderMiniBoard(board: Cell[][]): string[] {
  const rows = board.length
  const cols = board[0].length
  const lines: string[] = []
  lines.push(`${C.panelLine}┌${"─".repeat(cols)}┐${RESET}`)
  for (let r = 0; r < rows; r++) {
    let row = `${C.panelLine}│${RESET}`
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c]
      if (cell === null) row += `${C.empty}·${RESET}`
      else if (cell === "G") row += `${C.garbage}▓${RESET}`
      else {
        const p = cell.toUpperCase() as Piece
        row += `${PIECE[p]}█${RESET}`
      }
    }
    row += `${C.panelLine}│${RESET}`
    lines.push(row)
  }
  lines.push(`${C.panelLine}└${"─".repeat(cols)}┘${RESET}`)
  return lines
}

// ─── small panel renderer ──────────────────────────────────────────────────
function panel(title: string, rows: string[], width: number, opts: { titleColor?: string } = {}): string[] {
  const tc = opts.titleColor ?? C.inkSoft
  // total width = 1 (┌) + 1 (─) + 1 ( ) + visLen(title) + 1 ( ) + dashes + 1 (┐) = width
  // dashes = width - 5 - visLen(title)
  const dashes = Math.max(0, width - 5 - visLen(title))
  const top = `${C.panelLine}┌─ ${tc}${BOLD}${title}${RESET} ${C.panelLine}${"─".repeat(dashes)}┐${RESET}`
  const bot = `${C.panelLine}└${"─".repeat(width - 2)}┘${RESET}`
  const body = rows.map((r) => `${C.panelLine}│${RESET} ${padR(r, width - 4)} ${C.panelLine}│${RESET}`)
  return [top, ...body, bot]
}

// glue rows of multi-line blocks side by side, with a gap
function joinH(blocks: string[][], gap = 2): string[] {
  const heights = blocks.map((b) => b.length)
  const h = Math.max(...heights)
  const widths = blocks.map((b) => Math.max(...b.map(visLen)))
  const out: string[] = []
  for (let i = 0; i < h; i++) {
    let line = ""
    for (let j = 0; j < blocks.length; j++) {
      const ln = blocks[j][i] ?? ""
      line += padR(ln, widths[j]) + (j < blocks.length - 1 ? " ".repeat(gap) : "")
    }
    out.push(line)
  }
  return out
}

// ─── Mini next-piece preview ───────────────────────────────────────────────
function previewPiece(piece: Piece): string[] {
  const shapes: Record<Piece, [number, number][]> = {
    I: [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ],
    O: [
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
    ],
    T: [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    S: [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    Z: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
    J: [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    L: [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  }
  const cells = new Set(shapes[piece].map(([r, c]) => `${r},${c}`))
  const out: string[] = []
  for (let r = 0; r < 2; r++) {
    let line = ""
    for (let c = 0; c < 4; c++) {
      line += cells.has(`${r},${c}`) ? `${PIECE[piece]}██${RESET}` : `${C.empty}  ${RESET}`
    }
    out.push(line)
  }
  return out
}

// ============================================================================
// SCREEN 1 — Title / splash
// ============================================================================
function screen1(): string[] {
  const W = 120
  const banner = rainbowPiecesBlock(figlet("TETRIS BATTLE", "ANSI Shadow", 200))
  // background star/block field
  const stars = (() => {
    const w = W - 4
    const rows: string[] = []
    const palette = [PIECE.I, PIECE.O, PIECE.T, PIECE.S, PIECE.Z, PIECE.J, PIECE.L, C.muted, C.faint, C.faint, C.faint]
    const seed = 1337
    let s = seed
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 0xffffffff
    }
    for (let r = 0; r < 4; r++) {
      let line = ""
      for (let c = 0; c < w; c++) {
        const v = rand()
        if (v < 0.04) line += palette[Math.floor(rand() * palette.length)] + "▓" + RESET
        else if (v < 0.08) line += C.faint + "·" + RESET
        else if (v < 0.1) line += palette[Math.floor(rand() * 7)] + "·" + RESET
        else line += " "
      }
      rows.push(line)
    }
    return rows
  })()

  // a tetromino "constellation" beneath banner
  const blocks: string[][] = []
  const sample: Piece[] = ["I", "L", "S", "Z", "J", "T", "O"]
  for (const p of sample) blocks.push(previewPiece(p))
  const constellation = joinH(blocks, 4)

  const subtitle = `${C.inkSoft}${ITALIC}Multiplayer  ·  OpenCode TUI${RESET}`
  const hint = `${BOLD}${C.accent}▶${RESET} ${C.ink}press ${BOLD}any key${RESET}${C.ink} to enter lobby${RESET}`
  const hi = `${C.muted}HIGH SCORE${RESET}  ${C.gold}${BOLD}13,370${RESET}    ${C.muted}BEST ATTACK${RESET}  ${C.win}${BOLD}18${RESET}    ${C.muted}MATCHES${RESET}  ${C.ink}47${RESET}`
  const buildLine = `${C.faint}■${RESET} ${C.muted}lbfa-tetris-battle${RESET}  ${C.faint}·${RESET}  ${C.muted}v1.0.7${RESET}  ${C.faint}·${RESET}  ${C.muted}convex: useful-vulture-937${RESET}`
  // Family ribbon — same shape as screens 2-4 so splash belongs to the set.
  const ribbon = `${BOLD}${C.muted}TETRIS BATTLE${RESET}  ${C.faint}//${RESET}  ${C.muted}${BOLD}READY${RESET}        ${C.faint}signed out · press any key${RESET}     ${C.muted}convex${RESET} ${C.win}● connected${RESET}`

  const body: string[] = []
  body.push("")
  body.push(ribbon)
  body.push("")
  body.push(...stars.map((s) => padC(s, W - 4)))
  body.push("")
  // banner centered
  for (const l of banner) body.push(padC(l, W - 4))
  body.push("")
  body.push(padC(subtitle, W - 4))
  body.push("")
  for (const l of constellation) body.push(padC(l, W - 4))
  body.push("")
  body.push(padC(hint, W - 4))
  body.push("")
  body.push(padC(hi, W - 4))
  body.push("")
  body.push(padC(buildLine, W - 4))
  body.push("")

  return windowFrame("/tetris-battle  ›  splash", body, W)
}

// ============================================================================
// SCREEN 2 — Lobby
// ============================================================================
function screen2(): string[] {
  const W = 120
  // Title — ANSI Shadow at constrained width so it lands at ~50 cols and
  // composes with the cards below. Pink → blue → cyan vertical gradient.
  const title = colorBlockGradient(figlet("LOBBY", "ANSI Shadow", 60), [
    [255, 90, 220],
    [120, 130, 255],
    [0, 220, 240],
  ])

  // Buttons / panels
  const innerW = W - 4
  const colW = Math.floor((innerW - 2) / 3) // three side-by-side cards

  const cardCreate = (() => {
    const rows: string[] = []
    rows.push(`${BOLD}${C.win}[N]${RESET}  ${BOLD}${C.ink}CREATE PRIVATE ROOM${RESET}`)
    rows.push("")
    rows.push(`${C.muted}generate a fresh 4-digit code${RESET}`)
    rows.push(`${C.muted}share it with your opponent${RESET}`)
    rows.push("")
    // 4-digit code preview — top/middle/bottom all 8 chars wide.
    rows.push(`${C.faint}┌────────┐${RESET}`)
    rows.push(`${C.faint}│${RESET} ${BOLD}${C.win} 8821 ${RESET} ${C.faint}│${RESET}  ${C.muted}preview${RESET}`)
    rows.push(`${C.faint}└────────┘${RESET}`)
    rows.push("")
    rows.push(`${C.win}● ready when you are${RESET}`)
    return panel("CREATE", rows, colW, { titleColor: C.win })
  })()

  const cardJoin = (() => {
    const rows: string[] = []
    rows.push(`${BOLD}${C.info}[J]${RESET}  ${BOLD}${C.ink}JOIN BY CODE${RESET}`)
    rows.push("")
    rows.push(`${C.muted}type the 4-digit room code${RESET}`)
    rows.push(`${C.muted}your opponent shared${RESET}`)
    rows.push("")
    // input field
    const slot = `${C.panelLine}┌──┐${RESET}`
    const slotBot = `${C.panelLine}└──┘${RESET}`
    const ch1 = `${C.panelLine}│${RESET}${BOLD}${C.info}4 ${RESET}${C.panelLine}│${RESET}`
    const ch2 = `${C.panelLine}│${RESET}${BOLD}${C.info}7 ${RESET}${C.panelLine}│${RESET}`
    const ch3 = `${C.panelLine}│${RESET}${C.muted}_ ${RESET}${C.panelLine}│${RESET}`
    const ch4 = `${C.panelLine}│${RESET}${C.muted}_ ${RESET}${C.panelLine}│${RESET}`
    rows.push(`  ${slot}${slot}${slot}${slot}`)
    rows.push(`  ${ch1}${ch2}${ch3}${ch4}  ${C.info}${BLINK_INDICATOR}${RESET}`)
    rows.push(`  ${slotBot}${slotBot}${slotBot}${slotBot}`)
    rows.push("")
    rows.push(`${C.muted}↵ enter to join · esc to cancel${RESET}`)
    return panel("JOIN", rows, colW, { titleColor: C.info })
  })()

  const cardMatch = (() => {
    const rows: string[] = []
    rows.push(`${BOLD}${C.warn}[M]${RESET}  ${BOLD}${C.ink}QUICK MATCH${RESET}`)
    rows.push("")
    rows.push(`${C.muted}we'll find you a worthy${RESET}`)
    rows.push(`${C.muted}stranger to crush${RESET}`)
    rows.push("")
    // spinner
    rows.push(`  ${C.warn}${BOLD}◐${RESET}  ${C.ink}searching${RESET}${C.muted}...${RESET}`)
    rows.push(`  ${C.muted}queued ${C.ink}00:07${C.muted} · region eu-west${RESET}`)
    rows.push(`  ${C.muted}players online ${C.win}124${RESET}`)
    rows.push("")
    rows.push(`${C.muted}press ${BOLD}M${RESET}${C.muted} again to cancel${RESET}`)
    return panel("MATCH", rows, colW, { titleColor: C.warn })
  })()

  const cards = joinH([cardCreate, cardJoin, cardMatch], 1)

  // Stats card (full width, single line)
  const statsRow = `${C.muted}MATCHES${RESET} ${BOLD}${C.ink}47${RESET}   ${C.faint}·${RESET}   ${C.muted}WINS${RESET} ${BOLD}${C.win}28${RESET}   ${C.faint}·${RESET}   ${C.muted}LOSSES${RESET} ${BOLD}${C.loss}19${RESET}   ${C.faint}·${RESET}   ${C.muted}WIN RATE${RESET} ${BOLD}${C.cool}59%${RESET}   ${C.faint}·${RESET}   ${C.muted}APM AVG${RESET} ${BOLD}${C.ink}68${RESET}   ${C.faint}·${RESET}   ${C.muted}STREAK${RESET} ${BOLD}${C.accent}+5${RESET}`
  const statsPanel = panel("LARS_HAGEN  ·  player profile", [statsRow], innerW, { titleColor: C.accent })

  // Hint bar — canonical `┄ [KEY] verb · [KEY] verb … ┄` shape.
  const hintBar = `${C.faint}┄${RESET} ${BOLD}${C.ink}[N]${RESET} ${C.muted}new${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[J]${RESET} ${C.muted}join${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[M]${RESET} ${C.muted}match${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[R]${RESET} ${C.muted}ready${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[Q]${RESET} ${C.muted}quit${RESET} ${C.faint}┄${RESET}`

  const body: string[] = []
  body.push("")
  // ribbon
  body.push(
    `${BOLD}${C.ink}TETRIS BATTLE${RESET}  ${C.faint}//${RESET}  ${BOLD}${C.accent}LOBBY${RESET}        ${C.muted}signed in as${RESET} ${BOLD}${C.ink}LARS_HAGEN${RESET} ${C.faint}(playerId 5e3a91c4)${RESET}     ${C.muted}convex${RESET} ${C.win}● connected${RESET}`,
  )
  body.push("")
  for (const l of title) body.push(padC(l, innerW))
  body.push("")
  body.push(...cards)
  body.push("")
  body.push(...statsPanel)
  body.push("")
  body.push(padC(hintBar, innerW))
  body.push("")

  return windowFrame("/tetris-battle  ›  lobby", body, W)
}

// ============================================================================
// SCREEN 3 — Active match (HERO SHOT)
// ============================================================================
function screen3(): string[] {
  const W = 120

  // ── YOUR board: 20×10 ─────────────────────────────────────────────────────
  const me = emptyBoard(20, 10)
  // Build a realistic stack: messy lower rows + 2 garbage rows at the bottom
  // bottom 2 rows: garbage with a single hole each
  for (let c = 0; c < 10; c++) {
    me[19][c] = c === 4 ? null : "G"
    me[18][c] = c === 7 ? null : "G"
  }
  // landed pieces — sculpted stack
  const landed: Array<[number, number, Piece]> = [
    // row 17
    [17, 0, "L"],
    [17, 1, "L"],
    [17, 2, "Z"],
    [17, 3, "Z"],
    [17, 5, "S"],
    [17, 6, "S"],
    [17, 8, "J"],
    [17, 9, "J"],
    [16, 0, "L"],
    [16, 2, "Z"],
    [16, 3, "S"],
    [16, 4, "S"],
    [16, 6, "T"],
    [16, 7, "T"],
    [16, 8, "T"],
    [16, 9, "J"],
    [15, 0, "O"],
    [15, 1, "O"],
    [15, 3, "L"],
    [15, 6, "T"],
    [15, 8, "I"],
    [15, 9, "I"],
    [14, 0, "O"],
    [14, 1, "O"],
    [14, 3, "L"],
    [14, 4, "L"],
    [14, 9, "I"],
    [13, 1, "Z"],
    [13, 4, "L"],
    [13, 9, "I"],
    [12, 1, "Z"],
    [12, 2, "Z"],
  ]
  for (const [r, c, p] of landed) me[r][c] = p.toLowerCase() as Cell

  // active T piece falling around row 4–5, col 4
  const active = {
    piece: "T" as Piece,
    cells: [
      [4, 4],
      [5, 3],
      [5, 4],
      [5, 5],
    ] as [number, number][],
  }
  // ghost piece all the way down — projects onto the first occupied row
  // in cols 3-5 (which is row 13). T occupies its own bottom row + center,
  // so it lands at rows 11-12.
  const ghost = {
    piece: "T" as Piece,
    cells: [
      [11, 4],
      [12, 3],
      [12, 4],
      [12, 5],
    ] as [number, number][],
  }

  const meBoard = renderBoard(me, { activePiece: active, ghost })

  // ── opponent board: 20×10, smaller scale (mini) ──────────────────────────
  const opp = emptyBoard(20, 10)
  for (let c = 0; c < 10; c++) {
    opp[19][c] = c === 2 ? null : "G"
    opp[18][c] = c === 6 ? null : "G"
    opp[17][c] = c === 6 ? null : "G"
  }
  const oppLanded: Array<[number, number, Piece]> = [
    [16, 0, "I"],
    [16, 1, "L"],
    [16, 2, "L"],
    [16, 3, "L"],
    [16, 7, "Z"],
    [16, 8, "Z"],
    [16, 9, "S"],
    [15, 0, "I"],
    [15, 3, "O"],
    [15, 4, "O"],
    [15, 7, "Z"],
    [15, 8, "S"],
    [15, 9, "S"],
    [14, 0, "I"],
    [14, 3, "O"],
    [14, 4, "O"],
    [14, 8, "T"],
    [14, 9, "S"],
    [13, 0, "I"],
    [13, 4, "J"],
    [13, 8, "T"],
    [13, 9, "T"],
    [12, 4, "J"],
    [12, 5, "J"],
    [12, 6, "J"],
    [12, 8, "T"],
    [11, 6, "L"],
    [10, 6, "L"],
    [10, 7, "L"],
    [10, 8, "L"],
  ]
  for (const [r, c, p] of oppLanded) opp[r][c] = p.toLowerCase() as Cell
  // currently-falling Z piece on opponent
  opp[3][4] = "z"
  opp[3][5] = "z"
  opp[4][5] = "z"
  opp[4][6] = "z"

  const oppBoard = renderBoard(opp)

  // ── side panels (left of YOUR board: HOLD + STATS) ────────────────────────
  const holdPanel = (() => {
    const body: string[] = []
    body.push("")
    body.push(...previewPiece("O").map((l) => "  " + l))
    body.push("")
    return panel("HOLD", body, 18, { titleColor: PIECE.O })
  })()

  const statsPanel = (() => {
    const rows = [
      `${C.muted}SCORE${RESET}`,
      `${BOLD}${C.gold}  47,820${RESET}`,
      "",
      `${C.muted}LEVEL${RESET}    ${BOLD}${C.ink}7${RESET}`,
      `${C.muted}LINES${RESET}    ${BOLD}${C.ink}38${RESET}`,
      `${C.muted}APM${RESET}      ${BOLD}${C.cool}74${RESET}`,
      `${C.muted}PIECES${RESET}   ${BOLD}${C.ink}142${RESET}`,
      "",
      `${C.muted}COMBO${RESET}    ${BOLD}${C.accent}× 4${RESET}`,
      `${C.muted}B2B${RESET}      ${BOLD}${C.win}TETRIS${RESET}`,
    ]
    return panel("STATS", rows, 18, { titleColor: C.cool })
  })()

  const leftCol = [...holdPanel, "", ...statsPanel]

  // ── side panels (right of opponent: NEXT queue + ROOM) ───────────────────
  const nextPanel = (() => {
    const body: string[] = []
    const queue: Piece[] = ["I", "L", "S", "J", "T"]
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]
      const num = `${C.muted}${i + 1}${RESET}`
      const piece = previewPiece(p)
      body.push(`${num}  ${piece[0]}`)
      body.push(`   ${piece[1]}`)
      if (i < queue.length - 1) body.push("")
    }
    return panel("NEXT", body, 18, { titleColor: PIECE.I })
  })()

  // ── center column: warning bar + boards + opponent panel ─────────────────
  // Incoming garbage warning bar — between the two boards (vertical column).
  // `↓` = incoming garbage from opponent, `┃` = empty queue cell.
  const warnCol = (() => {
    const out: string[] = []
    out.push(`${C.bad}${BOLD}┃${RESET}`)
    out.push(`${C.bad}${BOLD}┃${RESET}`)
    out.push(`${C.bad}${BOLD}↓${RESET}`)
    out.push(`${C.bad}${BOLD}┃${RESET}`)
    // 4 rows of incoming
    for (let i = 0; i < 4; i++) out.push(`${C.bad}${BOLD}▰${RESET}`)
    out.push(`${C.warn}${BOLD}↓${RESET}`)
    // a few empty
    for (let i = 0; i < 12; i++) out.push(`${C.faint}┃${RESET}`)
    out.push(" ")
    return out
  })()

  // attack flash markers next to YOUR board.
  // `↗` = outgoing attack we just sent; `▶` is reserved for CTAs.
  const youAttackCol = (() => {
    const out: string[] = []
    out.push(" ")
    out.push(`${C.win}${BOLD}↗ +4${RESET}`)
    out.push(`${C.win}${BOLD}LINES${RESET}`)
    out.push(" ")
    out.push(`${C.accent}${BOLD}T-SPIN${RESET}`)
    out.push(`${C.accent}DOUBLE${RESET}`)
    out.push(" ")
    out.push(`${C.muted}attack${RESET}`)
    out.push(`${C.muted}sent${RESET}`)
    out.push(`${BOLD}${C.cool}12${RESET}`)
    return out
  })()

  // YOU label + board
  const youLabel = `${BOLD}${C.cool}YOU${RESET}  ${C.muted}KASPAROV_BLOX${RESET}  ${C.faint}● eu-west${RESET}`
  const oppLabel = `${BOLD}${C.loss}OPP${RESET}  ${C.muted}TSPIN_QUEEN${RESET}     ${C.faint}● eu-west${RESET}`

  const youBlock = [youLabel, ...meBoard]
  const oppBlock = [oppLabel, ...oppBoard]

  // pad columns to match board height
  while (warnCol.length < youBlock.length) warnCol.push(`${C.faint}┃${RESET}`)
  while (youAttackCol.length < youBlock.length) youAttackCol.push("")
  // NEXT panel — pad to board height with blanks below
  const nextCol = [...nextPanel]
  while (nextCol.length < youBlock.length) nextCol.push("")

  // 5-column layout fills the canvas: HOLD/STATS · attack flash · YOU board ·
  // garbage warning · OPP board · NEXT queue. Gap=2 keeps it dense.
  const center = joinH([leftCol, youAttackCol, youBlock, warnCol, oppBlock, nextCol], 2)

  // top status row across the whole window
  const topStatus = `${BOLD}${C.ink}TETRIS BATTLE${RESET}  ${C.faint}//${RESET}  ${BOLD}${C.accent}LIVE MATCH${RESET}     ${C.muted}ROOM${RESET} ${BOLD}${PIECE.I}4729${RESET}     ${C.muted}TIME${RESET} ${BOLD}${C.ink}02:14${RESET}     ${C.muted}TARGET${RESET} ${BOLD}${C.ink}40 LINES${RESET}     ${C.muted}TICK${RESET} ${BOLD}${C.ink}1.18s${RESET}     ${C.win}● convex sync 38ms${RESET}`

  // attack ticker between boards (header row above warning column)
  const ticker = `${C.faint}┄${RESET} ${BOLD}${C.win}YOU${RESET} ${C.muted}sent${RESET} ${BOLD}${C.win}↗ +12${RESET}   ${C.faint}·${RESET}   ${BOLD}${C.loss}OPP${RESET} ${C.muted}sent${RESET} ${BOLD}${C.loss}↗ +8${RESET}   ${C.faint}·${RESET}   ${C.muted}incoming${RESET} ${BOLD}${C.bad}↓ ▮▮▮▮${RESET}${C.faint}▱▱▱▱${RESET}   ${C.faint}·${RESET}   ${C.muted}garbage queue${RESET} ${BOLD}${C.warn}4${RESET}    ${C.faint}┄${RESET}`

  // bottom controls — canonical `┄ [KEY] verb · [KEY] verb … ┄`
  const ctrl = `${C.faint}┄${RESET} ${BOLD}${C.ink}[←→]${RESET} ${C.muted}move${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[↑]${RESET} ${C.muted}rotate${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[↓]${RESET} ${C.muted}soft${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[SPACE]${RESET} ${C.muted}hard drop${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[C]${RESET} ${C.muted}hold${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[P]${RESET} ${C.muted}pause${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[L]${RESET} ${C.muted}lobby${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[Q]${RESET} ${C.muted}quit${RESET} ${C.faint}┄${RESET}`

  const body: string[] = []
  body.push(topStatus)
  body.push("")
  body.push(padC(ticker, W - 4))
  body.push("")
  for (const l of center) body.push(padC(l, W - 4))
  body.push("")
  body.push(padC(ctrl, W - 4))

  return windowFrame("/tetris-battle  ›  match  ·  room 4729", body, W)
}

// ============================================================================
// SCREEN 4 — Match results (victory)
// ============================================================================
function screen4(): string[] {
  const W = 120
  // VICTORY rainbow
  const victory = colorBlockGradient(figlet("VICTORY", "ANSI Shadow", 200), [
    [255, 220, 80],
    [255, 120, 60],
    [255, 80, 200],
    [120, 100, 255],
    [60, 220, 255],
    [110, 240, 150],
  ])

  // Stats grid: 6 stats, two rows of three. One label per stat (header only) —
  // the value lives in the body, no redundant lowercase repeat.
  const innerW = W - 4
  const cellW = Math.floor(innerW / 3) - 1
  const stat = (label: string, value: string, color: string) => {
    return panel(label, ["", `${BOLD}${color}${padC(value, cellW - 6)}${RESET}`, ""], cellW, { titleColor: color })
  }

  const grid = [
    stat("LINES SENT", "+24", C.win),
    stat("LINES CLEARED", "41", C.cool),
    stat("COMBO MAX", "× 9", C.accent),
  ]
  const grid2 = [stat("APM", "82", C.gold), stat("PIECES", "218", PIECE.I), stat("TIME", "03:47", PIECE.L)]
  const row1 = joinH(grid, 2)
  const row2 = joinH(grid2, 2)

  // ── Winner board: clean field, 2-3 rows of residue, active L mid-air ─────
  const youFinal = emptyBoard(20, 10)
  const youLanded: Array<[number, number, Piece]> = [
    // residue near the bottom — stack stayed manageable through the match
    [19, 0, "L"],
    [19, 1, "L"],
    [19, 2, "L"],
    [19, 6, "S"],
    [19, 7, "S"],
    [19, 8, "I"],
    [19, 9, "I"],
    [18, 0, "L"],
    [18, 6, "S"],
    [18, 7, "Z"],
    [18, 8, "I"],
    [17, 7, "Z"],
    [17, 8, "Z"],
  ]
  for (const [r, c, p] of youLanded) youFinal[r][c] = p.toLowerCase() as Cell
  // active L piece falling — the line-clear that ended the match
  youFinal[6][3] = "l"
  youFinal[7][3] = "l"
  youFinal[7][4] = "l"
  youFinal[7][5] = "l"

  // ── Opponent board: topped-out terrain. Jagged uneven stack, holes,
  // garbage at the bottom. Built procedurally per-column so the surface
  // varies from row 1 to row 6.
  const oppFinal = emptyBoard(20, 10)
  // garbage at the bottom — three rows with shifting holes
  for (let c = 0; c < 10; c++) oppFinal[19][c] = c === 3 ? null : "G"
  for (let c = 0; c < 10; c++) oppFinal[18][c] = c === 8 ? null : "G"
  for (let c = 0; c < 10; c++) oppFinal[17][c] = c === 1 ? null : "G"
  // sculpted stack: per-column fill heights so the silhouette is jagged
  const colHeight = [16, 14, 15, 13, 16, 12, 14, 15, 13, 16] // top row index per column
  // a small set of buried holes
  const holes = new Set(["8,3", "9,5", "11,7", "12,2", "13,5", "14,8"])
  const palette: Piece[] = ["I", "O", "T", "S", "Z", "J", "L"]
  for (let c = 0; c < 10; c++) {
    for (let r = colHeight[c]; r < 17; r++) {
      if (holes.has(`${r},${c}`)) continue
      const piece = palette[(r * 3 + c * 5) % 7]
      oppFinal[r][c] = piece.toLowerCase() as Cell
    }
  }

  const youBoard = renderMiniBoard(youFinal)
  const oppBoard = renderMiniBoard(oppFinal)

  const youCard = (() => {
    const header = `${BOLD}${C.win}WINNER${RESET}  ${C.ink}KASPAROV_BLOX${RESET}  ${C.muted}(you)${RESET}`
    const sub = `${C.muted}playerId 5e3a91c4 · score${RESET} ${BOLD}${C.gold}73,640${RESET}`
    return [header, sub, "", ...youBoard]
  })()
  const oppCard = (() => {
    const header = `${BOLD}${C.loss}DEFEATED${RESET}  ${C.muted}TSPIN_QUEEN${RESET}`
    const sub = `${C.muted}playerId 8a01c772 · score${RESET} ${C.inkSoft}51,210${RESET}`
    return [header, sub, "", ...oppBoard]
  })()
  const boards = joinH([youCard, oppCard], 8)

  // buttons — canonical framed-box vocabulary, also reused on Pause.
  const btn = (key: string, label: string, color: string) => {
    return [
      `${C.panelLine}┌──────────────────────┐${RESET}`,
      `${C.panelLine}│${RESET}  ${BOLD}${color}[${key}]${RESET} ${C.ink}${padR(label, 16)}${RESET}${C.panelLine}│${RESET}`,
      `${C.panelLine}└──────────────────────┘${RESET}`,
    ]
  }
  const btns = joinH([btn("R", "REMATCH", C.win), btn("L", "LOBBY", C.info), btn("Q", "QUIT", C.loss)], 3)

  const headline = `${BOLD}${C.ink}TETRIS BATTLE${RESET}  ${C.faint}//${RESET}  ${BOLD}${C.win}MATCH OVER${RESET}     ${C.muted}ROOM${RESET} ${BOLD}${PIECE.I}4729${RESET}     ${C.muted}DURATION${RESET} ${BOLD}${C.ink}03:47${RESET}     ${C.muted}WINNER${RESET} ${BOLD}${C.win}KASPAROV_BLOX${RESET}     ${C.win}● submitted${RESET}`

  // canonical hint bar; prose subline lives below.
  const hintBar = `${C.faint}┄${RESET} ${BOLD}${C.ink}[R]${RESET} ${C.muted}rematch${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[L]${RESET} ${C.muted}lobby${RESET} ${C.faint}·${RESET} ${BOLD}${C.ink}[Q]${RESET} ${C.muted}quit${RESET} ${C.faint}┄${RESET}`

  const body: string[] = []
  body.push(headline)
  body.push("")
  for (const l of victory) body.push(padC(l, innerW))
  body.push("")
  body.push(padC(`${ITALIC}${C.muted}you outpaced TSPIN_QUEEN by 22,430 points and 13 lines${RESET}`, innerW))
  body.push("")
  body.push(...row1)
  body.push("")
  body.push(...row2)
  body.push("")
  // boards live in their own framed area
  body.push(...panel("FINAL STATE", ["", ...boards.map((l) => padC(l, innerW - 4)), ""], innerW))
  body.push("")
  body.push(...btns.map((l) => padC(l, innerW)))
  body.push("")
  body.push(padC(hintBar, innerW))
  body.push(
    padC(
      `${ITALIC}${C.muted}rematch keeps the room  ·  lobby disconnects  ·  press ${BOLD}${C.ink}R${RESET}${ITALIC}${C.muted} to run it back${RESET}`,
      innerW,
    ),
  )

  return windowFrame("/tetris-battle  ›  results  ·  victory", body, W)
}

// ============================================================================
// SCREEN 5 — Pause overlay (dimmed match + centered modal, clean composition)
// ============================================================================
function screen5(): string[] {
  const W = 120
  const innerW = W - 4

  // Helpers — all dimmed underlay tones reuse C.* tokens. No invented grays.
  const dimEmpty = `${C.empty}· ${RESET}`
  const dimFill = `${C.dim}██${RESET}`
  const dimGarbage = `${C.faint}▓▓${RESET}`
  const dimBorder = `${C.dim}┃${RESET}`

  // Two ghost boards, 20 rows × 10 cols, rendered with muted tones only.
  function ghostBoard(filledRows: number[]): string[] {
    const rows: string[] = []
    rows.push(`${C.dim}┌${"─".repeat(20)}┐${RESET}`)
    for (let r = 0; r < 20; r++) {
      let line = `${C.dim}│${RESET}`
      for (let c = 0; c < 10; c++) {
        const isGarbage = r >= 18 && c !== (r === 19 ? 4 : 7)
        if (isGarbage) line += dimGarbage
        else if (filledRows.includes(r) && (c + r) % 3 !== 0) line += dimFill
        else line += dimEmpty
      }
      line += `${C.dim}│${RESET}`
      rows.push(line)
    }
    rows.push(`${C.dim}└${"─".repeat(20)}┘${RESET}`)
    return rows
  }

  // Faded sidebar panels — same chrome as the live match, but greyed out.
  const fadedPanel = (title: string, h: number) => {
    const w = 18
    const dashes = Math.max(0, w - 5 - title.length)
    const top = `${C.dim}┌─ ${C.faint}${title}${RESET} ${C.dim}${"─".repeat(dashes)}┐${RESET}`
    const mid = Array.from({ length: h }, () => `${C.dim}│${RESET} ${" ".repeat(w - 4)} ${C.dim}│${RESET}`)
    const bot = `${C.dim}└${"─".repeat(w - 2)}┘${RESET}`
    return [top, ...mid, bot]
  }
  const holdGhost = fadedPanel("HOLD", 4)
  const statsGhost = fadedPanel("STATS", 9)
  const nextGhost = fadedPanel("NEXT", 14)

  const youGhost = ghostBoard([12, 13, 14, 15, 16, 17])
  const oppGhost = ghostBoard([10, 11, 12, 13, 14, 15, 16, 17])

  const leftCol = [...holdGhost, "", ...statsGhost]
  const youBlock = [`${C.faint}YOU  KASPAROV_BLOX${RESET}`, ...youGhost]
  const oppBlock = [`${C.faint}OPP  TSPIN_QUEEN${RESET}`, ...oppGhost]
  const warnCol = Array.from({ length: youBlock.length }, () => dimBorder)
  // pad NEXT panel to board-block height with blanks
  const nextCol = [...nextGhost]
  while (nextCol.length < youBlock.length) nextCol.push("")

  // Underlay layout — same 6-column shape as the live hero shot.
  const underlay = joinH([leftCol, youBlock, warnCol, oppBlock, nextCol], 2)

  // Header + control hints, dimmed.
  const headerDim = `${C.faint}TETRIS BATTLE${RESET}  ${C.faint}//${RESET}  ${C.dim}LIVE MATCH${RESET}     ${C.faint}ROOM 4729${RESET}     ${C.faint}TIME 02:14 (frozen)${RESET}     ${C.dim}● paused${RESET}`
  const ctrlDim = `${C.faint}┄ [←→] move · [↑] rotate · [↓] soft · [SPACE] hard · [C] hold · [P] resume · [L] lobby · [Q] quit ┄${RESET}`

  // Assemble the full underlay body.
  const bodyUnderlay: string[] = []
  bodyUnderlay.push(headerDim)
  bodyUnderlay.push("")
  for (const l of underlay) bodyUnderlay.push(padC(l, innerW))
  bodyUnderlay.push("")
  bodyUnderlay.push(padC(ctrlDim, innerW))

  // ── Modal — rounded pink box, drop shadow, framed-box buttons ────────────
  const modalW = 76
  const paused = colorBlockGradient(figlet("PAUSED", "ANSI Shadow", 80), [
    [255, 220, 120],
    [255, 130, 90],
    [255, 90, 220],
  ])
  // Tetromino animation hint — three frames of a T-piece rotating
  const frame1 = ["    " + PIECE.T + "██████" + RESET, "      " + PIECE.T + "██" + RESET + "    "]
  const frame2 = [
    "    " + PIECE.T + "  ██  " + RESET,
    "    " + PIECE.T + "████  " + RESET,
    "    " + PIECE.T + "  ██  " + RESET,
  ]
  const frame3 = ["      " + PIECE.T + "██" + RESET + "    ", "    " + PIECE.T + "██████" + RESET]
  const anim = joinH([frame1, frame2, frame3], 4)

  // Canonical button vocabulary — same as Victory.
  const btn = (key: string, label: string, color: string) => {
    return [
      `${C.panelLine}┌──────────────────────┐${RESET}`,
      `${C.panelLine}│${RESET}  ${BOLD}${color}[${key}]${RESET} ${C.ink}${padR(label, 16)}${RESET}${C.panelLine}│${RESET}`,
      `${C.panelLine}└──────────────────────┘${RESET}`,
    ]
  }
  const btns = joinH([btn("P", "RESUME", C.win), btn("L", "LOBBY", C.info), btn("Q", "QUIT", C.loss)], 1)

  // Build modal body lines (interior, not including border)
  const interior: string[] = []
  interior.push("")
  interior.push(padC(`${C.muted}${ITALIC}match suspended · convex heartbeat held${RESET}`, modalW - 2))
  interior.push("")
  for (const l of paused) interior.push(padC(l, modalW - 2))
  interior.push("")
  for (const l of anim) interior.push(padC(l, modalW - 2))
  interior.push("")
  for (const l of btns) interior.push(padC(l, modalW - 2))
  interior.push("")
  interior.push(padC(`${C.muted}opponent sees:${RESET} ${BOLD}${C.warn}OPPONENT PAUSED${RESET}`, modalW - 2))
  interior.push("")

  // Wrap in rounded hot-pink border — `╭─╮` only, double-line is reserved.
  const modal: string[] = []
  modal.push(`${C.accent}╭${"─".repeat(modalW - 2)}╮${RESET}`)
  for (const l of interior) modal.push(`${C.accent}│${RESET}${padR(l, modalW - 2)}${C.accent}│${RESET}`)
  modal.push(`${C.accent}╰${"─".repeat(modalW - 2)}╯${RESET}`)

  // ── Composition: drop modal at vertical center, replace those rows.
  // Each modal row is a clean line built as:
  //   [dim ┃ side-strip] [gap] [modal row + shadow] [gap] [dim ┃ side-strip]
  // No underlay chars are spliced inside the modal column range — eliminates
  // the bleed problem the v1 column-by-column splice had.
  const modalH = modal.length
  const startRow = Math.max(2, Math.floor((bodyUnderlay.length - modalH) / 2))
  const sidePad = Math.floor((innerW - modalW - 2) / 2) // -2 for the side strips + their gaps

  const composed: string[] = []
  for (let i = 0; i < bodyUnderlay.length; i++) {
    if (i >= startRow && i < startRow + modalH) {
      const idx = i - startRow
      const modalRow = modal[idx]
      // Subtle drop shadow on the right side, except on the very top row.
      const shadow = idx === 0 ? " " : `${rgb(40, 30, 50)}▒${RESET}`
      // Side-strip suggestion: dim board edges peeking out behind the modal.
      const leftStrip = `${C.dim}┃${RESET}`
      const rightStrip = `${C.dim}┃${RESET}`
      const leftFill = " ".repeat(Math.max(0, sidePad - 1))
      const rightFill = " ".repeat(Math.max(0, innerW - sidePad - 1 - modalW - visLen(shadow) - 1))
      composed.push(leftStrip + leftFill + modalRow + shadow + rightFill + rightStrip)
    } else {
      composed.push(bodyUnderlay[i])
    }
  }

  return windowFrame("/tetris-battle  ›  match  ·  paused", composed, W)
}

// ============================================================================
// MAIN — render all 5 screens with separators
// ============================================================================
const all: string[] = []

all.push(separator("SCREEN 01", "splash · /tetris-battle"))
all.push(...screen1())
all.push("")

all.push(separator("SCREEN 02", "lobby · pre-room"))
all.push(...screen2())
all.push("")

all.push(separator("SCREEN 03", "active match · hero shot"))
all.push(...screen3())
all.push("")

all.push(separator("SCREEN 04", "results · victory screen"))
all.push(...screen4())
all.push("")

all.push(separator("SCREEN 05", "pause overlay"))
all.push(...screen5())
all.push("")

// final outro strip
all.push(`${C.faint}╔${"═".repeat(118)}╗${RESET}`)
const outroInner = `  ${PIECE_ORDER.map((p) => PIECE[p] + "██" + RESET).join(" ")}   ${C.muted}lbfa-tetris-battle${RESET}  ${C.faint}·${RESET}  ${C.muted}5 screens rendered${RESET}  ${C.faint}·${RESET}  ${C.muted}fin${RESET}`
all.push(`${C.faint}║${RESET}${padR(outroInner, 118)}${C.faint}║${RESET}`)
all.push(`${C.faint}╚${"═".repeat(118)}╝${RESET}`)

console.log(all.join("\n"))
