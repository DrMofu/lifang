import { getArchiveScopedStorageKey } from "@/lib/solve-history";

export const CONSOLE_LOGGING_SETTINGS_KEY = "cube-console-logging-settings";
export const CONSOLE_LOGGING_SETTINGS_EVENT = "cube-console-logging-settings-change";

export type ConsoleLoggingSettings = {
  enabled: boolean;
  logSentCommands: boolean;
  logMove: boolean;
  logGyro: boolean;
  logFacelets: boolean;
  logBattery: boolean;
  logHardware: boolean;
  logDisconnect: boolean;
};

export type ConsoleLoggingSettingKey = keyof ConsoleLoggingSettings;

export const DEFAULT_CONSOLE_LOGGING_SETTINGS: ConsoleLoggingSettings = {
  enabled: false,
  logSentCommands: false,
  logMove: false,
  logGyro: false,
  logFacelets: false,
  logBattery: false,
  logHardware: false,
  logDisconnect: false,
};

export function normalizeConsoleLoggingSettings(value: unknown): ConsoleLoggingSettings {
  const candidate = value && typeof value === "object" ? (value as Partial<ConsoleLoggingSettings>) : {};
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_CONSOLE_LOGGING_SETTINGS.enabled,
    logSentCommands:
      typeof candidate.logSentCommands === "boolean"
        ? candidate.logSentCommands
        : DEFAULT_CONSOLE_LOGGING_SETTINGS.logSentCommands,
    logMove: typeof candidate.logMove === "boolean" ? candidate.logMove : DEFAULT_CONSOLE_LOGGING_SETTINGS.logMove,
    logGyro: typeof candidate.logGyro === "boolean" ? candidate.logGyro : DEFAULT_CONSOLE_LOGGING_SETTINGS.logGyro,
    logFacelets:
      typeof candidate.logFacelets === "boolean" ? candidate.logFacelets : DEFAULT_CONSOLE_LOGGING_SETTINGS.logFacelets,
    logBattery:
      typeof candidate.logBattery === "boolean" ? candidate.logBattery : DEFAULT_CONSOLE_LOGGING_SETTINGS.logBattery,
    logHardware:
      typeof candidate.logHardware === "boolean" ? candidate.logHardware : DEFAULT_CONSOLE_LOGGING_SETTINGS.logHardware,
    logDisconnect:
      typeof candidate.logDisconnect === "boolean"
        ? candidate.logDisconnect
        : DEFAULT_CONSOLE_LOGGING_SETTINGS.logDisconnect,
  };
}

export function loadConsoleLoggingSettings(): ConsoleLoggingSettings {
  if (typeof window === "undefined") return DEFAULT_CONSOLE_LOGGING_SETTINGS;
  try {
    return normalizeConsoleLoggingSettings(
      JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(CONSOLE_LOGGING_SETTINGS_KEY)) || "null"),
    );
  } catch {
    return DEFAULT_CONSOLE_LOGGING_SETTINGS;
  }
}

export function saveConsoleLoggingSettings(settings: ConsoleLoggingSettings) {
  if (typeof window === "undefined") return;
  const normalized = normalizeConsoleLoggingSettings(settings);
  window.localStorage.setItem(getArchiveScopedStorageKey(CONSOLE_LOGGING_SETTINGS_KEY), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent<ConsoleLoggingSettings>(CONSOLE_LOGGING_SETTINGS_EVENT, { detail: normalized }));
}
