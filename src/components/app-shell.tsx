"use client";

import { type CSSProperties, type FocusEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCubeConnection } from "@/components/cube-connection-provider";
import { useLanguage } from "@/components/language-provider";
import type { MessageKey } from "@/lib/i18n-messages";
import settings from "@/settings.json";

const NAV: Array<{ href: string; labelKey: MessageKey; icon: string }> = [
  { href: "/practice", labelKey: "nav.practice", icon: "practice" },
  { href: "/trainer", labelKey: "nav.trainer", icon: "trainer" },
  { href: "/formulas", labelKey: "nav.formulas", icon: "cube" },
  { href: "/stats", labelKey: "nav.stats", icon: "stats" },
  { href: "/settings", labelKey: "nav.settings", icon: "settings" },
];

const PRACTICE_NAV = NAV.slice(0, 2);
const SECONDARY_NAV = NAV.slice(2);
const PRACTICE_NAV_MEMORY_KEY = "cube-topnav-practice-entry";

function isPracticeNavHref(value: unknown): value is (typeof PRACTICE_NAV)[number]["href"] {
  return typeof value === "string" && PRACTICE_NAV.some((item) => item.href === value);
}

function readPracticeNavMemory(): (typeof PRACTICE_NAV)[number]["href"] {
  if (typeof window === "undefined") return "/practice";
  try {
    const saved = window.localStorage.getItem(PRACTICE_NAV_MEMORY_KEY);
    return isPracticeNavHref(saved) ? saved : "/practice";
  } catch {
    return "/practice";
  }
}

function navItemActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppTopbar({ showCompactConnection = true }: { showCompactConnection?: boolean }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [practiceMenuOpen, setPracticeMenuOpen] = useState(false);
  const [rememberedPracticeHref, setRememberedPracticeHref] = useState<(typeof PRACTICE_NAV)[number]["href"]>("/practice");
  const practiceGroupRef = useRef<HTMLDivElement | null>(null);
  const mobilePracticeGroupRef = useRef<HTMLDivElement | null>(null);
  const routePracticeItem = PRACTICE_NAV.find((item) => navItemActive(pathname, item.href)) ?? null;
  const activePracticeItem = routePracticeItem ?? PRACTICE_NAV.find((item) => item.href === rememberedPracticeHref) ?? PRACTICE_NAV[0];
  const practiceGroupActive = Boolean(routePracticeItem);

  useEffect(() => {
    setRememberedPracticeHref(readPracticeNavMemory());
  }, []);

  useEffect(() => {
    setPracticeMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!routePracticeItem) return;
    setRememberedPracticeHref(routePracticeItem.href);
    try {
      window.localStorage.setItem(PRACTICE_NAV_MEMORY_KEY, routePracticeItem.href);
    } catch {
      // localStorage can be unavailable in restricted browsing modes.
    }
  }, [routePracticeItem]);

  useEffect(() => {
    if (!practiceMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        practiceGroupRef.current?.contains(target) ||
        mobilePracticeGroupRef.current?.contains(target)
      ) {
        return;
      }
      setPracticeMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPracticeMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [practiceMenuOpen]);

  const closePracticeMenuOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setPracticeMenuOpen(false);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <Link href="/" className="brand-link" aria-label={t("nav.home")}>
          <BrandMark />
          <div className="brand-text">
            <div className="brand-name">{t("brand.name")}</div>
            <div className="brand-sub">{t("brand.subtitle")} · {settings.version}</div>
          </div>
        </Link>
      </div>
      <nav className="topnav topnav-desktop" aria-label={t("nav.main")}>
        <div
          ref={practiceGroupRef}
          className={`navgroup${practiceMenuOpen ? " open" : ""}`}
          onPointerEnter={() => setPracticeMenuOpen(true)}
          onPointerLeave={() => setPracticeMenuOpen(false)}
          onFocus={() => setPracticeMenuOpen(true)}
          onBlur={closePracticeMenuOnBlur}
        >
          <Link
            href={activePracticeItem.href}
            className={`navitem navitem-button navgroup-trigger${practiceGroupActive ? " active" : ""}`}
            aria-haspopup="menu"
            aria-expanded={practiceMenuOpen}
            onClick={() => setPracticeMenuOpen(false)}
          >
            <NavIcon name={activePracticeItem.icon} />
            <span>{t(activePracticeItem.labelKey)}</span>
            <small>01</small>
          </Link>
          <div className="nav-dropdown" role="menu" aria-label={t("nav.practiceMenu")}>
            {PRACTICE_NAV.map((item) => {
              const active = navItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-dropdown-item${active ? " active" : ""}`}
                  role="menuitem"
                  onClick={() => {
                    setRememberedPracticeHref(item.href);
                    try {
                      window.localStorage.setItem(PRACTICE_NAV_MEMORY_KEY, item.href);
                    } catch {
                      // localStorage can be unavailable in restricted browsing modes.
                    }
                    setPracticeMenuOpen(false);
                  }}
                >
                  <NavIcon name={item.icon} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        </div>
        {SECONDARY_NAV.map((item, index) => {
          const active = navItemActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className={`navitem${active ? " active" : ""}`}>
              <NavIcon name={item.icon} />
              <span>{t(item.labelKey)}</span>
              <small>{String(index + 2).padStart(2, "0")}</small>
            </Link>
          );
        })}
      </nav>
      <nav className="topnav topnav-mobile" aria-label={t("nav.main")}>
        <div
          ref={mobilePracticeGroupRef}
          className={`navgroup${practiceMenuOpen ? " open" : ""}`}
          onBlur={closePracticeMenuOnBlur}
        >
          <button
            type="button"
            className={`navitem navitem-button navgroup-trigger${practiceGroupActive ? " active" : ""}`}
            aria-haspopup="menu"
            aria-expanded={practiceMenuOpen}
            onClick={() => setPracticeMenuOpen((open) => !open)}
          >
            <NavIcon name={activePracticeItem.icon} />
            <span>{t(activePracticeItem.labelKey)}</span>
            <small>01</small>
          </button>
          <div className="nav-dropdown" role="menu" aria-label={t("nav.practiceMenu")}>
            {PRACTICE_NAV.map((item) => {
              const active = navItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-dropdown-item${active ? " active" : ""}`}
                  role="menuitem"
                  onClick={() => {
                    setRememberedPracticeHref(item.href);
                    try {
                      window.localStorage.setItem(PRACTICE_NAV_MEMORY_KEY, item.href);
                    } catch {
                      // localStorage can be unavailable in restricted browsing modes.
                    }
                    setPracticeMenuOpen(false);
                  }}
                >
                  <NavIcon name={item.icon} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        </div>
        {SECONDARY_NAV.map((item, index) => {
          const active = navItemActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className={`navitem${active ? " active" : ""}`}>
              <NavIcon name={item.icon} />
              <span>{t(item.labelKey)}</span>
              <small>{String(index + 2).padStart(2, "0")}</small>
            </Link>
          );
        })}
      </nav>
      <div className="topright">{showCompactConnection && <CompactConnectButton />}</div>
    </header>
  );
}

export function AppFooter() {
  return <footer className="footbar">© 2026 cube.mwhitelab.com</footer>;
}

export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <img src="/li-fang-logo.png" alt="" />
    </div>
  );
}

export function CompactConnectButton() {
  const { t } = useLanguage();
  const {
    connectionState,
    connectionInfo,
    connectionPromptVisible,
    telemetry,
    facelets,
    connectRealCube,
    disconnectCube,
    requestBattery,
  } = useCubeConnection();
  const [tooltipPinned, setTooltipPinned] = useState(false);
  const [tooltipHovered, setTooltipHovered] = useState(false);
  const actionRef = useRef<HTMLDivElement | null>(null);
  const quaternionParts = parseTelemetryParts(telemetry.quaternion, ["x", "y", "z", "w"]);

  const connected = connectionState === "connected";
  const connecting = connectionState === "connecting";
  const label = connected
    ? connectionInfo.deviceName
    : connecting
      ? t("connection.connecting")
        : connectionState === "error"
          ? t("connection.failed")
          : t("connection.disconnected");
  const tooltipOpen = connected && (tooltipPinned || tooltipHovered);

  useEffect(() => {
    if (!connected) {
      setTooltipPinned(false);
      setTooltipHovered(false);
    }
  }, [connected]);

  useEffect(() => {
    if (!tooltipPinned) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || actionRef.current?.contains(target)) return;
      setTooltipPinned(false);
      setTooltipHovered(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [tooltipPinned]);

  const refreshBatteryOnPeek = () => {
    if (!connected) return;
    void requestBattery({ minIntervalMs: 60_000 });
  };

  const showTooltip = () => {
    if (!connected) return;
    setTooltipHovered(true);
    refreshBatteryOnPeek();
  };

  const toggleTooltip = () => {
    if (!connected) return;
    setTooltipPinned((pinned) => {
      const nextPinned = !pinned;
      if (!nextPinned) setTooltipHovered(false);
      return nextPinned;
    });
  };

  return (
    <div
      ref={actionRef}
      className={`top-connect-action${tooltipOpen ? " tooltip-open" : ""}`}
      onPointerEnter={showTooltip}
      onPointerLeave={() => setTooltipHovered(false)}
    >
      {connected ? (
        <button
          className="ghost-link"
          type="button"
          onClick={toggleTooltip}
          aria-describedby="top-connect-detail"
          aria-expanded={tooltipOpen}
        >
          <span className="dot dot-on"></span>
          {label}
          <BatteryIndicator level={connectionInfo.batteryLevel} />
        </button>
      ) : (
        <button
          className="ghost-link"
          type="button"
          onClick={() => void connectRealCube()}
          disabled={connecting}
          aria-describedby={connectionPromptVisible ? "top-connect-prompt" : "top-connect-detail"}
        >
          <span className={connecting ? "dot dot-pulse" : "dot"}></span>
          {label}
          <BatteryIndicator level={null} />
        </button>
      )}
      {connectionPromptVisible && typeof document !== "undefined" && createPortal(
        <>
          <div className="top-connect-prompt-backdrop" aria-hidden="true" />
          <div
            className="top-connect-prompt"
            id="top-connect-prompt"
            role="status"
            aria-live="polite"
          >
            <div className="top-connect-prompt-head">
              <div className="top-connect-prompt-visual" aria-hidden="true">
                <img src="/li-fang-logo.png" alt="" />
              </div>
              <div>
                <div className="top-connect-prompt-title">{t("connection.pairingTitle")}</div>
                <div className="top-connect-prompt-intro">{t("connection.pairingIntro")}</div>
              </div>
            </div>
            <ol className="top-connect-prompt-steps">
              <li>{t("connection.pairingStepWake")}</li>
              <li>{t("connection.pairingStepSelect")}</li>
              <li>{t("connection.pairingStepWait")}</li>
            </ol>
            <div className="top-connect-prompt-note">
              <span className="dot dot-pulse" aria-hidden="true" />
              {t("connection.ganOnly")}
            </div>
          </div>
        </>,
        document.body,
      )}
      <div className="top-connect-tooltip" id="top-connect-detail" role="tooltip" aria-hidden={!tooltipOpen}>
        <div className="top-connect-grid">
          <div className="top-connect-section">
            <div className="top-connect-title">{t("connection.device")}</div>
            <TopInfoRow label="Name" value={connectionInfo.deviceName} />
            <TopInfoRow label="MAC" value={connectionInfo.deviceMAC} />
            <TopInfoRow label="Battery" value={connectionInfo.batteryLevel == null ? "—" : `${connectionInfo.batteryLevel}%`} />
            <TopInfoRow label="Protocol" value={connectionInfo.protocol} />
            <TopInfoRow label="Hardware" value={connectionInfo.hardwareName} />
            <TopInfoRow label="HW Version" value={connectionInfo.hardwareVersion} />
            <TopInfoRow label="SW Version" value={connectionInfo.softwareVersion} />
            <TopInfoRow label="Product Date" value={connectionInfo.productDate} />
            <TopInfoRow label="Gyro" value={connectionInfo.gyroSupported} />
            <TopInfoRow label="Facelets" value={facelets ? "READY" : "—"} />
          </div>
          <div className="top-connect-section">
            <div className="top-connect-title">{t("connection.telemetry")}</div>
            <TopInfoRow label="Last Move" value={telemetry.lastMove} />
            <TopInfoRow label="Updated" value={telemetry.updatedAt} />
            <TopInfoRow label="Clock Skew" value={telemetry.clockSkew} />
            <TopVectorGrid label="Quaternion" parts={quaternionParts} fallback={telemetry.quaternion} />
            <TopInfoRow label="Angular Velocity" value={telemetry.angularVelocity} />
            {connectionInfo.error && <div className="top-connect-error">{connectionInfo.error}</div>}
            {connected && (
              <div className="top-connect-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setTooltipPinned(false);
                    setTooltipHovered(false);
                    void disconnectCube();
                  }}
                >
                  {t("connection.disconnect")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BatteryIndicator({ level }: { level: number | null }) {
  const { t } = useLanguage();
  const percent = level == null ? null : Math.max(0, Math.min(100, Math.round(level)));
  const style = { "--battery-level": `${percent ?? 0}%` } as CSSProperties;
  const label = percent == null ? "--" : `${percent}%`;

  return (
    <span className="top-battery" style={style} aria-label={percent == null ? t("connection.batteryUnknown") : `Battery ${percent}%`}>
      <span className="top-battery-fill" aria-hidden="true"></span>
      <span className="top-battery-text">{label}</span>
      <span className="top-battery-text top-battery-text-invert" aria-hidden="true">{label}</span>
    </span>
  );
}

export function NavIcon({ name }: { name: string }) {
  if (name === "practice") {
    return (
      <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 2.8h4" />
        <path d="M12 5.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6Z" />
        <path d="M12 9.1v4.2l2.7 1.6" />
        <path d="m17.6 6.4 1.2-1.2" />
      </svg>
    );
  }
  if (name === "cube") {
    return (
      <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2 19.5 7.4v8.8L12 20.8l-7.5-4.6V7.4L12 3.2Z" />
        <path d="m4.9 7.7 7.1 4.1 7.1-4.1M12 11.8v8.1" />
      </svg>
    );
  }
  if (name === "stats") {
    return (
      <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 19V9.8M12 19V5M18.5 19v-6.2" />
      </svg>
    );
  }
  if (name === "settings") {
    return (
      <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.2a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.8l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.2a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.2a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.8v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.2a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
        <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" />
      </svg>
    );
  }
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.8 19.1 8v8L12 20.2 4.9 16V8L12 3.8Z" />
      <path d="m8.2 10.1 3.8 2.2 3.8-2.2M12 12.3v4.2" />
    </svg>
  );
}

function parseTelemetryParts(value: string, keys: string[]) {
  const parts = new Map(value.split(",").map((part) => {
    const [key, ...rest] = part.trim().split(":");
    return [key, rest.join(":").trim()];
  }));
  return keys.map((key) => ({ key, value: parts.get(key) || "—" }));
}

function TopVectorGrid({
  label,
  parts,
  fallback,
}: {
  label: string;
  parts: Array<{ key: string; value: string }>;
  fallback: string;
}) {
  const hasValue = parts.some((part) => part.value !== "—");
  return (
    <div className="top-vector-row">
      <div className="top-vector-label">{label}</div>
      {hasValue ? (
        <div className="top-vector-grid" title={fallback}>
          {parts.map((part) => (
            <div key={part.key} className="top-vector-cell">
              <span>{part.key}</span>
              <b>{part.value}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="top-vector-empty">—</div>
      )}
    </div>
  );
}

function TopInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="top-info-row" data-label={label}>
      <span>{label}</span>
      <b title={value}>{value}</b>
    </div>
  );
}
