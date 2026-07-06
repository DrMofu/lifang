import { getArchiveScopedStorageKey } from "@/lib/solve-history";

export type AverageTimeMethod = "trimmed" | "arithmetic" | "median";

export type AverageTimeSettings = {
  method: AverageTimeMethod;
  sampleSize: number;
  trimBest: number;
  trimWorst: number;
};

export type AverageTimeResult = {
  valueMs: number;
  usedTimes: number[];
  label: string;
};

export const AVERAGE_TIME_SETTINGS_KEY = "average-time-settings";
export const DEFAULT_AVERAGE_TIME_SETTINGS: AverageTimeSettings = {
  method: "trimmed",
  sampleSize: 20,
  trimBest: 2,
  trimWorst: 2,
};

export const AVERAGE_TIME_METHOD_LABELS: Record<AverageTimeMethod, string> = {
  trimmed: "去极值平均",
  arithmetic: "算术平均",
  median: "中位数",
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numberValue)));
}

function normalizeAverageTimeSettings(value: unknown): AverageTimeSettings {
  if (!value || typeof value !== "object") return DEFAULT_AVERAGE_TIME_SETTINGS;
  const candidate = value as Partial<AverageTimeSettings>;
  const method: AverageTimeMethod =
    candidate.method === "arithmetic" || candidate.method === "median" || candidate.method === "trimmed"
      ? candidate.method
      : DEFAULT_AVERAGE_TIME_SETTINGS.method;
  const sampleSize = clampInteger(candidate.sampleSize, DEFAULT_AVERAGE_TIME_SETTINGS.sampleSize, 1, 100);
  const trimBest = clampInteger(candidate.trimBest, DEFAULT_AVERAGE_TIME_SETTINGS.trimBest, 0, 20);
  const trimWorst = clampInteger(candidate.trimWorst, DEFAULT_AVERAGE_TIME_SETTINGS.trimWorst, 0, 20);
  return { method, sampleSize, trimBest, trimWorst };
}

export function loadAverageTimeSettings(): AverageTimeSettings {
  if (typeof window === "undefined") return DEFAULT_AVERAGE_TIME_SETTINGS;
  try {
    return normalizeAverageTimeSettings(
      JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(AVERAGE_TIME_SETTINGS_KEY)) || "null"),
    );
  } catch {
    return DEFAULT_AVERAGE_TIME_SETTINGS;
  }
}

export function saveAverageTimeSettings(settings: AverageTimeSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getArchiveScopedStorageKey(AVERAGE_TIME_SETTINGS_KEY),
      JSON.stringify(normalizeAverageTimeSettings(settings)),
    );
  } catch {
    // Local storage can be unavailable in restricted browsing modes.
  }
}

export function calculateAverageTime(times: number[], settings: AverageTimeSettings): AverageTimeResult | null {
  const normalized = normalizeAverageTimeSettings(settings);
  const sample = times
    .filter((time) => Number.isFinite(time) && time > 0)
    .slice(-normalized.sampleSize);
  if (sample.length === 0) return null;

  let usedTimes = sample;
  if (normalized.method === "trimmed") {
    const removableCount = normalized.trimBest + normalized.trimWorst;
    if (sample.length <= removableCount) return null;
    const sorted = sample.toSorted((a, b) => a - b);
    usedTimes = sorted.slice(normalized.trimBest, sorted.length - normalized.trimWorst);
    if (usedTimes.length === 0) return null;
  }

  if (normalized.method === "median") {
    const sorted = sample.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const valueMs = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
    return { valueMs, usedTimes: sorted, label: "中位" };
  }

  const valueMs = usedTimes.reduce((sum, time) => sum + time, 0) / usedTimes.length;
  return {
    valueMs,
    usedTimes,
    label: normalized.method === "trimmed" ? `AO${normalized.sampleSize}` : `AVG${normalized.sampleSize}`,
  };
}

export function averageSettingsEqual(a: AverageTimeSettings, b: AverageTimeSettings) {
  return a.method === b.method && a.sampleSize === b.sampleSize && a.trimBest === b.trimBest && a.trimWorst === b.trimWorst;
}

export function describeAverageTimeSettings(settings: AverageTimeSettings) {
  const normalized = normalizeAverageTimeSettings(settings);
  if (normalized.method === "trimmed") {
    const minimumCount = normalized.trimBest + normalized.trimWorst + 1;
    return `当前使用${AVERAGE_TIME_METHOD_LABELS.trimmed}：最多取最近 ${normalized.sampleSize} 次练习时间，删除最快 ${normalized.trimBest} 次和最慢 ${normalized.trimWorst} 次，对剩余成绩求平均。少于 ${minimumCount} 条有效记录时显示 --。`;
  }
  if (normalized.method === "arithmetic") {
    return `当前使用${AVERAGE_TIME_METHOD_LABELS.arithmetic}：最多取最近 ${normalized.sampleSize} 次练习时间，直接计算算术平均值。暂无有效记录时显示 --。`;
  }
  return `当前使用${AVERAGE_TIME_METHOD_LABELS.median}：最多取最近 ${normalized.sampleSize} 次练习时间，按用时排序后取中间值作为平均参考。暂无有效记录时显示 --。`;
}
