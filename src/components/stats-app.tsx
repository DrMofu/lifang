"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AppFooter, AppTopbar } from "@/components/app-shell";
import {
  DEFAULT_AVERAGE_TIME_SETTINGS,
  calculateAverageTime,
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

const TREND_PHASE_FILTER_NAMES: Record<TrendPhaseFilter, string> = {
  all: "全部",
  cross: "C",
  f2l: "F",
  oll: "O",
  pll: "P",
};

const TREND_PHASE_DROPDOWN_LABELS: Record<TrendPhaseFilter, string> = {
  all: "全部",
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

export function StatsApp() {
  const [history, setHistory] = useState<SolveHistoryEntry[]>(loadSolveHistory);
  const [dailyLevels, setDailyLevels] = useState<DailyLevelEntry[]>(loadDailyLevels);
  const [dailyPractice, setDailyPractice] = useState<DailyPracticeEntry[]>(loadDailyPracticeSecondsWithPendingSession);
  const [cfopAverageSize, setCfopAverageSize] = useState<CfopAverageSize>(5);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("time");
  const [trendPhaseFilter, setTrendPhaseFilter] = useState<TrendPhaseFilter>("all");
  const [averageSettings, setAverageSettings] = useState<AverageTimeSettings>(loadAverageTimeSettings);
  const [trendCfopTip, setTrendCfopTip] = useState<TrendCfopTip | null>(null);
  const [trendGuideIndex, setTrendGuideIndex] = useState<number | null>(null);
  const [openTrendDropdown, setOpenTrendDropdown] = useState<"metric" | "phase" | null>(null);
  const [heatmapTip, setHeatmapTip] = useState<HeatmapTip | null>(null);
  const [dailyLevelTip, setDailyLevelTip] = useState<DailyLevelTip | null>(null);
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

  const records = useMemo(() => {
    if (history.length === 0) return { pb: null, ao5: null, stableScore: null, ao100: null, count: 0 };
    const ms = history.map((entry) => entry.ms);
    const chronologicalMs = history.toReversed().map((entry) => entry.ms);
    const stableScore = history.length >= averageSettings.sampleSize
      ? calculateAverageTime(chronologicalMs, averageSettings)?.valueMs ?? null
      : null;
    return {
      pb: Math.min(...ms),
      ao5: history.length >= 5 ? avgTrim(ms.slice(0, 5)) : null,
      stableScore,
      ao100: history.length >= 100 ? avgTrimByCount(ms.slice(0, 100), 5, 5) : null,
      count: history.length,
    };
  }, [averageSettings, history]);
  const stableScoreMeta = useMemo(() => formatStableScoreMeta(averageSettings), [averageSettings]);

  const trend = useMemo(() => {
    const entries = [...history].reverse();
    const points = entries.map((entry) => trendPointValue(entry, trendMetric, trendPhaseFilter));
    const domainPoints = points.filter((point): point is number => typeof point === "number");
    if (domainPoints.length === 0) return { entries, points, min: 0, max: 0, stableScore: [] as Array<number | null>, best: null as number | null };
    const stableScore = points.map((value, index) => (
      value == null
        ? null
        : calculateAverageTime(
          points.slice(0, index + 1).filter((point): point is number => typeof point === "number"),
          averageSettings,
        )?.valueMs ?? null
    ));
    const best = Math.min(...domainPoints);
    const { min, max } = trendDomain(domainPoints, trendMetric);
    return { entries, points, min, max, stableScore, best };
  }, [averageSettings, history, trendMetric, trendPhaseFilter]);
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
    let max = 0;
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
        max = Math.max(max, count);
        return { date, count, practiceSeconds: practiceSeconds ?? null, heatSeconds, isFuture };
      });
    });
    const cells = grid.flat();
    const total = cells.reduce((sum, cell) => sum + cell.count, 0);
    const activeDays = cells.filter((cell) => cell.count > 0).length;
    const todayPracticeSeconds = practiceSecondsByDate.get(getDailyTestDateKey(today)) ?? 0;
    const monthLabels = grid.map((col, index) => {
      const month = col[0]?.date.getMonth();
      const prevMonth = index > 0 ? grid[index - 1]?.[0]?.date.getMonth() : null;
      if (month == null || (index > 0 && month === prevMonth)) return "";
      return `${month + 1}月`;
    });
    return { activeDays, grid, max, monthLabels, today, todayPracticeSeconds, total };
  }, [dailyPractice, history]);

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
      count: 1,
      target: 1,
    };
  }, [cfopBreakdown, trendCfopTip]);

  const todayLocalDate = getDailyTestDateKey();
  const sortedDailyLevels = useMemo(
    () => [...dailyLevels].sort((a, b) => b.completedAt - a.completedAt),
    [dailyLevels],
  );
  const todayDailyLevel = useMemo(
    () => sortedDailyLevels.find((entry) => entry.localDate === todayLocalDate) ?? null,
    [sortedDailyLevels, todayLocalDate],
  );
  const dailyLevelRows = sortedDailyLevels;
  const slowestDailyLevel = useMemo(
    () => (sortedDailyLevels.length === 0 ? 0 : Math.max(...sortedDailyLevels.map((entry) => entry.averageMs))),
    [sortedDailyLevels],
  );
  const bestDailyLevelEntry = useMemo(
    () => dailyLevels.reduce<DailyLevelEntry | null>(
      (best, entry) => (!best || entry.averageMs < best.averageMs ? entry : best),
      null,
    ),
    [dailyLevels],
  );
  const bestDailyLevel = bestDailyLevelEntry?.averageMs ?? null;
  const dailyLevelTrend = useMemo(() => {
    const entries = [...dailyLevels].sort((a, b) => a.completedAt - b.completedAt);
    const points = entries.map((entry) => entry.averageMs);
    if (points.length === 0) return { entries, points, min: 0, max: 0 };
    return {
      entries,
      points,
      min: Math.min(...points),
      max: Math.max(...points),
    };
  }, [dailyLevels]);

  useEffect(() => {
    if (!dailyLevelTip) return;

    function refreshDailyLevelTipPosition() {
      setDailyLevelTip((current) => {
        if (!current) return current;
        const svg = document.querySelector<SVGSVGElement>(".daily-level-svg");
        const index = dailyLevelTrend.entries.findIndex((entry, entryIndex) => current.pointKey === `${entry.id}-${entryIndex}`);
        const entry = dailyLevelTrend.entries[index];
        const value = dailyLevelTrend.points[index];
        if (!svg || !entry || typeof value !== "number") return current;
        const W = 520;
        const H = 262;
        const padX = 10;
        const padTop = 10;
        const padBot = 10;
        const range = Math.max(1, dailyLevelTrend.max - dailyLevelTrend.min);
        const chartW = W - padX * 2;
        const chartH = H - padTop - padBot;
        const rect = svg.getBoundingClientRect();
        const scale = Math.min(rect.width / W, rect.height / H);
        const viewLeft = rect.left + (rect.width - W * scale) / 2;
        const viewTop = rect.top + (rect.height - H * scale) / 2;
        const x = padX + chartW * (dailyLevelTrend.points.length === 1 ? 0.5 : index / (dailyLevelTrend.points.length - 1));
        const y = padTop + chartH * (1 - (value - dailyLevelTrend.min) / range);
        const anchorX = viewLeft + x * scale;
        const anchorY = viewTop + y * scale;
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
    const trendMetricName = trendMetric === "moves" ? "步数" : "用时";
    const trendSubjectName = trendPhaseFilter === "all" ? trendMetricName : `${trendPhaseName}阶段${trendMetricName}`;
    if (!hasTrendPoints) return <div className="chart-empty">{trendPhaseFilter === "all" ? (trendMetric === "moves" ? "暂无步数数据" : "无数据") : `暂无${trendSubjectName}数据`}</div>;
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
        aria-label={`${trendSubjectName}趋势图`}
        onPointerMove={handleTrendPointerMove}
        onPointerLeave={clearTrendPoint}
        onMouseLeave={clearTrendPoint}
      >
        <defs>
          <linearGradient id="trendStableScoreGradient" x1={padLeft} x2={width - padRight} y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#67a2ff" />
            <stop offset="54%" stopColor="#2f6ff2" />
            <stop offset="100%" stopColor="#1f5de0" />
          </linearGradient>
          <filter id="trendLineGlow" x="-10%" y="-30%" width="120%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#2f6ff2" floodOpacity="0.2" />
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
            strokeWidth="3.2"
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
                ? `成绩走势 ${guideStableScore == null ? "--" : fmtTrendValue(guideStableScore, trendMetric)}`
                : `成绩走势 ${guideStableScore == null ? "--" : fmtShort(guideStableScore)}`}
            </text>
          </>
        )}
        {points.map((value, index) => {
          if (value == null) return null;
          const entry = entries[index];
          const pointKey = `${entry.ts}-${index}`;
          const isActive = trendCfopTip?.pointKey === pointKey;
          const isBest = showTrendPb && best != null && value === best;
          const pointColor = isBest ? "#C9352A" : "#0E0E0C";
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
              <circle cx={x(index)} cy={y(value)} r={isBest ? "3.2" : "2.2"} fill={pointColor} opacity={isBest ? "0.9" : "0.42"} />
              <circle
                className="trend-hit-point"
                cx={x(index)}
                cy={y(value)}
                r="9"
                tabIndex={0}
                aria-label={`第 ${index + 1} 次${trendSubjectName} ${fmtTrendValue(value, trendMetric)}`}
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

  const DailyLevelChart = () => {
    const W = 520, H = 262;
    const padX = 10, padTop = 10, padBot = 10;
    const { entries, points, min, max } = dailyLevelTrend;
    if (points.length === 0) return <div className="chart-empty">暂无每日测试数据</div>;
    const range = Math.max(1, max - min);
    const chartW = W - padX * 2;
    const chartH = H - padTop - padBot;
    const xv = (i: number) => padX + chartW * (points.length === 1 ? 0.5 : i / (points.length - 1));
    const yv = (v: number) => padTop + chartH * (1 - (v - min) / range);

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
      const rawIndex = points.length === 1 ? 0 : ((svgX - padX) / (W - padX * 2)) * (points.length - 1);
      const index = Math.min(points.length - 1, Math.max(0, Math.round(rawIndex)));
      activateDlPoint(index, event.currentTarget);
    }

    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="daily-level-svg"
        role="img"
        aria-label="每日能力水平变化趋势"
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

        {/* 水平参考线 */}
        {[0, 0.5, 1].map((frac, i) => (
          <line
            key={frac}
            x1={padX} y1={padTop + chartH * frac}
            x2={W - padX} y2={padTop + chartH * frac}
            stroke="rgba(47,111,242,0.1)"
            strokeWidth="1"
            strokeDasharray={i === 1 ? "3 5" : undefined}
          />
        ))}

        {/* 面积填充 */}
        <path d={areaPath} fill="url(#dailyLevelArea)" />

        {/* 主折线 */}
        <path d={linePath} fill="none" stroke="#2f6ff2" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* 悬停垂直虚线（在数据点之下渲染，避免遮挡） */}
        {activeDlIndex >= 0 && (
          <line
            className="dl-snap-line"
            x1={xv(activeDlIndex)} y1={padTop}
            x2={xv(activeDlIndex)} y2={H - padBot}
          />
        )}

        {/* 数据点 */}
        {points.map((value, index) => {
          const isBest = value === bestDailyLevel;
          const isActive = index === activeDlIndex;
          const cx = xv(index);
          const cy = yv(value);
          return (
            <g key={`${entries[index]?.id ?? index}`}>
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
    id: "metric" | "phase";
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
          onClick={() => setOpenTrendDropdown((current) => (current === id ? null : id))}
        >
          <span>{activeOption.label}</span>
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
              {option.label}
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
              <div className="strr-l">最佳 · PB</div>
              <div className="strr-v">{fmtStatsTime(records.pb)}</div>
              <div className="strr-meta">{records.count} 次记录</div>
            </div>
            <div className="st-rec st-rec-ao">
              <div className="strr-l">平均用时 · AVG</div>
              <div className="st-ao-grid">
                <div className="st-ao-item">
                  <div className="st-ao-key">AO5</div>
                  <div className="st-ao-value">{fmtStatsTime(records.ao5)}</div>
                  <div className="st-ao-meta">最近 5 次去掉首尾</div>
                </div>
                <div className="st-ao-divider" aria-hidden="true" />
                <div className="st-ao-item">
                  <div className="st-ao-key">稳定成绩</div>
                  <div className="st-ao-value">{fmtStatsTime(records.stableScore)}</div>
                  <div className="st-ao-meta">{stableScoreMeta}</div>
                </div>
                <div className="st-ao-divider" aria-hidden="true" />
                <div className="st-ao-item">
                  <div className="st-ao-key">AO100</div>
                  <div className="st-ao-value">{fmtStatsTime(records.ao100)}</div>
                  <div className="st-ao-meta">最近 100 次去掉 10 次</div>
                </div>
              </div>
            </div>
          </div>
          <div
            className="st-card st-daily-level st-daily-level-side"
            onPointerLeave={() => setDailyLevelTip(null)}
            onMouseLeave={() => setDailyLevelTip(null)}
          >
            <div className="st-card-head">
              <div>
                <div className="st-ch-kicker">— DAILY LEVEL</div>
                <div className="st-ch-title">每日能力水平</div>
              </div>
              <div className="st-legend">
                <span>{dailyLevels.length ? `${dailyLevels.length} 天测试` : "暂无测试数据"}</span>
              </div>
            </div>
            {dailyLevels.length === 0 ? (
              <div className="chart-empty">在练习页完成每日水平测试后，这里会显示五次复原的平均水平。</div>
            ) : (
              <div className="daily-level-board">
                <div className="dl-main">
                  <span>{todayDailyLevel ? "今日水平" : "今日未测试"}</span>
                  <b>{fmtStatsTime(todayDailyLevel?.averageMs ?? null)}</b>
                  <em>{todayDailyLevel ? todayDailyLevel.localDate : `上次 ${dailyLevelRows[0]?.localDate ?? "—"}`}</em>
                </div>
                <div className="dl-main dl-main-secondary">
                  <span>历史最佳水平</span>
                  <b>{fmtStatsTime(bestDailyLevel)}</b>
                  <em>{bestDailyLevelEntry?.localDate ?? "—"}</em>
                </div>
                <div className="dl-recent">
                  {dailyLevelRows.map((entry) => {
                    const width = slowestDailyLevel > 0 ? `${Math.max(10, (entry.averageMs / slowestDailyLevel) * 100)}%` : "0%";
                    return (
                      <div key={entry.id} className="dl-row">
                        <span className="dl-date">{entry.localDate}</span>
                        <span className="dl-track" aria-hidden="true">
                          <span className="dl-bar" style={{ width }}></span>
                        </span>
                        <b>{fmtShort(entry.averageMs)}</b>
                      </div>
                    );
                  })}
                </div>
                <div className="dl-chart">
                  <DailyLevelChart />
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
                  <em>每日测试</em>
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
          </div>
        </section>

        <section className="st-heatmap-row">
          <div className="st-card st-heatmap">
            <div className="st-card-head">
              <div>
                <div className="st-ch-kicker">— ACTIVITY</div>
                <div className="st-ch-title">练习热力图 · 最近 16 周</div>
              </div>
              <div className="st-heat-summary" aria-label="最近 16 周练习摘要">
                <span><b>{heatmap.activeDays}</b> 活跃天</span>
                <span><b>{heatmap.total}</b> 次练习</span>
                <span><b>{heatmap.max}</b> 单日最高</span>
              </div>
            </div>
            <div className="hm-panel">
              <div className="hm-panel-top">
                <div className="hm-focus">
                  <span className="hm-focus-k">今日</span>
                  <span className="hm-focus-v">
                    {heatmap.today.getMonth() + 1}/{heatmap.today.getDate()} · {fmtPracticeMinutesCompact(heatmap.todayPracticeSeconds)}
                  </span>
                </div>
                <div className="st-legend hm-legend" aria-label="热力图颜色图例">
                  <span>少</span>
                  {[0, 1, 2, 3, 4].map((level) => (
                    <span key={level} className="hm-cell" data-level={level}></span>
                  ))}
                  <span>多</span>
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
                <div className="hm-grid" role="img" aria-label="最近 16 周每天练习热力图">
                  <div className="hm-day-labels">
                    {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
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
                                ? `${cell.date.getMonth() + 1}月${cell.date.getDate()}日，未来日期`
                                : `${cell.date.getMonth() + 1}月${cell.date.getDate()}日，${cell.count} 次练习`}
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
              <em>{heatmapTip.count > 0 ? "次练习" : "暂无练习"}</em>
              {heatmapTip.practiceSeconds != null ? (
                <small className="hm-tip-duration">练习时长 {fmtPracticeMinutes(heatmapTip.practiceSeconds)}</small>
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
            <div className="st-card-head">
              <div>
                <div className="st-ch-kicker">— TREND</div>
                <div className="st-ch-title">成绩趋势</div>
              </div>
              <div className="st-legend">
                <span><span className="lg-dot" style={{ background: "#0E0E0C" }}></span>单次</span>
                <span><span className="lg-dot" style={{ background: "#1F4FB6" }}></span>成绩走势</span>
                {showTrendPb && <span><span className="lg-dot" style={{ background: "#C9352A" }}></span>PB</span>}
                <TrendDropdown
                  id="metric"
                  label="成绩趋势数据类型"
                  value={trendMetric}
                  options={TREND_METRIC_FILTERS}
                  onSelect={setTrendMetric}
                />
                <TrendDropdown
                  id="phase"
                  label="成绩趋势阶段"
                  value={trendPhaseFilter}
                  options={TREND_PHASE_FILTERS.map((phase) => ({
                    key: phase.key,
                    label: TREND_PHASE_DROPDOWN_LABELS[phase.key],
                  }))}
                  onSelect={setTrendPhaseFilter}
                />
              </div>
            </div>
            <div className="st-chart"><TrendChart /></div>
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
                      <div className="hcf-f2l-subline" aria-label="F2L 子阶段用时和步数">
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
                  <span>总计</span>
                  <b>{fmtShort(trendCfopTip.entry.ms)}</b>
                  <em>{trendCfopTip.entry.moves == null ? MISSING_HISTORY_VALUE : `${trendCfopTip.entry.moves}步`}</em>
                </div>
              </div>
            ), document.body)}
          </div>

          <div className="st-card st-cfop">
            <div className="st-card-head">
              <div>
                <div className="st-ch-kicker">— BREAKDOWN</div>
                <div className="st-ch-title">CFOP 阶段耗时</div>
              </div>
              {activeCfopBreakdown.mode === "single" && trendCfopTip ? (
                <div className="cfop-point-badge" aria-label={`当前练习编号 ${trendCfopTip.pointNumber}`}>
                  #{String(trendCfopTip.pointNumber).padStart(3, "0")}
                </div>
              ) : (
                <div className="cfop-average-switch" aria-label="CFOP 平均样本">
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
              <div className="chart-empty">需要 {activeCfopBreakdown.target} 次 CFOP 阶段数据后显示 AO{activeCfopBreakdown.target}。</div>
            ) : (
              <>
                <div className="cfop-rows">
                  {[
                    { key: "cross", name: "Cross", en: "底层十字", color: "#F2C744", value: activeCfopBreakdown.cross },
                    { key: "f2l", name: "F2L", en: "前两层", color: "#1F6B3A", value: activeCfopBreakdown.f2l },
                    { key: "oll", name: "OLL", en: "顶层定向", color: "#1F4FB6", value: activeCfopBreakdown.oll },
                    { key: "pll", name: "PLL", en: "顶层置换", color: "#C9352A", value: activeCfopBreakdown.pll },
                  ].map((phase) => (
                    <div key={phase.key} className="cfop-row">
                      <div className="cfr-l">
                        <div className="cfr-name">{phase.name}</div>
                        <div className="cfr-en">{phase.en}</div>
                      </div>
                      <div className="cfr-bar">
                        <div
                          className="cfr-fill"
                          style={{
                            width: `${activeCfopBreakdown.avg && phase.value ? (phase.value / activeCfopBreakdown.avg) * 100 : 0}%`,
                            background: phase.color,
                          }}
                        ></div>
                      </div>
                      <div className="cfr-v">{fmtShort(phase.value)}</div>
                      <div className="cfr-pct">{activeCfopBreakdown.avg && phase.value ? Math.round((phase.value / activeCfopBreakdown.avg) * 100) : 0}%</div>
                    </div>
                  ))}
                </div>
                <div className="cfop-stack">
                  {[
                    { name: "Cross", value: activeCfopBreakdown.crossDuration, color: "#F2C744" },
                    { name: "F2L", value: activeCfopBreakdown.f2lDuration, color: "#1F6B3A" },
                    { name: "OLL", value: activeCfopBreakdown.ollDuration, color: "#1F4FB6" },
                    { name: "PLL", value: activeCfopBreakdown.pllDuration, color: "#C9352A" },
                  ].map((phase, index) => (
                    <div
                      key={index}
                      className="cfs-item"
                      style={{
                        width: `${activeCfopBreakdown.phaseTotal && phase.value ? (phase.value / activeCfopBreakdown.phaseTotal) * 100 : 0}%`,
                      }}
                    >
                      <div
                        className="cfs-seg"
                        style={{ background: phase.color }}
                      ></div>
                      <div className="cfs-label">
                        <span>{phase.name}</span>
                        <b>{fmtShort(phase.value)}</b>
                      </div>
                    </div>
                  ))}
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
