"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AccessDeniedPage() {
  const [isDark, setIsDark] = useState(false);
  const [source, setSource] = useState("this page");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setIsDark(window.localStorage.getItem("cuedesk-theme") === "dark");
    const value = new URLSearchParams(window.location.search).get("from");
    setSource(value === "management" ? "Management" : "this page");
  }, []);

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("cuedesk-theme", next ? "dark" : "light");
      }
      return next;
    });
  }

  return (
    <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
      <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
        <h1 className="text-xl font-bold text-slate-900">Access Denied</h1>
        <p className="mt-2 text-sm text-slate-600">You do not have permission to access {source}. Admin role is required.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/" className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
            Go to Dashboard
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
          >
            {isDark ? "Light Theme" : "Dark Theme"}
          </button>
        </div>
      </div>
    </main>
  );
}
