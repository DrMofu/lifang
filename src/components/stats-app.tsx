"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AppFooter, AppTopbar } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import {
  DEFAULT_AVERAGE_TIME_SETTINGS,
  loadAverageTimeSettings,
  type AverageTimeSettings,
} from "@/lib/average-time";
import { fmtShort } from "@/lib/format";
import {
  getDailyTestDateKey,
  getDailyLevelExcludedSolveIndexes,
  loadDailyPracticeSecondsWithPendingSession,
  loadDailyLevels,
  loadSolveHistory,
  MISSING_HISTORY_VALUE,
  subscribeStatisticsArchiveChange,
  type CfopPhaseMetrics,
  type DailyLevelEntry,
  type DailyPracticeEntry,
  type F2lSubphaseMetrics,
  type SolveHistoryEntry,
} from "@/lib/solve-history";

type CfopPhaseKey = "cross" | "f2l" | "oll" | "pll";
type F2lSubphaseKey = "one" | "two" | "three" | "four";
type CfopAverageSize = 5 | 20 | 100;
type TrendMetric = "time" | "moves";
type TrendPhaseFilter = "all" | CfopPhaseKey;
type TrendRangeFilter = "all" | "100" | "500" | "1000";

const CFOP_AVERAGE_SIZES: CfopAverageSize[] = [5, 20, 100];
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

const TREND_PHASE_FILTERS: Array<{ key: TrendPhaseFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "cross", label: "C" },
  { key: "f2l", label: "F" },
  { key: "oll", label: "O" },
  { key: "pll", label: "P" },
];
const TREND_METRIC_FILTERS: Array<{ key: TrendMetric; label: string }> = [
  { key: "time", label: "用时" },
  { key: "moves", label: "步数" },
];
const TREND_RANGE_LIMITS: Array<{ key: Exclude<TrendRangeFilter, "all">; label: string; count: number }> = [
  { key: "100", label: "最近100次", count: 100 },
  { key: "500", label: "最近500次", count: 500 },
  { key: "1000", label: "最近1000次", count: 1000 },
];

const TREND_PHASE_FILTER_NAMES: Record<TrendPhaseFilter, string> = {
  all: "全部",
  cross: "C",
  f2l: "F",
  oll: "O",
  pll: "P",
};

const TREND_PHASE_DROPDOWN_LABELS: Record<TrendPhaseFilter, string> = {
  all: "全阶段",
  cross: "Cross",
  f2l: "F2L",
  oll: "OLL",
  pll: "PLL",
};

type TrendCfopTip = {
  entry: SolveHistoryEntry;
  pointKey: string;
  pointNumber: number;
  pointIndex: number;
  left: number;
  top: number;
  arrowLeft: number;
  placement: "above" | "below";
};

type HeatmapTip = {
  count: number;
  practiceSeconds: number | null;
  dateLabel: string;
  left: number;
  top: number;
};

type HeatmapCell = {
  date: Date;
  count: number;
  practiceSeconds: number | null;
  heatSeconds: number;
  isFuture: boolean;
};

type DailyLevelTip = {
  entry: DailyLevelEntry;
  pointKey: string;
  left: number;
  top: number;
  arrowLeft: number;
  placement: "above" | "below";
};

type DailyLevelSummary = {
  rows: DailyLevelEntry[];
  today: DailyLevelEntry | null;
  bestEntry: DailyLevelEntry | null;
  trend: {
    entries: DailyLevelEntry[];
    points: number[];
    min: number;
    max: number;
  };
};

const TREND_TIP_WIDTH = 286;
const TREND_TIP_HEIGHT = 260;
const TREND_TIP_GAP = 12;
const TREND_TIP_MARGIN = 14;
const TREND_CHART_WIDTH = 800;
const TREND_CHART_HEIGHT = 280;
const TREND_CHART_PAD_LEFT = 48;
const TREND_CHART_PAD_RIGHT = 28;
const TREND_CHART_PAD_TOP = 14;
const TREND_CHART_PAD_BOTTOM = 30;
const TREND_X_TICK_TARGET_COUNT = 7;
const HEATMAP_TIP_WIDTH = 178;
const HEATMAP_TIP_MARGIN = 12;
const HEATMAP_FULL_SECONDS = 60 * 60;
const HEATMAP_ESTIMATED_SECONDS_PER_SOLVE = 2 * 60;
const HEATMAP_WEEK_COUNT = 16;
const DL_TIP_WIDTH = 204;
const DL_TIP_HEIGHT = 210;
const DL_TIP_GAP = 12;
const DL_TIP_MARGIN = 14;
const TREND_DOMAIN_MIN_POINTS = 40;
const TREND_DOMAIN_LOWER_QUANTILE = 0;
const TREND_DOMAIN_UPPER_QUANTILE = 0.99;
const TREND_RANGE_PADDING_RATIO = 0.01;
const TREND_MIN_PADDING: Record<TrendMetric, number> = {
  time: 80,
  moves: 2,
};

function getTrendChartWidthForRect(rect: { width: number; height: number }) {
  if (rect.width <= 0 || rect.height <= 0) return TREND_CHART_WIDTH;
  return Math.max(TREND_CHART_WIDTH, Math.round((rect.width / rect.height) * TREND_CHART_HEIGHT));
}

function fmtStatsTime(ms: number | null) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const totalCentiseconds = Math.round(ms / 10);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  return `${seconds}.${String(centiseconds).padStart(2, "0")}`;
}

function fmtTrendValue(value: number | null, metric: TrendMetric) {
  if (value == null || Number.isNaN(value)) return "—";
  if (metric === "moves") {
    const displayValue = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
    return `${displayValue}步`;
  }
  return fmtShort(value);
}

function fmtTrendAxisValue(value: number, metric: TrendMetric) {
  if (metric === "moves") return `${Math.round(value)}步`;
  return `${Math.round(value / 1000)}s`;
}

function fmtMoveCount(moves: number | undefined) {
  return typeof moves === "number" && Number.isFinite(moves) ? `${moves}步` : MISSING_HISTORY_VALUE;
}

function fmtSolveDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fmtPracticeMinutes(seconds: number) {
  if (seconds <= 0) return "0 分钟";
  if (seconds < 60) return "< 1 分钟";
  return `${Math.round(seconds / 60)} 分钟`;
}

function fmtPracticeMinutesCompact(seconds: number) {
  if (seconds <= 0) return "0分钟";
  if (seconds < 60) return "<1分钟";
  return `${Math.round(seconds / 60)}分钟`;
}

function fmtPracticeDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}小时${minutes}分钟`;
}

function averageDailyLevelMoves(entry: DailyLevelEntry) {
  const excluded = getDailyLevelExcludedSolveIndexes(entry.solves);
  const includedMoves = entry.solves
    .filter((_, index) => !excluded.has(index))
    .map((solve) => solve.moves)
    .filter((moves): moves is number => typeof moves === "number" && Number.isFinite(moves));
  if (includedMoves.length === 0) return undefined;
  return Math.round(includedMoves.reduce((sum, moves) => sum + moves, 0) / includedMoves.length);
}

function trendAxisStep(span: number) {
  return span <= 60 ? 5 : 10;
}

function trendAxisScale(min: number, max: number, metric: TrendMetric) {
  const unit = metric === "time" ? 1000 : 1;
  const displayMin = min / unit;
  const displayMax = max / unit;
  const displayRange = Math.max(1, displayMax - displayMin);
  const step = trendAxisStep(displayRange);
  const first = Math.floor(displayMin / step) * step;
  const last = Math.ceil(displayMax / step) * step;
  const ticks: number[] = [];
  for (let tick = first; tick <= last + step * 0.001; tick += step) {
    ticks.push(Math.round(tick * unit));
  }
  const fallbackTicks = [Math.floor(displayMin) * unit, Math.ceil(displayMax) * unit]
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  const axisTicks = ticks.length >= 2 ? ticks : fallbackTicks;
  return {
    min: Math.max(0, axisTicks[0] ?? min),
    max: axisTicks.at(-1) ?? max,
    ticks: axisTicks,
  };
}

function avgTrim(values: number[]) {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, -1);
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
}

function avgTrimByCount(values: number[], trimBest: number, trimWorst: number) {
  if (values.length <= trimBest + trimWorst) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.slice(trimBest, sorted.length - trimWorst);
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
}

function formatStableScoreMeta(settings: AverageTimeSettings) {
  if (settings.method === "arithmetic") return `最近 ${settings.sampleSize} 次算术平均`;
  if (settings.method === "median") return `最近 ${settings.sampleSize} 次中位数`;

  const removed: string[] = [];
  if (settings.trimBest > 0) removed.push(`最快 ${settings.trimBest} 次`);
  if (settings.trimWorst > 0) removed.push(`最慢 ${settings.trimWorst} 次`);
  return removed.length > 0 ? `最近 ${settings.sampleSize} 次去掉${removed.join("和")}` : `最近 ${settings.sampleSize} 次去极值平均`;
}

function quantile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * ratio)));
  return sortedValues[index];
}

function trendDomain(points: number[], metric: TrendMetric) {
  const sorted = [...points].sort((a, b) => a - b);
  const rawMin = sorted[0];
  const rawMax = sorted.at(-1) ?? rawMin;
  const domainMin = points.length >= TREND_DOMAIN_MIN_POINTS
    ? quantile(sorted, TREND_DOMAIN_LOWER_QUANTILE)
    : rawMin;
  const domainMax = points.length >= TREND_DOMAIN_MIN_POINTS
    ? quantile(sorted, TREND_DOMAIN_UPPER_QUANTILE)
    : rawMax;
  const range = Math.max(1, domainMax - domainMin);
  const padding = Math.max(range * TREND_RANGE_PADDING_RATIO, TREND_MIN_PADDING[metric]);
  return {
    min: Math.max(0, domainMin - padding),
    max: domainMax + padding,
  };
}

function sampledTickIndexes(length: number, targetCount: number) {
  if (length <= 0) return [];
  if (length <= targetCount) return Array.from({ length }, (_, index) => index);
  const count = Math.max(2, targetCount);
  return Array.from(
    new Set(Array.from({ length: count }, (_, index) => Math.round((index * (length - 1)) / (count - 1)))),
  );
}

type ChartPoint = { x: number; y: number };

function createMonotoneCubicPath(coords: ChartPoint[]) {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;

  const dx = coords.slice(0, -1).map((point, index) => Math.max(1, coords[index + 1].x - point.x));
  const secants = dx.map((width, index) => (coords[index + 1].y - coords[index].y) / width);
  const slopes = coords.map((_, index) => {
    if (index === 0) return secants[0];
    if (index === coords.length - 1) return secants[secants.length - 1];
    const prev = secants[index - 1];
    const next = secants[index];
    if (prev * next <= 0) return 0;
    const prevWidth = dx[index - 1];
    const nextWidth = dx[index];
    const w1 = 2 * nextWidth + prevWidth;
    const w2 = nextWidth + 2 * prevWidth;
    return (w1 + w2) / (w1 / prev + w2 / next);
  });

  for (let index = 0; index < secants.length; index++) {
    const secant = secants[index];
    if (secant === 0) {
      slopes[index] = 0;
      slopes[index + 1] = 0;
      continue;
    }
    const alpha = slopes[index] / secant;
    const beta = slopes[index + 1] / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      slopes[index] = scale * alpha * secant;
      slopes[index + 1] = scale * beta * secant;
    }
  }

  return coords.slice(1).reduce((path, point, index) => {
    const prev = coords[index];
    const width = dx[index];
    const cp1x = prev.x + width / 3;
    const cp1y = prev.y + (slopes[index] * width) / 3;
    const cp2x = point.x - width / 3;
    const cp2y = point.y - (slopes[index + 1] * width) / 3;
    return `${path} C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }, `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`);
}

function createSegmentedMonotoneCubicPath(
  values: Array<number | null>,
  pointForValue: (value: number, index: number) => ChartPoint,
) {
  const paths: string[] = [];
  let segment: ChartPoint[] = [];
  values.forEach((value, index) => {
    if (value == null) {
      if (segment.length > 0) paths.push(createMonotoneCubicPath(segment));
      segment = [];
      return;
    }
    segment.push(pointForValue(value, index));
  });
  if (segment.length > 0) paths.push(createMonotoneCubicPath(segment));
  return paths.join(" ");
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

function f2lSubphaseDelta(
  cfopMetrics: CfopPhaseMetrics | undefined,
  f2lMetrics: F2lSubphaseMetrics | undefined,
  key: F2lSubphaseKey,
) {
  const current = f2lMetrics?.[key];
  const previous = getF2lSubphasePrevious(cfopMetrics, f2lMetrics, key);
  if (typeof current !== "number" || typeof previous !== "number" || current < previous) return null;
  return current - previous;
}

function formatF2lSubphaseTimeDelta(
  cfopMetrics: CfopPhaseMetrics | undefined,
  f2lMetrics: F2lSubphaseMetrics | undefined,
  key: F2lSubphaseKey,
) {
  const delta = f2lSubphaseDelta(cfopMetrics, f2lMetrics, key);
  return delta == null ? MISSING_HISTORY_VALUE : fmtShort(delta);
}

function formatF2lSubphaseMoveDelta(
  cfopMoves: CfopPhaseMetrics | undefined,
  f2lMoves: F2lSubphaseMetrics | undefined,
  key: F2lSubphaseKey,
) {
  const delta = f2lSubphaseDelta(cfopMoves, f2lMoves, key);
  return delta == null ? MISSING_HISTORY_VALUE : `${delta}步`;
}

function phaseMetricDelta(metrics: CfopPhaseMetrics | undefined, key: CfopPhaseKey) {
  if (!metrics) return null;
  const current = metrics[key];
  if (typeof current !== "number" || !Number.isFinite(current)) return null;
  if (key === "cross") return current >= 0 ? current : null;
  const previousKey = key === "f2l" ? "cross" : key === "oll" ? "f2l" : "oll";
  const previous = metrics[previousKey];
  if (typeof previous !== "number" || !Number.isFinite(previous) || current < previous) return null;
  return current - previous;
}

function phaseDuration(entry: SolveHistoryEntry, key: CfopPhaseKey) {
  return phaseMetricDelta(entry.cfop, key);
}

function phaseMoveCount(entry: SolveHistoryEntry, key: CfopPhaseKey) {
  return phaseMetricDelta(entry.cfopMoves, key);
}

function trendPointValue(entry: SolveHistoryEntry, metric: TrendMetric, phaseFilter: TrendPhaseFilter) {
  if (phaseFilter !== "all") {
    return metric === "moves" ? phaseMoveCount(entry, phaseFilter) : phaseDuration(entry, phaseFilter);
  }
  if (metric === "moves") {
    return typeof entry.moves === "number" && Number.isFinite(entry.moves) && entry.moves > 0 ? entry.moves : null;
  }
  return entry.ms;
}

function clampStatsInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizedAverageSampleSize(settings: AverageTimeSettings) {
  return clampStatsInteger(settings.sampleSize, 1, 100);
}

function normalizedTrimCount(value: number) {
  return clampStatsInteger(value, 0, 20);
}

function averageValueForWindow(sample: number[], settings: AverageTimeSettings) {
  if (sample.length === 0) return null;
  const window = sample.length > normalizedAverageSampleSize(settings)
    ? sample.slice(-normalizedAverageSampleSize(settings))
    : sample;

  if (settings.method === "median") {
    const sorted = [...window].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  }

  if (settings.method === "trimmed") {
    const trimBest = normalizedTrimCount(settings.trimBest);
    const trimWorst = normalizedTrimCount(settings.trimWorst);
    if (window.length <= trimBest + trimWorst) return null;
    const sorted = [...window].sort((a, b) => a - b);
    const trimmed = sorted.slice(trimBest, sorted.length - trimWorst);
    if (trimmed.length === 0) return null;
    return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  }

  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

function rollingAverageValues(points: Array<number | null>, settings: AverageTimeSettings) {
  const sampleSize = normalizedAverageSampleSize(settings);
  const sample: number[] = [];
  return points.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    sample.push(value);
    if (sample.length > sampleSize) sample.shift();
    return averageValueForWindow(sample, settings);
  });
}

function summarizeSolveRecords(history: SolveHistoryEntry[], settings: AverageTimeSettings) {
  if (history.length === 0) return { pb: null, ao5: null, stableScore: null, ao100: null, count: 0 };

  const latest5: number[] = [];
  const latest100: number[] = [];
  const stableSample: number[] = [];
  const sampleSize = normalizedAverageSampleSize(settings);
  let pb: number | null = null;

  for (let index = 0; index < history.length; index++) {
    const ms = history[index].ms;
    if (!Number.isFinite(ms) || ms <= 0) continue;
    pb = pb == null ? ms : Math.min(pb, ms);
    if (index < 5) latest5.push(ms);
    if (index < 100) latest100.push(ms);
    if (stableSample.length < sampleSize) stableSample.push(ms);
  }

  return {
    pb,
    ao5: history.length >= 5 ? avgTrim(latest5) : null,
    stableScore: history.length >= sampleSize ? averageValueForWindow(stableSample, settings) : null,
    ao100: history.length >= 100 ? avgTrimByCount(latest100, 5, 5) : null,
    count: history.length,
  };
}

function summarizeDailyLevels(dailyLevels: DailyLevelEntry[], todayLocalDate: string): DailyLevelSummary {
  const entries = [...dailyLevels].sort((a, b) => a.completedAt - b.completedAt);
  const points: number[] = [];
  let min = 0;
  let max = 0;
  let today: DailyLevelEntry | null = null;
  let bestEntry: DailyLevelEntry | null = null;

  entries.forEach((entry, index) => {
    points.push(entry.averageMs);
    if (index === 0) {
      min = entry.averageMs;
      max = entry.averageMs;
    } else {
      min = Math.min(min, entry.averageMs);
      max = Math.max(max, entry.averageMs);
    }
    if (entry.localDate === todayLocalDate) today = entry;
    if (!bestEntry || entry.averageMs < bestEntry.averageMs) bestEntry = entry;
  });

  return {
    rows: entries.toReversed(),
    today,
    bestEntry,
    trend: { entries, points, min, max },
  };
}

export function StatsApp() {
  const { t } = useLanguage();
  const [history, setHistory] = useState<SolveHistoryEntry[]>([]);
  const [dailyLevels, setDailyLevels] = useState<DailyLevelEntry[]>([]);
  const [dailyPractice, setDailyPractice] = useState<DailyPracticeEntry[]>([]);
  const [cfopAverageSize, setCfopAverageSize] = useState<CfopAverageSize>(5);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("time");
  const [trendPhaseFilter, setTrendPhaseFilter] = useState<TrendPhaseFilter>("all");
  const [trendRange, setTrendRange] = useState<TrendRangeFilter>("all");
  const [averageSettings, setAverageSettings] = useState<AverageTimeSettings>(DEFAULT_AVERAGE_TIME_SETTINGS);
  const [trendCfopTip, setTrendCfopTip] = useState<TrendCfopTip | null>(null);
  const [trendGuideIndex, setTrendGuideIndex] = useState<number | null>(null);
  const dailyLevelChartRef = useRef<SVGSVGElement | null>(null);
  const [dailyLevelChartWidth, setDailyLevelChartWidth] = useState(960);
  const [openTrendDropdown, setOpenTrendDropdown] = useState<"metric" | "phase" | "range" | null>(null);
  const [heatmapTip, setHeatmapTip] = useState<HeatmapTip | null>(null);
  const [dailyLevelTip, setDailyLevelTip] = useState<DailyLevelTip | null>(null);
  const [isDailyHistoryOpen, setIsDailyHistoryOpen] = useState(false);
  const dailyHistoryCloseRef = useRef<HTMLButtonElement | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    function refreshArchiveData() {
      setHistory(loadSolveHistory());
      setDailyLevels(loadDailyLevels());
      setDailyPractice(loadDailyPracticeSecondsWithPendingSession());
      setAverageSettings(loadAverageTimeSettings());
    }

    refreshArchiveData();
    setPortalReady(true);
    return subscribeStatisticsArchiveChange(refreshArchiveData);
  }, []);

  useEffect(() => {
    if (!trendCfopTip) return;

    function clearWhenOutsideTrend(event: PointerEvent | MouseEvent) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!(target instanceof Element) || !target.closest(".st-trend")) {
        setTrendCfopTip(null);
      }
    }

    window.addEventListener("pointermove", clearWhenOutsideTrend);
    window.addEventListener("mousemove", clearWhenOutsideTrend);
    return () => {
      window.removeEventListener("pointermove", clearWhenOutsideTrend);
      window.removeEventListener("mousemove", clearWhenOutsideTrend);
    };
  }, [trendCfopTip]);

  useEffect(() => {
    if (!openTrendDropdown) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenTrendDropdown(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openTrendDropdown]);

  const records = useMemo(() => summarizeSolveRecords(history, averageSettings), [averageSettings, history]);
  const stableScoreMeta = useMemo(() => formatStableScoreMeta(averageSettings), [averageSettings]);
  const trendRangeOptions = useMemo(
    () => [
      { key: "all" as const, label: t("显示全部") },
      ...TREND_RANGE_LIMITS.filter((range) => history.length >= range.count).map((range) => ({
        key: range.key,
        label: range.label,
      })),
    ],
    [history.length, t],
  );

  useEffect(() => {
    if (!trendRangeOptions.some((option) => option.key === trendRange)) {
      setTrendRange("all");
      clearTrendHover();
    }
  }, [trendRange, trendRangeOptions]);

  const trend = useMemo(() => {
    const rangeLimit = trendRange === "all" ? null : Number(trendRange);
    const rangeHistory = rangeLimit == null ? history : history.slice(0, rangeLimit);
    const entries = [...rangeHistory].reverse();
    const points = entries.map((entry) => trendPointValue(entry, trendMetric, trendPhaseFilter));
    const domainPoints = points.filter((point): point is number => typeof point === "number");
    if (domainPoints.length === 0) return { entries, points, min: 0, max: 0, stableScore: [] as Array<number | null>, best: null as number | null };
    const stableScore = rollingAverageValues(points, averageSettings);
    const best = domainPoints.reduce((currentBest, value) => Math.min(currentBest, value), domainPoints[0]);
    const { min, max } = trendDomain(domainPoints, trendMetric);
    return { entries, points, min, max, stableScore, best };
  }, [averageSettings, history, trendMetric, trendPhaseFilter, trendRange]);
  const showTrendPb = trendPhaseFilter === "all";

  useEffect(() => {
    if (!trendCfopTip) return;

    function refreshTrendTipPosition() {
      setTrendCfopTip((current) => {
        if (!current) return current;
        const svg = document.querySelector<SVGSVGElement>(".trend-svg");
        const entry = trend.entries[current.pointIndex];
        const value = trend.points[current.pointIndex];
        if (!svg || !entry || value == null) return current;
        const height = TREND_CHART_HEIGHT;
        const rect = svg.getBoundingClientRect();
        const width = getTrendChartWidthForRect(rect);
        const padLeft = TREND_CHART_PAD_LEFT;
        const padRight = TREND_CHART_PAD_RIGHT;
        const padTop = TREND_CHART_PAD_TOP;
        const padBottom = TREND_CHART_PAD_BOTTOM;
        const scale = Math.min(rect.width / width, rect.height / height);
        const viewLeft = rect.left + (rect.width - width * scale) / 2;
        const viewTop = rect.top + (rect.height - height * scale) / 2;
        const x = padLeft + (width - padLeft - padRight) * (trend.points.length === 1 ? 0.5 : current.pointIndex / (trend.points.length - 1));
        const axis = trendAxisScale(trend.min, trend.max, trendMetric);
        const y = height - padBottom - (height - padTop - padBottom) * ((value - axis.min) / Math.max(1, axis.max - axis.min));
        const anchorX = viewLeft + x * scale;
        const anchorY = viewTop + y * scale;
        const maxLeft = window.innerWidth - TREND_TIP_WIDTH - TREND_TIP_MARGIN;
        const maxTop = window.innerHeight - TREND_TIP_HEIGHT - TREND_TIP_MARGIN;
        const placement = anchorY > TREND_TIP_HEIGHT + TREND_TIP_GAP + TREND_TIP_MARGIN ? "above" : "below";
        const idealLeft = anchorX - TREND_TIP_WIDTH / 2;
        const left = Math.min(maxLeft, Math.max(TREND_TIP_MARGIN, idealLeft));
        const idealTop = placement === "above"
          ? anchorY - TREND_TIP_HEIGHT - TREND_TIP_GAP
          : anchorY + TREND_TIP_GAP;
        const top = Math.min(maxTop, Math.max(TREND_TIP_MARGIN, idealTop));
        const arrowLeft = Math.min(TREND_TIP_WIDTH - 22, Math.max(22, anchorX - left));
        return {
          ...current,
          entry,
          pointKey: `${entry.ts}-${current.pointIndex}`,
          left,
          top,
          arrowLeft,
          placement,
        };
      });
    }

    window.addEventListener("scroll", refreshTrendTipPosition, true);
    window.addEventListener("resize", refreshTrendTipPosition);
    return () => {
      window.removeEventListener("scroll", refreshTrendTipPosition, true);
      window.removeEventListener("resize", refreshTrendTipPosition);
    };
  }, [trend, trendCfopTip, trendMetric]);

  const heatmap = useMemo(() => {
    const days = new Map<string, number>();
    const practiceSecondsByDate = new Map(dailyPractice.map((entry) => [entry.localDate, entry.seconds]));
    history.forEach((entry) => {
      const date = new Date(entry.ts);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      days.set(key, (days.get(key) || 0) + 1);
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const grid = Array.from({ length: HEATMAP_WEEK_COUNT }, (_, colIndex) => {
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(currentWeekStart.getDate() - (HEATMAP_WEEK_COUNT - 1 - colIndex) * 7);
      return Array.from({ length: 7 }, (_, dayIndex) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + dayIndex);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        const practiceKey = getDailyTestDateKey(date);
        const isFuture = date > today;
        const count = isFuture ? 0 : days.get(key) || 0;
        const practiceSeconds = isFuture ? undefined : practiceSecondsByDate.get(practiceKey);
        const heatSeconds = practiceSeconds ?? count * HEATMAP_ESTIMATED_SECONDS_PER_SOLVE;
        return { date, count, practiceSeconds: practiceSeconds ?? null, heatSeconds, isFuture };
      });
    });
    const cells = grid.flat();
    const total = cells.reduce((sum, cell) => sum + cell.count, 0);
    const totalPracticeSeconds = cells.reduce((sum, cell) => sum + cell.heatSeconds, 0);
    const activeDays = cells.filter((cell) => cell.count > 0).length;
    const todayPracticeSeconds = practiceSecondsByDate.get(getDailyTestDateKey(today)) ?? 0;
    const monthLabels = grid.map((col, index) => {
      const month = col[0]?.date.getMonth();
      const prevMonth = index > 0 ? grid[index - 1]?.[0]?.date.getMonth() : null;
      if (month == null || (index > 0 && month === prevMonth)) return "";
      return t(`${month + 1}月`);
    });
    return { activeDays, grid, monthLabels, today, todayPracticeSeconds, total, totalPracticeSeconds };
  }, [dailyPractice, history, t]);

  const cfopBreakdown = useMemo(() => {
    const allEntries = history.filter((entry) => entry.cfop && Object.values(entry.cfop).some((value) => typeof value === "number"));
    const entries = allEntries.slice(0, cfopAverageSize);
    if (entries.length < cfopAverageSize) {
      return {
        avg: 0,
        phaseTotal: 0,
        cross: null,
        f2l: null,
        oll: null,
        pll: null,
        crossDuration: null,
        f2lDuration: null,
        ollDuration: null,
        pllDuration: null,
        best: null,
        worst: null,
        change: null,
        count: entries.length,
        target: cfopAverageSize,
      };
    }
    const avgCumulativePhase = (key: CfopPhaseKey) => {
      const values = entries.map((entry) => entry.cfop?.[key]).filter((value): value is number => typeof value === "number");
      if (values.length === 0) return null;
      return avgTrim(values);
    };
    const avgDurationPhase = (key: CfopPhaseKey) => {
      const values = entries.map((entry) => phaseDuration(entry, key)).filter((value): value is number => typeof value === "number");
      if (values.length === 0) return null;
      return avgTrim(values);
    };
    const cross = avgCumulativePhase("cross");
    const f2l = avgCumulativePhase("f2l");
    const oll = avgCumulativePhase("oll");
    const pll = avgCumulativePhase("pll");
    const crossDuration = avgDurationPhase("cross");
    const f2lDuration = avgDurationPhase("f2l");
    const ollDuration = avgDurationPhase("oll");
    const pllDuration = avgDurationPhase("pll");
    const avg = avgTrim(entries.map((entry) => entry.ms)) ?? 0;
    const scores = entries.map((entry) => entry.ms);
    const previousEntries = allEntries.slice(cfopAverageSize, cfopAverageSize * 2);
    const previousAverage = previousEntries.length === cfopAverageSize
      ? avgTrim(previousEntries.map((entry) => entry.ms))
      : null;
    const phaseTotal = [crossDuration, f2lDuration, ollDuration, pllDuration].reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return {
      avg,
      phaseTotal,
      cross,
      f2l,
      oll,
      pll,
      crossDuration,
      f2lDuration,
      ollDuration,
      pllDuration,
      best: Math.min(...scores),
      worst: Math.max(...scores),
      change: previousAverage == null ? null : avg - previousAverage,
      count: entries.length,
      target: cfopAverageSize,
    };
  }, [cfopAverageSize, history]);

  const activeCfopBreakdown = useMemo(() => {
    const activeEntry = trendCfopTip?.entry;
    if (!activeEntry) return { mode: "average" as const, ...cfopBreakdown };
    const crossDuration = phaseDuration(activeEntry, "cross");
    const f2lDuration = phaseDuration(activeEntry, "f2l");
    const ollDuration = phaseDuration(activeEntry, "oll");
    const pllDuration = phaseDuration(activeEntry, "pll");
    const phaseTotal = [crossDuration, f2lDuration, ollDuration, pllDuration].reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return {
      mode: "single" as const,
      avg: activeEntry.ms,
      phaseTotal,
      cross: typeof activeEntry.cfop?.cross === "number" ? activeEntry.cfop.cross : null,
      f2l: typeof activeEntry.cfop?.f2l === "number" ? activeEntry.cfop.f2l : null,
      oll: typeof activeEntry.cfop?.oll === "number" ? activeEntry.cfop.oll : null,
      pll: typeof activeEntry.cfop?.pll === "number" ? activeEntry.cfop.pll : null,
      crossDuration,
      f2lDuration,
      ollDuration,
      pllDuration,
      best: activeEntry.ms,
      worst: activeEntry.ms,
      change: null,
      count: 1,
      target: 1,
    };
  }, [cfopBreakdown, trendCfopTip]);

  const activeCfopPhases = [
    { key: "cross", name: "Cross", value: activeCfopBreakdown.crossDuration, color: "#F2C744" },
    { key: "f2l", name: "F2L", value: activeCfopBreakdown.f2lDuration, color: "#1F6B3A" },
    { key: "oll", name: "OLL", value: activeCfopBreakdown.ollDuration, color: "#1F4FB6" },
    { key: "pll", name: "PLL", value: activeCfopBreakdown.pllDuration, color: "#C9352A" },
  ];
  const dominantCfopPhase = activeCfopPhases.reduce((dominant, phase) => (
    (phase.value ?? 0) > (dominant.value ?? 0) ? phase : dominant
  ), activeCfopPhases[0]);
  const cfopBarTotal = Math.max(activeCfopBreakdown.avg, activeCfopBreakdown.phaseTotal, 1);
  const cfopRangePosition = activeCfopBreakdown.best != null
    && activeCfopBreakdown.worst != null
    && activeCfopBreakdown.worst > activeCfopBreakdown.best
    ? Math.min(100, Math.max(0, ((activeCfopBreakdown.avg - activeCfopBreakdown.best) / (activeCfopBreakdown.worst - activeCfopBreakdown.best)) * 100))
    : 50;

  const todayLocalDate = getDailyTestDateKey();
  const dailyLevelSummary = useMemo(
    () => summarizeDailyLevels(dailyLevels, todayLocalDate),
    [dailyLevels, todayLocalDate],
  );
  const todayDailyLevel = dailyLevelSummary.today;
  const dailyLevelRows = dailyLevelSummary.rows;
  const bestDailyLevel = dailyLevelSummary.bestEntry?.averageMs ?? null;
  const dailyLevelTrend = dailyLevelSummary.trend;
  const recentDailyLevels = dailyLevelRows.slice(0, 5);
  const recentSevenDailyAverage = dailyLevelRows.length === 0
    ? null
    : dailyLevelRows.slice(0, 7).reduce((sum, entry) => sum + entry.averageMs, 0) / Math.min(7, dailyLevelRows.length);
  useEffect(() => {
    const svg = dailyLevelChartRef.current;
    if (!svg) return;
    const updateWidth = () => {
      const nextWidth = Math.max(320, Math.round(svg.getBoundingClientRect().width));
      setDailyLevelChartWidth((current) => current === nextWidth ? current : nextWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [dailyLevelTrend.points.length]);

  useEffect(() => {
    if (!dailyLevelTip) return;

    function refreshDailyLevelTipPosition() {
      setDailyLevelTip((current) => {
        if (!current) return current;
        const index = dailyLevelTrend.entries.findIndex((entry, entryIndex) => current.pointKey === `${entry.id}-${entryIndex}`);
        const entry = dailyLevelTrend.entries[index];
        const target = document.querySelector<SVGCircleElement>(`.daily-level-hit-point[data-point-index="${index}"]`);
        if (!entry || !target) return current;
        const rect = target.getBoundingClientRect();
        const anchorX = rect.left + rect.width / 2;
        const anchorY = rect.top + rect.height / 2;
        const maxLeft = window.innerWidth - DL_TIP_WIDTH - DL_TIP_MARGIN;
        const maxTop = window.innerHeight - DL_TIP_HEIGHT - DL_TIP_MARGIN;
        const placement = anchorY > DL_TIP_HEIGHT + DL_TIP_GAP + DL_TIP_MARGIN ? "above" : "below";
        const idealLeft = anchorX - DL_TIP_WIDTH / 2;
        const left = Math.min(maxLeft, Math.max(DL_TIP_MARGIN, idealLeft));
        const idealTop = placement === "above"
          ? anchorY - DL_TIP_HEIGHT - DL_TIP_GAP
          : anchorY + DL_TIP_GAP;
        const top = Math.min(maxTop, Math.max(DL_TIP_MARGIN, idealTop));
        const arrowLeft = Math.min(DL_TIP_WIDTH - 22, Math.max(22, anchorX - left));
        return {
          ...current,
          entry,
          pointKey: `${entry.id}-${index}`,
          left,
          top,
          arrowLeft,
          placement,
        };
      });
    }

    window.addEventListener("scroll", refreshDailyLevelTipPosition, true);
    window.addEventListener("resize", refreshDailyLevelTipPosition);
    return () => {
      window.removeEventListener("scroll", refreshDailyLevelTipPosition, true);
      window.removeEventListener("resize", refreshDailyLevelTipPosition);
    };
  }, [dailyLevelTip, dailyLevelTrend]);

  useEffect(() => {
    if (!isDailyHistoryOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dailyHistoryCloseRef.current?.focus();

    function closeDailyHistoryOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsDailyHistoryOpen(false);
    }

    window.addEventListener("keydown", closeDailyHistoryOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeDailyHistoryOnEscape);
    };
  }, [isDailyHistoryOpen]);

  function showTrendCfopTipAt(
    entry: SolveHistoryEntry,
    pointKey: string,
    pointNumber: number,
    pointIndex: number,
    anchorX: number,
    anchorY: number,
  ) {
    const maxLeft = window.innerWidth - TREND_TIP_WIDTH - TREND_TIP_MARGIN;
    const maxTop = window.innerHeight - TREND_TIP_HEIGHT - TREND_TIP_MARGIN;
    const placement = anchorY > TREND_TIP_HEIGHT + TREND_TIP_GAP + TREND_TIP_MARGIN ? "above" : "below";
    const idealLeft = anchorX - TREND_TIP_WIDTH / 2;
    const left = Math.min(maxLeft, Math.max(TREND_TIP_MARGIN, idealLeft));
    const idealTop = placement === "above"
      ? anchorY - TREND_TIP_HEIGHT - TREND_TIP_GAP
      : anchorY + TREND_TIP_GAP;
    const top = Math.min(maxTop, Math.max(TREND_TIP_MARGIN, idealTop));
    const arrowLeft = Math.min(TREND_TIP_WIDTH - 22, Math.max(22, anchorX - left));
    setTrendCfopTip({
      entry,
      pointKey,
      pointNumber,
      pointIndex,
      left,
      top,
      arrowLeft,
      placement,
    });
  }

  function showTrendCfopTip(entry: SolveHistoryEntry, pointKey: string, pointNumber: number, target: SVGCircleElement) {
    const rect = target.getBoundingClientRect();
    showTrendCfopTipAt(entry, pointKey, pointNumber, pointNumber - 1, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function showTrendPointTip(entry: SolveHistoryEntry, pointKey: string, pointIndex: number, target: SVGCircleElement) {
    setTrendGuideIndex(pointIndex);
    showTrendCfopTip(entry, pointKey, pointIndex + 1, target);
  }

  function clearTrendHover() {
    setTrendGuideIndex(null);
    setTrendCfopTip(null);
  }

  function showDailyLevelTipAt(entry: DailyLevelEntry, pointKey: string, anchorX: number, anchorY: number) {
    const maxLeft = window.innerWidth - DL_TIP_WIDTH - DL_TIP_MARGIN;
    const maxTop = window.innerHeight - DL_TIP_HEIGHT - DL_TIP_MARGIN;
    const placement = anchorY > DL_TIP_HEIGHT + DL_TIP_GAP + DL_TIP_MARGIN ? "above" : "below";
    const idealLeft = anchorX - DL_TIP_WIDTH / 2;
    const left = Math.min(maxLeft, Math.max(DL_TIP_MARGIN, idealLeft));
    const idealTop = placement === "above"
      ? anchorY - DL_TIP_HEIGHT - DL_TIP_GAP
      : anchorY + DL_TIP_GAP;
    const top = Math.min(maxTop, Math.max(DL_TIP_MARGIN, idealTop));
    const arrowLeft = Math.min(DL_TIP_WIDTH - 22, Math.max(22, anchorX - left));
    setDailyLevelTip({ entry, pointKey, left, top, arrowLeft, placement });
  }

  function showHeatmapTip(cell: HeatmapCell, event: ReactPointerEvent<HTMLDivElement>) {
    const dateLabel = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, "0")}-${String(cell.date.getDate()).padStart(2, "0")}`;
    const idealLeft = event.clientX + 12;
    const idealTop = event.clientY + 12;
    setHeatmapTip({
      count: cell.count,
      practiceSeconds: cell.practiceSeconds,
      dateLabel,
      left: Math.min(window.innerWidth - HEATMAP_TIP_WIDTH - HEATMAP_TIP_MARGIN, Math.max(HEATMAP_TIP_MARGIN, idealLeft)),
      top: Math.min(window.innerHeight - 116 - HEATMAP_TIP_MARGIN, Math.max(HEATMAP_TIP_MARGIN, idealTop)),
    });
  }

  const TrendChart = () => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [viewBoxWidth, setViewBoxWidth] = useState(TREND_CHART_WIDTH);
    const width = viewBoxWidth;
    const height = TREND_CHART_HEIGHT;
    const padLeft = TREND_CHART_PAD_LEFT;
    const padRight = TREND_CHART_PAD_RIGHT;
    const padTop = TREND_CHART_PAD_TOP;
    const padBottom = TREND_CHART_PAD_BOTTOM;
    const { entries, points, min, max, stableScore, best } = trend;
    const axis = trendAxisScale(min, max, trendMetric);
    const axisMin = axis.min;
    const axisMax = axis.max;

    useEffect(() => {
      const svg = svgRef.current;
      if (!svg) return;
      const updateChartWidth = () => {
        const nextWidth = getTrendChartWidthForRect(svg.getBoundingClientRect());
        setViewBoxWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
      };
      updateChartWidth();
      const observer = new ResizeObserver(updateChartWidth);
      observer.observe(svg);
      return () => observer.disconnect();
    }, [points.length]);

    const hasTrendPoints = points.some((value) => value != null);
    const trendPhaseName = TREND_PHASE_FILTER_NAMES[trendPhaseFilter];
    const trendMetricName = trendMetric === "moves" ? t("步数") : t("用时");
    const trendSubjectName = trendPhaseFilter === "all" ? trendMetricName : t(`${trendPhaseName}阶段${trendMetricName}`);
    if (!hasTrendPoints) return <div className="chart-empty">{trendPhaseFilter === "all" ? (trendMetric === "moves" ? t("暂无步数数据") : t("无数据")) : t(`暂无${trendSubjectName}数据`)}</div>;
    const plotWidth = width - padLeft - padRight;
    const x = (index: number) => padLeft + plotWidth * (points.length === 1 ? 0.5 : index / (points.length - 1));
    const y = (value: number | null) => {
      if (value == null) return height - padBottom;
      return height - padBottom - (height - padTop - padBottom) * ((value - axisMin) / Math.max(1, axisMax - axisMin));
    };
    const yTicks = axis.ticks;
    const xTickIndexes = sampledTickIndexes(points.length, TREND_X_TICK_TARGET_COUNT);
    const stableScorePath = createSegmentedMonotoneCubicPath(stableScore, (value, index) => ({ x: x(index), y: y(value) }));
    const guideIndex = trendGuideIndex == null ? -1 : Math.min(points.length - 1, Math.max(0, trendGuideIndex));
    const guideStableScore = guideIndex >= 0 ? stableScore[guideIndex] : null;
    const guideLabelX = guideIndex >= 0 ? Math.min(width - padRight - 36, Math.max(padLeft + 36, x(guideIndex))) : 0;

    function handleTrendPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
      if (points.length === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height);
      const viewLeft = rect.left + (rect.width - width * scale) / 2;
      const svgX = (event.clientX - viewLeft) / Math.max(0.001, scale);
      const rawIndex = points.length === 1 ? 0 : ((svgX - padLeft) / plotWidth) * (points.length - 1);
      const index = Math.min(points.length - 1, Math.max(0, Math.round(rawIndex)));
      setTrendGuideIndex(index);
      setTrendCfopTip(null);
    }

    function clearTrendPoint() {
      clearTrendHover();
    }

    return (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="trend-svg"
        role="img"
        aria-label={t(`${trendSubjectName}趋势图`)}
        onPointerMove={handleTrendPointerMove}
        onPointerLeave={clearTrendPoint}
        onMouseLeave={clearTrendPoint}
      >
        <defs>
          <linearGradient id="trendStableScoreGradient" x1={padLeft} x2={width - padRight} y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#78aaff" />
            <stop offset="54%" stopColor="#3475f6" />
            <stop offset="100%" stopColor="#1f5de0" />
          </linearGradient>
          <filter id="trendLineGlow" x="-10%" y="-30%" width="120%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#2f6ff2" floodOpacity="0.18" />
          </filter>
        </defs>
        {yTicks.map((tick) => (
          <text
            key={`y-label-${tick}`}
            x={padLeft - 10}
            y={y(tick)}
            fill="rgba(104, 122, 154, 0.78)"
            fontFamily="JetBrains Mono"
            fontSize="9"
            fontWeight="800"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {fmtTrendAxisValue(tick, trendMetric)}
          </text>
        ))}
        {yTicks.slice(1, -1).map((tick) => (
          <line
            key={`y-grid-${tick}`}
            x1={padLeft}
            x2={width - padRight}
            y1={y(tick)}
            y2={y(tick)}
            stroke="rgba(47, 111, 242, 0.12)"
            strokeWidth="1"
            strokeDasharray="3 7"
          />
        ))}
        {showTrendPb && best != null && (
          <>
            <line x1={padLeft} x2={width - padRight} y1={y(best)} y2={y(best)} stroke="rgba(201, 53, 42, 0.72)" strokeWidth="1.1" strokeDasharray="4 6" />
            <text x={width - padRight - 64} y={Math.max(14, y(best) - 6)} fontSize="9" fill="#C9352A" fontFamily="JetBrains Mono">BEST {fmtTrendValue(best, trendMetric)}</text>
          </>
        )}
        {xTickIndexes.map((index) => (
          <g key={`x-label-${index}`}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={height - padBottom + 4}
              y2={height - padBottom + 8}
              stroke="rgba(104, 122, 154, 0.28)"
              strokeWidth="1"
            />
            <text
              x={x(index)}
              y={height - 8}
              fill="rgba(104, 122, 154, 0.78)"
              fontFamily="JetBrains Mono"
              fontSize="9"
              fontWeight="800"
              textAnchor="middle"
            >
              #{index + 1}
            </text>
          </g>
        ))}
        {stableScorePath && (
          <path
            d={stableScorePath}
            fill="none"
            stroke="url(#trendStableScoreGradient)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#trendLineGlow)"
          />
        )}
        {guideIndex >= 0 && (
          <>
            <line
              className="trend-snap-line"
              x1={x(guideIndex)}
              x2={x(guideIndex)}
              y1={padTop}
              y2={height - padBottom}
            />
            <text
              className="trend-guide-label"
              x={guideLabelX}
              y={padTop + 12}
              textAnchor="middle"
            >
              {trendMetric === "moves"
                ? t(`成绩走势 ${guideStableScore == null ? "--" : fmtTrendValue(guideStableScore, trendMetric)}`)
                : t(`成绩走势 ${guideStableScore == null ? "--" : fmtShort(guideStableScore)}`)}
            </text>
          </>
        )}
        {points.map((value, index) => {
          if (value == null) return null;
          const entry = entries[index];
          const pointKey = `${entry.ts}-${index}`;
          const isActive = trendCfopTip?.pointKey === pointKey;
          const isBest = showTrendPb && best != null && value === best;
          const pointColor = isBest ? "#C9352A" : "#8291A8";
          return (
            <g key={pointKey} className={`trend-point-group${isActive ? " active" : ""}`}>
              {isActive && (
                <circle
                  className="trend-active-ring"
                  cx={x(index)}
                  cy={y(value)}
                  r="6.4"
                  fill={pointColor}
                />
              )}
              <circle cx={x(index)} cy={y(value)} r={isBest ? "3.3" : "2.15"} fill={pointColor} opacity={isBest ? "0.92" : "0.5"} />
              <circle
                className="trend-hit-point"
                cx={x(index)}
                cy={y(value)}
                r="9"
                tabIndex={0}
                aria-label={t(`第 ${index + 1} 次${trendSubjectName} ${fmtTrendValue(value, trendMetric)}`)}
                onBlur={() => setTrendCfopTip(null)}
                onPointerEnter={(event) => {
                  event.stopPropagation();
                  showTrendPointTip(entry, pointKey, index, event.currentTarget);
                }}
                onPointerMove={(event) => {
                  event.stopPropagation();
                  showTrendPointTip(entry, pointKey, index, event.currentTarget);
                }}
                onPointerLeave={() => setTrendCfopTip(null)}
                onFocus={(event) => showTrendPointTip(entry, pointKey, index, event.currentTarget)}
              />
            </g>
          );
        })}
      </svg>
    );
  };

  const renderDailyLevelChart = () => {
    const W = dailyLevelChartWidth, H = 262;
    const padLeft = 48, padRight = 20, padTop = 16, padBot = 32;
    const { entries, points, min, max } = dailyLevelTrend;

    if (points.length === 0) return <div className="chart-empty">{t("暂无每日测试数据")}</div>;
    const rawRange = Math.max(1, max - min);
    const domainPadding = Math.max(500, rawRange * 0.12);
    const domainMin = Math.max(0, min - domainPadding);
    const domainMax = max + domainPadding;
    const range = Math.max(1, domainMax - domainMin);
    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBot;
    const xv = (i: number) => padLeft + chartW * (points.length === 1 ? 0.5 : i / (points.length - 1));
    const yv = (v: number) => padTop + chartH * (1 - (v - domainMin) / range);
    const yTicks = [domainMax, domainMin + range / 2, domainMin];
    const xTickIndexes = sampledTickIndexes(points.length, 6);

    const coords = points.map((v, i) => ({ x: xv(i), y: yv(v) }));
    const linePath = createMonotoneCubicPath(coords);
    const areaPath = `${linePath} L${xv(points.length - 1).toFixed(1)},${H - padBot} L${xv(0).toFixed(1)},${H - padBot} Z`;
    const activeDlIndex = dailyLevelTip
      ? entries.findIndex((entry, index) => dailyLevelTip.pointKey === `${entry.id}-${index}`)
      : -1;

    function activateDlPoint(index: number, svg: SVGSVGElement) {
      const entry = entries[index];
      if (!entry) return;
      const pointKey = `${entry.id}-${index}`;
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width / W, rect.height / H);
      const viewLeft = rect.left + (rect.width - W * scale) / 2;
      const viewTop = rect.top + (rect.height - H * scale) / 2;
      const anchorX = viewLeft + xv(index) * scale;
      const anchorY = viewTop + yv(points[index]) * scale;
      showDailyLevelTipAt(entry, pointKey, anchorX, anchorY);
    }

    function handleDlPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
      if (points.length === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = Math.min(rect.width / W, rect.height / H);
      const viewLeft = rect.left + (rect.width - W * scale) / 2;
      const svgX = (event.clientX - viewLeft) / Math.max(0.001, scale);
      const rawIndex = points.length === 1 ? 0 : ((svgX - padLeft) / chartW) * (points.length - 1);
      const index = Math.min(points.length - 1, Math.max(0, Math.round(rawIndex)));
      activateDlPoint(index, event.currentTarget);
    }

    return (
      <svg
        ref={dailyLevelChartRef}
        viewBox={`0 0 ${W} ${H}`}
        className="daily-level-svg"
        role="img"
        aria-label={t("每日能力水平变化趋势")}
        onPointerMove={handleDlPointerMove}
        onPointerLeave={() => setDailyLevelTip(null)}
        onMouseLeave={() => setDailyLevelTip(null)}
      >
        <defs>
          <linearGradient id="dailyLevelArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2f6ff2" stopOpacity="0.2" />
            <stop offset="88%" stopColor="#2f6ff2" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#2f6ff2" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={padLeft} y1={yv(tick)} x2={W - padRight} y2={yv(tick)} stroke="rgba(47,111,242,0.1)" strokeWidth="1" strokeDasharray="3 7" />
            <text x={padLeft - 10} y={yv(tick)} fill="rgba(104,122,154,0.82)" fontFamily="JetBrains Mono" fontSize="9" fontWeight="800" textAnchor="end" dominantBaseline="middle">
              {fmtStatsTime(tick)}
            </text>
          </g>
        ))}

        {xTickIndexes.map((index) => (
          <text key={entries[index].id} x={xv(index)} y={H - 8} fill="rgba(104,122,154,0.82)" fontFamily="JetBrains Mono" fontSize="9" fontWeight="800" textAnchor="middle">
            {entries[index].localDate.slice(5)}
          </text>
        ))}

        <path d={areaPath} fill="url(#dailyLevelArea)" />
        <path d={linePath} fill="none" stroke="#2f6ff2" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" />

        {activeDlIndex >= 0 && (
          <line
            className="dl-snap-line"
            x1={xv(activeDlIndex)} y1={padTop}
            x2={xv(activeDlIndex)} y2={H - padBot}
          />
        )}

        {points.map((value, index) => {
          const isBest = value === bestDailyLevel;
          const isActive = index === activeDlIndex;
          const cx = xv(index);
          const cy = yv(value);
          return (
            <g key={`${entries[index]?.id ?? index}`}>
              <circle
                className="daily-level-hit-point"
                data-point-index={index}
                cx={cx}
                cy={cy}
                r="11"
                fill="transparent"
                tabIndex={0}
                onFocus={(event) => activateDlPoint(index, event.currentTarget.ownerSVGElement!)}
                onBlur={() => setDailyLevelTip(null)}
              />
              {isActive && (
                <circle cx={cx} cy={cy} r={isBest ? 9 : 8}
                  fill={isBest ? "rgba(201,53,42,0.26)" : "rgba(47,111,242,0.22)"} />
              )}
              {isBest ? (
                <>
                  <circle cx={cx} cy={cy} r="4.8" fill="#c9352a" />
                  <circle cx={cx} cy={cy} r="1.8" fill="rgba(255,255,255,0.65)" />
                </>
              ) : (
                <circle cx={cx} cy={cy} r="2.8" fill="#2f6ff2" />
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  function TrendDropdown<T extends string>({
    id,
    label,
    value,
    options,
    onSelect,
  }: {
    id: "metric" | "phase" | "range";
    label: string;
    value: T;
    options: Array<{ key: T; label: string }>;
    onSelect: (value: T) => void;
  }) {
    const open = openTrendDropdown === id;
    const activeOption = options.find((option) => option.key === value) ?? options[0];

    return (
      <div
        className={`trend-dropdown${open ? " open" : ""}`}
        onPointerEnter={() => setOpenTrendDropdown(id)}
        onPointerLeave={() => setOpenTrendDropdown((current) => (current === id ? null : current))}
        onFocus={() => setOpenTrendDropdown(id)}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setOpenTrendDropdown((current) => (current === id ? null : current));
        }}
      >
        <button
          type="button"
          className="trend-dropdown-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpenTrendDropdown(id)}
        >
          <span>{t(activeOption.label)}</span>
          <i aria-hidden="true"></i>
        </button>
        <div className="trend-dropdown-menu" role="menu" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`trend-dropdown-item${option.key === value ? " active" : ""}`}
              role="menuitem"
              onClick={() => {
                onSelect(option.key);
                setOpenTrendDropdown(null);
                clearTrendHover();
              }}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app lf-stats-app">
      <AppTopbar />

      <main className="st-main">
        <section className="st-activity-row">
          <div className="st-records st-records-compact">
            <div className="st-rec st-rec-pb">
              <div className="strr-l">{t("最佳 · PB")}</div>
              <div className="strr-v">{fmtStatsTime(records.pb)}</div>
              <div className="strr-meta">{records.count}{" "}{t("次记录")}</div>
            </div>
            <div className="st-rec st-rec-ao">
              <div className="strr-l">{t("平均用时 · AVG")}</div>
              <div className="st-ao-grid">
                <div className="st-ao-item">
                  <div className="st-ao-key">AO5</div>
                  <div className="st-ao-value">{fmtStatsTime(records.ao5)}</div>
                  <div className="st-ao-meta">{t("最近 5 次去掉首尾")}</div>
                </div>
                <div className="st-ao-divider" aria-hidden="true" />
                <div className="st-ao-item">
                  <div className="st-ao-key">{t("稳定成绩")}</div>
                  <div className="st-ao-value">{fmtStatsTime(records.stableScore)}</div>
                  <div className="st-ao-meta">{t(stableScoreMeta)}</div>
                </div>
                <div className="st-ao-divider" aria-hidden="true" />
                <div className="st-ao-item">
                  <div className="st-ao-key">AO100</div>
                  <div className="st-ao-value">{fmtStatsTime(records.ao100)}</div>
                  <div className="st-ao-meta">{t("最近 100 次去掉 10 次")}</div>
                </div>
              </div>
            </div>
          </div>
          <div
            className="st-card st-daily-level"
            onPointerLeave={() => setDailyLevelTip(null)}
            onMouseLeave={() => setDailyLevelTip(null)}
          >
            <div className="st-daily-level-head">
              <div className="st-daily-title-block">
                <div className="st-ch-kicker">— DAILY LEVEL</div>
                <div className="st-ch-title">{t("每日能力水平")}</div>
              </div>
              {todayDailyLevel ? (
                <div className="dl-today-result">
                  <span>{t("今日成绩")}</span>
                  <b>{fmtStatsTime(todayDailyLevel.averageMs)}</b>
                </div>
              ) : (
                <Link className="dl-start-link dl-title-start-link" href="/practice">
                  {t("开始今日测试")}
                </Link>
              )}
              <div className="dl-head-summary">
                <div className="dl-head-metric">
                  <span>{t("历史最佳")}</span>
                  <b>{fmtStatsTime(bestDailyLevel)}</b>
                </div>
                <div className="dl-head-metric">
                  <span>{t("近 7 次平均")}</span>
                  <b>{fmtStatsTime(recentSevenDailyAverage)}</b>
                </div>
              </div>
              <button
                type="button"
                className="dl-history-open"
                aria-haspopup="dialog"
                aria-expanded={isDailyHistoryOpen}
                onClick={() => setIsDailyHistoryOpen(true)}
              >
                {t("查看全部成绩")}
              </button>
            </div>
            {dailyLevels.length === 0 ? (
              <div className="dl-empty">
                <p>{t("在练习页完成每日水平测试后，这里会显示五次复原的平均水平。")}</p>
                <Link className="dl-start-link" href="/practice">{t("开始今日测试")}</Link>
              </div>
            ) : (
              <div className="daily-level-board">
                <div className="dl-chart-summary">
                  <em>{t(`${dailyLevels.length} 天测试`)}</em>
                </div>
                <div className="dl-chart">
                  {renderDailyLevelChart()}
                </div>
                <div className="dl-recent" aria-label={t("最近 5 次每日测试")}>
                  {recentDailyLevels.map((entry, index) => {
                    const previous = dailyLevelRows[index + 1];
                    const delta = previous ? previous.averageMs - entry.averageMs : null;
                    return (
                      <div key={entry.id} className="dl-row">
                        <span className="dl-date">{entry.localDate}</span>
                        <b>{fmtShort(entry.averageMs)}</b>
                        <em className={delta == null ? "" : delta >= 0 ? "faster" : "slower"}>
                          {delta == null ? "—" : `${t(delta >= 0 ? "快" : "慢")} ${fmtStatsTime(Math.abs(delta))}`}
                        </em>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {portalReady && dailyLevelTip && createPortal(
              <div
                className={`stats-dl-floating-tip tip-${dailyLevelTip.placement}`}
                role="tooltip"
                style={{
                  left: dailyLevelTip.left,
                  top: dailyLevelTip.top,
                  "--tip-arrow-left": `${dailyLevelTip.arrowLeft}px`,
                } as CSSProperties}
              >
                <div className="dl-tip-head">
                  <span>{dailyLevelTip.entry.localDate}</span>
                  <em>{t("每日测试")}</em>
                </div>
                <div className="dl-tip-solves">
                  {(() => {
                    const excluded = getDailyLevelExcludedSolveIndexes(dailyLevelTip.entry.solves);
                    return dailyLevelTip.entry.solves.map((solve, i) => {
                      const isExcluded = excluded.has(i);
                      return (
                        <div key={i} className={`dl-tip-row${isExcluded ? " excluded" : ""}`}>
                          <span>{i + 1}</span>
                          <b>{fmtShort(solve.ms)}</b>
                          <em>{fmtMoveCount(solve.moves)}</em>
                        </div>
                      );
                    });
                  })()}
                </div>
                <div className="dl-tip-avg">
                  <span>AO5</span>
                  <b>{fmtShort(dailyLevelTip.entry.averageMs)}</b>
                  <em>{fmtMoveCount(averageDailyLevelMoves(dailyLevelTip.entry))}</em>
                </div>
              </div>,
              document.body,
            )}
            {portalReady && isDailyHistoryOpen && createPortal(
              <div className="dl-history-backdrop" onMouseDown={() => setIsDailyHistoryOpen(false)}>
                <section
                  className="dl-history-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="daily-history-title"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="dl-history-dialog-head">
                    <div>
                      <div className="st-ch-kicker">— DAILY LEVEL</div>
                      <h2 id="daily-history-title">{t("全部每日成绩")}</h2>
                      <p>{dailyLevelRows.length} {t("天测试")}</p>
                    </div>
                    <button
                      ref={dailyHistoryCloseRef}
                      type="button"
                      className="dl-history-close"
                      aria-label={t("关闭")}
                      onClick={() => setIsDailyHistoryOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  {dailyLevelRows.length === 0 ? (
                    <div className="dl-history-empty">{t("暂无每日测试数据")}</div>
                  ) : (
                    <div className="dl-history-table-wrap">
                      <table className="dl-history-table">
                        <thead>
                          <tr>
                            <th>{t("日期")}</th>
                            <th>{t("每日成绩")}</th>
                            <th>{t("五次复原")}</th>
                            <th>{t("平均步数")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyLevelRows.map((entry) => {
                            const excluded = getDailyLevelExcludedSolveIndexes(entry.solves);
                            return (
                              <tr key={entry.id}>
                                <td className="dl-history-date">{entry.localDate}</td>
                                <td className="dl-history-score">{fmtShort(entry.averageMs)}</td>
                                <td>
                                  <div className="dl-history-solves">
                                    {entry.solves.map((solve, index) => (
                                      <span key={`${entry.id}-${index}`} className={excluded.has(index) ? "excluded" : ""}>
                                        <em>{index + 1}</em>
                                        {fmtShort(solve.ms)}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="dl-history-moves">{fmtMoveCount(averageDailyLevelMoves(entry))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>,
              document.body,
            )}
          </div>
        </section>

        <section className="st-heatmap-row">
          <div className="st-card st-heatmap">
            <div className="st-card-head">
              <div>
                <div className="st-ch-kicker">— ACTIVITY</div>
                <div className="st-ch-title">{t("练习热力图 · 最近 16 周")}</div>
              </div>
              <div className="st-heat-summary" aria-label={t("最近 16 周练习摘要")}>
                <span>{t("活跃天数")}{" "}<b>{heatmap.activeDays}</b></span>
                <span>{t("练习次数")}{" "}<b>{heatmap.total}</b></span>
                <span>{t("训练总时长")}{" "}<b>{t(fmtPracticeDuration(heatmap.totalPracticeSeconds))}</b></span>
              </div>
            </div>
            <div className="hm-panel">
              <div className="hm-panel-top">
                <div className="hm-focus">
                  <span className="hm-focus-k">{t("今日")}</span>
                  <span className="hm-focus-v">
                    {heatmap.today.getMonth() + 1}/{heatmap.today.getDate()} · {t(fmtPracticeMinutesCompact(heatmap.todayPracticeSeconds))}
                  </span>
                </div>
                <div className="st-legend hm-legend" aria-label={t("热力图颜色图例")}>
                  <span>{t("少")}</span>
                  {[0, 1, 2, 3, 4].map((level) => (
                    <span key={level} className="hm-cell" data-level={level}></span>
                  ))}
                  <span>{t("多")}</span>
                </div>
              </div>
              <div className="hm-scroll">
                <div className="hm-month-row" aria-hidden="true">
                  <div></div>
                  <div className="hm-month-labels">
                    {heatmap.monthLabels.map((month, index) => (
                      <span key={`${month}-${index}`}>{month}</span>
                    ))}
                  </div>
                </div>
                <div className="hm-grid" role="img" aria-label={t("最近 16 周每天练习热力图")}>
                  <div className="hm-day-labels">
                    {[t("一"), t("二"), t("三"), t("四"), t("五"), t("六"), t("日")].map((day) => (
                      <div key={day} className="hm-dl">{day}</div>
                    ))}
                  </div>
                  <div className="hm-cols">
                    {heatmap.grid.map((col, colIndex) => (
                      <div key={colIndex} className="hm-col">
                        {col.map((cell, dayIndex) => {
                          const intensity = Math.min(1, cell.heatSeconds / HEATMAP_FULL_SECONDS);
                          const level = cell.heatSeconds <= 0 ? 0 : Math.ceil(intensity * 4);
                          return (
                            <div
                              key={dayIndex}
                              className={`hm-cell${cell.isFuture ? " hm-cell-future" : ""}`}
                              data-level={level}
                              aria-label={cell.isFuture
                                ? t(`${cell.date.getMonth() + 1}月${cell.date.getDate()}日，未来日期`)
                                : t(`${cell.date.getMonth() + 1}月${cell.date.getDate()}日，${cell.count} 次练习`)}
                              onPointerEnter={cell.isFuture ? undefined : (event) => showHeatmapTip(cell, event)}
                              onPointerMove={cell.isFuture ? undefined : (event) => showHeatmapTip(cell, event)}
                              onPointerLeave={() => setHeatmapTip(null)}
                            ></div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {portalReady && heatmapTip && createPortal((
            <div className="stats-heatmap-tip" role="tooltip" style={{ left: heatmapTip.left, top: heatmapTip.top }}>
              <span>{heatmapTip.dateLabel}</span>
              <b>{heatmapTip.count}</b>
              <em>{heatmapTip.count > 0 ? t("次练习") : t("暂无练习")}</em>
              {heatmapTip.practiceSeconds != null ? (
                <small className="hm-tip-duration">{t("练习时长")}{" "}{t(fmtPracticeMinutes(heatmapTip.practiceSeconds))}</small>
              ) : null}
            </div>
          ), document.body)}
        </section>

        <section className="st-row-2">
          <div
            className="st-card st-trend"
            onPointerLeave={clearTrendHover}
            onMouseLeave={clearTrendHover}
          >
            <div className="st-card-head st-trend-head">
              <div className="trend-heading">
                <div>
                  <div className="st-ch-kicker">— TREND</div>
                  <div className="st-ch-title">{t("成绩趋势")}</div>
                </div>
                <div className="st-legend trend-legend">
                  <span><span className="lg-dot trend-dot-single"></span>{t("单次")}</span>
                  <span><span className="lg-dot trend-dot-stable"></span>{t("成绩走势")}</span>
                  {showTrendPb && <span><span className="lg-dot trend-dot-pb"></span>PB</span>}
                </div>
              </div>
              <div className="trend-control-rail">
                <TrendDropdown
                  id="range"
                  label={t("成绩趋势显示范围")}
                  value={trendRange}
                  options={trendRangeOptions}
                  onSelect={setTrendRange}
                />
                <TrendDropdown
                  id="metric"
                  label={t("成绩趋势数据类型")}
                  value={trendMetric}
                  options={TREND_METRIC_FILTERS}
                  onSelect={setTrendMetric}
                />
                <TrendDropdown
                  id="phase"
                  label={t("成绩趋势阶段")}
                  value={trendPhaseFilter}
                  options={TREND_PHASE_FILTERS.map((phase) => ({
                    key: phase.key,
                    label: TREND_PHASE_DROPDOWN_LABELS[phase.key],
                  }))}
                  onSelect={setTrendPhaseFilter}
                />
              </div>
            </div>
            <div className="trend-chart-shell">
              <div className="st-chart"><TrendChart /></div>
            </div>
            {portalReady && trendCfopTip && createPortal((
              <div
                className={`stats-cfop-floating-tip tip-${trendCfopTip.placement}`}
                role="tooltip"
                style={{
                  left: trendCfopTip.left,
                  top: trendCfopTip.top,
                  "--tip-arrow-left": `${trendCfopTip.arrowLeft}px`,
                } as CSSProperties}
              >
                <div className="hcf-head">
                  <span>#{String(trendCfopTip.pointNumber).padStart(3, "0")}</span>
                  <b>{fmtSolveDate(trendCfopTip.entry.ts)}</b>
                </div>
                {CFOP_PHASES.map((phase, index) => (
                  <Fragment key={phase.key}>
                    <div className={`hcf-row${index % 2 === 0 ? " hcf-row-alt" : ""}`}>
                      <span>{phase.name}</span>
                      <b>{formatPhaseTimeDelta(trendCfopTip.entry.cfop, phase.key)}</b>
                      <em>{formatPhaseMoveDelta(trendCfopTip.entry.cfopMoves, phase.key)}</em>
                    </div>
                    {phase.key === "f2l" && (
                      <div className="hcf-f2l-subline" aria-label={t("F2L 子阶段用时和步数")}>
                        {F2L_SUBPHASES.map((subphase, index) => (
                          <span key={subphase.key}>
                            <strong>{index + 1}/4</strong>
                            <b>{formatF2lSubphaseTimeDelta(trendCfopTip.entry.cfop, trendCfopTip.entry.cfopF2l, subphase.key)}</b>
                            <em>{formatF2lSubphaseMoveDelta(trendCfopTip.entry.cfopMoves, trendCfopTip.entry.cfopF2lMoves, subphase.key)}</em>
                          </span>
                        ))}
                      </div>
                    )}
                  </Fragment>
                ))}
                <div className="hcf-row hcf-total">
                  <span>{t("总计")}</span>
                  <b>{fmtShort(trendCfopTip.entry.ms)}</b>
                  <em>{trendCfopTip.entry.moves == null ? MISSING_HISTORY_VALUE : t(`${trendCfopTip.entry.moves}步`)}</em>
                </div>
              </div>
            ), document.body)}
          </div>

          <div className="st-card st-cfop">
            <div className="st-card-head">
              <div>
                <div className="st-ch-kicker">— PERFORMANCE</div>
                <div className="st-ch-title">{t("近期成绩概览")}</div>
              </div>
              {activeCfopBreakdown.mode === "single" && trendCfopTip ? (
                <div className="cfop-point-badge" aria-label={t(`当前练习编号 ${trendCfopTip.pointNumber}`)}>
                  #{String(trendCfopTip.pointNumber).padStart(3, "0")}
                </div>
              ) : (
                <div className="cfop-average-switch" aria-label={t("CFOP 平均样本")}>
                  {CFOP_AVERAGE_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`cfop-average-btn${cfopAverageSize === size ? " active" : ""}`}
                      onClick={() => setCfopAverageSize(size)}
                    >
                      AO{size}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {activeCfopBreakdown.mode === "average" && activeCfopBreakdown.count < activeCfopBreakdown.target ? (
              <div className="chart-empty">{t("需要")}{" "}{activeCfopBreakdown.target}{" "}{t("次 CFOP 阶段数据后显示 AO")}{activeCfopBreakdown.target}。</div>
            ) : (
              <>
                <div className="cfop-overview-summary">
                  <div className="cfop-overview-primary">
                    <span>{t(activeCfopBreakdown.mode === "single" ? "单次成绩" : "近期平均")}</span>
                    <b>{fmtShort(activeCfopBreakdown.avg)}</b>
                  </div>
                  <div className="cfop-overview-secondary">
                    <div>
                      <span>{t("最佳")}</span>
                      <b>{fmtShort(activeCfopBreakdown.best)}</b>
                    </div>
                    <div>
                      <span>{t("有效记录")}</span>
                      <b>{activeCfopBreakdown.count}</b>
                    </div>
                  </div>
                </div>

                <div className="cfop-range">
                  <div className="cfop-section-line">
                    <span>{t("近期区间")}</span>
                    <b className={activeCfopBreakdown.change == null ? "" : activeCfopBreakdown.change <= 0 ? "is-faster" : "is-slower"}>
                      {activeCfopBreakdown.change == null
                        ? t("暂无上周期数据")
                        : `${t("较上一周期")} ${activeCfopBreakdown.change > 0 ? "+" : "-"}${fmtShort(Math.abs(activeCfopBreakdown.change))}`}
                    </b>
                  </div>
                  <div className="cfop-range-track" aria-label={t("近期成绩区间")}>
                    <span className="cfop-range-start" aria-hidden="true"></span>
                    <span className="cfop-range-average" style={{ left: `${cfopRangePosition}%` }} aria-hidden="true"></span>
                    <span className="cfop-range-end" aria-hidden="true"></span>
                  </div>
                  <div className="cfop-range-values">
                    <b>{fmtShort(activeCfopBreakdown.best)}</b>
                    <b style={{ left: `${cfopRangePosition}%` }}>{fmtShort(activeCfopBreakdown.avg)}</b>
                    <b>{fmtShort(activeCfopBreakdown.worst)}</b>
                  </div>
                </div>

                <div className="cfop-composition">
                  <div className="cfop-section-line cfop-composition-head">
                    <strong>{t("CFOP 阶段构成")}</strong>
                    <span>{dominantCfopPhase.name} {t("占比最高")} · {activeCfopBreakdown.avg && dominantCfopPhase.value ? Math.round((dominantCfopPhase.value / activeCfopBreakdown.avg) * 100) : 0}%</span>
                  </div>
                  <div className="cfop-composition-bar" aria-label={t("CFOP 阶段耗时占比")}>
                    {activeCfopPhases.map((phase) => (
                      <span
                        key={phase.key}
                        style={{ width: `${((phase.value ?? 0) / cfopBarTotal) * 100}%`, background: phase.color }}
                        aria-label={`${phase.name} ${fmtShort(phase.value)}`}
                      ></span>
                    ))}
                    <span className="cfop-composition-untracked" style={{ width: `${Math.max(0, ((cfopBarTotal - activeCfopBreakdown.phaseTotal) / cfopBarTotal) * 100)}%` }}></span>
                  </div>
                  <div className="cfop-composition-values">
                    {activeCfopPhases.map((phase) => (
                      <div key={phase.key} style={{ "--cfop-phase-color": phase.color } as CSSProperties}>
                        <span><i aria-hidden="true"></i>{phase.name}</span>
                        <b>{fmtShort(phase.value)}</b>
                        <em>{activeCfopBreakdown.avg && phase.value ? Math.round((phase.value / activeCfopBreakdown.avg) * 100) : 0}%</em>
                      </div>
                    ))}
                  </div>
                </div>

              </>
            )}
          </div>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
