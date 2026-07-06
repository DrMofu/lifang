import { invertMoveNotation, parseAlgorithm } from "@/lib/algorithms";
import { rotateAlgorithmByYOffset, type FormulaRotationOffset } from "@/lib/formula-rotation";
import { FORMULAS, type FormulaItem } from "@/lib/formulas-data";
import { applyMovesToFacelets } from "@/lib/facelets-pattern";
import { getArchiveScopedStorageKey } from "@/lib/solve-history";
import type { CubeOrientation, CubeColor } from "@/lib/cube-appearance";
import type { CubeFace } from "@/lib/smart-cube";

export type CfopTrainerPhase = "cross" | "f2l" | "oll" | "pll";
export type CfopTrainerPhaseShort = "C" | "F" | "O" | "P";

export type CfopTrainerScenario = {
  phase: CfopTrainerPhase;
  short: CfopTrainerPhaseShort;
  caseId: string;
  caseName: string;
  rotation: FormulaRotationOffset;
  setupMoves: string[];
  sourceAlgo: string;
  startFacelets: string;
};

export type CfopTrainerHistoryOptions = {
  rotationVariants: boolean;
  formulaHint: boolean;
  rotationArrow: boolean;
  f2lEdgeOnly: boolean;
};

export type CfopTrainerHistoryEntry = {
  phase: CfopTrainerPhase;
  observeMs: number;
  solveMs: number;
  moves?: number;
  rounds: number;
  ts: number;
  options: CfopTrainerHistoryOptions;
};

export const CFOP_TRAINER_HISTORY_KEY = "cfop-stage-training-history";
export const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
export const CFOP_TRAINER_HISTORY_LIMIT = 120;

type Vec3 = readonly [number, number, number];
type FaceletPosition = { face: CubeFace; x: number; y: number; z: number };

const FACE_ORDER: CubeFace[] = ["U", "R", "F", "D", "L", "B"];
const COLOR_VECTOR: Record<CubeColor, Vec3> = {
  white: [0, 1, 0],
  yellow: [0, -1, 0],
  green: [0, 0, 1],
  blue: [0, 0, -1],
  red: [1, 0, 0],
  orange: [-1, 0, 0],
};

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vectorToFace([x, y, z]: Vec3): CubeFace {
  if (y === 1) return "U";
  if (y === -1) return "D";
  if (x === 1) return "R";
  if (x === -1) return "L";
  if (z === 1) return "F";
  return "B";
}

function displayPositionToHardware(x: number, y: number, z: number, orientation: CubeOrientation): Vec3 {
  const top = COLOR_VECTOR[orientation.top];
  const front = COLOR_VECTOR[orientation.front];
  const right = crossVec3(top, front);
  return [
    right[0] * x + top[0] * y + front[0] * z,
    right[1] * x + top[1] * y + front[1] * z,
    right[2] * x + top[2] * y + front[2] * z,
  ];
}

function displayFaceToHardware(face: CubeFace, orientation: CubeOrientation) {
  if (face === "U") return vectorToFace(displayPositionToHardware(0, 1, 0, orientation));
  if (face === "D") return vectorToFace(displayPositionToHardware(0, -1, 0, orientation));
  if (face === "R") return vectorToFace(displayPositionToHardware(1, 0, 0, orientation));
  if (face === "L") return vectorToFace(displayPositionToHardware(-1, 0, 0, orientation));
  if (face === "F") return vectorToFace(displayPositionToHardware(0, 0, 1, orientation));
  return vectorToFace(displayPositionToHardware(0, 0, -1, orientation));
}

function faceletPosition(face: CubeFace, row: number, col: number): FaceletPosition {
  if (face === "U") return { face, x: col - 1, y: 1, z: row - 1 };
  if (face === "R") return { face, x: 1, y: 1 - row, z: 1 - col };
  if (face === "F") return { face, x: col - 1, y: 1 - row, z: 1 };
  if (face === "D") return { face, x: col - 1, y: -1, z: 1 - row };
  if (face === "L") return { face, x: -1, y: 1 - row, z: col - 1 };
  return { face, x: 1 - col, y: 1 - row, z: -1 };
}

function faceletIndex(face: CubeFace, x: number, y: number, z: number) {
  if (face === "U") return (z + 1) * 3 + (x + 1);
  if (face === "R") return 9 + (1 - y) * 3 + (1 - z);
  if (face === "F") return 18 + (1 - y) * 3 + (x + 1);
  if (face === "D") return 27 + (1 - z) * 3 + (x + 1);
  if (face === "L") return 36 + (1 - y) * 3 + (z + 1);
  return 45 + (1 - y) * 3 + (1 - x);
}

export function displayFaceletsToHardwareFacelets(facelets: string, orientation: CubeOrientation) {
  const next = Array.from({ length: facelets.length }, () => "U");

  FACE_ORDER.forEach((displayFace, faceIndex) => {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const sourceIndex = faceIndex * 9 + row * 3 + col;
        const sourceFace = facelets[sourceIndex] as CubeFace | undefined;
        if (!sourceFace || !FACE_ORDER.includes(sourceFace)) continue;
        const displayPosition = faceletPosition(displayFace, row, col);
        const [hardwareX, hardwareY, hardwareZ] = displayPositionToHardware(
          displayPosition.x,
          displayPosition.y,
          displayPosition.z,
          orientation,
        );
        const hardwareFace = displayFaceToHardware(displayPosition.face, orientation);
        const targetIndex = faceletIndex(hardwareFace, hardwareX, hardwareY, hardwareZ);
        next[targetIndex] = displayFaceToHardware(sourceFace, orientation);
      }
    }
  });

  return next.join("");
}

export const CFOP_TRAINER_PHASES: Array<{
  key: CfopTrainerPhase;
  short: CfopTrainerPhaseShort;
  label: string;
  title: string;
  goal: string;
}> = [
  { key: "cross", short: "C", label: "Cross", title: "C 阶段", goal: "恢复底部十字小花" },
  { key: "f2l", short: "F", label: "F2L", title: "F 阶段", goal: "复原前两层" },
  { key: "oll", short: "O", label: "OLL", title: "O 阶段", goal: "复原顶面" },
  { key: "pll", short: "P", label: "PLL", title: "P 阶段", goal: "复原整个魔方" },
];

const FORMULA_PHASES = ["f2l", "oll", "pll"] as const;

function firstAlgo(item: FormulaItem) {
  return item.algos?.[0]?.algo ?? item.algo ?? null;
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function trainerPhaseShort(phase: CfopTrainerPhase) {
  return CFOP_TRAINER_PHASES.find((item) => item.key === phase)?.short ?? "C";
}

export async function createFormulaTrainerScenario(
  phase: Exclude<CfopTrainerPhase, "cross">,
  options: { includeRotations?: boolean } = {},
): Promise<CfopTrainerScenario> {
  const category = FORMULAS[phase];
  const cases = category.items
    .map((item) => ({ item, algo: firstAlgo(item) }))
    .filter((entry): entry is { item: FormulaItem; algo: string } => Boolean(entry.algo));
  const selected = randomItem(cases);
  const rotation = (options.includeRotations ? Math.floor(Math.random() * 4) : 0) as FormulaRotationOffset;
  const sourceAlgo = rotateAlgorithmByYOffset(selected.algo, rotation);
  const setupMoves = parseAlgorithm(sourceAlgo).toReversed().map(invertMoveNotation);
  const startFacelets = await applyMovesToFacelets(SOLVED_FACELETS, setupMoves);

  return {
    phase,
    short: trainerPhaseShort(phase),
    caseId: selected.item.id,
    caseName: selected.item.name,
    rotation,
    setupMoves,
    sourceAlgo,
    startFacelets,
  };
}

export function formulaTrainerScenarioCount(phase: CfopTrainerPhase, options: { includeRotations?: boolean } = {}) {
  if (!FORMULA_PHASES.includes(phase as (typeof FORMULA_PHASES)[number])) return 0;
  return FORMULAS[phase].items.filter((item) => Boolean(firstAlgo(item))).length * (options.includeRotations ? 4 : 1);
}

const DEFAULT_TRAINER_HISTORY_OPTIONS: CfopTrainerHistoryOptions = {
  rotationVariants: false,
  formulaHint: false,
  rotationArrow: false,
  f2lEdgeOnly: false,
};

function normalizeTrainerHistoryOptions(value: unknown): CfopTrainerHistoryOptions {
  if (!value || typeof value !== "object") return DEFAULT_TRAINER_HISTORY_OPTIONS;
  const candidate = value as Partial<CfopTrainerHistoryOptions>;
  return {
    rotationVariants: candidate.rotationVariants === true,
    formulaHint: candidate.formulaHint === true,
    rotationArrow: candidate.rotationArrow === true,
    f2lEdgeOnly: candidate.f2lEdgeOnly === true,
  };
}

function normalizeTrainerHistoryEntry(value: unknown): CfopTrainerHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CfopTrainerHistoryEntry;
  if (
    CFOP_TRAINER_PHASES.some((phase) => phase.key === candidate.phase) &&
    typeof candidate.observeMs === "number" &&
    typeof candidate.solveMs === "number" &&
    (candidate.moves === undefined || typeof candidate.moves === "number") &&
    typeof candidate.rounds === "number" &&
    typeof candidate.ts === "number"
  ) {
    return {
      phase: candidate.phase,
      observeMs: candidate.observeMs,
      solveMs: candidate.solveMs,
      ...(candidate.moves === undefined ? {} : { moves: candidate.moves }),
      rounds: candidate.rounds,
      ts: candidate.ts,
      options: normalizeTrainerHistoryOptions(candidate.options),
    };
  }
  return null;
}

export function readCfopTrainerHistory() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getArchiveScopedStorageKey(CFOP_TRAINER_HISTORY_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeTrainerHistoryEntry)
          .filter((entry): entry is CfopTrainerHistoryEntry => entry !== null)
          .slice(0, CFOP_TRAINER_HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function saveCfopTrainerHistory(history: CfopTrainerHistoryEntry[]) {
  const normalized = history
    .map(normalizeTrainerHistoryEntry)
    .filter((entry): entry is CfopTrainerHistoryEntry => entry !== null)
    .toSorted((a, b) => b.ts - a.ts)
    .slice(0, CFOP_TRAINER_HISTORY_LIMIT);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(getArchiveScopedStorageKey(CFOP_TRAINER_HISTORY_KEY), JSON.stringify(normalized));
    } catch {
      // Keep the in-memory result even if localStorage is unavailable.
    }
  }
  return normalized;
}

export function prependCfopTrainerHistoryEntry(history: CfopTrainerHistoryEntry[], entry: CfopTrainerHistoryEntry) {
  return saveCfopTrainerHistory([entry, ...history]);
}
