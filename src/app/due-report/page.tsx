"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ActiveUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
  isActive?: boolean;
};

type DueReportRow = {
  rowKey: string;
  totalDue: number;
  customerName: string;
  customerPhone: string;
  billCount: number;
  paymentIds: number[];
};

type DueByBillRow = {
  paymentId: number;
  billId: number;
  dueAmount: number;
  customerName: string;
  customerPhone: string;
  billDate: string | null;
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

export default function DueReportPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [dueViewMode, setDueViewMode] = useState<"customer" | "bill">("customer");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dueReport, setDueReport] = useState<DueReportRow[]>([]);
  const [dueReportByBill, setDueReportByBill] = useState<DueByBillRow[]>([]);
  const [dueReceiveModes, setDueReceiveModes] = useState<Record<string, "cash" | "upi" | "card">>({});
  const [dueReceiveAmounts, setDueReceiveAmounts] = useState<Record<string, string>>({});
  const [dueReceiveBusyKey, setDueReceiveBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

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

  async function loadDueReport() {
    const res = await fetch("/api/payment/due-report", { cache: "no-store", headers: authHeaders() });
    const data = await readJsonSafe<{ data?: DueReportRow[]; error?: string }>(res);
    if (!res.ok) {
      throw new Error(data?.error ?? "Failed to fetch due report");
    }
    const rows = data?.data ?? [];
    setDueReport(rows);
    setDueReceiveModes((prev) => {
      const next: Record<string, "cash" | "upi" | "card"> = { ...prev };
      for (const row of rows) {
        next[row.rowKey] = prev[row.rowKey] ?? "cash";
      }
      return next;
    });
    setDueReceiveAmounts((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const row of rows) {
        next[row.rowKey] = prev[row.rowKey] ?? String(row.totalDue);
      }
      return next;
    });
  }

  async function loadDueReportByBill() {
    const res = await fetch("/api/payment/due-report-by-bill", { cache: "no-store", headers: authHeaders() });
    const data = await readJsonSafe<{ data?: DueByBillRow[]; error?: string }>(res);
    if (!res.ok) {
      throw new Error(data?.error ?? "Failed to fetch due by bill report");
    }
    const rows = data?.data ?? [];
    setDueReportByBill(rows);
    setDueReceiveModes((prev) => {
      const next: Record<string, "cash" | "upi" | "card"> = { ...prev };
      for (const row of rows) {
        const key = `bill:${row.paymentId}`;
        next[key] = prev[key] ?? "cash";
      }
      return next;
    });
    setDueReceiveAmounts((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const row of rows) {
        const key = `bill:${row.paymentId}`;
        next[key] = prev[key] ?? String(row.dueAmount);
      }
      return next;
    });
  }

  async function refresh() {
    setError("");
    try {
      await loadDueReport();
      await loadDueReportByBill();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to load due report";
      setError(text);
    }
  }

  async function receiveDuePayment(row: DueReportRow) {
    const mode = dueReceiveModes[row.rowKey] ?? "cash";
    const amountRaw = dueReceiveAmounts[row.rowKey] ?? "";
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid receive amount");
      return;
    }
    if (amount > row.totalDue) {
      setError("Receive amount exceeds total due");
      return;
    }
    setDueReceiveBusyKey(row.rowKey);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/payment/receive-due", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ...(row.customerPhone !== "-" ? { customerPhone: row.customerPhone } : {}),
          ...(row.customerPhone === "-" ? { paymentId: row.paymentIds[0] } : {}),
          mode,
          amount,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to receive due payment");
      }
      setMessage("Due payment received");
      await refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to receive due payment";
      setError(text);
    } finally {
      setDueReceiveBusyKey(null);
    }
  }

  async function receiveDuePaymentByBill(row: DueByBillRow) {
    const rowKey = `bill:${row.paymentId}`;
    const mode = dueReceiveModes[rowKey] ?? "cash";
    const amountRaw = dueReceiveAmounts[rowKey] ?? "";
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid receive amount");
      return;
    }
    if (amount > row.dueAmount) {
      setError("Receive amount exceeds due");
      return;
    }
    setDueReceiveBusyKey(rowKey);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/payment/receive-due", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          paymentId: row.paymentId,
          mode,
          amount,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to receive due payment");
      }
      setMessage("Due payment received");
      await refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to receive due payment";
      setError(text);
    } finally {
      setDueReceiveBusyKey(null);
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
    void refresh();
  }, [activeUserId]);

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

  const normalizedCustomerFilter = customerFilter.trim().toLowerCase();
  const filteredDueReport = useMemo(() => {
    if (!normalizedCustomerFilter) {
      return dueReport;
    }
    return dueReport.filter((row) =>
      row.customerName.toLowerCase().includes(normalizedCustomerFilter) ||
      row.customerPhone.toLowerCase().includes(normalizedCustomerFilter),
    );
  }, [dueReport, normalizedCustomerFilter]);

  const filteredDueReportByBill = useMemo(() => {
    if (!normalizedCustomerFilter) {
      return dueReportByBill;
    }
    return dueReportByBill.filter((row) =>
      row.customerName.toLowerCase().includes(normalizedCustomerFilter) ||
      row.customerPhone.toLowerCase().includes(normalizedCustomerFilter),
    );
  }, [dueReportByBill, normalizedCustomerFilter]);

  if (!activeUserId) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">
            Please login on dashboard first to use Due Report.
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
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Due Report</h1>
          <div className="flex flex-wrap items-center gap-2">
            {activeUser ? (
              <p className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800">
                {activeUser.name} ({activeUser.role})
              </p>
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
            <Link href="/bills" className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
              Bills
            </Link>
          </div>
        </div>

        {error ? <p className="mb-3 rounded-md bg-red-100 p-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mb-3 rounded-md bg-emerald-100 p-2 text-sm text-emerald-700">{message}</p> : null}

        <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-md">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDueViewMode("customer")}
              className={`rounded px-2 py-1 text-xs ${dueViewMode === "customer" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"}`}
            >
              Due by Customer
            </button>
            <button
              type="button"
              onClick={() => setDueViewMode("bill")}
              className={`rounded px-2 py-1 text-xs ${dueViewMode === "bill" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"}`}
            >
              Due by Bill
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-900"
            >
              Refresh
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              placeholder="Filter by customer name or phone"
              className="w-full max-w-sm rounded border border-slate-300 px-2 py-1 text-xs"
            />
            {customerFilter.trim() ? (
              <button
                type="button"
                onClick={() => setCustomerFilter("")}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                Clear
              </button>
            ) : null}
          </div>

          {dueViewMode === "customer" ? (
            <div className="mt-3 max-h-[70vh] space-y-2 overflow-auto">
              {filteredDueReport.length === 0 ? (
                <p className="text-xs text-slate-600">
                  {customerFilter.trim() ? "No matching due entries." : "No pending due entries."}
                </p>
              ) : (
                filteredDueReport.map((row) => (
                  <div key={row.rowKey} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                    <p className="font-semibold">{row.customerName} ({row.customerPhone})</p>
                    <p>Bills: {row.billCount}</p>
                    <p>Due Amount: ₹{formatMoney(row.totalDue)}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <select
                        value={dueReceiveModes[row.rowKey] ?? "cash"}
                        onChange={(e) =>
                          setDueReceiveModes((prev) => ({
                            ...prev,
                            [row.rowKey]: e.target.value as "cash" | "upi" | "card",
                          }))
                        }
                        disabled={dueReceiveBusyKey === row.rowKey}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="cash">cash</option>
                        <option value="upi">upi</option>
                        <option value="card">card</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={dueReceiveAmounts[row.rowKey] ?? String(row.totalDue)}
                        onChange={(e) =>
                          setDueReceiveAmounts((prev) => ({
                            ...prev,
                            [row.rowKey]: e.target.value,
                          }))
                        }
                        disabled={dueReceiveBusyKey === row.rowKey}
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void receiveDuePayment(row)}
                        disabled={dueReceiveBusyKey === row.rowKey}
                        className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Receive Payment
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="mt-3 max-h-[70vh] space-y-2 overflow-auto">
              {filteredDueReportByBill.length === 0 ? (
                <p className="text-xs text-slate-600">
                  {customerFilter.trim() ? "No matching bill-wise due entries." : "No pending bill-wise due entries."}
                </p>
              ) : (
                filteredDueReportByBill.map((row) => {
                  const rowKey = `bill:${row.paymentId}`;
                  return (
                    <div key={row.paymentId} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                      <p className="font-semibold">Bill #{row.billId} {row.billDate ? `- ${formatDate(row.billDate)}` : ""}</p>
                      <p>{row.customerName} ({row.customerPhone})</p>
                      <p>Due Amount: ₹{formatMoney(row.dueAmount)}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <select
                          value={dueReceiveModes[rowKey] ?? "cash"}
                          onChange={(e) =>
                            setDueReceiveModes((prev) => ({
                              ...prev,
                              [rowKey]: e.target.value as "cash" | "upi" | "card",
                            }))
                          }
                          disabled={dueReceiveBusyKey === rowKey}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="cash">cash</option>
                          <option value="upi">upi</option>
                          <option value="card">card</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={dueReceiveAmounts[rowKey] ?? String(row.dueAmount)}
                          onChange={(e) =>
                            setDueReceiveAmounts((prev) => ({
                              ...prev,
                              [rowKey]: e.target.value,
                            }))
                          }
                          disabled={dueReceiveBusyKey === rowKey}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void receiveDuePaymentByBill(row)}
                          disabled={dueReceiveBusyKey === rowKey}
                          className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Receive Payment
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
