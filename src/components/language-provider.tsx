"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LANGUAGE_COOKIE_KEY,
  LANGUAGE_STORAGE_KEY,
  isLocale,
  type Locale,
} from "@/lib/i18n";
import { messages, type MessageKey } from "@/lib/i18n-messages";
import { translateEnglishSource } from "@/lib/i18n-source-messages";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey | string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children, initialLocale }: { children: ReactNode; initialLocale: Locale }) {
  const [locale, setLocaleState] = useState(initialLocale);

  useEffect(() => {
    try {
      const savedLocale = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isLocale(savedLocale)) setLocaleState(savedLocale);
    } catch {
      // localStorage can be unavailable in restricted browsing modes.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = locale === "zh" ? "立方" : "Cube";
  }, [locale]);

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale(nextLocale) {
      setLocaleState(nextLocale);
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
      } catch {
        // localStorage can be unavailable in restricted browsing modes.
      }
      document.cookie = `${LANGUAGE_COOKIE_KEY}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    },
    t(key) {
      if (key in messages[locale]) return messages[locale][key as MessageKey];
      if (locale === "en") return translateEnglishSource(key);
      return key;
    },
  }), [locale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
