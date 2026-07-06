"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useCubeConnection } from "@/components/cube-connection-provider";

type ScreenWakeLockType = "screen";

type ScreenWakeLockSentinel = EventTarget & {
  released: boolean;
  release(): Promise<void>;
};

type ScreenWakeLockNavigator = Navigator & {
  wakeLock?: {
    request(type: ScreenWakeLockType): Promise<ScreenWakeLockSentinel>;
  };
};

export function ScreenWakeLockProvider({ children }: { children: ReactNode }) {
  const { connectionState } = useCubeConnection();
  const sentinelRef = useRef<ScreenWakeLockSentinel | null>(null);
  const requestIdRef = useRef(0);
  const [active, setActive] = useState(false);
  const shouldKeepAwake = connectionState === "connected";

  const releaseLock = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      // Browser may already have released it while the page visibility changed.
    }
  }, []);

  const requestLock = useCallback(async () => {
    if (!shouldKeepAwake) {
      requestIdRef.current += 1;
      await releaseLock();
      return;
    }

    const nav = navigator as ScreenWakeLockNavigator;
    if (!nav.wakeLock) {
      setActive(false);
      return;
    }

    if (document.visibilityState !== "visible") {
      await releaseLock();
      return;
    }

    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;

    try {
      const sentinel = await nav.wakeLock.request("screen");
      if (requestIdRef.current !== currentRequestId || document.visibilityState !== "visible") {
        await sentinel.release().catch(() => undefined);
        return;
      }
      sentinelRef.current = sentinel;
      setActive(true);
      sentinel.addEventListener(
        "release",
        () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            setActive(false);
          }
        },
        { once: true },
      );
    } catch {
      sentinelRef.current = null;
      setActive(false);
    }
  }, [releaseLock, shouldKeepAwake]);

  useEffect(() => {
    if (shouldKeepAwake) {
      void requestLock();
    } else {
      requestIdRef.current += 1;
      void releaseLock();
    }
    return () => {
      requestIdRef.current += 1;
      void releaseLock();
    };
  }, [requestLock, releaseLock, shouldKeepAwake]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!shouldKeepAwake) {
        void releaseLock();
        return;
      }
      if (document.visibilityState === "visible") {
        void requestLock();
      } else {
        void releaseLock();
      }
    };
    const handleUserActivation = () => {
      if (!shouldKeepAwake) return;
      if (active) return;
      void requestLock();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pointerdown", handleUserActivation);
    window.addEventListener("keydown", handleUserActivation);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pointerdown", handleUserActivation);
      window.removeEventListener("keydown", handleUserActivation);
    };
  }, [active, releaseLock, requestLock, shouldKeepAwake]);

  return children;
}
