import { parseMoveNotation } from "@/lib/algorithms";

export type FormulaRotationOffset = 0 | 1 | 2 | 3;

const FORMULA_FACELET_FACES = ["U", "R", "F", "D", "L", "B"] as const;
type FormulaFaceletFace = (typeof FORMULA_FACELET_FACES)[number];
type Vec3 = readonly [number, number, number];
type FaceletBasis = { normal: Vec3; right: Vec3; down: Vec3 };

const FACELET_BASIS: Record<FormulaFaceletFace, FaceletBasis> = {
  U: { normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] },
  R: { normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] },
  F: { normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  D: { normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
  L: { normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] },
  B: { normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] },
};

const FACELET_FACE_BY_NORMAL = Object.fromEntries(
  FORMULA_FACELET_FACES.map((face) => [FACELET_BASIS[face].normal.join(","), face]),
) as Record<string, FormulaFaceletFace>;

const Y_ROTATION_LAYER_MAP: Array<Record<string, string>> = [
  {},
  { F: "R", R: "B", B: "L", L: "F", f: "r", r: "b", b: "l", l: "f", M: "S", S: "M'", x: "z'", z: "x" },
  { F: "B", R: "L", B: "F", L: "R", f: "b", r: "l", b: "f", l: "r", M: "M'", S: "S'", x: "x'", z: "z'" },
  { F: "L", R: "F", B: "R", L: "B", f: "l", r: "f", b: "r", l: "b", M: "S'", S: "M", x: "z", z: "x'" },
];

export function normalizeFormulaRotationOffset(value: number): FormulaRotationOffset {
  return (((value % 4) + 4) % 4) as FormulaRotationOffset;
}

function formatRotatedMove(layer: string, turns: number, dir: 1 | -1) {
  return `${layer}${turns === 2 ? "2" : dir === -1 ? "'" : ""}`;
}

export function rotateMoveNotationByYOffset(move: string, offset: FormulaRotationOffset) {
  const parsed = parseMoveNotation(move);
  if (!parsed || offset === 0) return parsed?.notation ?? move;
  const rawTarget = Y_ROTATION_LAYER_MAP[offset][parsed.layer];
  if (!rawTarget) return parsed.notation;
  const targetLayer = rawTarget.replace("'", "");
  const targetDir = (rawTarget.includes("'") ? -parsed.dir : parsed.dir) as 1 | -1;
  return formatRotatedMove(targetLayer, parsed.turns, targetDir);
}

export function rotateAlgorithmByYOffset(algo: string, offset: FormulaRotationOffset) {
  if (offset === 0) return algo;
  return algo
    .trim()
    .split(/\s+/)
    .map((token) => {
      const leadingParens = token.match(/^\(+/)?.[0] ?? "";
      const trailingParens = token.match(/\)+$/)?.[0] ?? "";
      const move = token.replace(/[()]/g, "");
      const rotated = rotateMoveNotationByYOffset(move, offset);
      return `${leadingParens}${rotated}${trailingParens}`;
    })
    .join(" ");
}

function rotateYVector([x, y, z]: Vec3, offset: FormulaRotationOffset): Vec3 {
  if (offset === 1) return [z, y, -x];
  if (offset === 2) return [-x, y, -z];
  if (offset === 3) return [-z, y, x];
  return [x, y, z];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec3([x, y, z]: Vec3, scale: number): Vec3 {
  return [x * scale, y * scale, z * scale];
}

function dotVec3(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function faceletIndex(face: FormulaFaceletFace, row: number, col: number) {
  return FORMULA_FACELET_FACES.indexOf(face) * 9 + row * 3 + col;
}

function rotateFaceletColor(facelet: string, offset: FormulaRotationOffset) {
  if (facelet === "X" || offset === 0) return facelet;
  return Y_ROTATION_LAYER_MAP[offset][facelet] ?? facelet;
}

export function rotateFaceletsByYOffset(facelets: string | undefined, offset: FormulaRotationOffset) {
  if (!facelets || offset === 0) return facelets;
  const next = Array.from({ length: facelets.length }, () => "X");

  FORMULA_FACELET_FACES.forEach((face) => {
    const basis = FACELET_BASIS[face];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const sourceIndex = faceletIndex(face, row, col);
        const localPosition = addVec3(
          addVec3(basis.normal, scaleVec3(basis.right, col - 1)),
          scaleVec3(basis.down, row - 1),
        );
        const rotatedNormal = rotateYVector(basis.normal, offset);
        const rotatedPosition = rotateYVector(localPosition, offset);
        const targetFace = FACELET_FACE_BY_NORMAL[rotatedNormal.join(",")];
        if (!targetFace) continue;
        const targetBasis = FACELET_BASIS[targetFace];
        const targetLocal = addVec3(rotatedPosition, scaleVec3(targetBasis.normal, -1));
        const targetCol = Math.round(dotVec3(targetLocal, targetBasis.right) + 1);
        const targetRow = Math.round(dotVec3(targetLocal, targetBasis.down) + 1);
        if (targetRow < 0 || targetRow > 2 || targetCol < 0 || targetCol > 2) continue;
        next[faceletIndex(targetFace, targetRow, targetCol)] = rotateFaceletColor(facelets[sourceIndex] ?? "X", offset);
      }
    }
  });

  return next.join("");
}
