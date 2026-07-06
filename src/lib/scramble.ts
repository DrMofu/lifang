import { parseMoveNotation } from "@/lib/algorithms";
import type { CubeFace } from "@/lib/smart-cube";

export const SCRAMBLE_LENGTH = 20;
const SCRAMBLE_MOVES: CubeFace[] = ["U", "D", "L", "R", "F"];
const SCRAMBLE_AXES: Record<CubeFace, "ud" | "lr" | "fb"> = {
  U: "ud",
  D: "ud",
  L: "lr",
  R: "lr",
  F: "fb",
  B: "fb",
};

function randomMove(prev: string | null) {
  let face: CubeFace;
  do {
    face = SCRAMBLE_MOVES[Math.floor(Math.random() * SCRAMBLE_MOVES.length)];
  } while (prev && SCRAMBLE_AXES[prev[0] as CubeFace] === SCRAMBLE_AXES[face]);
  const dir = ["", "'", "2"][Math.floor(Math.random() * 3)];
  return face + dir;
}

export function generateScramble(len = SCRAMBLE_LENGTH) {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < len; i += 1) {
    const move = randomMove(prev);
    out.push(move);
    prev = move;
  }
  return out;
}

export function solveMoveCountGroup(move: string) {
  const parsed = parseMoveNotation(move);
  return parsed ? { layer: parsed.layer, dir: parsed.dir } : null;
}

export function isSameSolveMoveCountGroup(
  a: ReturnType<typeof solveMoveCountGroup>,
  b: ReturnType<typeof solveMoveCountGroup>,
) {
  return Boolean(a && b && a.layer === b.layer && a.dir === b.dir);
}
