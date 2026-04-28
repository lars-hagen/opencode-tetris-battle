/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { RGBA, type ParsedKey } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from "solid-js";

// `<span>` in @opentui/solid is typed against an empty options object even
// though TextNodeRenderable accepts `fg`/`bg` at runtime. We use inline color
// runs heavily for the design canon, so we wrap the cast in one helper and
// stop fighting the typings.
type SpanColorProps = { fg?: RGBA; bg?: RGBA; children: JSX.Element };
const S = (props: SpanColorProps): JSX.Element => {
  const extra = { fg: props.fg, bg: props.bg } as Record<string, unknown>;
  return <span {...extra}>{props.children}</span>;
};

const highScoreKey = "opencode.tetris-battle.highscore";
const bestAttackKey = "opencode.tetris-battle.best-attack";
const boardWidth = 10;
const boardHeight = 20;
const tickMs = 500;
const heartbeatMs = 2_000;
const opponentStaleMs = 8_000;
const lineScores = [0, 100, 300, 500, 800] as const;

type RoomStatus = "waiting" | "countdown" | "active" | "done";
type PlayerStatus = "lobby" | "playing" | "ko" | "left";
type ConfirmAction = "quit" | "lobby";

type RemoteRoom = {
  code: string;
  status: RoomStatus;
  seed: string;
  hostPlayerId: string;
  guestPlayerId?: string;
  winnerPlayerId?: string;
  startedAt?: number;
};

type RemotePlayer = {
  playerId: string;
  side: "host" | "guest";
  ready: boolean;
  status: PlayerStatus;
  board: string;
  score: number;
  lines: number;
  level: number;
  sent: number;
  received: number;
  incoming: number;
  lastSeen: number;
};

type RemoteAttack = {
  _id: string;
  lines: number;
  cleared: number;
  combo: number;
  createdAt: number;
};

type RoomSnapshot = {
  room: RemoteRoom;
  players: RemotePlayer[];
  pendingAttacks: RemoteAttack[];
};

const refs = {
  getRoom: makeFunctionReference<
    "query",
    { code: string; playerId: string },
    RoomSnapshot | null
  >("tetris:getRoom"),
  createRoom: makeFunctionReference<
    "mutation",
    { code: string; seed: string; playerId: string },
    { code: string }
  >("tetris:createRoom"),
  joinRoom: makeFunctionReference<
    "mutation",
    { code: string; playerId: string },
    { code: string }
  >("tetris:joinRoom"),
  quickJoin: makeFunctionReference<
    "mutation",
    { code: string; seed: string; playerId: string },
    { code: string }
  >("tetris:quickJoin"),
  setReady: makeFunctionReference<
    "mutation",
    { code: string; playerId: string; ready: boolean },
    null
  >("tetris:setReady"),
  startMatch: makeFunctionReference<"mutation", { code: string }, null>(
    "tetris:startMatch",
  ),
  rematch: makeFunctionReference<
    "mutation",
    { code: string; seed: string; playerId: string },
    null
  >("tetris:rematch"),
  heartbeat: makeFunctionReference<
    "mutation",
    { code: string; playerId: string },
    null
  >("tetris:heartbeat"),
  submitBoard: makeFunctionReference<
    "mutation",
    {
      code: string;
      playerId: string;
      board: string;
      score: number;
      lines: number;
      level: number;
      sent: number;
      received: number;
      incoming: number;
      gameOver: boolean;
    },
    null
  >("tetris:submitBoard"),
  sendAttack: makeFunctionReference<
    "mutation",
    {
      code: string;
      fromPlayerId: string;
      lines: number;
      cleared: number;
      combo: number;
    },
    null
  >("tetris:sendAttack"),
  consumeAttacks: makeFunctionReference<
    "mutation",
    { attackIds: string[]; playerId: string },
    null
  >("tetris:consumeAttacks"),
  leaveRoom: makeFunctionReference<
    "mutation",
    { code: string; playerId: string },
    null
  >("tetris:leaveRoom"),
};

type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type BoardCell = PieceType | "garbage" | null;
type DisplayCell = PieceType | "ghost" | "garbage" | null;

type Piece = {
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
};

type BattleStats = {
  sent: number;
  received: number;
  incoming: number;
  combo: number;
  maxCombo: number;
  pieces: number;
  rivalLines: number;
  rivalSent: number;
  rivalPressure: number;
};

type GameState = {
  board: BoardCell[][];
  opponentBoard: BoardCell[][];
  bag: PieceType[];
  rng: number;
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdUsed: boolean;
  score: number;
  lines: number;
  level: number;
  gameOver: boolean;
  won: boolean;
  highScore: number;
  bestAttack: number;
  stats: BattleStats;
  outgoingAttacks: OutgoingAttack[];
};

type OutgoingAttack = {
  lines: number;
  cleared: number;
  combo: number;
};

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
};

const pieceNames = Object.keys(pieces) as PieceType[];

// ─── CANONICAL TETRIS PIECE COLORS (Tetris Guideline, full saturation) ─────
// Single source of truth for piece color across cells, ghosts, glyph strips,
// preview blocks, and hero gradients. Never inline these triples.
const PIECE: Record<PieceType, RGBA> = {
  I: RGBA.fromInts(0, 255, 255, 255), //  cyan
  O: RGBA.fromInts(255, 255, 0, 255), //  yellow
  T: RGBA.fromInts(170, 0, 255, 255), //  purple
  S: RGBA.fromInts(0, 255, 0, 255), //  green
  Z: RGBA.fromInts(255, 0, 0, 255), //  red
  J: RGBA.fromInts(0, 0, 255, 255), //  blue
  L: RGBA.fromInts(255, 127, 0, 255), //  orange
};

// ~45% intensity of the canonical piece color, used for ghost projections.
const PIECE_GHOST: Record<PieceType, RGBA> = {
  I: RGBA.fromInts(0, 115, 115, 255),
  O: RGBA.fromInts(120, 120, 0, 255),
  T: RGBA.fromInts(85, 0, 125, 255),
  S: RGBA.fromInts(0, 125, 0, 255),
  Z: RGBA.fromInts(125, 0, 0, 255),
  J: RGBA.fromInts(0, 0, 130, 255),
  L: RGBA.fromInts(125, 65, 0, 255),
};

const PIECE_ORDER: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

// ─── SECONDARY SEMANTIC PALETTE (single token map, never inline rgb) ───────
const C = {
  ink: RGBA.fromInts(232, 232, 240, 255),
  inkSoft: RGBA.fromInts(180, 184, 200, 255),
  muted: RGBA.fromInts(120, 124, 140, 255),
  faint: RGBA.fromInts(80, 84, 100, 255),
  empty: RGBA.fromInts(48, 50, 64, 255),
  panel: RGBA.fromInts(28, 30, 42, 255),
  panelLine: RGBA.fromInts(70, 74, 96, 255),
  dim: RGBA.fromInts(58, 60, 76, 255),
  accent: RGBA.fromInts(255, 90, 220, 255),
  warn: RGBA.fromInts(255, 170, 60, 255),
  ok: RGBA.fromInts(110, 240, 150, 255),
  win: RGBA.fromInts(110, 240, 150, 255),
  bad: RGBA.fromInts(255, 70, 90, 255),
  loss: RGBA.fromInts(255, 110, 130, 255),
  info: RGBA.fromInts(120, 180, 255, 255),
  gold: RGBA.fromInts(255, 220, 120, 255),
  cool: RGBA.fromInts(120, 220, 255, 255),
  garbage: RGBA.fromInts(145, 145, 155, 255),
  shadow: RGBA.fromInts(40, 30, 50, 255),
  dotRed: RGBA.fromInts(255, 95, 86, 255),
  dotYellow: RGBA.fromInts(255, 189, 46, 255),
  dotGreen: RGBA.fromInts(39, 201, 63, 255),
};

// Back-compat shims so the unchanged helpers below still resolve.
const pieceColors = PIECE;
const ghostColor = C.faint;
const dotColor = C.empty;
const garbageColor = C.garbage;

const seedNumber = (seed: string): number => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const rngNext = (seed: number): { seed: number; value: number } => {
  let h = (seed + 0x6d2b79f5) >>> 0;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { seed: h, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
};

const drawPiece = (state: Pick<GameState, "bag" | "rng">): PieceType => {
  if (state.bag.length < 2) {
    const bag = [...pieceNames];
    for (let i = bag.length - 1; i > 0; i--) {
      const next = rngNext(state.rng);
      state.rng = next.seed;
      const j = Math.floor(next.value * (i + 1));
      const tmp = bag[i]!;
      bag[i] = bag[j]!;
      bag[j] = tmp;
    }
    state.bag.push(...bag);
  }
  return state.bag.shift()!;
};

const getShape = (piece: Piece): number[][] => {
  const rotations = pieces[piece.type];
  return rotations[piece.rotation % rotations.length]!;
};

const createBoard = (): BoardCell[][] =>
  Array.from({ length: boardHeight }, () =>
    Array<BoardCell>(boardWidth).fill(null),
  );

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
  };
  return board
    .map((row) => row.map((cell) => (cell ? map[cell] : ".")).join(""))
    .join("");
};

const decodeBoard = (value: string | undefined): BoardCell[][] => {
  const chars = (value || "").padEnd(boardWidth * boardHeight, ".");
  const from = (char: string): BoardCell => {
    if (char === "G") return "garbage";
    return pieceNames.includes(char as PieceType) ? (char as PieceType) : null;
  };
  return Array.from({ length: boardHeight }, (_, row) =>
    Array.from({ length: boardWidth }, (_, col) =>
      from(chars[row * boardWidth + col]!),
    ),
  );
};

const randomGarbageRow = (): BoardCell[] => {
  const hole = Math.floor(Math.random() * boardWidth);
  return Array.from({ length: boardWidth }, (_, col) =>
    col === hole ? null : "garbage",
  );
};

const pushGarbage = (
  board: BoardCell[][],
  lines: number,
): { board: BoardCell[][]; toppedOut: boolean } => {
  const next = board.map((row) => [...row]);
  let toppedOut = false;
  for (let i = 0; i < lines; i++) {
    const removed = next.shift();
    if (removed?.some((cell) => cell !== null)) toppedOut = true;
    next.push(randomGarbageRow());
  }
  return { board: next, toppedOut };
};

const spawnPiece = (type: PieceType): Piece => ({
  type,
  rotation: 0,
  x: Math.floor(boardWidth / 2) - 1,
  y: 0,
});

const createInitialState = (
  highScore = 0,
  bestAttack = 0,
  seed?: string,
): GameState => {
  const draw = {
    rng: seed ? seedNumber(seed) : Math.floor(Math.random() * 0xffffffff),
    bag: [] as PieceType[],
  };
  const first = drawPiece(draw);
  const next = drawPiece(draw);
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
  };
};

const cloneState = (state: GameState): GameState => ({
  ...state,
  board: state.board.map((row) => [...row]),
  opponentBoard: state.opponentBoard.map((row) => [...row]),
  bag: [...state.bag],
  current: { ...state.current },
  stats: { ...state.stats },
  outgoingAttacks: [...state.outgoingAttacks],
});

const ended = (state: GameState): boolean => state.gameOver || state.won;

const collides = (board: BoardCell[][], piece: Piece): boolean => {
  const shape = getShape(piece);
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row]!.length; col++) {
      if (!shape[row]![col]) continue;
      const boardX = piece.x + col;
      const boardY = piece.y + row;
      if (boardX < 0 || boardX >= boardWidth || boardY >= boardHeight)
        return true;
      if (boardY >= 0 && board[boardY]![boardX] !== null) return true;
    }
  }
  return false;
};

const lockPiece = (board: BoardCell[][], piece: Piece): void => {
  const shape = getShape(piece);
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row]!.length; col++) {
      if (!shape[row]![col]) continue;
      const boardX = piece.x + col;
      const boardY = piece.y + row;
      if (
        boardY >= 0 &&
        boardY < boardHeight &&
        boardX >= 0 &&
        boardX < boardWidth
      ) {
        board[boardY]![boardX] = piece.type;
      }
    }
  }
};

const clearLines = (board: BoardCell[][]): number => {
  let cleared = 0;
  for (let row = boardHeight - 1; row >= 0; row--) {
    if (board[row]!.every((cell) => cell !== null)) {
      board.splice(row, 1);
      board.unshift(Array<BoardCell>(boardWidth).fill(null));
      cleared++;
      row++;
    }
  }
  return cleared;
};

const attackForClear = (cleared: number, combo: number): number => {
  const base = cleared === 4 ? 4 : cleared === 3 ? 2 : cleared === 2 ? 1 : 0;
  const comboBonus = combo >= 7 ? 3 : combo >= 5 ? 2 : combo >= 2 ? 1 : 0;
  return base + comboBonus;
};

const applyPlayerAttack = (
  state: GameState,
  attack: number,
  cleared: number,
): void => {
  if (attack <= 0) return;
  const cancelled = Math.min(attack, state.stats.incoming);
  const sent = attack - cancelled;
  state.stats.incoming -= cancelled;
  state.stats.sent += sent;
  state.stats.rivalPressure += sent;
  if (sent > 0) {
    state.outgoingAttacks.push({
      lines: sent,
      cleared,
      combo: state.stats.combo,
    });
  }
};

const injectIncoming = (state: GameState): void => {
  if (state.stats.incoming <= 0) return;
  const incoming = Math.min(4, state.stats.incoming);
  const result = pushGarbage(state.board, incoming);
  state.board = result.board;
  state.stats.incoming -= incoming;
  state.stats.received += incoming;
  if (result.toppedOut) state.gameOver = true;
};

const tickState = (
  state: GameState,
  softDrop: boolean,
): { state: GameState; locked: boolean } => {
  if (ended(state)) return { state, locked: false };
  const next = cloneState(state);
  const moved = { ...next.current, y: next.current.y + 1 };
  if (!collides(next.board, moved)) {
    next.current = moved;
    if (softDrop) next.score += 1;
    next.highScore = Math.max(next.highScore, next.score);
    return { state: next, locked: false };
  }

  lockPiece(next.board, next.current);
  next.stats.pieces++;
  const cleared = clearLines(next.board);
  if (cleared > 0) {
    next.lines += cleared;
    next.score += (lineScores[cleared] ?? 0) * next.level;
    next.level = Math.floor(next.lines / 10) + 1;
    next.stats.combo++;
    next.stats.maxCombo = Math.max(next.stats.maxCombo, next.stats.combo);
    applyPlayerAttack(next, attackForClear(cleared, next.stats.combo), cleared);
  } else {
    next.stats.combo = 0;
    injectIncoming(next);
  }

  next.highScore = Math.max(next.highScore, next.score);
  next.bestAttack = Math.max(next.bestAttack, next.stats.sent);
  if (!ended(next)) {
    next.current = spawnPiece(next.next);
    next.next = drawPiece(next);
    next.holdUsed = false;
    if (collides(next.board, next.current)) next.gameOver = true;
  }
  return { state: next, locked: true };
};

const moveState = (state: GameState, dx: number): GameState => {
  const moved = { ...state.current, x: state.current.x + dx };
  return collides(state.board, moved) ? state : { ...state, current: moved };
};

const rotateState = (state: GameState): GameState => {
  const rotated = {
    ...state.current,
    rotation: (state.current.rotation + 1) % pieces[state.current.type].length,
  };
  if (!collides(state.board, rotated)) return { ...state, current: rotated };
  for (const offset of [-1, 1, -2, 2]) {
    const kicked = { ...rotated, x: rotated.x + offset };
    if (!collides(state.board, kicked)) return { ...state, current: kicked };
  }
  return state;
};

const holdState = (state: GameState): GameState => {
  if (state.holdUsed || ended(state)) return state;
  const currentType = state.current.type;
  const next = cloneState(state);
  next.holdUsed = true;
  if (next.hold) {
    next.current = spawnPiece(next.hold);
    next.hold = currentType;
  } else {
    next.hold = currentType;
    next.current = spawnPiece(next.next);
    next.next = drawPiece(next);
  }
  if (collides(next.board, next.current)) next.gameOver = true;
  return next;
};

const hardDropState = (state: GameState): GameState => {
  let next = cloneState(state);
  while (!collides(next.board, { ...next.current, y: next.current.y + 1 })) {
    next = {
      ...next,
      current: { ...next.current, y: next.current.y + 1 },
      score: next.score + 2,
    };
  }
  return tickState(next, false).state;
};

const displayBoard = (state: GameState): DisplayCell[][] => {
  const display: DisplayCell[][] = state.board.map((row) => [...row]);
  if (ended(state)) return display;

  const ghost = { ...state.current };
  while (!collides(state.board, { ...ghost, y: ghost.y + 1 })) ghost.y++;

  const draw = (piece: Piece, cell: DisplayCell, emptyOnly: boolean) => {
    const shape = getShape(piece);
    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row]!.length; col++) {
        if (!shape[row]![col]) continue;
        const boardX = piece.x + col;
        const boardY = piece.y + row;
        if (
          boardY < 0 ||
          boardY >= boardHeight ||
          boardX < 0 ||
          boardX >= boardWidth
        )
          continue;
        if (emptyOnly && display[boardY]![boardX] !== null) continue;
        display[boardY]![boardX] = cell;
      }
    }
  };

  draw(ghost, "ghost", true);
  draw(state.current, state.current.type, false);
  return display;
};

const syncBoard = (state: GameState): BoardCell[][] => {
  const board = state.board.map((row) => [...row]);
  if (ended(state)) return board;
  const shape = getShape(state.current);
  for (let row = 0; row < shape.length; row++) {
    for (let col = 0; col < shape[row]!.length; col++) {
      if (!shape[row]![col]) continue;
      const boardX = state.current.x + col;
      const boardY = state.current.y + row;
      if (
        boardY < 0 ||
        boardY >= boardHeight ||
        boardX < 0 ||
        boardX >= boardWidth
      )
        continue;
      board[boardY]![boardX] = state.current.type;
    }
  }
  return board;
};

const getTickSpeed = (state: GameState): number =>
  Math.max(100, tickMs - (state.level - 1) * 40);

const isKey = (evt: ParsedKey, ...names: string[]) => names.includes(evt.name);

const prevent = (evt: ParsedKey) => {
  const controlled = evt as ParsedKey & {
    preventDefault?: () => void;
    stopPropagation?: () => void;
  };
  controlled.preventDefault?.();
  controlled.stopPropagation?.();
};

const asSavedNumber = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
};

const countdownText = (startedAt: number | undefined, now: number): string => {
  if (!startedAt) return "3";
  const remaining = startedAt - now;
  if (remaining <= 0) return "GO";
  return String(Math.max(1, Math.ceil(remaining / 1000)));
};

const formatLatency = (value: number | null): string => {
  if (value === null) return "...";
  return `${Math.max(0, Math.round(value))}ms`;
};

const cellGlyph = (cell: DisplayCell): string => {
  if (cell === null) return "·";
  if (cell === "ghost") return "░";
  if (cell === "garbage") return "▓";
  return "█";
};

const cellColor = (cell: DisplayCell, ghostPiece?: PieceType | null): RGBA => {
  if (cell === null) return dotColor;
  if (cell === "ghost")
    return ghostPiece ? PIECE_GHOST[ghostPiece] : ghostColor;
  if (cell === "garbage") return garbageColor;
  return pieceColors[cell];
};

const rivalGlyph = (cell: BoardCell): string =>
  cell === null ? "· " : cell === "garbage" ? "▓▓" : "██";

const rivalColor = (cell: BoardCell, _theme: TuiThemeCurrent): RGBA => {
  if (cell === null) return C.empty;
  if (cell === "garbage") return C.garbage;
  return PIECE[cell];
};

const asString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const createId = (): string => {
  const bun = globalThis as typeof globalThis & {
    Bun?: { randomUUIDv7?: () => string };
  };
  return bun.Bun?.randomUUIDv7?.() ?? crypto.randomUUID();
};

const createRoomCode = (): string => {
  // Canon uses 4-digit numeric codes (e.g. 4729, 8821). Skip 0/1 to avoid
  // visual ambiguity with O/I in the lobby slot rendering.
  const alphabet = "23456789";
  return Array.from(
    { length: 4 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
};

const normalizeRoomCode = (code: string): string =>
  code
    .trim()
    .replace(/[^0-9]/g, "")
    .slice(0, 4);

const isEnterKey = (evt: ParsedKey): boolean => {
  return (
    isKey(evt, "enter", "return") ||
    evt.sequence === "\r" ||
    evt.sequence === "\n" ||
    evt.raw === "\r" ||
    evt.raw === "\n"
  );
};

let processPlayerId = "";

const getPlayerId = (): string => {
  processPlayerId ||= createId();
  return processPlayerId;
};

// Render-only: turn a raw playerId into a SCREAMING_SNAKE handle that matches
// the canon's `KASPAROV_BLOX` / `TSPIN_QUEEN` shape. Local player can override
// with an explicit name, otherwise fall back to `PLAYER_XXXXXX` (or
// `PLAYER_UNKNOWN` when no id is available yet).
const playerHandle = (id: string | undefined, override?: string): string => {
  if (override && override.trim()) return override.trim().toUpperCase();
  if (!id) return "PLAYER_UNKNOWN";
  return `PLAYER_${id.slice(0, 6).toUpperCase()}`;
};

const LOCAL_PLAYER_NAME = "LARS_HAGEN";

// Backend `convex/tetris.ts` throws Title Case error strings; the plugin UI
// is lowercase. Map known cases to canon-style copy and fall back to a
// lowercased version of whatever else slips through.
const ERROR_MAP: Record<string, string> = {
  "room code already exists": "room code already exists · try again",
  "room not found": "room not found · check the code",
  "room is finished": "room is finished · pick a fresh one",
  "room is full": "room is full · find another",
  "player not in room": "player not in room · rejoin to continue",
};
const canonicalizeError = (msg: string): string => {
  if (!msg) return "";
  const lower = msg.toLowerCase().trim();
  return ERROR_MAP[lower] ?? lower;
};

// ════════════════════════════════════════════════════════════════════════════
// DESIGN LAYER — UI primitives + screens
// All rendering follows the canon in lbfa-tetris-screens.ts:
//   ANSI Shadow figlet hero · rounded chrome · square panels · framed buttons
//   · piece-color strip · canonical hint bars · SCREAMING_SNAKE labels.
// Game logic, networking, KV, Convex calls above this line are untouched.
// ════════════════════════════════════════════════════════════════════════════

const FRAME_WIDTH = 120;

// ─── Hero figlet strings (ANSI Shadow, pre-baked at build time) ────────────
// Hardcoded so the plugin doesn't pull figlet at runtime. Trimmed of trailing
// blank line, kept exactly as `bunx figlet -f "ANSI Shadow"` produced them.
const FIGLET = {
  TETRIS_BATTLE: [
    "████████╗███████╗████████╗██████╗ ██╗███████╗    ██████╗  █████╗ ████████╗████████╗██╗     ███████╗",
    "╚══██╔══╝██╔════╝╚══██╔══╝██╔══██╗██║██╔════╝    ██╔══██╗██╔══██╗╚══██╔══╝╚══██╔══╝██║     ██╔════╝",
    "   ██║   █████╗     ██║   ██████╔╝██║███████╗    ██████╔╝███████║   ██║      ██║   ██║     █████╗  ",
    "   ██║   ██╔══╝     ██║   ██╔══██╗██║╚════██║    ██╔══██╗██╔══██║   ██║      ██║   ██║     ██╔══╝  ",
    "   ██║   ███████╗   ██║   ██║  ██║██║███████║    ██████╔╝██║  ██║   ██║      ██║   ███████╗███████╗",
    "   ╚═╝   ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚══════╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝      ╚═╝   ╚══════╝╚══════╝",
  ],
  LOBBY: [
    "██╗      ██████╗ ██████╗ ██████╗ ██╗   ██╗",
    "██║     ██╔═══██╗██╔══██╗██╔══██╗╚██╗ ██╔╝",
    "██║     ██║   ██║██████╔╝██████╔╝ ╚████╔╝ ",
    "██║     ██║   ██║██╔══██╗██╔══██╗  ╚██╔╝  ",
    "███████╗╚██████╔╝██████╔╝██████╔╝   ██║   ",
    "╚══════╝ ╚═════╝ ╚═════╝ ╚═════╝    ╚═╝   ",
  ],
  VICTORY: [
    "██╗   ██╗██╗ ██████╗████████╗ ██████╗ ██████╗ ██╗   ██╗",
    "██║   ██║██║██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗╚██╗ ██╔╝",
    "██║   ██║██║██║        ██║   ██║   ██║██████╔╝ ╚████╔╝ ",
    "╚██╗ ██╔╝██║██║        ██║   ██║   ██║██╔══██╗  ╚██╔╝  ",
    " ╚████╔╝ ██║╚██████╗   ██║   ╚██████╔╝██║  ██║   ██║   ",
    "  ╚═══╝  ╚═╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ",
  ],
  DEFEAT: [
    "██████╗ ███████╗███████╗███████╗ █████╗ ████████╗",
    "██╔══██╗██╔════╝██╔════╝██╔════╝██╔══██╗╚══██╔══╝",
    "██║  ██║█████╗  █████╗  █████╗  ███████║   ██║   ",
    "██║  ██║██╔══╝  ██╔══╝  ██╔══╝  ██╔══██║   ██║   ",
    "██████╔╝███████╗██║     ███████╗██║  ██║   ██║   ",
    "╚═════╝ ╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝   ╚═╝   ",
  ],
  PAUSED: [
    "██████╗  █████╗ ██╗   ██╗███████╗███████╗██████╗ ",
    "██╔══██╗██╔══██╗██║   ██║██╔════╝██╔════╝██╔══██╗",
    "██████╔╝███████║██║   ██║███████╗█████╗  ██║  ██║",
    "██╔═══╝ ██╔══██║██║   ██║╚════██║██╔══╝  ██║  ██║",
    "██║     ██║  ██║╚██████╔╝███████║███████╗██████╔╝",
    "╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚═════╝ ",
  ],
} as const;

// Vertical gradient: pick a color per row by interpolating between stops.
const gradientRowColor = (row: number, total: number, stops: RGBA[]): RGBA => {
  if (stops.length === 0) return C.ink;
  if (stops.length === 1 || total <= 1) return stops[0]!;
  const t = row / (total - 1);
  const seg = t * (stops.length - 1);
  const a = Math.floor(seg);
  const b = Math.min(stops.length - 1, a + 1);
  const f = seg - a;
  const sa = stops[a]!;
  const sb = stops[b]!;
  return RGBA.fromInts(
    Math.round(sa.r * 255 + (sb.r * 255 - sa.r * 255) * f),
    Math.round(sa.g * 255 + (sb.g * 255 - sa.g * 255) * f),
    Math.round(sa.b * 255 + (sb.b * 255 - sa.b * 255) * f),
    255,
  );
};

// Hero banner — vertical gradient applied row-wise.
const HeroBanner = (props: { lines: readonly string[]; stops: RGBA[] }) => (
  <box flexDirection="column" alignItems="center">
    <For each={props.lines as readonly string[]}>
      {(line, i) => (
        <text fg={gradientRowColor(i(), props.lines.length, props.stops)}>
          <b>{line}</b>
        </text>
      )}
    </For>
  </box>
);

// Rainbow hero — splash uses the 7-piece palette, one color per cluster of
// non-space chars, like the canon's `rainbowPiecesBlock`.
const RainbowHero = (props: { lines: readonly string[] }) => {
  const colors = PIECE_ORDER.map((p) => PIECE[p]);
  return (
    <box flexDirection="column" alignItems="center">
      <For each={props.lines as readonly string[]}>
        {(line) => {
          // Split the line into runs at space boundaries; alternate piece colors.
          const segments: { text: string; color: RGBA | null }[] = [];
          let buf = "";
          let inWord = false;
          let colorIdx = -1;
          for (const ch of line) {
            if (ch === " ") {
              if (inWord) {
                segments.push({
                  text: buf,
                  color: colors[colorIdx % colors.length]!,
                });
                buf = "";
                inWord = false;
              }
              buf += ch;
            } else {
              if (!inWord) {
                if (buf) segments.push({ text: buf, color: null });
                buf = "";
                inWord = true;
                colorIdx = (colorIdx + 1) % colors.length;
              }
              buf += ch;
            }
          }
          if (buf)
            segments.push({
              text: buf,
              color: inWord ? colors[colorIdx % colors.length]! : null,
            });
          return (
            <text>
              <For each={segments}>
                {(seg) => (
                  <S fg={seg.color ?? C.faint}>
                    <b>{seg.text}</b>
                  </S>
                )}
              </For>
            </text>
          );
        }}
      </For>
    </box>
  );
};

// 7-piece tetromino accent strip. Used as a brand row between header and body.
const PieceStrip = (props: { compact?: boolean }) => (
  <box flexDirection="row" alignItems="center">
    <For each={PIECE_ORDER}>
      {(p) => (
        <text fg={PIECE[p]}>
          <b>{props.compact ? "███" : "██████"}</b>
        </text>
      )}
    </For>
  </box>
);

// Window chrome: rounded outer border with mac dots, breadcrumb, latency.
// Implemented as two pieces — a styled top bar above a `border` box body.
const WindowChrome = (props: {
  route: string;
  version: string;
  latencyMs: string;
  latencyColor?: RGBA;
  children: JSX.Element;
}) => (
  <box
    flexDirection="column"
    border
    borderStyle="rounded"
    borderColor={C.panelLine}
    width="100%"
    flexGrow={1}
    paddingLeft={1}
    paddingRight={1}
    paddingTop={0}
    paddingBottom={0}
  >
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingTop={0}
      paddingBottom={0}
    >
      <text>
        <S fg={C.dotRed}>●</S>
        <S fg={C.muted}> </S>
        <S fg={C.dotYellow}>●</S>
        <S fg={C.muted}> </S>
        <S fg={C.dotGreen}>●</S>
        <S fg={C.muted}> </S>
        <S fg={C.ink}>{props.route}</S>
        <S fg={C.muted}> — opencode tui</S>
      </text>
      <text>
        <S fg={C.muted}>{props.version}</S>
        <S fg={C.faint}> • </S>
        <S fg={props.latencyColor ?? C.muted}>{props.latencyMs}</S>
      </text>
    </box>
    <box
      flexDirection="row"
      paddingTop={0}
      paddingBottom={0}
      borderStyle="single"
      border={["top"]}
      borderColor={C.panelLine}
    />
    {props.children}
  </box>
);

// Status ribbon under chrome — `TETRIS BATTLE // STATE  metadata...`
const StatusRibbon = (props: {
  state: string;
  stateColor: RGBA;
  middle?: JSX.Element;
  right?: JSX.Element;
}) => (
  <box
    flexDirection="row"
    justifyContent="space-between"
    alignItems="center"
    paddingTop={0}
    paddingBottom={0}
  >
    <text>
      <S fg={C.ink}>
        <b>TETRIS BATTLE</b>
      </S>
      <S fg={C.faint}> // </S>
      <S fg={props.stateColor}>
        <b>{props.state}</b>
      </S>
    </text>
    <Show when={props.middle}>{props.middle}</Show>
    <Show when={props.right}>{props.right}</Show>
  </box>
);

// Square inner panel (the `┌─ TITLE ──┐` shape from canon).
const Panel = (props: {
  title: string;
  titleColor?: RGBA;
  width?: number | "auto" | `${number}%`;
  flexGrow?: number;
  children: JSX.Element;
}) => {
  // The opentui Box `title` prop renders the title baked into the top border
  // and inherits the border color. Canon wants the title tinted in its own
  // accent (e.g. green CREATE / blue JOIN / pink LOBBY) while the border
  // stays in C.panelLine. Easiest path: skip the built-in title and render
  // a bold tinted header row inside the panel, mimicking the canon's
  // `┌─ TITLE ──┐` shape.
  return (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={C.panelLine}
      width={props.width}
      flexGrow={props.flexGrow}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
    >
      <text>
        <S fg={props.titleColor ?? C.inkSoft}>
          <b>{props.title}</b>
        </S>
      </text>
      {props.children}
    </box>
  );
};

// Canonical framed-box button — three lines, used on Victory + Pause.
const FramedButton = (props: {
  keyLabel: string;
  label: string;
  color: RGBA;
}) => (
  <box
    flexDirection="column"
    border
    borderStyle="single"
    borderColor={C.panelLine}
    paddingLeft={1}
    paddingRight={1}
    paddingTop={0}
    paddingBottom={0}
    minWidth={22}
  >
    <text>
      <S fg={props.color}>
        <b>[{props.keyLabel}]</b>
      </S>
      <S fg={C.muted}> </S>
      <S fg={C.ink}>
        <b>{props.label}</b>
      </S>
    </text>
  </box>
);

// Canonical hint bar — `┄ [KEY] verb · [KEY] verb · … ┄`.
type HintItem = { key: string; verb: string };
const HintBar = (props: { items: HintItem[] }) => (
  <text>
    <S fg={C.faint}>┄ </S>
    <For each={props.items}>
      {(item, i) => (
        <>
          <Show when={i() > 0}>
            <S fg={C.faint}> · </S>
          </Show>
          <S fg={C.ink}>
            <b>[{item.key}]</b>
          </S>
          <S fg={C.muted}> {item.verb}</S>
        </>
      )}
    </For>
    <S fg={C.faint}> ┄</S>
  </text>
);

// Stat label + value pair. Label in SCREAMING_SNAKE muted; value bold tinted.
const StatLine = (props: {
  label: string;
  value: string | number;
  color: RGBA;
  inline?: boolean;
}) => (
  <Show
    when={props.inline}
    fallback={
      <box flexDirection="column">
        <text>
          <S fg={C.muted}>{props.label}</S>
        </text>
        <text>
          <S fg={props.color}>
            <b>{String(props.value)}</b>
          </S>
        </text>
      </box>
    }
  >
    <text>
      <S fg={C.muted}>{props.label} </S>
      <S fg={props.color}>
        <b>{String(props.value)}</b>
      </S>
    </text>
  </Show>
);

// Inline state dot — `● connected` / `● ready` / `● paused`.
const StateDot = (props: { color: RGBA; label: string }) => (
  <text>
    <S fg={props.color}>● </S>
    <S fg={C.muted}>{props.label}</S>
  </text>
);

// 4-cell digit slot — used in lobby JOIN card and room code preview.
const DigitSlot = (props: { value: string; color: RGBA }) => (
  <box
    border
    borderStyle="single"
    borderColor={C.panelLine}
    paddingLeft={1}
    paddingRight={1}
    paddingTop={0}
    paddingBottom={0}
    minWidth={4}
    alignItems="center"
  >
    <text>
      <S fg={props.value ? props.color : C.muted}>
        <b>{props.value || "_"}</b>
      </S>
    </text>
  </box>
);

// Compact piece preview — 4×2 cells, piece tinted, empty = dark slate.
const PreviewBlock = (props: { type: PieceType }) => {
  // Use the canon's compact 2-row shape per piece (matches mockup `previewPiece`).
  const shapes: Record<PieceType, [number, number][]> = {
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
  };
  const cells = new Set(shapes[props.type].map(([r, c]) => `${r},${c}`));
  const grid = [0, 1].map((r) =>
    [0, 1, 2, 3].map((c) => cells.has(`${r},${c}`)),
  );
  return (
    <box flexDirection="column">
      <For each={grid}>
        {(row) => (
          <text>
            <For each={row}>
              {(filled) =>
                filled ? (
                  <S fg={PIECE[props.type]}>
                    <b>██</b>
                  </S>
                ) : (
                  <S fg={C.empty}>{"  "}</S>
                )
              }
            </For>
          </text>
        )}
      </For>
    </box>
  );
};

// ─── TetrisBattle — single component, all 5 screens routed by state ────────

const PiecePreview = (props: { type: PieceType | null }) => (
  <Show
    when={props.type}
    fallback={
      <box flexDirection="column">
        <text>
          <S fg={C.empty}> </S>
        </text>
        <text>
          <S fg={C.empty}> </S>
        </text>
      </box>
    }
  >
    <PreviewBlock type={props.type!} />
  </Show>
);

// Status string + color the ribbon wears across screens.
type RouteState = "splash" | "lobby" | "room" | "match" | "paused" | "over";

export const TetrisBattle = (props: {
  api: TuiPluginApi;
  convexUrlKey: string;
  defaultConvexUrl: string;
  onClose: () => void;
}) => {
  const playerId = getPlayerId();
  const [roomCode, setRoomCode] = createSignal("");
  const [client, setClient] = createSignal<ConvexClient | null>(null);
  const [room, setRoom] = createSignal<RoomSnapshot | null>(null);
  const [conn, setConn] = createSignal("disconnected");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [ready, setReadyLocal] = createSignal(false);
  const [started, setStarted] = createSignal(false);
  const [editingRoomCode, setEditingRoomCode] = createSignal(false);
  const [confirmAction, setConfirmAction] = createSignal<ConfirmAction | null>(
    null,
  );
  const [now, setNow] = createSignal(Date.now());
  const [publishLatencyMs, setPublishLatencyMs] = createSignal<number | null>(
    null,
  );
  const [opponentBoardSeenAt, setOpponentBoardSeenAt] = createSignal<
    number | null
  >(null);
  const [splashSeen, setSplashSeen] = createSignal(false);
  const [state, setState] = createSignal(
    createInitialState(
      asSavedNumber(props.api.kv.get(highScoreKey, 0)),
      asSavedNumber(props.api.kv.get(bestAttackKey, 0)),
    ),
  );
  const [paused, setPaused] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let countdownStartTimer: ReturnType<typeof setTimeout> | undefined;
  let publishTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeRoom: (() => void) | undefined;
  let unsubscribeConn: (() => void) | undefined;
  let currentUrl = "";
  let lastPublishedSnapshot = "";
  let publishInFlight = false;
  let startMatchInFlight = false;
  let lastStartMatchAttempt = 0;
  let lastOpponentBoard = "";
  const consumedAttackIds = new Set<string>();

  const theme = createMemo(() => props.api.theme.current);
  const board = createMemo(() => displayBoard(state()));
  const ghostPieceType = createMemo<PieceType | null>(() =>
    ended(state()) ? null : state().current.type,
  );
  const incomingBars = createMemo(() =>
    Array.from(
      { length: 8 },
      (_, i) => i < Math.min(8, state().stats.incoming),
    ),
  );
  const convexUrl = createMemo(() =>
    asString(
      props.api.kv.get(props.convexUrlKey, props.defaultConvexUrl),
      props.defaultConvexUrl,
    ),
  );
  const me = createMemo(() =>
    room()?.players.find((p) => p.playerId === playerId),
  );
  const opponent = createMemo(() =>
    room()?.players.find((p) => p.playerId !== playerId && p.status !== "left"),
  );
  const roomStatus = createMemo(() => room()?.room.status ?? "waiting");
  const countdown = createMemo(() =>
    roomStatus() === "countdown"
      ? countdownText(room()?.room.startedAt, now())
      : "",
  );
  const inRoom = createMemo(() => Boolean(roomCode()) && Boolean(room()));
  // Route memo (below) drives all UI gating; we do not need a separate
  // boolean for "is in lobby" because `route() === "lobby"` is the source.
  // Route memo drives all UI gating below.
  // Order matters: live game routes win over `over`, and an active waiting/
  // countdown room snapshot must trump a stale `ended(state())` left over
  // from the previous match (rematch flow). The local `state` is also reset
  // in `restart()` so this can't happen, but the ordering is the belt.
  const route = createMemo<RouteState>(() => {
    if (!splashSeen()) return "splash";
    if (paused() && started() && roomStatus() === "active") return "paused";
    if (roomStatus() === "active" && started() && !ended(state()))
      return "match";
    if (roomStatus() === "waiting" || roomStatus() === "countdown") {
      return inRoom() ? "room" : "lobby";
    }
    if (ended(state()) || roomStatus() === "done") return "over";
    if (inRoom()) return "room";
    return "lobby";
  });
  const winner = createMemo(() => room()?.room.winnerPlayerId);
  const opponentBoardAgeMs = createMemo(() => {
    const seenAt = opponentBoardSeenAt();
    if (seenAt === null) return null;
    return now() - seenAt;
  });
  const opponentLastSeenAgeMs = createMemo(() => {
    const lastSeen = opponent()?.lastSeen;
    if (lastSeen === undefined) return null;
    return now() - lastSeen;
  });
  const opponentDisconnected = createMemo(() => {
    const age = opponentLastSeenAgeMs();
    return age !== null && age > opponentStaleMs;
  });
  const confirmMessage = createMemo(() => {
    const action = confirmAction();
    if (action === "quit") return "[Q] quit again · [ESC] cancel";
    if (action === "lobby") return "[L] lobby again · [ESC] cancel";
    return "";
  });
  // Latency for the chrome top-right gutter — always numeric, never a label.
  // Disconnected → `0ms` in C.bad. Connected but no sample yet → `--ms` in
  // C.muted. Connected with a sample → `{N}ms` in C.muted (or C.ok when fast).
  const latencyBadge = createMemo(() => {
    if (conn() !== "connected") return { text: "0ms", color: C.bad };
    const lat = publishLatencyMs();
    if (lat === null) return { text: "--ms", color: C.muted };
    const ms = Math.max(0, Math.round(lat));
    return { text: `${ms}ms`, color: ms <= 60 ? C.ok : C.muted };
  });
  // Connection state dot — derived from the live `conn()` signal so the
  // status ribbon never lies about being connected when we're not.
  const connBadge = createMemo(() => {
    const c = conn();
    if (c === "connected") return { color: C.ok, label: "connected" };
    if (c === "connecting") return { color: C.warn, label: "connecting" };
    return { color: C.bad, label: "disconnected" };
  });
  const ConnDot = () => (
    <StateDot color={connBadge().color} label={connBadge().label} />
  );
  const matchTimeText = createMemo(() => {
    const startedAt = room()?.room.startedAt;
    if (!startedAt) return "00:00";
    const elapsed = Math.max(0, now() - startedAt);
    const s = Math.floor(elapsed / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  });

  let lastPersistedHighScore = asSavedNumber(props.api.kv.get(highScoreKey, 0));
  let lastPersistedBestAttack = asSavedNumber(
    props.api.kv.get(bestAttackKey, 0),
  );

  const runMutation = async <T,>(
    fn: () => Promise<T>,
  ): Promise<T | undefined> => {
    setError("");
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const requestStartMatch = () => {
    const cx = client();
    const snapshot = room();
    if (!cx || snapshot?.room.status !== "countdown") return;
    const nowMs = Date.now();
    if (startMatchInFlight || nowMs - lastStartMatchAttempt < 500) return;
    startMatchInFlight = true;
    lastStartMatchAttempt = nowMs;
    cx.mutation(refs.startMatch, { code: snapshot.room.code })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => {
        startMatchInFlight = false;
      });
  };

  const subscribeRoom = (code: string) => {
    unsubscribeRoom?.();
    const cx = untrack(client);
    if (!cx || !code) return;
    unsubscribeRoom = cx.onUpdate(
      refs.getRoom,
      { code, playerId },
      (snapshot) => setRoom(snapshot),
      (err) => setError(err.message),
    );
  };

  createEffect(() => {
    const url = convexUrl();
    if (url === currentUrl) return;
    currentUrl = url;
    unsubscribeRoom?.();
    unsubscribeRoom = undefined;
    unsubscribeConn?.();
    unsubscribeConn = undefined;
    const previous = untrack(client);
    if (!url) {
      setClient(null);
      setConn("missing url");
      previous?.close().catch(() => {});
      return;
    }
    const next = new ConvexClient(url, { unsavedChangesWarning: false });
    setClient(next);
    setConn("connecting");
    unsubscribeConn = next.subscribeToConnectionState((s) => {
      setConn(s.isWebSocketConnected ? "connected" : "connecting");
    });
    previous?.close().catch(() => {});
    const code = untrack(roomCode);
    if (code) {
      subscribeRoom(code);
      void next.mutation(refs.joinRoom, { code, playerId }).catch(() => {});
    }
  });

  const setRoomAndSubscribe = (code: string) => {
    const normalized = normalizeRoomCode(code);
    setRoomCode(normalized);
    setEditingRoomCode(false);
    subscribeRoom(normalized);
  };

  const createRoom = async () => {
    const cx = client();
    if (!cx) {
      setError("backend not configured");
      return;
    }
    const code = createRoomCode();
    const result = await runMutation(() =>
      cx.mutation(refs.createRoom, { code, seed: createId(), playerId }),
    );
    if (result?.code) setRoomAndSubscribe(result.code);
    setReadyLocal(false);
    setStarted(false);
  };

  const joinRoom = async () => {
    const cx = client();
    if (!cx) {
      setError("backend not configured");
      return;
    }
    const code = normalizeRoomCode(roomCode());
    if (!code) {
      setError("[J] join · type the room code · [ENTER] confirm");
      return;
    }
    const result = await runMutation(() =>
      cx.mutation(refs.joinRoom, { code, playerId }),
    );
    if (result?.code) setRoomAndSubscribe(result.code);
    setReadyLocal(false);
    setStarted(false);
  };

  const startJoinMode = () => {
    setError("");
    setEditingRoomCode(true);
  };

  const quickJoin = async () => {
    const cx = client();
    if (!cx) {
      setError("backend not configured");
      return;
    }
    const result = await runMutation(() =>
      cx.mutation(refs.quickJoin, {
        code: createRoomCode(),
        seed: createId(),
        playerId,
      }),
    );
    if (result?.code) setRoomAndSubscribe(result.code);
    setReadyLocal(false);
    setStarted(false);
  };

  const sendHeartbeat = () => {
    const cx = client();
    const code = roomCode();
    if (!cx || !code) return;
    void cx.mutation(refs.heartbeat, { code, playerId }).catch(() => {});
  };

  const toggleReady = async () => {
    const cx = client();
    const code = roomCode();
    if (!cx || !code) return;
    const next = !ready();
    setReadyLocal(next);
    await runMutation(() =>
      cx.mutation(refs.setReady, { code, playerId, ready: next }),
    );
  };

  const publishBoard = async (next = state()) => {
    const cx = client();
    const code = roomCode();
    if (!cx || !code || roomStatus() !== "active") return;
    const board = encodeBoard(syncBoard(next));
    const snapshotKey = [
      board,
      next.score,
      next.lines,
      next.level,
      next.stats.sent,
      next.stats.received,
      next.stats.incoming,
      next.gameOver ? "1" : "0",
    ].join("|");
    if (publishInFlight || snapshotKey === lastPublishedSnapshot) return;
    publishInFlight = true;
    const publishStartedAt = Date.now();
    await cx
      .mutation(refs.submitBoard, {
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
        setPublishLatencyMs(Date.now() - publishStartedAt);
        lastPublishedSnapshot = snapshotKey;
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => {
        publishInFlight = false;
      });
  };

  const flushAttacks = async (attacks: OutgoingAttack[]) => {
    const cx = client();
    const code = roomCode();
    if (!cx || !code || attacks.length === 0) return;
    for (const attack of attacks) {
      await cx
        .mutation(refs.sendAttack, {
          code,
          fromPlayerId: playerId,
          lines: attack.lines,
          cleared: attack.cleared,
          combo: attack.combo,
        })
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
    }
  };

  createEffect(() => {
    const snapshot = room();
    const remoteOpponent = opponent();
    if (remoteOpponent) {
      if (remoteOpponent.board !== lastOpponentBoard) {
        lastOpponentBoard = remoteOpponent.board;
        setOpponentBoardSeenAt(Date.now());
      }
      setState((current) => ({
        ...current,
        opponentBoard: decodeBoard(remoteOpponent.board),
      }));
    }
    if (snapshot?.room.status === "countdown") {
      const delay = Math.max(0, (snapshot.room.startedAt ?? 0) - Date.now());
      if (countdownStartTimer) clearTimeout(countdownStartTimer);
      countdownStartTimer = setTimeout(requestStartMatch, delay + 120);
    }
    const localMe = me();
    if (localMe && localMe.ready !== untrack(ready))
      setReadyLocal(localMe.ready);
    if (snapshot?.room.status === "active" && !started()) {
      setStarted(true);
      setPaused(false);
      lastPublishedSnapshot = "";
      lastOpponentBoard = "";
      setOpponentBoardSeenAt(null);
      consumedAttackIds.clear();
      const high = untrack(() => state().highScore);
      const best = untrack(() => state().bestAttack);
      setState(
        createInitialState(high, best, `${snapshot.room.seed}:${playerId}`),
      );
      schedule();
    }
    if (
      (snapshot?.room.status === "waiting" ||
        snapshot?.room.status === "countdown") &&
      started()
    )
      setStarted(false);
    if (snapshot?.room.status === "done") {
      clearTimer();
      setState((current) => ({
        ...current,
        won: snapshot.room.winnerPlayerId === playerId,
        gameOver: snapshot.room.winnerPlayerId !== playerId,
      }));
    }
    const fresh =
      snapshot?.pendingAttacks.filter(
        (attack) => !consumedAttackIds.has(attack._id),
      ) ?? [];
    const ids = fresh.map((attack) => attack._id);
    const total = fresh.reduce((sum, attack) => sum + attack.lines, 0);
    if (ids.length > 0 && total > 0) {
      for (const id of ids) consumedAttackIds.add(id);
      setState((current) => ({
        ...current,
        stats: { ...current.stats, incoming: current.stats.incoming + total },
      }));
      client()
        ?.mutation(refs.consumeAttacks, { attackIds: ids, playerId })
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
    }
  });

  const persist = (next: GameState) => {
    if (next.highScore > lastPersistedHighScore) {
      lastPersistedHighScore = next.highScore;
      props.api.kv.set(highScoreKey, next.highScore);
    }
    if (next.bestAttack > lastPersistedBestAttack) {
      lastPersistedBestAttack = next.bestAttack;
      props.api.kv.set(bestAttackKey, next.bestAttack);
    }
  };

  const replaceState = (next: GameState, persistNow = false) => {
    if (persistNow || ended(next)) persist(next);
    if (next.outgoingAttacks.length > 0) {
      const attacks = next.outgoingAttacks;
      next = { ...next, outgoingAttacks: [] };
      void flushAttacks(attacks);
    }
    setState(next);
    void publishBoard(next);
  };

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const clearCountdownStartTimer = () => {
    if (!countdownStartTimer) return;
    clearTimeout(countdownStartTimer);
    countdownStartTimer = undefined;
  };

  const clearNetworkTimers = () => {
    if (publishTimer) clearInterval(publishTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (clockTimer) clearInterval(clockTimer);
    publishTimer = undefined;
    heartbeatTimer = undefined;
    clockTimer = undefined;
  };

  const step = (soft = false) => {
    const result = tickState(state(), soft);
    replaceState(result.state, result.locked || ended(result.state));
  };

  const schedule = () => {
    clearTimer();
    if (paused() || ended(state()) || roomStatus() !== "active") return;
    timer = setTimeout(() => {
      step();
      schedule();
    }, getTickSpeed(state()));
  };

  const restart = () => {
    persist(state());
    const cx = client();
    const code = roomCode();
    if (cx && code) {
      setStarted(false);
      consumedAttackIds.clear();
      // Reset the local board immediately so `ended(state())` flips to false
      // before the rematch mutation round-trips. Without this the route memo
      // sticks on `over` until the next active snapshot lands.
      setState(
        createInitialState(lastPersistedHighScore, lastPersistedBestAttack),
      );
      setPaused(false);
      setOpponentBoardSeenAt(null);
      lastPublishedSnapshot = "";
      lastOpponentBoard = "";
      void runMutation(() =>
        cx.mutation(refs.rematch, { code, seed: createId(), playerId }),
      );
    }
  };

  const resetToLobby = () => {
    persist(state());
    clearTimer();
    clearCountdownStartTimer();
    unsubscribeRoom?.();
    unsubscribeRoom = undefined;
    consumedAttackIds.clear();
    lastPublishedSnapshot = "";
    lastOpponentBoard = "";
    setConfirmAction(null);
    setRoomCode("");
    setRoom(null);
    setReadyLocal(false);
    setStarted(false);
    setPaused(false);
    setEditingRoomCode(false);
    setPublishLatencyMs(null);
    setOpponentBoardSeenAt(null);
    setState(
      createInitialState(lastPersistedHighScore, lastPersistedBestAttack),
    );
  };

  const leaveToLobby = () => {
    const cx = client();
    const code = roomCode();
    if (cx && code)
      void cx
        .mutation(refs.leaveRoom, { code, playerId })
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
    resetToLobby();
  };

  onMount(() => {
    const code = roomCode();
    if (code) subscribeRoom(code);
    publishTimer = setInterval(() => void publishBoard(), 250);
    heartbeatTimer = setInterval(sendHeartbeat, heartbeatMs);
    clockTimer = setInterval(() => {
      setNow(Date.now());
      if (roomStatus() === "countdown" && countdown() === "GO")
        requestStartMatch();
    }, 100);
  });
  onCleanup(() => {
    persist(state());
    const code = roomCode();
    const cx = client();
    if (cx && code)
      void cx.mutation(refs.leaveRoom, { code, playerId }).catch(() => {});
    clearTimer();
    clearCountdownStartTimer();
    clearNetworkTimers();
    unsubscribeRoom?.();
    unsubscribeConn?.();
    void client()?.close();
  });

  const pause = () => {
    setPaused(true);
    clearTimer();
  };

  const resume = () => {
    setPaused(false);
    schedule();
  };

  const updateIfPlaying = (update: (current: GameState) => GameState) => {
    const current = state();
    if (paused() || ended(current) || roomStatus() !== "active") return;
    replaceState(update(current));
  };

  const close = () => {
    persist(state());
    props.onClose();
  };

  useKeyboard((evt) => {
    if (!props.api.ui.dialog.open) return;

    // Splash — [Q] quits, any other key dismisses to lobby. Q must win
    // here so the splash hint stays honest.
    if (route() === "splash") {
      prevent(evt);
      if (isKey(evt, "q", "Q")) {
        close();
        return;
      }
      setSplashSeen(true);
      return;
    }

    if (route() !== "match" && editingRoomCode()) {
      prevent(evt);
      if (isKey(evt, "escape", "esc")) {
        setEditingRoomCode(false);
        return;
      }
      if (isEnterKey(evt)) {
        void joinRoom();
        return;
      }
      if (isKey(evt, "backspace", "delete")) {
        setRoomCode((code) => code.slice(0, -1));
        return;
      }
      const key = evt.name;
      if (/^[0-9]$/.test(key) && roomCode().length < 4)
        setRoomCode((code) => normalizeRoomCode(code + key));
      return;
    }

    const pendingConfirm = confirmAction();
    if (pendingConfirm) {
      prevent(evt);
      if (isKey(evt, "escape", "esc")) {
        setConfirmAction(null);
        return;
      }
      if (pendingConfirm === "quit" && isKey(evt, "q", "Q")) {
        setConfirmAction(null);
        close();
        return;
      }
      if (pendingConfirm === "lobby" && isKey(evt, "l", "L")) {
        leaveToLobby();
        return;
      }
      setConfirmAction(null);
      return;
    }

    if (isKey(evt, "q", "Q")) {
      prevent(evt);
      setConfirmAction("quit");
      return;
    }

    if (route() !== "lobby" && route() !== "splash" && isKey(evt, "l", "L")) {
      prevent(evt);
      setConfirmAction("lobby");
      return;
    }

    if (route() === "lobby" || route() === "room") {
      prevent(evt);
      if (isKey(evt, "m", "M")) {
        void quickJoin();
        return;
      }
      if (isKey(evt, "n", "N")) {
        void createRoom();
        return;
      }
      if (isKey(evt, "j", "J")) {
        startJoinMode();
        return;
      }
      if (isEnterKey(evt)) {
        void joinRoom();
        return;
      }
      if (isKey(evt, "r", "R")) {
        void toggleReady();
        return;
      }
      if (isKey(evt, "backspace", "delete")) {
        setRoomCode((code) => code.slice(0, -1));
        return;
      }
      return;
    }

    if (route() === "over") {
      if (isKey(evt, "r", "R")) {
        prevent(evt);
        restart();
      }
      return;
    }

    if (isKey(evt, "p", "P")) {
      prevent(evt);
      if (paused()) resume();
      else pause();
      return;
    }

    // While paused, only [P]/[L]/[Q] do anything; other keys are no-ops so
    // a stray keystroke can't unfreeze the match. [L] and [Q] already drop
    // through to their handlers above (confirm flow), so here we just
    // swallow everything else.
    if (paused()) {
      prevent(evt);
      return;
    }

    if (isKey(evt, "left", "a", "A")) {
      prevent(evt);
      updateIfPlaying((current) => moveState(current, -1));
      return;
    }

    if (isKey(evt, "right", "d", "D")) {
      prevent(evt);
      updateIfPlaying((current) => moveState(current, 1));
      return;
    }

    if (isKey(evt, "up", "w", "W")) {
      prevent(evt);
      updateIfPlaying(rotateState);
      return;
    }

    if (isKey(evt, "down", "s", "S")) {
      prevent(evt);
      step(true);
      schedule();
      return;
    }

    if (isKey(evt, "space", " ")) {
      prevent(evt);
      if (!paused() && !ended(state()))
        replaceState(hardDropState(state()), true);
      schedule();
      return;
    }

    if (isKey(evt, "c", "C")) {
      prevent(evt);
      updateIfPlaying(holdState);
    }
  });

  // ─── Sub-renderers ────────────────────────────────────────────────────────

  // Lobby card — used three times across CREATE / JOIN / MATCH.
  const Card = (cp: {
    keyLabel: string;
    title: string;
    color: RGBA;
    body: () => JSX.Element;
  }) => (
    <Panel title={cp.title} titleColor={cp.color} flexGrow={1}>
      <text>
        <S fg={cp.color}>
          <b>[{cp.keyLabel}]</b>
        </S>
        <S fg={C.muted}> </S>
        <S fg={C.ink}>
          <b>{cp.title}</b>
        </S>
      </text>
      <text>
        <S fg={C.muted}> </S>
      </text>
      {cp.body()}
    </Panel>
  );

  // Player profile stat strip (lobby bottom).
  const ProfileStrip = () => (
    <Panel title="LARS_HAGEN  ·  PLAYER_PROFILE" titleColor={C.accent}>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <StatLine label="MATCHES" value={0} color={C.ink} inline />
        <text>
          <S fg={C.faint}>·</S>
        </text>
        <StatLine label="WINS" value={0} color={C.win} inline />
        <text>
          <S fg={C.faint}>·</S>
        </text>
        <StatLine label="LOSSES" value={0} color={C.loss} inline />
        <text>
          <S fg={C.faint}>·</S>
        </text>
        <StatLine
          label="HIGH_SCORE"
          value={state().highScore}
          color={C.gold}
          inline
        />
        <text>
          <S fg={C.faint}>·</S>
        </text>
        <StatLine
          label="BEST_ATTACK"
          value={state().bestAttack}
          color={C.accent}
          inline
        />
        <text>
          <S fg={C.faint}>·</S>
        </text>
        <StatLine
          label="PLAYER_ID"
          value={playerHandle(playerId, LOCAL_PLAYER_NAME)}
          color={C.cool}
          inline
        />
      </box>
    </Panel>
  );

  // The 4-digit JOIN code input row.
  const JoinSlots = () => {
    const slots = createMemo(() => {
      const code = roomCode().padEnd(4, " ");
      return [0, 1, 2, 3].map((i) => code[i]!.trim());
    });
    return (
      <box flexDirection="row" gap={1}>
        <For each={slots()}>
          {(d) => <DigitSlot value={d} color={C.info} />}
        </For>
        <Show when={editingRoomCode()}>
          <text>
            <S fg={C.info}>
              <b>▏</b>
            </S>
          </text>
        </Show>
      </box>
    );
  };

  // Active match — your board.
  const YourBoard = () => (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={C.panelLine}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={0}
      paddingRight={0}
    >
      <For each={board()}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(cell) => (
                <text fg={cellColor(cell, ghostPieceType())}>
                  {cell === null ? "· " : cellGlyph(cell) + cellGlyph(cell)}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );

  // Active match — opponent board (same scale, lighter chrome).
  const OpponentBoard = () => (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={C.panelLine}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={0}
      paddingRight={0}
    >
      <For each={state().opponentBoard}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(cell) => (
                <text fg={rivalColor(cell, theme())}>{rivalGlyph(cell)}</text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );

  // Vertical column between the two boards: incoming-garbage indicator.
  const WarningColumn = () => {
    const total = state().stats.incoming;
    const filled = Math.min(20, total);
    const cells = Array.from({ length: 20 }, (_, i) => i < filled);
    return (
      <box
        flexDirection="column"
        alignItems="center"
        paddingLeft={0}
        paddingRight={0}
      >
        <Show when={total > 0}>
          <text>
            <S fg={C.bad}>
              <b>↓</b>
            </S>
          </text>
        </Show>
        <Show when={total === 0}>
          <text>
            <S fg={C.faint}>┃</S>
          </text>
        </Show>
        <For each={cells}>
          {(active) => (
            <text>
              <S fg={active ? C.bad : C.faint}>{active ? "▰" : "┃"}</S>
            </text>
          )}
        </For>
      </box>
    );
  };

  // ─── Splash screen ────────────────────────────────────────────────────────
  const SplashScreen = () => (
    <box flexDirection="column" alignItems="center" paddingTop={1}>
      <StatusRibbon state="READY" stateColor={C.accent} right={<ConnDot />} />
      <box paddingTop={1} paddingBottom={1}>
        <PieceStrip />
      </box>
      <RainbowHero lines={FIGLET.TETRIS_BATTLE} />
      <text>
        <S fg={C.inkSoft}>
          <i>multiplayer · opencode tui</i>
        </S>
      </text>
      <box paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={3}>
          <For each={PIECE_ORDER}>{(p) => <PreviewBlock type={p} />}</For>
        </box>
      </box>
      <text>
        <S fg={C.accent}>
          <b>▶ </b>
        </S>
        <S fg={C.ink}>
          <b>[ANY]</b>
        </S>
        <S fg={C.muted}> enter lobby</S>
      </text>
      <box paddingTop={1}>
        <text>
          <S fg={C.muted}>HIGH_SCORE </S>
          <S fg={C.gold}>
            <b>{state().highScore}</b>
          </S>
          <S fg={C.faint}> · </S>
          <S fg={C.muted}>BEST_ATTACK </S>
          <S fg={C.win}>
            <b>{state().bestAttack}</b>
          </S>
          <S fg={C.faint}> · </S>
          <S fg={C.muted}>PLAYER </S>
          <S fg={C.cool}>{playerHandle(playerId, LOCAL_PLAYER_NAME)}</S>
        </text>
      </box>
      <box paddingTop={1} alignItems="center">
        <HintBar
          items={[
            { key: "ANY", verb: "enter" },
            { key: "Q", verb: "quit" },
          ]}
        />
      </box>
    </box>
  );

  // ─── Lobby screen ─────────────────────────────────────────────────────────
  const LobbyScreen = () => (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <StatusRibbon
        state="LOBBY"
        stateColor={C.accent}
        middle={
          <text>
            <S fg={C.muted}>signed in as </S>
            <S fg={C.ink}>
              <b>LARS_HAGEN</b>
            </S>
            <S fg={C.faint}> ({playerHandle(playerId, LOCAL_PLAYER_NAME)})</S>
          </text>
        }
        right={<ConnDot />}
      />
      <box paddingTop={1} paddingBottom={1} alignItems="center">
        <HeroBanner lines={FIGLET.LOBBY} stops={[C.accent, C.info, C.cool]} />
      </box>
      <box flexDirection="row" gap={1}>
        {/* CREATE */}
        <Card
          keyLabel="N"
          title="CREATE"
          color={C.win}
          body={() => (
            <box flexDirection="column">
              <text>
                <S fg={C.muted}>generate a fresh room code</S>
              </text>
              <text>
                <S fg={C.muted}>share it with your opponent</S>
              </text>
              <box paddingTop={1}>
                <box flexDirection="row" gap={1}>
                  <DigitSlot value={roomCode()[0] ?? ""} color={C.win} />
                  <DigitSlot value={roomCode()[1] ?? ""} color={C.win} />
                  <DigitSlot value={roomCode()[2] ?? ""} color={C.win} />
                  <DigitSlot value={roomCode()[3] ?? ""} color={C.win} />
                  <text>
                    <S fg={C.muted}> preview</S>
                  </text>
                </box>
              </box>
              <box paddingTop={1}>
                <StateDot color={C.ok} label="ready when you are" />
              </box>
            </box>
          )}
        />
        {/* JOIN */}
        <Card
          keyLabel="J"
          title="JOIN"
          color={C.info}
          body={() => (
            <box flexDirection="column">
              <text>
                <S fg={C.muted}>type the room code</S>
              </text>
              <text>
                <S fg={C.muted}>your opponent shared</S>
              </text>
              <box paddingTop={1}>
                <JoinSlots />
              </box>
              <box paddingTop={1}>
                <text>
                  <S fg={C.muted}>↵ </S>
                  <S fg={C.ink}>
                    <b>[ENTER]</b>
                  </S>
                  <S fg={C.muted}> join · </S>
                  <S fg={C.ink}>
                    <b>[ESC]</b>
                  </S>
                  <S fg={C.muted}> cancel</S>
                </text>
              </box>
            </box>
          )}
        />
        {/* QUICK MATCH */}
        <Card
          keyLabel="M"
          title="MATCH"
          color={C.warn}
          body={() => (
            <box flexDirection="column">
              <text>
                <S fg={C.muted}>quick match — find a worthy</S>
              </text>
              <text>
                <S fg={C.muted}>stranger to crush</S>
              </text>
              <box paddingTop={1}>
                <text>
                  <Show
                    when={busy()}
                    fallback={<S fg={C.muted}>idle · [M] queue</S>}
                  >
                    <S fg={C.warn}>
                      <b>◐</b>
                    </S>
                    <S fg={C.ink}> searching</S>
                    <S fg={C.muted}>...</S>
                  </Show>
                </text>
              </box>
              <box paddingTop={1}>
                <text>
                  {/* Quick-match has no real cancel path against the current
                      backend, so we surface neutral status instead of a
                      false promise. */}
                  <S fg={C.muted}>auto-pairs you with the next ready foe</S>
                </text>
              </box>
            </box>
          )}
        />
      </box>
      <box paddingTop={1}>
        <ProfileStrip />
      </box>
      <Show when={ready()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.ok}>
              <b>● </b>
            </S>
            <S fg={C.ink}>
              <b>READY</b>
            </S>
            <S fg={C.muted}> · </S>
            <S fg={C.ink}>
              <b>[R]</b>
            </S>
            <S fg={C.muted}> unready</S>
          </text>
        </box>
      </Show>
      <Show when={confirmMessage()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.warn}>
              <b>{confirmMessage()}</b>
            </S>
          </text>
        </box>
      </Show>
      <Show when={!convexUrl()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.bad}>backend unavailable · check plugin config</S>
          </text>
        </box>
      </Show>
      <Show when={error()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.bad}>{canonicalizeError(error())}</S>
          </text>
        </box>
      </Show>
      <box paddingTop={1} alignItems="center">
        <HintBar
          items={[
            { key: "N", verb: "new" },
            { key: "J", verb: "join" },
            { key: "M", verb: "match" },
            { key: "R", verb: "ready" },
            { key: "Q", verb: "quit" },
          ]}
        />
      </box>
    </box>
  );

  // ─── Room (waiting / countdown) ──────────────────────────────────────────
  const RoomScreen = () => (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <StatusRibbon
        state={roomStatus() === "countdown" ? "COUNTDOWN" : "READY"}
        stateColor={roomStatus() === "countdown" ? C.warn : C.accent}
        middle={
          <text>
            <S fg={C.muted}>ROOM </S>
            <S fg={PIECE.I}>
              <b>{roomCode()}</b>
            </S>
            <Show when={roomStatus() === "countdown"}>
              <S fg={C.faint}> · </S>
              <S fg={C.warn}>
                <b>starting in {countdown()}</b>
              </S>
            </Show>
            <Show when={roomStatus() !== "countdown"}>
              <S fg={C.faint}> · </S>
              <S fg={C.muted}>● waiting for opponent</S>
            </Show>
          </text>
        }
        right={<ConnDot />}
      />
      <box paddingTop={2} alignItems="center">
        <text>
          <S fg={C.muted}>ROOM_CODE</S>
        </text>
      </box>
      <box paddingTop={1} alignItems="center">
        <box flexDirection="row" gap={1}>
          <DigitSlot value={roomCode()[0] ?? ""} color={C.accent} />
          <DigitSlot value={roomCode()[1] ?? ""} color={C.accent} />
          <DigitSlot value={roomCode()[2] ?? ""} color={C.accent} />
          <DigitSlot value={roomCode()[3] ?? ""} color={C.accent} />
        </box>
      </box>
      <box paddingTop={2}>
        <box flexDirection="row" gap={2}>
          {/* You slot */}
          <Panel title="YOU" titleColor={C.cool} flexGrow={1}>
            <text>
              <S fg={me()?.ready ? C.ok : C.faint}>
                <b>{me()?.ready ? "● READY" : "○ NOT READY"}</b>
              </S>
            </text>
            <text>
              <S fg={C.muted}>{playerHandle(playerId, LOCAL_PLAYER_NAME)}</S>
            </text>
            <text>
              <S fg={C.faint}>side </S>
              <S fg={C.inkSoft}>{me()?.side ?? "host"}</S>
            </text>
            <box paddingTop={1}>
              <text>
                <S fg={C.ink}>
                  <b>[R]</b>
                </S>
                <S fg={C.muted}> {ready() ? "unready" : "ready up"}</S>
              </text>
            </box>
          </Panel>
          {/* Opponent slot */}
          <Panel title="OPPONENT" titleColor={C.loss} flexGrow={1}>
            <Show
              when={opponent()}
              fallback={
                <box flexDirection="column">
                  <text>
                    <S fg={C.faint}>
                      <b>○ EMPTY</b>
                    </S>
                  </text>
                  <text>
                    <S fg={C.muted}>share the room code</S>
                  </text>
                  <text>
                    <S fg={C.muted}>and wait for a challenger</S>
                  </text>
                </box>
              }
            >
              <text>
                <S fg={opponent()?.ready ? C.ok : C.faint}>
                  <b>{opponent()?.ready ? "● READY" : "○ NOT READY"}</b>
                </S>
              </text>
              <text>
                <S fg={C.muted}>{playerHandle(opponent()?.playerId)}</S>
              </text>
              <text>
                <S fg={C.faint}>side </S>
                <S fg={C.inkSoft}>{opponent()?.side ?? ""}</S>
              </text>
            </Show>
          </Panel>
        </box>
      </box>
      <Show when={confirmMessage()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.warn}>
              <b>{confirmMessage()}</b>
            </S>
          </text>
        </box>
      </Show>
      <Show when={error()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.bad}>{canonicalizeError(error())}</S>
          </text>
        </box>
      </Show>
      <box paddingTop={1} alignItems="center">
        <HintBar
          items={[
            { key: "R", verb: "ready" },
            { key: "L", verb: "lobby" },
            { key: "Q", verb: "quit" },
          ]}
        />
      </box>
    </box>
  );

  // ─── Active match (the hero shot) ────────────────────────────────────────
  const MatchScreen = () => (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <StatusRibbon
        state="LIVE_MATCH"
        stateColor={C.accent}
        middle={
          <text>
            <S fg={C.muted}>ROOM </S>
            <S fg={PIECE.I}>
              <b>{roomCode()}</b>
            </S>
            <S fg={C.faint}> </S>
            <S fg={C.muted}>TIME </S>
            <S fg={C.ink}>
              <b>{matchTimeText()}</b>
            </S>
            <S fg={C.faint}> </S>
            <S fg={C.muted}>LEVEL </S>
            <S fg={C.ink}>
              <b>{state().level}</b>
            </S>
          </text>
        }
        right={
          <text>
            <S fg={opponentDisconnected() ? C.bad : C.ok}>
              <b>● </b>
            </S>
            <S fg={C.muted}>
              {opponentDisconnected() ? "opponent lost" : "opponent online"}
            </S>
          </text>
        }
      />
      <box paddingTop={1} paddingBottom={0}>
        <PieceStrip compact />
      </box>
      <box flexDirection="row" gap={2} paddingTop={1} alignItems="flex-start">
        {/* Left rail: HOLD + STATS */}
        <box flexDirection="column" gap={1} minWidth={18}>
          <Panel title="HOLD" titleColor={PIECE.O}>
            <PiecePreview type={state().hold} />
          </Panel>
          <Panel title="STATS" titleColor={C.cool}>
            <text>
              <S fg={C.muted}>SCORE</S>
            </text>
            <text>
              <S fg={C.gold}>
                <b>{state().score}</b>
              </S>
            </text>
            <text>
              <S fg={C.muted}> </S>
            </text>
            <StatLine
              label="LINES"
              value={state().lines}
              color={C.ink}
              inline
            />
            <StatLine
              label="APM"
              value={state().stats.pieces}
              color={C.cool}
              inline
            />
            <StatLine
              label="PIECES"
              value={state().stats.pieces}
              color={C.ink}
              inline
            />
            <text>
              <S fg={C.muted}> </S>
            </text>
            <StatLine
              label="COMBO"
              value={`× ${state().stats.combo}`}
              color={C.accent}
              inline
            />
            <StatLine
              label="MAX"
              value={state().stats.maxCombo}
              color={C.win}
              inline
            />
            {/* Outgoing-attack indicator — `↗` is the canon glyph for sent
                attacks (never `▶`, which is reserved for CTAs). Always shown
                so the vocabulary lives on screen even at 0 sent. */}
            <text>
              <S fg={C.accent}>
                <b>↗ </b>
              </S>
              <S fg={C.muted}>SENT </S>
              <S fg={C.win}>
                <b>+{state().stats.sent}</b>
              </S>
            </text>
          </Panel>
        </box>

        {/* You board column */}
        <box flexDirection="column">
          <text>
            <S fg={C.cool}>
              <b>YOU</b>
            </S>
            <S fg={C.muted}> {playerHandle(playerId, LOCAL_PLAYER_NAME)}</S>
          </text>
          <YourBoard />
        </box>

        {/* Warning column between boards */}
        <box flexDirection="column" paddingTop={1}>
          <WarningColumn />
        </box>

        {/* Opponent column */}
        <box flexDirection="column">
          <text>
            <S fg={C.loss}>
              <b>OPP</b>
            </S>
            <S fg={C.muted}> {playerHandle(opponent()?.playerId)}</S>
          </text>
          <OpponentBoard />
        </box>

        {/* Right rail: NEXT */}
        <box flexDirection="column" minWidth={14}>
          <Panel title="NEXT" titleColor={PIECE.I}>
            <PiecePreview type={state().next} />
          </Panel>
          <box paddingTop={1}>
            <Panel title="GARBAGE" titleColor={C.bad}>
              <box flexDirection="row">
                <For each={incomingBars()}>
                  {(active) => (
                    <text>
                      <S fg={active ? C.bad : C.faint}>{active ? "▮" : "▱"}</S>
                    </text>
                  )}
                </For>
              </box>
              <text>
                <S fg={C.muted}>incoming </S>
                <S fg={C.bad}>
                  <b>{state().stats.incoming}</b>
                </S>
              </text>
            </Panel>
          </box>
        </box>
      </box>

      <Show when={confirmMessage()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.warn}>
              <b>{confirmMessage()}</b>
            </S>
          </text>
        </box>
      </Show>

      <box paddingTop={1} alignItems="center">
        <HintBar
          items={[
            { key: "←→", verb: "move" },
            { key: "↑", verb: "rotate" },
            { key: "↓", verb: "soft" },
            { key: "SPACE", verb: "hard drop" },
            { key: "C", verb: "hold" },
            { key: "P", verb: "pause" },
            { key: "L", verb: "lobby" },
            { key: "Q", verb: "quit" },
          ]}
        />
      </box>
    </box>
  );

  // ─── Pause overlay ───────────────────────────────────────────────────────
  const PauseOverlay = () => (
    <box
      flexDirection="column"
      paddingTop={1}
      paddingBottom={1}
      alignItems="center"
    >
      <StatusRibbon
        state="PAUSED"
        stateColor={C.warn}
        middle={
          <text>
            <S fg={C.muted}>ROOM </S>
            <S fg={C.faint}>{roomCode()}</S>
            <S fg={C.faint}> TIME </S>
            <S fg={C.faint}>{matchTimeText()} (frozen)</S>
          </text>
        }
        right={<StateDot color={C.warn} label="paused" />}
      />
      {/* Dimmed underlay hint — board side strips. */}
      <box
        paddingTop={1}
        paddingBottom={1}
        flexDirection="row"
        gap={4}
        alignItems="center"
      >
        <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
          {() => (
            <text>
              <S fg={C.dim}>┃</S>
            </text>
          )}
        </For>
      </box>
      {/* Modal — rounded pink box with drop shadow on right edge. */}
      <box flexDirection="row" alignItems="flex-start">
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={C.accent}
          paddingLeft={3}
          paddingRight={3}
          paddingTop={1}
          paddingBottom={1}
          alignItems="center"
          minWidth={70}
        >
          <box paddingTop={0} paddingBottom={1}>
            <HeroBanner
              lines={FIGLET.PAUSED}
              stops={[C.gold, C.warn, C.accent]}
            />
          </box>
          <text>
            <S fg={C.muted}>
              <i>match suspended · heartbeat held</i>
            </S>
          </text>
          <box flexDirection="row" gap={3} paddingTop={1} paddingBottom={1}>
            <PreviewBlock type="T" />
            <PreviewBlock type="T" />
            <PreviewBlock type="T" />
          </box>
          <box flexDirection="row" gap={1}>
            <FramedButton keyLabel="P" label="RESUME" color={C.win} />
            <FramedButton keyLabel="L" label="LOBBY" color={C.info} />
            <FramedButton keyLabel="Q" label="QUIT" color={C.loss} />
          </box>
          <box paddingTop={1}>
            <text>
              <S fg={C.muted}>opponent sees: </S>
              <S fg={C.warn}>
                <b>OPPONENT_PAUSED</b>
              </S>
            </text>
          </box>
        </box>
        {/* Drop shadow column on right edge of modal. */}
        <box flexDirection="column" paddingTop={1}>
          <For each={Array.from({ length: 16 })}>
            {() => (
              <text>
                <S fg={C.shadow}>▒</S>
              </text>
            )}
          </For>
        </box>
      </box>
      <Show when={confirmMessage()}>
        <box paddingTop={1}>
          <text>
            <S fg={C.warn}>
              <b>{confirmMessage()}</b>
            </S>
          </text>
        </box>
      </Show>
      <box paddingTop={1} alignItems="center">
        <HintBar
          items={[
            { key: "P", verb: "resume" },
            { key: "L", verb: "lobby" },
            { key: "Q", verb: "quit" },
          ]}
        />
      </box>
    </box>
  );

  // ─── Match-over (Victory / Defeat) ───────────────────────────────────────
  const OverScreen = () => {
    const isWin = createMemo(() => state().won || winner() === playerId);
    const heroLines = () => (isWin() ? FIGLET.VICTORY : FIGLET.DEFEAT);
    const heroStops = () =>
      isWin()
        ? [C.gold, C.warn, C.accent, C.info, C.cool, C.win]
        : [C.loss, C.bad, C.warn, C.muted];
    return (
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <StatusRibbon
          state="MATCH_OVER"
          stateColor={isWin() ? C.win : C.loss}
          middle={
            <text>
              <S fg={C.muted}>ROOM </S>
              <S fg={PIECE.I}>
                <b>{roomCode() || "—"}</b>
              </S>
              <S fg={C.faint}> </S>
              <S fg={C.muted}>WINNER </S>
              <S fg={isWin() ? C.win : C.loss}>
                <b>{isWin() ? "YOU" : "OPPONENT"}</b>
              </S>
            </text>
          }
          right={<StateDot color={C.ok} label="submitted" />}
        />
        <box paddingTop={1} paddingBottom={1} alignItems="center">
          <HeroBanner lines={heroLines()} stops={heroStops()} />
        </box>
        <box alignItems="center">
          <text>
            <S fg={C.muted}>
              <i>
                {isWin()
                  ? `score ${state().score} · ${state().lines} lines · ${state().stats.sent} sent`
                  : "you topped out — review the stack and run it back"}
              </i>
            </S>
          </text>
        </box>
        <box paddingTop={1} flexDirection="row" gap={2}>
          <Panel title="LINES_SENT" titleColor={C.win} flexGrow={1}>
            <text>
              <S fg={C.win}>
                <b>{state().stats.sent}</b>
              </S>
            </text>
          </Panel>
          <Panel title="LINES_CLEARED" titleColor={C.cool} flexGrow={1}>
            <text>
              <S fg={C.cool}>
                <b>{state().lines}</b>
              </S>
            </text>
          </Panel>
          <Panel title="COMBO_MAX" titleColor={C.accent} flexGrow={1}>
            <text>
              <S fg={C.accent}>
                <b>× {state().stats.maxCombo}</b>
              </S>
            </text>
          </Panel>
        </box>
        <box paddingTop={1} flexDirection="row" gap={2}>
          <Panel title="SCORE" titleColor={C.gold} flexGrow={1}>
            <text>
              <S fg={C.gold}>
                <b>{state().score}</b>
              </S>
            </text>
          </Panel>
          <Panel title="PIECES" titleColor={PIECE.I} flexGrow={1}>
            <text>
              <S fg={PIECE.I}>
                <b>{state().stats.pieces}</b>
              </S>
            </text>
          </Panel>
          <Panel title="LEVEL" titleColor={PIECE.L} flexGrow={1}>
            <text>
              <S fg={PIECE.L}>
                <b>{state().level}</b>
              </S>
            </text>
          </Panel>
        </box>
        <box paddingTop={1}>
          <Panel title="FINAL_STATE" titleColor={C.panelLine}>
            <box flexDirection="row" gap={4}>
              <box flexDirection="column">
                <text>
                  <S fg={isWin() ? C.win : C.loss}>
                    <b>{isWin() ? "WINNER" : "DEFEATED"}</b>
                  </S>
                  <S fg={C.muted}>
                    {" "}
                    {playerHandle(playerId, LOCAL_PLAYER_NAME)} (you)
                  </S>
                </text>
                <YourBoard />
              </box>
              <box flexDirection="column">
                <text>
                  <S fg={isWin() ? C.loss : C.win}>
                    <b>{isWin() ? "DEFEATED" : "WINNER"}</b>
                  </S>
                  <S fg={C.muted}> {playerHandle(opponent()?.playerId)}</S>
                </text>
                <OpponentBoard />
              </box>
            </box>
          </Panel>
        </box>
        <box paddingTop={1} alignItems="center">
          <box flexDirection="row" gap={2}>
            <FramedButton keyLabel="R" label="REMATCH" color={C.win} />
            <FramedButton keyLabel="L" label="LOBBY" color={C.info} />
            <FramedButton keyLabel="Q" label="QUIT" color={C.loss} />
          </box>
        </box>
        <Show when={confirmMessage()}>
          <box paddingTop={1}>
            <text>
              <S fg={C.warn}>
                <b>{confirmMessage()}</b>
              </S>
            </text>
          </box>
        </Show>
        <box paddingTop={1} alignItems="center">
          <HintBar
            items={[
              { key: "R", verb: "rematch" },
              { key: "L", verb: "lobby" },
              { key: "Q", verb: "quit" },
            ]}
          />
        </box>
        <box alignItems="center">
          <text>
            <S fg={C.muted}>
              rematch keeps the room · lobby disconnects · press [R] to run it
              back
            </S>
          </text>
        </box>
      </box>
    );
  };

  return (
    <WindowChrome
      route={`/tetris-battle  ›  ${route()}${roomCode() ? `  ·  room ${roomCode()}` : ""}`}
      version="v1.0.8"
      latencyMs={latencyBadge().text}
      latencyColor={latencyBadge().color}
    >
      <Show when={route() === "splash"}>
        <SplashScreen />
      </Show>
      <Show when={route() === "lobby"}>
        <LobbyScreen />
      </Show>
      <Show when={route() === "room"}>
        <RoomScreen />
      </Show>
      <Show when={route() === "match"}>
        <MatchScreen />
      </Show>
      <Show when={route() === "paused"}>
        <PauseOverlay />
      </Show>
      <Show when={route() === "over"}>
        <OverScreen />
      </Show>
    </WindowChrome>
  );
};
