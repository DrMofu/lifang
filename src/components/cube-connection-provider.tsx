"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Subscription } from "rxjs";
import type {
  GanCubeConnection,
  GanCubeCommand,
  GanCubeEvent,
  GanCubeMove,
} from "gan-web-bluetooth";
import { useCubeAppearance } from "@/components/cube-appearance-provider";
import {
  CONSOLE_LOGGING_SETTINGS_KEY,
  CONSOLE_LOGGING_SETTINGS_EVENT,
  DEFAULT_CONSOLE_LOGGING_SETTINGS,
  loadConsoleLoggingSettings,
  type ConsoleLoggingSettings,
} from "@/lib/console-logging";
import { mapMoveToOrientation } from "@/lib/cube-appearance";
import type { CubeQuaternion } from "@/lib/smart-cube";
import { applyMoveToFacelets } from "@/lib/facelets-pattern";
import {
  isCubeSerialAfter,
  isCubeSerialAtOrBefore,
  nextCubeSerial,
  normalizeCubeSerial,
} from "@/lib/cube-serial";
import {
  addDailyPracticeDuration,
  clearPendingPracticeSession,
  getActiveStatisticsArchiveId,
  getArchiveScopedStorageKey,
  loadPendingPracticeSession,
  savePendingPracticeSession,
  subscribeStatisticsArchiveChange,
  type PendingPracticeSession,
} from "@/lib/solve-history";
import { touchLocalUserDataPackageUpdatedAt } from "@/lib/user-data-package";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type ConnectionInfo = {
  deviceName: string;
  deviceMAC: string;
  hardwareName: string;
  hardwareVersion: string;
  softwareVersion: string;
  productDate: string;
  gyroSupported: string;
  batteryLevel: number | null;
  protocol: string;
  error: string | null;
};

export type Telemetry = {
  clockSkew: string;
  quaternion: string;
  angularVelocity: string;
  lastMove: string;
  updatedAt: string;
};

export type CubeMoveRecord = {
  rawMove: string;
  move: string;
  t: number;
};

export type CubeVisualState = {
  baseFacelets: string | null;
  moves: CubeMoveRecord[];
};

export type CubeMoveSignal = {
  serial: number;
};

export type CubeFaceletsSignal = {
  serial: number;
  source: "remote" | "local";
};

type MoveHandler = (move: string, signal: CubeMoveSignal) => boolean | void;
type GyroHandler = (quaternion: CubeQuaternion) => void;
type FaceletsHandler = (facelets: string, signal: CubeFaceletsSignal) => void;
type LocalFaceletsSnapshot = {
  facelets: string;
  serial: number;
  source: CubeFaceletsSignal["source"];
};
type PendingSerialMove = GanCubeMove & {
  serial: number;
};
type RequestBatteryOptions = {
  force?: boolean;
  minIntervalMs?: number;
};

type CubeConnectionContextValue = {
  connectionState: ConnectionState;
  connectionInfo: ConnectionInfo;
  connectionPromptVisible: boolean;
  telemetry: Telemetry;
  facelets: string | null;
  moveHistory: CubeMoveRecord[];
  visualState: CubeVisualState;
  connectRealCube(): Promise<boolean>;
  disconnectCube(): Promise<void>;
  requestBattery(options?: RequestBatteryOptions): Promise<void>;
  requestFacelets(): Promise<void>;
  resetTrackedCubeState(): void;
  getLatestGyro(): CubeQuaternion | null;
  subscribeMove(handler: MoveHandler): () => void;
  subscribeGyro(handler: GyroHandler): () => void;
  subscribeFacelets(handler: FaceletsHandler): () => void;
};

const EMPTY_INFO: ConnectionInfo = {
  deviceName: "—",
  deviceMAC: "—",
  hardwareName: "—",
  hardwareVersion: "—",
  softwareVersion: "—",
  productDate: "—",
  gyroSupported: "—",
  batteryLevel: null,
  protocol: "GAN BLE",
  error: null,
};

const EMPTY_TELEMETRY: Telemetry = {
  clockSkew: "—",
  quaternion: "—",
  angularVelocity: "—",
  lastMove: "—",
  updatedAt: "—",
};

const CubeConnectionContext = createContext<CubeConnectionContextValue | null>(null);
const BATTERY_AUTO_MIN_INTERVAL_MS = 60_000;
const BATTERY_POLL_INTERVAL_MS = 5 * 60_000;
const BATTERY_RETRY_DELAY_MS = 1200;
const MOVE_IDLE_FACELETS_REQUEST_MS = 650;
const MOVE_IDLE_FACELETS_MIN_INTERVAL_MS = 350;
const GYRO_TELEMETRY_MIN_INTERVAL_MS = 250;
const PRACTICE_IDLE_STOP_MS = 60_000;
const CUBE_VISUAL_STATE_KEY = "cube-visual-state";
const MAX_VISUAL_RECOVERY_MOVES = 256;

function formatNumber(value: number) {
  return value.toFixed(3);
}

function formatTimestamp() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("Unable to determine cube MAC address")) {
      return "无法自动确定魔方 MAC 地址，连接失败";
    }
    return error.message;
  }
  if (typeof error === "string") return error;
  return "无法连接魔方";
}

function isValidStoredFacelets(facelets: unknown): facelets is string {
  if (typeof facelets !== "string" || facelets.length !== 54) return false;
  const counts: Record<string, number> = {};
  for (const facelet of facelets) {
    if (!"UDLRFB".includes(facelet)) return false;
    counts[facelet] = (counts[facelet] ?? 0) + 1;
  }
  return ["U", "D", "L", "R", "F", "B"].every((face) => counts[face] === 9);
}

function normalizeStoredMoves(value: unknown): Array<{ rawMove: string; t: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { rawMove: string; t: number } => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Record<string, unknown>;
      return typeof item.rawMove === "string" && typeof item.t === "number" && Number.isFinite(item.t);
    })
    .slice(-MAX_VISUAL_RECOVERY_MOVES);
}

function loadStoredVisualState(): { baseFacelets: string | null; moves: Array<{ rawMove: string; t: number }> } {
  if (typeof window === "undefined") return { baseFacelets: null, moves: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getArchiveScopedStorageKey(CUBE_VISUAL_STATE_KEY)) || "null");
    if (!parsed || typeof parsed !== "object") return { baseFacelets: null, moves: [] };
    const payload = parsed as Record<string, unknown>;
    const baseFacelets = isValidStoredFacelets(payload.baseFacelets) ? payload.baseFacelets : null;
    return { baseFacelets, moves: normalizeStoredMoves(payload.moves) };
  } catch {
    return { baseFacelets: null, moves: [] };
  }
}

function saveStoredVisualState(baseFacelets: string | null, moves: Array<{ rawMove: string; t: number }>) {
  if (typeof window === "undefined" || !baseFacelets) return;
  try {
    window.localStorage.setItem(
      getArchiveScopedStorageKey(CUBE_VISUAL_STATE_KEY),
      JSON.stringify({ baseFacelets, moves: moves.slice(-MAX_VISUAL_RECOVERY_MOVES) }),
    );
  } catch {
    // localStorage can be unavailable in restricted browsing modes.
  }
}

function shouldLogEvent(settings: ConsoleLoggingSettings, event: GanCubeEvent) {
  if (!settings.enabled) return false;
  if (event.type === "MOVE") return settings.logMove;
  if (event.type === "GYRO") return settings.logGyro;
  if (event.type === "FACELETS") return settings.logFacelets;
  if (event.type === "BATTERY") return settings.logBattery;
  if (event.type === "HARDWARE") return settings.logHardware;
  if (event.type === "DISCONNECT") return settings.logDisconnect;
  return false;
}

function formatSentCommandForConsole(command: GanCubeCommand, sentAt: string) {
  return {
    ...command,
    direction: "SEND",
    sentAt,
  };
}

export function CubeConnectionProvider({ children }: { children: ReactNode }) {
  const { orientation } = useCubeAppearance();
  const [storedVisualState] = useState(loadStoredVisualState);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>(EMPTY_INFO);
  const [connectionPromptVisible, setConnectionPromptVisible] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [facelets, setFacelets] = useState<string | null>(null);
  const [rawMoveHistory, setRawMoveHistory] = useState<Array<{ rawMove: string; t: number }>>([]);
  const [visualBaseFacelets, setVisualBaseFacelets] = useState<string | null>(storedVisualState.baseFacelets);
  const [rawVisualMovesSinceBase, setRawVisualMovesSinceBase] = useState<Array<{ rawMove: string; t: number }>>(
    storedVisualState.moves,
  );

  const connRef = useRef<GanCubeConnection | null>(null);
  const orientationRef = useRef(orientation);
  const subscriptionRef = useRef<Subscription | null>(null);
  const batteryRetryTimerRef = useRef<number | null>(null);
  const batteryPollTimerRef = useRef<number | null>(null);
  const connectionPromptTimerRef = useRef<number | null>(null);
  const lastBatteryRequestAtRef = useRef(0);
  const moveIdleFaceletsTimerRef = useRef<number | null>(null);
  const lastMoveIdleFaceletsRequestAtRef = useRef(0);
  const lastGyroTelemetryAtRef = useRef(0);
  const latestGyroRef = useRef<CubeQuaternion | null>(null);
  const lastMovesRef = useRef<GanCubeMove[]>([]);
  const localFaceletsRef = useRef<LocalFaceletsSnapshot | null>(null);
  const localFaceletsRevisionRef = useRef(0);
  const pendingMoveBySerialRef = useRef(new Map<number, PendingSerialMove>());
  const localFaceletsProcessingRef = useRef(false);
  const visualBaseFaceletsRef = useRef<string | null>(storedVisualState.baseFacelets);
  const rawVisualMovesSinceBaseRef = useRef<Array<{ rawMove: string; t: number }>>(storedVisualState.moves);
  const moveHandlersRef = useRef(new Set<MoveHandler>());
  const gyroHandlersRef = useRef(new Set<GyroHandler>());
  const faceletsHandlersRef = useRef(new Set<FaceletsHandler>());
  const consoleLoggingRef = useRef<ConsoleLoggingSettings>(DEFAULT_CONSOLE_LOGGING_SETTINGS);
  const practiceSessionRef = useRef<PendingPracticeSession | null>(null);
  const practiceIdleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);

  useEffect(() => {
    consoleLoggingRef.current = loadConsoleLoggingSettings();

    const refreshConsoleLoggingSettings = () => {
      consoleLoggingRef.current = loadConsoleLoggingSettings();
    };

    const handleConsoleLoggingSettingsChange = (event: Event) => {
      const customEvent = event as CustomEvent<ConsoleLoggingSettings>;
      consoleLoggingRef.current = customEvent.detail || loadConsoleLoggingSettings();
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === getArchiveScopedStorageKey(CONSOLE_LOGGING_SETTINGS_KEY)) {
        refreshConsoleLoggingSettings();
      }
    };

    const unsubscribeArchiveChange = subscribeStatisticsArchiveChange(() => {
      refreshConsoleLoggingSettings();
      const nextVisualState = loadStoredVisualState();
      visualBaseFaceletsRef.current = nextVisualState.baseFacelets;
      rawVisualMovesSinceBaseRef.current = nextVisualState.moves;
      setVisualBaseFacelets(nextVisualState.baseFacelets);
      setRawVisualMovesSinceBase(nextVisualState.moves);
    });

    window.addEventListener(CONSOLE_LOGGING_SETTINGS_EVENT, handleConsoleLoggingSettingsChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      unsubscribeArchiveChange();
      window.removeEventListener(CONSOLE_LOGGING_SETTINGS_EVENT, handleConsoleLoggingSettingsChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const publishMove = useCallback((move: string, signal: CubeMoveSignal) => {
    let accepted = true;
    moveHandlersRef.current.forEach((handler) => {
      if (handler(move, signal) === false) accepted = false;
    });
    return accepted;
  }, []);

  const publishGyro = useCallback((quaternion: CubeQuaternion) => {
    latestGyroRef.current = quaternion;
    gyroHandlersRef.current.forEach((handler) => handler(quaternion));
  }, []);

  const getLatestGyro = useCallback(() => latestGyroRef.current, []);

  const publishFacelets = useCallback((nextFacelets: string, signal: CubeFaceletsSignal) => {
    faceletsHandlersRef.current.forEach((handler) => handler(nextFacelets, signal));
  }, []);

  const clearPracticeIdleTimer = useCallback(() => {
    if (practiceIdleTimerRef.current === null) return;
    window.clearTimeout(practiceIdleTimerRef.current);
    practiceIdleTimerRef.current = null;
  }, []);

  const settlePracticeSession = useCallback(
    (session: PendingPracticeSession | null = practiceSessionRef.current) => {
      if (!session) return;
      clearPracticeIdleTimer();
      const nextDailyPractice = addDailyPracticeDuration(session.startAt, session.lastMoveAt, session.archiveId);
      if (nextDailyPractice.length > 0) touchLocalUserDataPackageUpdatedAt(new Date(), session.archiveId);
      if (practiceSessionRef.current === session) {
        practiceSessionRef.current = null;
      }
      clearPendingPracticeSession();
    },
    [clearPracticeIdleTimer],
  );

  const schedulePracticeIdleSettlement = useCallback(
    (session: PendingPracticeSession) => {
      clearPracticeIdleTimer();
      const delayMs = Math.max(0, session.lastMoveAt + PRACTICE_IDLE_STOP_MS - Date.now());
      practiceIdleTimerRef.current = window.setTimeout(() => {
        practiceIdleTimerRef.current = null;
        if (practiceSessionRef.current === session) {
          settlePracticeSession(session);
        }
      }, delayMs);
    },
    [clearPracticeIdleTimer, settlePracticeSession],
  );

  const trackPracticeMove = useCallback(
    (movedAt: number) => {
      const current = practiceSessionRef.current;
      if (!current || movedAt - current.lastMoveAt > PRACTICE_IDLE_STOP_MS) {
        if (current) settlePracticeSession(current);
        const next = {
          archiveId: getActiveStatisticsArchiveId(),
          startAt: movedAt,
          lastMoveAt: movedAt,
        };
        practiceSessionRef.current = next;
        savePendingPracticeSession(next);
        schedulePracticeIdleSettlement(next);
        return;
      }

      const next = { ...current, lastMoveAt: movedAt };
      practiceSessionRef.current = next;
      savePendingPracticeSession(next);
      schedulePracticeIdleSettlement(next);
    },
    [schedulePracticeIdleSettlement, settlePracticeSession],
  );

  useEffect(() => {
    const pending = loadPendingPracticeSession();
    if (pending) {
      if (Date.now() - pending.lastMoveAt > PRACTICE_IDLE_STOP_MS) {
        const nextDailyPractice = addDailyPracticeDuration(pending.startAt, pending.lastMoveAt, pending.archiveId);
        if (nextDailyPractice.length > 0) touchLocalUserDataPackageUpdatedAt(new Date(), pending.archiveId);
        clearPendingPracticeSession();
      } else {
        practiceSessionRef.current = pending;
        schedulePracticeIdleSettlement(pending);
      }
    }

    const settleIfIdle = () => {
      const session = practiceSessionRef.current;
      if (session && Date.now() - session.lastMoveAt > PRACTICE_IDLE_STOP_MS) {
        settlePracticeSession(session);
      }
    };

    window.addEventListener("visibilitychange", settleIfIdle);
    window.addEventListener("pagehide", settleIfIdle);
    return () => {
      clearPracticeIdleTimer();
      window.removeEventListener("visibilitychange", settleIfIdle);
      window.removeEventListener("pagehide", settleIfIdle);
    };
  }, [clearPracticeIdleTimer, schedulePracticeIdleSettlement, settlePracticeSession]);

  const updateLocalFacelets = useCallback(
    (snapshot: LocalFaceletsSnapshot) => {
      const next = {
        ...snapshot,
        serial: normalizeCubeSerial(snapshot.serial),
      };
      localFaceletsRef.current = next;
      localFaceletsRevisionRef.current += 1;
      setFacelets(next.facelets);
      publishFacelets(next.facelets, { serial: next.serial, source: next.source });
    },
    [publishFacelets],
  );

  const prunePendingMovesAtOrBefore = useCallback((serial: number) => {
    const normalizedSerial = normalizeCubeSerial(serial);
    pendingMoveBySerialRef.current.forEach((move, moveSerial) => {
      if (isCubeSerialAtOrBefore(normalizedSerial, moveSerial)) {
        pendingMoveBySerialRef.current.delete(moveSerial);
      }
    });
  }, []);

  const drainLocalFaceletsMoves = useCallback(async () => {
    if (localFaceletsProcessingRef.current) return;
    localFaceletsProcessingRef.current = true;

    try {
      while (localFaceletsRef.current) {
        const base = localFaceletsRef.current;
        const serial = nextCubeSerial(base.serial);
        const pendingMove = pendingMoveBySerialRef.current.get(serial);
        if (!pendingMove) return;

        const revision = localFaceletsRevisionRef.current;
        let nextFacelets: string;
        try {
          nextFacelets = await applyMoveToFacelets(base.facelets, pendingMove.move);
        } catch (error) {
          pendingMoveBySerialRef.current.delete(serial);
          console.warn("[LI-FANG Cube] Failed to apply MOVE to local facelets", {
            serial,
            move: pendingMove.move,
            error,
          });
          continue;
        }

        const current = localFaceletsRef.current;
        if (
          localFaceletsRevisionRef.current !== revision ||
          !current ||
          current.serial !== base.serial ||
          current.facelets !== base.facelets ||
          pendingMoveBySerialRef.current.get(serial) !== pendingMove
        ) {
          continue;
        }

        pendingMoveBySerialRef.current.delete(serial);
        updateLocalFacelets({ facelets: nextFacelets, serial, source: "local" });
      }
    } finally {
      localFaceletsProcessingRef.current = false;
    }
  }, [updateLocalFacelets]);

  const enqueueLocalFaceletsMove = useCallback(
    (event: PendingSerialMove) => {
      const base = localFaceletsRef.current;
      if (!base) return;

      const serial = normalizeCubeSerial(event.serial);
      if (!isCubeSerialAfter(base.serial, serial)) return;
      if (!pendingMoveBySerialRef.current.has(serial)) {
        pendingMoveBySerialRef.current.set(serial, { ...event, serial });
      }
      void drainLocalFaceletsMoves();
    },
    [drainLocalFaceletsMoves],
  );

  const acceptRemoteFacelets = useCallback(
    (nextFacelets: string, serial: number) => {
      const normalizedSerial = normalizeCubeSerial(serial);
      const local = localFaceletsRef.current;
      if (local?.source === "local" && local.serial === normalizedSerial && local.facelets !== nextFacelets) {
        console.warn("[LI-FANG Cube] Local facelets mismatch with remote FACELETS", {
          serial: normalizedSerial,
          localFacelets: local.facelets,
          remoteFacelets: nextFacelets,
        });
      }

      updateLocalFacelets({ facelets: nextFacelets, serial: normalizedSerial, source: "remote" });
      prunePendingMovesAtOrBefore(normalizedSerial);
      void drainLocalFaceletsMoves();
    },
    [drainLocalFaceletsMoves, prunePendingMovesAtOrBefore, updateLocalFacelets],
  );

  const clearBatteryRetryTimer = useCallback(() => {
    if (batteryRetryTimerRef.current === null) return;
    window.clearTimeout(batteryRetryTimerRef.current);
    batteryRetryTimerRef.current = null;
  }, []);

  const clearBatteryPollTimer = useCallback(() => {
    if (batteryPollTimerRef.current === null) return;
    window.clearInterval(batteryPollTimerRef.current);
    batteryPollTimerRef.current = null;
  }, []);

  const clearMoveIdleFaceletsTimer = useCallback(() => {
    if (moveIdleFaceletsTimerRef.current === null) return;
    window.clearTimeout(moveIdleFaceletsTimerRef.current);
    moveIdleFaceletsTimerRef.current = null;
  }, []);

  const clearConnectionPromptTimer = useCallback(() => {
    if (connectionPromptTimerRef.current === null) return;
    window.clearTimeout(connectionPromptTimerRef.current);
    connectionPromptTimerRef.current = null;
  }, []);

  const showConnectionPrompt = useCallback(() => {
    clearConnectionPromptTimer();
    setConnectionPromptVisible(true);
  }, [clearConnectionPromptTimer]);

  const hideConnectionPrompt = useCallback(
    (delayMs = 0) => {
      clearConnectionPromptTimer();
      if (delayMs <= 0) {
        setConnectionPromptVisible(false);
        return;
      }

      setConnectionPromptVisible(true);
      connectionPromptTimerRef.current = window.setTimeout(() => {
        connectionPromptTimerRef.current = null;
        setConnectionPromptVisible(false);
      }, delayMs);
    },
    [clearConnectionPromptTimer],
  );

  const resetSessionState = useCallback(() => {
    clearBatteryRetryTimer();
    clearBatteryPollTimer();
    clearMoveIdleFaceletsTimer();
    lastBatteryRequestAtRef.current = 0;
    lastMoveIdleFaceletsRequestAtRef.current = 0;
    lastMovesRef.current = [];
    localFaceletsRef.current = null;
    localFaceletsRevisionRef.current += 1;
    pendingMoveBySerialRef.current.clear();
    localFaceletsProcessingRef.current = false;
    setRawMoveHistory([]);
    setFacelets(null);
    setConnectionInfo(EMPTY_INFO);
    setTelemetry(EMPTY_TELEMETRY);
  }, [clearBatteryPollTimer, clearBatteryRetryTimer, clearMoveIdleFaceletsTimer]);

  const logSentCommand = useCallback((command: GanCubeCommand) => {
    const settings = consoleLoggingRef.current;
    if (!settings.enabled || !settings.logSentCommands) return;
    if (command.type === "REQUEST_FACELETS" && !settings.logFacelets) return;
    const timestamp = formatTimestamp();
    console.groupCollapsed(`[LI-FANG Cube] ${command.type} · ${timestamp}`);
    console.log("command", formatSentCommandForConsole(command, timestamp));
    console.groupEnd();
  }, []);

  const logReceivedEvent = useCallback((event: GanCubeEvent) => {
    if (!shouldLogEvent(consoleLoggingRef.current, event)) return;
    const timestamp = formatTimestamp();
    console.groupCollapsed(`[LI-FANG Cube] ${event.type} · ${timestamp}`);
    console.log("event", event);
    console.groupEnd();
  }, []);

  const sendCubeCommand = useCallback(
    async (conn: GanCubeConnection, command: GanCubeCommand) => {
      logSentCommand(command);
      await conn.sendCubeCommand(command).catch(() => undefined);
    },
    [logSentCommand],
  );

  const scheduleMoveIdleFaceletsCheck = useCallback(() => {
    clearMoveIdleFaceletsTimer();
    moveIdleFaceletsTimerRef.current = window.setTimeout(() => {
      moveIdleFaceletsTimerRef.current = null;
      const conn = connRef.current;
      if (!conn) return;

      const now = Date.now();
      if (now - lastMoveIdleFaceletsRequestAtRef.current < MOVE_IDLE_FACELETS_MIN_INTERVAL_MS) return;
      lastMoveIdleFaceletsRequestAtRef.current = now;
      void sendCubeCommand(conn, { type: "REQUEST_FACELETS" });
    }, MOVE_IDLE_FACELETS_REQUEST_MS);
  }, [clearMoveIdleFaceletsTimer, sendCubeCommand]);

  const requestBattery = useCallback(
    async (options: RequestBatteryOptions = {}) => {
      const conn = connRef.current;
      if (!conn) return;

      const minIntervalMs = options.minIntervalMs ?? BATTERY_AUTO_MIN_INTERVAL_MS;
      const now = Date.now();
      if (!options.force && now - lastBatteryRequestAtRef.current < minIntervalMs) return;

      lastBatteryRequestAtRef.current = now;
      await sendCubeCommand(conn, { type: "REQUEST_BATTERY" });
    },
    [sendCubeCommand],
  );

  const handleDisconnectEvent = useCallback(() => {
    clearBatteryRetryTimer();
    clearBatteryPollTimer();
    hideConnectionPrompt();
    lastBatteryRequestAtRef.current = 0;
    connRef.current = null;
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    lastMovesRef.current = [];
    localFaceletsRef.current = null;
    localFaceletsRevisionRef.current += 1;
    pendingMoveBySerialRef.current.clear();
    localFaceletsProcessingRef.current = false;
    setRawMoveHistory([]);
    setFacelets(null);
    setConnectionState("disconnected");
    setConnectionInfo(EMPTY_INFO);
    setTelemetry(EMPTY_TELEMETRY);
  }, [clearBatteryPollTimer, clearBatteryRetryTimer, hideConnectionPrompt]);

  const disconnectCube = useCallback(async () => {
    const conn = connRef.current;
    connRef.current = null;
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    resetSessionState();
    hideConnectionPrompt();
    setConnectionState("disconnected");
    if (conn) {
      await conn.disconnect().catch(() => undefined);
    }
  }, [hideConnectionPrompt, resetSessionState]);

  const connectRealCube = useCallback(async () => {
    showConnectionPrompt();

    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      setConnectionState("error");
      setConnectionInfo({
        ...EMPTY_INFO,
        error: "当前浏览器不支持 Web Bluetooth。请使用 Chrome / Edge 连接你的智能魔方。",
      });
      hideConnectionPrompt(3500);
      return false;
    }

    if (!window.isSecureContext) {
      setConnectionState("error");
      setConnectionInfo({
        ...EMPTY_INFO,
        error: "Web Bluetooth 需要 HTTPS 或 localhost 安全上下文。",
      });
      hideConnectionPrompt(3500);
      return false;
    }

    setConnectionState("connecting");
    setConnectionInfo({ ...EMPTY_INFO, error: null });
    setTelemetry(EMPTY_TELEMETRY);

    try {
      const { connectGanCube, cubeTimestampCalcSkew } = await import("gan-web-bluetooth");
      const conn = await connectGanCube();
      connRef.current = conn;
      lastMovesRef.current = [];
      setConnectionInfo({
        ...EMPTY_INFO,
        deviceName: conn.deviceName,
        deviceMAC: conn.deviceMAC,
        error: null,
      });
      setConnectionState("connected");
      hideConnectionPrompt();

      subscriptionRef.current = conn.events$.subscribe((event: GanCubeEvent) => {
        logReceivedEvent(event);

        if (event.type === "MOVE") {
          trackPracticeMove(Date.now());
          lastMovesRef.current = [...lastMovesRef.current, event].slice(-256);
          const rawMoveEntry = { rawMove: event.move, t: event.localTimestamp ?? performance.now() };
          const skew = lastMovesRef.current.length > 10 ? `${cubeTimestampCalcSkew(lastMovesRef.current)}%` : "—";
          const mappedMove = mapMoveToOrientation(event.move, orientationRef.current);
          setRawMoveHistory((prev) => [...prev, rawMoveEntry].slice(-64));
          setTelemetry((prev) => ({
            ...prev,
            clockSkew: skew,
            lastMove: mappedMove,
            updatedAt: formatTimestamp(),
          }));
          const accepted = publishMove(mappedMove, { serial: event.serial });
          if (accepted) {
            const nextVisualMoves = [...rawVisualMovesSinceBaseRef.current, rawMoveEntry].slice(-MAX_VISUAL_RECOVERY_MOVES);
            rawVisualMovesSinceBaseRef.current = nextVisualMoves;
            setRawVisualMovesSinceBase(nextVisualMoves);
            saveStoredVisualState(visualBaseFaceletsRef.current, nextVisualMoves);
            enqueueLocalFaceletsMove(event);
          }
          scheduleMoveIdleFaceletsCheck();
        } else if (event.type === "GYRO") {
          // 处理陀螺仪
          const { x, y, z, w } = event.quaternion;
          publishGyro(event.quaternion);
          const now = performance.now();
          if (now - lastGyroTelemetryAtRef.current < GYRO_TELEMETRY_MIN_INTERVAL_MS) return;
          lastGyroTelemetryAtRef.current = now;
          setTelemetry((prev) => ({
            ...prev,
            quaternion: `x: ${formatNumber(x)}, y: ${formatNumber(y)}, z: ${formatNumber(z)}, w: ${formatNumber(w)}`,
            angularVelocity: event.velocity
              ? `x: ${event.velocity.x}, y: ${event.velocity.y}, z: ${event.velocity.z}`
              : prev.angularVelocity,
            updatedAt: formatTimestamp(),
          }));
        } else if (event.type === "HARDWARE") {
          setConnectionInfo((prev) => ({
            ...prev,
            hardwareName: event.hardwareName || "—",
            hardwareVersion: event.hardwareVersion || "—",
            softwareVersion: event.softwareVersion || "—",
            productDate: event.productDate || "—",
            gyroSupported: event.gyroSupported ? "YES" : "NO",
          }));
        } else if (event.type === "BATTERY") {
          clearBatteryRetryTimer();
          setConnectionInfo((prev) => ({
            ...prev,
            batteryLevel: event.batteryLevel,
          }));
        } else if (event.type === "FACELETS") {
          visualBaseFaceletsRef.current = event.facelets;
          rawVisualMovesSinceBaseRef.current = [];
          setVisualBaseFacelets(event.facelets);
          setRawVisualMovesSinceBase([]);
          saveStoredVisualState(event.facelets, []);
          acceptRemoteFacelets(event.facelets, event.serial);
          setTelemetry((prev) => ({
            ...prev,
            updatedAt: formatTimestamp(),
          }));
        } else if (event.type === "DISCONNECT") {
          handleDisconnectEvent();
        }
      });

      await sendCubeCommand(conn, { type: "REQUEST_HARDWARE" });
      await requestBattery({ force: true });
      await sendCubeCommand(conn, { type: "REQUEST_FACELETS" });
      clearBatteryRetryTimer();
      batteryRetryTimerRef.current = window.setTimeout(() => {
        batteryRetryTimerRef.current = null;
        void requestBattery({ force: true });
      }, BATTERY_RETRY_DELAY_MS);
      return true;
    } catch (error) {
      await disconnectCube();
      setConnectionState("error");
      setConnectionInfo({
        ...EMPTY_INFO,
        error: `${errorMessage(error)}。请确认魔方已开机、靠近电脑，并重新连接。`,
      });
      hideConnectionPrompt(3500);
      return false;
    }
  }, [
    acceptRemoteFacelets,
    clearBatteryRetryTimer,
    disconnectCube,
    enqueueLocalFaceletsMove,
    handleDisconnectEvent,
    hideConnectionPrompt,
    logReceivedEvent,
    publishFacelets,
    publishGyro,
    publishMove,
    requestBattery,
    scheduleMoveIdleFaceletsCheck,
    sendCubeCommand,
    showConnectionPrompt,
    trackPracticeMove,
  ]);

  const requestFacelets = useCallback(async () => {
    const conn = connRef.current;
    if (conn) {
      await sendCubeCommand(conn, { type: "REQUEST_FACELETS" });
    }
  }, [sendCubeCommand]);

  const resetTrackedCubeState = useCallback(() => {
    setRawMoveHistory([]);
  }, []);

  const subscribeMove = useCallback((handler: MoveHandler) => {
    moveHandlersRef.current.add(handler);
    return () => moveHandlersRef.current.delete(handler);
  }, []);

  const subscribeGyro = useCallback((handler: GyroHandler) => {
    gyroHandlersRef.current.add(handler);
    return () => gyroHandlersRef.current.delete(handler);
  }, []);

  const subscribeFacelets = useCallback((handler: FaceletsHandler) => {
    faceletsHandlersRef.current.add(handler);
    return () => faceletsHandlersRef.current.delete(handler);
  }, []);

  const moveHistory = useMemo<CubeMoveRecord[]>(
    () =>
      rawMoveHistory.map((entry) => ({
        ...entry,
        move: mapMoveToOrientation(entry.rawMove, orientation),
      })),
    [orientation, rawMoveHistory],
  );

  const visualState = useMemo<CubeVisualState>(
    () => ({
      baseFacelets: visualBaseFacelets,
      moves: rawVisualMovesSinceBase.map((entry) => ({
        ...entry,
        move: mapMoveToOrientation(entry.rawMove, orientation),
      })),
    }),
    [orientation, rawVisualMovesSinceBase, visualBaseFacelets],
  );

  useEffect(() => {
    return () => {
      clearConnectionPromptTimer();
      void disconnectCube();
    };
  }, [clearConnectionPromptTimer, disconnectCube]);

  useEffect(() => {
    clearBatteryPollTimer();
    if (connectionState !== "connected") return;

    batteryPollTimerRef.current = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void requestBattery({ minIntervalMs: BATTERY_AUTO_MIN_INTERVAL_MS });
    }, BATTERY_POLL_INTERVAL_MS);

    return clearBatteryPollTimer;
  }, [clearBatteryPollTimer, connectionState, requestBattery]);

  const value = useMemo<CubeConnectionContextValue>(
    () => ({
      connectionState,
      connectionInfo,
      connectionPromptVisible,
      telemetry,
      facelets,
      moveHistory,
      visualState,
      connectRealCube,
      disconnectCube,
      requestBattery,
      requestFacelets,
      resetTrackedCubeState,
      getLatestGyro,
      subscribeMove,
      subscribeGyro,
      subscribeFacelets,
    }),
    [
      connectionInfo,
      connectionPromptVisible,
      connectionState,
      connectRealCube,
      disconnectCube,
      facelets,
      getLatestGyro,
      moveHistory,
      requestFacelets,
      requestBattery,
      resetTrackedCubeState,
      subscribeFacelets,
      subscribeGyro,
      subscribeMove,
      telemetry,
      visualState,
    ],
  );

  return <CubeConnectionContext.Provider value={value}>{children}</CubeConnectionContext.Provider>;
}

export function useCubeConnection() {
  const value = useContext(CubeConnectionContext);
  if (!value) {
    throw new Error("useCubeConnection must be used inside CubeConnectionProvider");
  }
  return value;
}
