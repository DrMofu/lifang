"use client";

import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlgorithmStepToken, type AlgorithmStepStatus } from "@/components/algorithm-step-token";
import { AppFooter, AppTopbar } from "@/components/app-shell";
import { useCubeAppearance } from "@/components/cube-appearance-provider";
import { useCubeConnection } from "@/components/cube-connection-provider";
import { MoveToken } from "@/components/move-token";
import {
  expandMoveNotation,
  createMoveCoordinateState,
  hintMoveForDoubleTurnProgress,
  invertMoveNotation,
  moveCanStillMatchExpected,
  movePartiallyMatchesExpectedDoubleTurn,
  movesMatchExpected,
  normalizeMoveCoordinate,
  parseAlgorithm,
  parseMoveNotation,
  updateMoveCoordinateStateAfterMatch,
  type MoveCoordinateState,
} from "@/lib/algorithms";
import {
  CFOP_TRAINER_PHASES,
  SOLVED_FACELETS,
  createFormulaTrainerScenario,
  displayFaceletsToHardwareFacelets,
  formulaTrainerScenarioCount,
  prependCfopTrainerHistoryEntry,
  readCfopTrainerHistory,
  trainerPhaseShort,
  type CfopTrainerHistoryEntry,
  type CfopTrainerHistoryOptions,
  type CfopTrainerPhase,
  type CfopTrainerScenario,
} from "@/lib/cfop-trainer";
import { detectCfopMilestones, detectF2lTargetEdgeSolved, isSolvedFacelets, type F2lTargetSlot } from "@/lib/cube-state";
import {
  applyMoveToFacelets,
  applyMoveToFormulaFacelets,
  applyMovesToFacelets,
  applyMovesToFormulaFacelets,
} from "@/lib/facelets-pattern";
import { fmtShort, fmtTime } from "@/lib/format";
import { generateScramble, isSameSolveMoveCountGroup, solveMoveCountGroup } from "@/lib/scramble";
import { getArchiveScopedStorageKey } from "@/lib/solve-history";
import {
  calculateAverageTime,
  describeAverageTimeSettings,
  loadAverageTimeSettings,
  type AverageTimeSettings,
} from "@/lib/average-time";
import { CUBE_CAMERA_PRESETS } from "@/lib/cube-camera-presets";
import {
  type CubeQuaternion,
  type CubeDisplayState,
  type SmartCubeApi,
  mountSmartCube,
} from "@/lib/smart-cube";

type TrainerState = "idle" | "loading" | "observe" | "solving" | "cancelled" | "done" | "error";
type FormulaHintStepStatus = "pending" | "partial" | "correct";

const SCRAMBLE_LABEL = "随机 Cross 打乱";
const TRAINER_MOVE_ANIMATION_MS = 100;
const DISPLAY_STATE_EPSILON = 0.001;
const HISTORY_ROW_SIZE = 32;
const HISTORY_ROW_GAP = 7;
const HISTORY_FALLBACK_ROWS = 1;
const TRAINER_SESSION_ROUNDS = 10;
const PRACTICE_GYRO_DISABLED_KEY = "cube-practice-gyro-disabled";
const F2L_FOCUS_MODE_KEY = "cfop-trainer-f2l-focus-mode";
const TRAINER_SELECTED_PHASE_KEY = "cfop-trainer-selected-phase";
const TRAINER_ROTATION_VARIANTS_KEY = "cfop-trainer-rotation-variants";
const TRAINER_FORMULA_HINT_KEY = "cfop-trainer-formula-hint";
const TRAINER_ROTATION_ARROW_KEY = "cfop-trainer-rotation-arrow";
const TRAINER_F2L_EDGE_ONLY_KEY = "cfop-trainer-f2l-edge-only";
const TRAINER_CUBE_CAMERA_PRESET = CUBE_CAMERA_PRESETS.trainer;
const F2L_FOCUS_SOLVED_FACELETS = [
  "XXXXXXXXX",
  "XXXRRRRRR",
  "XXXFFFFFF",
  "DDDDDDDDD",
  "XXXLLLLLL",
  "XXXBBBBBB",
].join("");
const OLL_FOCUS_SOLVED_FACELETS = [
  "UUUUUUUUU",
  "XXXXXXXXX",
  "XXXXXXXXX",
  "XXXXXXXXX",
  "XXXXXXXXX",
  "XXXXXXXXX",
].join("");

type TrainerRoundResult = {
  observeMs: number;
  solveMs: number;
  moves: number;
};

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

function readF2lFocusModeEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(F2L_FOCUS_MODE_KEY)) || "false") === true;
  } catch {
    return false;
  }
}

function saveF2lFocusModeEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getArchiveScopedStorageKey(F2L_FOCUS_MODE_KEY), JSON.stringify(enabled));
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

function readStoredTrainerPhase() {
  if (typeof window === "undefined") return "cross" as CfopTrainerPhase;
  try {
    const stored = window.localStorage.getItem(getArchiveScopedStorageKey(TRAINER_SELECTED_PHASE_KEY));
    return CFOP_TRAINER_PHASES.some((phase) => phase.key === stored)
      ? stored as CfopTrainerPhase
      : "cross";
  } catch {
    return "cross";
  }
}

function saveStoredTrainerPhase(phase: CfopTrainerPhase) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getArchiveScopedStorageKey(TRAINER_SELECTED_PHASE_KEY), phase);
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

function readStoredTrainerBoolean(key: string) {
  if (typeof window === "undefined") return false;
  try {
    return JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(key)) || "false") === true;
  } catch {
    return false;
  }
}

function saveStoredTrainerBoolean(key: string, enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getArchiveScopedStorageKey(key), JSON.stringify(enabled));
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

function f2lTargetSlotForRotation(rotation: number): F2lTargetSlot {
  if (rotation === 1) return "br";
  if (rotation === 2) return "bl";
  if (rotation === 3) return "fl";
  return "fr";
}

function phaseComplete(
  phase: CfopTrainerPhase,
  facelets: string,
  options: { f2lEdgeOnly?: boolean; f2lRotation?: number } = {},
) {
  const milestones = detectCfopMilestones(facelets);
  if (phase === "cross") return milestones.cross;
  if (phase === "f2l") {
    return options.f2lEdgeOnly
      ? detectF2lTargetEdgeSolved(facelets, f2lTargetSlotForRotation(options.f2lRotation ?? 0))
      : milestones.f2l;
  }
  if (phase === "oll") return milestones.oll;
  return milestones.pll || isSolvedFacelets(facelets);
}

function canUseFocusModeForPhase(phase: CfopTrainerPhase) {
  return phase === "f2l" || phase === "oll";
}

function focusSolvedFaceletsForPhase(phase: CfopTrainerPhase) {
  if (phase === "f2l") return F2L_FOCUS_SOLVED_FACELETS;
  if (phase === "oll") return OLL_FOCUS_SOLVED_FACELETS;
  return null;
}

function rotationLabel(rotation: number) {
  if (rotation === 0) return "0";
  if (rotation === 1) return "y";
  if (rotation === 2) return "y2";
  return "y'";
}

function isDefaultDisplayState(state: CubeDisplayState) {
  const defaultState = TRAINER_CUBE_CAMERA_PRESET.displayState;
  return (
    Math.abs(state.cameraDistance - defaultState.cameraDistance) <= DISPLAY_STATE_EPSILON &&
    Math.abs(state.cameraLatitude - defaultState.cameraLatitude) <= DISPLAY_STATE_EPSILON &&
    Math.abs(state.cameraLongitude - defaultState.cameraLongitude) <= DISPLAY_STATE_EPSILON
  );
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

function normalizeMove(move: string) {
  return parseMoveNotation(move)?.notation ?? move;
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
  return compressUndoMoveSequence(moves.map(invertMoveNotation));
}

function appendUndoStackMoves(undoStack: string[], moves: string[]) {
  return compressUndoMoveSequence([...undoStack, ...moves.map(invertMoveNotation)]);
}

function getRemainingUndoStack(undoStack: string[], pendingMoves: string[]) {
  const expectedUndo = undoStack[undoStack.length - 1];
  if (!expectedUndo || pendingMoves.length === 0) return undoStack;
  const remainingTop = compressUndoMoveSequence([...pendingMoves.toReversed().map(invertMoveNotation), expectedUndo]);
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

function freshFormulaHintStatus(moves: string[]) {
  return moves.map(() => "pending" as FormulaHintStepStatus);
}

function averageTime(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatMoveAverage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—步";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}步`;
}

function trainerHistoryOptionBadges(options: CfopTrainerHistoryOptions) {
  return [
    options.rotationVariants ? "变体" : null,
    options.f2lEdgeOnly ? "棱块" : null,
    options.formulaHint ? "提示" : null,
    options.rotationArrow ? "箭头" : null,
  ].filter((item): item is string => item !== null);
}

function trainerHistoryOptionsTitle(options: CfopTrainerHistoryOptions) {
  const badges = trainerHistoryOptionBadges(options);
  return badges.length > 0 ? `设置：${badges.join("、")}` : "设置：标准";
}

export function CfopTrainerApp() {
  const cubeMountRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const cubeApiRef = useRef<SmartCubeApi | null>(null);
  const stateRef = useRef<TrainerState>("idle");
  const selectedPhaseRef = useRef<CfopTrainerPhase>(readStoredTrainerPhase());
  const scenarioRef = useRef<CfopTrainerScenario | null>(null);
  const currentFaceletsRef = useRef(SOLVED_FACELETS);
  const focusFaceletsRef = useRef<string | null>(null);
  const f2lFocusModeRef = useRef(readF2lFocusModeEnabled());
  const observeStartRef = useRef(0);
  const solveStartRef = useRef(0);
  const solveMoveCountRef = useRef(0);
  const solveMoveGroupRef = useRef<ReturnType<typeof solveMoveCountGroup>>(null);
  const scrambleRef = useRef<string[]>([]);
  const formulaHintMovesRef = useRef<string[]>([]);
  const formulaHintIndexRef = useRef(0);
  const formulaHintPendingMovesRef = useRef<string[]>([]);
  const formulaHintUndoStackRef = useRef<string[]>([]);
  const formulaHintPendingUndoMovesRef = useRef<string[]>([]);
  const formulaHintCoordinateRef = useRef<MoveCoordinateState>(createMoveCoordinateState());
  const formulaRotationVariantsRef = useRef(readStoredTrainerBoolean(TRAINER_ROTATION_VARIANTS_KEY));
  const formulaHintEnabledRef = useRef(readStoredTrainerBoolean(TRAINER_FORMULA_HINT_KEY));
  const formulaArrowEnabledRef = useRef(readStoredTrainerBoolean(TRAINER_ROTATION_ARROW_KEY));
  const f2lEdgeOnlyRef = useRef(readStoredTrainerBoolean(TRAINER_F2L_EDGE_ONLY_KEY));
  const gyroDisabledRef = useRef(loadPracticeGyroDisabled());
  const visualPendingMoveRef = useRef<string | null>(null);
  const visualPendingTimerRef = useRef<number | null>(null);
  const gyroCostNoticeFadeTimerRef = useRef<number | null>(null);
  const gyroCostNoticeTimerRef = useRef<number | null>(null);
  const autoNextTimerRef = useRef<number | null>(null);
  const autoNextPendingRef = useRef(false);
  const moveQueueRef = useRef(Promise.resolve());
  const mountedRef = useRef(false);
  const runIdRef = useRef(0);
  const sessionResultsRef = useRef<TrainerRoundResult[]>([]);

  const [selectedPhase, setSelectedPhase] = useState<CfopTrainerPhase>(readStoredTrainerPhase);
  const [state, setState] = useState<TrainerState>("idle");
  const [notice, setNotice] = useState("选择阶段后开始专项训练。");
  const [scenario, setScenario] = useState<CfopTrainerScenario | null>(null);
  const [observeMs, setObserveMs] = useState(0);
  const [solveMs, setSolveMs] = useState(0);
  const [timerKind, setTimerKind] = useState<"observe" | "solve">("solve");
  const [sessionResults, setSessionResults] = useState<TrainerRoundResult[]>([]);
  const [history, setHistory] = useState<CfopTrainerHistoryEntry[]>([]);
  const [averageSettings] = useState<AverageTimeSettings>(loadAverageTimeSettings);
  const [historyRows, setHistoryRows] = useState(HISTORY_FALLBACK_ROWS);
  const [historyScrolling, setHistoryScrolling] = useState(false);
  const [formulaRotationVariants, setFormulaRotationVariants] = useState(() => formulaRotationVariantsRef.current);
  const [formulaHintEnabled, setFormulaHintEnabled] = useState(() => formulaHintEnabledRef.current);
  const [formulaArrowEnabled, setFormulaArrowEnabled] = useState(() => formulaArrowEnabledRef.current);
  const [f2lEdgeOnly, setF2lEdgeOnly] = useState(() => f2lEdgeOnlyRef.current);
  const [formulaHintMoves, setFormulaHintMoves] = useState<string[]>([]);
  const [formulaHintIndex, setFormulaHintIndex] = useState(0);
  const [formulaHintStatus, setFormulaHintStatus] = useState<FormulaHintStepStatus[]>([]);
  const [formulaHintWrong, setFormulaHintWrong] = useState(false);
  const [formulaHintUndoDisplay, setFormulaHintUndoDisplay] = useState<string[]>([]);
  const [f2lFocusMode, setF2lFocusMode] = useState(readF2lFocusModeEnabled);
  const [gyroDisabled, setGyroDisabled] = useState(loadPracticeGyroDisabled);
  const [gyroCostNoticeVisible, setGyroCostNoticeVisible] = useState(false);
  const [gyroCostNoticeFading, setGyroCostNoticeFading] = useState(false);
  const [autoNextPending, setAutoNextPending] = useState(false);
  const [viewResetEnabled, setViewResetEnabled] = useState(false);

  const { connectionState, connectRealCube, getLatestGyro, subscribeMove, subscribeGyro } = useCubeConnection();
  const { orientation, faceColors, renderMaxFps, backFaceProjectionEnabled, backFaceProjectionDistance } = useCubeAppearance();
  const connected = connectionState === "connected";
  const connecting = connectionState === "connecting";
  const canResetDisplayOrientation = viewResetEnabled || !gyroDisabled;
  const activePhaseMeta = CFOP_TRAINER_PHASES.find((phase) => phase.key === selectedPhase) ?? CFOP_TRAINER_PHASES[0];
  const trainingActive = state === "loading" || state === "observe" || state === "solving";
  const canCancelTrainerAction = trainingActive || autoNextPending;
  const timerDisplayMs = timerKind === "observe" ? observeMs : solveMs;
  const canUseFocusMode = canUseFocusModeForPhase(selectedPhase);
  const formulaHintVisible = formulaHintEnabled && selectedPhase !== "cross" && formulaHintMoves.length > 0;
  const formulaHintCounter = formulaHintMoves.length > 0 ? Math.min(formulaHintIndex + 1, formulaHintMoves.length) : 0;
  const sessionRoundCount = sessionResults.length;
  const sessionAverageObserveMs = useMemo(
    () => averageTime(sessionResults.map((entry) => entry.observeMs)),
    [sessionResults],
  );
  const sessionAverageSolveMs = useMemo(
    () => averageTime(sessionResults.map((entry) => entry.solveMs)),
    [sessionResults],
  );

  const updateTrainerState = useCallback((next: TrainerState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const getCurrentHistoryOptions = useCallback((phase: CfopTrainerPhase): CfopTrainerHistoryOptions => {
    if (phase === "cross") {
      return {
        rotationVariants: false,
        formulaHint: false,
        rotationArrow: false,
        f2lEdgeOnly: false,
      };
    }
    return {
      rotationVariants: formulaRotationVariantsRef.current,
      formulaHint: formulaHintEnabledRef.current,
      rotationArrow: formulaArrowEnabledRef.current,
      f2lEdgeOnly: phase === "f2l" && f2lEdgeOnlyRef.current,
    };
  }, []);

  const renderFacelets = useCallback(
    (displayFacelets: string) => displayFaceletsToHardwareFacelets(displayFacelets, orientation),
    [orientation],
  );

  const renderTrainerCubeFacelets = useCallback(
    (displayFacelets: string) => {
      const cube = cubeApiRef.current;
      if (!cube) return;
      if (canUseFocusModeForPhase(selectedPhaseRef.current) && f2lFocusModeRef.current) {
        cube.setFormulaFacelets(focusFaceletsRef.current ?? focusSolvedFaceletsForPhase(selectedPhaseRef.current) ?? F2L_FOCUS_SOLVED_FACELETS);
        return;
      }
      cube.setFacelets(renderFacelets(displayFacelets));
    },
    [renderFacelets],
  );

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
    const disabled = loadPracticeGyroDisabled();
    gyroDisabledRef.current = disabled;
    setGyroDisabled(disabled);
    const focusModeEnabled = readF2lFocusModeEnabled();
    f2lFocusModeRef.current = focusModeEnabled;
    setF2lFocusMode(focusModeEnabled);
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    selectedPhaseRef.current = selectedPhase;
  }, [selectedPhase]);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(() => {
    if (state !== "observe" && state !== "solving") return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (stateRef.current === "observe") setObserveMs(Math.max(0, now - observeStartRef.current));
      if (stateRef.current === "solving") setSolveMs(Math.max(0, now - solveStartRef.current));
    }, 33);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    const mount = cubeMountRef.current;
    if (!mount) return;
    setViewResetEnabled(false);
    const initialGyroQuaternion = loadPracticeGyroDisabled() ? null : getLatestGyro();
    const api = mountSmartCube(mount, {
      orientation,
      faceColors,
      maxFps: renderMaxFps,
      showBackFaceProjection: backFaceProjectionEnabled,
      backFaceProjectionDistance,
      compensateInitialGyroOffset: false,
      defaultDisplayState: TRAINER_CUBE_CAMERA_PRESET.displayState,
      sceneOffset: TRAINER_CUBE_CAMERA_PRESET.sceneOffset,
      initialGyroQuaternion,
      onDisplayOrientationChange: () => setViewResetEnabled(true),
    });
    cubeApiRef.current = api;
    renderTrainerCubeFacelets(currentFaceletsRef.current);
    return () => {
      api.dispose();
      if (cubeApiRef.current === api) cubeApiRef.current = null;
    };
  }, [backFaceProjectionDistance, backFaceProjectionEnabled, faceColors, getLatestGyro, orientation, renderMaxFps, renderTrainerCubeFacelets]);

  const resetDisplayOrientation = useCallback(() => {
    cubeApiRef.current?.resetDisplayOrientation();
    const displayState = cubeApiRef.current?.getDisplayState();
    setViewResetEnabled(displayState ? !isDefaultDisplayState(displayState) : false);
  }, []);

  const applyGyroOrientation = useCallback((quaternion: CubeQuaternion) => {
    if (gyroDisabledRef.current) return;
    cubeApiRef.current?.setGyroOrientation(quaternion);
  }, []);

  useEffect(() => {
    if (gyroDisabled) return;
    return subscribeGyro(applyGyroOrientation);
  }, [applyGyroOrientation, subscribeGyro, gyroDisabled]);

  const filteredHistory = useMemo(
    () => history.filter((entry) => entry.phase === selectedPhase),
    [history, selectedPhase],
  );
  const phaseHistory = useMemo(
    () => history.filter((entry) => entry.phase === selectedPhase),
    [history, selectedPhase],
  );
  const filteredHistoryStats = useMemo(() => {
    const solveTimes = filteredHistory
      .map((entry) => (entry.phase === "cross" ? entry.solveMs : entry.observeMs + entry.solveMs))
      .filter((time) => Number.isFinite(time) && time > 0);
    return {
      best: solveTimes.length > 0 ? Math.min(...solveTimes) : null,
      slowest: solveTimes.length > 0 ? Math.max(...solveTimes) : 0,
    };
  }, [filteredHistory]);
  const summary = useMemo(() => {
    const solveTimes = phaseHistory.map((entry) => entry.solveMs).filter((time) => Number.isFinite(time) && time > 0);
    const avg = (arr: number[]) => {
      if (arr.length < 3) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const trimmed = sorted.slice(1, -1);
      return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
    };
    const stableScore = phaseHistory.length >= averageSettings.sampleSize
      ? calculateAverageTime(phaseHistory.slice(0, averageSettings.sampleSize).toReversed().map((entry) => entry.solveMs), averageSettings)?.valueMs ?? null
      : null;
    return {
      count: phaseHistory.length,
      avg5: solveTimes.length >= 5 ? avg(solveTimes.slice(0, 5)) : null,
      stableScore,
    };
  }, [averageSettings, phaseHistory]);
  const stableScoreDescription = describeAverageTimeSettings(averageSettings);

  const resetSessionResults = useCallback(() => {
    sessionResultsRef.current = [];
    setSessionResults([]);
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
  }, [filteredHistory.length]);

  const animateCubeMoves = useCallback((moves: string[], durationMs = TRAINER_MOVE_ANIMATION_MS) => {
    moves.forEach((move) => {
      expandMoveNotation(move).forEach((turn) => {
        cubeApiRef.current?.applyMove(turn.layer, turn.dir, durationMs);
      });
    });
  }, []);

  const clearVisualPendingTimer = useCallback(() => {
    if (visualPendingTimerRef.current === null) return;
    window.clearTimeout(visualPendingTimerRef.current);
    visualPendingTimerRef.current = null;
  }, []);

  const clearAutoNextTimer = useCallback(() => {
    if (autoNextTimerRef.current !== null) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    autoNextPendingRef.current = false;
    if (mountedRef.current) setAutoNextPending(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setHistory(readCfopTrainerHistory());
    return () => {
      mountedRef.current = false;
      clearVisualPendingTimer();
      clearAutoNextTimer();
    };
  }, [clearAutoNextTimer, clearVisualPendingTimer]);

  const flushVisualPendingMove = useCallback(() => {
    const pending = visualPendingMoveRef.current;
    clearVisualPendingTimer();
    visualPendingMoveRef.current = null;
    if (pending) animateCubeMoves([pending]);
  }, [animateCubeMoves, clearVisualPendingTimer]);

  const queueVisualMove = useCallback(
    (move: string) => {
      const pending = visualPendingMoveRef.current;
      if (!pending) {
        visualPendingMoveRef.current = move;
        clearVisualPendingTimer();
        visualPendingTimerRef.current = window.setTimeout(flushVisualPendingMove, 45);
        return;
      }

      clearVisualPendingTimer();
      animateCubeMoves([pending]);
      visualPendingMoveRef.current = move;
      visualPendingTimerRef.current = window.setTimeout(flushVisualPendingMove, 45);
    },
    [animateCubeMoves, clearVisualPendingTimer, flushVisualPendingMove],
  );

  const resetFormulaHint = useCallback((moves: string[] = []) => {
    formulaHintMovesRef.current = moves;
    formulaHintIndexRef.current = 0;
    formulaHintPendingMovesRef.current = [];
    formulaHintUndoStackRef.current = [];
    formulaHintPendingUndoMovesRef.current = [];
    formulaHintCoordinateRef.current = createMoveCoordinateState();
    setFormulaHintMoves(moves);
    setFormulaHintIndex(0);
    setFormulaHintStatus(freshFormulaHintStatus(moves));
    setFormulaHintWrong(false);
    setFormulaHintUndoDisplay([]);
  }, []);

  const updateFormulaHintMove = useCallback((move: string) => {
    const moves = formulaHintMovesRef.current;
    if (selectedPhaseRef.current === "cross" || moves.length === 0) return;
    const actual = normalizeMoveCoordinate(normalizeMove(move), formulaHintCoordinateRef.current);
    const undoStack = formulaHintUndoStackRef.current;

    if (undoStack.length > 0) {
      const expectedUndo = undoStack[undoStack.length - 1];
      formulaHintPendingUndoMovesRef.current = [...formulaHintPendingUndoMovesRef.current, actual];
      if (movesMatchExpected(formulaHintPendingUndoMovesRef.current, expectedUndo)) {
        formulaHintPendingUndoMovesRef.current = [];
        formulaHintUndoStackRef.current = undoStack.slice(0, -1);
        setFormulaHintUndoDisplay(formulaHintUndoStackRef.current);
        if (formulaHintUndoStackRef.current.length === 0) setFormulaHintWrong(false);
      } else if (moveCanStillMatchExpected(formulaHintPendingUndoMovesRef.current, expectedUndo)) {
        const remainingUndoStack = getRemainingUndoStack(undoStack, formulaHintPendingUndoMovesRef.current);
        setFormulaHintUndoDisplay(remainingUndoStack);
      } else {
        const pendingUndo = formulaHintPendingUndoMovesRef.current;
        formulaHintPendingUndoMovesRef.current = [];
        formulaHintUndoStackRef.current = appendUndoStackMoves(undoStack, pendingUndo);
        setFormulaHintUndoDisplay(formulaHintUndoStackRef.current);
        if (formulaHintUndoStackRef.current.length === 0) setFormulaHintWrong(false);
      }
      return;
    }

    const currentIndex = formulaHintIndexRef.current;
    const expected = moves[currentIndex];
    if (!expected) return;
    formulaHintPendingMovesRef.current = [...formulaHintPendingMovesRef.current, actual];
    if (movesMatchExpected(formulaHintPendingMovesRef.current, expected)) {
      const nextIndex = currentIndex + 1;
      formulaHintCoordinateRef.current = updateMoveCoordinateStateAfterMatch(
        formulaHintCoordinateRef.current,
        formulaHintPendingMovesRef.current,
        expected,
      );
      formulaHintPendingMovesRef.current = [];
      setFormulaHintStatus((prev) => prev.map((status, index) => (index === currentIndex ? "correct" : status)));
      setFormulaHintWrong(false);
      formulaHintIndexRef.current = nextIndex;
      setFormulaHintIndex(nextIndex);
    } else if (moveCanStillMatchExpected(formulaHintPendingMovesRef.current, expected)) {
      setFormulaHintWrong(false);
      setFormulaHintStatus((prev) => prev.map((status, index) => (
        index === currentIndex
          ? movePartiallyMatchesExpectedDoubleTurn(formulaHintPendingMovesRef.current, expected)
            ? "partial"
            : "pending"
          : status
      )));
    } else {
      const pendingWrong = formulaHintPendingMovesRef.current;
      const { retainedMoves, wrongMoves } = splitInvalidPendingMoves(pendingWrong, expected);
      formulaHintPendingMovesRef.current = retainedMoves;
      formulaHintPendingUndoMovesRef.current = [];
      setFormulaHintWrong(true);
      setFormulaHintStatus((prev) => prev.map((status, index) => (
        index === currentIndex
          ? movePartiallyMatchesExpectedDoubleTurn(retainedMoves, expected)
            ? "partial"
            : "pending"
          : status
      )));
      formulaHintUndoStackRef.current = buildUndoStack(wrongMoves);
      setFormulaHintUndoDisplay(formulaHintUndoStackRef.current);
      if (formulaHintUndoStackRef.current.length === 0) setFormulaHintWrong(false);
    }
  }, []);

  function getFormulaHintMove() {
    if (!formulaHintEnabled || !formulaArrowEnabled || selectedPhaseRef.current === "cross") return null;
    const undoNext = formulaHintUndoStackRef.current[formulaHintUndoStackRef.current.length - 1];
    if (undoNext) return hintMoveForDoubleTurnProgress(formulaHintPendingUndoMovesRef.current, undoNext);
    const expected = formulaHintMovesRef.current[formulaHintIndexRef.current];
    return expected ? hintMoveForDoubleTurnProgress(formulaHintPendingMovesRef.current, expected) : null;
  }

  useEffect(() => {
    cubeApiRef.current?.setHintMove(getFormulaHintMove());
  }, [
    formulaArrowEnabled,
    formulaHintEnabled,
    formulaHintIndex,
    formulaHintMoves,
    formulaHintStatus,
    formulaHintUndoDisplay,
    selectedPhase,
  ]);

  const resetRun = useCallback((message = "选择阶段后开始专项训练。") => {
    runIdRef.current += 1;
    clearAutoNextTimer();
    resetSessionResults();
    clearVisualPendingTimer();
    visualPendingMoveRef.current = null;
    scrambleRef.current = [];
    scenarioRef.current = null;
    currentFaceletsRef.current = SOLVED_FACELETS;
    focusFaceletsRef.current = focusSolvedFaceletsForPhase(selectedPhaseRef.current);
    solveMoveCountRef.current = 0;
    solveMoveGroupRef.current = null;
    setScenario(null);
    setObserveMs(0);
    setSolveMs(0);
    setTimerKind("solve");
    resetFormulaHint();
    updateTrainerState("idle");
    setNotice(message);
    renderTrainerCubeFacelets(SOLVED_FACELETS);
  }, [clearAutoNextTimer, clearVisualPendingTimer, renderTrainerCubeFacelets, resetFormulaHint, resetSessionResults, updateTrainerState]);

  const cancelRun = useCallback(() => {
    runIdRef.current += 1;
    clearAutoNextTimer();
    resetSessionResults();
    flushVisualPendingMove();
    const now = performance.now();
    if (stateRef.current === "observe") {
      setObserveMs(Math.max(0, now - observeStartRef.current));
    }
    if (stateRef.current === "solving") {
      setSolveMs(Math.max(0, now - solveStartRef.current));
    }
    updateTrainerState("cancelled");
    setNotice("本组十局已取消，当前魔方状态已保留。");
  }, [clearAutoNextTimer, flushVisualPendingMove, resetSessionResults, updateTrainerState]);

  const finishRun = useCallback((facelets: string) => {
    const phase = selectedPhaseRef.current;
    const elapsed = Math.max(0, performance.now() - solveStartRef.current);
    const observe = Math.max(0, solveStartRef.current - observeStartRef.current);
    const nextResults = [
      ...sessionResultsRef.current,
      { observeMs: observe, solveMs: elapsed, moves: solveMoveCountRef.current },
    ];
    currentFaceletsRef.current = facelets;
    sessionResultsRef.current = nextResults;
    setSessionResults(nextResults);
    setSolveMs(elapsed);
    setObserveMs(observe);
    updateTrainerState("done");
    if (nextResults.length >= TRAINER_SESSION_ROUNDS) {
      const averageObserve = averageTime(nextResults.map((entry) => entry.observeMs)) ?? observe;
      const averageSolve = averageTime(nextResults.map((entry) => entry.solveMs)) ?? elapsed;
      const averageMoves = phase === "cross" ? averageTime(nextResults.map((entry) => entry.moves)) : null;
      const entry: CfopTrainerHistoryEntry = {
        phase,
        observeMs: averageObserve,
        solveMs: averageSolve,
        ...(averageMoves == null ? {} : { moves: averageMoves }),
        rounds: TRAINER_SESSION_ROUNDS,
        ts: Date.now(),
        options: getCurrentHistoryOptions(phase),
      };
      setHistory((prev) => prependCfopTrainerHistoryEntry(prev, entry));
      setNotice(`${trainerPhaseShort(phase)} 阶段十局完成，已记录平均成绩。`);
      return;
    }
    setNotice(`${trainerPhaseShort(phase)} 阶段第 ${nextResults.length}/${TRAINER_SESSION_ROUNDS} 局完成，准备自动下一局。`);
  }, [getCurrentHistoryOptions]);

  const recordSolveMove = useCallback((move: string) => {
    const nextGroup = solveMoveCountGroup(move);
    if (!nextGroup) return;
    if (!isSameSolveMoveCountGroup(solveMoveGroupRef.current, nextGroup)) {
      solveMoveCountRef.current += 1;
    }
    solveMoveGroupRef.current = nextGroup;
  }, []);

  const processSolveMove = useCallback(
    async (move: string) => {
      recordSolveMove(move);
      updateFormulaHintMove(move);
      const nextFacelets = await applyMoveToFacelets(currentFaceletsRef.current, move);
      const nextFocusFacelets = focusFaceletsRef.current
        ? await applyMoveToFormulaFacelets(focusFaceletsRef.current, move)
        : null;
      if (stateRef.current !== "solving") return;
      currentFaceletsRef.current = nextFacelets;
      focusFaceletsRef.current = nextFocusFacelets;
      if (
        phaseComplete(selectedPhaseRef.current, nextFacelets, {
          f2lEdgeOnly: f2lEdgeOnlyRef.current,
          f2lRotation: scenarioRef.current?.rotation ?? 0,
        })
      ) {
        finishRun(nextFacelets);
      }
    },
    [finishRun, recordSolveMove, updateFormulaHintMove],
  );

  const beginSolve = useCallback(
    async (firstMove: string) => {
      const now = performance.now();
      solveStartRef.current = now;
      solveMoveCountRef.current = 0;
      solveMoveGroupRef.current = null;
      setSolveMs(0);
      setTimerKind("solve");
      updateTrainerState("solving");
      setNotice(`正在完成 ${trainerPhaseShort(selectedPhaseRef.current)} 阶段。`);
      await processSolveMove(firstMove);
    },
    [processSolveMove, updateTrainerState],
  );

  const enterObserve = useCallback((message: string) => {
    observeStartRef.current = performance.now();
    setObserveMs(0);
    setSolveMs(0);
    setTimerKind("observe");
    updateTrainerState("observe");
    setNotice(message);
  }, [updateTrainerState]);

  const beginCrossScenario = useCallback(async (runId: number) => {
    updateTrainerState("loading");
    setNotice("正在生成 Cross 随机打乱。");
    try {
      let nextScramble = generateScramble();
      let scrambledFacelets = await applyMovesToFacelets(SOLVED_FACELETS, nextScramble);
      for (let attempt = 0; attempt < 8 && phaseComplete("cross", scrambledFacelets); attempt += 1) {
        nextScramble = generateScramble();
        scrambledFacelets = await applyMovesToFacelets(SOLVED_FACELETS, nextScramble);
      }
      if (!mountedRef.current || runIdRef.current !== runId || selectedPhaseRef.current !== "cross") return;
      scrambleRef.current = nextScramble;
      currentFaceletsRef.current = scrambledFacelets;
      focusFaceletsRef.current = null;
      resetFormulaHint();
      setScenario(null);
      setObserveMs(0);
      setSolveMs(0);
      renderTrainerCubeFacelets(scrambledFacelets);
      enterObserve("Cross 随机打乱已生成，观察后转第一下开始计时。");
    } catch (error) {
      if (runIdRef.current !== runId) return;
      updateTrainerState("error");
      setNotice(error instanceof Error ? error.message : "Cross 打乱生成失败，请重试。");
    }
  }, [enterObserve, renderTrainerCubeFacelets, resetFormulaHint, updateTrainerState]);

  const beginFormulaScenario = useCallback(async (phase: Exclude<CfopTrainerPhase, "cross">, runId: number) => {
    updateTrainerState("loading");
    setNotice("正在生成专项场景。");
    try {
      const nextScenario = await createFormulaTrainerScenario(phase, { includeRotations: formulaRotationVariants });
      if (!mountedRef.current || runIdRef.current !== runId || selectedPhaseRef.current !== phase) return;
      const focusSolvedFacelets = focusSolvedFaceletsForPhase(phase);
      const nextFocusFacelets = focusSolvedFacelets
        ? await applyMovesToFormulaFacelets(focusSolvedFacelets, nextScenario.setupMoves)
        : null;
      if (!mountedRef.current || runIdRef.current !== runId || selectedPhaseRef.current !== phase) return;
      scenarioRef.current = nextScenario;
      currentFaceletsRef.current = nextScenario.startFacelets;
      focusFaceletsRef.current = nextFocusFacelets;
      resetFormulaHint(parseAlgorithm(nextScenario.sourceAlgo));
      setScenario(nextScenario);
      renderTrainerCubeFacelets(nextScenario.startFacelets);
      enterObserve(`${nextScenario.caseName} · ${rotationLabel(nextScenario.rotation)}，转第一下开始计时。`);
    } catch (error) {
      if (runIdRef.current !== runId) return;
      updateTrainerState("error");
      setNotice(error instanceof Error ? error.message : "场景生成失败，请重试。");
    }
  }, [enterObserve, formulaRotationVariants, renderTrainerCubeFacelets, resetFormulaHint, updateTrainerState]);

  const beginTrainerRound = useCallback(async (runId: number) => {
    const phase = selectedPhaseRef.current;
    if (phase === "cross") {
      await beginCrossScenario(runId);
      return;
    }
    await beginFormulaScenario(phase, runId);
  }, [beginCrossScenario, beginFormulaScenario]);

  const startTraining = useCallback(async () => {
    if (autoNextPendingRef.current) {
      cancelRun();
      return;
    }
    if (trainingActive) {
      cancelRun();
      return;
    }
    if (!connected) {
      await connectRealCube();
      return;
    }
    resetRun("准备开始十局专项训练。");
    await beginTrainerRound(runIdRef.current);
  }, [beginTrainerRound, cancelRun, connectRealCube, connected, resetRun, trainingActive]);

  useEffect(() => {
    if (
      state !== "done" ||
      !connected ||
      sessionRoundCount <= 0 ||
      sessionRoundCount >= TRAINER_SESSION_ROUNDS
    ) {
      return;
    }
    autoNextPendingRef.current = true;
    setAutoNextPending(true);
    autoNextTimerRef.current = window.setTimeout(() => {
      autoNextTimerRef.current = null;
      autoNextPendingRef.current = false;
      setAutoNextPending(false);
      if (!mountedRef.current || stateRef.current !== "done") return;
      runIdRef.current += 1;
      void beginTrainerRound(runIdRef.current);
    }, 1000);
    return clearAutoNextTimer;
  }, [beginTrainerRound, clearAutoNextTimer, connected, sessionRoundCount, state]);

  const clearGyroCostNoticeTimers = useCallback(() => {
    if (gyroCostNoticeFadeTimerRef.current !== null) {
      window.clearTimeout(gyroCostNoticeFadeTimerRef.current);
      gyroCostNoticeFadeTimerRef.current = null;
    }
    if (gyroCostNoticeTimerRef.current !== null) {
      window.clearTimeout(gyroCostNoticeTimerRef.current);
      gyroCostNoticeTimerRef.current = null;
    }
  }, []);

  const hideGyroCostNotice = useCallback(() => {
    clearGyroCostNoticeTimers();
    setGyroCostNoticeFading(false);
    setGyroCostNoticeVisible(false);
  }, [clearGyroCostNoticeTimers]);

  const showGyroCostNotice = useCallback(() => {
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
  }, [clearGyroCostNoticeTimers]);

  const toggleGyroDisabled = useCallback(() => {
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
  }, [hideGyroCostNotice, showGyroCostNotice]);

  const toggleF2lFocusMode = useCallback(() => {
    if (!canUseFocusModeForPhase(selectedPhaseRef.current)) return;
    const next = !f2lFocusModeRef.current;
    f2lFocusModeRef.current = next;
    setF2lFocusMode(next);
    if (next && !focusFaceletsRef.current) {
      focusFaceletsRef.current = focusSolvedFaceletsForPhase(selectedPhaseRef.current);
    }
    saveF2lFocusModeEnabled(next);
    renderTrainerCubeFacelets(currentFaceletsRef.current);
  }, [renderTrainerCubeFacelets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " ") return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTextEntryTarget(event.target)) return;
      if (connecting) return;

      event.preventDefault();
      void startTraining();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connecting, startTraining]);

  const enqueueMove = useCallback(
    (move: string) => {
      const parsed = parseMoveNotation(move);
      if (!parsed) return;
      const actual = parsed.notation;

      moveQueueRef.current = moveQueueRef.current
        .then(async () => {
          const currentState = stateRef.current;
          if (currentState === "observe") {
            queueVisualMove(actual);
            await beginSolve(actual);
            return;
          }
          if (currentState === "solving") {
            queueVisualMove(actual);
            await processSolveMove(actual);
          }
        })
        .catch((error) => {
          updateTrainerState("error");
          setNotice(error instanceof Error ? error.message : "处理转动时出错，请重开本局。");
        });
    },
    [beginSolve, processSolveMove, queueVisualMove, updateTrainerState],
  );

  useEffect(() => subscribeMove((move) => enqueueMove(move)), [enqueueMove, subscribeMove]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "r" && key !== "l" && key !== "h") return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTextEntryTarget(event.target)) return;
      if (key === "h" && !canUseFocusModeForPhase(selectedPhaseRef.current)) return;

      event.preventDefault();
      if (key === "h") {
        toggleF2lFocusMode();
        return;
      }
      if (key === "l") {
        toggleGyroDisabled();
        return;
      }
      if (canResetDisplayOrientation) resetDisplayOrientation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canResetDisplayOrientation, resetDisplayOrientation, toggleF2lFocusMode, toggleGyroDisabled]);

  const selectPhase = (phase: CfopTrainerPhase) => {
    selectedPhaseRef.current = phase;
    saveStoredTrainerPhase(phase);
    setSelectedPhase(phase);
    resetRun(`${trainerPhaseShort(phase)} 阶段已选择。`);
  };

  return (
    <div className="app lf-practice-app lf-trainer-app">
      <AppTopbar />
      <main className="practice-layout trainer-layout">
        <section className="practice-left trainer-left">
          <div className="practice-card trainer-phase-card">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">专项阶段</div>
                <div className="practice-kicker">CFOP TRAINER</div>
              </div>
            </div>
            <div className="trainer-phase-grid" aria-label="专项阶段选择">
              {CFOP_TRAINER_PHASES.map((phase) => (
                <button
                  key={phase.key}
                  type="button"
                  className={`trainer-phase-btn${selectedPhase === phase.key ? " active" : ""}`}
                  onClick={() => selectPhase(phase.key)}
                >
                  <b>{phase.short}</b>
                  <span>{phase.label}</span>
                </button>
              ))}
            </div>
            <div className="dt-meta">
              目标：{activePhaseMeta.goal}。
            </div>
            {selectedPhase !== "cross" && (
              <>
                <label className="trainer-variant-toggle">
                  <input
                    type="checkbox"
                    checked={formulaRotationVariants}
                    onChange={(event) => {
                      const next = event.target.checked;
                      formulaRotationVariantsRef.current = next;
                      setFormulaRotationVariants(next);
                      saveStoredTrainerBoolean(TRAINER_ROTATION_VARIANTS_KEY, next);
                    }}
                  />
                  <span>
                    <b>加入 Y 轴旋转变体</b>
                    <small>
                      {formulaRotationVariants
                        ? `当前随机池：${formulaTrainerScenarioCount(selectedPhase, { includeRotations: true })} 个（公式库 ×4）`
                        : `当前随机池：${formulaTrainerScenarioCount(selectedPhase)} 个`}
                    </small>
                  </span>
                </label>
                {selectedPhase === "f2l" && (
                  <label className="trainer-variant-toggle">
                    <input
                      type="checkbox"
                      checked={f2lEdgeOnly}
                      onChange={(event) => {
                        const next = event.target.checked;
                        f2lEdgeOnlyRef.current = next;
                        setF2lEdgeOnly(next);
                        saveStoredTrainerBoolean(TRAINER_F2L_EDGE_ONLY_KEY, next);
                      }}
                    />
                    <span>
                      <b>仅判定目标棱</b>
                      <small>只要本次棱块归位，即算完成。</small>
                    </span>
                  </label>
                )}
                <label className="trainer-variant-toggle">
                  <input
                    type="checkbox"
                    checked={formulaHintEnabled}
                    onChange={(event) => {
                      const next = event.target.checked;
                      formulaHintEnabledRef.current = next;
                      setFormulaHintEnabled(next);
                      saveStoredTrainerBoolean(TRAINER_FORMULA_HINT_KEY, next);
                    }}
                  />
                  <span>
                    <b>开启公式提示</b>
                    <small>开启后在训练状态栏显示当前公式。</small>
                  </span>
                </label>
                <label className="trainer-variant-toggle">
                  <input
                    type="checkbox"
                    checked={formulaArrowEnabled}
                    disabled={!formulaHintEnabled}
                    onChange={(event) => {
                      const next = event.target.checked;
                      formulaArrowEnabledRef.current = next;
                      setFormulaArrowEnabled(next);
                      saveStoredTrainerBoolean(TRAINER_ROTATION_ARROW_KEY, next);
                    }}
                  />
                  <span>
                    <b>显示旋转箭头</b>
                    <small>{formulaHintEnabled ? "开启后在魔方上显示当前步骤的旋转箭头。" : "开启公式提示后可操作。"}</small>
                  </span>
                </label>
              </>
            )}
          </div>

          <div className="practice-card trainer-case-card">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">当前场景</div>
                <div className="practice-kicker">CASE</div>
              </div>
            </div>
            <div className="trainer-case-name">{scenario?.caseName ?? (selectedPhase === "cross" ? SCRAMBLE_LABEL : "尚未生成")}</div>
            <div className="trainer-case-meta">
              <span>{activePhaseMeta.title}</span>
              <span>旋转 {rotationLabel(scenario?.rotation ?? 0)}</span>
            </div>
          </div>

          <div className="practice-card trainer-summary-card">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">阶段摘要</div>
                <div className="practice-kicker">SUMMARY</div>
              </div>
            </div>
            <div className="stat-grid">
              <div className="st st-primary"><div className="st-l">AO5</div><div className="st-v">{fmtShort(summary.avg5)}</div></div>
              <div className="st st-stable-score" tabIndex={0}>
                <div className="st-l">稳定成绩</div>
                <div className="st-v">{fmtShort(summary.stableScore)}</div>
                <span className="stable-score-popover" role="tooltip">
                  {stableScoreDescription}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="practice-center">
          <div className="practice-stage trainer-stage">
            <div ref={cubeMountRef} className="cube-mount" />
            <div className="stage-tools">
              {canUseFocusMode && (
                <button
                  className={`tag tag-btn${f2lFocusMode ? " active" : ""}`}
                  type="button"
                  onClick={toggleF2lFocusMode}
                  aria-keyshortcuts="H"
                  aria-pressed={f2lFocusMode}
                >
                  <span className="tag-key" aria-hidden="true">H</span>
                  专注模式
                </button>
              )}
              <button
                className={`tag tag-btn${gyroDisabled ? "" : " active"}`}
                type="button"
                onClick={toggleGyroDisabled}
                aria-keyshortcuts="L"
                aria-pressed={!gyroDisabled}
                aria-describedby={gyroCostNoticeVisible ? "gyro-cost-notice" : undefined}
              >
                <span className="tag-key" aria-hidden="true">L</span>
                {gyroDisabled ? "禁用陀螺仪" : "启用陀螺仪"}
              </button>
              <button
                className="tag tag-btn stage-reset-btn"
                type="button"
                onClick={resetDisplayOrientation}
                disabled={!canResetDisplayOrientation}
                aria-keyshortcuts="R"
              >
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
            <div className="stage-bottom-stack">
              {formulaHintVisible && (
                <div className="stage-hint trainer-formula-stage" role="status" aria-label="公式提示">
                  <div className="sh-head sh-head-scramble">
                    <div className="sh-kicker">公式提示</div>
                    {formulaHintUndoDisplay.length > 0 && (
                      <div className="sh-notice sh-notice-inline error">
                        <span className="sh-notice-label">撤销提示：请依次转</span>
                        <span className="sh-undo-list">
                          {[...formulaHintUndoDisplay].reverse().map((move, index) => (
                            <MoveToken key={`${move}-${index}`} move={move} />
                          ))}
                        </span>
                      </div>
                    )}
                    <div className="sh-actions">
                      <div className="sh-counter">
                        <span className="sh-counter-num">{formulaHintCounter}</span>
                        <span className="sh-counter-sep">/</span>
                        <span className="sh-counter-total">{formulaHintMoves.length}</span>
                      </div>
                    </div>
                  </div>
                  <div className="sh-grid">
                    {formulaHintMoves.map((move, index) => {
                      const stepStatus: AlgorithmStepStatus =
                        index === formulaHintIndex && (formulaHintWrong || formulaHintUndoDisplay.length > 0)
                          ? "wrong"
                          : formulaHintStatus[index] === "correct"
                            ? "correct"
                            : formulaHintStatus[index] === "partial"
                              ? "partial"
                              : "pending";
                      return (
                        <AlgorithmStepToken
                          key={`${move}-${index}`}
                          move={move}
                          index={index}
                          status={stepStatus}
                          active={index === formulaHintIndex && formulaHintIndex < formulaHintMoves.length}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="practice-right trainer-right">
          <div className={`timer timer-${state}`}>
            <div className="t-display t-active">{fmtTime(timerDisplayMs)}</div>
            <div className="t-phase">
              {autoNextPending
                ? `第 ${sessionRoundCount + 1}/${TRAINER_SESSION_ROUNDS} 局即将开始`
                : state === "cancelled"
                ? "本组已取消"
                : timerKind === "observe"
                  ? "观察 / 反应计时"
                  : state === "solving"
                    ? "阶段复原计时"
                    : sessionRoundCount >= TRAINER_SESSION_ROUNDS
                      ? "十局专项完成"
                      : "十局专项计时器"}
            </div>
          </div>

          <div className="timer-controls">
            <button
              className="practice-btn practice-btn-primary"
              type="button"
              onClick={startTraining}
              disabled={connecting}
              aria-keyshortcuts="Space"
            >
              <span>{canCancelTrainerAction ? "取消 · 按 SPACE" : connected ? "开始 · 按 SPACE" : "连接智能魔方"}</span>
            </button>
          </div>

          <div className="solve-metrics">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">成绩详情</div>
                <div className="practice-kicker">DETAILS</div>
              </div>
            </div>
            <div className="trainer-metric-grid">
              <div className="solve-phase-card">
                <span>平均观察</span>
                <b>{fmtShort(sessionAverageObserveMs)}</b>
              </div>
              <div className="solve-phase-card">
                <span>平均复原</span>
                <b>{fmtShort(sessionAverageSolveMs)}</b>
              </div>
              <div className="solve-phase-card">
                <span>本组进度</span>
                <b>{sessionRoundCount}/{TRAINER_SESSION_ROUNDS}</b>
              </div>
              <div className="solve-phase-card">
                <span>历史组数</span>
                <b>{summary.count}</b>
              </div>
            </div>
          </div>

          <div className="hist hist-right trainer-history">
            <div className="practice-card-head">
              <div className="practice-title-line">
                <div className="practice-card-title">专项记录</div>
                <div className="practice-kicker">HISTORY</div>
              </div>
            </div>
            {filteredHistory.length === 0 ? (
              <div className="hist-empty">暂无 {trainerPhaseShort(selectedPhase)} 阶段记录</div>
            ) : (
              <div
                className={`hist-list trainer-history-list${historyScrolling ? " scrolling" : ""}`}
                ref={historyListRef}
                style={{ "--history-rows": historyRows } as CSSProperties}
                onScroll={() => setHistoryScrolling(true)}
                onPointerLeave={() => setHistoryScrolling(false)}
              >
                {filteredHistory.map((entry, index) => {
                  const historyNumber = filteredHistory.length - index;
                  const isCrossRecord = entry.phase === "cross";
                  const totalMs = entry.observeMs + entry.solveMs;
                  const barMs = isCrossRecord ? entry.solveMs : totalMs;
                  const optionBadges = trainerHistoryOptionBadges(entry.options);
                  const optionTitle = trainerHistoryOptionsTitle(entry.options);
                  const barWidth = filteredHistoryStats.slowest > 0
                    ? `${Math.max(12, (barMs / filteredHistoryStats.slowest) * 100)}%`
                    : "0%";
                  const isBest = filteredHistoryStats.best === barMs;
                  const historyTitle = isCrossRecord
                    ? `${entry.rounds}局平均：观察 ${fmtShort(entry.observeMs)}，复原 ${fmtShort(entry.solveMs)}，${formatMoveAverage(entry.moves)}，${optionTitle}`
                    : `${entry.rounds}局平均：总用时 ${fmtShort(totalMs)}，${optionTitle}`;
                  return (
                    <div
                      key={`${entry.ts}-${index}`}
                      className={`hist-row trainer-history-row${isCrossRecord ? " trainer-history-row-cross" : " trainer-history-row-total"}${isBest ? " best" : ""}`}
                      tabIndex={0}
                      title={historyTitle}
                      aria-label={`专项记录 ${trainerPhaseShort(entry.phase)} #${historyNumber}，${historyTitle}`}
                    >
                      <span className="hr-i">{trainerPhaseShort(entry.phase)}#{String(historyNumber).padStart(2, "0")}</span>
                      <span className="hr-track" aria-hidden="true">
                        <span className="hr-bar" style={{ width: barWidth }}></span>
                      </span>
                      {isCrossRecord ? (
                        <>
                          <span className="trainer-history-value">观察 {fmtShort(entry.observeMs)}</span>
                          <span className="trainer-history-value">复原 {fmtShort(entry.solveMs)}</span>
                          <span className="trainer-history-value">步数 {formatMoveAverage(entry.moves)}</span>
                        </>
                      ) : (
                        <span className="trainer-history-total">总用时 {fmtShort(totalMs)}</span>
                      )}
                      <span className="trainer-history-options" aria-label={optionTitle}>
                        {optionBadges.length > 0
                          ? optionBadges.map((badge) => <b key={badge}>{badge}</b>)
                          : <b>标准</b>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
