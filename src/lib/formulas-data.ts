import crossFormulas from "@/data/formulas/cross.json";
import f2lFormulas from "@/data/formulas/f2l.json";
import ollFormulas from "@/data/formulas/oll.json";
import pllFormulas from "@/data/formulas/pll.json";
import triggerFormulas from "@/data/formulas/triggers.json";

type RawFormulaItem = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  algo?: unknown;
  algos?: unknown;
  image?: unknown;
  facelets?: unknown;
  arrows?: unknown;
};

type RawFormulaVariant = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  algo?: unknown;
  facelets?: unknown;
};

type RawFormulaCategory = {
  name?: unknown;
  full?: unknown;
  items?: unknown;
};

export type FormulaItem = {
  id: string;
  name: string;
  description?: string;
  algo?: string;
  algos?: FormulaVariant[];
  image?: string;
  facelets?: string;
  arrows?: FormulaArrow[];
};

export type FormulaArrow = {
  from: number;
  to: number;
  bidirectional: boolean;
};

export type FormulaVariant = {
  id: string;
  name: string;
  description?: string;
  algo: string;
  facelets?: string;
};

export type FormulaCategory = {
  name: string;
  full: string;
  items: FormulaItem[];
};

const FORMULA_SOURCES = [
  { key: "cross", data: crossFormulas },
  { key: "f2l", data: f2lFormulas },
  { key: "oll", data: ollFormulas },
  { key: "pll", data: pllFormulas },
  { key: "triggers", data: triggerFormulas },
] as const satisfies readonly { key: string; data: RawFormulaCategory }[];

export type FormulaKey = (typeof FORMULA_SOURCES)[number]["key"];

export function getFormulaVariantKeys(category?: FormulaKey) {
  const sources = category
    ? FORMULA_SOURCES.filter(({ key }) => key === category)
    : FORMULA_SOURCES;
  return new Set(
    sources.flatMap(({ data }) => {
      const items = Array.isArray(data.items) ? data.items : [];
      return items.flatMap((rawItem, itemIndex) => {
        const item = normalizeItem(rawItem, itemIndex);
        if (!item) return [];
        if (item.algos?.length) {
          return item.algos.map((variant, variantIndex) => `${item.id}:${variant.id || `v${variantIndex + 1}`}`);
        }
        return item.algo ? [`${item.id}:main`] : [];
      });
    }),
  );
}

function normalizeVariant(raw: unknown, index: number): FormulaVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const variant = raw as RawFormulaVariant;
  if (typeof variant.algo !== "string") return null;
  const facelets = normalizeFacelets(variant.facelets);
  return {
    id: typeof variant.id === "string" && variant.id ? variant.id : `v${index + 1}`,
    name: typeof variant.name === "string" && variant.name ? variant.name : `公式 ${index + 1}`,
    ...(typeof variant.description === "string" && variant.description ? { description: variant.description } : {}),
    algo: variant.algo,
    ...(facelets ? { facelets } : {}),
  };
}

function normalizeFacelets(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!/^[URFDLBX]+$/.test(raw) || raw.length !== 54) return null;
  return raw;
}

function isTopStickerIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 8;
}

function normalizeArrow(raw: unknown): FormulaArrow | null {
  if (Array.isArray(raw)) {
    if (raw.length !== 2) return null;
    const [from, to] = raw;
    if (!isTopStickerIndex(from) || !isTopStickerIndex(to) || from === to) return null;
    return { from, to, bidirectional: true };
  }

  if (!raw || typeof raw !== "object") return null;
  const arrow = raw as { from?: unknown; to?: unknown; bidirectional?: unknown };
  if (!isTopStickerIndex(arrow.from) || !isTopStickerIndex(arrow.to) || arrow.from === arrow.to) return null;
  return { from: arrow.from, to: arrow.to, bidirectional: arrow.bidirectional === true };
}

function normalizeArrows(raw: unknown): FormulaArrow[] | null {
  if (!Array.isArray(raw)) return null;
  const arrows = raw.map(normalizeArrow).filter((arrow): arrow is FormulaArrow => Boolean(arrow));
  return arrows.length > 0 ? arrows : null;
}

function normalizeItem(raw: unknown, index: number): FormulaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as RawFormulaItem;
  const id = typeof item.id === "string" && item.id ? item.id : `case-${index + 1}`;
  const name = typeof item.name === "string" && item.name ? item.name : id;
  const fromAlgos = Array.isArray(item.algos) ? item.algos : Array.isArray(item.algo) ? item.algo : null;
  const algos = fromAlgos?.map(normalizeVariant).filter((variant): variant is FormulaVariant => Boolean(variant));
  const facelets = normalizeFacelets(item.facelets);
  const arrows = normalizeArrows(item.arrows);

  return {
    id,
    name,
    ...(typeof item.description === "string" && item.description ? { description: item.description } : {}),
    ...(typeof item.algo === "string" ? { algo: item.algo } : {}),
    ...(algos && algos.length > 0 ? { algos } : {}),
    ...(typeof item.image === "string" ? { image: item.image } : {}),
    ...(facelets ? { facelets } : {}),
    ...(arrows ? { arrows } : {}),
  };
}

function normalizeCategory(key: FormulaKey, raw: RawFormulaCategory): FormulaCategory {
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeItem).filter((item): item is FormulaItem => Boolean(item))
    : [];
  return {
    name: typeof raw.name === "string" ? raw.name : key.toUpperCase(),
    full: typeof raw.full === "string" ? raw.full : key,
    items,
  };
}

export const FORMULAS = Object.fromEntries(
  FORMULA_SOURCES.map(({ key, data }) => [key, normalizeCategory(key, data)]),
) as Record<FormulaKey, FormulaCategory>;
