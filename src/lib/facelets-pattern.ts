import type { KPattern, KPatternData } from "cubing/kpuzzle";

export const FACELET_ORDER = "URFDLB";
export const FACELET_LENGTH = 54;

const REID_EDGE_ORDER = "UF UR UB UL DF DR DB DL FR FL BR BL".split(" ");
const REID_CORNER_ORDER = "UFR URB UBL ULF DRF DFL DLB DBR".split(" ");

const CORNER_FACELET_INDEXES = [
  [0, 21, 15],
  [5, 13, 47],
  [7, 45, 39],
  [2, 37, 23],
  [29, 10, 16],
  [31, 18, 32],
  [26, 34, 40],
  [24, 42, 8],
];

const EDGE_FACELET_INDEXES = [
  [1, 22],
  [3, 14],
  [6, 46],
  [4, 38],
  [30, 17],
  [27, 9],
  [25, 41],
  [28, 33],
  [19, 12],
  [20, 35],
  [44, 11],
  [43, 36],
];

type PieceInfo = {
  piece: number;
  orientation: number;
};

const PIECE_BY_STICKERS: Record<string, PieceInfo> = {};

REID_EDGE_ORDER.forEach((edge, piece) => {
  for (let orientation = 0; orientation < 2; orientation++) {
    PIECE_BY_STICKERS[rotateLeft(edge, orientation)] = { piece, orientation };
  }
});

REID_CORNER_ORDER.forEach((corner, piece) => {
  for (let orientation = 0; orientation < 3; orientation++) {
    PIECE_BY_STICKERS[rotateLeft(corner, orientation)] = { piece, orientation };
  }
});

function rotateLeft(value: string, amount: number) {
  return value.slice(amount) + value.slice(0, amount);
}

export function validateFacelets(facelets: string) {
  if (facelets.length !== FACELET_LENGTH) {
    throw new Error("魔方状态长度异常，无法求解。");
  }

  const counts = new Map<string, number>();
  for (const facelet of facelets) {
    if (!FACELET_ORDER.includes(facelet)) {
      throw new Error("魔方状态包含无法识别的颜色标记，无法求解。");
    }
    counts.set(facelet, (counts.get(facelet) ?? 0) + 1);
  }

  for (const facelet of FACELET_ORDER) {
    if (counts.get(facelet) !== 9) {
      throw new Error("魔方状态颜色数量异常，无法求解。");
    }
  }
}

function stickersWithoutCenters(facelets: string) {
  const stickers: number[] = [];
  const faces = facelets.match(/.{9}/g) ?? [];
  faces.forEach((face) => {
    face.split("").reverse().forEach((facelet, index) => {
      if (index !== 4) stickers.push(FACELET_ORDER.indexOf(facelet));
    });
  });
  return stickers;
}

function pieceInfo(stickers: number[], indexes: number[]) {
  const key = indexes.map((index) => FACELET_ORDER[stickers[index]]).join("");
  const info = PIECE_BY_STICKERS[key];
  if (!info) {
    throw new Error("魔方状态不是有效的三阶魔方状态，无法求解。");
  }
  return info;
}

function assignPiece(stickers: number[], indexes: number[], pieceName: string, orientation: number) {
  rotateLeft(pieceName, orientation).split("").forEach((facelet, index) => {
    stickers[indexes[index]] = FACELET_ORDER.indexOf(facelet);
  });
}

function assignFormulaPiece(stickers: string[], source: string[], targetIndexes: number[], sourceIndexes: number[], orientation: number) {
  const rotatedSourceIndexes = [...sourceIndexes.slice(orientation), ...sourceIndexes.slice(0, orientation)];
  rotatedSourceIndexes.forEach((sourceIndex, index) => {
    stickers[targetIndexes[index]] = source[sourceIndex];
  });
}

function stickersToFacelets(stickers: number[]) {
  const facelets = Array.from({ length: FACELET_LENGTH }, (_, index) => {
    const faceIndex = Math.floor(index / 9);
    return FACELET_ORDER[faceIndex];
  });
  let stickerIndex = 0;

  for (let faceOffset = 0; faceOffset < FACELET_LENGTH; faceOffset += 9) {
    for (let localIndex = 8; localIndex >= 0; localIndex--) {
      if (localIndex === 4) continue;
      facelets[faceOffset + localIndex] = FACELET_ORDER[stickers[stickerIndex]];
      stickerIndex += 1;
    }
  }

  return facelets.join("");
}

function formulaStickersWithoutCenters(facelets: string) {
  const stickers: string[] = [];
  const faces = facelets.match(/.{9}/g) ?? [];
  faces.forEach((face) => {
    face.split("").reverse().forEach((facelet, index) => {
      if (index !== 4) stickers.push(facelet);
    });
  });
  return stickers;
}

function formulaStickersToFacelets(stickers: string[], sourceFacelets: string) {
  const facelets = sourceFacelets.split("");
  let stickerIndex = 0;

  for (let faceOffset = 0; faceOffset < FACELET_LENGTH; faceOffset += 9) {
    for (let localIndex = 8; localIndex >= 0; localIndex--) {
      if (localIndex === 4) continue;
      facelets[faceOffset + localIndex] = stickers[stickerIndex];
      stickerIndex += 1;
    }
  }

  return facelets.join("");
}

export async function faceletsToPattern(facelets: string): Promise<KPattern> {
  validateFacelets(facelets);
  const [{ cube3x3x3 }, { KPattern }] = await Promise.all([
    import("cubing/puzzles"),
    import("cubing/kpuzzle"),
  ]);
  const kpuzzle = await cube3x3x3.kpuzzle();
  const stickers = stickersWithoutCenters(facelets);
  const patternData = {
    CORNERS: {
      pieces: CORNER_FACELET_INDEXES.map((indexes) => pieceInfo(stickers, indexes).piece),
      orientation: CORNER_FACELET_INDEXES.map((indexes) => pieceInfo(stickers, indexes).orientation),
    },
    EDGES: {
      pieces: EDGE_FACELET_INDEXES.map((indexes) => pieceInfo(stickers, indexes).piece),
      orientation: EDGE_FACELET_INDEXES.map((indexes) => pieceInfo(stickers, indexes).orientation),
    },
    CENTERS: {
      pieces: [0, 1, 2, 3, 4, 5],
      orientation: [0, 0, 0, 0, 0, 0],
      orientationMod: [1, 1, 1, 1, 1, 1],
    },
  };

  return new KPattern(kpuzzle, patternData);
}

export function patternToFacelets(patternData: KPatternData) {
  const stickers: number[] = [];
  const corners = patternData.CORNERS;
  const edges = patternData.EDGES;

  CORNER_FACELET_INDEXES.forEach((indexes, position) => {
    assignPiece(stickers, indexes, REID_CORNER_ORDER[corners.pieces[position]], corners.orientation[position]);
  });
  EDGE_FACELET_INDEXES.forEach((indexes, position) => {
    assignPiece(stickers, indexes, REID_EDGE_ORDER[edges.pieces[position]], edges.orientation[position]);
  });

  return stickersToFacelets(stickers);
}

export async function applyMoveToFacelets(facelets: string, move: string) {
  const pattern = await faceletsToPattern(facelets);
  return patternToFacelets(pattern.applyMove(move).patternData);
}

export async function applyMovesToFacelets(facelets: string, moves: string[]) {
  let pattern = await faceletsToPattern(facelets);
  moves.forEach((move) => {
    pattern = pattern.applyMove(move);
  });
  return patternToFacelets(pattern.patternData);
}

export async function applyMoveToFormulaFacelets(facelets: string, move: string) {
  return applyMovesToFormulaFacelets(facelets, [move]);
}

export async function applyMovesToFormulaFacelets(facelets: string, moves: string[]) {
  if (facelets.length !== FACELET_LENGTH || !/^[URFDLBX]{54}$/.test(facelets)) {
    throw new Error("公式贴面状态长度异常，无法应用转动。");
  }

  const [{ cube3x3x3 }, { KPattern }] = await Promise.all([
    import("cubing/puzzles"),
    import("cubing/kpuzzle"),
  ]);
  const kpuzzle = await cube3x3x3.kpuzzle();
  let pattern = new KPattern(kpuzzle, {
    CORNERS: {
      pieces: CORNER_FACELET_INDEXES.map((_, index) => index),
      orientation: CORNER_FACELET_INDEXES.map(() => 0),
    },
    EDGES: {
      pieces: EDGE_FACELET_INDEXES.map((_, index) => index),
      orientation: EDGE_FACELET_INDEXES.map(() => 0),
    },
    CENTERS: {
      pieces: [0, 1, 2, 3, 4, 5],
      orientation: [0, 0, 0, 0, 0, 0],
      orientationMod: [1, 1, 1, 1, 1, 1],
    },
  });
  moves.forEach((move) => {
    pattern = pattern.applyMove(move);
  });

  const sourceStickers = formulaStickersWithoutCenters(facelets);
  const nextStickers = [...sourceStickers];
  const data = pattern.patternData;
  CORNER_FACELET_INDEXES.forEach((indexes, position) => {
    assignFormulaPiece(
      nextStickers,
      sourceStickers,
      indexes,
      CORNER_FACELET_INDEXES[data.CORNERS.pieces[position]],
      data.CORNERS.orientation[position],
    );
  });
  EDGE_FACELET_INDEXES.forEach((indexes, position) => {
    assignFormulaPiece(
      nextStickers,
      sourceStickers,
      indexes,
      EDGE_FACELET_INDEXES[data.EDGES.pieces[position]],
      data.EDGES.orientation[position],
    );
  });

  return formulaStickersToFacelets(nextStickers, facelets);
}
