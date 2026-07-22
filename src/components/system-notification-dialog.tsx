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
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import settings from "@/settings.json";

const SYSTEM_NOTICE_DISMISSED_VERSION_KEY = "lifang-system-notice-dismissed-version";

type SystemNotificationContextValue = {
  openSystemNotification(): void;
};

const SystemNotificationContext = createContext<SystemNotificationContextValue | null>(null);

const CHANGELOG_ENTRIES = [
  {
    version: "v0.1.1",
    changes: [
      "调整统计界面布局",
      "微调公式界面布局与OLL筛选功能",
      "新增系统通知界面",
    ],
  },
  {
    version: "v0.1.0",
    changes: [
      "支持英文",
      "细微界面调整",
      "部分公式进行了调整",
    ],
  },
  {
    version: "v0.0.1",
    changes: [
      "初始化项目",
      "练习页、专项页、教程页、公式页、统计页",
      "支持GAN Web Bluetooth连接GAN智能魔方",
    ],
  },
] as const;

export function SystemNotificationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (pathname === "/") {
      setOpen(false);
      return;
    }

    try {
      setOpen(window.localStorage.getItem(SYSTEM_NOTICE_DISMISSED_VERSION_KEY) !== settings.version);
    } catch {
      setOpen(true);
    }
  }, [pathname]);

  const openSystemNotification = useCallback(() => setOpen(true), []);
  const closeSystemNotification = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SYSTEM_NOTICE_DISMISSED_VERSION_KEY, settings.version);
    } catch {
      // localStorage can be unavailable in restricted browsing modes.
    }
  }, []);
  const value = useMemo(() => ({ openSystemNotification }), [openSystemNotification]);

  return (
    <SystemNotificationContext.Provider value={value}>
      {children}
      <SystemNotificationDialog open={open} onClose={closeSystemNotification} />
    </SystemNotificationContext.Provider>
  );
}

export function useSystemNotification() {
  const context = useContext(SystemNotificationContext);
  if (!context) throw new Error("useSystemNotification must be used within SystemNotificationProvider");
  return context;
}

type SystemNotificationDialogProps = {
  open: boolean;
  onClose(): void;
};

export function SystemNotificationDialog({ open, onClose }: SystemNotificationDialogProps) {
  const { t } = useLanguage();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="system-notice-backdrop" onMouseDown={onClose}>
      <section
        className="system-notice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-notice-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="system-notice-head">
          <div>
            <div className="st-ch-kicker">— SYSTEM NOTICE</div>
            <h2 id="system-notice-title">{t("系统通知")}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="system-notice-close"
            aria-label={t("关闭系统通知")}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="system-notice-body">
          <section className="system-notice-changelog" aria-labelledby="system-notice-changelog-title">
            <div className="system-notice-section-head">
              <div>
                <span>CHANGE LOG</span>
                <h3 id="system-notice-changelog-title">Change log</h3>
              </div>
              <b>{settings.version}</b>
            </div>

            <div className="system-notice-timeline">
              {CHANGELOG_ENTRIES.map((entry) => (
                <article key={entry.version} className="system-notice-release">
                  <div className="system-notice-release-meta">
                    <strong>{t(entry.version)}</strong>
                  </div>
                  <ul>
                    {entry.changes.map((change) => <li key={change}>{t(change)}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <aside className="system-notice-development-note">
            <span>{t("开发期声明")}</span>
            <p>{t("本项目仍处于开发周期，版本更新时可能存在数据结构变动以及旧数据不兼容的问题，敬请谅解。")}</p>
            <p>
              {t("如有任何需求或问题，请前往")}{" "}
              <a href="https://github.com/DrMofu/lifang" target="_blank" rel="noreferrer">
                DrMofu/lifang
              </a>{" "}
              {t("提交 Issue。")}
            </p>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  );
}
