"use client";

import Link from "next/link";
import { useState } from "react";

export type PageHeaderNavItem = {
  href: string;
  label: string;
  className?: string;
};

type PageHeaderProps = {
  title: string;
  navItems: PageHeaderNavItem[];
  userLabel?: string | null;
  showServerButton?: boolean;
  onServerClick?: () => void;
  onLogout: () => void;
  onToggleTheme: () => void;
  themeLabel: string;
  isDark?: boolean;
};

const defaultNavClassNameLight =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100";

const defaultNavClassNameDark =
  "rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700";

const actionButtonClassNameLight =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100";

const actionButtonClassNameDark =
  "rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700";

type SidebarIconKind =
  | "dashboard"
  | "management"
  | "reports"
  | "due"
  | "bills"
  | "server"
  | "theme"
  | "logout"
  | "generic";

function getSidebarIconKind(href: string, label: string): SidebarIconKind {
  const lowerHref = href.toLowerCase();
  const lowerLabel = label.toLowerCase();
  if (lowerHref === "/" || lowerLabel.includes("dashboard")) {
    return "dashboard";
  }
  if (lowerHref.includes("management") || lowerLabel.includes("management")) {
    return "management";
  }
  if (lowerHref.includes("reports") || lowerLabel.includes("report")) {
    return "reports";
  }
  if (lowerHref.includes("due") || lowerLabel.includes("due")) {
    return "due";
  }
  if (lowerHref.includes("bill") || lowerLabel.includes("bill")) {
    return "bills";
  }
  return "generic";
}

function SidebarIcon({ kind, isDark = false }: { kind: SidebarIconKind; isDark?: boolean }) {
  const iconClassName = "h-3.5 w-3.5";
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-md ${
        isDark
          ? "border border-slate-600 bg-slate-800 text-slate-200"
          : "border border-slate-300 bg-slate-200 text-slate-700"
      }`}
    >
      {kind === "dashboard" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
          <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
        </svg>
      ) : null}
      {kind === "management" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <line x1="2" y1="4" x2="14" y2="4" />
          <line x1="2" y1="8" x2="14" y2="8" />
          <line x1="2" y1="12" x2="14" y2="12" />
          <circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="10" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      ) : null}
      {kind === "reports" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <line x1="2" y1="14" x2="14" y2="14" />
          <rect x="3" y="8" width="2.5" height="6" fill="currentColor" stroke="none" />
          <rect x="7" y="5" width="2.5" height="9" fill="currentColor" stroke="none" />
          <rect x="11" y="2" width="2.5" height="12" fill="currentColor" stroke="none" />
        </svg>
      ) : null}
      {kind === "due" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5v4l2.5 1.5" />
        </svg>
      ) : null}
      {kind === "bills" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <path d="M4 1.5h8v13l-2-1-2 1-2-1-2 1z" />
          <line x1="5.5" y1="5" x2="10.5" y2="5" />
          <line x1="5.5" y1="8" x2="10.5" y2="8" />
        </svg>
      ) : null}
      {kind === "server" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <rect x="2" y="2" width="12" height="4" rx="1" />
          <rect x="2" y="10" width="12" height="4" rx="1" />
          <circle cx="4" cy="4" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      ) : null}
      {kind === "theme" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <circle cx="8" cy="8" r="3" />
          <line x1="8" y1="1.5" x2="8" y2="3" />
          <line x1="8" y1="13" x2="8" y2="14.5" />
          <line x1="1.5" y1="8" x2="3" y2="8" />
          <line x1="13" y1="8" x2="14.5" y2="8" />
        </svg>
      ) : null}
      {kind === "logout" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <path d="M6 2.5H3v11h3" />
          <path d="M9 5l3 3-3 3" />
          <line x1="12" y1="8" x2="5.5" y2="8" />
        </svg>
      ) : null}
      {kind === "generic" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClassName} aria-hidden>
          <circle cx="8" cy="8" r="5" />
        </svg>
      ) : null}
    </span>
  );
}

export function PageHeader({
  title,
  navItems,
  userLabel,
  showServerButton = false,
  onServerClick,
  onLogout,
  onToggleTheme,
  themeLabel,
  isDark = false,
}: PageHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuItemClassName = isDark
    ? "group flex items-center justify-between rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
    : "group flex items-center justify-between rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200";
  const topBarClassName = isDark
    ? "sticky top-0 z-30 -mx-1 mb-4 border-b border-slate-700 bg-slate-950/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-slate-950/90"
    : "sticky top-0 z-30 -mx-1 mb-4 border-b border-slate-200 bg-slate-100 px-1 py-2 backdrop-blur";
  const mobileMenuButtonClassName = isDark
    ? "flex h-9 w-9 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 sm:hidden"
    : "flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 sm:hidden";
  const titleClassName = isDark ? "text-2xl font-bold text-slate-100" : "text-2xl font-bold text-slate-900";
  const userLabelClassName = isDark
    ? "rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100"
    : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800";
  const actionButtonClassName = isDark ? actionButtonClassNameDark : actionButtonClassNameLight;
  const sidebarClassName = isDark
    ? "fixed left-0 top-0 z-50 h-full w-[56vw] max-w-[280px] border-r border-slate-700 bg-slate-900 p-3 shadow-xl transition-transform duration-200 sm:hidden"
    : "fixed left-0 top-0 z-50 h-full w-[56vw] max-w-[280px] border-r border-slate-300 bg-slate-100 p-3 shadow-xl transition-transform duration-200 sm:hidden";
  const sidebarCloseClassName = isDark
    ? "rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700"
    : "rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-900 hover:bg-slate-200";
  const sidebarSectionClassName = isDark
    ? "mt-3 rounded-lg border border-slate-700 bg-slate-800/60 p-2"
    : "mt-3 rounded-lg border border-slate-300 bg-slate-200/40 p-2";
  const sidebarSectionTitleClassName = isDark
    ? "text-[11px] font-semibold uppercase tracking-wide text-slate-300"
    : "text-[11px] font-semibold uppercase tracking-wide text-slate-600";
  const sidebarArrowClassName = isDark ? "text-xs text-slate-400" : "text-xs text-slate-500";
  const menuTitleClassName = isDark ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900";

  return (
    <>
      <div className={topBarClassName}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                className={mobileMenuButtonClassName}
              >
                <span className="flex w-4 flex-col gap-1">
                  <span className="h-0.5 w-4 rounded bg-current" />
                  <span className="h-0.5 w-4 rounded bg-current" />
                  <span className="h-0.5 w-4 rounded bg-current" />
                </span>
              </button>
              <h1 className={titleClassName}>{title}</h1>
            </div>
            <div className="mt-2 hidden flex-wrap items-center gap-2 sm:flex">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={item.className ?? (isDark ? defaultNavClassNameDark : defaultNavClassNameLight)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="ml-auto hidden flex-wrap items-center gap-2 sm:flex">
            {userLabel ? (
              <p className={userLabelClassName}>
                {userLabel}
              </p>
            ) : null}
            {showServerButton ? (
              <button type="button" onClick={onServerClick} className={actionButtonClassName}>
                Server
              </button>
            ) : null}
            <button type="button" onClick={onLogout} className={actionButtonClassName}>
              Logout
            </button>
            <button type="button" onClick={onToggleTheme} className={actionButtonClassName}>
              {themeLabel}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-40 ${isDark ? "bg-black/55" : "bg-black/30"} transition-opacity duration-200 sm:hidden ${
          mobileMenuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside
        className={`${sidebarClassName} ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between">
            <p className={menuTitleClassName}>Menu</p>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className={sidebarCloseClassName}
            >
              Close
            </button>
          </div>

          <div className={sidebarSectionClassName}>
            <p className={sidebarSectionTitleClassName}>Navigate</p>
            <div className="mt-2 grid gap-2">
              {navItems.map((item) => (
                <Link
                  key={`mobile-${item.href}`}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={mobileMenuItemClassName}
                >
                  <span className="flex items-center gap-2">
                    <SidebarIcon kind={getSidebarIconKind(item.href, item.label)} isDark={isDark} />
                    <span>{item.label}</span>
                  </span>
                  <span className={sidebarArrowClassName}>{">"}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className={sidebarSectionClassName}>
            <p className={sidebarSectionTitleClassName}>Quick Actions</p>
            <div className="mt-2 grid gap-2">
              {showServerButton ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onServerClick?.();
                  }}
                  className={mobileMenuItemClassName}
                >
                  <span className="flex items-center gap-2">
                    <SidebarIcon kind="server" isDark={isDark} />
                    <span>Server</span>
                  </span>
                  <span className={sidebarArrowClassName}>{">"}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onToggleTheme();
                }}
                className={mobileMenuItemClassName}
              >
                <span className="flex items-center gap-2">
                  <SidebarIcon kind="theme" isDark={isDark} />
                  <span>{themeLabel}</span>
                </span>
                <span className={sidebarArrowClassName}>{">"}</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onLogout();
            }}
            className={`${mobileMenuItemClassName} mt-auto text-left font-semibold`}
          >
            <span className="flex items-center gap-2">
              <SidebarIcon kind="logout" isDark={isDark} />
              <span>{userLabel ? `${userLabel} • Logout` : "Logout"}</span>
            </span>
            <span className={sidebarArrowClassName}>{">"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
