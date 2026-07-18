export const SUPPORTED_LOCALES = ["zh", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LANGUAGE_COOKIE_KEY = "cube-language";
export const LANGUAGE_STORAGE_KEY = "cube-language";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

export function detectLocale(language: string | null | undefined): Locale {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  return "en";
}

