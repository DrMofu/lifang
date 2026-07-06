"use client";

import {
  CUBE_APPEARANCE_KEY,
  CUBE_BACK_FACE_PROJECTION_DISTANCE_KEY,
  CUBE_BACK_FACE_PROJECTION_KEY,
  CUBE_COLOR_PALETTE_KEY,
  CUBE_RENDER_FPS_KEY,
  COLOR_LIST,
  COLOR_PALETTES,
  isValidOrientation,
  normalizeBackFaceProjectionDistance,
  type CubeColor,
  type CubeColorPaletteId,
  type CubeOrientation,
  type CubeRenderMaxFps,
} from "@/lib/cube-appearance";
import {
  DEFAULT_CONSOLE_LOGGING_SETTINGS,
  saveConsoleLoggingSettings,
  type ConsoleLoggingSettingKey,
  type ConsoleLoggingSettings,
} from "@/lib/console-logging";
import { saveAverageTimeSettings, type AverageTimeMethod, type AverageTimeSettings } from "@/lib/average-time";
import { getFormulaVariantKeys } from "@/lib/formulas-data";
import {
  getArchiveScopedStorageKey,
  loadDailyPracticeSeconds,
  normalizeDailyLevelEntry,
  saveDailyLevels,
  saveDailyPracticeSeconds,
  saveSolveHistory,
  trimSolveHistory,
  type CfopPhaseMetrics,
  type DailyLevelEntry,
  type DailyLevelSolve,
  type DailyPracticeEntry,
  type F2lSubphaseMetrics,
  type SolveHistoryEntry,
} from "@/lib/solve-history";
import {
  normalizePracticeInspectionSettings,
  savePracticeInspectionSettings,
  type PracticeInspectionMode,
  type PracticeInspectionSettings,
} from "@/lib/practice-inspection";

type MetricTuple = [number, number, number, number];
type CompactDailyTestTuple = [string, string, number, boolean];
type CompactSolveTuple = Array<number | string | boolean | null | MetricTuple | CompactDailyTestTuple>;
type CompactDailySolveTuple = Array<number | null>;
type CompactDailyLevelTuple = [string, string, number, number, CompactDailySolveTuple[]];
type CompactDailyPracticeTuple = [string, number, number];
type FormulaLearningStatus = "unpracticed" | "learning" | "mastered";
type FormulaLearningTuple = [string, FormulaLearningStatus];
type FormulaStatTuple = [string, number, number[], number | null, string | null, number | null];
type CompactAverageSettingsTuple = [AverageTimeMethod, number, number, number];
type CompactInspectionSettingsTuple = [PracticeInspectionMode, number];

export type FormulaExportData = {
  favorites: string[];
  learning: FormulaLearningTuple[];
  stats: FormulaStatTuple[];
  state: Record<string, unknown>;
  focusMode: boolean;
};

export type PreferencesExportData = {
  appearance: {
    palette: CubeColorPaletteId;
    orientation: CubeOrientation;
    fps: CubeRenderMaxFps;
    backFaceProjection: boolean;
    backFaceProjectionDistance: number;
  };
  practice: {
    average: CompactAverageSettingsTuple;
    inspection: CompactInspectionSettingsTuple;
    gyroDisabled: boolean;
  };
  console: boolean[];
};

export type UserDataExportPayload = {
  version: 3;
  exportedAt: string;
  archive: {
    id: string;
    name: string;
  };
  schema: typeof USER_DATA_EXPORT_SCHEMA;
  practice: {
    history: CompactSolveTuple[];
    dailyLevels: CompactDailyLevelTuple[];
    dailyPractice?: CompactDailyPracticeTuple[];
  };
  formulas: FormulaExportData;
  preferences: PreferencesExportData;
};

export type ParsedUserDataImport = {
  version: 3;
  history: SolveHistoryEntry[];
  dailyLevels: DailyLevelEntry[];
  dailyPractice: DailyPracticeEntry[];
  formulas: FormulaExportData;
  preferences: PreferencesExportData;
};

const CFOP_PHASE_KEYS = ["cross", "f2l", "oll", "pll"] as const;
const F2L_SUBPHASE_KEYS = ["one", "two", "three", "four"] as const;
const FORMULA_FAVS_KEY = "formula-favs";
const FORMULA_STATE_KEY = "formula-state";
const FORMULA_STATS_KEY = "formula-practice-stats";
const FORMULA_LEARNING_STATUS_KEY = "formula-learning-status";
const FORMULA_FOCUS_MODE_KEY = "formula-focus-mode";
const PRACTICE_GYRO_DISABLED_KEY = "cube-practice-gyro-disabled";
export const USER_DATA_PACKAGE_UPDATED_AT_KEY = "cube-user-data-package-updated-at";
const FORMULA_SCOPED_DATA_KEYS = [
  FORMULA_FAVS_KEY,
  FORMULA_LEARNING_STATUS_KEY,
  FORMULA_STATS_KEY,
  FORMULA_STATE_KEY,
] as const;

export const USER_DATA_EXPORT_SCHEMA = {
  solve: ["ms", "ts", "mode", "moves", "daily", "cfopTime", "cfopMoves", "f2lTime", "f2lMoves"],
  daily: ["id", "date", "completedAt", "avg", "solves"],
  dailySolve: ["ms", "ts", "moves"],
  dailyPractice: ["date", "seconds", "updatedAt"],
  formulaStat: ["key", "count", "times", "best", "today", "todayCount"],
  console: ["enabled", "logSentCommands", "logMove", "logGyro", "logFacelets", "logBattery", "logHardware", "logDisconnect"],
} as const;

export const CONSOLE_SETTING_KEYS: ConsoleLoggingSettingKey[] = [
  "enabled",
  "logSentCommands",
  "logMove",
  "logGyro",
  "logFacelets",
  "logBattery",
  "logHardware",
  "logDisconnect",
];

function normalizeTimestamp(value: unknown): string | null {
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Date.parse(value)
          : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function timestampMs(value: unknown): number | null {
  const normalized = normalizeTimestamp(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getLocalUserDataPackageUpdatedAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeTimestamp(window.localStorage.getItem(getArchiveScopedStorageKey(USER_DATA_PACKAGE_UPDATED_AT_KEY)));
  } catch {
    return null;
  }
}

export function touchLocalUserDataPackageUpdatedAt(date: Date | string | number = new Date(), archiveId?: string): string | null {
  if (typeof window === "undefined") return null;
  const normalized = normalizeTimestamp(date) ?? new Date().toISOString();
  try {
    window.localStorage.setItem(getArchiveScopedStorageKey(USER_DATA_PACKAGE_UPDATED_AT_KEY, archiveId), normalized);
    return normalized;
  } catch {
    return normalized;
  }
}

export function getPayloadTimestamp(payload: Pick<UserDataExportPayload, "exportedAt"> | null | undefined, fallback?: unknown) {
  return normalizeTimestamp(payload?.exportedAt) ?? normalizeTimestamp(fallback);
}

export function isNewerTimestamp(left: unknown, right: unknown) {
  const leftMs = timestampMs(left);
  const rightMs = timestampMs(right);
  if (leftMs == null) return false;
  if (rightMs == null) return true;
  return leftMs > rightMs;
}

function isMetricNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}

function roundMetricTuple(values: MetricTuple): MetricTuple {
  return values.map(roundMs) as MetricTuple;
}

function isMetricTuple(value: unknown): value is MetricTuple {
  return Array.isArray(value) && value.length === 4 && value.every(isMetricNumber);
}

function cfopMetricsToTuple(metrics: CfopPhaseMetrics | undefined): MetricTuple | undefined {
  if (!metrics) return undefined;
  const values = CFOP_PHASE_KEYS.map((key) => metrics[key]);
  return isMetricTuple(values) ? roundMetricTuple(values) : undefined;
}

function f2lMetricsToTuple(metrics: F2lSubphaseMetrics | undefined, roundValues = true): MetricTuple | undefined {
  if (!metrics) return undefined;
  const values = F2L_SUBPHASE_KEYS.map((key) => metrics[key]);
  if (!isMetricTuple(values)) return undefined;
  return roundValues ? roundMetricTuple(values) : values;
}

function cfopMoveMetricsToTuple(metrics: CfopPhaseMetrics | undefined): MetricTuple | undefined {
  if (!metrics) return undefined;
  const values = CFOP_PHASE_KEYS.map((key) => metrics[key]);
  return isMetricTuple(values) ? values : undefined;
}

function tupleToCfopMetrics(values: MetricTuple): CfopPhaseMetrics {
  return {
    cross: values[0],
    f2l: values[1],
    oll: values[2],
    pll: values[3],
  };
}

function tupleToF2lMetrics(values: MetricTuple): F2lSubphaseMetrics {
  return {
    one: values[0],
    two: values[1],
    three: values[2],
    four: values[3],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactRow<T>(values: T[]) {
  const next = [...values];
  while (next.length > 0 && next[next.length - 1] == null) {
    next.pop();
  }
  return next;
}

export function readScopedJson(key: string, fallback: unknown) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(getArchiveScopedStorageKey(key));
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeScopedJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getArchiveScopedStorageKey(key), JSON.stringify(value));
}

function writeScopedRaw(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getArchiveScopedStorageKey(key), value);
}

function isScopedFormulaDataKey(key: string) {
  return FORMULA_SCOPED_DATA_KEYS.some((baseKey) => key === baseKey || key.startsWith(`${baseKey}:`));
}

function sanitizeFormulaState(state: Record<string, unknown>, validFormulaKeys = getFormulaVariantKeys()) {
  const next = { ...state };
  if (typeof next.activeId === "string" && !validFormulaKeys.has(next.activeId)) {
    delete next.activeId;
  }
  return next;
}

function compactMode(mode: SolveHistoryEntry["mode"]) {
  if (mode === "scramble") return "s";
  if (mode === "free") return "f";
  return null;
}

function expandMode(mode: unknown): SolveHistoryEntry["mode"] | undefined {
  if (mode === "s") return "scramble";
  if (mode === "f") return "free";
  return undefined;
}

function serializeDailyTestMetadata(metadata: SolveHistoryEntry["dailyTest"]): CompactDailyTestTuple | null {
  return metadata ? [metadata.id, metadata.localDate, metadata.index, metadata.completed] : null;
}

function parseCompactDailyTestMetadata(value: unknown): NonNullable<SolveHistoryEntry["dailyTest"]> | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [id, localDate, index, completed] = value;
  if (
    typeof id !== "string" ||
    typeof localDate !== "string" ||
    typeof index !== "number" ||
    typeof completed !== "boolean"
  ) {
    return null;
  }
  return { id, localDate, index, completed };
}

function serializeCompactSolveHistoryEntry(entry: SolveHistoryEntry): CompactSolveTuple {
  return compactRow([
    roundMs(entry.ms),
    entry.ts,
    compactMode(entry.mode),
    typeof entry.moves === "number" ? entry.moves : null,
    serializeDailyTestMetadata(entry.dailyTest),
    cfopMetricsToTuple(entry.cfop) ?? null,
    cfopMoveMetricsToTuple(entry.cfopMoves) ?? null,
    f2lMetricsToTuple(entry.cfopF2l) ?? null,
    f2lMetricsToTuple(entry.cfopF2lMoves, false) ?? null,
  ]);
}

function parseCompactSolveHistoryEntry(value: unknown): SolveHistoryEntry | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [ms] = value;
  if (typeof ms !== "number") return null;
  const legacyHasScramble = typeof value[1] === "string";
  const [ts, mode, moves, dailyTest, cfopTime, cfopMoves, cfopF2lTime, cfopF2lMoves] = legacyHasScramble
    ? value.slice(2)
    : value.slice(1);
  if (typeof ts !== "number") return null;
  const parsed: SolveHistoryEntry = { ms, ts };
  const parsedMode = expandMode(mode);
  if (mode != null && !parsedMode) return null;
  if (parsedMode) parsed.mode = parsedMode;
  if (moves != null) {
    if (typeof moves !== "number") return null;
    parsed.moves = moves;
  }
  if (dailyTest != null) {
    const parsedDailyTest = parseCompactDailyTestMetadata(dailyTest);
    if (!parsedDailyTest) return null;
    parsed.dailyTest = parsedDailyTest;
  }
  if (cfopTime != null) {
    if (!isMetricTuple(cfopTime)) return null;
    parsed.cfop = tupleToCfopMetrics(cfopTime);
  }
  if (cfopMoves != null) {
    if (!isMetricTuple(cfopMoves)) return null;
    parsed.cfopMoves = tupleToCfopMetrics(cfopMoves);
  }
  if (cfopF2lTime != null) {
    if (!isMetricTuple(cfopF2lTime)) return null;
    parsed.cfopF2l = tupleToF2lMetrics(cfopF2lTime);
  }
  if (cfopF2lMoves != null) {
    if (!isMetricTuple(cfopF2lMoves)) return null;
    parsed.cfopF2lMoves = tupleToF2lMetrics(cfopF2lMoves);
  }
  return parsed;
}

function serializeCompactDailySolve(solve: DailyLevelSolve): CompactDailySolveTuple {
  return compactRow([roundMs(solve.ms), solve.ts, typeof solve.moves === "number" ? solve.moves : null]);
}

function parseCompactDailySolve(value: unknown): DailyLevelSolve | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [ms] = value;
  if (typeof ms !== "number") return null;
  const legacyHasScramble = typeof value[1] === "string";
  const [ts, moves] = legacyHasScramble ? value.slice(2) : value.slice(1);
  if (typeof ts !== "number") return null;
  const parsed: DailyLevelSolve = { ms, ts };
  if (moves != null) {
    if (typeof moves !== "number") return null;
    parsed.moves = moves;
  }
  return parsed;
}

function serializeCompactDailyLevel(entry: DailyLevelEntry): CompactDailyLevelTuple {
  const normalized = normalizeDailyLevelEntry(entry) ?? entry;
  return [normalized.id, normalized.localDate, normalized.completedAt, roundMs(normalized.averageMs), normalized.solves.map(serializeCompactDailySolve)];
}

function parseCompactDailyLevel(value: unknown): DailyLevelEntry | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const [id, localDate, completedAt, averageMs, solves] = value;
  if (
    typeof id !== "string" ||
    typeof localDate !== "string" ||
    typeof completedAt !== "number" ||
    typeof averageMs !== "number" ||
    !Array.isArray(solves)
  ) {
    return null;
  }
  const parsedSolves = solves.map(parseCompactDailySolve);
  if (parsedSolves.some((solve) => solve === null)) return null;
  return normalizeDailyLevelEntry({ id, localDate, completedAt, averageMs, solves: parsedSolves as DailyLevelSolve[] });
}

function serializeCompactDailyPractice(entry: DailyPracticeEntry): CompactDailyPracticeTuple {
  return [entry.localDate, Math.max(0, Math.round(entry.seconds)), entry.updatedAt];
}

function parseCompactDailyPractice(value: unknown): DailyPracticeEntry | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [localDate, seconds, updatedAt] = value;
  if (
    typeof localDate !== "string" ||
    typeof seconds !== "number" ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(updatedAt) ||
    seconds < 0
  ) {
    return null;
  }
  return {
    localDate,
    seconds: Math.round(seconds),
    updatedAt,
  };
}

function isFormulaLearningStatus(value: unknown): value is FormulaLearningStatus {
  return value === "unpracticed" || value === "learning" || value === "mastered";
}

function isFormulaStatTuple(value: unknown): value is FormulaStatTuple {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number" &&
    Array.isArray(value[2]) &&
    value[2].every((time) => typeof time === "number" && Number.isFinite(time) && time > 0) &&
    (value[3] == null || typeof value[3] === "number") &&
    (value[4] == null || typeof value[4] === "string") &&
    (value[5] == null || typeof value[5] === "number")
  );
}

export function readFormulaExportData(): FormulaExportData {
  const rawFavorites = readScopedJson(FORMULA_FAVS_KEY, []);
  const rawLearning = readScopedJson(FORMULA_LEARNING_STATUS_KEY, {});
  const rawStats = readScopedJson(FORMULA_STATS_KEY, {});
  const rawState = readScopedJson(FORMULA_STATE_KEY, {});
  const favorites = Array.isArray(rawFavorites)
    ? [...new Set(rawFavorites.filter((item): item is string => typeof item === "string"))]
    : [];
  const learning = isRecord(rawLearning)
    ? Object.entries(rawLearning).filter((entry): entry is FormulaLearningTuple => typeof entry[0] === "string" && isFormulaLearningStatus(entry[1]))
    : [];
  const stats = isRecord(rawStats)
    ? Object.entries(rawStats)
        .map(([key, value]) => {
          if (!isRecord(value) || typeof value.count !== "number" || !Array.isArray(value.times)) return null;
          const times = value.times
            .filter((time): time is number => typeof time === "number" && Number.isFinite(time) && time > 0)
            .map(roundMs);
          return [
            key,
            value.count,
            times,
            typeof value.bestMs === "number" ? roundMs(value.bestMs) : null,
            typeof value.todayKey === "string" ? value.todayKey : null,
            typeof value.todayCount === "number" ? value.todayCount : null,
          ] satisfies FormulaStatTuple;
        })
        .filter((entry): entry is FormulaStatTuple => entry !== null)
    : [];
  return {
    favorites,
    learning,
    stats,
    state: isRecord(rawState) ? rawState : {},
    focusMode: typeof window !== "undefined" && window.localStorage.getItem(getArchiveScopedStorageKey(FORMULA_FOCUS_MODE_KEY)) === "1",
  };
}

export function hasFormulaExportData(formulas: FormulaExportData) {
  return formulas.favorites.length > 0 || formulas.learning.length > 0 || formulas.stats.length > 0 || Object.keys(formulas.state).length > 0 || formulas.focusMode;
}

function parseFormulaExportData(value: unknown): FormulaExportData | null {
  if (!isRecord(value)) return null;
  const { favorites, learning, stats, state, focusMode } = value;
  if (
    !Array.isArray(favorites) ||
    !favorites.every((item) => typeof item === "string") ||
    !Array.isArray(learning) ||
    !learning.every(
      (entry): entry is FormulaLearningTuple =>
        Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && isFormulaLearningStatus(entry[1]),
    ) ||
    !Array.isArray(stats) ||
    !stats.every(isFormulaStatTuple) ||
    !isRecord(state) ||
    typeof focusMode !== "boolean"
  ) {
    return null;
  }
  return {
    favorites: [...new Set(favorites)],
    learning,
    stats,
    state,
    focusMode,
  };
}

export type DeprecatedFormulaDataCleanupResult = {
  favorites: number;
  learning: number;
  stats: number;
  state: number;
};

export function cleanupDeprecatedFormulaLocalStorage(): DeprecatedFormulaDataCleanupResult {
  const result: DeprecatedFormulaDataCleanupResult = {
    favorites: 0,
    learning: 0,
    stats: 0,
    state: 0,
  };
  if (typeof window === "undefined") return result;

  const validFormulaKeys = getFormulaVariantKeys();
  const validFormulaStatsKeys = new Set([
    ...validFormulaKeys,
    ...Array.from(getFormulaVariantKeys("f2l")).flatMap((key) => [
      `${key}@view-y`,
      `${key}@view-y2`,
      `${key}@view-y-prime`,
    ]),
  ]);

  function writeIfChanged(key: string, before: unknown, after: unknown) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    window.localStorage.setItem(key, JSON.stringify(after));
  }

  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => typeof key === "string" && isScopedFormulaDataKey(key));

    keys.forEach((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      if (storageKey === FORMULA_FAVS_KEY || storageKey.startsWith(`${FORMULA_FAVS_KEY}:`)) {
        if (!Array.isArray(parsed)) return;
        const before = parsed.filter((item): item is string => typeof item === "string");
        const after = [...new Set(before.filter((key) => validFormulaKeys.has(key)))];
        result.favorites += Math.max(0, before.length - after.length);
        writeIfChanged(storageKey, parsed, after);
        return;
      }

      if (storageKey === FORMULA_LEARNING_STATUS_KEY || storageKey.startsWith(`${FORMULA_LEARNING_STATUS_KEY}:`)) {
        if (!isRecord(parsed)) return;
        const before = Object.entries(parsed);
        const after = Object.fromEntries(before.filter(([key, status]) => validFormulaKeys.has(key) && isFormulaLearningStatus(status)));
        result.learning += Math.max(0, before.length - Object.keys(after).length);
        writeIfChanged(storageKey, parsed, after);
        return;
      }

      if (storageKey === FORMULA_STATS_KEY || storageKey.startsWith(`${FORMULA_STATS_KEY}:`)) {
        if (!isRecord(parsed)) return;
        const before = Object.entries(parsed);
        const after = Object.fromEntries(before.filter(([key]) => validFormulaStatsKeys.has(key)));
        result.stats += Math.max(0, before.length - Object.keys(after).length);
        writeIfChanged(storageKey, parsed, after);
        return;
      }

      if (storageKey === FORMULA_STATE_KEY || storageKey.startsWith(`${FORMULA_STATE_KEY}:`)) {
        if (!isRecord(parsed)) return;
        const after = sanitizeFormulaState(parsed, validFormulaKeys);
        if (typeof parsed.activeId === "string" && parsed.activeId !== after.activeId) {
          result.state += 1;
        }
        writeIfChanged(storageKey, parsed, after);
      }
    });
  } catch {
    return result;
  }

  return result;
}

export function writeFormulaExportData(formulas: FormulaExportData) {
  const stats = Object.fromEntries(
    formulas.stats.map(([key, count, times, bestMs, todayKey, todayCount]) => [
      key,
      {
        count,
        times,
        ...(bestMs == null ? {} : { bestMs }),
        ...(todayKey == null ? {} : { todayKey }),
        ...(todayCount == null ? {} : { todayCount }),
      },
    ]),
  );
  writeScopedJson(FORMULA_FAVS_KEY, formulas.favorites);
  writeScopedJson(FORMULA_LEARNING_STATUS_KEY, Object.fromEntries(formulas.learning));
  writeScopedJson(FORMULA_STATS_KEY, stats);
  writeScopedJson(FORMULA_STATE_KEY, formulas.state);
  writeScopedRaw(FORMULA_FOCUS_MODE_KEY, formulas.focusMode ? "1" : "0");
}

function isAverageTimeMethod(value: unknown): value is AverageTimeMethod {
  return value === "trimmed" || value === "arithmetic" || value === "median";
}

function isPracticeInspectionMode(value: unknown): value is PracticeInspectionMode {
  return value === "timed" || value === "unlimited";
}

function isAverageSettingsTuple(value: unknown): value is CompactAverageSettingsTuple {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    isAverageTimeMethod(value[0]) &&
    typeof value[1] === "number" &&
    typeof value[2] === "number" &&
    typeof value[3] === "number"
  );
}

function isInspectionSettingsTuple(value: unknown): value is CompactInspectionSettingsTuple {
  return Array.isArray(value) && value.length === 2 && isPracticeInspectionMode(value[0]) && typeof value[1] === "number";
}

function isCubeOrientation(value: unknown): value is CubeOrientation {
  return (
    isRecord(value) &&
    typeof value.top === "string" &&
    typeof value.front === "string" &&
    COLOR_LIST.includes(value.top as CubeColor) &&
    COLOR_LIST.includes(value.front as CubeColor) &&
    isValidOrientation(value.top as CubeColor, value.front as CubeColor)
  );
}

function isCubeColorPaletteIdValue(value: unknown): value is CubeColorPaletteId {
  return typeof value === "string" && value in COLOR_PALETTES;
}

function isCubeRenderMaxFpsValue(value: unknown): value is CubeRenderMaxFps {
  return value === null || value === 30 || value === 60 || value === 120;
}

function parsePreferencesExportData(value: unknown): PreferencesExportData | null {
  if (!isRecord(value) || !isRecord(value.appearance) || !isRecord(value.practice) || !Array.isArray(value.console)) return null;
  const { appearance, practice } = value;
  const consoleSettings = value.console;
  if (
    !isCubeColorPaletteIdValue(appearance.palette) ||
    !isCubeOrientation(appearance.orientation) ||
    !isCubeRenderMaxFpsValue(appearance.fps) ||
    !isAverageSettingsTuple(practice.average) ||
    !isInspectionSettingsTuple(practice.inspection) ||
    typeof appearance.backFaceProjection !== "boolean" ||
    (
      appearance.backFaceProjectionDistance !== undefined &&
      !Number.isFinite(Number(appearance.backFaceProjectionDistance))
    ) ||
    typeof practice.gyroDisabled !== "boolean" ||
    !consoleSettings.every((item) => typeof item === "boolean")
  ) {
    return null;
  }
  return {
    appearance: {
      palette: appearance.palette,
      orientation: appearance.orientation,
      fps: appearance.fps,
      backFaceProjection: appearance.backFaceProjection,
      backFaceProjectionDistance: normalizeBackFaceProjectionDistance(appearance.backFaceProjectionDistance),
    },
    practice: {
      average: practice.average,
      inspection: practice.inspection,
      gyroDisabled: practice.gyroDisabled,
    },
    console: CONSOLE_SETTING_KEYS.map((_, index) => consoleSettings[index] === true),
  };
}

export function writePreferencesExportData(preferences: PreferencesExportData) {
  writeScopedJson(CUBE_APPEARANCE_KEY, preferences.appearance.orientation);
  writeScopedJson(CUBE_COLOR_PALETTE_KEY, preferences.appearance.palette);
  writeScopedJson(CUBE_RENDER_FPS_KEY, preferences.appearance.fps);
  writeScopedJson(CUBE_BACK_FACE_PROJECTION_KEY, preferences.appearance.backFaceProjection);
  writeScopedJson(CUBE_BACK_FACE_PROJECTION_DISTANCE_KEY, preferences.appearance.backFaceProjectionDistance);
  saveAverageTimeSettings({
    method: preferences.practice.average[0],
    sampleSize: preferences.practice.average[1],
    trimBest: preferences.practice.average[2],
    trimWorst: preferences.practice.average[3],
  });
  savePracticeInspectionSettings({
    mode: preferences.practice.inspection[0],
    seconds: preferences.practice.inspection[1],
  });
  writeScopedJson(PRACTICE_GYRO_DISABLED_KEY, preferences.practice.gyroDisabled);
  saveConsoleLoggingSettings(
    CONSOLE_SETTING_KEYS.reduce<ConsoleLoggingSettings>(
      (settings, key, index) => ({ ...settings, [key]: preferences.console[index] === true }),
      { ...DEFAULT_CONSOLE_LOGGING_SETTINGS },
    ),
  );
}

export function buildPreferencesExportData(args: {
  orientation: CubeOrientation;
  colorPaletteId: CubeColorPaletteId;
  renderMaxFps: CubeRenderMaxFps;
  backFaceProjectionEnabled: boolean;
  backFaceProjectionDistance: number;
  averageSettings: AverageTimeSettings;
  inspectionSettings: PracticeInspectionSettings;
  consoleLoggingSettings: ConsoleLoggingSettings;
}): PreferencesExportData {
  return {
    appearance: {
      palette: args.colorPaletteId,
      orientation: args.orientation,
      fps: args.renderMaxFps,
      backFaceProjection: args.backFaceProjectionEnabled,
      backFaceProjectionDistance: normalizeBackFaceProjectionDistance(args.backFaceProjectionDistance),
    },
    practice: {
      average: [args.averageSettings.method, args.averageSettings.sampleSize, args.averageSettings.trimBest, args.averageSettings.trimWorst],
      inspection: [args.inspectionSettings.mode, args.inspectionSettings.seconds],
      gyroDisabled: readScopedJson(PRACTICE_GYRO_DISABLED_KEY, false) === true,
    },
    console: CONSOLE_SETTING_KEYS.map((key) => args.consoleLoggingSettings[key]),
  };
}

export function buildUserDataExportPayload(args: {
  activeArchiveId: string;
  activeArchiveName: string;
  history: SolveHistoryEntry[];
  dailyLevels: DailyLevelEntry[];
  dailyPractice?: DailyPracticeEntry[];
  orientation: CubeOrientation;
  colorPaletteId: CubeColorPaletteId;
  renderMaxFps: CubeRenderMaxFps;
  backFaceProjectionEnabled: boolean;
  backFaceProjectionDistance: number;
  averageSettings: AverageTimeSettings;
  inspectionSettings: PracticeInspectionSettings;
  consoleLoggingSettings: ConsoleLoggingSettings;
}): UserDataExportPayload {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    archive: {
      id: args.activeArchiveId,
      name: args.activeArchiveName,
    },
    schema: USER_DATA_EXPORT_SCHEMA,
    practice: {
      history: args.history.map(serializeCompactSolveHistoryEntry),
      dailyLevels: args.dailyLevels.map(serializeCompactDailyLevel),
      dailyPractice: (args.dailyPractice ?? loadDailyPracticeSeconds()).map(serializeCompactDailyPractice),
    },
    formulas: readFormulaExportData(),
    preferences: buildPreferencesExportData(args),
  };
}

export function parseUserDataImport(parsed: unknown): ParsedUserDataImport | null {
  if (!parsed || typeof parsed !== "object") return null;
  const payload = parsed as Record<string, unknown>;
  if (payload.version !== 3 || !isRecord(payload.practice)) return null;
  const rawHistory = payload.practice.history;
  const rawDailyLevels = payload.practice.dailyLevels;
  const rawDailyPractice = payload.practice.dailyPractice;
  const formulas = parseFormulaExportData(payload.formulas);
  const preferences = parsePreferencesExportData(payload.preferences);
  if (
    !Array.isArray(rawHistory) ||
    !Array.isArray(rawDailyLevels) ||
    (rawDailyPractice != null && !Array.isArray(rawDailyPractice)) ||
    !formulas ||
    !preferences
  ) {
    return null;
  }
  const history = rawHistory.map(parseCompactSolveHistoryEntry);
  const dailyLevels = rawDailyLevels.map(parseCompactDailyLevel);
  const dailyPractice = rawDailyPractice == null ? [] : rawDailyPractice.map(parseCompactDailyPractice);
  if (
    history.some((entry) => entry === null) ||
    dailyLevels.some((entry) => entry === null) ||
    dailyPractice.some((entry) => entry === null)
  ) {
    return null;
  }
  return {
    version: 3,
    history: history as SolveHistoryEntry[],
    dailyLevels: dailyLevels as DailyLevelEntry[],
    dailyPractice: dailyPractice as DailyPracticeEntry[],
    formulas,
    preferences,
  };
}

export function applyUserDataImport(imported: ParsedUserDataImport) {
  const trimmed = trimSolveHistory(imported.history);
  saveSolveHistory(trimmed);
  saveDailyLevels(imported.dailyLevels);
  saveDailyPracticeSeconds(imported.dailyPractice);
  writeFormulaExportData(imported.formulas);
  writePreferencesExportData(imported.preferences);
  return {
    history: trimmed,
    dailyLevels: imported.dailyLevels,
    dailyPractice: imported.dailyPractice,
    hasFormulaData: hasFormulaExportData(imported.formulas),
    averageSettings: {
      method: imported.preferences.practice.average[0],
      sampleSize: imported.preferences.practice.average[1],
      trimBest: imported.preferences.practice.average[2],
      trimWorst: imported.preferences.practice.average[3],
    } satisfies AverageTimeSettings,
    inspectionSettings: normalizePracticeInspectionSettings({
      mode: imported.preferences.practice.inspection[0],
      seconds: imported.preferences.practice.inspection[1],
    }),
    consoleLoggingSettings: CONSOLE_SETTING_KEYS.reduce<ConsoleLoggingSettings>(
      (settings, key, index) => ({ ...settings, [key]: imported.preferences.console[index] === true }),
      { ...DEFAULT_CONSOLE_LOGGING_SETTINGS },
    ),
  };
}
