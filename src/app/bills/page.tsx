"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isNativeServerSetupAvailable, openNativeServerSetup } from "@/lib/native-server-setup";

type ActiveUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
  isActive?: boolean;
};

type PaymentMode = "cash" | "upi" | "card" | "due";

type BillSearchRow = {
  id: number;
  createdAt: string;
  totalAmount: number;
  discountType: "fixed" | "percent" | null;
  discountValue: number | null;
  discountedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  payerNames: string[];
  paymentModes: PaymentMode[];
  paymentSplit: Array<{ mode: PaymentMode; amount: number }>;
  paymentCount: number;
};

function formatMoney(value: number | null | undefined): string {
  const safe = typeof value === "number" ? value : 0;
  return String(Math.round(safe));
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString();
}

function formatTimeHHmm(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function BillsPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [billSearchRows, setBillSearchRows] = useState<BillSearchRow[]>([]);
  const [billSearchLoading, setBillSearchLoading] = useState(false);
  const [billSearchError, setBillSearchError] = useState<string | null>(null);
  const [billFilterStartDate, setBillFilterStartDate] = useState("");
  const [billFilterEndDate, setBillFilterEndDate] = useState("");
  const [billFilterStartTime, setBillFilterStartTime] = useState("");
  const [billFilterEndTime, setBillFilterEndTime] = useState("");
  const [billFilterId, setBillFilterId] = useState("");
  const [billFilterPayer, setBillFilterPayer] = useState("");
  const [billFilterPaymentMode, setBillFilterPaymentMode] = useState<"all" | PaymentMode>("all");
  const showNativeServerButton = themeReady && isNativeServerSetupAvailable();

  const filteredSummary = useMemo(() => {
    const billsCount = billSearchRows.length;
    const total = billSearchRows.reduce((sum, row) => sum + row.discountedAmount, 0);
    const paid = billSearchRows.reduce((sum, row) => sum + row.paidAmount, 0);
    const due = billSearchRows.reduce((sum, row) => sum + row.remainingAmount, 0);
    const modeTotal = billFilterPaymentMode === "all"
      ? null
      : billSearchRows.reduce(
        (sum, row) =>
          sum +
          row.paymentSplit
            .filter((entry) => entry.mode === billFilterPaymentMode)
            .reduce((inner, entry) => inner + entry.amount, 0),
        0,
      );
    return { billsCount, total, paid, due, modeTotal };
  }, [billSearchRows, billFilterPaymentMode]);

  async function readJsonSafe<T>(res: Response): Promise<T | null> {
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  function authHeaders(): HeadersInit {
    if (!activeUserId) {
      return {};
    }
    return { "x-user-id": String(activeUserId) };
  }

  async function loadBillSearch() {
    setBillSearchLoading(true);
    setBillSearchError(null);
    try {
      const params = new URLSearchParams();
      if (billFilterStartDate) {
        params.set("startDate", billFilterStartDate);
      }
      if (billFilterEndDate) {
        params.set("endDate", billFilterEndDate);
      }
      if (billFilterStartTime) {
        params.set("startTime", billFilterStartTime);
      }
      if (billFilterEndTime) {
        params.set("endTime", billFilterEndTime);
      }
      if (billFilterId.trim()) {
        params.set("billId", billFilterId.trim());
      }
      if (billFilterPayer.trim()) {
        params.set("payer", billFilterPayer.trim());
      }
      if (billFilterPaymentMode !== "all") {
        params.set("paymentMode", billFilterPaymentMode);
      }

      const query = params.toString();
      const url = query ? `/api/bill/search?${query}` : "/api/bill/search";
      const res = await fetch(url, { cache: "no-store", headers: authHeaders() });
      const data = await readJsonSafe<{ data?: BillSearchRow[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch bills");
      }
      setBillSearchRows(data?.data ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch bills";
      setBillSearchError(message);
      setBillSearchRows([]);
    } finally {
      setBillSearchLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setIsDark(window.localStorage.getItem("cuedesk-theme") === "dark");
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !themeReady) {
      return;
    }
    window.localStorage.setItem("cuedesk-theme", isDark ? "dark" : "light");
  }, [isDark, themeReady]);

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("cuedesk-theme", next ? "dark" : "light");
      }
      return next;
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem("cuedesk-active-user");
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ActiveUser;
      if (typeof parsed.id === "number") {
        setActiveUser(parsed);
        setActiveUserId(parsed.id);
      }
    } catch {
      // ignore malformed cache
    }
  }, []);

  useEffect(() => {
    if (!activeUserId) {
      return;
    }
    void loadBillSearch();
  }, [activeUserId]);

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

  if (!activeUserId) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">
            Please login on dashboard first to use Bills page.
          </p>
          <Link href="/" className="mt-3 inline-block rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
            Go to Dashboard
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="ml-2 mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
          >
            {isDark ? "Light Theme" : "Dark Theme"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900">Bills</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link href="/" className="rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-300">
                Dashboard
              </Link>
              {activeUser?.role === "admin" ? (
                <Link href="/management" className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
                  Management
                </Link>
              ) : null}
              <Link href="/reports" className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                Reports
              </Link>
              <Link href="/due-report" className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
                Due Report
              </Link>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {activeUser ? (
              <p className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800">
                {activeUser.name} ({activeUser.role})
              </p>
            ) : null}
            {showNativeServerButton ? (
              <button
                type="button"
                onClick={() => {
                  if (!openNativeServerSetup()) {
                    setBillSearchError("Server setup button works in Android app only");
                  }
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                Server
              </button>
            ) : null}
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              Logout
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              {isDark ? "Light Theme" : "Dark Theme"}
            </button>
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-md">
          <p className="text-xs text-slate-600">
            Filter by date range, bill #, payer, and payment method.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={billFilterStartDate}
                onChange={(e) => setBillFilterStartDate(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              />
              <input
                type="date"
                value={billFilterEndDate}
                onChange={(e) => setBillFilterEndDate(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="time"
                value={billFilterStartTime}
                onChange={(e) => setBillFilterStartTime(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              />
              <input
                type="time"
                value={billFilterEndTime}
                onChange={(e) => setBillFilterEndTime(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
            <input
              type="text"
              value={billFilterId}
              onChange={(e) => setBillFilterId(e.target.value)}
              placeholder="Bill number"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              type="text"
              value={billFilterPayer}
              onChange={(e) => setBillFilterPayer(e.target.value)}
              placeholder="Payer name"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <select
              value={billFilterPaymentMode}
              onChange={(e) => setBillFilterPaymentMode(e.target.value as "all" | PaymentMode)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="all">all methods</option>
              <option value="cash">cash</option>
              <option value="upi">upi</option>
              <option value="card">card</option>
              <option value="due">due</option>
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadBillSearch()}
                disabled={billSearchLoading}
                className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {billSearchLoading ? "Loading..." : "Apply"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBillFilterStartDate("");
                  setBillFilterEndDate("");
                  setBillFilterStartTime("");
                  setBillFilterEndTime("");
                  setBillFilterId("");
                  setBillFilterPayer("");
                  setBillFilterPaymentMode("all");
                }}
                className="rounded bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-300"
              >
                Reset
              </button>
            </div>
          </div>

          {billSearchError ? (
            <p className="mt-2 text-xs text-red-600">{billSearchError}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded border border-slate-300 bg-slate-50 px-2 py-1">Bills: {filteredSummary.billsCount}</span>
            <span className="rounded border border-slate-300 bg-slate-50 px-2 py-1">Total: ₹{formatMoney(filteredSummary.total)}</span>
            <span className="rounded border border-slate-300 bg-slate-50 px-2 py-1">Paid: ₹{formatMoney(filteredSummary.paid)}</span>
            <span className="rounded border border-slate-300 bg-slate-50 px-2 py-1">Unpaid: ₹{formatMoney(filteredSummary.due)}</span>
            {billFilterPaymentMode !== "all" ? (
              <span className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1">
                {billFilterPaymentMode.toUpperCase()} Total: ₹{formatMoney(filteredSummary.modeTotal)}
              </span>
            ) : null}
          </div>

          <div className="mt-3 max-h-[70vh] overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-2 py-1">Bill</th>
                  <th className="px-2 py-1">Date</th>
                  <th className="px-2 py-1">Time</th>
                  <th className="px-2 py-1">Payer</th>
                  <th className="px-2 py-1">Modes</th>
                  <th className="px-2 py-1">Total</th>
                  <th className="px-2 py-1">Paid</th>
                  <th className="px-2 py-1">Due</th>
                </tr>
              </thead>
              <tbody>
                {billSearchRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-2 py-1">#{row.id}</td>
                    <td className="px-2 py-1">{formatDate(row.createdAt)}</td>
                    <td className="px-2 py-1">{formatTimeHHmm(row.createdAt)}</td>
                    <td className="px-2 py-1">{row.payerNames.length ? row.payerNames.join(", ") : "-"}</td>
                    <td className="px-2 py-1">
                      {(() => {
                        const visibleSplit = row.paymentSplit
                          .filter((entry) => billFilterPaymentMode === "all" || entry.mode === billFilterPaymentMode);
                        if (!visibleSplit.length) {
                          return "-";
                        }
                        return visibleSplit
                          .map((entry) => `${entry.mode}: ₹${formatMoney(entry.amount)}`)
                          .join(" | ");
                      })()}
                    </td>
                    <td className="px-2 py-1">{formatMoney(row.discountedAmount)}</td>
                    <td className="px-2 py-1">{formatMoney(row.paidAmount)}</td>
                    <td className="px-2 py-1 font-semibold">{formatMoney(row.remainingAmount)}</td>
                  </tr>
                ))}
                {billSearchRows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-2 text-slate-500" colSpan={8}>
                      No bills found for current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
