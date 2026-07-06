"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormulaArrow } from "@/lib/formulas-data";
import type { CubeFace } from "@/lib/smart-cube";

type FormulaCubeImageProps = {
  facelets: string;
  faceColors: Record<CubeFace, string>;
  className?: string;
  title?: string;
};

type FormulaTopViewImageProps = FormulaCubeImageProps & {
  arrows?: FormulaArrow[];
};

type Point = [number, number];
type FaceletCode = "u" | "f" | "r" | "d" | "b" | "l" | "x";

const FACELET_TO_FACE: Record<Exclude<FaceletCode, "x">, CubeFace> = {
  u: "U",
  f: "F",
  r: "R",
  d: "D",
  b: "B",
  l: "L",
};

const UNKNOWN_FACELET = "x";
const UNKNOWN_FACELET_COLOR = "#A6ACB5";
const STROKE_COLOR = "rgba(20, 24, 30, 0.72)";

const TOP_ORIGIN: Point = [50, 7];
const TOP_U: Point = [36, 20];
const TOP_V: Point = [-36, 20];
const FRONT_ORIGIN: Point = [14, 27];
const FRONT_U: Point = [36, 20];
const FRONT_V: Point = [0, 42];
const RIGHT_ORIGIN: Point = [50, 47];
const RIGHT_U: Point = [36, -20];
const RIGHT_V: Point = [0, 42];
const TOP_VIEW_CELL = 36;
const TOP_VIEW_GAP = 4;
const TOP_VIEW_ORIGIN_X = 42;
const TOP_VIEW_ORIGIN_Y = 39;
const TOP_VIEW_PITCH = TOP_VIEW_CELL + TOP_VIEW_GAP;
const TOP_VIEW_STROKE = "#000000";
const TOP_VIEW_BACKGROUND = "#ffffff";
const TOP_VIEW_ARROW_COLOR = "rgba(68, 72, 82, 0.96)";
const TOP_VIEW_ARROW_HEAD_LENGTH = 12;
const TOP_VIEW_ARROW_HEAD_HALF_WIDTH = 7;
const TOP_VIEW_SINGLE_ARROW_TAIL_TRIM = 12;
const TOP_VIEW_PLACEHOLDER_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const TOP_VIEW_SIZE = 400;
const TOP_VIEW_SCALE = TOP_VIEW_SIZE / 200;
const TOP_VIEW_CACHE_LIMIT = 128;
const topViewImageCache = new Map<string, string>();

const TOP_VIEW_CENTER_STICKERS = Array.from({ length: 9 }, (_, index) => ({
  key: `u-${index}`,
  faceletIndex: index,
  x: TOP_VIEW_ORIGIN_X + (index % 3) * TOP_VIEW_PITCH,
  y: TOP_VIEW_ORIGIN_Y + Math.floor(index / 3) * TOP_VIEW_PITCH,
}));

const TOP_VIEW_SIDE_STICKERS = [
  ...[47, 46, 45].map((faceletIndex, index) => {
    const x = TOP_VIEW_ORIGIN_X + index * TOP_VIEW_PITCH;
    const isFirst = index === 0;
    const isLast = index === 2;
    return {
      key: `b-${index}`,
      faceletIndex,
      points: [
        [x + (isFirst ? 4 : 0), 18],
        [x + TOP_VIEW_CELL - (isLast ? 4 : 0), 18],
        [x + TOP_VIEW_CELL, TOP_VIEW_ORIGIN_Y - 1],
        [x, TOP_VIEW_ORIGIN_Y - 1],
      ] as Point[],
    };
  }),
  ...[18, 19, 20].map((faceletIndex, index) => {
    const x = TOP_VIEW_ORIGIN_X + index * TOP_VIEW_PITCH;
    const y = TOP_VIEW_ORIGIN_Y + 3 * TOP_VIEW_CELL + 2 * TOP_VIEW_GAP + 2;
    const isFirst = index === 0;
    const isLast = index === 2;
    return {
      key: `f-${index}`,
      faceletIndex,
      points: [
        [x, y],
        [x + TOP_VIEW_CELL, y],
        [x + TOP_VIEW_CELL - (isLast ? 4 : 0), y + 19],
        [x + (isFirst ? 4 : 0), y + 19],
      ] as Point[],
    };
  }),
  ...[36, 37, 38].map((faceletIndex, index) => {
    const y = TOP_VIEW_ORIGIN_Y + index * TOP_VIEW_PITCH;
    const isFirst = index === 0;
    const isLast = index === 2;
    return {
      key: `l-${index}`,
      faceletIndex,
      points: [
        [20, y + (isFirst ? 5 : 0)],
        [TOP_VIEW_ORIGIN_X - 1, y],
        [TOP_VIEW_ORIGIN_X - 1, y + TOP_VIEW_CELL],
        [20, y + TOP_VIEW_CELL - (isLast ? 5 : 0)],
      ] as Point[],
    };
  }),
  ...[11, 10, 9].map((faceletIndex, index) => {
    const y = TOP_VIEW_ORIGIN_Y + index * TOP_VIEW_PITCH;
    const x = TOP_VIEW_ORIGIN_X + 3 * TOP_VIEW_CELL + 2 * TOP_VIEW_GAP + 2;
    const isFirst = index === 0;
    const isLast = index === 2;
    return {
      key: `r-${index}`,
      faceletIndex,
      points: [
        [x, y],
        [180, y + (isFirst ? 5 : 0)],
        [180, y + TOP_VIEW_CELL - (isLast ? 5 : 0)],
        [x, y + TOP_VIEW_CELL],
      ] as Point[],
    };
  }),
];

function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1]];
}

function scale(a: Point, value: number): Point {
  return [a[0] * value, a[1] * value];
}

function point(origin: Point, u: Point, v: Point, col: number, row: number): Point {
  return add(origin, add(scale(u, col / 3), scale(v, row / 3)));
}

function cellPoints(origin: Point, u: Point, v: Point, col: number, row: number) {
  return [
    point(origin, u, v, col, row),
    point(origin, u, v, col + 1, row),
    point(origin, u, v, col + 1, row + 1),
    point(origin, u, v, col, row + 1),
  ];
}

function pointsToString(points: Point[]) {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

function colorForFacelet(facelet: string, faceColors: Record<CubeFace, string>) {
  const code = facelet.toLowerCase() as FaceletCode;
  if (code === UNKNOWN_FACELET) return UNKNOWN_FACELET_COLOR;
  return FACELET_TO_FACE[code] ? faceColors[FACELET_TO_FACE[code]] : UNKNOWN_FACELET_COLOR;
}

function colorCacheKey(faceColors: Record<CubeFace, string>) {
  return ["U", "R", "F", "D", "L", "B"].map((face) => faceColors[face as CubeFace]).join("|");
}

function arrowCacheKey(arrows: FormulaArrow[] | undefined) {
  return arrows?.map(({ from, to, bidirectional }) => `${from}-${to}-${bidirectional ? "both" : "one"}`).join("|") ?? "";
}

function pathCanvasPoints(context: CanvasRenderingContext2D, points: Point[]) {
  points.forEach(([x, y], index) => {
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
}

function trimTopViewCache() {
  if (topViewImageCache.size <= TOP_VIEW_CACHE_LIMIT) return;
  const firstKey = topViewImageCache.keys().next().value;
  if (firstKey) topViewImageCache.delete(firstKey);
}

function topStickerCenter(index: number): Point | null {
  if (!Number.isInteger(index) || index < 0 || index > 8) return null;
  const sticker = TOP_VIEW_CENTER_STICKERS[index];
  return [sticker.x + TOP_VIEW_CELL / 2, sticker.y + TOP_VIEW_CELL / 2];
}

function drawArrowHead(context: CanvasRenderingContext2D, tip: Point, directionRadians: number) {
  const back: Point = [
    tip[0] - TOP_VIEW_ARROW_HEAD_LENGTH * Math.cos(directionRadians),
    tip[1] - TOP_VIEW_ARROW_HEAD_LENGTH * Math.sin(directionRadians),
  ];
  const normal: Point = [-Math.sin(directionRadians), Math.cos(directionRadians)];
  const left: Point = [
    back[0] + normal[0] * TOP_VIEW_ARROW_HEAD_HALF_WIDTH,
    back[1] + normal[1] * TOP_VIEW_ARROW_HEAD_HALF_WIDTH,
  ];
  const right: Point = [
    back[0] - normal[0] * TOP_VIEW_ARROW_HEAD_HALF_WIDTH,
    back[1] - normal[1] * TOP_VIEW_ARROW_HEAD_HALF_WIDTH,
  ];

  context.beginPath();
  context.moveTo(tip[0], tip[1]);
  context.lineTo(left[0], left[1]);
  context.lineTo(right[0], right[1]);
  context.closePath();
  context.fill();
}

function drawTopViewArrows(context: CanvasRenderingContext2D, arrows: FormulaArrow[] | undefined) {
  if (!arrows?.length) return;

  context.save();
  context.strokeStyle = TOP_VIEW_ARROW_COLOR;
  context.fillStyle = TOP_VIEW_ARROW_COLOR;
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";

  arrows.forEach((arrow) => {
    const from = topStickerCenter(arrow.from);
    const to = topStickerCenter(arrow.to);
    if (!from || !to) return;

    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    if (length <= 0) return;

    const angle = Math.atan2(dy, dx);
    const tailTrim = arrow.bidirectional ? 0 : Math.min(TOP_VIEW_SINGLE_ARROW_TAIL_TRIM, length / 3);
    const headTrim = Math.min(TOP_VIEW_ARROW_HEAD_LENGTH, length / 3);
    const startHeadTrim = arrow.bidirectional ? headTrim : 0;
    const start: Point = [
      from[0] + (dx / length) * (tailTrim + startHeadTrim),
      from[1] + (dy / length) * (tailTrim + startHeadTrim),
    ];
    const end: Point = [
      to[0] - (dx / length) * headTrim,
      to[1] - (dy / length) * headTrim,
    ];

    context.beginPath();
    context.moveTo(start[0], start[1]);
    context.lineTo(end[0], end[1]);
    context.stroke();
    drawArrowHead(context, to, angle);
    if (arrow.bidirectional) {
      drawArrowHead(context, from, angle + Math.PI);
    }
  });

  context.restore();
}

function generateTopViewImage(facelets: string, faceColors: Record<CubeFace, string>, arrows?: FormulaArrow[]) {
  if (typeof document === "undefined") return "";
  const cacheKey = `${facelets}|${colorCacheKey(faceColors)}|${arrowCacheKey(arrows)}`;
  const cached = topViewImageCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = TOP_VIEW_SIZE;
  canvas.height = TOP_VIEW_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return "";

  context.scale(TOP_VIEW_SCALE, TOP_VIEW_SCALE);
  context.imageSmoothingEnabled = false;
  context.fillStyle = TOP_VIEW_BACKGROUND;
  context.fillRect(0, 0, 200, 200);
  context.lineWidth = 4;
  context.strokeStyle = TOP_VIEW_STROKE;
  context.lineJoin = "miter";
  context.miterLimit = 2;

  TOP_VIEW_SIDE_STICKERS.forEach((sticker) => {
    context.beginPath();
    pathCanvasPoints(context, sticker.points);
    context.fillStyle = colorForFacelet(facelets[sticker.faceletIndex], faceColors);
    context.fill();
    context.stroke();
  });

  TOP_VIEW_CENTER_STICKERS.forEach((sticker) => {
    context.fillStyle = colorForFacelet(facelets[sticker.faceletIndex], faceColors);
    context.fillRect(sticker.x, sticker.y, TOP_VIEW_CELL, TOP_VIEW_CELL);
    context.strokeRect(sticker.x, sticker.y, TOP_VIEW_CELL, TOP_VIEW_CELL);
  });

  drawTopViewArrows(context, arrows);

  const dataUrl = canvas.toDataURL("image/png");
  topViewImageCache.set(cacheKey, dataUrl);
  trimTopViewCache();
  return dataUrl;
}

export function FormulaCubeImage({ facelets: rawFacelets, faceColors, className, title }: FormulaCubeImageProps) {
  const facelets = rawFacelets.padEnd(54, UNKNOWN_FACELET);
  const faces = [
    { key: "top", origin: TOP_ORIGIN, u: TOP_U, v: TOP_V, offset: 0 },
    { key: "front", origin: FRONT_ORIGIN, u: FRONT_U, v: FRONT_V, offset: 18 },
    { key: "right", origin: RIGHT_ORIGIN, u: RIGHT_U, v: RIGHT_V, offset: 9 },
  ];

  return (
    <svg className={className} viewBox="0 0 100 92" role={title ? "img" : "presentation"} aria-label={title}>
      {title && <title>{title}</title>}
      {faces.map((face) =>
        Array.from({ length: 9 }, (_, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          return (
            <polygon
              key={`${face.key}-${index}`}
              points={pointsToString(cellPoints(face.origin, face.u, face.v, col, row))}
              fill={colorForFacelet(facelets[face.offset + index], faceColors)}
              stroke={STROKE_COLOR}
              strokeWidth="1.15"
              strokeLinejoin="round"
            />
          );
        }),
      )}
    </svg>
  );
}

export function FormulaTopViewImage({ facelets: rawFacelets, faceColors, className, title, arrows }: FormulaTopViewImageProps) {
  const [mounted, setMounted] = useState(false);
  const facelets = rawFacelets.padEnd(54, UNKNOWN_FACELET);

  useEffect(() => {
    setMounted(true);
  }, []);

  const src = useMemo(
    () => (mounted ? generateTopViewImage(facelets, faceColors, arrows) : ""),
    [mounted, facelets, faceColors, arrows],
  );

  return (
    <img
      className={className}
      src={src || TOP_VIEW_PLACEHOLDER_SRC}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
    />
  );
}
