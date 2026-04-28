/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { RGBA, type ParsedKey } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { ConvexClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"

const highScoreKey = "opencode.tetris-battle.highscore"
const bestAttackKey = "opencode.tetris-battle.best-attack"
const boardWidth = 10
const boardHeight = 20
const tickMs = 500
const heartbeatMs = 2_000
const opponentStaleMs = 8_000
const lineScores = [0, 100, 300, 500, 800] as const

type RoomStatus = "waiting" | "countdown" | "active" | "done"
type PlayerStatus = "lobby" | "playing" | "ko" | "left"
type ConfirmAction = "quit" | "lobby"

type RemoteRoom = {
  code: string
  status: RoomStatus
  seed: string
  hostPlayerId: string
  guestPlayerId?: string
  winnerPlayerId?: string
  startedAt?: number
}

type RemotePlayer = {
  playerId: string
  side: "host" | "guest"
  ready: boolean
  status: PlayerStatus
  board: string
  score: number
  lines: number
  level: number
  sent: number
  received: number
  incoming: number
  lastSeen: number
}

type RemoteAttack = {
  _id: string
  lines: number
  cleared: number
  combo: number
  createdAt: number
}

type RoomSnapshot = {
  room: RemoteRoom
  players: RemotePlayer[]
  pendingAttacks: RemoteAttack[]
}

const refs = {
  getRoom: makeFunctionReference<"query", { code: string; playerId: string }, RoomSnapshot | null>("tetris:getRoom"),
  createRoom: makeFunctionReference<"mutation", { code: string; seed: string; playerId: string }, { code: string }>("tetris:createRoom"),
  joinRoom: makeFunctionReference<"mutation", { code: string; playerId: string }, { code: string }>("tetris:joinRoom"),
  quickJoin: makeFunctionReference<"mutation", { code: string; seed: string; playerId: string }, { code: string }>("tetris:quickJoin"),
  setReady: makeFunctionReference<"mutation", { code: string; playerId: string; ready: boolean }, null>("tetris:setReady"),
  startMatch: makeFunctionReference<"mutation", { code: string }, null>("tetris:startMatch"),
  rematch: makeFunctionReference<"mutation", { code: string; seed: string; playerId: string }, null>("tetris:rematch"),
  heartbeat: makeFunctionReference<"mutation", { code: string; playerId: string }, null>("tetris:heartbeat"),
  submitBoard: makeFunctionReference<"mutation", { code: string; playerId: string; board: string; score: number; lines: number; level: number; sent: number; received: number; incoming: number; gameOver: boolean }, null>("tetris:submitBoard"),
  sendAttack: makeFunctionReference<"mutation", { code: string; fromPlayerId: string; lines: number; cleared: number; combo: number }, null>("tetris:sendAttack"),
  consumeAttacks: makeFunctionReference<"mutation", { attackIds: string[]; playerId: string }, null>("tetris:consumeAttacks"),
  leaveRoom: makeFunctionReference<"mutation", { code: string; playerId: string }, null>("tetris:leaveRoom"),
}

type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L"
type BoardCell = PieceType | "garbage" | null
type DisplayCell = PieceType | "ghost" | "garbage" | null

type Piece = {
  type: PieceType
  rotation: number
  x: number
  y: number
}

type BattleStats = {
  sent: number
  received: number
  incoming: number
  combo: number
  maxCombo: number
  pieces: number
  rivalLines: number
  rivalSent: number
  rivalPressure: number
}

type GameState = {
  board: BoardCell[][]
  opponentBoard: BoardCell[][]
  bag: PieceType[]
  rng: number
  current: Piece
  next: PieceType
  hold: PieceType | null
  holdUsed: boolean
  score: number
  lines: number
  level: number
  gameOver: boolean
  won: boolean
  highScore: number
  bestAttack: number
  stats: BattleStats
  outgoingAttacks: OutgoingAttack[]
}

type OutgoingAttack = {
  lines: number
  cleared: number
  combo: number
}

const pieces: Record<PieceType, number[][][]> = {
  I: [
    [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
    ],
  ],
  O: [
    [
      [1, 1],
      [1, 1],
    ],
  ],
  T: [
    [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  S: [
    [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 1],
      [1, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  Z: [
    [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  ],
  J: [
    [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  ],
  L: [
    [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [1, 0, 0],
    ],
    [
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
  ],
}

const pieceNames = Object.keys(pieces) as PieceType[]

const pieceColors: Record<PieceType, RGBA> = {
  I: RGBA.fromInts(0, 255, 255, 255),
  O: RGBA.fromInts(255, 220, 0, 255),
  T: RGBA.fromInts(180, 90, 230, 255),
  S: RGBA.fromInts(0, 220, 80, 255),
  Z: RGBA.fromInts(255, 50, 50, 255),
  J: RGBA.fromInts(70, 100, 255, 255),
  L: RGBA.fromInts(255, 150, 0, 255),
}

const ghostColor = RGBA.fromInts(80, 80, 100, 255)
const dotColor = RGBA.fromInts(60, 60, 75, 255)
const garbageColor = RGBA.fromInts(145, 145, 155, 255)

const seedNumber = (seed: string): number => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const rngNext = (seed: number): { seed: number; value: number } => {
  let h = (seed + 0x6d2b79f5) >>> 0
  let t = h
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { seed: h, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const drawPiece = (state: Pick<GameState, "bag" | "rng">): PieceType => {
  if (state.bag.length < 2) {
    const bag = [...pieceNames]
    for (let i = bag.length - 1; i > 0; i--) {
      const next = rngNext(state.rng)
      state.rng = next.seed
      const j = Math.floor(next.value * (i + 1))
      const tmp = bag[i]!
      bag[i] = bag[j]!
      bag[j] = tmp
    }
    state.bag.push(...bag)
  }
  return state.bag.shift()!
}

const getShape = (piece: Piece): number[][] => {
  const rotations = pieces[piece.type]
  return rotations[piece.rotation % rotations.length]!
}

const createBoard = (): BoardCell[][] =>
  Array.from({ length: boardHeight }, () => Array<BoardCell>(boardWidth).fill(null))

const encodeBoard = (board: BoardCell[][]): string => {
  const map: Record<Exclude<BoardCell, null>, string> = {
    I: "I",
    O: "O",
    T: "T",
    S: "S",
    Z: "Z",
    J: "J",
    L: "L",
    garbage: "G",
  }
  return board.map((row) => row.map((cell) => (cell ? map[cell] : ".")).join("")).join("")
}

const decodeBoard = (value: string | undefined): BoardCell[][] => {
  const chars = (value || "").padEnd(boardWidth * boardHeight, ".")
  const from = (char: string): BoardCell => {
    if (char === "G") return "garbage"
    return pieceNames.includes(char as PieceType) ? (char as PieceType) : null
  }
  return Array.from({ length: boardHeight }, (_, row) =>
    Array.from({ length: boardWidth }, (_, col) => from(chars[row * boardWidth + col]!)),
  )
}

const randomGarbageRow = (): BoardCell[] => {
  const hole = Math.floor(Math.random() * boardWidth)
  return Array.from({ length: boardWidth }, (_, col) => (col === hole ? null : "garbage"))
}

const pushGarbage = (board: BoardCell[][], lines: number): { board: BoardCell[][]; toppedOut: boolean } => {
  const next = board.map((row) => [...row])
  let toppedOut = false
  for (let i = 0; i < lines; i++) {
    const removed = next.shift()
    if (removed?.some((cell) => cell !== null)) toppedOut = true
    next.push(randomGarbageRow())
  }
  return { board: next, toppedOut }
}

const spawnPiece = (type: PieceType): Piece => ({
  type,
  rotation: 0,
  x: Math.floor(boardWidth / 2) - 1,
  y: 0,
})

const createInitialState = (highScore = 0, bestAttack = 0, seed?: string): GameState => {
  const draw = { rng: seed ? seedNumber(seed) : Math.floor(Math.random() * 0xffffffff), bag: [] as PieceType[] }
  const first = drawPiece(draw)
  const next = drawPiece(draw)
  return {
    board: createBoard(),
    opponentBoard: createBoard(),
    bag: draw.bag,
    rng: draw.rng,
    current: spawnPiece(first),
    next,
    hold: null,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: 1,
    gameOver: false,
    won: false,
    highScore,
    bestAttack,
    stats: {
      sent: 0,
      received: 0,
      incoming: 0,
      combo: 0,
      maxCombo: 0,
      pieces: 0,
      rivalLines: 0,
      rivalSent: 0,
      rivalPressure: 0,
    },
    outgoingAttacks: [],
  }
}

const cloneState = (state: GameState): GameState => ({
  ...state,
  board: state.board.map((row) => [...row]),
  opponentBoard: state.opponentBoard.map((row) => [...row]),
  bag: [...state.bag],
  current: { ...state.current },
  stats: { ...state.stats },
  outgoingAttacks: [...state.outgoingAttacks],
})

const ended = (state: GameState): boolean => state.gameOver || state.won

const collides = (board: BoardCell[][], piece: Piece): boolean => {
  const shape = getShape(piece)
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row]!.length; col++) {
      if (!shape[row]![col]) continue
      const boardX = piece.x + col
      const boardY = piece.y + row
      if (boardX < 0 || boardX >= boardWidth || boardY >= boardHeight) return true
      if (boardY >= 0 && board[boardY]![boardX] !== null) return true
    }
  }
  return false
}

const lockPiece = (board: BoardCell[][], piece: Piece): void => {
  const shape = getShape(piece)
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row]!.length; col++) {
      if (!shape[row]![col]) continue
      const boardX = piece.x + col
      const boardY = piece.y + row
      if (boardY >= 0 && boardY < boardHeight && boardX >= 0 && boardX < boardWidth) {
        board[boardY]![boardX] = piece.type
      }
    }
  }
}

const clearLines = (board: BoardCell[][]): number => {
  let cleared = 0
  for (let row = boardHeight - 1; row >= 0; row--) {
    if (board[row]!.every((cell) => cell !== null)) {
      board.splice(row, 1)
      board.unshift(Array<BoardCell>(boardWidth).fill(null))
      cleared++
      row++
    }
  }
  return cleared
}

const attackForClear = (cleared: number, combo: number): number => {
  const base = cleared === 4 ? 4 : cleared === 3 ? 2 : cleared === 2 ? 1 : 0
  const comboBonus = combo >= 7 ? 3 : combo >= 5 ? 2 : combo >= 2 ? 1 : 0
  return base + comboBonus
}

const applyPlayerAttack = (state: GameState, attack: number, cleared: number): void => {
  if (attack <= 0) return
  const cancelled = Math.min(attack, state.stats.incoming)
  const sent = attack - cancelled
  state.stats.incoming -= cancelled
  state.stats.sent += sent
  state.stats.rivalPressure += sent
  if (sent > 0) {
    state.outgoingAttacks.push({ lines: sent, cleared, combo: state.stats.combo })
  }
}

const injectIncoming = (state: GameState): void => {
  if (state.stats.incoming <= 0) return
  const incoming = Math.min(4, state.stats.incoming)
  const result = pushGarbage(state.board, incoming)
  state.board = result.board
  state.stats.incoming -= incoming
  state.stats.received += incoming
  if (result.toppedOut) state.gameOver = true
}

const tickState = (state: GameState, softDrop: boolean): { state: GameState; locked: boolean } => {
  if (ended(state)) return { state, locked: false }
  const next = cloneState(state)
  const moved = { ...next.current, y: next.current.y + 1 }
  if (!collides(next.board, moved)) {
    next.current = moved
    if (softDrop) next.score += 1
    next.highScore = Math.max(next.highScore, next.score)
    return { state: next, locked: false }
  }

  lockPiece(next.board, next.current)
  next.stats.pieces++
  const cleared = clearLines(next.board)
  if (cleared > 0) {
    next.lines += cleared
    next.score += (lineScores[cleared] ?? 0) * next.level
    next.level = Math.floor(next.lines / 10) + 1
    next.stats.combo++
    next.stats.maxCombo = Math.max(next.stats.maxCombo, next.stats.combo)
    applyPlayerAttack(next, attackForClear(cleared, next.stats.combo), cleared)
  } else {
    next.stats.combo = 0
    injectIncoming(next)
  }

  next.highScore = Math.max(next.highScore, next.score)
  next.bestAttack = Math.max(next.bestAttack, next.stats.sent)
  if (!ended(next)) {
    next.current = spawnPiece(next.next)
    next.next = drawPiece(next)
    next.holdUsed = false
    if (collides(next.board, next.current)) next.gameOver = true
  }
  return { state: next, locked: true }
}

const moveState = (state: GameState, dx: number): GameState => {
  const moved = { ...state.current, x: state.current.x + dx }
  return collides(state.board, moved) ? state : { ...state, current: moved }
}

const rotateState = (state: GameState): GameState => {
  const rotated = {
    ...state.current,
    rotation: (state.current.rotation + 1) % pieces[state.current.type].length,
  }
  if (!collides(state.board, rotated)) return { ...state, current: rotated }
  for (const offset of [-1, 1, -2, 2]) {
    const kicked = { ...rotated, x: rotated.x + offset }
    if (!collides(state.board, kicked)) return { ...state, current: kicked }
  }
  return state
}

const holdState = (state: GameState): GameState => {
  if (state.holdUsed || ended(state)) return state
  const currentType = state.current.type
  const next = cloneState(state)
  next.holdUsed = true
  if (next.hold) {
    next.current = spawnPiece(next.hold)
    next.hold = currentType
  } else {
    next.hold = currentType
    next.current = spawnPiece(next.next)
    next.next = drawPiece(next)
  }
  if (collides(next.board, next.current)) next.gameOver = true
  return next
}

const hardDropState = (state: GameState): GameState => {
  let next = cloneState(state)
  while (!collides(next.board, { ...next.current, y: next.current.y + 1 })) {
    next = {
      ...next,
      current: { ...next.current, y: next.current.y + 1 },
      score: next.score + 2,
    }
  }
  return tickState(next, false).state
}

const displayBoard = (state: GameState): DisplayCell[][] => {
  const display: DisplayCell[][] = state.board.map((row) => [...row])
  if (ended(state)) return display

  const ghost = { ...state.current }
  while (!collides(state.board, { ...ghost, y: ghost.y + 1 })) ghost.y++

  const draw = (piece: Piece, cell: DisplayCell, emptyOnly: boolean) => {
    const shape = getShape(piece)
    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row]!.length; col++) {
        if (!shape[row]![col]) continue
        const boardX = piece.x + col
        const boardY = piece.y + row
        if (boardY < 0 || boardY >= boardHeight || boardX < 0 || boardX >= boardWidth) continue
        if (emptyOnly && display[boardY]![boardX] !== null) continue
        display[boardY]![boardX] = cell
      }
    }
  }

  draw(ghost, "ghost", true)
  draw(state.current, state.current.type, false)
  return display
}

const syncBoard = (state: GameState): BoardCell[][] => {
  const board = state.board.map((row) => [...row])
  if (ended(state)) return board
  const shape = getShape(state.current)
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row]!.length; col++) {
      if (!shape[row]![col]) continue
      const boardX = state.current.x + col
      const boardY = state.current.y + row
      if (boardY < 0 || boardY >= boardHeight || boardX < 0 || boardX >= boardWidth) continue
      board[boardY]![boardX] = state.current.type
    }
  }
  return board
}

const getTickSpeed = (state: GameState): number => Math.max(100, tickMs - (state.level - 1) * 40)

const isKey = (evt: ParsedKey, ...names: string[]) => names.includes(evt.name)

const prevent = (evt: ParsedKey) => {
  const controlled = evt as ParsedKey & {
    preventDefault?: () => void
    stopPropagation?: () => void
  }
  controlled.preventDefault?.()
  controlled.stopPropagation?.()
}

const asSavedNumber = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

const countdownText = (startedAt: number | undefined, now: number): string => {
  if (!startedAt) return "3"
  const remaining = startedAt - now
  if (remaining <= 0) return "GO"
  return String(Math.max(1, Math.ceil(remaining / 1000)))
}

const formatLatency = (value: number | null): string => {
  if (value === null) return "..."
  return `${Math.max(0, Math.round(value))}ms`
}

const cellGlyph = (cell: DisplayCell): string => {
  if (cell === null) return "·"
  if (cell === "ghost") return "░"
  if (cell === "garbage") return "▓"
  return "█"
}

const cellColor = (cell: DisplayCell): RGBA => {
  if (cell === null) return dotColor
  if (cell === "ghost") return ghostColor
  if (cell === "garbage") return garbageColor
  return pieceColors[cell]
}

const rivalGlyph = (cell: BoardCell): string => (cell === null ? "· " : cell === "garbage" ? "▓▓" : "██")

const rivalColor = (cell: BoardCell, theme: TuiThemeCurrent): RGBA => {
  if (cell === null) return theme.textMuted
  if (cell === "garbage") return garbageColor
  return pieceColors[cell]
}

const asString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

const createId = (): string => {
  const bun = globalThis as typeof globalThis & { Bun?: { randomUUIDv7?: () => string } }
  return bun.Bun?.randomUUIDv7?.() ?? crypto.randomUUID()
}

const createRoomCode = (): string => {
  const alphabet = "23456789"
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
}

const normalizeRoomCode = (code: string): string => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)

const isEnterKey = (evt: ParsedKey): boolean => {
  return isKey(evt, "enter", "return") || evt.sequence === "\r" || evt.sequence === "\n" || evt.raw === "\r" || evt.raw === "\n"
}

let processPlayerId = ""

const getPlayerId = (): string => {
  processPlayerId ||= createId()
  return processPlayerId
}

const PiecePreview = (props: { type: PieceType | null; theme: TuiThemeCurrent }) => {
  const previewRows = createMemo(() => {
    const shape = props.type ? pieces[props.type][0]! : []
    return [0, 1, 2, 3].map((row) =>
      [0, 1, 2, 3].map((col) => (shape[row]?.[col] ? props.type : null)),
    )
  })

  return (
    <box flexDirection="column">
      <For each={previewRows()}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(cell) => (
                <text fg={cell ? pieceColors[cell] : props.theme.textMuted}>
                  {cell ? "██" : "  "}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

export const TetrisBattle = (props: {
  api: TuiPluginApi
  convexUrlKey: string
  defaultConvexUrl: string
  onClose: () => void
}) => {
  const playerId = getPlayerId()
  const [roomCode, setRoomCode] = createSignal("")
  const [client, setClient] = createSignal<ConvexClient | null>(null)
  const [room, setRoom] = createSignal<RoomSnapshot | null>(null)
  const [conn, setConn] = createSignal("disconnected")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [ready, setReadyLocal] = createSignal(false)
  const [started, setStarted] = createSignal(false)
  const [editingRoomCode, setEditingRoomCode] = createSignal(false)
  const [confirmAction, setConfirmAction] = createSignal<ConfirmAction | null>(null)
  const [now, setNow] = createSignal(Date.now())
  const [publishLatencyMs, setPublishLatencyMs] = createSignal<number | null>(null)
  const [opponentBoardSeenAt, setOpponentBoardSeenAt] = createSignal<number | null>(null)
  const [state, setState] = createSignal(
    createInitialState(
      asSavedNumber(props.api.kv.get(highScoreKey, 0)),
      asSavedNumber(props.api.kv.get(bestAttackKey, 0)),
    ),
  )
  const [paused, setPaused] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let countdownStartTimer: ReturnType<typeof setTimeout> | undefined
  let publishTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let clockTimer: ReturnType<typeof setInterval> | undefined
  let unsubscribeRoom: (() => void) | undefined
  let unsubscribeConn: (() => void) | undefined
  let currentUrl = ""
  let lastPublishedSnapshot = ""
  let publishInFlight = false
  let startMatchInFlight = false
  let lastStartMatchAttempt = 0
  let lastOpponentBoard = ""
  const consumedAttackIds = new Set<string>()

  const theme = createMemo(() => props.api.theme.current)
  const board = createMemo(() => displayBoard(state()))
  const incomingBars = createMemo(() => Array.from({ length: 12 }, (_, i) => i < Math.min(12, state().stats.incoming)))
  const boardBorderColor = createMemo(() => state().won ? theme().success : state().gameOver ? theme().error : theme().borderSubtle)
  const opponentBorderColor = createMemo(() => state().won ? theme().error : state().gameOver ? theme().success : theme().borderSubtle)
  const boardTitle = createMemo(() => state().won ? " YOU WIN " : state().gameOver ? " GAME OVER " : "")
  const opponentTitle = createMemo(() => state().won ? " GAME OVER " : "")
  const convexUrl = createMemo(() => asString(props.api.kv.get(props.convexUrlKey, props.defaultConvexUrl), props.defaultConvexUrl))
  const me = createMemo(() => room()?.players.find((p) => p.playerId === playerId))
  const opponent = createMemo(() => room()?.players.find((p) => p.playerId !== playerId && p.status !== "left"))
  const roomStatus = createMemo(() => room()?.room.status ?? "waiting")
  const countdown = createMemo(() => roomStatus() === "countdown" ? countdownText(room()?.room.startedAt, now()) : "")
  const isLobby = createMemo(() => !roomCode() || roomStatus() === "waiting" || roomStatus() === "countdown" || !started())
  const winner = createMemo(() => room()?.room.winnerPlayerId)
  const opponentBoardAgeMs = createMemo(() => {
    const seenAt = opponentBoardSeenAt()
    if (seenAt === null) return null
    return now() - seenAt
  })
  const opponentLastSeenAgeMs = createMemo(() => {
    const lastSeen = opponent()?.lastSeen
    if (lastSeen === undefined) return null
    return now() - lastSeen
  })
  const opponentDisconnected = createMemo(() => {
    const age = opponentLastSeenAgeMs()
    return age !== null && age > opponentStaleMs
  })
  const confirmMessage = createMemo(() => {
    const action = confirmAction()
    if (action === "quit") return "Press Q again to quit, Esc to cancel"
    if (action === "lobby") return "Press L again to leave for lobby, Esc to cancel"
    return ""
  })

  let lastPersistedHighScore = asSavedNumber(props.api.kv.get(highScoreKey, 0))
  let lastPersistedBestAttack = asSavedNumber(props.api.kv.get(bestAttackKey, 0))

  const runMutation = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError("")
    setBusy(true)
    try {
      return await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const requestStartMatch = () => {
    const cx = client()
    const snapshot = room()
    if (!cx || snapshot?.room.status !== "countdown") return
    const nowMs = Date.now()
    if (startMatchInFlight || nowMs - lastStartMatchAttempt < 500) return
    startMatchInFlight = true
    lastStartMatchAttempt = nowMs
    cx.mutation(refs.startMatch, { code: snapshot.room.code })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        startMatchInFlight = false
      })
  }

  const subscribeRoom = (code: string) => {
    unsubscribeRoom?.()
    const cx = untrack(client)
    if (!cx || !code) return
    unsubscribeRoom = cx.onUpdate(
      refs.getRoom,
      { code, playerId },
      (snapshot) => setRoom(snapshot),
      (err) => setError(err.message),
    )
  }

  createEffect(() => {
    const url = convexUrl()
    if (url === currentUrl) return
    currentUrl = url
    unsubscribeRoom?.()
    unsubscribeRoom = undefined
    unsubscribeConn?.()
    unsubscribeConn = undefined
    const previous = untrack(client)
    if (!url) {
      setClient(null)
      setConn("missing url")
      previous?.close().catch(() => {})
      return
    }
    const next = new ConvexClient(url, { unsavedChangesWarning: false })
    setClient(next)
    setConn("connecting")
    unsubscribeConn = next.subscribeToConnectionState((state) => {
      setConn(state.isWebSocketConnected ? "connected" : "connecting")
    })
    previous?.close().catch(() => {})
    const code = untrack(roomCode)
    if (code) {
      subscribeRoom(code)
      void next.mutation(refs.joinRoom, { code, playerId }).catch(() => {})
    }
  })

  const setRoomAndSubscribe = (code: string) => {
    const normalized = normalizeRoomCode(code)
    setRoomCode(normalized)
    setEditingRoomCode(false)
    subscribeRoom(normalized)
  }

  const createRoom = async () => {
    const cx = client()
    if (!cx) {
      setError("Convex backend is not configured")
      return
    }
    const code = createRoomCode()
    const result = await runMutation(() =>
      cx.mutation(refs.createRoom, { code, seed: createId(), playerId }),
    )
    if (result?.code) setRoomAndSubscribe(result.code)
    setReadyLocal(false)
    setStarted(false)
  }

  const joinRoom = async () => {
    const cx = client()
    if (!cx) {
      setError("Convex backend is not configured")
      return
    }
    const code = normalizeRoomCode(roomCode())
    if (!code) {
      setError("Press J, type the room code, then press Enter")
      return
    }
    const result = await runMutation(() => cx.mutation(refs.joinRoom, { code, playerId }))
    if (result?.code) setRoomAndSubscribe(result.code)
    setReadyLocal(false)
    setStarted(false)
  }

  const startJoinMode = () => {
    setError("")
    setEditingRoomCode(true)
  }

  const quickJoin = async () => {
    const cx = client()
    if (!cx) {
      setError("Convex backend is not configured")
      return
    }
    const result = await runMutation(() =>
      cx.mutation(refs.quickJoin, { code: createRoomCode(), seed: createId(), playerId }),
    )
    if (result?.code) setRoomAndSubscribe(result.code)
    setReadyLocal(false)
    setStarted(false)
  }

  const sendHeartbeat = () => {
    const cx = client()
    const code = roomCode()
    if (!cx || !code) return
    void cx.mutation(refs.heartbeat, { code, playerId }).catch(() => {})
  }

  const toggleReady = async () => {
    const cx = client()
    const code = roomCode()
    if (!cx || !code) return
    const next = !ready()
    setReadyLocal(next)
    await runMutation(() => cx.mutation(refs.setReady, { code, playerId, ready: next }))
  }

  const publishBoard = async (next = state()) => {
    const cx = client()
    const code = roomCode()
    if (!cx || !code || roomStatus() !== "active") return
    const board = encodeBoard(syncBoard(next))
    const snapshotKey = [
      board,
      next.score,
      next.lines,
      next.level,
      next.stats.sent,
      next.stats.received,
      next.stats.incoming,
      next.gameOver ? "1" : "0",
    ].join("|")
    if (publishInFlight || snapshotKey === lastPublishedSnapshot) return
    publishInFlight = true
    const publishStartedAt = Date.now()
    await cx.mutation(refs.submitBoard, {
      code,
      playerId,
      board,
      score: next.score,
      lines: next.lines,
      level: next.level,
      sent: next.stats.sent,
      received: next.stats.received,
      incoming: next.stats.incoming,
      gameOver: next.gameOver,
    })
      .then(() => {
        setPublishLatencyMs(Date.now() - publishStartedAt)
        lastPublishedSnapshot = snapshotKey
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        publishInFlight = false
      })
  }

  const flushAttacks = async (attacks: OutgoingAttack[]) => {
    const cx = client()
    const code = roomCode()
    if (!cx || !code || attacks.length === 0) return
    for (const attack of attacks) {
      await cx.mutation(refs.sendAttack, {
        code,
        fromPlayerId: playerId,
        lines: attack.lines,
        cleared: attack.cleared,
        combo: attack.combo,
      }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }
  }

  createEffect(() => {
    const snapshot = room()
    const remoteOpponent = opponent()
    if (remoteOpponent) {
      if (remoteOpponent.board !== lastOpponentBoard) {
        lastOpponentBoard = remoteOpponent.board
        setOpponentBoardSeenAt(Date.now())
      }
      setState((current) => ({ ...current, opponentBoard: decodeBoard(remoteOpponent.board) }))
    }
    if (snapshot?.room.status === "countdown") {
      const delay = Math.max(0, (snapshot.room.startedAt ?? 0) - Date.now())
      if (countdownStartTimer) clearTimeout(countdownStartTimer)
      countdownStartTimer = setTimeout(requestStartMatch, delay + 120)
    }
    const localMe = me()
    if (localMe && localMe.ready !== untrack(ready)) setReadyLocal(localMe.ready)
    if (snapshot?.room.status === "active" && !started()) {
      setStarted(true)
      setPaused(false)
      lastPublishedSnapshot = ""
      lastOpponentBoard = ""
      setOpponentBoardSeenAt(null)
      consumedAttackIds.clear()
      const high = untrack(() => state().highScore)
      const best = untrack(() => state().bestAttack)
      setState(createInitialState(high, best, `${snapshot.room.seed}:${playerId}`))
      schedule()
    }
    if ((snapshot?.room.status === "waiting" || snapshot?.room.status === "countdown") && started()) setStarted(false)
    if (snapshot?.room.status === "done") {
      clearTimer()
      setState((current) => ({
        ...current,
        won: snapshot.room.winnerPlayerId === playerId,
        gameOver: snapshot.room.winnerPlayerId !== playerId,
      }))
    }
    const fresh = snapshot?.pendingAttacks.filter((attack) => !consumedAttackIds.has(attack._id)) ?? []
    const ids = fresh.map((attack) => attack._id)
    const total = fresh.reduce((sum, attack) => sum + attack.lines, 0)
    if (ids.length > 0 && total > 0) {
      for (const id of ids) consumedAttackIds.add(id)
      setState((current) => ({
        ...current,
        stats: { ...current.stats, incoming: current.stats.incoming + total },
      }))
      client()?.mutation(refs.consumeAttacks, { attackIds: ids, playerId }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }
  })

  const persist = (next: GameState) => {
    if (next.highScore > lastPersistedHighScore) {
      lastPersistedHighScore = next.highScore
      props.api.kv.set(highScoreKey, next.highScore)
    }
    if (next.bestAttack > lastPersistedBestAttack) {
      lastPersistedBestAttack = next.bestAttack
      props.api.kv.set(bestAttackKey, next.bestAttack)
    }
  }

  const replaceState = (next: GameState, persistNow = false) => {
    if (persistNow || ended(next)) persist(next)
    if (next.outgoingAttacks.length > 0) {
      const attacks = next.outgoingAttacks
      next = { ...next, outgoingAttacks: [] }
      void flushAttacks(attacks)
    }
    setState(next)
    void publishBoard(next)
  }

  const clearTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }

  const clearCountdownStartTimer = () => {
    if (!countdownStartTimer) return
    clearTimeout(countdownStartTimer)
    countdownStartTimer = undefined
  }

  const clearNetworkTimers = () => {
    if (publishTimer) clearInterval(publishTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (clockTimer) clearInterval(clockTimer)
    publishTimer = undefined
    heartbeatTimer = undefined
    clockTimer = undefined
  }

  const step = (soft = false) => {
    const result = tickState(state(), soft)
    replaceState(result.state, result.locked || ended(result.state))
  }

  const schedule = () => {
    clearTimer()
    if (paused() || ended(state()) || roomStatus() !== "active") return
    timer = setTimeout(
      () => {
        step()
        schedule()
      },
      getTickSpeed(state()),
    )
  }

  const restart = () => {
    persist(state())
    const cx = client()
    const code = roomCode()
    if (cx && code) {
      setStarted(false)
      consumedAttackIds.clear()
      void runMutation(() => cx.mutation(refs.rematch, { code, seed: createId(), playerId }))
    }
  }

  const resetToLobby = () => {
    persist(state())
    clearTimer()
    clearCountdownStartTimer()
    unsubscribeRoom?.()
    unsubscribeRoom = undefined
    consumedAttackIds.clear()
    lastPublishedSnapshot = ""
    lastOpponentBoard = ""
    setConfirmAction(null)
    setRoomCode("")
    setRoom(null)
    setReadyLocal(false)
    setStarted(false)
    setPaused(false)
    setEditingRoomCode(false)
    setPublishLatencyMs(null)
    setOpponentBoardSeenAt(null)
    setState(createInitialState(lastPersistedHighScore, lastPersistedBestAttack))
  }

  const leaveToLobby = () => {
    const cx = client()
    const code = roomCode()
    if (cx && code) void cx.mutation(refs.leaveRoom, { code, playerId }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    resetToLobby()
  }

  onMount(() => {
    const code = roomCode()
    if (code) subscribeRoom(code)
    publishTimer = setInterval(() => void publishBoard(), 250)
    heartbeatTimer = setInterval(sendHeartbeat, heartbeatMs)
    clockTimer = setInterval(() => {
      setNow(Date.now())
      if (roomStatus() === "countdown" && countdown() === "GO") requestStartMatch()
    }, 100)
  })
  onCleanup(() => {
    persist(state())
    const code = roomCode()
    const cx = client()
    if (cx && code) void cx.mutation(refs.leaveRoom, { code, playerId }).catch(() => {})
    clearTimer()
    clearCountdownStartTimer()
    clearNetworkTimers()
    unsubscribeRoom?.()
    unsubscribeConn?.()
    void client()?.close()
  })

  const pause = () => {
    setPaused(true)
    clearTimer()
  }

  const resume = () => {
    setPaused(false)
    schedule()
  }

  const updateIfPlaying = (update: (current: GameState) => GameState) => {
    const current = state()
    if (paused() || ended(current) || roomStatus() !== "active") return
    replaceState(update(current))
  }

  const close = () => {
    persist(state())
    props.onClose()
  }

  useKeyboard((evt) => {
    if (!props.api.ui.dialog.open) return

    if (isLobby() && editingRoomCode()) {
      prevent(evt)
      if (isKey(evt, "escape", "esc")) {
        setEditingRoomCode(false)
        return
      }
      if (isEnterKey(evt)) {
        void joinRoom()
        return
      }
      if (isKey(evt, "backspace", "delete")) {
        setRoomCode((code) => code.slice(0, -1))
        return
      }
      const key = evt.name.toUpperCase()
      if (/^[A-Z0-9]$/.test(key) && roomCode().length < 8) setRoomCode((code) => normalizeRoomCode(code + key))
      return
    }

    const pendingConfirm = confirmAction()
    if (pendingConfirm) {
      prevent(evt)
      if (isKey(evt, "escape", "esc")) {
        setConfirmAction(null)
        return
      }
      if (pendingConfirm === "quit" && isKey(evt, "q", "Q")) {
        setConfirmAction(null)
        close()
        return
      }
      if (pendingConfirm === "lobby" && isKey(evt, "l", "L")) {
        leaveToLobby()
        return
      }
      setConfirmAction(null)
      return
    }

    if (isKey(evt, "q", "Q")) {
      prevent(evt)
      setConfirmAction("quit")
      return
    }

    if (!isLobby() && isKey(evt, "l", "L")) {
      prevent(evt)
      setConfirmAction("lobby")
      return
    }

    if (isLobby()) {
      prevent(evt)
      if (isKey(evt, "m", "M")) {
        void quickJoin()
        return
      }
      if (isKey(evt, "n", "N")) {
        void createRoom()
        return
      }
      if (isKey(evt, "j", "J")) {
        startJoinMode()
        return
      }
      if (isEnterKey(evt)) {
        void joinRoom()
        return
      }
      if (isKey(evt, "r", "R")) {
        void toggleReady()
        return
      }
      if (isKey(evt, "backspace", "delete")) {
        setRoomCode((code) => code.slice(0, -1))
        return
      }
      return
    }

    if (ended(state())) {
      if (isKey(evt, "r", "R")) {
        prevent(evt)
        restart()
      }
      return
    }

    if (isKey(evt, "p", "P")) {
      prevent(evt)
      if (paused()) resume()
      else pause()
      return
    }

    if (paused()) {
      prevent(evt)
      resume()
      return
    }

    if (isKey(evt, "left", "a", "A")) {
      prevent(evt)
      updateIfPlaying((current) => moveState(current, -1))
      return
    }

    if (isKey(evt, "right", "d", "D")) {
      prevent(evt)
      updateIfPlaying((current) => moveState(current, 1))
      return
    }

    if (isKey(evt, "up", "w", "W")) {
      prevent(evt)
      updateIfPlaying(rotateState)
      return
    }

    if (isKey(evt, "down", "s", "S")) {
      prevent(evt)
      step(true)
      schedule()
      return
    }

    if (isKey(evt, "space", " ")) {
      prevent(evt)
      if (!paused() && !ended(state())) replaceState(hardDropState(state()), true)
      schedule()
      return
    }

    if (isKey(evt, "c", "C")) {
      prevent(evt)
      updateIfPlaying(holdState)
    }
  })

  const Stat = (sp: { label: string; value: number; color: RGBA }) => (
    <box flexDirection="column" marginBottom={1}>
      <text fg={theme().accent}>
        <b>{sp.label}</b>
      </text>
      <text fg={sp.color}>
        <b>{sp.value}</b>
      </text>
    </box>
  )

  const Key = (kp: { label: string; desc: string }) => (
    <box flexDirection="row" gap={1}>
      <box minWidth={7}>
        <text fg={theme().accent}>
          <b>{kp.label}</b>
        </text>
      </box>
      <text fg={theme().textMuted}>{kp.desc}</text>
    </box>
  )

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme().backgroundPanel}
      border
      borderColor={theme().borderActive}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexDirection="row" gap={1} marginBottom={1}>
        <text fg={theme().accent}>
          <b>TETRIS BATTLE</b>
        </text>
        <text fg={theme().textMuted}>│</text>
        <text fg={theme().text}>
          Level <b>{state().level}</b>
        </text>
        <text fg={theme().textMuted}>│</text>
        <text fg={theme().textMuted}>Room {roomCode() || "none"}</text>
        <text fg={theme().textMuted}>│</text>
        <text fg={conn() === "connected" ? theme().success : theme().warning}>{conn()}</text>
        <Show when={opponent()}>
          <text fg={theme().textMuted}>│</text>
          <text fg={opponentDisconnected() ? theme().error : theme().success}>
            {opponentDisconnected() ? `opponent lost ${formatLatency(opponentLastSeenAgeMs())}` : "opponent online"}
          </text>
        </Show>
      </box>

      <Show when={isLobby()}>
        <box
          flexDirection="column"
          minWidth={66}
          backgroundColor={theme().backgroundElement}
          border
          borderColor={theme().borderActive}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={theme().accent}>
            <b>MULTIPLAYER LOBBY</b>
          </text>
          <text fg={theme().text}>Player: {playerId.slice(0, 8)}</text>
          <text fg={editingRoomCode() ? theme().warning : theme().text}>
            Room code: {roomCode() || (editingRoomCode() ? "typing..." : "press J to type, N create, M match")}
          </text>
          <Show when={editingRoomCode()}>
            <text fg={theme().warning}>Typing room code. Enter joins, Esc cancels, Backspace edits.</text>
          </Show>
          <Show when={roomStatus() === "countdown"}>
            <box flexDirection="row" gap={1} marginTop={1} marginBottom={1}>
              <text fg={theme().warning}>
                <b>MATCH STARTING IN</b>
              </text>
              <text fg={theme().success}>
                <b>{countdown()}</b>
              </text>
            </box>
          </Show>
          <text fg={theme().textMuted}>N create private room · J type room code · Enter join typed code · M matchmaking · R ready · Q quit</text>
          <text fg={theme().textMuted}>Each OpenCode window gets its own player id.</text>
          <Show when={confirmMessage()}>
            <text fg={theme().warning}>
              <b>{confirmMessage()}</b>
            </text>
          </Show>
          <Show when={!convexUrl()}>
            <text fg={theme().error}>Convex backend URL missing.</text>
          </Show>
          <Show when={busy()}>
            <text fg={theme().warning}>Working...</text>
          </Show>
          <Show when={error()}>
            <text fg={theme().error}>{error()}</text>
          </Show>
          <Show when={room()}>
            <box flexDirection="column" marginTop={1}>
              <text fg={theme().accent}>Players</text>
              <For each={room()?.players ?? []}>
                {(player) => (
                  <text fg={player.ready ? theme().success : theme().textMuted}>
                    {player.side} · {player.playerId.slice(0, 8)} · {player.ready ? "ready" : "not ready"} · {player.status}
                  </text>
                )}
              </For>
              <text fg={theme().textMuted}>Countdown starts automatically when two players are ready.</text>
            </box>
          </Show>
        </box>
      </Show>

      <Show when={!isLobby()}>
      <box flexDirection="column">
      <box flexDirection="row" gap={2} alignItems="flex-start">
        <box
          flexDirection="column"
          backgroundColor={theme().background}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          border
          borderColor={boardBorderColor()}
          title={boardTitle()}
          titleAlignment="center"
        >
          <For each={board()}>
            {(row) => (
              <box flexDirection="row">
                <For each={row}>
                  {(cell) => (
                    <text fg={cellColor(cell)}>{cell === null ? ". " : cellGlyph(cell) + cellGlyph(cell)}</text>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>

        <box flexDirection="column" minWidth={10}>
          <text fg={theme().accent}>
            <b>HOLD</b>
          </text>
          <PiecePreview type={state().hold} theme={theme()} />
          <text fg={theme().accent}>
            <b>NEXT</b>
          </text>
          <PiecePreview type={state().next} theme={theme()} />
          <Stat label="SCORE" value={state().score} color={theme().warning} />
          <Stat label="LINES" value={state().lines} color={theme().success} />
          <Stat label="HIGH" value={state().highScore} color={theme().warning} />
        </box>

        <box
          flexDirection="column"
          backgroundColor={theme().background}
          paddingTop={0}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          border
          borderColor={opponentBorderColor()}
          title={opponentTitle()}
          titleAlignment="center"
        >
          <text fg={theme().accent}>
            <b>OPPONENT            </b>
          </text>
          <For each={state().opponentBoard}>
            {(row) => (
              <box flexDirection="row">
                <For each={row}>
                  {(cell) => <text fg={rivalColor(cell, theme())}>{rivalGlyph(cell)}</text>}
                </For>
              </box>
            )}
          </For>
        </box>

        <box
          flexDirection="column"
          minWidth={24}
          backgroundColor={theme().backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          border
          borderColor={theme().borderSubtle}
        >
          <Stat label="LINES SENT" value={state().stats.sent} color={theme().success} />
          <Stat label="INCOMING" value={state().stats.incoming} color={theme().error} />
          <Stat label="COMBO" value={state().stats.combo} color={theme().accent} />
          <Stat label="OPP LINES" value={opponent()?.lines ?? 0} color={theme().warning} />
          <box flexDirection="column" marginBottom={1}>
            <text fg={theme().accent}>
              <b>NET</b>
            </text>
            <text fg={theme().textMuted}>me {formatLatency(publishLatencyMs())}</text>
            <text fg={theme().textMuted}>opp {formatLatency(opponentBoardAgeMs())}</text>
            <Show when={opponentDisconnected()}>
              <text fg={theme().error}>lost {formatLatency(opponentLastSeenAgeMs())}</text>
            </Show>
          </box>
          <text fg={theme().accent}>
            <b>GARBAGE</b>
          </text>
          <box flexDirection="row">
            <For each={incomingBars()}>
              {(active) => <text fg={active ? theme().error : theme().textMuted}>{active ? "█" : "░"}</text>}
            </For>
          </box>
          <box marginTop={1} flexDirection="column">
            <Key label="← →" desc="move" />
            <Key label="↑/W" desc="rotate" />
            <Key label="↓/S" desc="soft drop" />
            <Key label="SPACE" desc="hard drop" />
            <Key label="C" desc="hold" />
            <Key label="P" desc="pause" />
            <Key label="L" desc="lobby" />
            <Key label="Q" desc="quit" />
          </box>
        </box>
      </box>

      <box
        marginTop={1}
        flexDirection="row"
        gap={1}
        backgroundColor={theme().backgroundElement}
        paddingLeft={4}
        paddingRight={2}
      >
        <Show when={confirmMessage()}>
          <text fg={theme().warning}>
            <b>{confirmMessage()}</b>
          </text>
        </Show>
        <Show when={!confirmMessage()}>
        <Show
          when={state().won}
          fallback={
            <Show
              when={state().gameOver}
              fallback={
                <Show
                  when={paused()}
                  fallback={
                    <Show
                      when={opponentDisconnected()}
                      fallback={
                        <text fg={theme().textMuted}>
                          clear lines to cancel garbage or send attacks to opponent · L lobby · Q quit
                        </text>
                      }
                    >
                      <text fg={theme().error}>
                        <b>OPPONENT CONNECTION LOST</b>
                      </text>
                      <text fg={theme().text}>last seen {formatLatency(opponentLastSeenAgeMs())} · L lobby · Q quit</text>
                    </Show>
                  }
                >
                  <text fg={theme().warning}>
                    <b>PAUSED</b>
                  </text>
                  <text fg={theme().text}>Press any key to resume,</text>
                  <text fg={theme().accent}>
                    <b>Q</b>
                  </text>
                  <text fg={theme().text}>to quit</text>
                </Show>
              }
            >
              <text fg={theme().error}>
                <b>GAME OVER</b>
              </text>
              <text fg={theme().text}>
                Sent {state().stats.sent} · Score {state().score} · Winner {winner() === playerId ? "you" : "opponent"} · Press
              </text>
              <text fg={theme().accent}>
                <b>R</b>
              </text>
              <text fg={theme().text}>for rematch,</text>
              <text fg={theme().accent}>
                <b>L</b>
              </text>
              <text fg={theme().text}>lobby,</text>
              <text fg={theme().accent}>
                <b>Q</b>
              </text>
              <text fg={theme().text}>to quit</text>
            </Show>
          }
        >
          <text fg={theme().success}>
            <b>YOU WIN</b>
          </text>
          <text fg={theme().text}>
            Sent {state().stats.sent} · Score {state().score} · Press
          </text>
          <text fg={theme().accent}>
            <b>R</b>
          </text>
          <text fg={theme().text}>for rematch,</text>
          <text fg={theme().accent}>
            <b>L</b>
          </text>
          <text fg={theme().text}>lobby,</text>
          <text fg={theme().accent}>
            <b>Q</b>
          </text>
          <text fg={theme().text}>to quit</text>
        </Show>
        </Show>
      </box>
      </box>
      </Show>
    </box>
  )
}
