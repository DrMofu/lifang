export type CfopMilestones = {
  cross: boolean;
  f2l: boolean;
  oll: boolean;
  pll: boolean;
};

const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const FACE_STARTS = [0, 9, 18, 27, 36, 45];
type F2lSlotCheck = Array<[indexes: number[], centerIndex: number]>;
export type F2lTargetSlot = "fl" | "fr" | "br" | "bl";

function faceSolved(facelets: string, start: number) {
  const center = facelets[start + 4];
  for (let i = start; i < start + 9; i++) {
    if (facelets[i] !== center) return false;
  }
  return true;
}

export function isSolvedFacelets(facelets: string | null) {
  if (!facelets || facelets.length !== SOLVED_FACELETS.length) return false;
  return FACE_STARTS.every((start) => faceSolved(facelets, start));
}

function stickersMatch(facelets: string, indexes: number[], centerIndex: number) {
  return indexes.every((index) => facelets[index] === facelets[centerIndex]);
}

function bottomCrossSolved(facelets: string) {
  return (
    stickersMatch(facelets, [28, 30, 32, 34], 31) &&
    facelets[25] === facelets[22] &&
    facelets[16] === facelets[13] &&
    facelets[43] === facelets[40] &&
    facelets[52] === facelets[49]
  );
}

function topCrossSolved(facelets: string) {
  return (
    stickersMatch(facelets, [1, 3, 5, 7], 4) &&
    facelets[19] === facelets[22] &&
    facelets[10] === facelets[13] &&
    facelets[37] === facelets[40] &&
    facelets[46] === facelets[49]
  );
}

function bottomF2lSolved(facelets: string) {
  return (
    bottomCrossSolved(facelets) &&
    stickersMatch(facelets, [21, 23, 24, 25, 26], 22) &&
    stickersMatch(facelets, [12, 14, 15, 16, 17], 13) &&
    stickersMatch(facelets, [39, 41, 42, 43, 44], 40) &&
    stickersMatch(facelets, [48, 50, 51, 52, 53], 49)
  );
}

function topF2lSolved(facelets: string) {
  return (
    topCrossSolved(facelets) &&
    stickersMatch(facelets, [18, 19, 20, 21, 23], 22) &&
    stickersMatch(facelets, [9, 10, 11, 12, 14], 13) &&
    stickersMatch(facelets, [36, 37, 38, 39, 41], 40) &&
    stickersMatch(facelets, [45, 46, 47, 48, 50], 49)
  );
}

function f2lSlotSolved(facelets: string, checks: F2lSlotCheck) {
  return checks.every(([indexes, centerIndex]) => stickersMatch(facelets, indexes, centerIndex));
}

export function detectF2lTargetEdgeSolved(facelets: string | null, slot: F2lTargetSlot) {
  if (!facelets || facelets.length !== SOLVED_FACELETS.length) return false;
  const edgeChecks: Record<F2lTargetSlot, F2lSlotCheck> = {
    fl: [[[21], 22], [[41], 40]],
    fr: [[[23], 22], [[12], 13]],
    br: [[[14], 13], [[48], 49]],
    bl: [[[39], 40], [[50], 49]],
  };
  return f2lSlotSolved(facelets, edgeChecks[slot]);
}

function bottomF2lSolvedCount(facelets: string) {
  if (!bottomCrossSolved(facelets)) return 0;
  const slots: F2lSlotCheck[] = [
    // FL slot: F-side (mid-left/bottom-left of F) + L-side (mid-right/bottom-right of L)
    [[[21, 24], 22], [[41, 44], 40]],
    // FR slot: F-side (mid-right/bottom-right of F) + R-side (mid-left/bottom-left of R)
    [[[23, 26], 22], [[12, 15], 13]],
    // BR slot: R-side (mid-right/bottom-right of R) + B-side (mid-left/bottom-left of B,
    //   i.e. R-adjacent column when B is viewed from behind)
    [[[14, 17], 13], [[48, 51], 49]],
    // BL slot: L-side (mid-left/bottom-left of L) + B-side (mid-right/bottom-right of B,
    //   i.e. L-adjacent column when B is viewed from behind)
    [[[39, 42], 40], [[50, 53], 49]],
  ];
  return slots.filter((slot) => f2lSlotSolved(facelets, slot)).length;
}

function topF2lSolvedCount(facelets: string) {
  if (!topCrossSolved(facelets)) return 0;
  const slots: F2lSlotCheck[] = [
    // FL slot
    [[[18, 21], 22], [[38, 41], 40]],
    // FR slot
    [[[20, 23], 22], [[9, 12], 13]],
    // BR slot: R top-right column + B's R-adjacent column (top-left/mid-left from behind view)
    [[[11, 14], 13], [[45, 48], 49]],
    // BL slot: L top-left column + B's L-adjacent column (top-right/mid-right from behind view)
    [[[36, 39], 40], [[47, 50], 49]],
  ];
  return slots.filter((slot) => f2lSlotSolved(facelets, slot)).length;
}

export function detectCfopMilestones(facelets: string | null): CfopMilestones {
  if (!facelets || facelets.length !== SOLVED_FACELETS.length) {
    return { cross: false, f2l: false, oll: false, pll: false };
  }

  const bottomF2l = bottomF2lSolved(facelets);
  const topF2l = topF2lSolved(facelets);
  const cross = bottomCrossSolved(facelets) || topCrossSolved(facelets);
  const f2l = bottomF2l || topF2l;

  const oll = (bottomF2l && faceSolved(facelets, 0)) || (topF2l && faceSolved(facelets, 27));
  const pll = isSolvedFacelets(facelets);

  return { cross, f2l, oll, pll };
}

export function detectF2lSolvedSlotCount(facelets: string | null) {
  if (!facelets || facelets.length !== SOLVED_FACELETS.length) return 0;
  return Math.max(bottomF2lSolvedCount(facelets), topF2lSolvedCount(facelets));
}
