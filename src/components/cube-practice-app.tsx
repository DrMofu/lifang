"use client";

import { Fragment, type CSSProperties, type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlgorithmStepToken, type AlgorithmStepStatus } from "@/components/algorithm-step-token";
import { AppFooter, AppTopbar } from "@/components/app-shell";
import {
  useCubeConnection,
  type CubeFaceletsSignal,
  type CubeMoveSignal,
  type CubeVisualState,
} from "@/components/cube-connection-provider";
import { CubeColorLegend } from "@/components/cube-color-legend";
import { MoveToken } from "@/components/move-token";
import { mapMoveToOrientation } from "@/lib/cube-appearance";
import {
  appendFixedViewMoveLogMove,
  appendNormalizedMoveLogMove,
  createMoveCoordinateState,
  expandMoveNotation,
  hintMoveForDoubleTurnProgress,
  invertMoveNotation,
  movePartiallyMatchesExpectedDoubleTurn,
  moveCanStillMatchExpected,
  movesMatchExpected,
  parseMoveNotation,
} from "@/lib/algorithms";
import { detectCfopMilestones, detectF2lSolvedSlotCount, isSolvedFacelets } from "@/lib/cube-state";
import { solveFacelets } from "@/lib/cubing-solver";
import { fmtShort, fmtTime } from "@/lib/format";
import {
  DEFAULT_AVERAGE_TIME_SETTINGS,
  calculateAverageTime,
  describeAverageTimeSettings,
  loadAverageTimeSettings,
  type AverageTimeSettings,
} from "@/lib/average-time";
import { useCubeAppearance } from "@/components/cube-appearance-provider";
import { CUBE_CAMERA_PRESETS } from "@/lib/cube-camera-presets";
import {
  type CubeDisplayState,
  type CubeFace,
  type CubeQuaternion,
  type SmartCubeApi,
  mountSmartCube,
} from "@/lib/smart-cube";
import {
  getDailyTestDateKey,
  getArchiveScopedStorageKey,
  MISSING_HISTORY_VALUE,
  calculateDailyLevelAverage,
  loadDailyLevels,
  loadSolveHistory,
  prependSolveHistoryEntry,
  saveDailyLevels,
  saveSolveHistory,
  subscribeStatisticsArchiveChange,
  type DailyLevelEntry,
  type DailyLevelSolve,
  type CfopPhaseMetrics,
  type F2lSubphaseMetrics,
  type HistoryMetricValue,
  type SolveHistoryEntry,
} from "@/lib/solve-history";
import { isCubeSerialAfter, normalizeCubeSerial } from "@/lib/cube-serial";
import {
  DEFAULT_PRACTICE_INSPECTION_SETTINGS,
  getPracticeInspectionDurationMs,
  loadPracticeInspectionSettings,
  type PracticeInspectionSettings,
} from "@/lib/practice-inspection";
import { touchLocalUserDataPackageUpdatedAt } from "@/lib/user-data-package";

const SCRAMBLE_MOVES: CubeFace[] = ["U", "D", "L", "R", "F"];
const SCRAMBLE_AXES: Record<CubeFace, "ud" | "lr" | "fb"> = {
  U: "ud",
  D: "ud",
  L: "lr",
  R: "lr",
  F: "fb",
  B: "fb",
};
const FREE_SCRAMBLE_IDLE_MS = 6000;
const FREE_SCRAMBLE_FILL_DELAY_MS = 1000;
const FREE_SCRAMBLE_FILL_MS = FREE_SCRAMBLE_IDLE_MS - FREE_SCRAMBLE_FILL_DELAY_MS;
const SCRAMBLE_LENGTH = 20;
const AUTO_NEXT_SCRAMBLE_DELAY_MS = 350;
const DAILY_TEST_TARGET = 5;
const SOLVED_TRAILING_MOVE_SUPPRESS_MS = 900;
const DISPLAY_STATE_EPSILON = 0.001;
const CUBE_MOVE_ANIMATION_MS = 150;
const MOVE_LOG_PILL_SIZE = 30;
const MOVE_LOG_ROW_GAP = 5;
const MOVE_LOG_MIN_COLUMN_GAP = 3;
const MOVE_LOG_FALLBACK_ROWS = 1;
const HISTORY_ROW_SIZE = 32;
const HISTORY_ROW_GAP = 7;
const HISTORY_FALLBACK_ROWS = 1;
const DEFAULT_MOVE_LOG_CAPACITY = 12;
const MAX_UNDO_HINT_QUEUE_LENGTH = 20;
const HISTORY_CFOP_TIP_WIDTH = 286;
const HISTORY_CFOP_TIP_HEIGHT = 260;
const HISTORY_CFOP_TIP_GAP = 12;
const HISTORY_CFOP_TIP_MARGIN = 14;
const INSPECTION_AUDIO_CUE_SECONDS = [5, 4, 3, 2, 1] as const;
const INSPECTION_END_CUE_PRESERVE_MS = 320;
const SMART_SOLVE_FACELETS_TIMEOUT_MS = 1300;
const PRACTICE_GYRO_DISABLED_KEY = "cube-practice-gyro-disabled";
const PRACTICE_DISPLAY_STATE_KEY = "cube-practice-display-state";
const PRACTICE_CUBE_CAMERA_PRESET = CUBE_CAMERA_PRESETS.practice;

function loadPracticeGyroDisabled() {
  if (typeof window === "undefined") return false;
  try {
    return JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(PRACTICE_GYRO_DISABLED_KEY)) || "false") === true;
  } catch {
    return false;
  }
}

function savePracticeGyroDisabled(disabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getArchiveScopedStorageKey(PRACTICE_GYRO_DISABLED_KEY), JSON.stringify(disabled));
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

function isDefaultDisplayState(state: CubeDisplayState) {
  const defaultState = PRACTICE_CUBE_CAMERA_PRESET.displayState;
  return (
    Math.abs(state.cameraDistance - defaultState.cameraDistance) <= DISPLAY_STATE_EPSILON &&
    Math.abs(state.cameraLatitude - defaultState.cameraLatitude) <= DISPLAY_STATE_EPSILON &&
    Math.abs(state.cameraLongitude - defaultState.cameraLongitude) <= DISPLAY_STATE_EPSILON
  );
}

function isStoredDisplayState(value: unknown): value is CubeDisplayState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Record<keyof CubeDisplayState, unknown>>;
  return (
    typeof candidate.cameraDistance === "number" &&
    Number.isFinite(candidate.cameraDistance) &&
    typeof candidate.cameraLatitude === "number" &&
    Number.isFinite(candidate.cameraLatitude) &&
    typeof candidate.cameraLongitude === "number" &&
    Number.isFinite(candidate.cameraLongitude)
  );
}

function loadPracticeDisplayState() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(PRACTICE_DISPLAY_STATE_KEY)) || "null");
    return isStoredDisplayState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function savePracticeDisplayState(state: CubeDisplayState | null) {
  if (typeof window === "undefined") return;
  try {
    const key = getArchiveScopedStorageKey(PRACTICE_DISPLAY_STATE_KEY);
    if (!state || isDefaultDisplayState(state)) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

type Phase = "idle" | "scrambling" | "inspect" | "solving" | "done";
type PracticeMode = "scramble" | "free";
type FreePracticeState = "waitingSolved" | "ready" | "scrambling" | "armed";
type ScrambleStepStatus = "pending" | "partial" | "correct";
type SmartSolveStatus = "idle" | "loading" | "active" | "done" | "error";
type SmartSolveStepStatus = "pending" | "partial" | "correct";
type CfopPhaseKey = "cross" | "f2l" | "oll" | "pll";
type F2lSubphaseKey = "one" | "two" | "three" | "four";
type LiveCfopMetrics = Record<CfopPhaseKey, number | null>;
type LiveF2lSubphaseMetrics = Record<F2lSubphaseKey, number | null>;
type InspectionAudioVoice = {
  gain: GainNode;
  oscillators: OscillatorNode[];
};

type MoveLogEntry = {
  m: string;
  t: number;
};

type HistoryCfopTip = {
  entry: SolveHistoryEntry;
  historyNumber: number;
  left: number;
  top: number;
  arrowLeft: number;
  placement: "above" | "below";
};
type PendingHistoryDelete = {
  historyIndex: number;
  entryTs: number;
  historyNumber: number;
  ms: number;
  left: number;
  top: number;
  arrowLeft: number;
};

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

type DailyTestRun = {
  id: string;
  localDate: string;
  solves: DailyLevelSolve[];
};

const EMPTY_CFOP: LiveCfopMetrics = {
  cross: null,
  f2l: null,
  oll: null,
  pll: null,
};

const EMPTY_F2L_SUBPHASES: LiveF2lSubphaseMetrics = {
  one: null,
  two: null,
  three: null,
  four: null,
};

const CFOP_PHASES: Array<{ key: CfopPhaseKey; name: string }> = [
  { key: "cross", name: "Cross" },
  { key: "f2l", name: "F2L" },
  { key: "oll", name: "OLL" },
  { key: "pll", name: "PLL" },
];

const F2L_SUBPHASES: Array<{ key: F2lSubphaseKey; name: string }> = [
  { key: "one", name: "F2L 1/4" },
  { key: "two", name: "F2L 2/4" },
  { key: "three", name: "F2L 3/4" },
  { key: "four", name: "F2L 4/4" },
];

function toHistoryMetric(value: number | null): HistoryMetricValue {
  return typeof value === "number" && Number.isFinite(value) ? value : MISSING_HISTORY_VALUE;
}

function toHistoryCfopMetrics(metrics: LiveCfopMetrics): CfopPhaseMetrics {
  return {
    cross: toHistoryMetric(metrics.cross),
    f2l: toHistoryMetric(metrics.f2l),
    oll: toHistoryMetric(metrics.oll),
    pll: toHistoryMetric(metrics.pll),
  };
}

function toHistoryF2lSubphaseMetrics(metrics: LiveF2lSubphaseMetrics): F2lSubphaseMetrics {
  return {
    one: toHistoryMetric(metrics.one),
    two: toHistoryMetric(metrics.two),
    three: toHistoryMetric(metrics.three),
    four: toHistoryMetric(metrics.four),
  };
}

function fmtSolveDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getYesterdayDailyTestDateKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return getDailyTestDateKey(date);
}

function formatPhaseTimeDelta(metrics: CfopPhaseMetrics | undefined, key: CfopPhaseKey) {
  if (!metrics) return MISSING_HISTORY_VALUE;
  const current = metrics[key];
  if (typeof current !== "number") return MISSING_HISTORY_VALUE;
  if (key === "cross") return fmtShort(current);
  const previousKey = key === "f2l" ? "cross" : key === "oll" ? "f2l" : "oll";
  const previous = metrics[previousKey];
  if (typeof previous !== "number" || current < previous) return MISSING_HISTORY_VALUE;
  return fmtShort(current - previous);
}

function formatPhaseMoveDelta(metrics: CfopPhaseMetrics | undefined, key: CfopPhaseKey) {
  if (!metrics) return MISSING_HISTORY_VALUE;
  const current = metrics[key];
  if (typeof current !== "number") return MISSING_HISTORY_VALUE;
  if (key === "cross") return `${current}步`;
  const previousKey = key === "f2l" ? "cross" : key === "oll" ? "f2l" : "oll";
  const previous = metrics[previousKey];
  if (typeof previous !== "number" || current < previous) return MISSING_HISTORY_VALUE;
  return `${current - previous}步`;
}

function getF2lSubphasePrevious(
  cfopMetrics: CfopPhaseMetrics | undefined,
  f2lMetrics: F2lSubphaseMetrics | undefined,
  key: F2lSubphaseKey,
) {
  if (key === "one") return cfopMetrics?.cross;
  const previousKey = key === "two" ? "one" : key === "three" ? "two" : "three";
  return f2lMetrics?.[previousKey];
}

function formatF2lSubphaseTimeDelta(
  cfopMetrics: CfopPhaseMetrics | undefined,
  f2lMetrics: F2lSubphaseMetrics | undefined,
  key: F2lSubphaseKey,
) {
  const current = f2lMetrics?.[key];
  const previous = getF2lSubphasePrevious(cfopMetrics, f2lMetrics, key);
  if (typeof current !== "number" || typeof previous !== "number" || current < previous) return MISSING_HISTORY_VALUE;
  return fmtShort(current - previous);
}

function formatF2lSubphaseMoveDelta(
  cfopMoves: CfopPhaseMetrics | undefined,
  f2lMoves: F2lSubphaseMetrics | undefined,
  key: F2lSubphaseKey,
) {
  const current = f2lMoves?.[key];
  const previous = getF2lSubphasePrevious(cfopMoves, f2lMoves, key);
  if (typeof current !== "number" || typeof previous !== "number" || current < previous) return MISSING_HISTORY_VALUE;
  return `${current - previous}步`;
}

const INITIAL_SCRAMBLE = [
  "R",
  "U'",
  "F",
  "L'",
  "D",
  "R'",
  "U",
  "F",
  "U",
  "L",
  "F'",
  "D'",
  "F'",
  "R",
  "U'",
  "D",
  "L'",
  "D",
  "R'",
  "F",
];

function randomMove(prev: string | null) {
  let face: CubeFace;
  do {
    face = SCRAMBLE_MOVES[Math.floor(Math.random() * SCRAMBLE_MOVES.length)];
  } while (prev && SCRAMBLE_AXES[prev[0] as CubeFace] === SCRAMBLE_AXES[face]);
  const dir = ["", "'", "2"][Math.floor(Math.random() * 3)];
  return face + dir;
}

function generateScramble(len = SCRAMBLE_LENGTH) {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < len; i++) {
    const move = randomMove(prev);
    out.push(move);
    prev = move;
  }
  return out;
}

function normalizeMove(move: string) {
  return parseMoveNotation(move)?.notation ?? move;
}

function invertMove(move: string) {
  return invertMoveNotation(move);
}

function moveAmount(move: string) {
  const parsed = parseMoveNotation(move);
  if (!parsed) return null;
  const amount: 1 | 2 | 3 = parsed.turns === 2 ? 2 : parsed.dir === -1 ? 3 : 1;
  return {
    layer: parsed.layer,
    amount,
  };
}

function formatUndoMove(layer: string, amount: 1 | 2 | 3) {
  if (amount === 2) return `${layer}2`;
  if (amount === 3) return `${layer}'`;
  return layer;
}

function compressUndoMoveSequence(moves: string[]) {
  return moves.reduce<string[]>((history, move) => {
    const nextMove = moveAmount(move);
    if (!nextMove) return history;
    const next = [...history];
    const lastMove = moveAmount(next[next.length - 1]);
    if (lastMove && lastMove.layer === nextMove.layer) {
      next.pop();
      const combined = (lastMove.amount + nextMove.amount) % 4;
      if (combined !== 0) next.push(formatUndoMove(nextMove.layer, combined as 1 | 2 | 3));
      return next;
    }
    next.push(formatUndoMove(nextMove.layer, nextMove.amount));
    return next;
  }, []);
}

function buildUndoStack(moves: string[]) {
  return compressUndoMoveSequence(moves.map(invertMove));
}

function appendUndoStackMoves(undoStack: string[], moves: string[]) {
  return compressUndoMoveSequence([...undoStack, ...moves.map(invertMove)]);
}

function getRemainingUndoStack(undoStack: string[], pendingMoves: string[]) {
  const expectedUndo = undoStack[undoStack.length - 1];
  if (!expectedUndo || pendingMoves.length === 0) return undoStack;
  const remainingTop = compressUndoMoveSequence([...pendingMoves.toReversed().map(invertMove), expectedUndo]);
  return compressUndoMoveSequence([...undoStack.slice(0, -1), ...remainingTop]);
}

function splitInvalidPendingMoves(pendingMoves: string[], expectedMove: string) {
  for (let split = pendingMoves.length - 1; split >= 0; split -= 1) {
    const retainedMoves = pendingMoves.slice(0, split);
    if (retainedMoves.length === 0 || moveCanStillMatchExpected(retainedMoves, expectedMove)) {
      return {
        retainedMoves,
        wrongMoves: pendingMoves.slice(split),
      };
    }
  }
  return { retainedMoves: [], wrongMoves: pendingMoves };
}

function solveMoveCountGroup(move: string) {
  const parsed = parseMoveNotation(move);
  return parsed ? { layer: parsed.layer, dir: parsed.dir } : null;
}

function isSameSolveMoveCountGroup(
  a: ReturnType<typeof solveMoveCountGroup>,
  b: ReturnType<typeof solveMoveCountGroup>,
) {
  return Boolean(a && b && a.layer === b.layer && a.dir === b.dir);
}

function solveHistoryEntryKey(entry: SolveHistoryEntry) {
  return `${entry.ts}:${entry.ms}:${entry.mode ?? ""}:${entry.dailyTest?.id ?? ""}:${entry.dailyTest?.index ?? ""}`;
}

function mergeSolveHistories(...histories: SolveHistoryEntry[][]) {
  const byKey = new Map<string, SolveHistoryEntry>();
  histories.flat().forEach((entry) => {
    byKey.set(solveHistoryEntryKey(entry), entry);
  });
  return Array.from(byKey.values()).sort((left, right) => right.ts - left.ts);
}

function freshScrambleStatus() {
  return Array.from({ length: SCRAMBLE_LENGTH }, () => "pending" as ScrambleStepStatus);
}

function freshSmartSolveStatus(length: number) {
  return Array.from({ length }, () => "pending" as SmartSolveStepStatus);
}

function colorTextClass(hex: string) {
  return hex === "#F5F4EF" || hex === "#F2C744" ? " light" : "";
}

export function CubePracticeApp() {
  const cubeMountRef = useRef<HTMLDivElement | null>(null);
  const cubeApiRef = useRef<SmartCubeApi | null>(null);
  const moveLogRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visualPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualPendingMoveRef = useRef<string | null>(null);
  const historyScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextScrambleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectionAudioContextRef = useRef<AudioContext | null>(null);
  const inspectionAudioTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const inspectionAudioVoicesRef = useRef<InspectionAudioVoice[]>([]);
  const inspectionEndCueUntilRef = useRef(0);
  const freeIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freeCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const freeFaceletsFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const practiceModeRef = useRef<PracticeMode>("scramble");
  const freeStateRef = useRef<FreePracticeState>("waitingSolved");
  const solveStartRef = useRef(0);
  const solveMsRef = useRef(0);
  const solveMoveCountRef = useRef(0);
  const solveMoveCountGroupRef = useRef<ReturnType<typeof solveMoveCountGroup>>(null);
  const freeScrambleMoveCountRef = useRef(0);
  const freeAwaitingIdleFaceletsRef = useRef(false);
  const lastFreeMoveAtRef = useRef(0);
  const gyroDisabledRef = useRef(false);
  const scrambleIndexRef = useRef(0);
  const scrambleRef = useRef<string[]>(INITIAL_SCRAMBLE);
  const pendingScrambleMovesRef = useRef<string[]>([]);
  const pendingScrambleAnimatedCountRef = useRef(0);
  const pendingUndoMovesRef = useRef<string[]>([]);
  const pendingUndoAnimatedCountRef = useRef(0);
  const pendingAutoNextScrambleMovesRef = useRef<string[]>([]);
  const undoStackRef = useRef<string[]>([]);
  const smartSolveStatusRef = useRef<SmartSolveStatus>("idle");
  const smartSolveStepsRef = useRef<string[]>([]);
  const smartSolveIndexRef = useRef(0);
  const smartSolvePendingMovesRef = useRef<string[]>([]);
  const smartSolvePendingAnimatedCountRef = useRef(0);
  const smartSolvePendingUndoMovesRef = useRef<string[]>([]);
  const smartSolvePendingUndoAnimatedCountRef = useRef(0);
  const smartSolveUndoStackRef = useRef<string[]>([]);
  const smartSolveFaceletsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smartSolveFaceletsResolverRef = useRef<((facelets: string | null) => void) | null>(null);
  const cfopTimesRef = useRef<LiveCfopMetrics>(EMPTY_CFOP);
  const cfopMovesRef = useRef<LiveCfopMetrics>(EMPTY_CFOP);
  const f2lSubTimesRef = useRef<LiveF2lSubphaseMetrics>(EMPTY_F2L_SUBPHASES);
  const f2lSubMovesRef = useRef<LiveF2lSubphaseMetrics>(EMPTY_F2L_SUBPHASES);
  const highestF2lSolvedSlotCountRef = useRef(0);
  const historyRef = useRef<SolveHistoryEntry[]>([]);
  const dailyTestRef = useRef<DailyTestRun | null>(null);
  const lastFaceletsRequestRef = useRef(0);
  const faceletsRef = useRef<string | null>(null);
  const isConnectedRef = useRef(false);
  const visualStateRef = useRef<CubeVisualState>({ baseFacelets: null, moves: [] });
  const lastAppliedFaceletsRef = useRef<string | null>(null);
  const forceNextVisualFaceletsSyncRef = useRef(false);
  const hasRealtimeMovesRef = useRef(false);
  const suppressSolvedTrailingMoveUntilRef = useRef(0);
  const postSolveMoveGateRef = useRef<{ faceletsSerial: number } | null>(null);
  const moveLogCoordinateRef = useRef(createMoveCoordinateState());
  const moveLogEntriesRef = useRef<MoveLogEntry[]>([]);
  const moveLogCapacityRef = useRef(DEFAULT_MOVE_LOG_CAPACITY);
  const moveLogColumnsRef = useRef(DEFAULT_MOVE_LOG_CAPACITY);
  const gyroCostNoticeFadeTimerRef = useRef<number | null>(null);
  const gyroCostNoticeTimerRef = useRef<number | null>(null);

  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("scramble");
  const [freeState, setFreeState] = useState<FreePracticeState>("waitingSolved");
  const [freeIdleMsLeft, setFreeIdleMsLeft] = useState(FREE_SCRAMBLE_IDLE_MS);
  const [freeScrambleMoveCount, setFreeScrambleMoveCount] = useState(0);
  const [freeNotice, setFreeNotice] = useState("切换到自由练习后，请先连接并复原魔方。");
  const [gyroDisabled, setGyroDisabled] = useState(false);
  const [gyroCostNoticeVisible, setGyroCostNoticeVisible] = useState(false);
  const [gyroCostNoticeFading, setGyroCostNoticeFading] = useState(false);
  const [viewResetEnabled, setViewResetEnabled] = useState(false);
  const [inspectionSettings, setInspectionSettings] = useState<PracticeInspectionSettings>(
    DEFAULT_PRACTICE_INSPECTION_SETTINGS,
  );
  const [inspectMs, setInspectMs] = useState(DEFAULT_PRACTICE_INSPECTION_SETTINGS.seconds * 1000);
  const [solveMs, setSolveMs] = useState(0);
  const [solveMoveCount, setSolveMoveCount] = useState(0);
  const [history, setHistory] = useState<SolveHistoryEntry[]>([]);
  const [dailyLevels, setDailyLevels] = useState<DailyLevelEntry[]>([]);
  const [dailyTest, setDailyTest] = useState<DailyTestRun | null>(null);
  const [averageSettings, setAverageSettings] = useState<AverageTimeSettings>(DEFAULT_AVERAGE_TIME_SETTINGS);
  const [scramble, setScramble] = useState(INITIAL_SCRAMBLE);
  const [scrambleIndex, setScrambleIndex] = useState(0);
  const [scrambleStatus, setScrambleStatus] = useState<ScrambleStepStatus[]>(() => freshScrambleStatus());
  const [, setScrambleNotice] = useState("点击开始打乱后，按公式转动真实魔方。");
  const [scrambleWrong, setScrambleWrong] = useState(false);
  const [undoDisplay, setUndoDisplay] = useState<string[]>([]);
  const [smartSolveStatus, setSmartSolveStatus] = useState<SmartSolveStatus>("idle");
  const [smartSolveSteps, setSmartSolveSteps] = useState<string[]>([]);
  const [smartSolveIndex, setSmartSolveIndex] = useState(0);
  const [smartSolveStepStatus, setSmartSolveStepStatus] = useState<SmartSolveStepStatus[]>([]);
  const [smartSolveNotice, setSmartSolveNotice] = useState("点击智能求解后，将根据真实魔方状态生成复原公式。");
  const [smartSolveWrong, setSmartSolveWrong] = useState(false);
  const [smartSolveUndoDisplay, setSmartSolveUndoDisplay] = useState<string[]>([]);
  const [cfopTimes, setCfopTimes] = useState<LiveCfopMetrics>(EMPTY_CFOP);
  const [f2lSubTimes, setF2lSubTimes] = useState<LiveF2lSubphaseMetrics>(EMPTY_F2L_SUBPHASES);
  const [f2lSubMoves, setF2lSubMoves] = useState<LiveF2lSubphaseMetrics>(EMPTY_F2L_SUBPHASES);
  const [historyCfopTip, setHistoryCfopTip] = useState<HistoryCfopTip | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [moveLogCapacity, setMoveLogCapacity] = useState(DEFAULT_MOVE_LOG_CAPACITY);
  const [moveLogColumns, setMoveLogColumns] = useState(DEFAULT_MOVE_LOG_CAPACITY);
  const [moveLogRows, setMoveLogRows] = useState(MOVE_LOG_FALLBACK_ROWS);
  const canResetDisplayOrientation = viewResetEnabled || !gyroDisabled;
  const [historyRows, setHistoryRows] = useState(HISTORY_FALLBACK_ROWS);
  const [historyScrolling, setHistoryScrolling] = useState(false);
  const [historyEditing, setHistoryEditing] = useState(false);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<PendingHistoryDelete | null>(null);

  const {
    connectionState,
    facelets,
    connectRealCube,
    requestBattery,
    requestFacelets,
    resetTrackedCubeState,
    getLatestGyro,
    subscribeMove,
    subscribeGyro,
    subscribeFacelets,
    visualState,
  } = useCubeConnection();
  const { orientation, faceColors, renderMaxFps, backFaceProjectionEnabled, backFaceProjectionDistance } = useCubeAppearance();
  isConnectedRef.current = connectionState === "connected";
  visualStateRef.current = visualState;
  const inspectionDurationMs = useMemo(
    () => getPracticeInspectionDurationMs(inspectionSettings),
    [inspectionSettings],
  );
  const inspectionNoticeLabel = inspectionDurationMs === null ? "无限观察" : `${inspectionSettings.seconds} 秒观察`;

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    return () => {
      if (gyroCostNoticeFadeTimerRef.current !== null) {
        window.clearTimeout(gyroCostNoticeFadeTimerRef.current);
      }
      if (gyroCostNoticeTimerRef.current !== null) {
        window.clearTimeout(gyroCostNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingHistoryDelete) return;
    function closePendingDelete() {
      setPendingHistoryDelete(null);
    }
    window.addEventListener("pointerdown", closePendingDelete);
    return () => window.removeEventListener("pointerdown", closePendingDelete);
  }, [pendingHistoryDelete]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    practiceModeRef.current = practiceMode;
  }, [practiceMode]);

  useEffect(() => {
    freeStateRef.current = freeState;
  }, [freeState]);

  useEffect(() => {
    faceletsRef.current = facelets;
  }, [facelets]);

  useEffect(() => {
    function refreshArchiveData() {
      const disabled = loadPracticeGyroDisabled();
      const nextHistory = loadSolveHistory();
      gyroDisabledRef.current = disabled;
      historyRef.current = nextHistory;
      setGyroDisabled(disabled);
      setHistory(nextHistory);
      setDailyLevels(loadDailyLevels());
      setAverageSettings(loadAverageTimeSettings());
      setInspectionSettings(loadPracticeInspectionSettings());
    }

    refreshArchiveData();
    return subscribeStatisticsArchiveChange(refreshArchiveData);
  }, []);

  useEffect(() => {
    scrambleRef.current = scramble;
  }, [scramble]);

  useEffect(() => {
    smartSolveStatusRef.current = smartSolveStatus;
  }, [smartSolveStatus]);

  useEffect(() => {
    smartSolveStepsRef.current = smartSolveSteps;
  }, [smartSolveSteps]);

  useEffect(() => {
    smartSolveIndexRef.current = smartSolveIndex;
  }, [smartSolveIndex]);

  useEffect(() => {
    moveLogCapacityRef.current = moveLogCapacity;
    if (moveLogEntriesRef.current.length <= moveLogCapacity) return;
    const overflow = moveLogEntriesRef.current.length - moveLogCapacity;
    const rowsToDrop = Math.max(1, Math.ceil(overflow / moveLogColumnsRef.current));
    const nextEntries = moveLogEntriesRef.current.slice(rowsToDrop * moveLogColumnsRef.current);
    moveLogEntriesRef.current = nextEntries;
    setMoveLog(nextEntries);
  }, [moveLogCapacity]);

  useLayoutEffect(() => {
    const track = moveLogRef.current;
    if (!track) return;

    const updateCapacity = () => {
      const rect = track.getBoundingClientRect();
      const parent = track.parentElement;
      const leftColumn = parent?.parentElement;
      const head = parent?.querySelector<HTMLElement>(".ml-head") ?? null;
      const parentStyle = parent ? window.getComputedStyle(parent) : null;
      const headStyle = head ? window.getComputedStyle(head) : null;
      const leftStyle = leftColumn ? window.getComputedStyle(leftColumn) : null;
      const width = rect.width || track.clientWidth || track.parentElement?.clientWidth || 0;
      const leftPaddingY = leftStyle ? parseFloat(leftStyle.paddingTop) + parseFloat(leftStyle.paddingBottom) : 0;
      const leftBorderY = leftStyle ? parseFloat(leftStyle.borderTopWidth) + parseFloat(leftStyle.borderBottomWidth) : 0;
      const parentHeight = leftColumn
        ? leftColumn.clientHeight -
          leftPaddingY -
          leftBorderY -
          [...leftColumn.children].reduce((height, child) => child === parent ? height : height + child.getBoundingClientRect().height, 0) -
          Math.max(0, leftColumn.children.length - 1) * (leftStyle ? parseFloat(leftStyle.rowGap) || parseFloat(leftStyle.gap) || 0 : 0)
        : parent?.clientHeight ?? 0;
      const parentPaddingY = parentStyle ? parseFloat(parentStyle.paddingTop) + parseFloat(parentStyle.paddingBottom) : 0;
      const parentBorderY = parentStyle ? parseFloat(parentStyle.borderTopWidth) + parseFloat(parentStyle.borderBottomWidth) : 0;
      const headHeight = head ? head.getBoundingClientRect().height : 0;
      const headMarginBottom = headStyle ? parseFloat(headStyle.marginBottom) : 0;
      const availableHeight = parentHeight - parentPaddingY - parentBorderY - headHeight - headMarginBottom;
      const height = availableHeight > 0
        ? availableHeight
        : rect.height || track.clientHeight || MOVE_LOG_FALLBACK_ROWS * (MOVE_LOG_PILL_SIZE + MOVE_LOG_ROW_GAP);
      const columns = Math.max(1, Math.floor((width - MOVE_LOG_MIN_COLUMN_GAP) / (MOVE_LOG_PILL_SIZE + MOVE_LOG_MIN_COLUMN_GAP)));
      const rows = Math.max(1, Math.floor((height + MOVE_LOG_ROW_GAP) / (MOVE_LOG_PILL_SIZE + MOVE_LOG_ROW_GAP)));
      moveLogColumnsRef.current = columns;
      setMoveLogColumns(columns);
      setMoveLogRows(rows);
      setMoveLogCapacity(columns * rows);
    };

    updateCapacity();
    const observer = new ResizeObserver(updateCapacity);
    observer.observe(track);
    if (track.parentElement) observer.observe(track.parentElement);
    if (track.parentElement?.parentElement) observer.observe(track.parentElement.parentElement);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const list = historyListRef.current;
    if (!list) return;

    const updateRows = () => {
      const parent = list.parentElement;
      const rightColumn = parent?.parentElement;
      const head = parent?.querySelector<HTMLElement>(".practice-card-head") ?? null;
      const parentStyle = parent ? window.getComputedStyle(parent) : null;
      const rightStyle = rightColumn ? window.getComputedStyle(rightColumn) : null;
      const listStyle = window.getComputedStyle(list);
      const rightPaddingY = rightStyle ? parseFloat(rightStyle.paddingTop) + parseFloat(rightStyle.paddingBottom) : 0;
      const rightBorderY = rightStyle ? parseFloat(rightStyle.borderTopWidth) + parseFloat(rightStyle.borderBottomWidth) : 0;
      const parentHeight = rightColumn
        ? rightColumn.clientHeight -
          rightPaddingY -
          rightBorderY -
          [...rightColumn.children].reduce((height, child) => child === parent ? height : height + child.getBoundingClientRect().height, 0) -
          Math.max(0, rightColumn.children.length - 1) * (rightStyle ? parseFloat(rightStyle.rowGap) || parseFloat(rightStyle.gap) || 0 : 0)
        : parent?.clientHeight ?? 0;
      const parentPaddingY = parentStyle ? parseFloat(parentStyle.paddingTop) + parseFloat(parentStyle.paddingBottom) : 0;
      const parentBorderY = parentStyle ? parseFloat(parentStyle.borderTopWidth) + parseFloat(parentStyle.borderBottomWidth) : 0;
      const headHeight = head ? head.getBoundingClientRect().height : 0;
      const headStyle = head ? window.getComputedStyle(head) : null;
      const headMarginBottom = headStyle ? parseFloat(headStyle.marginBottom) : 0;
      const listBorderY = parseFloat(listStyle.borderTopWidth) + parseFloat(listStyle.borderBottomWidth);
      const availableHeight = parentHeight - parentPaddingY - parentBorderY - headHeight - headMarginBottom;
      const rowSpace = Math.max(0, availableHeight - listBorderY);
      const rows = Math.max(1, Math.floor((rowSpace + HISTORY_ROW_GAP) / (HISTORY_ROW_SIZE + HISTORY_ROW_GAP)));
      setHistoryRows(rows);
    };

    updateRows();
    const observer = new ResizeObserver(updateRows);
    observer.observe(list);
    if (list.parentElement) observer.observe(list.parentElement);
    if (list.parentElement?.parentElement) observer.observe(list.parentElement.parentElement);
    return () => observer.disconnect();
  }, [history.length]);

  const clearSolveTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const updateSolveMs = useCallback((value: number) => {
    solveMsRef.current = value;
    setSolveMs(value);
  }, []);

  const requestFaceletsThrottled = useCallback(() => {
    const now = performance.now();
    if (now - lastFaceletsRequestRef.current < 350) return;
    lastFaceletsRequestRef.current = now;
    void requestFacelets();
  }, [requestFacelets]);

  const armPostSolveMoveGate = useCallback((faceletsSerial: number) => {
    postSolveMoveGateRef.current = { faceletsSerial: normalizeCubeSerial(faceletsSerial) };
  }, []);

  const clearPostSolveMoveGate = useCallback(() => {
    postSolveMoveGateRef.current = null;
  }, []);

  const shouldIgnoreInitialPostSolveMove = useCallback((signal?: CubeMoveSignal) => {
    const gate = postSolveMoveGateRef.current;
    if (!gate) return false;

    if (!signal || !Number.isFinite(signal.serial)) {
      postSolveMoveGateRef.current = null;
      return false;
    }

    if (!isCubeSerialAfter(gate.faceletsSerial, signal.serial)) {
      return true;
    }

    postSolveMoveGateRef.current = null;
    return false;
  }, []);

  const setFreePracticeState = useCallback((next: FreePracticeState) => {
    freeStateRef.current = next;
    setFreeState(next);
  }, []);

  const clearFreeTimers = useCallback(() => {
    if (freeIdleTimerRef.current) {
      clearTimeout(freeIdleTimerRef.current);
      freeIdleTimerRef.current = null;
    }
    if (freeCountdownTimerRef.current) {
      clearInterval(freeCountdownTimerRef.current);
      freeCountdownTimerRef.current = null;
    }
    if (freeFaceletsFallbackTimerRef.current) {
      clearTimeout(freeFaceletsFallbackTimerRef.current);
      freeFaceletsFallbackTimerRef.current = null;
    }
    freeAwaitingIdleFaceletsRef.current = false;
  }, []);

  const clearAutoNextScrambleTimer = useCallback(() => {
    if (autoNextScrambleTimerRef.current === null) return;
    clearTimeout(autoNextScrambleTimerRef.current);
    autoNextScrambleTimerRef.current = null;
  }, []);

  const clearPendingAutoNextScrambleMoves = useCallback(() => {
    pendingAutoNextScrambleMovesRef.current = [];
  }, []);

  const getInspectionAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (inspectionAudioContextRef.current) return inspectionAudioContextRef.current;

    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    try {
      const context = new AudioContextCtor();
      inspectionAudioContextRef.current = context;
      return context;
    } catch {
      return null;
    }
  }, []);

  const warmInspectionAudio = useCallback(() => {
    const context = getInspectionAudioContext();
    if (!context || context.state !== "suspended") return;
    void context.resume().catch(() => {
      // Audio is optional; timing should continue if the browser blocks it.
    });
  }, [getInspectionAudioContext]);

  const forgetInspectionVoice = useCallback((voice: InspectionAudioVoice) => {
    inspectionAudioVoicesRef.current = inspectionAudioVoicesRef.current.filter((candidate) => candidate !== voice);
  }, []);

  const stopInspectionVoice = useCallback(
    (voice: InspectionAudioVoice) => {
      const context = inspectionAudioContextRef.current;
      if (!context) {
        forgetInspectionVoice(voice);
        return;
      }

      const now = context.currentTime;
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.012);
        voice.oscillators.forEach((oscillator) => oscillator.stop(now + 0.05));
      } catch {
        // Stopping an already-stopped oscillator throws in some browsers.
      }
      forgetInspectionVoice(voice);
    },
    [forgetInspectionVoice],
  );

  const cancelInspectionAudio = useCallback((preserveActiveVoices = false) => {
    inspectionAudioTimersRef.current.forEach((timer) => clearTimeout(timer));
    inspectionAudioTimersRef.current = [];
    if (preserveActiveVoices) return;
    inspectionAudioVoicesRef.current.forEach(stopInspectionVoice);
    inspectionAudioVoicesRef.current = [];
  }, [stopInspectionVoice]);

  const playInspectionBeep = useCallback(
    (variant: "soft" | "bright") => {
      if (phaseRef.current !== "inspect") return;
      const context = getInspectionAudioContext();
      if (!context) return;

      if (context.state === "suspended") {
        void context.resume().then(() => {
          if (phaseRef.current === "inspect") playInspectionBeep(variant);
        }).catch(() => {
          // Audio is optional; ignore blocked playback.
        });
        return;
      }

      const now = context.currentTime;
      const duration = variant === "bright" ? 0.22 : 0.13;
      const peakGain = 0.30;
      const releaseAt = now + duration - 0.04;
      const stopAt = now + duration + 0.04;
      const gain = context.createGain();
      const frequencies = variant === "bright" ? [1120, 1680] : [680];
      const oscillators = frequencies.map((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = variant === "bright" && index === 1 ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.connect(gain);
        return oscillator;
      });
      const voice: InspectionAudioVoice = { gain, oscillators };

      gain.connect(context.destination);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.012);
      gain.gain.setValueAtTime(peakGain, releaseAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      inspectionAudioVoicesRef.current = [...inspectionAudioVoicesRef.current, voice];
      oscillators.forEach((oscillator) => {
        oscillator.onended = () => forgetInspectionVoice(voice);
        oscillator.start(now);
        oscillator.stop(stopAt);
      });
    },
    [forgetInspectionVoice, getInspectionAudioContext],
  );

  const scheduleInspectionAudio = useCallback(
    (startedAt: number, durationMs: number) => {
      cancelInspectionAudio();
      warmInspectionAudio();

      inspectionAudioTimersRef.current = INSPECTION_AUDIO_CUE_SECONDS.flatMap((secondsLeft) => {
        const delay = durationMs - secondsLeft * 1000 - (performance.now() - startedAt);
        if (delay <= 0) return [];
        const timeout = setTimeout(() => {
          inspectionAudioTimersRef.current = inspectionAudioTimersRef.current.filter((timer) => timer !== timeout);
          if (phaseRef.current !== "inspect") return;
          playInspectionBeep("soft");
        }, delay);
        return [timeout];
      });
    },
    [cancelInspectionAudio, playInspectionBeep, warmInspectionAudio],
  );

  const confirmFreeScrambleIdle = useCallback(
    (nextFacelets: string | null) => {
      if (practiceModeRef.current !== "free" || freeStateRef.current !== "scrambling") return false;
      if (!freeAwaitingIdleFaceletsRef.current) return false;

      freeAwaitingIdleFaceletsRef.current = false;
      if (freeFaceletsFallbackTimerRef.current) {
        clearTimeout(freeFaceletsFallbackTimerRef.current);
        freeFaceletsFallbackTimerRef.current = null;
      }

      if (!nextFacelets) {
        setFreeIdleMsLeft(0);
        setFreeNotice("未收到 facelets，无法确认打乱完成；请再转一下或重新同步魔方状态。");
        return true;
      }

      if (isSolvedFacelets(nextFacelets)) {
        freeScrambleMoveCountRef.current = 0;
        setFreeScrambleMoveCount(0);
        setFreeIdleMsLeft(FREE_SCRAMBLE_IDLE_MS);
        setFreePracticeState("ready");
        setFreeNotice("检测到魔方仍为复原态，可继续自由打乱。");
        return true;
      }

      setFreePracticeState("armed");
      setFreeIdleMsLeft(0);
      setFreeNotice("打乱完成。转第一下开始复原计时。");
      return true;
    },
    [setFreePracticeState],
  );

  const scheduleFreeIdleCheck = useCallback(() => {
    if (freeIdleTimerRef.current) clearTimeout(freeIdleTimerRef.current);
    if (freeCountdownTimerRef.current) clearInterval(freeCountdownTimerRef.current);
    if (freeFaceletsFallbackTimerRef.current) {
      clearTimeout(freeFaceletsFallbackTimerRef.current);
      freeFaceletsFallbackTimerRef.current = null;
    }

    freeAwaitingIdleFaceletsRef.current = false;
    lastFreeMoveAtRef.current = performance.now();
    setFreeIdleMsLeft(FREE_SCRAMBLE_IDLE_MS);

    freeCountdownTimerRef.current = setInterval(() => {
      const left = Math.max(0, FREE_SCRAMBLE_IDLE_MS - (performance.now() - lastFreeMoveAtRef.current));
      setFreeIdleMsLeft(left);
    }, 100);

    freeIdleTimerRef.current = setTimeout(() => {
      if (freeCountdownTimerRef.current) {
        clearInterval(freeCountdownTimerRef.current);
        freeCountdownTimerRef.current = null;
      }
      freeIdleTimerRef.current = null;
      setFreeIdleMsLeft(0);
      freeAwaitingIdleFaceletsRef.current = true;
      setFreeNotice("5 秒静止，正在确认打乱状态。");
      void requestFacelets();
      freeFaceletsFallbackTimerRef.current = setTimeout(() => {
        confirmFreeScrambleIdle(faceletsRef.current);
      }, 700);
    }, FREE_SCRAMBLE_IDLE_MS);
  }, [confirmFreeScrambleIdle, requestFacelets]);

  const resetFreeReadiness = useCallback(
    (nextFacelets = faceletsRef.current) => {
      clearPostSolveMoveGate();
      clearFreeTimers();
      freeScrambleMoveCountRef.current = 0;
      setFreeScrambleMoveCount(0);
      setFreeIdleMsLeft(FREE_SCRAMBLE_IDLE_MS);

      if (isSolvedFacelets(nextFacelets)) {
        setFreePracticeState("ready");
        setFreeNotice("魔方已复原。可直接自由打乱，停手后静止进度会自动推进。");
      } else if (nextFacelets) {
        setFreeIdleMsLeft(0);
        setFreePracticeState("armed");
        setFreeNotice("当前为非复原态，转任意面开始复原计时。");
      } else {
        setFreePracticeState("waitingSolved");
        setFreeNotice("等待魔方状态，同步后可自由打乱或直接开始复原。");
      }
    },
    [clearFreeTimers, clearPostSolveMoveGate, setFreePracticeState],
  );

  const beginSolveTimer = useCallback(
    (initialMove: string | null = null) => {
      const initialMoveGroup = initialMove ? solveMoveCountGroup(initialMove) : null;
      suppressSolvedTrailingMoveUntilRef.current = 0;
      const start = performance.now();
      solveStartRef.current = start;
      solveMsRef.current = 0;
      solveMoveCountRef.current = initialMoveGroup ? 1 : 0;
      solveMoveCountGroupRef.current = initialMoveGroup;
      cfopTimesRef.current = EMPTY_CFOP;
      cfopMovesRef.current = EMPTY_CFOP;
      f2lSubTimesRef.current = EMPTY_F2L_SUBPHASES;
      f2lSubMovesRef.current = EMPTY_F2L_SUBPHASES;
      highestF2lSolvedSlotCountRef.current = 0;
      setCfopTimes(EMPTY_CFOP);
      setF2lSubTimes(EMPTY_F2L_SUBPHASES);
      setF2lSubMoves(EMPTY_F2L_SUBPHASES);
      setSolveMoveCount(solveMoveCountRef.current);
      updateSolveMs(0);
      clearSolveTick();
      tickRef.current = setInterval(() => {
        updateSolveMs(performance.now() - start);
      }, 17);
      phaseRef.current = "solving";
      setPhase("solving");
      requestFaceletsThrottled();
    },
    [clearSolveTick, requestFaceletsThrottled, updateSolveMs],
  );

  const recordSolveMove = useCallback((move: string) => {
    const nextMoveGroup = solveMoveCountGroup(move);
    if (!nextMoveGroup) return;
    if (!isSameSolveMoveCountGroup(solveMoveCountGroupRef.current, nextMoveGroup)) {
      solveMoveCountRef.current += 1;
    }
    solveMoveCountGroupRef.current = nextMoveGroup;
    setSolveMoveCount(solveMoveCountRef.current);
  }, []);

  function commitSolveHistory(next: SolveHistoryEntry[]) {
    historyRef.current = next;
    touchLocalUserDataPackageUpdatedAt();
    saveSolveHistory(next);
    setHistory(next);
  }

  function appendAndCommitSolveHistory(entry: SolveHistoryEntry, completedDailyTestId: string | null = null) {
    const current = mergeSolveHistories(historyRef.current, loadSolveHistory());
    const entryKey = solveHistoryEntryKey(entry);
    const appended = prependSolveHistoryEntry(
      current.filter((candidate) => solveHistoryEntryKey(candidate) !== entryKey),
      entry,
    );
    const next = completedDailyTestId
      ? appended.map((candidate) =>
          candidate.dailyTest?.id === completedDailyTestId
            ? { ...candidate, dailyTest: { ...candidate.dailyTest, completed: true } }
            : candidate,
        )
      : appended;
    commitSolveHistory(next);
  }

  const markCfopTimes = useCallback((nextFacelets: string, forceSolved = false) => {
    if (phaseRef.current !== "solving") return cfopTimesRef.current;
    const elapsed = Math.max(0, performance.now() - solveStartRef.current);
    const milestones = detectCfopMilestones(nextFacelets);
    const f2lSolvedSlotCount = detectF2lSolvedSlotCount(nextFacelets);
    const next = { ...cfopTimesRef.current };
    const nextMoves = { ...cfopMovesRef.current };
    const nextF2lSubTimes = { ...f2lSubTimesRef.current };
    const nextF2lSubMoves = { ...f2lSubMovesRef.current };

    function markPhase(key: CfopPhaseKey, solved: boolean) {
      if (!solved || next[key] != null) return;
      next[key] = elapsed;
      nextMoves[key] = solveMoveCountRef.current;
    }

    markPhase("cross", milestones.cross || forceSolved);
    markPhase("f2l", milestones.f2l || forceSolved);
    markPhase("oll", milestones.oll || forceSolved);
    markPhase("pll", milestones.pll || forceSolved);

    const cappedF2lSolvedSlotCount = Math.min(F2L_SUBPHASES.length, f2lSolvedSlotCount);
    if (cappedF2lSolvedSlotCount > highestF2lSolvedSlotCountRef.current) {
      for (let index = highestF2lSolvedSlotCountRef.current; index < cappedF2lSolvedSlotCount; index += 1) {
        const subphase = F2L_SUBPHASES[index];
        if (subphase && nextF2lSubTimes[subphase.key] == null) {
          nextF2lSubTimes[subphase.key] = elapsed;
          nextF2lSubMoves[subphase.key] = solveMoveCountRef.current;
        }
      }
      highestF2lSolvedSlotCountRef.current = cappedF2lSolvedSlotCount;
    }

    cfopTimesRef.current = next;
    cfopMovesRef.current = nextMoves;
    f2lSubTimesRef.current = nextF2lSubTimes;
    f2lSubMovesRef.current = nextF2lSubMoves;
    setCfopTimes(next);
    setF2lSubTimes(nextF2lSubTimes);
    setF2lSubMoves(nextF2lSubMoves);
    return next;
  }, []);

  const finishSolve = useCallback(
    (source: "auto" | "manual") => {
      if (phaseRef.current !== "solving") return;
      const elapsed = solveMsRef.current || Math.max(0, performance.now() - solveStartRef.current);
      const activeDailyTest = dailyTestRef.current;
      const dailyIndex = activeDailyTest ? activeDailyTest.solves.length + 1 : null;
      const entryMode: PracticeMode = activeDailyTest ? "scramble" : practiceModeRef.current;
      const entryTs = Date.now();
      clearSolveTick();
      updateSolveMs(elapsed);
      phaseRef.current = "done";
      setPhase("done");
      void requestBattery({ minIntervalMs: 60_000 });
      const finalCfop = source === "auto" ? { ...cfopTimesRef.current, pll: cfopTimesRef.current.pll ?? elapsed } : cfopTimesRef.current;
      const finalCfopMoves = source === "auto"
        ? { ...cfopMovesRef.current, pll: cfopMovesRef.current.pll ?? solveMoveCountRef.current }
        : cfopMovesRef.current;
      cfopTimesRef.current = finalCfop;
      cfopMovesRef.current = finalCfopMoves;
      setCfopTimes(finalCfop);
      const historyEntry: SolveHistoryEntry = {
        ms: elapsed,
        ts: entryTs,
        mode: entryMode,
        moves: solveMoveCountRef.current,
        cfop: toHistoryCfopMetrics(finalCfop),
        cfopMoves: toHistoryCfopMetrics(finalCfopMoves),
        cfopF2l: toHistoryF2lSubphaseMetrics(f2lSubTimesRef.current),
        cfopF2lMoves: toHistoryF2lSubphaseMetrics(f2lSubMovesRef.current),
        ...(activeDailyTest && dailyIndex
          ? {
              dailyTest: {
                id: activeDailyTest.id,
                localDate: activeDailyTest.localDate,
                index: dailyIndex,
                completed: false,
              },
            }
          : {}),
      };
      const nextDailySolves = activeDailyTest
        ? [
            ...activeDailyTest.solves,
            {
              ms: elapsed,
              ts: entryTs,
              moves: solveMoveCountRef.current,
            },
          ]
        : [];
      const dailyTestComplete = Boolean(activeDailyTest && nextDailySolves.length >= DAILY_TEST_TARGET);

      appendAndCommitSolveHistory(historyEntry, dailyTestComplete && activeDailyTest ? activeDailyTest.id : null);

      if (entryMode === "free") {
        clearFreeTimers();
        freeScrambleMoveCountRef.current = 0;
        setFreeScrambleMoveCount(0);
        setFreeIdleMsLeft(FREE_SCRAMBLE_IDLE_MS);
        setFreePracticeState("ready");
        setFreeNotice("复原完成。保持复原态后可直接开始下一次自由打乱。");
      }

      if (source === "auto") {
        forceNextVisualFaceletsSyncRef.current = true;
        hasRealtimeMovesRef.current = false;
        void requestFacelets();
      }

      if (!activeDailyTest) {
        if (entryMode === "scramble" && practiceModeRef.current === "scramble") {
          setScrambleNotice("复原完成，自动进入下一次打乱。");
          clearAutoNextScrambleTimer();
          clearPendingAutoNextScrambleMoves();
          autoNextScrambleTimerRef.current = setTimeout(() => {
            autoNextScrambleTimerRef.current = null;
            if (dailyTestRef.current || practiceModeRef.current !== "scramble" || phaseRef.current !== "done") return;
            beginAutoNextScramble();
          }, AUTO_NEXT_SCRAMBLE_DELAY_MS);
        }
        return;
      }

      if (dailyTestComplete) {
        const completedAt = entryTs;
        const averageMs = calculateDailyLevelAverage(nextDailySolves) ?? elapsed;
        const completedLevel: DailyLevelEntry = {
          id: activeDailyTest.id,
          localDate: activeDailyTest.localDate,
          completedAt,
          averageMs,
          solves: nextDailySolves,
        };
        setDailyLevels((prev) => {
          const next = [completedLevel, ...prev.filter((entry) => entry.localDate !== completedLevel.localDate)].slice(0, 120);
          touchLocalUserDataPackageUpdatedAt();
          saveDailyLevels(next);
          return next;
        });
        dailyTestRef.current = null;
        setDailyTest(null);
        const completedLabel = activeDailyTest.localDate === getDailyTestDateKey() ? "今日测试" : "补测成绩";
        setScrambleNotice(`${completedLabel}完成，平均 ${fmtShort(averageMs)}。`);
      } else {
        const nextRun = { ...activeDailyTest, solves: nextDailySolves };
        dailyTestRef.current = nextRun;
        setDailyTest(nextRun);
        setScrambleNotice(`第 ${nextDailySolves.length} 次完成，自动进入第 ${nextDailySolves.length + 1} 次打乱。`);
        clearAutoNextScrambleTimer();
        clearPendingAutoNextScrambleMoves();
        autoNextScrambleTimerRef.current = setTimeout(() => {
          autoNextScrambleTimerRef.current = null;
          const currentDailyTest = dailyTestRef.current;
          if (
            !currentDailyTest ||
            currentDailyTest.id !== activeDailyTest.id ||
            currentDailyTest.solves.length !== nextDailySolves.length ||
            phaseRef.current !== "done"
          ) {
            return;
          }
          beginAutoNextScramble();
        }, AUTO_NEXT_SCRAMBLE_DELAY_MS);
      }
    },
    [clearAutoNextScrambleTimer, clearFreeTimers, clearSolveTick, requestBattery, requestFacelets, setFreePracticeState, updateSolveMs],
  );

  const startSolving = useCallback(
    (initialMove: string | null = null, preserveActiveInspectionAudio = false) => {
      if (phaseRef.current !== "inspect") return;
      cancelInspectionAudio(preserveActiveInspectionAudio);
      beginSolveTimer(initialMove);
    },
    [beginSolveTimer, cancelInspectionAudio],
  );

  const animateCubeMoves = useCallback((moves: string[]) => {
    moves.forEach((move) => {
      expandMoveNotation(move).forEach((turn) => {
        cubeApiRef.current?.applyMove(turn.layer, turn.dir, CUBE_MOVE_ANIMATION_MS);
      });
    });
  }, []);

  const resetMoveLog = useCallback(() => {
    moveLogCoordinateRef.current = createMoveCoordinateState();
    moveLogEntriesRef.current = [];
    setMoveLog([]);
  }, []);

  const appendMoveLog = useCallback((move: string, trackCoordinate = true) => {
    const previousEntries = moveLogEntriesRef.current;
    const next = trackCoordinate
      ? appendNormalizedMoveLogMove(
          previousEntries.map((entry) => entry.m),
          move,
          moveLogCoordinateRef.current,
        )
      : {
          history: appendFixedViewMoveLogMove(previousEntries.map((entry) => entry.m), move),
          coordinateState: createMoveCoordinateState(),
        };
    const timestamp = performance.now();
    const mappedEntries = next.history
      .map((normalizedMove, index) => {
        const previousEntry = previousEntries[index];
        return previousEntry?.m === normalizedMove ? previousEntry : { m: normalizedMove, t: timestamp };
      });
    const overflow = mappedEntries.length - moveLogCapacityRef.current;
    const nextEntries = overflow > 0
      ? mappedEntries.slice(Math.max(1, Math.ceil(overflow / moveLogColumnsRef.current)) * moveLogColumnsRef.current)
      : mappedEntries;

    moveLogCoordinateRef.current = next.coordinateState;
    moveLogEntriesRef.current = nextEntries;
    setMoveLog(nextEntries);
  }, []);

  const animateUnplayedPendingMoves = useCallback(
    (moves: string[], animatedCountRef: { current: number }, fallbackMove?: string) => {
      const unplayed = moves.slice(animatedCountRef.current);
      if (unplayed.length > 0) {
        animateCubeMoves(unplayed);
      } else if (fallbackMove) {
        animateCubeMoves([fallbackMove]);
      }
      animatedCountRef.current = 0;
    },
    [animateCubeMoves],
  );

  const clearSmartSolveFaceletsWait = useCallback((value: string | null = null) => {
    if (smartSolveFaceletsTimerRef.current) {
      clearTimeout(smartSolveFaceletsTimerRef.current);
      smartSolveFaceletsTimerRef.current = null;
    }
    const resolver = smartSolveFaceletsResolverRef.current;
    smartSolveFaceletsResolverRef.current = null;
    resolver?.(value);
  }, []);

  const waitForSmartSolveFacelets = useCallback(() => {
    clearSmartSolveFaceletsWait();
    return new Promise<string | null>((resolve) => {
      smartSolveFaceletsResolverRef.current = resolve;
      smartSolveFaceletsTimerRef.current = setTimeout(() => {
        clearSmartSolveFaceletsWait(null);
      }, SMART_SOLVE_FACELETS_TIMEOUT_MS);
    });
  }, [clearSmartSolveFaceletsWait]);

  const resetSmartSolveState = useCallback(() => {
    clearSmartSolveFaceletsWait();
    smartSolveStatusRef.current = "idle";
    smartSolveStepsRef.current = [];
    smartSolveIndexRef.current = 0;
    smartSolvePendingMovesRef.current = [];
    smartSolvePendingAnimatedCountRef.current = 0;
    smartSolvePendingUndoMovesRef.current = [];
    smartSolvePendingUndoAnimatedCountRef.current = 0;
    smartSolveUndoStackRef.current = [];
    setSmartSolveStatus("idle");
    setSmartSolveSteps([]);
    setSmartSolveIndex(0);
    setSmartSolveStepStatus([]);
    setSmartSolveNotice("点击智能求解后，将根据真实魔方状态生成复原公式。");
    setSmartSolveWrong(false);
    setSmartSolveUndoDisplay([]);
  }, [clearSmartSolveFaceletsWait]);

  const failSmartSolve = useCallback((message: string) => {
    clearSmartSolveFaceletsWait();
    smartSolveStatusRef.current = "error";
    smartSolveStepsRef.current = [];
    smartSolveIndexRef.current = 0;
    smartSolvePendingMovesRef.current = [];
    smartSolvePendingAnimatedCountRef.current = 0;
    smartSolvePendingUndoMovesRef.current = [];
    smartSolvePendingUndoAnimatedCountRef.current = 0;
    smartSolveUndoStackRef.current = [];
    setSmartSolveStatus("error");
    setSmartSolveSteps([]);
    setSmartSolveIndex(0);
    setSmartSolveStepStatus([]);
    setSmartSolveWrong(false);
    setSmartSolveUndoDisplay([]);
    setSmartSolveNotice(message);
  }, [clearSmartSolveFaceletsWait]);

  const handleSmartSolveMove = useCallback(
    (move: string) => {
      const actual = normalizeMove(move);
      const steps = smartSolveStepsRef.current;
      const undoStack = smartSolveUndoStackRef.current;

      if (smartSolveStatusRef.current !== "active" || steps.length === 0) return;

      if (undoStack.length > 0) {
        const expectedUndo = undoStack[undoStack.length - 1];
        smartSolvePendingUndoMovesRef.current = [...smartSolvePendingUndoMovesRef.current, actual];
        if (movesMatchExpected(smartSolvePendingUndoMovesRef.current, expectedUndo)) {
          animateUnplayedPendingMoves(
            smartSolvePendingUndoMovesRef.current,
            smartSolvePendingUndoAnimatedCountRef,
            expectedUndo,
          );
          smartSolvePendingUndoMovesRef.current = [];
          smartSolveUndoStackRef.current = undoStack.slice(0, -1);
          setSmartSolveUndoDisplay(smartSolveUndoStackRef.current);
          setSmartSolveNotice(
            smartSolveUndoStackRef.current.length === 0
              ? `已撤销，继续第 ${smartSolveIndexRef.current + 1} 步。`
              : `继续撤销 ${smartSolveUndoStackRef.current[smartSolveUndoStackRef.current.length - 1]}。`,
          );
          if (smartSolveUndoStackRef.current.length === 0) setSmartSolveWrong(false);
        } else if (moveCanStillMatchExpected(smartSolvePendingUndoMovesRef.current, expectedUndo)) {
          animateCubeMoves([actual]);
          smartSolvePendingUndoAnimatedCountRef.current = smartSolvePendingUndoMovesRef.current.length;
          const remainingUndoStack = getRemainingUndoStack(undoStack, smartSolvePendingUndoMovesRef.current);
          if (autoCancelIfUndoHintQueueTooLong(remainingUndoStack)) return;
          setSmartSolveUndoDisplay(remainingUndoStack);
          setSmartSolveNotice(`继续撤销 ${remainingUndoStack[remainingUndoStack.length - 1] ?? expectedUndo}。`);
        } else {
          const pendingUndo = smartSolvePendingUndoMovesRef.current;
          animateUnplayedPendingMoves(pendingUndo, smartSolvePendingUndoAnimatedCountRef);
          smartSolvePendingUndoMovesRef.current = [];
          const nextUndoStack = appendUndoStackMoves(undoStack, pendingUndo);
          if (autoCancelIfUndoHintQueueTooLong(nextUndoStack)) return;
          smartSolveUndoStackRef.current = nextUndoStack;
          setSmartSolveUndoDisplay(smartSolveUndoStackRef.current);
          setSmartSolveNotice(
            smartSolveUndoStackRef.current.length === 0
              ? `已抵消，继续第 ${smartSolveIndexRef.current + 1} 步。`
              : `仍需撤销：请转 ${smartSolveUndoStackRef.current[smartSolveUndoStackRef.current.length - 1]}。`,
          );
          if (smartSolveUndoStackRef.current.length === 0) setSmartSolveWrong(false);
        }
        return;
      }

      const currentIndex = smartSolveIndexRef.current;
      const expected = steps[currentIndex];
      if (!expected) return;

      smartSolvePendingMovesRef.current = [...smartSolvePendingMovesRef.current, actual];
      if (movesMatchExpected(smartSolvePendingMovesRef.current, expected)) {
        const nextIndex = currentIndex + 1;
        animateUnplayedPendingMoves(smartSolvePendingMovesRef.current, smartSolvePendingAnimatedCountRef, expected);
        smartSolvePendingMovesRef.current = [];
        setSmartSolveStepStatus((prev) => prev.map((status, index) => (index === currentIndex ? "correct" : status)));
        setSmartSolveWrong(false);
        smartSolveIndexRef.current = nextIndex;
        setSmartSolveIndex(nextIndex);

        if (nextIndex >= steps.length) {
          smartSolveStatusRef.current = "done";
          setSmartSolveStatus("done");
          setSmartSolveNotice("智能求解完成，正在确认真实魔方复原状态。");
          void requestFacelets();
        } else {
          setSmartSolveNotice(`正确，下一步 ${nextIndex + 1}: ${steps[nextIndex]}`);
        }
      } else if (moveCanStillMatchExpected(smartSolvePendingMovesRef.current, expected)) {
        animateCubeMoves([actual]);
        smartSolvePendingAnimatedCountRef.current = smartSolvePendingMovesRef.current.length;
        setSmartSolveWrong(false);
        setSmartSolveStepStatus((prev) => prev.map((status, index) => (
          index === currentIndex
            ? movePartiallyMatchesExpectedDoubleTurn(smartSolvePendingMovesRef.current, expected)
              ? "partial"
              : "pending"
            : status
        )));
        setSmartSolveNotice(`继续完成第 ${currentIndex + 1} 步：${expected}`);
      } else {
        const pendingWrong = smartSolvePendingMovesRef.current;
        const { retainedMoves, wrongMoves } = splitInvalidPendingMoves(pendingWrong, expected);
        if (wrongMoves.length > 0) animateCubeMoves(wrongMoves);
        smartSolvePendingMovesRef.current = retainedMoves;
        smartSolvePendingAnimatedCountRef.current = retainedMoves.length;
        smartSolvePendingUndoMovesRef.current = [];
        smartSolvePendingUndoAnimatedCountRef.current = 0;
        setSmartSolveWrong(true);
        setSmartSolveStepStatus((prev) => prev.map((status, index) => (
          index === currentIndex
            ? movePartiallyMatchesExpectedDoubleTurn(retainedMoves, expected)
              ? "partial"
              : "pending"
            : status
        )));
        const nextUndoStack = buildUndoStack(wrongMoves);
        if (autoCancelIfUndoHintQueueTooLong(nextUndoStack)) return;
        smartSolveUndoStackRef.current = nextUndoStack;
        setSmartSolveUndoDisplay(smartSolveUndoStackRef.current);
        setSmartSolveNotice(
          smartSolveUndoStackRef.current.length === 0
            ? `已抵消，继续第 ${currentIndex + 1} 步。`
            : `转错了：请撤销 ${smartSolveUndoStackRef.current[smartSolveUndoStackRef.current.length - 1]}，再继续第 ${currentIndex + 1} 步。`,
        );
        if (smartSolveUndoStackRef.current.length === 0) setSmartSolveWrong(false);
      }
    },
    [animateCubeMoves, animateUnplayedPendingMoves, requestFacelets],
  );

  const clearVisualPendingTimer = useCallback(() => {
    if (visualPendingTimerRef.current === null) return;
    clearTimeout(visualPendingTimerRef.current);
    visualPendingTimerRef.current = null;
  }, []);

  const flushVisualPendingMove = useCallback(() => {
    const pending = visualPendingMoveRef.current;
    clearVisualPendingTimer();
    visualPendingMoveRef.current = null;
    if (pending) animateCubeMoves([pending]);
  }, [animateCubeMoves, clearVisualPendingTimer]);

  const syncVisualFacelets = useCallback(
    (nextFacelets: string) => {
      clearVisualPendingTimer();
      visualPendingMoveRef.current = null;
      if (cubeApiRef.current?.setFacelets(nextFacelets)) {
        lastAppliedFaceletsRef.current = nextFacelets;
      }
    },
    [clearVisualPendingTimer],
  );

  const queueVisualMove = useCallback(
    (move: string) => {
      const pending = visualPendingMoveRef.current;
      if (!pending) {
        visualPendingMoveRef.current = move;
        clearVisualPendingTimer();
        visualPendingTimerRef.current = setTimeout(flushVisualPendingMove, 45);
        return;
      }

      clearVisualPendingTimer();
      animateCubeMoves([pending]);
      visualPendingMoveRef.current = move;
      visualPendingTimerRef.current = setTimeout(flushVisualPendingMove, 45);
    },
    [animateCubeMoves, clearVisualPendingTimer, flushVisualPendingMove],
  );

  const handleScrambleMove = useCallback(
    (move: string, options: { animate?: boolean } = {}) => {
      const actual = normalizeMove(move);
      const undoStack = undoStackRef.current;
      const shouldAnimate = options.animate ?? true;

      if (undoStack.length > 0) {
        const expectedUndo = undoStack[undoStack.length - 1];
        pendingUndoMovesRef.current = [...pendingUndoMovesRef.current, actual];
        if (movesMatchExpected(pendingUndoMovesRef.current, expectedUndo)) {
          if (shouldAnimate) {
            animateUnplayedPendingMoves(pendingUndoMovesRef.current, pendingUndoAnimatedCountRef, expectedUndo);
          } else {
            pendingUndoAnimatedCountRef.current = 0;
          }
          pendingUndoMovesRef.current = [];
          undoStackRef.current = undoStack.slice(0, -1);
          setUndoDisplay(undoStackRef.current);
          setScrambleNotice(
            undoStackRef.current.length === 0
              ? `已撤销，继续第 ${scrambleIndexRef.current + 1} 步。`
              : `继续撤销 ${undoStackRef.current[undoStackRef.current.length - 1]}。`,
          );
          if (undoStackRef.current.length === 0) setScrambleWrong(false);
        } else if (moveCanStillMatchExpected(pendingUndoMovesRef.current, expectedUndo)) {
          if (shouldAnimate) animateCubeMoves([actual]);
          pendingUndoAnimatedCountRef.current = pendingUndoMovesRef.current.length;
          const remainingUndoStack = getRemainingUndoStack(undoStack, pendingUndoMovesRef.current);
          if (autoCancelIfUndoHintQueueTooLong(remainingUndoStack)) return;
          setUndoDisplay(remainingUndoStack);
          setScrambleNotice(`继续撤销 ${remainingUndoStack[remainingUndoStack.length - 1] ?? expectedUndo}。`);
        } else {
          const pendingUndo = pendingUndoMovesRef.current;
          if (shouldAnimate) {
            animateUnplayedPendingMoves(pendingUndo, pendingUndoAnimatedCountRef);
          } else {
            pendingUndoAnimatedCountRef.current = 0;
          }
          pendingUndoMovesRef.current = [];
          const nextUndoStack = appendUndoStackMoves(undoStack, pendingUndo);
          if (autoCancelIfUndoHintQueueTooLong(nextUndoStack)) return;
          undoStackRef.current = nextUndoStack;
          setUndoDisplay(undoStackRef.current);
          setScrambleNotice(
            undoStackRef.current.length === 0
              ? `已抵消，继续第 ${scrambleIndexRef.current + 1} 步。`
              : `仍需撤销：请转 ${undoStackRef.current[undoStackRef.current.length - 1]}。`,
          );
          if (undoStackRef.current.length === 0) setScrambleWrong(false);
        }
        return;
      }

      const currentIndex = scrambleIndexRef.current;
      const activeScramble = scrambleRef.current;
      const expected = activeScramble[currentIndex];
      pendingScrambleMovesRef.current = [...pendingScrambleMovesRef.current, actual];
      if (movesMatchExpected(pendingScrambleMovesRef.current, expected)) {
        const nextIndex = currentIndex + 1;
        if (shouldAnimate) {
          animateUnplayedPendingMoves(pendingScrambleMovesRef.current, pendingScrambleAnimatedCountRef, expected);
        } else {
          pendingScrambleAnimatedCountRef.current = 0;
        }
        pendingScrambleMovesRef.current = [];
        setScrambleStatus((prev) => prev.map((status, index) => (index === currentIndex ? "correct" : status)));
        setScrambleWrong(false);
        scrambleIndexRef.current = nextIndex;
        setScrambleIndex(nextIndex);

        if (nextIndex >= activeScramble.length) {
          setScrambleNotice(
            inspectionDurationMs === null
              ? "打乱完成，进入无限观察；转第一下开始复原计时。"
              : `打乱完成，进入 ${inspectionNoticeLabel}。`,
          );
          setInspectMs(inspectionDurationMs ?? 0);
          phaseRef.current = "inspect";
          setPhase("inspect");
          void requestFacelets();
        } else {
          setScrambleNotice(`正确，下一步 ${nextIndex + 1}: ${activeScramble[nextIndex]}`);
        }
      } else if (moveCanStillMatchExpected(pendingScrambleMovesRef.current, expected)) {
        if (shouldAnimate) animateCubeMoves([actual]);
        pendingScrambleAnimatedCountRef.current = pendingScrambleMovesRef.current.length;
        setScrambleWrong(false);
        setScrambleStatus((prev) => prev.map((status, index) => (
          index === currentIndex
            ? movePartiallyMatchesExpectedDoubleTurn(pendingScrambleMovesRef.current, expected)
              ? "partial"
              : "pending"
            : status
        )));
        setScrambleNotice(`继续完成第 ${currentIndex + 1} 步：${expected}`);
      } else {
        const pendingWrong = pendingScrambleMovesRef.current;
        const { retainedMoves, wrongMoves } = splitInvalidPendingMoves(pendingWrong, expected);
        if (shouldAnimate && wrongMoves.length > 0) animateCubeMoves(wrongMoves);
        pendingScrambleMovesRef.current = retainedMoves;
        pendingScrambleAnimatedCountRef.current = retainedMoves.length;
        pendingUndoMovesRef.current = [];
        pendingUndoAnimatedCountRef.current = 0;
        setScrambleWrong(true);
        setScrambleStatus((prev) => prev.map((status, index) => (
          index === currentIndex
            ? movePartiallyMatchesExpectedDoubleTurn(retainedMoves, expected)
              ? "partial"
              : "pending"
            : status
        )));
        const nextUndoStack = buildUndoStack(wrongMoves);
        if (autoCancelIfUndoHintQueueTooLong(nextUndoStack)) return;
        undoStackRef.current = nextUndoStack;
        setUndoDisplay(undoStackRef.current);
        setScrambleNotice(
          undoStackRef.current.length === 0
            ? `已抵消，继续第 ${currentIndex + 1} 步。`
            : `转错了：请撤销 ${undoStackRef.current[undoStackRef.current.length - 1]}，再继续第 ${currentIndex + 1} 步。`,
        );
        if (undoStackRef.current.length === 0) setScrambleWrong(false);
      }
    },
    [animateCubeMoves, animateUnplayedPendingMoves, inspectionDurationMs, inspectionNoticeLabel, requestFacelets],
  );

  const handleFreePracticeMove = useCallback(
    (notation: string) => {
      const parsed = parseMoveNotation(notation);
      if (!parsed) return;

      if (freeStateRef.current === "waitingSolved") {
        queueVisualMove(parsed.notation);
        requestFaceletsThrottled();
        setFreeNotice("仍需先确认复原态；如果已经复原，请稍等 facelets 同步。");
        return;
      }

      if (freeStateRef.current === "ready") {
        updateSolveMs(0);
        phaseRef.current = "idle";
        setPhase("idle");
        freeScrambleMoveCountRef.current = 1;
        setFreeScrambleMoveCount(1);
        setFreePracticeState("scrambling");
        setFreeNotice("自由打乱中。停手后静止进度会自动推进。");
        queueVisualMove(parsed.notation);
        requestFaceletsThrottled();
        scheduleFreeIdleCheck();
        return;
      }

      if (freeStateRef.current === "scrambling") {
        freeScrambleMoveCountRef.current += 1;
        setFreeScrambleMoveCount(freeScrambleMoveCountRef.current);
        setFreePracticeState("scrambling");
        setFreeNotice("自由打乱中。停手后静止进度会自动推进。");
        queueVisualMove(parsed.notation);
        requestFaceletsThrottled();
        scheduleFreeIdleCheck();
        return;
      }

      flushVisualPendingMove();
      queueVisualMove(parsed.notation);
      clearFreeTimers();
      setFreeNotice("自由复原计时中。复原成功后自动结束。");
      beginSolveTimer(parsed.notation);
    },
    [
      beginSolveTimer,
      clearFreeTimers,
      flushVisualPendingMove,
      queueVisualMove,
      requestFaceletsThrottled,
      scheduleFreeIdleCheck,
      setFreePracticeState,
      updateSolveMs,
    ],
  );

  const ingestMove = useCallback(
    (notation: string, signal?: CubeMoveSignal) => {
      const parsed = parseMoveNotation(notation);
      if (!parsed || !cubeApiRef.current) return;

      if (shouldIgnoreInitialPostSolveMove(signal)) return false;

      if (
        phaseRef.current === "done" &&
        autoNextScrambleTimerRef.current === null &&
        performance.now() < suppressSolvedTrailingMoveUntilRef.current &&
        isSolvedFacelets(faceletsRef.current)
      ) {
        requestFaceletsThrottled();
        return false;
      }

      hasRealtimeMovesRef.current = true;
      appendMoveLog(parsed.notation, !gyroDisabledRef.current);

      if (smartSolveStatusRef.current === "active") {
        flushVisualPendingMove();
        handleSmartSolveMove(parsed.notation);
        return;
      }

      if (smartSolveStatusRef.current === "loading") {
        queueVisualMove(parsed.notation);
        requestFaceletsThrottled();
        return;
      }

      if (
        phaseRef.current === "done" &&
        practiceModeRef.current === "scramble" &&
        autoNextScrambleTimerRef.current !== null
      ) {
        pendingAutoNextScrambleMovesRef.current = [...pendingAutoNextScrambleMovesRef.current, parsed.notation];
        queueVisualMove(parsed.notation);
        requestFaceletsThrottled();
        return;
      }

      if (practiceModeRef.current === "free" && phaseRef.current !== "solving") {
        handleFreePracticeMove(notation);
        return;
      }

      if (phaseRef.current === "scrambling") {
        flushVisualPendingMove();
        handleScrambleMove(notation);
      } else if (phaseRef.current === "inspect") {
        flushVisualPendingMove();
        queueVisualMove(parsed.notation);
        startSolving(parsed.notation);
      } else if (phaseRef.current === "solving") {
        queueVisualMove(parsed.notation);
        recordSolveMove(parsed.notation);
        requestFaceletsThrottled();
      } else {
        queueVisualMove(parsed.notation);
      }
    },
    [
      flushVisualPendingMove,
      handleFreePracticeMove,
      handleScrambleMove,
      handleSmartSolveMove,
      appendMoveLog,
      queueVisualMove,
      requestFaceletsThrottled,
      recordSolveMove,
      shouldIgnoreInitialPostSolveMove,
      startSolving,
    ],
  );

  const handleFacelets = useCallback(
    (nextFacelets: string, signal?: CubeFaceletsSignal) => {
      faceletsRef.current = nextFacelets;
      if (signal?.source !== "local") {
        clearSmartSolveFaceletsWait(nextFacelets);
      }

      if (forceNextVisualFaceletsSyncRef.current) {
        forceNextVisualFaceletsSyncRef.current = false;
        syncVisualFacelets(nextFacelets);
      }

      if (smartSolveStatusRef.current !== "idle") {
        if (smartSolveStatusRef.current === "done") {
          setSmartSolveNotice(
            isSolvedFacelets(nextFacelets)
              ? "智能求解完成，真实魔方已复原。"
              : "公式已走完，但真实魔方仍未确认复原；请重新同步后再次求解。",
          );
        }
        return;
      }

      if (practiceModeRef.current === "free" && phaseRef.current !== "solving") {
        if (confirmFreeScrambleIdle(nextFacelets)) return;
        const solved = isSolvedFacelets(nextFacelets);
        if (freeStateRef.current === "waitingSolved") {
          freeScrambleMoveCountRef.current = 0;
          setFreeScrambleMoveCount(0);
          if (solved) {
            setFreeIdleMsLeft(FREE_SCRAMBLE_IDLE_MS);
            setFreePracticeState("ready");
            setFreeNotice("魔方已复原。可自由打乱，停手后静止进度会自动推进。");
          } else {
            setFreeIdleMsLeft(0);
            setFreePracticeState("armed");
            setFreeNotice("当前为非复原态，转任意面开始复原计时。");
          }
        } else if (freeStateRef.current === "ready" && !solved) {
          if (freeScrambleMoveCountRef.current > 0) {
            setFreePracticeState("armed");
            setFreeIdleMsLeft(0);
            setFreeNotice("打乱完成。转第一下开始复原计时。");
          } else {
            setFreePracticeState("armed");
            setFreeIdleMsLeft(0);
            setFreeNotice("当前为非复原态，转任意面开始复原计时。");
          }
        } else if (freeStateRef.current === "armed" && solved) {
          freeScrambleMoveCountRef.current = 0;
          setFreeScrambleMoveCount(0);
          setFreeIdleMsLeft(FREE_SCRAMBLE_IDLE_MS);
          setFreePracticeState("ready");
          setFreeNotice("检测到魔方已复原，本次自由练习未开始计时。");
        }
        return;
      }

      if (phaseRef.current !== "solving") return;
      const solved = isSolvedFacelets(nextFacelets);
      markCfopTimes(nextFacelets, solved);
      if (solved) {
        syncVisualFacelets(nextFacelets);
        suppressSolvedTrailingMoveUntilRef.current = performance.now() + SOLVED_TRAILING_MOVE_SUPPRESS_MS;
        if (signal && Number.isFinite(signal.serial)) armPostSolveMoveGate(signal.serial);
        finishSolve("auto");
      }
    },
    [
      armPostSolveMoveGate,
      clearSmartSolveFaceletsWait,
      confirmFreeScrambleIdle,
      finishSolve,
      markCfopTimes,
      setFreePracticeState,
      syncVisualFacelets,
    ],
  );

  const applyGyroOrientation = useCallback((quaternion: CubeQuaternion) => {
    if (gyroDisabledRef.current) return;
    cubeApiRef.current?.setGyroOrientation(quaternion);
  }, []);

  const getInitialVisualCubeState = useCallback(() => {
    const visualStateSnapshot = visualStateRef.current;
    const baseFacelets = visualStateSnapshot.baseFacelets ?? faceletsRef.current;
    if (!baseFacelets) return { facelets: null, moves: [] };

    lastAppliedFaceletsRef.current = baseFacelets;
    const restoredMoves = visualStateSnapshot.baseFacelets ? visualStateSnapshot.moves : [];
    const expandedMoves = restoredMoves.flatMap((move) => expandMoveNotation(move.move));
    return { facelets: baseFacelets, moves: expandedMoves };
  }, []);

  useEffect(() => {
    if (!cubeMountRef.current) return;
    const initialDisplayState = loadPracticeDisplayState();
    setViewResetEnabled(initialDisplayState ? !isDefaultDisplayState(initialDisplayState) : false);
    const initialVisualState = getInitialVisualCubeState();
    const initialGyroQuaternion = loadPracticeGyroDisabled() ? null : getLatestGyro();
    const api = mountSmartCube(cubeMountRef.current, {
      faceColors,
      orientation,
      maxFps: renderMaxFps,
      showBackFaceProjection: backFaceProjectionEnabled,
      backFaceProjectionDistance,
      compensateInitialGyroOffset: false,
      defaultDisplayState: PRACTICE_CUBE_CAMERA_PRESET.displayState,
      sceneOffset: PRACTICE_CUBE_CAMERA_PRESET.sceneOffset,
      initialFacelets: initialVisualState.facelets,
      initialMoves: initialVisualState.moves,
      initialGyroQuaternion,
      initialDisplayState,
      onDisplayOrientationChange: () => {
        const displayState = cubeApiRef.current?.getDisplayState();
        savePracticeDisplayState(displayState ?? null);
        setViewResetEnabled(displayState ? !isDefaultDisplayState(displayState) : false);
      },
    });
    cubeApiRef.current = api;
    if (smartSolveStatusRef.current === "active") {
      api.setHintMove(getSmartSolveHintMove());
    } else if (phaseRef.current === "scrambling") {
      api.setHintMove(getScrambleHintMove());
    }

    return () => {
      savePracticeDisplayState(api.getDisplayState());
      api.dispose();
      if (cubeApiRef.current === api) cubeApiRef.current = null;
    };
  }, [faceColors, orientation, renderMaxFps, backFaceProjectionEnabled, backFaceProjectionDistance, getInitialVisualCubeState, getLatestGyro]);

  useEffect(() => {
    cubeApiRef.current?.setBackFaceProjectionDistance(backFaceProjectionDistance);
  }, [backFaceProjectionDistance]);

  useEffect(() => {
    if (!facelets || phaseRef.current === "solving") return;
    if (facelets === lastAppliedFaceletsRef.current) return;
    if (hasRealtimeMovesRef.current) return;
    if (cubeApiRef.current?.setFacelets(facelets)) {
      lastAppliedFaceletsRef.current = facelets;
    }
  }, [facelets]);

  useEffect(() => subscribeMove(ingestMove), [ingestMove, subscribeMove]);

  useEffect(() => {
    if (connectionState === "connected") return;
    if (smartSolveStatusRef.current === "loading" || smartSolveStatusRef.current === "active") {
      failSmartSolve("智能魔方连接已断开，智能求解已停止。");
    }
    if (practiceModeRef.current === "free") {
      resetFreeReadiness(null);
    }
  }, [connectionState, failSmartSolve, resetFreeReadiness]);

  useEffect(() => {
    if (gyroDisabled) return;
    return subscribeGyro(applyGyroOrientation);
  }, [applyGyroOrientation, subscribeGyro, gyroDisabled]);

  useEffect(() => subscribeFacelets(handleFacelets), [handleFacelets, subscribeFacelets]);

  useEffect(() => {
    if (phase !== "inspect") return;
    if (inspectionDurationMs === null) {
      setInspectMs(0);
      cancelInspectionAudio();
      return () => cancelInspectionAudio();
    }
    const start = performance.now();
    scheduleInspectionAudio(start, inspectionDurationMs);
    const id = setInterval(() => {
      const left = inspectionDurationMs - (performance.now() - start);
      if (left <= 0) {
        clearInterval(id);
        setInspectMs(0);
        inspectionEndCueUntilRef.current = performance.now() + INSPECTION_END_CUE_PRESERVE_MS;
        playInspectionBeep("bright");
        startSolving(null, true);
      } else {
        setInspectMs(left);
      }
    }, 50);
    return () => {
      clearInterval(id);
      cancelInspectionAudio(performance.now() < inspectionEndCueUntilRef.current);
    };
  }, [cancelInspectionAudio, inspectionDurationMs, phase, playInspectionBeep, scheduleInspectionAudio, startSolving]);

  function getSmartSolveHintMove() {
    const undoNext = smartSolveUndoStackRef.current[smartSolveUndoStackRef.current.length - 1];
    if (undoNext) return hintMoveForDoubleTurnProgress(smartSolvePendingUndoMovesRef.current, undoNext);
    const expected = smartSolveStepsRef.current[smartSolveIndexRef.current];
    return expected ? hintMoveForDoubleTurnProgress(smartSolvePendingMovesRef.current, expected) : null;
  }

  function getScrambleHintMove() {
    const undoNext = undoStackRef.current[undoStackRef.current.length - 1];
    if (undoNext) return hintMoveForDoubleTurnProgress(pendingUndoMovesRef.current, undoNext);
    const expected = scrambleRef.current[scrambleIndexRef.current];
    return expected ? hintMoveForDoubleTurnProgress(pendingScrambleMovesRef.current, expected) : null;
  }

  useEffect(() => {
    const smartSolveNext = smartSolveStatus === "active"
      ? getSmartSolveHintMove()
      : null;
    const scrambleNext = phase === "scrambling"
      ? getScrambleHintMove()
      : null;
    const next = smartSolveNext ?? scrambleNext;
    cubeApiRef.current?.setHintMove(next);
  }, [phase, scrambleIndex, scrambleStatus, smartSolveIndex, smartSolveStatus, smartSolveStepStatus, smartSolveUndoDisplay, undoDisplay]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== " " && key !== "q" && key !== "r" && key !== "l") return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTextEntryTarget(event.target)) return;

      event.preventDefault();
      if (key === "r") {
        if (canResetDisplayOrientation) resetDisplayOrientation();
        return;
      }
      if (key === "l") {
        toggleGyroDisabled();
        return;
      }
      if (key === "q") {
        if (smartSolveStatusRef.current !== "loading") void beginSmartSolve();
        return;
      }

      if (smartSolveStatusRef.current === "loading" || smartSolveStatusRef.current === "active") return;
      if (phase === "idle" || phase === "done") {
        if (practiceModeRef.current === "scramble") {
          beginScramble();
        } else {
          void requestFacelets();
        }
      } else if (phase === "scrambling" || phase === "inspect") {
        cancelCurrentAttempt();
      } else if (phase === "solving") {
        cancelCurrentAttempt();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    return () => {
      cancelInspectionAudio();
      clearSolveTick();
      clearFreeTimers();
      clearVisualPendingTimer();
      clearAutoNextScrambleTimer();
      clearPendingAutoNextScrambleMoves();
      clearSmartSolveFaceletsWait();
      if (historyScrollTimerRef.current) {
        clearTimeout(historyScrollTimerRef.current);
      }
    };
  }, [
    cancelInspectionAudio,
    clearAutoNextScrambleTimer,
    clearPendingAutoNextScrambleMoves,
    clearFreeTimers,
    clearSolveTick,
    clearSmartSolveFaceletsWait,
    clearVisualPendingTimer,
  ]);

  async function startConnection() {
    await connectRealCube();
  }

  function clearMoveLog() {
    resetTrackedCubeState();
    resetMoveLog();
  }

  function handleHistoryScroll() {
    setHistoryScrolling(true);
    if (historyScrollTimerRef.current) {
      clearTimeout(historyScrollTimerRef.current);
    }
    historyScrollTimerRef.current = setTimeout(() => {
      historyScrollTimerRef.current = null;
      setHistoryScrolling(false);
    }, 900);
  }

  function requestDeleteHistoryEntry(
    historyIndex: number,
    entry: SolveHistoryEntry,
    historyNumber: number,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const popoverWidth = 220;
    const margin = 12;
    const left = Math.min(
      window.innerWidth - popoverWidth - margin,
      Math.max(margin, rect.right - popoverWidth),
    );
    setHistoryCfopTip(null);
    setPendingHistoryDelete({
      historyIndex,
      entryTs: entry.ts,
      historyNumber,
      ms: entry.ms,
      left,
      top: rect.bottom + 12,
      arrowLeft: Math.min(popoverWidth - 22, Math.max(22, rect.left + rect.width / 2 - left)),
    });
  }

  function cancelPendingHistoryDelete() {
    setPendingHistoryDelete(null);
  }

  function confirmPendingHistoryDelete() {
    const pending = pendingHistoryDelete;
    if (!pending) return;
    setHistoryCfopTip(null);
    const currentHistory = historyRef.current;
    if (currentHistory[pending.historyIndex]?.ts !== pending.entryTs) {
      setPendingHistoryDelete(null);
      return;
    }
    if (currentHistory.length <= 1) setHistoryEditing(false);
    commitSolveHistory(currentHistory.filter((_, index) => index !== pending.historyIndex));
    setPendingHistoryDelete(null);
  }

  function toggleHistoryEditing() {
    setHistoryCfopTip(null);
    setHistoryEditing((current) => !current);
  }

  async function copyMoveLog() {
    if (moveLog.length === 0) return;
    await navigator.clipboard.writeText(moveLog.map((move) => move.m).join(" "));
  }

  function resetDisplayOrientation() {
    cubeApiRef.current?.resetDisplayOrientation();
    savePracticeDisplayState(null);
    setViewResetEnabled(false);
  }

  function clearGyroCostNoticeTimers() {
    if (gyroCostNoticeFadeTimerRef.current !== null) {
      window.clearTimeout(gyroCostNoticeFadeTimerRef.current);
      gyroCostNoticeFadeTimerRef.current = null;
    }
    if (gyroCostNoticeTimerRef.current !== null) {
      window.clearTimeout(gyroCostNoticeTimerRef.current);
      gyroCostNoticeTimerRef.current = null;
    }
  }

  function hideGyroCostNotice() {
    clearGyroCostNoticeTimers();
    setGyroCostNoticeFading(false);
    setGyroCostNoticeVisible(false);
  }

  function showGyroCostNotice() {
    clearGyroCostNoticeTimers();
    setGyroCostNoticeFading(false);
    setGyroCostNoticeVisible(true);
    gyroCostNoticeFadeTimerRef.current = window.setTimeout(() => {
      gyroCostNoticeFadeTimerRef.current = null;
      setGyroCostNoticeFading(true);
    }, 2000);
    gyroCostNoticeTimerRef.current = window.setTimeout(() => {
      gyroCostNoticeTimerRef.current = null;
      setGyroCostNoticeFading(false);
      setGyroCostNoticeVisible(false);
    }, 4000);
  }

  function toggleGyroDisabled() {
    const next = !gyroDisabledRef.current;
    gyroDisabledRef.current = next;
    setGyroDisabled(next);
    if (next) {
      const displayState = cubeApiRef.current?.getDisplayState();
      cubeApiRef.current?.resetGyroOrientation();
      setViewResetEnabled(displayState ? !isDefaultDisplayState(displayState) : false);
      hideGyroCostNotice();
    }
    if (!next) showGyroCostNotice();
    savePracticeGyroDisabled(next);
  }

  function cancelSmartSolve() {
    resetSmartSolveState();
    cubeApiRef.current?.setHintMove(null);
    if (practiceModeRef.current === "free") {
      resetFreeReadiness();
    }
  }

  async function beginSmartSolve() {
    if (!isConnected) {
      failSmartSolve("请先连接智能魔方，再使用智能求解。");
      return;
    }

    dailyTestRef.current = null;
    setDailyTest(null);
    resetAttempt();
    smartSolveStatusRef.current = "loading";
    smartSolveStepsRef.current = [];
    smartSolveIndexRef.current = 0;
    setSmartSolveStatus("loading");
    setSmartSolveSteps([]);
    setSmartSolveIndex(0);
    setSmartSolveStepStatus([]);
    setSmartSolveWrong(false);
    setSmartSolveUndoDisplay([]);
    setSmartSolveNotice("正在同步真实魔方状态并计算复原公式。");

    const faceletsPromise = waitForSmartSolveFacelets();
    await requestFacelets();
    const latestFacelets = (await faceletsPromise) ?? faceletsRef.current;

    if (smartSolveStatusRef.current !== "loading") return;
    if (!latestFacelets) {
      failSmartSolve("未收到真实魔方状态，请确认连接稳定后再试。");
      return;
    }

    try {
      const steps = (await solveFacelets(latestFacelets)).map((move) => mapMoveToOrientation(move, orientation));
      if (smartSolveStatusRef.current !== "loading") return;
      smartSolveStatusRef.current = "active";
      smartSolveStepsRef.current = steps;
      smartSolveIndexRef.current = 0;
      smartSolvePendingMovesRef.current = [];
      smartSolvePendingAnimatedCountRef.current = 0;
      smartSolvePendingUndoMovesRef.current = [];
      smartSolvePendingUndoAnimatedCountRef.current = 0;
      smartSolveUndoStackRef.current = [];
      setSmartSolveStatus("active");
      setSmartSolveSteps(steps);
      setSmartSolveIndex(0);
      setSmartSolveStepStatus(freshSmartSolveStatus(steps.length));
      setSmartSolveWrong(false);
      setSmartSolveUndoDisplay([]);
      setSmartSolveNotice(`已生成 ${steps.length} 步复原公式，请转第 1 步：${steps[0]}`);
      if (cubeApiRef.current?.setFacelets(latestFacelets)) {
        lastAppliedFaceletsRef.current = latestFacelets;
        hasRealtimeMovesRef.current = false;
      }
    } catch (error) {
      failSmartSolve(error instanceof Error ? error.message : "求解失败，请重新同步魔方状态后再试。");
    }
  }

  function resetAttempt(
    nextScramble = scramble,
    options: { preservePostSolveMoveGate?: boolean; preserveAutoNextScrambleMoves?: boolean } = {},
  ) {
    resetSmartSolveState();
    cancelInspectionAudio();
    clearSolveTick();
    clearFreeTimers();
    clearAutoNextScrambleTimer();
    flushVisualPendingMove();
    if (!options.preservePostSolveMoveGate) clearPostSolveMoveGate();
    if (!options.preserveAutoNextScrambleMoves) clearPendingAutoNextScrambleMoves();
    phaseRef.current = "idle";
    scrambleIndexRef.current = 0;
    scrambleRef.current = nextScramble;
    pendingScrambleMovesRef.current = [];
    pendingScrambleAnimatedCountRef.current = 0;
    pendingUndoMovesRef.current = [];
    pendingUndoAnimatedCountRef.current = 0;
    forceNextVisualFaceletsSyncRef.current = false;
    suppressSolvedTrailingMoveUntilRef.current = 0;
    undoStackRef.current = [];
    setUndoDisplay([]);
    solveStartRef.current = 0;
    setPhase("idle");
    setScramble(nextScramble);
    setScrambleIndex(0);
    setScrambleStatus(freshScrambleStatus());
    setScrambleWrong(false);
    setScrambleNotice("点击开始打乱后，按公式转动真实魔方。");
    setInspectMs(inspectionDurationMs ?? 0);
    if (practiceModeRef.current === "free") {
      resetFreeReadiness();
    }
  }

  function cancelCurrentAttempt() {
    if (!dailyTestRef.current) {
      resetAttempt();
      return;
    }
    const completedCount = dailyTestRef.current.solves.length;
    dailyTestRef.current = null;
    setDailyTest(null);
    resetAttempt();
    setScrambleNotice(
      completedCount > 0
        ? `已取消每日五次测试，已完成的 ${completedCount} 次已保留在历史中。`
        : "已取消每日五次测试。",
    );
  }

  function autoCancelIfUndoHintQueueTooLong(undoQueue: string[]) {
    if (undoQueue.length <= MAX_UNDO_HINT_QUEUE_LENGTH) return false;
    cancelCurrentAttempt();
    setScrambleNotice("撤销提示过长，已自动取消当前练习，请重新尝试。");
    return true;
  }

  function cancelFreePractice() {
    if (practiceModeRef.current !== "free") return;
    clearFreeTimers();
    practiceModeRef.current = "scramble";
    setPracticeMode("scramble");
    resetAttempt();
  }

  function startScrambleAttempt(preservePostSolveMoveGate: boolean) {
    if (!isConnectedRef.current) {
      setScrambleNotice("请先连接智能魔方。");
      return;
    }
    warmInspectionAudio();
    const nextScramble = generateScramble(SCRAMBLE_LENGTH);
    resetAttempt(nextScramble, {
      preservePostSolveMoveGate,
      preserveAutoNextScrambleMoves: preservePostSolveMoveGate,
    });
    setPhase("scrambling");
    phaseRef.current = "scrambling";
    const activeDailyTest = dailyTestRef.current;
    const prefix = activeDailyTest ? `每日五次测试 ${activeDailyTest.solves.length + 1}/${DAILY_TEST_TARGET}：` : "";
    setScrambleNotice(`${prefix}请转第 1 步：${nextScramble[0]}`);
    void requestFacelets();
    if (preservePostSolveMoveGate && pendingAutoNextScrambleMovesRef.current.length > 0) {
      const pendingMoves = pendingAutoNextScrambleMovesRef.current;
      pendingAutoNextScrambleMovesRef.current = [];
      pendingMoves.forEach((move) => handleScrambleMove(move, { animate: false }));
    }
  }

  function beginScramble() {
    startScrambleAttempt(false);
  }

  function beginAutoNextScramble() {
    startScrambleAttempt(true);
  }

  function startDailyLevelTest(localDate = getDailyTestDateKey()) {
    if (!isConnected) {
      setScrambleNotice("请先连接智能魔方。");
      return;
    }
    if (dailyLevels.some((entry) => entry.localDate === localDate)) {
      setScrambleNotice(localDate === getDailyTestDateKey() ? "今日测试已完成，明天再来。" : "该日期测试已完成。");
      return;
    }
    const canStartFromScramble =
      practiceModeRef.current === "scramble" &&
      (phaseRef.current === "idle" || phaseRef.current === "done" || phaseRef.current === "scrambling" || phaseRef.current === "inspect");
    const canStartFromFree = practiceModeRef.current === "free" && phaseRef.current !== "solving";
    if (dailyTestRef.current || smartSolveBusy || (!canStartFromScramble && !canStartFromFree)) return;
    const run: DailyTestRun = {
      id: `daily-${localDate}-${Date.now()}`,
      localDate,
      solves: [],
    };
    clearFreeTimers();
    practiceModeRef.current = "scramble";
    setPracticeMode("scramble");
    dailyTestRef.current = run;
    setDailyTest(run);
    beginScramble();
  }

  function regenerateScramble() {
    resetAttempt(generateScramble(SCRAMBLE_LENGTH));
  }

  function changePracticeMode(nextMode: PracticeMode) {
    if (practiceModeRef.current === nextMode) return;
    if (dailyTestRef.current || smartSolveBusy) return;
    if (
      phaseRef.current !== "idle" &&
      phaseRef.current !== "done" &&
      !(practiceModeRef.current === "scramble" && nextMode === "free" && (phaseRef.current === "scrambling" || phaseRef.current === "inspect"))
    ) {
      return;
    }

    if (practiceModeRef.current === "free" && nextMode === "scramble") {
      cancelFreePractice();
      return;
    }

    practiceModeRef.current = nextMode;
    setPracticeMode(nextMode);
    resetAttempt();
    if (nextMode === "free") {
      void requestFacelets();
    }
  }

  function showHistoryCfopTip(
    target: HTMLElement,
    entry: SolveHistoryEntry,
    historyNumber: number,
    pointer?: { x: number; y: number },
  ) {
    const rect = target.getBoundingClientRect();
    const anchorX = pointer?.x ?? rect.left + rect.width / 2;
    const anchorY = pointer?.y ?? rect.top + rect.height / 2;
    const fixedRightLeft = Math.max(HISTORY_CFOP_TIP_MARGIN, window.innerWidth - HISTORY_CFOP_TIP_WIDTH - HISTORY_CFOP_TIP_MARGIN);
    const maxTop = Math.max(HISTORY_CFOP_TIP_MARGIN, window.innerHeight - HISTORY_CFOP_TIP_HEIGHT - HISTORY_CFOP_TIP_MARGIN);
    const placement =
      anchorY > HISTORY_CFOP_TIP_HEIGHT + HISTORY_CFOP_TIP_GAP + HISTORY_CFOP_TIP_MARGIN ? "above" : "below";
    const left = fixedRightLeft;
    const idealTop = placement === "above"
      ? anchorY - HISTORY_CFOP_TIP_HEIGHT - HISTORY_CFOP_TIP_GAP
      : anchorY + HISTORY_CFOP_TIP_GAP;
    const top = Math.min(maxTop, Math.max(HISTORY_CFOP_TIP_MARGIN, idealTop));
    const arrowLeft = Math.min(HISTORY_CFOP_TIP_WIDTH - 22, Math.max(22, anchorX - left));
    setHistoryCfopTip({
      entry,
      historyNumber,
      left,
      top,
      arrowLeft,
      placement,
    });
  }

  const stats = useMemo(() => {
    if (history.length === 0) return { best: null, avg5: null, avg20: null, count: 0 };
    const ms = history.map((entry) => entry.ms);
    const avg = (arr: number[]) => {
      if (arr.length < 3) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const trimmed = sorted.slice(1, -1);
      return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    };
    const avg20 = history.length >= averageSettings.sampleSize
      ? calculateAverageTime(history.slice(0, averageSettings.sampleSize).toReversed().map((entry) => entry.ms), averageSettings)?.valueMs ?? null
      : null;
    return {
      best: Math.min(...ms),
      avg5: history.length >= 5 ? avg(ms.slice(0, 5)) : null,
      avg20,
      count: history.length,
    };
  }, [averageSettings, history]);
  const recentHistory = useMemo(() => history.slice(0, 20), [history]);
  const recentSlowest = useMemo(
    () => (recentHistory.length === 0 ? 0 : Math.max(...recentHistory.map((entry) => entry.ms))),
    [recentHistory],
  );
  const isConnected = connectionState === "connected";
  const todayLocalDate = getDailyTestDateKey();
  const yesterdayLocalDate = getYesterdayDailyTestDateKey();
  const todayDailyLevel = useMemo(
    () => dailyLevels.find((entry) => entry.localDate === todayLocalDate) ?? null,
    [dailyLevels, todayLocalDate],
  );
  const yesterdayDailyLevel = useMemo(
    () => dailyLevels.find((entry) => entry.localDate === yesterdayLocalDate) ?? null,
    [dailyLevels, yesterdayLocalDate],
  );
  const dailyTestProgress = dailyTest?.solves.length ?? 0;
  const dailyTestDisplayDate = dailyTest?.localDate ?? todayLocalDate;
  const dailyTestDisplaySolves = dailyTest?.solves ?? todayDailyLevel?.solves ?? [];
  const smartSolveVisible = smartSolveStatus !== "idle";
  const smartSolveBusy = smartSolveStatus === "loading" || smartSolveStatus === "active";
  const canInterruptScrambleAttempt = practiceMode === "scramble" && (phase === "scrambling" || phase === "inspect");
  const canStartDailyTestFromScramble = practiceMode === "scramble" && (phase === "idle" || phase === "done" || canInterruptScrambleAttempt);
  const canStartDailyTestFromFree = practiceMode === "free" && phase !== "solving";
  const canSwitchMode = !dailyTest && !smartSolveBusy && (phase === "idle" || phase === "done" || canInterruptScrambleAttempt);
  const canStartDailyTestSession = isConnected && !dailyTest && !smartSolveBusy && (canStartDailyTestFromScramble || canStartDailyTestFromFree);
  const canStartTodayDailyTest = !todayDailyLevel && canStartDailyTestSession;
  const showYesterdayMakeupTest = !todayDailyLevel && !yesterdayDailyLevel;
  const canStartYesterdayMakeupTest = showYesterdayMakeupTest && canStartDailyTestSession;
  const freeIdleProgress = freeState === "armed"
    ? 1
    : freeState === "scrambling"
      ? Math.min(
          1,
          Math.max(
            0,
            (FREE_SCRAMBLE_IDLE_MS - freeIdleMsLeft - FREE_SCRAMBLE_FILL_DELAY_MS) / FREE_SCRAMBLE_FILL_MS,
          ),
        )
      : 0;
  const freeStateLabel: Record<FreePracticeState, string> = {
    waitingSolved: "同步状态 · SYNC STATE",
    ready: "自由打乱待命 · FREE READY",
    scrambling: "自由打乱中 · IDLE CHECK",
    armed: "等待第一步 · FREE ARMED",
  };
  const timerPhaseLabel = smartSolveBusy
    ? "智能求解 · SMART SOLVE"
    : practiceMode === "free"
    ? phase === "solving"
      ? "自由复原 · SOLVING"
      : phase === "done"
        ? "完成 · FREE COMPLETE"
        : freeStateLabel[freeState]
    : phase === "idle"
      ? "准备 · READY"
      : phase === "scrambling"
        ? "打乱校验 · SCRAMBLING"
        : phase === "inspect"
          ? "观察 · INSPECTION"
          : phase === "solving"
            ? "解算中 · SOLVING"
            : "完成 · COMPLETE";

  const undoExpected = undoStackRef.current[undoStackRef.current.length - 1];
  const smartSolveUndoExpected = smartSolveUndoDisplay[smartSolveUndoDisplay.length - 1];
  const smartSolveCounterValue = smartSolveSteps.length === 0
    ? 0
    : Math.min(smartSolveSteps.length, smartSolveIndex + (smartSolveStatus === "done" ? 0 : 1));
  const stableScoreDescription = describeAverageTimeSettings(averageSettings);

  const dailyTestAverageLabel = todayDailyLevel ? fmtShort(todayDailyLevel.averageMs) : null;
  return (
    <div className="app lf-practice-app">
      <AppTopbar />

      <main className="practice-layout">
        <section className="practice-left">
          <div className="practice-card daily-test-card">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">每日测试</div>
                <div className="practice-kicker">DAILY TEST</div>
              </div>
              <div className="dt-date" tabIndex={0} aria-label={`${dailyTestDisplayDate}，每日 00:00 更新`}>
                {dailyTestDisplayDate}
              </div>
            </div>
            <div className="dt-progress" aria-label="每日五次测试进度">
              {Array.from({ length: DAILY_TEST_TARGET }, (_, index) => {
                const solve = dailyTestDisplaySolves[index];
                return (
                  <span key={index} className={`dt-step${solve ? " done" : ""}`}>
                    <span className="dt-step-time">{solve ? fmtShort(solve.ms) : "待测"}</span>
                  </span>
                );
              })}
            </div>
            <div className={`dt-actions${!dailyTest && showYesterdayMakeupTest ? " dt-actions-split" : ""}`}>
              {!dailyTest && (
                showYesterdayMakeupTest ? (
                  <>
                    <button
                      className="practice-btn practice-btn-ghost"
                      onClick={() => startDailyLevelTest(yesterdayLocalDate)}
                      disabled={!canStartYesterdayMakeupTest}
                    >
                      补测昨日成绩
                    </button>
                    <button
                      className="practice-btn practice-btn-primary"
                      onClick={() => startDailyLevelTest(todayLocalDate)}
                      disabled={!canStartTodayDailyTest}
                    >
                      开始今日测试
                    </button>
                  </>
                ) : (
                  <button
                    className="practice-btn practice-btn-primary"
                    onClick={() => startDailyLevelTest(todayLocalDate)}
                    disabled={Boolean(todayDailyLevel) || !canStartTodayDailyTest}
                  >
                    {todayDailyLevel && dailyTestAverageLabel ? `今日平均用时 ${dailyTestAverageLabel}` : "开始今日测试"}
                  </button>
                )
              )}
              {dailyTest && (
                <button className="practice-btn practice-btn-ghost" onClick={cancelCurrentAttempt}>
                  取消测试
                </button>
              )}
            </div>
          </div>

          <div className="stats">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">统计摘要</div>
                <div className="practice-kicker">SUMMARY</div>
              </div>
            </div>
            <div className="stat-grid">
              <div className="st st-primary"><div className="st-l">总次数 TOTAL</div><div className="st-v">{stats.count}</div></div>
              <div className="st"><div className="st-l">最佳 BEST</div><div className="st-v">{fmtShort(stats.best)}</div></div>
              <div className="st"><div className="st-l">AO5</div><div className="st-v">{fmtShort(stats.avg5)}</div></div>
              <div className="st st-stable-score" tabIndex={0}>
                <div className="st-l">稳定成绩</div>
                <div className="st-v">{fmtShort(stats.avg20)}</div>
                <span className="stable-score-popover" role="tooltip">
                  {stableScoreDescription}
                </span>
              </div>
            </div>
          </div>

          <div className="movelog">
            <div className="practice-card-head ml-head">
              <div className="practice-title-line">
                <div className="practice-card-title">移动记录</div>
                <div className="practice-kicker">MOVES</div>
              </div>
              <div className="ml-actions">
                <button className="ml-action" onClick={clearMoveLog} disabled={moveLog.length === 0}>
                  清空
                </button>
                <button className="ml-action" onClick={copyMoveLog} disabled={moveLog.length === 0}>
                  复制
                </button>
              </div>
            </div>
            <div
              className="ml-track"
              ref={moveLogRef}
              style={{ "--move-log-columns": moveLogColumns, "--move-log-rows": moveLogRows } as CSSProperties}
            >
              {moveLog.length > 0 && (
                moveLog.map((move, index) => (
                  <span key={`${move.t}-${index}`} className="ml-pill"><MoveToken move={move.m} /></span>
                ))
              )}
            </div>
          </div>

          <div className="practice-card legend">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">色彩对照</div>
                <div className="practice-kicker">COLORS</div>
              </div>
            </div>
            <CubeColorLegend faceColors={faceColors} />
          </div>
        </section>

        <section className="practice-center">
          <div className="practice-stage">
            <div className="stage-tools">
              <button
                className={`tag tag-btn${gyroDisabled ? "" : " active"}`}
                onClick={toggleGyroDisabled}
                aria-keyshortcuts="L"
                aria-pressed={!gyroDisabled}
                aria-describedby={gyroCostNoticeVisible ? "gyro-cost-notice" : undefined}
              >
                <span className="tag-key" aria-hidden="true">L</span>
                {gyroDisabled ? "禁用陀螺仪" : "启用陀螺仪"}
              </button>
              <button className="tag tag-btn" onClick={() => void beginSmartSolve()} disabled={smartSolveStatus === "loading"} aria-keyshortcuts="Q">
                <span className="tag-key" aria-hidden="true">Q</span>
                {smartSolveStatus === "loading" ? "求解中" : "智能求解"}
              </button>
              <button className="tag tag-btn stage-reset-btn" onClick={resetDisplayOrientation} disabled={!canResetDisplayOrientation} aria-keyshortcuts="R">
                <span className="tag-key" aria-hidden="true">R</span>
                视角归位
              </button>
            </div>
            {gyroCostNoticeVisible && (
              <div
                className={`gyro-cost-notice${gyroCostNoticeFading ? " fading" : ""}`}
                id="gyro-cost-notice"
                role="status"
              >
                开启陀螺仪功能会导致较大计算开销
              </div>
            )}
            <div className="cube-mount" ref={cubeMountRef}></div>

            <div className="stage-bottom-stack">
              {smartSolveVisible && (
                <div className="stage-hint solve-stage-hint" role="status" aria-label="智能求解">
                  <div className="sh-head">
                    <div className="sh-kicker">智能求解</div>
                    {smartSolveSteps.length > 0 && (
                      <div className="sh-counter">
                        <span className="sh-counter-num">{smartSolveCounterValue}</span>
                        <span className="sh-counter-sep">/</span>
                        <span className="sh-counter-total">{smartSolveSteps.length}</span>
                      </div>
                    )}
                    <button className="sh-cancel" onClick={cancelSmartSolve} aria-label="关闭智能求解">
                      {smartSolveStatus === "active" || smartSolveStatus === "loading" ? "取消" : "关闭"}
                    </button>
                  </div>
                  {smartSolveSteps.length > 0 && (
                    <div className="sh-grid">
                      {smartSolveSteps.map((move, index) => {
                        const stepStatus: AlgorithmStepStatus =
                          index === smartSolveIndex && (smartSolveWrong || smartSolveUndoExpected)
                            ? "wrong"
                            : smartSolveStepStatus[index] === "correct"
                              ? "correct"
                              : smartSolveStepStatus[index] === "partial"
                                ? "partial"
                                : "pending";
                        return (
                          <AlgorithmStepToken
                            key={`${move}-${index}`}
                            move={move}
                            index={index}
                            status={stepStatus}
                            active={smartSolveStatus === "active" && index === smartSolveIndex}
                          />
                        );
                      })}
                    </div>
                  )}
                  <div className={`sh-notice${smartSolveUndoExpected || smartSolveStatus === "error" ? " error" : ""}`}>
                    {smartSolveUndoDisplay.length > 0 ? (
                      <>
                        <span className="sh-notice-label">撤销提示：请依次转</span>
                        <span className="sh-undo-list">
                          {[...smartSolveUndoDisplay].reverse().map((move, index) => (
                            <MoveToken key={`${move}-${index}`} move={move} />
                          ))}
                        </span>
                      </>
                    ) : (
                      smartSolveNotice
                    )}
                  </div>
                </div>
              )}
              {phase === "scrambling" && (
                <div className="stage-hint" role="status" aria-label="打乱公式">
                  <div className="sh-head sh-head-scramble">
                    <div className="sh-kicker">打乱公式</div>
                    {undoDisplay.length > 0 && (
                      <div className={`sh-notice sh-notice-inline${undoExpected ? " error" : ""}`}>
                        <span className="sh-notice-label">撤销提示：请依次转</span>
                        <span className="sh-undo-list">
                          {[...undoDisplay].reverse().map((move, index) => (
                            <MoveToken key={`${move}-${index}`} move={move} />
                          ))}
                        </span>
                      </div>
                    )}
                    <div className="sh-actions">
                      <div className="sh-counter">
                        <span className="sh-counter-num">{scrambleIndex + 1}</span>
                        <span className="sh-counter-sep">/</span>
                        <span className="sh-counter-total">{scramble.length}</span>
                      </div>
                      <button className="sh-cancel" onClick={cancelCurrentAttempt} aria-label="取消打乱">取消</button>
                    </div>
                  </div>
                  <div className="sh-grid">
                    {scramble.map((move, index) => {
                      const stepStatus: AlgorithmStepStatus =
                        index === scrambleIndex && (scrambleWrong || undoExpected)
                          ? "wrong"
                          : scrambleStatus[index] === "correct"
                            ? "correct"
                            : scrambleStatus[index] === "partial"
                              ? "partial"
                              : "pending";
                      return (
                        <AlgorithmStepToken
                          key={`${move}-${index}`}
                          move={move}
                          index={index}
                          status={stepStatus}
                          active={index === scrambleIndex}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
              {practiceMode === "free" && isConnected && !smartSolveVisible && phase !== "solving" && (
                <div className="stage-hint free-stage-hint" role="status" aria-label="自由练习状态">
                  <div className="sh-head">
                    <div className="sh-kicker">自由练习</div>
                    <div className="sh-actions">
                      <button className="sh-cancel" onClick={cancelFreePractice} aria-label="取消自由练习">取消</button>
                      {(freeState === "scrambling" || freeState === "armed" || phase === "done") && (
                        <button className="sh-cancel" onClick={cancelCurrentAttempt} aria-label="重置自由练习">重置</button>
                      )}
                    </div>
                  </div>
                  <div className="free-state-grid">
                    {[
                      ["状态同步", freeState === "waitingSolved" ? "active" : freeState === "ready" || freeState === "scrambling" || freeState === "armed" ? "done" : ""],
                      ["自由打乱", freeState === "scrambling" || freeState === "armed" ? "done" : ""],
                      ["静止 5 秒", freeState === "scrambling" ? "filling" : freeState === "armed" ? "done" : ""],
                      ["开始复原", freeState === "armed" ? "active" : ""],
                    ].map(([label, status]) => (
                      <span key={label} className={`free-state-cell ${status}`}>
                        {label === "静止 5 秒" && status === "filling" && (
                          <span
                            className="free-state-fill"
                            style={{ width: `${freeIdleProgress * 100}%` }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="free-state-label">{label}</span>
                      </span>
                    ))}
                  </div>
                  <div className="sh-notice">
                    {freeState === "scrambling" && !freeAwaitingIdleFaceletsRef.current
                      ? "自由打乱中。停手后静止进度会从左到右推进。"
                      : freeNotice}
                  </div>
                </div>
              )}

            </div>
          </div>
        </section>

        <section className="practice-right">
          <div className="practice-mode-switch" aria-label="练习模式">
            <button
              type="button"
              className={practiceMode === "scramble" ? "active" : ""}
              onClick={() => changePracticeMode("scramble")}
              disabled={!canSwitchMode}
            >
              打乱练习
            </button>
            <button
              type="button"
              className={practiceMode === "free" ? "active" : ""}
              onClick={() => changePracticeMode("free")}
              disabled={!canSwitchMode}
            >
              自由练习
            </button>
          </div>

          <div className={`timer timer-${phase}${practiceMode === "free" ? ` timer-free timer-free-${freeState}` : ""}`}>
            {(phase === "idle" || phase === "scrambling") && <div className="t-display">{fmtTime(0)}</div>}
            {phase === "inspect" && (
              <div className="t-display t-warn">
                {inspectionDurationMs === null ? "∞" : Math.ceil(inspectMs / 1000)}
                {inspectionDurationMs !== null && <span className="t-unit">s</span>}
              </div>
            )}
            {(phase === "solving" || phase === "done") && <div className="t-display t-active">{fmtTime(solveMs)}</div>}
            <div className="t-phase">
              {timerPhaseLabel}
            </div>
          </div>

          <div className="timer-controls">
            {practiceMode === "scramble" && (phase === "idle" || phase === "done") && (
              <button className="practice-btn practice-btn-primary" onClick={isConnected ? beginScramble : startConnection} disabled={connectionState === "connecting" || smartSolveBusy}>
                <span>
                  {smartSolveBusy
                    ? "智能求解中"
                    : !isConnected
                    ? connectionState === "connecting"
                      ? "等待浏览器选择器"
                      : "连接魔方"
                    : dailyTest
                    ? `继续测试 ${dailyTestProgress + 1}/${DAILY_TEST_TARGET} · 开始打乱`
                    : phase === "done"
                      ? "下一次 · 开始打乱"
                      : "开始打乱 · 按 SPACE"}
                </span>
              </button>
            )}
            {practiceMode === "scramble" && phase === "scrambling" && (
              <button className="practice-btn practice-btn-primary" onClick={cancelCurrentAttempt} aria-label="取消打乱">
                <span>取消</span>
              </button>
            )}
            {practiceMode === "scramble" && phase === "inspect" && (
              <button className="practice-btn practice-btn-primary" onClick={cancelCurrentAttempt}>
                <span>取消本次复原 · 按 SPACE</span>
              </button>
            )}
            {phase === "solving" && (
              <button className="practice-btn practice-btn-primary" onClick={cancelCurrentAttempt}>
                <span>取消 · 按 SPACE</span>
              </button>
            )}
            {practiceMode === "free" && phase !== "solving" && (
              freeState === "scrambling" || freeState === "armed" ? (
                <button className="practice-btn practice-btn-primary" onClick={cancelCurrentAttempt}>
                  <span>{freeState === "scrambling" ? "静止确认中" : "等待第一步复原"}</span>
                </button>
              ) : (
                <button className="practice-btn practice-btn-ghost" disabled>
                  <span>
                    {!isConnected
                      ? "请先连接智能魔方"
                      : phase === "done"
                        ? "完成，可直接再次打乱"
                        : freeState === "waitingSolved"
                          ? "等待魔方状态"
                          : "可自由打乱"}
                  </span>
                </button>
              )
            )}
          </div>

          <div className="solve-metrics">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">成绩详情</div>
                <div className="practice-kicker">DETAILS</div>
              </div>
            </div>
            <div className="solve-current-grid">
              <div className="solve-metric-main">
                <span>总成绩</span>
                <em>{solveMoveCount}步</em>
                <b>{fmtShort(solveMs)}</b>
              </div>
              <div className="solve-phase-grid" aria-label="CFOP 阶段用时">
                <div className="solve-phase-card solve-phase-card-cross">
                  <span>Cross</span>
                  <b>{formatPhaseMoveDelta(toHistoryCfopMetrics(cfopMovesRef.current), "cross")} / {formatPhaseTimeDelta(toHistoryCfopMetrics(cfopTimes), "cross")}</b>
                </div>
                <div className="solve-phase-card solve-phase-card-f2l" tabIndex={0}>
                  <span>F2L</span>
                  <b>{formatPhaseMoveDelta(toHistoryCfopMetrics(cfopMovesRef.current), "f2l")} / {formatPhaseTimeDelta(toHistoryCfopMetrics(cfopTimes), "f2l")}</b>
                  <div className="f2l-subphase-popover" role="tooltip" aria-label="F2L 子阶段用时和步数">
                    {F2L_SUBPHASES.map((subphase, index) => (
                      <span key={subphase.key}>
                        <strong>{index + 1}/4</strong>
                        <em>{formatF2lSubphaseTimeDelta(toHistoryCfopMetrics(cfopTimes), toHistoryF2lSubphaseMetrics(f2lSubTimes), subphase.key)}</em>
                        <b>{formatF2lSubphaseMoveDelta(toHistoryCfopMetrics(cfopMovesRef.current), toHistoryF2lSubphaseMetrics(f2lSubMoves), subphase.key)}</b>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="solve-phase-card solve-phase-card-oll">
                  <span>OLL</span>
                  <b>{formatPhaseMoveDelta(toHistoryCfopMetrics(cfopMovesRef.current), "oll")} / {formatPhaseTimeDelta(toHistoryCfopMetrics(cfopTimes), "oll")}</b>
                </div>
                <div className="solve-phase-card solve-phase-card-pll">
                  <span>PLL</span>
                  <b>{formatPhaseMoveDelta(toHistoryCfopMetrics(cfopMovesRef.current), "pll")} / {formatPhaseTimeDelta(toHistoryCfopMetrics(cfopTimes), "pll")}</b>
                </div>
              </div>
            </div>
          </div>

          <div className="hist hist-right">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">历史记录</div>
                <div className="practice-kicker">HISTORY</div>
              </div>
              {history.length > 0 && (
                <button
                  className={`hist-edit-btn${historyEditing ? " active" : ""}`}
                  type="button"
                  aria-label={historyEditing ? "隐藏历史记录删除按钮" : "编辑历史记录"}
                  aria-pressed={historyEditing}
                  onClick={toggleHistoryEditing}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 19l4.1-1 9.3-9.3-3.1-3.1L6 14.9 5 19z" />
                    <path d="M14.6 6.3l3.1 3.1" />
                    <path d="M5 19h14" />
                  </svg>
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="hist-empty">尚无记录</div>
            ) : (
              <div
                className={`hist-list${historyScrolling ? " scrolling" : ""}`}
                ref={historyListRef}
                style={{ "--history-rows": historyRows } as CSSProperties}
                onScroll={handleHistoryScroll}
                onPointerLeave={() => setHistoryScrolling(false)}
              >
                {recentHistory.map((entry, index) => {
                  const barWidth = recentSlowest > 0 ? `${Math.max(12, (entry.ms / recentSlowest) * 100)}%` : "0%";
                  const isBest = stats.best === entry.ms;
                  const historyNumber = history.length - index;
                  return (
                    <div
                      key={`${entry.ts}-${index}`}
                      className={`hist-row${isBest ? " best" : ""}${historyEditing ? " editing" : ""}`}
                      tabIndex={0}
                      aria-label={`历史记录 #${historyNumber}，${
                        fmtShort(entry.ms)
                      }，${entry.moves == null ? "步数未知" : `${entry.moves}步`}`}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setHistoryCfopTip(null);
                      }}
                      onFocus={(event) => {
                        if (event.target === event.currentTarget) showHistoryCfopTip(event.currentTarget, entry, historyNumber);
                      }}
                      onMouseEnter={(event) => showHistoryCfopTip(event.currentTarget, entry, historyNumber, { x: event.clientX, y: event.clientY })}
                      onMouseLeave={() => setHistoryCfopTip(null)}
                    >
                      <span className="hr-i">#{String(historyNumber).padStart(3, "0")}</span>
                      <span className="hr-track" aria-hidden="true">
                        <span className="hr-bar" style={{ width: barWidth }}></span>
                      </span>
                      <span className="hr-t">{fmtShort(entry.ms)}</span>
                      <span className="hr-m">{entry.moves == null ? "—" : `${entry.moves}步`}</span>
                      {historyEditing && (
                        <button
                          className="hr-delete"
                          type="button"
                          aria-label={`删除历史记录 #${historyNumber}`}
                          aria-haspopup="dialog"
                          aria-expanded={pendingHistoryDelete?.historyIndex === index && pendingHistoryDelete.entryTs === entry.ts}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => requestDeleteHistoryEntry(index, entry, historyNumber, event)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {portalReady && historyCfopTip && createPortal((
              <div
                className={`stats-cfop-floating-tip practice-cfop-floating-tip tip-${historyCfopTip.placement}`}
                role="tooltip"
                style={{
                  left: historyCfopTip.left,
                  top: historyCfopTip.top,
                  "--tip-arrow-left": `${historyCfopTip.arrowLeft}px`,
                } as CSSProperties}
              >
                <div className="hcf-head">
                  <span>#{String(historyCfopTip.historyNumber).padStart(3, "0")}</span>
                  <b>{fmtSolveDate(historyCfopTip.entry.ts)}</b>
                </div>
                {CFOP_PHASES.map((phase, index) => (
                  <Fragment key={phase.key}>
                    <div className={`hcf-row${index % 2 === 0 ? " hcf-row-alt" : ""}`}>
                      <span>{phase.name}</span>
                      <em>{formatPhaseTimeDelta(historyCfopTip.entry.cfop, phase.key)}</em>
                      <b>{formatPhaseMoveDelta(historyCfopTip.entry.cfopMoves, phase.key)}</b>
                    </div>
                    {phase.key === "f2l" && (
                      <div className="hcf-f2l-subline" aria-label="F2L 子阶段用时和步数">
                        {F2L_SUBPHASES.map((subphase, index) => (
                          <span key={subphase.key}>
                            <strong>{index + 1}/4</strong>
                            <em>{formatF2lSubphaseTimeDelta(historyCfopTip.entry.cfop, historyCfopTip.entry.cfopF2l, subphase.key)}</em>
                            <b>{formatF2lSubphaseMoveDelta(historyCfopTip.entry.cfopMoves, historyCfopTip.entry.cfopF2lMoves, subphase.key)}</b>
                          </span>
                        ))}
                      </div>
                    )}
                  </Fragment>
                ))}
                <div className="hcf-row hcf-total">
                  <span>总计</span>
                  <em>{fmtShort(historyCfopTip.entry.ms)}</em>
                  <b>{historyCfopTip.entry.moves == null ? MISSING_HISTORY_VALUE : `${historyCfopTip.entry.moves}步`}</b>
                </div>
              </div>
            ), document.body)}
            {portalReady && pendingHistoryDelete && createPortal((
              <div
                className="top-disconnect-popover history-delete-popover"
                role="dialog"
                aria-label="确认删除历史记录"
                style={{
                  left: pendingHistoryDelete.left,
                  top: pendingHistoryDelete.top,
                  "--history-delete-arrow-left": `${pendingHistoryDelete.arrowLeft}px`,
                } as CSSProperties}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="top-disconnect-title">删除本次数据？</div>
                <div className="top-disconnect-text">
                  #{String(pendingHistoryDelete.historyNumber).padStart(3, "0")} · {fmtShort(pendingHistoryDelete.ms)}
                </div>
                <div className="top-disconnect-actions">
                  <button type="button" onClick={cancelPendingHistoryDelete}>取消</button>
                  <button type="button" className="danger" onClick={confirmPendingHistoryDelete}>
                    确认删除
                  </button>
                </div>
              </div>
            ), document.body)}
          </div>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
