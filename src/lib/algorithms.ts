import type { CubeFace, CubeMoveLayer, CubeSlice } from "@/lib/smart-cube";

export type ParsedMove = {
  notation: string;
  layer: MoveNotationLayer;
  dir: 1 | -1;
  turns: 1 | 2;
};

type WideMoveLayer = "u" | "d" | "l" | "r" | "f" | "b";
type RotationMoveLayer = "x" | "y" | "z";
type MoveNotationLayer = CubeMoveLayer | WideMoveLayer | RotationMoveLayer;
type MoveAxis = "x" | "y" | "z";

const FACE_SET = new Set<CubeFace>(["U", "D", "L", "R", "F", "B"]);
const SLICE_SET = new Set<CubeSlice>(["M", "E", "S"]);
const LAYER_SET = new Set<CubeMoveLayer>(["U", "D", "L", "R", "F", "B", "M", "E", "S"]);
const WIDE_LAYER_SET = new Set<WideMoveLayer>(["u", "d", "l", "r", "f", "b"]);
const ROTATION_LAYER_SET = new Set<RotationMoveLayer>(["x", "y", "z"]);

const WIDE_MOVE_EXPANSION: Record<WideMoveLayer, Array<{ layer: CubeMoveLayer; dirMultiplier: 1 | -1 }>> = {
  r: [{ layer: "R", dirMultiplier: 1 }, { layer: "M", dirMultiplier: -1 }],
  l: [{ layer: "L", dirMultiplier: 1 }, { layer: "M", dirMultiplier: 1 }],
  u: [{ layer: "U", dirMultiplier: 1 }, { layer: "E", dirMultiplier: -1 }],
  d: [{ layer: "D", dirMultiplier: 1 }, { layer: "E", dirMultiplier: 1 }],
  f: [{ layer: "F", dirMultiplier: 1 }, { layer: "S", dirMultiplier: 1 }],
  b: [{ layer: "B", dirMultiplier: 1 }, { layer: "S", dirMultiplier: -1 }],
};

const ROTATION_MOVE_EXPANSION: Record<RotationMoveLayer, Array<{ layer: CubeMoveLayer; dirMultiplier: 1 | -1 }>> = {
  x: [{ layer: "R", dirMultiplier: 1 }, { layer: "M", dirMultiplier: -1 }, { layer: "L", dirMultiplier: -1 }],
  y: [{ layer: "U", dirMultiplier: 1 }, { layer: "E", dirMultiplier: -1 }, { layer: "D", dirMultiplier: -1 }],
  z: [{ layer: "F", dirMultiplier: 1 }, { layer: "S", dirMultiplier: 1 }, { layer: "B", dirMultiplier: -1 }],
};

const OPPOSITE_FACE: Partial<Record<CubeFace, CubeFace>> = {
  R: "L",
  L: "R",
  U: "D",
  D: "U",
  F: "B",
  B: "F",
};

const FACE_AXIS: Record<CubeFace, { axis: MoveAxis; sign: 1 | -1 }> = {
  R: { axis: "x", sign: 1 },
  L: { axis: "x", sign: -1 },
  U: { axis: "y", sign: 1 },
  D: { axis: "y", sign: -1 },
  F: { axis: "z", sign: 1 },
  B: { axis: "z", sign: -1 },
};

const SLICE_BY_AXIS: Record<MoveAxis, CubeSlice> = {
  x: "M",
  y: "E",
  z: "S",
};

const SLICE_AXIS: Record<CubeSlice, MoveAxis> = {
  M: "x",
  E: "y",
  S: "z",
};

type MoveAtom = {
  layer: MoveNotationLayer;
  amount: 1 | 2 | 3;
};

export type MoveCoordinateState = Record<CubeFace, CubeFace>;

type CoordinateRotation = {
  axis: MoveAxis;
  amount: 1 | 2 | 3;
};

const IDENTITY_COORDINATE_STATE: MoveCoordinateState = {
  U: "U",
  D: "D",
  L: "L",
  R: "R",
  F: "F",
  B: "B",
};

export function parseMoveNotation(notation: unknown): ParsedMove | null {
  if (typeof notation !== "string") return null;
  const trimmed = notation.trim();
  if (!trimmed) return null;
  const head = trimmed[0];
  const upperHead = head?.toUpperCase() as CubeMoveLayer;
  const layer = WIDE_LAYER_SET.has(head as WideMoveLayer) || ROTATION_LAYER_SET.has(head as RotationMoveLayer)
    ? (head as WideMoveLayer | RotationMoveLayer)
    : upperHead;
  if (
    !WIDE_LAYER_SET.has(layer as WideMoveLayer) &&
    !ROTATION_LAYER_SET.has(layer as RotationMoveLayer) &&
    !LAYER_SET.has(layer as CubeMoveLayer)
  ) return null;
  const suffix = trimmed.slice(1);
  const turns = suffix.includes("2") ? 2 : 1;
  const dir = suffix.includes("'") ? -1 : 1;
  return {
    notation: formatParsedMove(layer, turns, dir),
    layer,
    dir,
    turns,
  };
}

export function parseAlgorithm(source: unknown): string[] {
  if (typeof source !== "string") return [];
  return source
    .trim()
    .split(/\s+/)
    .flatMap((token) => {
      const parsed = parseMoveNotation(token.replace(/[()]/g, ""));
      return parsed ? [parsed.notation] : [];
    });
}

export function invertMoveNotation(move: string) {
  const parsed = parseMoveNotation(move);
  if (!parsed) return move;
  if (parsed.turns === 2) return parsed.notation;
  return formatMove(parsed.layer, parsed.dir === 1 ? 3 : 1);
}

export function isRotationMoveNotation(move: unknown) {
  const parsed = parseMoveNotation(move);
  return parsed ? ROTATION_LAYER_SET.has(parsed.layer as RotationMoveLayer) : false;
}

export function expandMoveNotation(move: string): Array<{ layer: CubeMoveLayer; dir: 1 | -1 }> {
  const parsed = parseMoveNotation(move);
  if (!parsed) return [];
  const expanded = WIDE_MOVE_EXPANSION[parsed.layer as WideMoveLayer];
  const rotated = ROTATION_MOVE_EXPANSION[parsed.layer as RotationMoveLayer];
  const moveGroup = expanded ?? rotated;
  if (!moveGroup) {
    return Array.from({ length: parsed.turns }, () => ({ layer: parsed.layer as CubeMoveLayer, dir: parsed.dir }));
  }
  return Array.from({ length: parsed.turns }).flatMap(() =>
    moveGroup.map(({ layer, dirMultiplier }) => ({
      layer,
      dir: (parsed.dir * dirMultiplier) as 1 | -1,
    })),
  );
}

export function compressMoveSequence(moves: unknown[]) {
  return moves.reduce<string[]>((history, move) => appendCompressedMove(history, move), []);
}

export function normalizeMoveLogSequence(moves: unknown[]) {
  let coordinateState = createMoveCoordinateState();
  return moves.reduce<string[]>((history, move) => {
    const next = appendNormalizedMoveLogMove(history, move, coordinateState);
    coordinateState = next.coordinateState;
    return next.history;
  }, []);
}

export function appendNormalizedMoveLogMove(history: string[], move: unknown, coordinateState: MoveCoordinateState) {
  const parsed = parseMoveNotation(move);
  if (!parsed) return { history, coordinateState };
  const normalizedMove = normalizeMoveCoordinate(parsed.notation, coordinateState);
  const next = appendCompressedMoveWithCoordinateEvent(history, normalizedMove);
  const rotation = next.coordinateMove ? coordinateRotationForSliceMove(next.coordinateMove) : null;
  return {
    history: next.history,
    coordinateState: rotation ? rotateCoordinateState(coordinateState, rotation) : coordinateState,
  };
}

export function appendFixedViewMoveLogMove(history: string[], move: unknown) {
  const parsed = parseMoveNotation(move);
  if (!parsed) return history;
  return appendCompressedMoveWithCoordinateEvent(history, parsed.notation).history;
}

export function createMoveCoordinateState(): MoveCoordinateState {
  return { ...IDENTITY_COORDINATE_STATE };
}

export function normalizeMoveCoordinate(move: string, state: MoveCoordinateState) {
  const parsed = parseMoveNotation(move);
  if (!parsed || !FACE_SET.has(parsed.layer as CubeFace)) return parsed?.notation ?? move;
  return formatParsedMove(state[parsed.layer as CubeFace], parsed.turns, parsed.dir);
}

export function moveCanStillMatchExpected(pendingMoves: string[], expectedMove: string) {
  const expected = moveToAtom(expectedMove);
  if (!expected) return false;
  const compressed = compressMoveSequence(pendingMoves);
  if (compressed.length === 0) return true;
  if (compressed.length > 1) return partialSliceTurnCanStillMatch(compressed, expected);
  const actual = moveToAtom(compressed[0]);
  if (!actual) return false;
  if (actual.layer === expected.layer) {
    return actual.amount === expected.amount || (expected.amount === 2 && (actual.amount === 1 || actual.amount === 3));
  }
  if (faceMoveCanEmulateWide(actual, expected)) {
    return actual.amount === expected.amount || (expected.amount === 2 && (actual.amount === 1 || actual.amount === 3));
  }
  return faceMoveCanBecomeSlice(actual, expected);
}

export function movesMatchExpected(pendingMoves: string[], expectedMove: string) {
  const expected = moveToAtom(expectedMove);
  if (!expected) return false;
  const compressed = compressMoveSequence(pendingMoves);
  if (compressed.length !== 1) return false;
  const actual = moveToAtom(compressed[0]);
  if (!actual) return false;
  return (
    (actual.layer === expected.layer && actual.amount === expected.amount) ||
    (faceMoveCanEmulateWide(actual, expected) && actual.amount === expected.amount)
  );
}

export function movePartiallyMatchesExpectedDoubleTurn(pendingMoves: string[], expectedMove: string) {
  const expected = moveToAtom(expectedMove);
  if (!expected || expected.amount !== 2) return false;
  const compressed = compressMoveSequence(pendingMoves);
  if (compressed.length !== 1) return false;
  const actual = moveToAtom(compressed[0]);
  if (!actual || (actual.amount !== 1 && actual.amount !== 3)) return false;
  return actual.layer === expected.layer || faceMoveCanEmulateWide(actual, expected);
}

export function hintMoveForDoubleTurnProgress(pendingMoves: string[], expectedMove: string) {
  const expected = moveToAtom(expectedMove);
  if (!expected || expected.amount !== 2) return expectedMove;
  const compressed = compressMoveSequence(pendingMoves);
  if (compressed.length !== 1) return expectedMove;
  const actual = moveToAtom(compressed[0]);
  if (!actual || (actual.amount !== 1 && actual.amount !== 3)) return expectedMove;
  if (actual.layer !== expected.layer && !faceMoveCanEmulateWide(actual, expected)) return expectedMove;
  return formatMove(actual.layer, actual.amount);
}

export function shouldAnimateExpectedWideMoveAfterMatch(pendingMoves: string[], expectedMove: string) {
  const expected = moveToAtom(expectedMove);
  if (!expected || !WIDE_LAYER_SET.has(expected.layer as WideMoveLayer)) return false;
  if (!movesMatchExpected(pendingMoves, expectedMove)) return false;

  const compressed = compressMoveSequence(pendingMoves);
  if (compressed.length !== 1) return false;
  const actual = moveToAtom(compressed[0]);
  return Boolean(actual && actual.layer !== expected.layer && faceMoveCanEmulateWide(actual, expected));
}

export function shouldAnimateExpectedSliceMoveAfterMatch(pendingMoves: string[], expectedMove: string) {
  return Boolean(sliceEmulationRotationAfterMatch(pendingMoves, expectedMove));
}

export function shouldDeferExpectedWideMoveAnimation(pendingMoves: string[], expectedMove: string) {
  const expected = moveToAtom(expectedMove);
  if (!expected || !WIDE_LAYER_SET.has(expected.layer as WideMoveLayer)) return false;
  if (!moveCanStillMatchExpected(pendingMoves, expectedMove)) return false;

  const compressed = compressMoveSequence(pendingMoves);
  if (compressed.length !== 1) return false;
  const actual = moveToAtom(compressed[0]);
  return Boolean(actual && actual.layer !== expected.layer && faceMoveCanEmulateWide(actual, expected));
}

export function shouldDeferExpectedSliceMoveAnimation(pendingMoves: string[], expectedMove: string) {
  const expected = moveToAtom(expectedMove);
  if (!expected || !SLICE_SET.has(expected.layer as CubeSlice)) return false;
  if (!moveCanStillMatchExpected(pendingMoves, expectedMove)) return false;

  return pendingMoves.some((move) => {
    const actual = moveToAtom(move);
    return Boolean(actual && FACE_SET.has(actual.layer as CubeFace));
  });
}

export function updateMoveCoordinateStateAfterMatch(
  state: MoveCoordinateState,
  pendingMoves: string[],
  expectedMove: string,
): MoveCoordinateState {
  const rotation = sliceEmulationRotationAfterMatch(pendingMoves, expectedMove) ??
    wideEmulationRotationAfterMatch(pendingMoves, expectedMove);
  if (!rotation) return state;
  return rotateCoordinateState(state, rotation);
}

export function updateMoveCoordinateStateAfterMove(state: MoveCoordinateState, move: string): MoveCoordinateState {
  const rotation = coordinateRotationForSliceMove(move);
  if (!rotation) return state;
  return rotateCoordinateState(state, rotation);
}

export function updateMoveCoordinateStateAfterRotationMove(state: MoveCoordinateState, move: string): MoveCoordinateState {
  const rotation = coordinateRotationForRotationMove(move);
  if (!rotation) return state;
  return rotateCoordinateState(state, rotation);
}

function appendCompressedMove(history: string[], move: unknown) {
  const nextAtom = moveToAtom(move);
  if (!nextAtom) return history;
  const next = [...history];
  const lastAtom = moveToAtom(next[next.length - 1]);

  if (lastAtom && lastAtom.layer === nextAtom.layer) {
    next.pop();
    const combined = addAmounts(lastAtom.amount, nextAtom.amount);
    if (combined !== 0) {
      const combinedMove = formatMove(nextAtom.layer, combined);
      const combinedAtom = moveToAtom(combinedMove);
      const previousAtom = moveToAtom(next[next.length - 1]);
      const slice = previousAtom && combinedAtom ? combineOppositeFaces(previousAtom, combinedAtom) : null;
      if (slice) {
        next.pop();
        return appendCompressedMove(next, slice);
      }
      next.push(combinedMove);
    }
    return next;
  }

  const slice = lastAtom ? combineOppositeFaces(lastAtom, nextAtom) : null;
  if (slice) {
    next.pop();
    return appendCompressedMove(next, slice);
  }

  next.push(formatMove(nextAtom.layer, nextAtom.amount));
  return next;
}

function appendCompressedMoveWithCoordinateEvent(history: string[], move: unknown) {
  const nextAtom = moveToAtom(move);
  if (!nextAtom) return { history };
  const coordinateMove = SLICE_SET.has(nextAtom.layer as CubeSlice)
    ? formatMove(nextAtom.layer, nextAtom.amount)
    : null;
  const next = [...history];
  const lastAtom = moveToAtom(next[next.length - 1]);

  if (lastAtom && lastAtom.layer === nextAtom.layer) {
    next.pop();
    const combined = addAmounts(lastAtom.amount, nextAtom.amount);
    if (combined !== 0) {
      const combinedMove = formatMove(nextAtom.layer, combined);
      const combinedAtom = moveToAtom(combinedMove);
      const previousAtom = moveToAtom(next[next.length - 1]);
      const slice = previousAtom && combinedAtom ? combineOppositeFaces(previousAtom, combinedAtom) : null;
      if (slice) {
        next.pop();
        return { history: appendCompressedMove(next, slice), coordinateMove: slice };
      }
      next.push(combinedMove);
    }
    return { history: next, coordinateMove };
  }

  const slice = lastAtom ? combineOppositeFaces(lastAtom, nextAtom) : null;
  if (slice) {
    next.pop();
    return { history: appendCompressedMove(next, slice), coordinateMove: slice };
  }

  next.push(formatMove(nextAtom.layer, nextAtom.amount));
  return { history: next, coordinateMove };
}

function moveToAtom(move: unknown): MoveAtom | null {
  const parsed = parseMoveNotation(move);
  if (!parsed) return null;
  return {
    layer: parsed.layer,
    amount: parsed.turns === 2 ? 2 : parsed.dir === -1 ? 3 : 1,
  };
}

function formatMove(layer: MoveNotationLayer, amount: 1 | 2 | 3) {
  if (amount === 2) return `${layer}2`;
  if (amount === 3) return `${layer}'`;
  return layer;
}

function formatParsedMove(layer: MoveNotationLayer, turns: 1 | 2, dir: 1 | -1) {
  if (turns === 2) return dir === -1 ? `${layer}'2` : `${layer}2`;
  return formatMove(layer, dir === -1 ? 3 : 1);
}

function addAmounts(a: 1 | 2 | 3, b: 1 | 2 | 3) {
  return ((a + b) % 4) as 0 | 1 | 2 | 3;
}

function combineOppositeFaces(a: MoveAtom, b: MoveAtom) {
  if (!FACE_SET.has(a.layer as CubeFace) || !FACE_SET.has(b.layer as CubeFace)) return null;
  const aFace = a.layer as CubeFace;
  const bFace = b.layer as CubeFace;
  if (OPPOSITE_FACE[aFace] !== bFace) return null;

  const aAxis = FACE_AXIS[aFace];
  const bAxis = FACE_AXIS[bFace];
  const aPhysical = physicalAmount(a.amount, aAxis.sign);
  const bPhysical = physicalAmount(b.amount, bAxis.sign);
  if (aAxis.axis !== bAxis.axis || aPhysical !== bPhysical) return null;

  const sliceAmount = aPhysical === 3 ? 1 : aPhysical === 1 ? 3 : 2;
  return formatMove(SLICE_BY_AXIS[aAxis.axis], sliceAmount);
}

function faceMoveCanBecomeSlice(actual: MoveAtom, expected: MoveAtom) {
  if (!SLICE_SET.has(expected.layer as CubeSlice)) return false;
  if (!FACE_SET.has(actual.layer as CubeFace)) return false;
  const face = actual.layer as CubeFace;
  const axis = FACE_AXIS[face].axis;
  return SLICE_BY_AXIS[axis] === expected.layer;
}

function faceMoveCanEmulateWide(actual: MoveAtom, expected: MoveAtom) {
  if (!FACE_SET.has(actual.layer as CubeFace) || !WIDE_LAYER_SET.has(expected.layer as WideMoveLayer)) return false;
  const wideFace = wideLayerToFace(expected.layer as WideMoveLayer);
  return OPPOSITE_FACE[wideFace] === actual.layer;
}

function partialSliceTurnCanStillMatch(compressedMoves: string[], expected: MoveAtom) {
  if (expected.amount !== 2 || compressedMoves.length !== 2) return false;
  const first = moveToAtom(compressedMoves[0]);
  const second = moveToAtom(compressedMoves[1]);
  if (!first || !second) return false;
  return (
    first.layer === expected.layer &&
    (first.amount === 1 || first.amount === 3) &&
    faceMoveCanBecomeSlice(second, expected)
  );
}

function sliceEmulationRotationAfterMatch(pendingMoves: string[], expectedMove: string): CoordinateRotation | null {
  const expected = moveToAtom(expectedMove);
  if (!expected || !SLICE_SET.has(expected.layer as CubeSlice)) return null;
  if (!movesMatchExpected(pendingMoves, expectedMove)) return null;
  const hasFaceEmulation = pendingMoves.some((move) => {
    const atom = moveToAtom(move);
    return atom ? FACE_SET.has(atom.layer as CubeFace) : false;
  });
  if (!hasFaceEmulation) return null;
  return {
    axis: SLICE_AXIS[expected.layer as CubeSlice],
    amount: expected.amount,
  };
}

function wideEmulationRotationAfterMatch(pendingMoves: string[], expectedMove: string): CoordinateRotation | null {
  const expected = moveToAtom(expectedMove);
  if (!expected || !WIDE_LAYER_SET.has(expected.layer as WideMoveLayer)) return null;
  if (!movesMatchExpected(pendingMoves, expectedMove)) return null;
  const wideFace = wideLayerToFace(expected.layer as WideMoveLayer);
  const { axis, sign } = FACE_AXIS[wideFace];
  return {
    axis,
    amount: sign === 1 ? invertAmount(expected.amount) : expected.amount,
  };
}

function coordinateRotationForSliceMove(move: string): CoordinateRotation | null {
  const atom = moveToAtom(move);
  if (!atom || !SLICE_SET.has(atom.layer as CubeSlice)) return null;
  return {
    axis: SLICE_AXIS[atom.layer as CubeSlice],
    amount: atom.amount,
  };
}

function coordinateRotationForRotationMove(move: string): CoordinateRotation | null {
  const atom = moveToAtom(move);
  if (!atom || !ROTATION_LAYER_SET.has(atom.layer as RotationMoveLayer)) return null;
  return {
    axis: atom.layer as MoveAxis,
    amount: invertAmount(atom.amount),
  };
}

function invertAmount(amount: 1 | 2 | 3): 1 | 2 | 3 {
  if (amount === 1) return 3;
  if (amount === 3) return 1;
  return 2;
}

function wideLayerToFace(layer: WideMoveLayer): CubeFace {
  return layer.toUpperCase() as CubeFace;
}

function rotateCoordinateState(state: MoveCoordinateState, rotation: CoordinateRotation): MoveCoordinateState {
  return (Object.keys(state) as CubeFace[]).reduce<MoveCoordinateState>((next, face) => {
    next[face] = rotateFace(state[face], rotation);
    return next;
  }, createMoveCoordinateState());
}

function rotateFace(face: CubeFace, rotation: CoordinateRotation): CubeFace {
  const axis = FACE_AXIS[face].axis;
  if (axis === rotation.axis) return face;
  const vector = faceToVector(face);
  const rotated = Array.from({ length: rotation.amount }).reduce<[number, number, number]>(
    (current) => rotateVectorOnce(current, rotation.axis),
    vector,
  );
  return vectorToFace(rotated);
}

function faceToVector(face: CubeFace): [number, number, number] {
  const { axis, sign } = FACE_AXIS[face];
  if (axis === "x") return [sign, 0, 0];
  if (axis === "y") return [0, sign, 0];
  return [0, 0, sign];
}

function vectorToFace([x, y, z]: [number, number, number]): CubeFace {
  if (x === 1) return "R";
  if (x === -1) return "L";
  if (y === 1) return "U";
  if (y === -1) return "D";
  if (z === 1) return "F";
  return "B";
}

function rotateVectorOnce([x, y, z]: [number, number, number], axis: MoveAxis): [number, number, number] {
  if (axis === "x") return [x, -z, y];
  if (axis === "y") return [z, y, -x];
  return [-y, x, z];
}

function physicalAmount(amount: 1 | 2 | 3, sign: 1 | -1) {
  const signed = amount === 3 ? -1 : amount;
  const physical = -sign * signed;
  return (((physical % 4) + 4) % 4) as 1 | 2 | 3;
}
