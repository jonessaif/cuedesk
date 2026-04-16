"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const AUTH_STORAGE_KEY = "cuedesk-active-user";
const ACTIVITY_STORAGE_KEY = "cuedesk-last-activity-ts";
const AUTO_LOGOUT_MS = 2 * 60 * 60 * 1000;

type UserRole = "operator" | "admin";

export type ActiveUser = {
  id: number;
  name: string;
  role: UserRole;
  isActive?: boolean;
};

type LoginResult = {
  ok: boolean;
  error?: string;
};

type AuthContextValue = {
  authReady: boolean;
  loginBusy: boolean;
  activeUser: ActiveUser | null;
  activeUserId: number | null;
  authHeaders: () => HeadersInit;
  loginWithPin: (pin: string) => Promise<LoginResult>;
  logout: (reason?: "manual" | "timeout") => void;
  switchUser: () => void;
  touchActivity: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function parseStoredUser(raw: string | null): ActiveUser | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ActiveUser;
    if (
      parsed &&
      typeof parsed.id === "number" &&
      parsed.id > 0 &&
      typeof parsed.name === "string" &&
      (parsed.role === "admin" || parsed.role === "operator")
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function nowTs(): number {
  return Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const logoutRef = useRef<(reason?: "manual" | "timeout") => void>(() => undefined);

  function touchActivity() {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(nowTs()));
  }

  function authHeaders(): HeadersInit {
    if (!activeUser) {
      return {};
    }
    return { "x-user-id": String(activeUser.id) };
  }

  function logout(reason: "manual" | "timeout" = "manual") {
    setActiveUser(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
      if (reason === "timeout") {
        window.localStorage.setItem("cuedesk-auth-timeout", "1");
        window.location.href = "/";
      }
    }
  }

  logoutRef.current = logout;

  async function loginWithPin(pinInput: string): Promise<LoginResult> {
    const pin = pinInput.trim();
    if (!/^\d{4}$/.test(pin)) {
      return { ok: false, error: "Enter a valid 4-digit PIN" };
    }

    setLoginBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json()) as {
        data?: { id: number; name: string; role: UserRole; isActive: boolean };
        error?: string;
      };

      if (!res.ok || !data?.data) {
        return { ok: false, error: data?.error ?? "Login failed" };
      }

      const nextUser: ActiveUser = {
        id: data.data.id,
        name: data.data.name,
        role: data.data.role,
        isActive: data.data.isActive,
      };
      setActiveUser(nextUser);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
      }
      touchActivity();
      return { ok: true };
    } catch {
      return { ok: false, error: "Login failed" };
    } finally {
      setLoginBusy(false);
    }
  }

  function switchUser() {
    logout("manual");
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = parseStoredUser(window.localStorage.getItem(AUTH_STORAGE_KEY));
    if (stored) {
      setActiveUser(stored);
      touchActivity();
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !activeUser) {
      return;
    }

    const onActivity = () => {
      touchActivity();
    };

    const events: Array<keyof WindowEventMap> = [
      "click",
      "touchstart",
      "keydown",
      "mousemove",
      "scroll",
    ];

    for (const eventName of events) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }

    const intervalId = window.setInterval(() => {
      const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
      const last = raw ? Number(raw) : 0;
      if (!Number.isFinite(last) || last <= 0) {
        touchActivity();
        return;
      }
      if (nowTs() - last >= AUTO_LOGOUT_MS) {
        logoutRef.current("timeout");
      }
    }, 60_000);

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, onActivity);
      }
      window.clearInterval(intervalId);
    };
  }, [activeUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authReady,
      loginBusy,
      activeUser,
      activeUserId: activeUser?.id ?? null,
      authHeaders,
      loginWithPin,
      logout,
      switchUser,
      touchActivity,
    }),
    [activeUser, authReady, loginBusy],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
