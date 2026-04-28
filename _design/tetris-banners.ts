#!/usr/bin/env bun
// tetris-banners.ts — five wildly different ASCII title screens for "TETRIS BATTLE"
// run: bun tetris-banners.ts

// ─── ANSI helpers ──────────────────────────────────────────────────────────
const ESC = "\x1b["
const RESET = `${ESC}0m`
const BOLD = `${ESC}1m`
const DIM = `${ESC}2m`
const ITALIC = `${ESC}3m`

const fg = (n: number) => `${ESC}38;5;${n}m`
const bg = (n: number) => `${ESC}48;5;${n}m`
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`
const bgRgb = (r: number, g: number, b: number) => `${ESC}48;2;${r};${g};${b}m`

// Classic Tetris piece colors (256-color palette approximations)
const TETRIS = {
  I: fg(51), // cyan
  O: fg(220), // yellow
  T: fg(135), // purple
  S: fg(46), // green
  Z: fg(196), // red
  J: fg(33), // blue
  L: fg(208), // orange
  ghost: fg(244),
  white: fg(231),
  black: fg(232),
  hot: fg(201),
  neon: fg(213),
}

// ─── figlet wrapper ────────────────────────────────────────────────────────
function figlet(text: string, font: string, opts: { width?: number } = {}): string[] {
  const args = ["figlet", "-f", font]
  if (opts.width) args.push("-w", String(opts.width))
  args.push(text)
  const proc = Bun.spawnSync(["bunx", ...args], { stdout: "pipe", stderr: "pipe" })
  const out = new TextDecoder().decode(proc.stdout)
  // Trim trailing blank lines, keep internal structure
  const lines = out.split("\n")
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
  return lines
}

// Colorize a figlet block by mapping each non-space char-cluster to a color cycle
function rainbowBlock(lines: string[], colors: string[]): string[] {
  return lines.map((line) => {
    let out = ""
    let colIdx = 0
    let prevSpace = true
    for (const ch of line) {
      if (ch === " ") {
        out += ch
        prevSpace = true
      } else {
        if (prevSpace) colIdx = (colIdx + 1) % colors.length
        out += colors[colIdx] + ch
        prevSpace = false
      }
    }
    return out + RESET
  })
}

// Color whole block in vertical gradient stripes
function gradientBlock(lines: string[], colors: string[]): string[] {
  return lines.map((line, i) => {
    const c = colors[Math.floor((i / Math.max(1, lines.length - 1)) * (colors.length - 1))]
    return c + line + RESET
  })
}

// Flat single-color
function colorBlock(lines: string[], color: string): string[] {
  return lines.map((l) => color + l + RESET)
}

// Visible width (strip ANSI)
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")
const vlen = (s: string) => stripAnsi(s).length

// Pad a colored line on the right to a target visible width
function padRight(line: string, width: number): string {
  const diff = width - vlen(line)
  return diff > 0 ? line + " ".repeat(diff) : line
}

// Center a colored line within a width
function centerInside(line: string, width: number): string {
  const diff = width - vlen(line)
  if (diff <= 0) return line
  const left = Math.floor(diff / 2)
  return " ".repeat(left) + line + " ".repeat(diff - left)
}

// Tetromino shapes (dot = empty, # = filled) for previews
const PIECES: Record<string, { rows: string[]; color: string }> = {
  I: { rows: ["####"], color: TETRIS.I },
  O: { rows: ["##", "##"], color: TETRIS.O },
  T: { rows: ["###", ".#."], color: TETRIS.T },
  S: { rows: [".##", "##."], color: TETRIS.S },
  Z: { rows: ["##.", ".##"], color: TETRIS.Z },
  J: { rows: ["#..", "###"], color: TETRIS.J },
  L: { rows: ["..#", "###"], color: TETRIS.L },
}

function renderPiece(name: keyof typeof PIECES, blockChar = "██"): string[] {
  const p = PIECES[name]
  return p.rows.map((row) => {
    let line = ""
    for (const c of row) line += c === "#" ? p.color + blockChar + RESET : "  "
    return line
  })
}

// ─── design 1: ARCADE CABINET SPLASH ───────────────────────────────────────
function design1(): string {
  const W = 78
  const title = colorBlock(figlet("TETRIS", "ANSI Shadow", { width: W }), TETRIS.I)
  const sub = colorBlock(figlet("BATTLE", "ANSI Shadow", { width: W }), TETRIS.Z)

  const top = TETRIS.O + "╔" + "═".repeat(W - 2) + "╗" + RESET
  const bot = TETRIS.O + "╚" + "═".repeat(W - 2) + "╝" + RESET
  const side = TETRIS.O + "║" + RESET

  const inside = (content: string) => side + centerInside(content, W - 2) + side

  const blank = inside("")
  const marquee = inside(
    `${TETRIS.hot}${BOLD}◆ ◆ ◆${RESET}  ${TETRIS.white}${BOLD}INSERT COIN TO PLAY${RESET}  ${TETRIS.hot}${BOLD}◆ ◆ ◆${RESET}`,
  )
  const credits = inside(
    `${TETRIS.ghost}CREDITS${RESET} ${TETRIS.white}${BOLD}03${RESET}   ` +
      `${TETRIS.ghost}HI-SCORE${RESET} ${TETRIS.O}${BOLD}999,999${RESET}   ` +
      `${TETRIS.ghost}1P${RESET} ${TETRIS.S}${BOLD}READY${RESET}   ${TETRIS.ghost}2P${RESET} ${TETRIS.Z}${BOLD}READY${RESET}`,
  )

  // build piece strip
  const stripPieces: (keyof typeof PIECES)[] = ["I", "J", "L", "O", "S", "T", "Z"]
  const pieceRow1: string[] = []
  const pieceRow2: string[] = []
  for (const name of stripPieces) {
    const r = renderPiece(name, "▓▓")
    pieceRow1.push(r[0] ?? "        ")
    pieceRow2.push(r[1] ?? "        ")
  }
  const strip1 = inside(pieceRow1.join("  "))
  const strip2 = inside(pieceRow2.join("  "))

  const lines: string[] = []
  lines.push(top)
  lines.push(blank)
  lines.push(marquee)
  lines.push(blank)
  for (const l of title) lines.push(inside(l))
  for (const l of sub) lines.push(inside(l))
  lines.push(blank)
  lines.push(strip1)
  lines.push(strip2)
  lines.push(blank)
  lines.push(credits)
  lines.push(blank)
  lines.push(inside(`${TETRIS.ghost}${ITALIC}© 1984-2026  STACK OR DIE  ${RESET}`))
  lines.push(blank)
  lines.push(bot)
  return lines.join("\n")
}

// ─── design 2: TOURNAMENT BRACKET HEADER ───────────────────────────────────
function design2(): string {
  const title = figlet("TETRIS BATTLE", "Slant", { width: 100 })
  const colored = gradientBlock(title, [
    rgb(255, 80, 80),
    rgb(255, 160, 60),
    rgb(255, 220, 60),
    rgb(120, 220, 255),
    rgb(160, 120, 255),
  ])

  const W = Math.max(...title.map((l) => l.length), 90)
  const heavy = (c: string) => rgb(220, 50, 50) + c + RESET
  const gold = (c: string) => rgb(255, 200, 60) + c + RESET

  const topBar =
    heavy("▰".repeat(8)) + " " + gold("◆ WORLD CHAMPIONSHIP SERIES ◆ SEASON XII ◆") + " " + heavy("▰".repeat(8))

  const bracket = [
    `${TETRIS.J}${BOLD} [ A ]${RESET} KASPAROV_BLOX  ${TETRIS.ghost}━━━┓${RESET}`,
    `                          ${TETRIS.ghost}┣━━${RESET} ${TETRIS.O}${BOLD}◆${RESET}`,
    `${TETRIS.J}${BOLD} [ B ]${RESET} J_PIECE_GHOST  ${TETRIS.ghost}━━━┛   ${TETRIS.ghost}┃${RESET}`,
    `                                  ${TETRIS.ghost}┣━━${RESET} ${TETRIS.hot}${BOLD}FINAL${RESET}`,
    `${TETRIS.Z}${BOLD} [ C ]${RESET} TSPIN_QUEEN    ${TETRIS.ghost}━━━┓   ${TETRIS.ghost}┃${RESET}`,
    `                          ${TETRIS.ghost}┣━━${RESET} ${TETRIS.O}${BOLD}◆${RESET}`,
    `${TETRIS.Z}${BOLD} [ D ]${RESET} LINE_CLEAR_99  ${TETRIS.ghost}━━━┛${RESET}`,
  ]

  const stats =
    `${TETRIS.S}${BOLD}LIVE${RESET} ${TETRIS.white}● ${RESET}` +
    `${TETRIS.ghost}VIEWERS${RESET} ${BOLD}${TETRIS.O}1,247,883${RESET}   ` +
    `${TETRIS.ghost}PRIZE POOL${RESET} ${BOLD}${TETRIS.S}$500,000${RESET}   ` +
    `${TETRIS.ghost}ROUND${RESET} ${BOLD}${TETRIS.hot}07/12${RESET}`

  const lines: string[] = []
  lines.push(topBar)
  lines.push("")
  for (const l of colored) lines.push("  " + l)
  lines.push("")
  lines.push("  " + heavy("▰".repeat(W - 4)))
  lines.push("")
  for (const b of bracket) lines.push("    " + b)
  lines.push("")
  lines.push("  " + stats)
  lines.push("")
  lines.push(
    "  " +
      gold("◆") +
      " " +
      `${TETRIS.white}${BOLD}PRESS [ENTER]${RESET} ${TETRIS.ghost}TO ENTER THE ARENA${RESET} ` +
      gold("◆"),
  )
  return lines.join("\n")
}

// ─── design 3: CYBERPUNK NEON GRID ─────────────────────────────────────────
function design3(): string {
  const title = figlet("TETRIS", "Electronic", { width: 120 })
  const colored = title.map((l, i) => {
    const t = i / Math.max(1, title.length - 1)
    const r = Math.round(255 * (1 - t) + 80 * t)
    const g = Math.round(40 * (1 - t) + 220 * t)
    const b = Math.round(200 * (1 - t) + 255 * t)
    return rgb(r, g, b) + l + RESET
  })

  const battle = colorBlock(figlet("// BATTLE.exe", "Slant", { width: 80 }), TETRIS.neon)

  // Neon grid background-ish frame
  const gridLine = (() => {
    let s = ""
    for (let i = 0; i < 100; i++) {
      const c = i % 4 === 0 ? rgb(255, 0, 200) + "┼" : rgb(80, 0, 120) + "─"
      s += c
    }
    return s + RESET
  })()

  const scan = (color: string) => color + "▓▒░".repeat(30).slice(0, 90) + RESET

  const hud = [
    `${rgb(255, 0, 200)}┏━━ SYS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${RESET}`,
    `${rgb(255, 0, 200)}┃${RESET} ${TETRIS.S}● ${RESET}${rgb(180, 255, 200)}NEURAL_LINK${RESET} ${TETRIS.ghost}::${RESET} ${rgb(120, 255, 255)}STABLE${RESET}    ${TETRIS.S}● ${RESET}${rgb(180, 255, 200)}HEX_GRID${RESET} ${TETRIS.ghost}::${RESET} ${rgb(120, 255, 255)}LOCKED${RESET}    ${rgb(255, 80, 200)}● ${RESET}${rgb(180, 255, 200)}ADRENALINE${RESET} ${TETRIS.ghost}::${RESET} ${rgb(255, 80, 200)}SPIKING${RESET}      ${rgb(255, 0, 200)}┃${RESET}`,
    `${rgb(255, 0, 200)}┃${RESET} ${TETRIS.ghost}OPERATOR${RESET} ${rgb(120, 255, 255)}>${RESET} ${BOLD}${rgb(255, 255, 255)}NEO_T-SPIN${RESET}        ${TETRIS.ghost}DISTRICT${RESET} ${rgb(120, 255, 255)}>${RESET} ${BOLD}${rgb(255, 200, 60)}NEO_KYOTO_07${RESET}        ${TETRIS.ghost}HACK_LVL${RESET} ${rgb(120, 255, 255)}>${RESET} ${BOLD}${TETRIS.hot}99${RESET}    ${rgb(255, 0, 200)}┃${RESET}`,
    `${rgb(255, 0, 200)}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${RESET}`,
  ]

  const fallStrip = () => {
    const order: (keyof typeof PIECES)[] = ["T", "S", "L", "I", "Z", "J", "O"]
    const rows: string[] = ["", ""]
    for (const n of order) {
      const r = renderPiece(n, "▓▓")
      rows[0] += (r[0] ?? "      ") + "  "
      rows[1] += (r[1] ?? "      ") + "  "
    }
    return rows
  }
  const strip = fallStrip()

  const lines: string[] = []
  lines.push(scan(rgb(255, 0, 200)))
  lines.push(gridLine)
  lines.push("")
  for (const l of colored) lines.push("   " + l)
  lines.push("")
  for (const l of battle) lines.push("                    " + l)
  lines.push("")
  lines.push("   " + strip[0])
  lines.push("   " + strip[1])
  lines.push("")
  for (const h of hud) lines.push("   " + h)
  lines.push("")
  lines.push(gridLine)
  lines.push(
    `   ${rgb(255, 0, 200)}>${RESET} ${BOLD}${rgb(120, 255, 255)}JACK IN${RESET} ${TETRIS.ghost}[Y/N]${RESET}  ${rgb(255, 0, 200)}_${RESET}${BOLD}${rgb(255, 255, 255)}█${RESET}`,
  )
  return lines.join("\n")
}

// ─── design 4: NES BOX ART (retro Nintendo-era) ────────────────────────────
function design4(): string {
  const W = 70
  const title = colorBlock(figlet("TETRIS", "Big", { width: W }), TETRIS.white)
  const battle = colorBlock(figlet("BATTLE", "Big", { width: W }), TETRIS.O)

  const grayBg = bgRgb(60, 60, 80)
  const redBg = bgRgb(180, 30, 30)
  const goldStripe = rgb(255, 200, 60)

  const top = redBg + " ".repeat(W) + RESET
  const seal = rgb(255, 220, 100) + "★" + RESET

  // Faux "Nintendo Seal of Quality" + 8-bit feel
  const ribbon = (text: string) => {
    const inner = ` ${seal} ${BOLD}${TETRIS.white}${text}${RESET} ${seal} `
    const pad = W - vlen(inner)
    const left = Math.floor(pad / 2)
    return redBg + " ".repeat(left) + inner + redBg + " ".repeat(pad - left) + RESET
  }

  // mini play-field on the side, but we'll inline it as full-width centered art
  const board: string[] = []
  const bw = 12
  const colors = [TETRIS.I, TETRIS.J, TETRIS.L, TETRIS.O, TETRIS.T, TETRIS.S, TETRIS.Z]
  for (let r = 0; r < 8; r++) {
    let row = TETRIS.white + "│" + RESET
    for (let c = 0; c < bw; c++) {
      // pseudo random fill bottom-heavy
      const fill = r >= 4 && (r * 31 + c * 17) % 5 !== 0
      if (fill) {
        const col = colors[(r + c) % colors.length]
        row += col + "▓▓" + RESET
      } else {
        row += TETRIS.ghost + "··" + RESET
      }
    }
    row += TETRIS.white + "│" + RESET
    board.push(row)
  }
  board.push(TETRIS.white + "└" + "──".repeat(bw) + "┘" + RESET)

  const sidePanel = [
    `${TETRIS.white}${BOLD}NEXT${RESET}`,
    ...renderPiece("T", "██"),
    "",
    `${TETRIS.white}${BOLD}HOLD${RESET}`,
    ...renderPiece("L", "██"),
    "",
    `${TETRIS.white}${BOLD}SCORE${RESET}`,
    `${TETRIS.O}${BOLD}013370${RESET}`,
    "",
    `${TETRIS.white}${BOLD}LEVEL${RESET}`,
    `${TETRIS.S}${BOLD}  09${RESET}`,
    "",
    `${TETRIS.white}${BOLD}LINES${RESET}`,
    `${TETRIS.hot}${BOLD} 087${RESET}`,
  ]

  // combine board + side panel
  const combined: string[] = []
  const rows = Math.max(board.length, sidePanel.length)
  for (let i = 0; i < rows; i++) {
    const left = padRight(board[i] ?? "", 2 + bw * 2 + 2)
    const right = sidePanel[i] ?? ""
    combined.push(left + "    " + right)
  }

  const lines: string[] = []
  lines.push(top)
  lines.push(ribbon("◆ OFFICIAL CARTRIDGE ◆"))
  lines.push(top)
  lines.push("")
  for (const l of title) lines.push("  " + l)
  for (const l of battle) lines.push("  " + l)
  lines.push("")
  lines.push("  " + goldStripe + "▀".repeat(W - 4) + RESET)
  lines.push(
    "  " +
      `${TETRIS.O}${BOLD}1 OR 2 PLAYERS${RESET}  ${TETRIS.ghost}·${RESET}  ${TETRIS.S}${BOLD}50 LEVELS${RESET}  ${TETRIS.ghost}·${RESET}  ${TETRIS.Z}${BOLD}BATTLE MODE${RESET}`,
  )
  lines.push("  " + goldStripe + "▄".repeat(W - 4) + RESET)
  lines.push("")
  for (const r of combined) lines.push("  " + r)
  lines.push("")
  lines.push(top)
  lines.push(ribbon("PUSH START"))
  lines.push(top)
  return lines.join("\n")
}

// ─── design 5: MINIMAL ZEN / FALLING PIECES POEM ───────────────────────────
function design5(): string {
  const title = figlet("TETRIS BATTLE", "ANSI Shadow", { width: 100 })
  // very subtle: white title with one accent color piece in the middle row
  const accent = Math.floor(title.length / 2)
  const colored = title.map((l, i) => {
    if (i === accent) return TETRIS.hot + l + RESET
    return rgb(220, 220, 230) + l + RESET
  })

  // Falling pieces above and below, sparse, monochrome-ish
  const skyOrder: (keyof typeof PIECES)[] = ["I", "T", "L"]
  const sky: string[] = ["", "", ""]
  let cursor = 4
  for (const name of skyOrder) {
    const p = renderPiece(name, "▓▓")
    for (let i = 0; i < p.length; i++) {
      while (sky[i].length < cursor) sky[i] += " "
      sky[i] += p[i]
    }
    cursor += 18
  }
  // ghost trail under sky pieces
  const trail = `${TETRIS.ghost}${DIM}` + "·".repeat(80) + RESET

  const stack = [
    `${TETRIS.ghost}│${RESET}${TETRIS.J}██${TETRIS.O}██${TETRIS.S}██${TETRIS.Z}██${TETRIS.T}██${TETRIS.L}██${TETRIS.I}██${TETRIS.J}██${RESET}${TETRIS.ghost}│${RESET}`,
    `${TETRIS.ghost}│${RESET}${TETRIS.O}██${TETRIS.S}██${TETRIS.Z}██${TETRIS.T}██${TETRIS.L}██${TETRIS.I}██${TETRIS.J}██${TETRIS.O}██${RESET}${TETRIS.ghost}│${RESET}`,
    `${TETRIS.ghost}└${"──".repeat(8)}┘${RESET}`,
  ]

  const haiku = [
    `${ITALIC}${rgb(180, 180, 200)}seven shapes descend${RESET}`,
    `${ITALIC}${rgb(180, 180, 200)}silent rows dissolve to dust —${RESET}`,
    `${ITALIC}${rgb(180, 180, 200)}only the stack waits${RESET}`,
  ]

  const lines: string[] = []
  lines.push("")
  for (const l of sky) lines.push("    " + l)
  lines.push("    " + trail)
  lines.push("")
  for (const l of colored) lines.push("  " + l)
  lines.push("")
  lines.push("    " + trail)
  lines.push("")
  for (const h of haiku) lines.push("        " + h)
  lines.push("")
  // centered tiny stack
  const stackWidth = vlen(stack[0])
  const pad = Math.floor((90 - stackWidth) / 2)
  for (const s of stack) lines.push(" ".repeat(pad) + s)
  lines.push("")
  lines.push("        " + `${TETRIS.ghost}${ITALIC}— press space to begin —${RESET}`)
  lines.push("")
  return lines.join("\n")
}

// ─── separator ─────────────────────────────────────────────────────────────
function separator(label: string): string {
  const tetrominoes: (keyof typeof PIECES)[] = ["I", "O", "T", "S", "Z", "J", "L"]
  const colors = tetrominoes.map((n) => PIECES[n].color)
  const bar = colors.map((c) => c + "█████" + RESET).join(" ")
  const tag = `${BOLD}${TETRIS.white}${label}${RESET}`
  return ["", bar, "  " + tag, bar, ""].join("\n")
}

// ─── render all ────────────────────────────────────────────────────────────
const designs = [
  { name: "DESIGN 1 // ARCADE CABINET SPLASH", render: design1 },
  { name: "DESIGN 2 // TOURNAMENT BRACKET", render: design2 },
  { name: "DESIGN 3 // CYBERPUNK NEON GRID", render: design3 },
  { name: "DESIGN 4 // NES BOX ART", render: design4 },
  { name: "DESIGN 5 // ZEN MINIMAL HAIKU", render: design5 },
]

const out: string[] = []
for (const d of designs) {
  out.push(separator(d.name))
  out.push(d.render())
}
out.push(separator("END OF TRANSMISSION"))
process.stdout.write(out.join("\n") + "\n")
