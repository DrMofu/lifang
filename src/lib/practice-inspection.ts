import { getArchiveScopedStorageKey } from "@/lib/solve-history";

export type PracticeInspectionMode = "timed" | "unlimited";

export type PracticeInspectionSettings = {
  mode: PracticeInspectionMode;
  seconds: number;
};

export const PRACTICE_INSPECTION_SETTINGS_KEY = "cube-practice-inspection-settings";
export const DEFAULT_PRACTICE_INSPECTION_SECONDS = 15;
export const MIN_PRACTICE_INSPECTION_SECONDS = 1;
export const MAX_PRACTICE_INSPECTION_SECONDS = 600;
export const DEFAULT_PRACTICE_INSPECTION_SETTINGS: PracticeInspectionSettings = {
  mode: "timed",
  seconds: DEFAULT_PRACTICE_INSPECTION_SECONDS,
};

export function normalizePracticeInspectionSettings(value: unknown): PracticeInspectionSettings {
  if (!value || typeof value !== "object") return DEFAULT_PRACTICE_INSPECTION_SETTINGS;
  const candidate = value as Partial<PracticeInspectionSettings>;
  const mode: PracticeInspectionMode = candidate.mode === "unlimited" ? "unlimited" : "timed";
  const parsedSeconds = typeof candidate.seconds === "number" ? candidate.seconds : DEFAULT_PRACTICE_INSPECTION_SECONDS;
  const seconds = Math.min(
    MAX_PRACTICE_INSPECTION_SECONDS,
    Math.max(
      MIN_PRACTICE_INSPECTION_SECONDS,
      Math.trunc(Number.isFinite(parsedSeconds) ? parsedSeconds : DEFAULT_PRACTICE_INSPECTION_SECONDS),
    ),
  );

  return { mode, seconds };
}

export function loadPracticeInspectionSettings() {
  if (typeof window === "undefined") return DEFAULT_PRACTICE_INSPECTION_SETTINGS;
  try {
    return normalizePracticeInspectionSettings(
      JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(PRACTICE_INSPECTION_SETTINGS_KEY)) || "null"),
    );
  } catch {
    return DEFAULT_PRACTICE_INSPECTION_SETTINGS;
  }
}

export function savePracticeInspectionSettings(settings: PracticeInspectionSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getArchiveScopedStorageKey(PRACTICE_INSPECTION_SETTINGS_KEY),
      JSON.stringify(normalizePracticeInspectionSettings(settings)),
    );
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

export function getPracticeInspectionDurationMs(settings: PracticeInspectionSettings) {
  const normalized = normalizePracticeInspectionSettings(settings);
  return normalized.mode === "unlimited" ? null : normalized.seconds * 1000;
}
