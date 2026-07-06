export const MISSING_HISTORY_VALUE = "—";
export type HistoryMetricValue = number | typeof MISSING_HISTORY_VALUE;
export type CfopPhaseMetrics = {
  cross: HistoryMetricValue;
  f2l: HistoryMetricValue;
  oll: HistoryMetricValue;
  pll: HistoryMetricValue;
};

export type F2lSubphaseMetrics = {
  one: HistoryMetricValue;
  two: HistoryMetricValue;
  three: HistoryMetricValue;
  four: HistoryMetricValue;
};

export type SolveHistoryEntry = {
  ms: number;
  ts: number;
  mode?: "scramble" | "free";
  moves?: number;
  dailyTest?: {
    id: string;
    localDate: string;
    index: number;
    completed: boolean;
  };
  cfop?: CfopPhaseMetrics;
  cfopMoves?: CfopPhaseMetrics;
  cfopF2l?: F2lSubphaseMetrics;
  cfopF2lMoves?: F2lSubphaseMetrics;
};

export type DailyLevelSolve = {
  ms: number;
  ts: number;
  moves?: number;
};

export type DailyLevelEntry = {
  id: string;
  localDate: string;
  completedAt: number;
  averageMs: number;
  solves: DailyLevelSolve[];
};

export type DailyPracticeEntry = {
  localDate: string;
  seconds: number;
  updatedAt: number;
};

export type PendingPracticeSession = {
  archiveId: string;
  startAt: number;
  lastMoveAt: number;
};

export const CUBE_HISTORY_KEY = "cube-history";
export const DAILY_LEVELS_KEY = "cube-daily-levels";
export const DAILY_PRACTICE_SECONDS_KEY = "cube-daily-practice-seconds";
export const PRACTICE_PENDING_SESSION_KEY = "cube-practice-pending-session";
export const STATISTICS_ARCHIVES_KEY = "cube-stat-archives";
export const ACTIVE_STATISTICS_ARCHIVE_KEY = "cube-active-stat-archive";
export const STATISTICS_ARCHIVE_CHANGE_EVENT = "cube-stat-archive-change";
const ARCHIVE_SCOPED_STORAGE_KEYS = [
  CUBE_HISTORY_KEY,
  DAILY_LEVELS_KEY,
  DAILY_PRACTICE_SECONDS_KEY,
  "cube-appearance",
  "cube-color-palette",
  "cube-render-fps-limit",
  "cube-back-face-projection",
  "cube-back-face-projection-distance",
  "average-time-settings",
  "cube-practice-inspection-settings",
  "cube-console-logging-settings",
  "cube-practice-gyro-disabled",
  "cube-practice-display-state",
  "cube-user-data-package-updated-at",
  "cube-visual-state",
  "formula-favs",
  "formula-state",
  "formula-practice-stats",
  "formula-learning-status",
  "formula-focus-mode",
  "cfop-stage-training-history",
] as const;

export type StatisticsArchive = {
  id: string;
  name: string;
  createdAt: number;
};

export const DEFAULT_STATISTICS_ARCHIVE_ID = "default";
const DEFAULT_STATISTICS_ARCHIVE: StatisticsArchive = {
  id: DEFAULT_STATISTICS_ARCHIVE_ID,
  name: "默认存档",
  createdAt: 0,
};

const EMPTY_CFOP_PHASE_METRICS: CfopPhaseMetrics = {
  cross: MISSING_HISTORY_VALUE,
  f2l: MISSING_HISTORY_VALUE,
  oll: MISSING_HISTORY_VALUE,
  pll: MISSING_HISTORY_VALUE,
};

const EMPTY_F2L_SUBPHASE_METRICS: F2lSubphaseMetrics = {
  one: MISSING_HISTORY_VALUE,
  two: MISSING_HISTORY_VALUE,
  three: MISSING_HISTORY_VALUE,
  four: MISSING_HISTORY_VALUE,
};

export function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getDailyTestDateKey(date = new Date()) {
  return getLocalDateKey(date);
}

export function getArchiveScopedStorageKey(baseKey: string, archiveId = getActiveStatisticsArchiveId()) {
  return archiveId === DEFAULT_STATISTICS_ARCHIVE_ID ? baseKey : `${baseKey}:${archiveId}`;
}

function isStatisticsArchive(value: unknown): value is StatisticsArchive {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.createdAt === "number"
  );
}

function normalizeStatisticsArchives(value: unknown): StatisticsArchive[] {
  const byId = new Map<string, StatisticsArchive>();
  byId.set(DEFAULT_STATISTICS_ARCHIVE_ID, DEFAULT_STATISTICS_ARCHIVE);

  if (Array.isArray(value)) {
    value.forEach((archive) => {
      if (!isStatisticsArchive(archive)) return;
      byId.set(archive.id, {
        id: archive.id,
        name: archive.name.trim() || DEFAULT_STATISTICS_ARCHIVE.name,
        createdAt: archive.id === DEFAULT_STATISTICS_ARCHIVE_ID ? DEFAULT_STATISTICS_ARCHIVE.createdAt : archive.createdAt,
      });
    });
  }

  return Array.from(byId.values()).sort((left, right) => {
    if (left.id === DEFAULT_STATISTICS_ARCHIVE_ID) return -1;
    if (right.id === DEFAULT_STATISTICS_ARCHIVE_ID) return 1;
    return left.createdAt - right.createdAt;
  });
}

function saveStatisticsArchives(archives: StatisticsArchive[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATISTICS_ARCHIVES_KEY, JSON.stringify(normalizeStatisticsArchives(archives)));
  } catch {
    // Local storage can be unavailable in private contexts.
  }
}

function emitStatisticsArchiveChange() {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(STATISTICS_ARCHIVE_CHANGE_EVENT));
  }, 0);
}

export function loadStatisticsArchives(): StatisticsArchive[] {
  if (typeof window === "undefined") return [DEFAULT_STATISTICS_ARCHIVE];
  try {
    const raw = window.localStorage.getItem(STATISTICS_ARCHIVES_KEY);
    const archives = normalizeStatisticsArchives(JSON.parse(raw || "null"));
    const normalized = JSON.stringify(archives);
    if (raw !== normalized) {
      try {
        window.localStorage.setItem(STATISTICS_ARCHIVES_KEY, normalized);
      } catch {
        // Keep the normalized in-memory archive list even if localStorage cannot be updated.
      }
    }
    return archives;
  } catch {
    return [DEFAULT_STATISTICS_ARCHIVE];
  }
}

export function getActiveStatisticsArchiveId() {
  if (typeof window === "undefined") return DEFAULT_STATISTICS_ARCHIVE_ID;
  const archives = loadStatisticsArchives();
  const archiveIds = new Set(archives.map((archive) => archive.id));
  try {
    const activeId = window.localStorage.getItem(ACTIVE_STATISTICS_ARCHIVE_KEY) || DEFAULT_STATISTICS_ARCHIVE_ID;
    if (archiveIds.has(activeId)) return activeId;
  } catch {
    // Fall through to the default archive.
  }
  return DEFAULT_STATISTICS_ARCHIVE_ID;
}

export function getActiveStatisticsArchive() {
  const activeId = getActiveStatisticsArchiveId();
  return loadStatisticsArchives().find((archive) => archive.id === activeId) ?? DEFAULT_STATISTICS_ARCHIVE;
}

export function setActiveStatisticsArchive(id: string) {
  if (typeof window === "undefined") return getActiveStatisticsArchive();
  const archives = loadStatisticsArchives();
  const nextActive = archives.find((archive) => archive.id === id) ?? DEFAULT_STATISTICS_ARCHIVE;
  try {
    window.localStorage.setItem(ACTIVE_STATISTICS_ARCHIVE_KEY, nextActive.id);
  } catch {
    // Local storage can be unavailable in private contexts.
  }
  emitStatisticsArchiveChange();
  return nextActive;
}

export function createStatisticsArchive() {
  const archives = loadStatisticsArchives();
  const existingIds = new Set(archives.map((archive) => archive.id));
  const createdAt = Date.now();
  let index = archives.length + 1;
  let id = `archive-${createdAt}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `archive-${createdAt}-${index}`;
  }
  const archive: StatisticsArchive = {
    id,
    name: `存档 ${archives.length + 1}`,
    createdAt,
  };
  const nextArchives = [...archives, archive];
  saveStatisticsArchives(nextArchives);
  setActiveStatisticsArchive(archive.id);
  return archive;
}

export function renameStatisticsArchive(id: string, name: string) {
  const nextName = name.trim();
  if (typeof window === "undefined" || nextName.length === 0) return getActiveStatisticsArchive();
  const archives = loadStatisticsArchives();
  const archive = archives.find((candidate) => candidate.id === id);
  if (!archive) return getActiveStatisticsArchive();

  const nextArchive = { ...archive, name: nextName };
  saveStatisticsArchives(archives.map((candidate) => (candidate.id === id ? nextArchive : candidate)));
  emitStatisticsArchiveChange();
  return getActiveStatisticsArchiveId() === id ? nextArchive : getActiveStatisticsArchive();
}

export function deleteStatisticsArchive(id: string) {
  if (typeof window === "undefined" || id === DEFAULT_STATISTICS_ARCHIVE_ID) return getActiveStatisticsArchive();
  const archives = loadStatisticsArchives();
  const archive = archives.find((candidate) => candidate.id === id);
  if (!archive) return getActiveStatisticsArchive();

  const nextArchives = archives.filter((candidate) => candidate.id !== id);
  saveStatisticsArchives(nextArchives);
  try {
    ARCHIVE_SCOPED_STORAGE_KEYS.forEach((key) => {
      window.localStorage.removeItem(getArchiveScopedStorageKey(key, id));
    });
    window.localStorage.setItem(ACTIVE_STATISTICS_ARCHIVE_KEY, DEFAULT_STATISTICS_ARCHIVE_ID);
  } catch {
    // Local storage can be unavailable in private contexts.
  }
  emitStatisticsArchiveChange();
  return DEFAULT_STATISTICS_ARCHIVE;
}

export function subscribeStatisticsArchiveChange(handler: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorageChange = (event: StorageEvent) => {
    if (
      event.key === STATISTICS_ARCHIVES_KEY ||
      event.key === ACTIVE_STATISTICS_ARCHIVE_KEY ||
      ARCHIVE_SCOPED_STORAGE_KEYS.some((key) => event.key === getArchiveScopedStorageKey(key))
    ) {
      handler();
    }
  };

  window.addEventListener(STATISTICS_ARCHIVE_CHANGE_EVENT, handler);
  window.addEventListener("storage", handleStorageChange);
  return () => {
    window.removeEventListener(STATISTICS_ARCHIVE_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handleStorageChange);
  };
}

export function loadSolveHistory(): SolveHistoryEntry[] {
  if (typeof window === "undefined") return [];
  const storageKey = getArchiveScopedStorageKey(CUBE_HISTORY_KEY);
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(value)) return [];
    const history = value
      .filter(
        (entry): entry is SolveHistoryEntry =>
          typeof entry?.ms === "number" && typeof entry?.ts === "number",
      )
      .map(normalizeSolveHistoryEntry);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(history));
    } catch {
      // Keep the normalized in-memory history even if localStorage cannot be updated.
    }
    return history;
  } catch {
    return [];
  }
}

function normalizeHistoryMetric(value: unknown): HistoryMetricValue {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return MISSING_HISTORY_VALUE;
}

function normalizeCfopPhaseMetrics(value: unknown): CfopPhaseMetrics {
  if (!value || typeof value !== "object") return { ...EMPTY_CFOP_PHASE_METRICS };
  const candidate = value as Partial<Record<keyof CfopPhaseMetrics, unknown>>;
  return {
    cross: normalizeHistoryMetric(candidate.cross),
    f2l: normalizeHistoryMetric(candidate.f2l),
    oll: normalizeHistoryMetric(candidate.oll),
    pll: normalizeHistoryMetric(candidate.pll),
  };
}

function normalizeF2lSubphaseMetrics(value: unknown): F2lSubphaseMetrics {
  if (!value || typeof value !== "object") return { ...EMPTY_F2L_SUBPHASE_METRICS };
  const candidate = value as Partial<Record<keyof F2lSubphaseMetrics, unknown>>;
  return {
    one: normalizeHistoryMetric(candidate.one),
    two: normalizeHistoryMetric(candidate.two),
    three: normalizeHistoryMetric(candidate.three),
    four: normalizeHistoryMetric(candidate.four),
  };
}

export function normalizeSolveHistoryEntry(entry: SolveHistoryEntry): SolveHistoryEntry {
  const { scramble: _scramble, ...rest } = entry as SolveHistoryEntry & { scramble?: unknown };
  return {
    ...rest,
    cfop: normalizeCfopPhaseMetrics(entry.cfop),
    cfopMoves: normalizeCfopPhaseMetrics(entry.cfopMoves),
    cfopF2l: normalizeF2lSubphaseMetrics(entry.cfopF2l),
    cfopF2lMoves: normalizeF2lSubphaseMetrics(entry.cfopF2lMoves),
  };
}

export function trimSolveHistory(history: SolveHistoryEntry[]) {
  return history.map(normalizeSolveHistoryEntry);
}

export function prependSolveHistoryEntry(history: SolveHistoryEntry[], entry: SolveHistoryEntry) {
  return trimSolveHistory([entry, ...history]);
}

export function saveSolveHistory(history: SolveHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getArchiveScopedStorageKey(CUBE_HISTORY_KEY), JSON.stringify(trimSolveHistory(history)));
    emitStatisticsArchiveChange();
  } catch {
    // Local storage can be unavailable in private contexts; the in-memory state still works.
  }
}

export function loadDailyLevels(): DailyLevelEntry[] {
  if (typeof window === "undefined") return [];
  const storageKey = getArchiveScopedStorageKey(DAILY_LEVELS_KEY);
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(value)) return [];
    const levels = value.map(normalizeDailyLevelEntry).filter((entry): entry is DailyLevelEntry => entry !== null);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(levels));
    } catch {
      // Keep the normalized in-memory levels even if localStorage cannot be updated.
    }
    return levels;
  } catch {
    return [];
  }
}

function normalizeDailyLevelSolve(value: unknown): DailyLevelSolve | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.ms !== "number" ||
    !Number.isFinite(candidate.ms) ||
    typeof candidate.ts !== "number"
  ) {
    return null;
  }
  return {
    ms: candidate.ms,
    ts: candidate.ts,
    ...(typeof candidate.moves === "number" ? { moves: candidate.moves } : {}),
  };
}

export function getDailyLevelExcludedSolveIndexes(solves: DailyLevelSolve[]) {
  if (solves.length < 3) return new Set<number>();
  const indexed = solves
    .map((solve, index) => ({ index, ms: solve.ms }))
    .filter((solve) => Number.isFinite(solve.ms));
  if (indexed.length < 3) return new Set<number>();
  const sorted = [...indexed].sort((left, right) => {
    if (left.ms !== right.ms) return left.ms - right.ms;
    return left.index - right.index;
  });
  return new Set([sorted[0].index, sorted[sorted.length - 1].index]);
}

export function calculateDailyLevelAverage(solves: DailyLevelSolve[]) {
  const excluded = getDailyLevelExcludedSolveIndexes(solves);
  const included = solves.filter((solve, index) => !excluded.has(index) && Number.isFinite(solve.ms));
  if (included.length === 0) return null;
  return included.reduce((sum, solve) => sum + solve.ms, 0) / included.length;
}

export function normalizeDailyLevelEntry(value: unknown): DailyLevelEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.localDate !== "string" ||
    typeof candidate.completedAt !== "number" ||
    !Array.isArray(candidate.solves)
  ) {
    return null;
  }
  const solves = candidate.solves.map(normalizeDailyLevelSolve);
  if (solves.some((solve) => solve === null)) return null;
  const parsedSolves = solves as DailyLevelSolve[];
  const averageMs = calculateDailyLevelAverage(parsedSolves);
  const fallbackAverageMs = typeof candidate.averageMs === "number" ? candidate.averageMs : null;
  if (averageMs == null && fallbackAverageMs == null) return null;
  const normalizedAverageMs = averageMs ?? fallbackAverageMs;
  if (normalizedAverageMs == null) return null;
  return {
    id: candidate.id,
    localDate: candidate.localDate,
    completedAt: candidate.completedAt,
    averageMs: normalizedAverageMs,
    solves: parsedSolves,
  };
}

export function saveDailyLevels(levels: DailyLevelEntry[]) {
  if (typeof window === "undefined") return;
  try {
    const normalized = levels.map(normalizeDailyLevelEntry).filter((entry): entry is DailyLevelEntry => entry !== null);
    window.localStorage.setItem(getArchiveScopedStorageKey(DAILY_LEVELS_KEY), JSON.stringify(normalized));
    emitStatisticsArchiveChange();
  } catch {
    // Local storage can be unavailable in private contexts; the in-memory state still works.
  }
}

function normalizeDailyPracticeEntry(value: unknown): DailyPracticeEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.localDate !== "string" ||
    typeof candidate.seconds !== "number" ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isFinite(candidate.seconds) ||
    !Number.isFinite(candidate.updatedAt) ||
    candidate.seconds < 0
  ) {
    return null;
  }
  return {
    localDate: candidate.localDate,
    seconds: Math.max(0, Math.round(candidate.seconds)),
    updatedAt: candidate.updatedAt,
  };
}

function normalizePendingPracticeSession(value: unknown): PendingPracticeSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.archiveId !== "string" ||
    typeof candidate.startAt !== "number" ||
    typeof candidate.lastMoveAt !== "number" ||
    candidate.archiveId.length === 0 ||
    !Number.isFinite(candidate.startAt) ||
    !Number.isFinite(candidate.lastMoveAt) ||
    candidate.lastMoveAt < candidate.startAt
  ) {
    return null;
  }
  return {
    archiveId: candidate.archiveId,
    startAt: candidate.startAt,
    lastMoveAt: candidate.lastMoveAt,
  };
}

export function loadDailyPracticeSeconds(archiveId?: string): DailyPracticeEntry[] {
  if (typeof window === "undefined") return [];
  const storageKey = getArchiveScopedStorageKey(DAILY_PRACTICE_SECONDS_KEY, archiveId);
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(value)) return [];
    const normalized = value
      .map(normalizeDailyPracticeEntry)
      .filter((entry): entry is DailyPracticeEntry => entry !== null);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch {
      // Keep the normalized in-memory practice data even if localStorage cannot be updated.
    }
    return normalized;
  } catch {
    return [];
  }
}

export function loadPendingPracticeSession() {
  if (typeof window === "undefined") return null;
  try {
    return normalizePendingPracticeSession(JSON.parse(window.localStorage.getItem(PRACTICE_PENDING_SESSION_KEY) || "null"));
  } catch {
    return null;
  }
}

export function savePendingPracticeSession(session: PendingPracticeSession) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRACTICE_PENDING_SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

export function clearPendingPracticeSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PRACTICE_PENDING_SESSION_KEY);
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

export function saveDailyPracticeSeconds(entries: DailyPracticeEntry[], archiveId?: string) {
  if (typeof window === "undefined") return;
  try {
    const byDate = new Map<string, DailyPracticeEntry>();
    entries.forEach((entry) => {
      const normalized = normalizeDailyPracticeEntry(entry);
      if (!normalized) return;
      const existing = byDate.get(normalized.localDate);
      if (!existing || normalized.updatedAt >= existing.updatedAt) {
        byDate.set(normalized.localDate, normalized);
      }
    });
    const normalized = Array.from(byDate.values()).sort((left, right) => left.localDate.localeCompare(right.localDate));
    window.localStorage.setItem(getArchiveScopedStorageKey(DAILY_PRACTICE_SECONDS_KEY, archiveId), JSON.stringify(normalized));
    emitStatisticsArchiveChange();
  } catch {
    // Local storage can be unavailable in private contexts; the in-memory state still works.
  }
}

function nextLocalMidnightMs(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function addPracticeDurationToEntries(entries: DailyPracticeEntry[], startMs: number, endMs: number, updatedAt = Date.now()) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return entries;
  const additions = new Map<string, number>();
  let cursor = startMs;
  while (cursor < endMs) {
    const segmentEnd = Math.min(endMs, nextLocalMidnightMs(cursor));
    const seconds = Math.round((segmentEnd - cursor) / 1000);
    if (seconds > 0) {
      const localDate = getLocalDateKey(new Date(cursor));
      additions.set(localDate, (additions.get(localDate) ?? 0) + seconds);
    }
    cursor = segmentEnd;
  }
  if (additions.size === 0) return entries;

  const byDate = new Map(entries.map((entry) => [entry.localDate, entry]));
  additions.forEach((seconds, localDate) => {
    const existing = byDate.get(localDate);
    byDate.set(localDate, {
      localDate,
      seconds: (existing?.seconds ?? 0) + seconds,
      updatedAt,
    });
  });
  return Array.from(byDate.values());
}

export function loadDailyPracticeSecondsWithPendingSession(archiveId = getActiveStatisticsArchiveId()) {
  const entries = loadDailyPracticeSeconds(archiveId);
  const pending = loadPendingPracticeSession();
  if (!pending || pending.archiveId !== archiveId) return entries;
  return addPracticeDurationToEntries(entries, pending.startAt, pending.lastMoveAt, Date.now());
}

export function addDailyPracticeDuration(startMs: number, endMs: number, archiveId?: string) {
  if (typeof window === "undefined") return [];
  const entries = loadDailyPracticeSeconds(archiveId);
  const next = addPracticeDurationToEntries(entries, startMs, endMs);
  if (next === entries) return [];
  saveDailyPracticeSeconds(next, archiveId);
  return next;
}
