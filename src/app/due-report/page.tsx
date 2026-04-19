"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { isNativeServerSetupAvailable, openNativeServerSetup } from "@/lib/native-server-setup";

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

type UrgencyLevel = "urgent" | "high" | "normal";
type UrgencyFilter = "all" | "urgent" | "high" | "normal";
type CollectionSort = "priorityAmount" | "dueDesc" | "ageDesc";

function formatMoney(value: number | null | undefined): string {
  const safe = typeof value === "number" ? value : 0;
  return String(Math.round(safe));
}

function customerLookupKey(customerName: string, customerPhone: string): string {
  const phone = customerPhone.trim();
  if (phone && phone !== "-") {
    return `phone:${phone}`;
  }
  return `name:${customerName.trim().toLowerCase()}`;
}

function calculateOverdueDays(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const dueDay = new Date(date);
  dueDay.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((now.getTime() - dueDay.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(diffDays, 0);
}

function getUrgencyLevel(amount: number, overdueDays: number | null): UrgencyLevel {
  if (amount >= 3000 || (overdueDays ?? 0) >= 14) {
    return "urgent";
  }
  if (amount >= 1200 || (overdueDays ?? 0) >= 7) {
    return "high";
  }
  return "normal";
}

function urgencyLabel(level: UrgencyLevel): string {
  if (level === "urgent") {
    return "Urgent";
  }
  if (level === "high") {
    return "High";
  }
  return "Normal";
}

export default function DueReportPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [dueViewMode, setDueViewMode] = useState<"customer" | "bill">("customer");
  const [customerFilter, setCustomerFilter] = useState("");
  const showNativeServerButton = themeReady && isNativeServerSetupAvailable();
  const [dueReport, setDueReport] = useState<DueReportRow[]>([]);
  const [dueReportByBill, setDueReportByBill] = useState<DueByBillRow[]>([]);
  const [dueReceiveModes, setDueReceiveModes] = useState<Record<string, "cash" | "upi" | "card">>({});
  const [dueReceiveAmounts, setDueReceiveAmounts] = useState<Record<string, string>>({});
  const [dueReceiveBusyKey, setDueReceiveBusyKey] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [customerSort, setCustomerSort] = useState<CollectionSort>("priorityAmount");
  const [billSort, setBillSort] = useState<CollectionSort>("priorityAmount");
  const [sessionCollected, setSessionCollected] = useState(0);
  const [nextFocusKey, setNextFocusKey] = useState<string | null>(null);
  const amountInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  function resetFilters() {
    setCustomerFilter("");
    setUrgencyFilter("all");
    setCustomerSort("priorityAmount");
    setBillSort("priorityAmount");
  }

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

  async function receiveDuePayment(row: DueReportRow, nextKey: string | null) {
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
      setSessionCollected((prev) => prev + Math.round(amount));
      setDueReceiveAmounts((prev) => ({ ...prev, [row.rowKey]: "" }));
      setNextFocusKey(nextKey);
      setMessage("Due payment received");
      await refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to receive due payment";
      setError(text);
    } finally {
      setDueReceiveBusyKey(null);
    }
  }

  async function receiveDuePaymentByBill(row: DueByBillRow, nextKey: string | null) {
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
      setSessionCollected((prev) => prev + Math.round(amount));
      setDueReceiveAmounts((prev) => ({ ...prev, [rowKey]: "" }));
      setNextFocusKey(nextKey);
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

  const overdueDaysByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of dueReportByBill) {
      const key = customerLookupKey(row.customerName, row.customerPhone);
      const overdueDays = calculateOverdueDays(row.billDate);
      if (overdueDays == null) {
        continue;
      }
      const current = map.get(key);
      if (current == null || overdueDays > current) {
        map.set(key, overdueDays);
      }
    }
    return map;
  }, [dueReportByBill]);

  const enhancedCustomerRows = useMemo(() => {
    const urgencyRank: Record<UrgencyLevel, number> = { urgent: 3, high: 2, normal: 1 };
    const rows = filteredDueReport.map((row) => {
      const key = customerLookupKey(row.customerName, row.customerPhone);
      const overdueDays = overdueDaysByCustomer.get(key) ?? 0;
      const urgency = getUrgencyLevel(row.totalDue, overdueDays);
      return {
        row,
        overdueDays,
        urgency,
      };
    });

    const filteredRows = rows.filter((item) => {
      if (urgencyFilter === "all") {
        return true;
      }
      return item.urgency === urgencyFilter;
    });

    filteredRows.sort((a, b) => {
      if (customerSort === "priorityAmount") {
        const priorityDiff = urgencyRank[b.urgency] - urgencyRank[a.urgency];
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        if (b.row.totalDue !== a.row.totalDue) {
          return b.row.totalDue - a.row.totalDue;
        }
        return b.overdueDays - a.overdueDays;
      }
      if (customerSort === "ageDesc") {
        if (b.overdueDays !== a.overdueDays) {
          return b.overdueDays - a.overdueDays;
        }
        return b.row.totalDue - a.row.totalDue;
      }
      return b.row.totalDue - a.row.totalDue;
    });

    return filteredRows;
  }, [filteredDueReport, overdueDaysByCustomer, urgencyFilter, customerSort]);

  const enhancedBillRows = useMemo(() => {
    const urgencyRank: Record<UrgencyLevel, number> = { urgent: 3, high: 2, normal: 1 };
    const rows = filteredDueReportByBill.map((row) => {
      const overdueDays = calculateOverdueDays(row.billDate) ?? 0;
      const urgency = getUrgencyLevel(row.dueAmount, overdueDays);
      return {
        row,
        overdueDays,
        urgency,
      };
    });

    const filteredRows = rows.filter((item) => {
      if (urgencyFilter === "all") {
        return true;
      }
      return item.urgency === urgencyFilter;
    });

    filteredRows.sort((a, b) => {
      if (billSort === "priorityAmount") {
        const priorityDiff = urgencyRank[b.urgency] - urgencyRank[a.urgency];
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        if (b.row.dueAmount !== a.row.dueAmount) {
          return b.row.dueAmount - a.row.dueAmount;
        }
        return b.overdueDays - a.overdueDays;
      }
      if (billSort === "ageDesc") {
        if (b.overdueDays !== a.overdueDays) {
          return b.overdueDays - a.overdueDays;
        }
        return b.row.dueAmount - a.row.dueAmount;
      }
      return b.row.dueAmount - a.row.dueAmount;
    });

    return filteredRows;
  }, [filteredDueReportByBill, urgencyFilter, billSort]);

  const dueSummary = useMemo(() => {
    if (dueViewMode === "customer") {
      return {
        totalDue: enhancedCustomerRows.reduce((sum, item) => sum + item.row.totalDue, 0),
        totalItems: enhancedCustomerRows.length,
        urgentCount: enhancedCustomerRows.filter((item) => item.urgency === "urgent").length,
        highCount: enhancedCustomerRows.filter((item) => item.urgency === "high").length,
        normalCount: enhancedCustomerRows.filter((item) => item.urgency === "normal").length,
      };
    }
    return {
      totalDue: enhancedBillRows.reduce((sum, item) => sum + item.row.dueAmount, 0),
      totalItems: enhancedBillRows.length,
      urgentCount: enhancedBillRows.filter((item) => item.urgency === "urgent").length,
      highCount: enhancedBillRows.filter((item) => item.urgency === "high").length,
      normalCount: enhancedBillRows.filter((item) => item.urgency === "normal").length,
    };
  }, [dueViewMode, enhancedCustomerRows, enhancedBillRows]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (customerFilter.trim()) {
      count += 1;
    }
    if (urgencyFilter !== "all") {
      count += 1;
    }
    if (dueViewMode === "customer" ? customerSort !== "priorityAmount" : billSort !== "priorityAmount") {
      count += 1;
    }
    return count;
  }, [customerFilter, urgencyFilter, dueViewMode, customerSort, billSort]);

  useEffect(() => {
    if (!nextFocusKey) {
      return;
    }
    const input = amountInputRefs.current[nextFocusKey];
    if (input) {
      input.focus();
      input.select();
      setNextFocusKey(null);
      return;
    }
    const firstCustomerKey = enhancedCustomerRows[0]?.row.rowKey;
    if (dueViewMode === "customer" && firstCustomerKey && amountInputRefs.current[firstCustomerKey]) {
      amountInputRefs.current[firstCustomerKey]?.focus();
      amountInputRefs.current[firstCustomerKey]?.select();
      setNextFocusKey(null);
    }
  }, [nextFocusKey, dueViewMode, enhancedCustomerRows, enhancedBillRows]);

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
        <PageHeader
          title="Due Report"
          navItems={[
            {
              href: "/",
              label: "Dashboard",
              className: "rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-300",
            },
            ...(activeUser?.role === "admin"
              ? [{
                href: "/management",
                label: "Management",
                className: "rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700",
              }]
              : []),
            {
              href: "/reports",
              label: "Reports",
              className: "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700",
            },
            {
              href: "/bills",
              label: "Bills",
              className: "rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700",
            },
          ]}
          userLabel={activeUser ? `${activeUser.name} (${activeUser.role})` : null}
          showServerButton={showNativeServerButton}
          onServerClick={() => {
            if (!openNativeServerSetup()) {
              setError("Server setup button works in Android app only");
            }
          }}
          onLogout={logout}
          onToggleTheme={toggleTheme}
          themeLabel={isDark ? "Light Theme" : "Dark Theme"}
          isDark={isDark}
        />

        {error ? <p className="mb-3 rounded-md bg-red-100 p-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mb-3 rounded-md bg-emerald-100 p-2 text-sm text-emerald-700">{message}</p> : null}

        <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-md sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-200"
            >
              {filtersOpen ? "Hide Filters" : "Show Filters"}
              {!filtersOpen && activeFilterCount > 0 ? (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
              <span className="text-[10px]">{filtersOpen ? "▲" : "▼"}</span>
            </button>
            <div className="flex items-center gap-2">
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Clear Filters
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void refresh()}
                className="rounded bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900"
              >
                Refresh
              </button>
            </div>
          </div>

          {filtersOpen ? (
            <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDueViewMode("customer")}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${dueViewMode === "customer" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"}`}
                >
                  Collection by Customer
                </button>
                <button
                  type="button"
                  onClick={() => setDueViewMode("bill")}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${dueViewMode === "bill" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"}`}
                >
                  Collection by Bill
                </button>
              </div>

              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customerFilter}
                    onChange={(e) => setCustomerFilter(e.target.value)}
                    placeholder="Search customer or phone"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  {customerFilter.trim() ? (
                    <button
                      type="button"
                      onClick={() => setCustomerFilter("")}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setUrgencyFilter("all")}
                    className={`rounded px-2 py-1 text-xs font-semibold ${urgencyFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgencyFilter("urgent")}
                    className={`rounded px-2 py-1 text-xs font-semibold ${urgencyFilter === "urgent" ? "bg-red-600 text-white" : "bg-red-50 text-red-700"}`}
                  >
                    Urgent
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgencyFilter("high")}
                    className={`rounded px-2 py-1 text-xs font-semibold ${urgencyFilter === "high" ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-700"}`}
                  >
                    High
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgencyFilter("normal")}
                    className={`rounded px-2 py-1 text-xs font-semibold ${urgencyFilter === "normal" ? "bg-sky-600 text-white" : "bg-sky-50 text-sky-700"}`}
                  >
                    Normal
                  </button>
                </div>

                <select
                  value={dueViewMode === "customer" ? customerSort : billSort}
                  onChange={(e) => {
                    const selected = e.target.value as CollectionSort;
                    if (dueViewMode === "customer") {
                      setCustomerSort(selected);
                    } else {
                      setBillSort(selected);
                    }
                  }}
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="priorityAmount">Sort: Priority + Amount</option>
                  <option value="dueDesc">Sort: Highest Due</option>
                  <option value="ageDesc">Sort: Oldest Due</option>
                </select>
              </div>
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className={`rounded-xl border p-3 ${isDark ? "border-amber-800 bg-amber-950/20" : "border-amber-200 bg-amber-50/80"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-amber-200" : "text-amber-700"}`}>Total Due</p>
                  <p className={`mt-1 text-3xl font-extrabold ${isDark ? "text-amber-100" : "text-amber-900"}`}>₹{formatMoney(dueSummary.totalDue)}</p>
                  <p className={`mt-1 text-[11px] ${isDark ? "text-amber-200/90" : "text-amber-800"}`}>Action target</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSummaryExpanded((prev) => !prev)}
                  aria-label={summaryExpanded ? "Collapse summary" : "Expand summary"}
                  title={summaryExpanded ? "Collapse summary" : "Expand summary"}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 md:hidden"
                >
                  <span className="leading-none">{summaryExpanded ? "▲" : "▼"}</span>
                </button>
              </div>
            </div>

            <div
              className={`${summaryExpanded ? "block" : "hidden"} rounded-xl border p-3 md:block ${isDark ? "border-emerald-800 bg-emerald-950/20" : "border-emerald-200 bg-emerald-50/80"}`}
            >
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-emerald-200" : "text-emerald-700"}`}>
                Collected This Session
              </p>
              <p className={`mt-1 text-3xl font-extrabold ${isDark ? "text-emerald-100" : "text-emerald-900"}`}>
                ₹{formatMoney(sessionCollected)}
              </p>
              <p className={`mt-1 text-xs ${isDark ? "text-emerald-200/90" : "text-emerald-800"}`}>
                {dueViewMode === "customer" ? enhancedCustomerRows.length : enhancedBillRows.length} accounts in current queue
              </p>
            </div>
          </div>

          <div className={`${summaryExpanded ? "block" : "hidden"} md:block`}>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className={`rounded-xl border p-3 ${isDark ? "border-red-800 bg-red-950/20" : "border-red-200 bg-red-50/80"}`}>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-red-200" : "text-red-700"}`}>Urgent</p>
                <p className={`mt-1 text-3xl font-extrabold ${isDark ? "text-red-100" : "text-red-800"}`}>{dueSummary.urgentCount}</p>
                <p className={`mt-1 text-[11px] ${isDark ? "text-red-200/90" : "text-red-700"}`}>Priority accounts</p>
              </div>
              <div className={`rounded-xl border p-3 ${isDark ? "border-orange-800 bg-orange-950/20" : "border-orange-200 bg-orange-50/80"}`}>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-orange-200" : "text-orange-700"}`}>High</p>
                <p className={`mt-1 text-3xl font-extrabold ${isDark ? "text-orange-100" : "text-orange-800"}`}>{dueSummary.highCount}</p>
                <p className={`mt-1 text-[11px] ${isDark ? "text-orange-200/90" : "text-orange-700"}`}>Follow-up soon</p>
              </div>
              <div className={`rounded-xl border p-3 ${isDark ? "border-sky-800 bg-sky-950/20" : "border-sky-200 bg-sky-50/80"}`}>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-sky-200" : "text-sky-700"}`}>Normal</p>
                <p className={`mt-1 text-3xl font-extrabold ${isDark ? "text-sky-100" : "text-sky-800"}`}>{dueSummary.normalCount}</p>
                <p className={`mt-1 text-[11px] ${isDark ? "text-sky-200/90" : "text-sky-700"}`}>Low pressure</p>
              </div>
            </div>
          </div>

          {dueViewMode === "customer" ? (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {enhancedCustomerRows.length === 0 ? (
                <p className={`rounded-lg border p-3 text-xs ${isDark ? "border-slate-700 bg-slate-900/20 text-slate-300" : "border-slate-200 bg-white text-slate-600"}`}>
                  {customerFilter.trim() ? "No matching dues for selected filters." : "No pending dues in this queue."}
                </p>
              ) : (
                enhancedCustomerRows.map(({ row, overdueDays, urgency }, index) => {
                  const rowKey = row.rowKey;
                  const nextKey = enhancedCustomerRows[index + 1]?.row.rowKey ?? null;
                  const amountColorClass = urgency === "urgent"
                    ? (isDark ? "text-red-300" : "text-red-700")
                    : urgency === "high"
                      ? (isDark ? "text-orange-300" : "text-orange-700")
                      : (isDark ? "text-sky-300" : "text-sky-700");
                  const badgeClass = urgency === "urgent"
                    ? (isDark ? "bg-red-900 text-red-100" : "bg-red-100 text-red-700")
                    : urgency === "high"
                      ? (isDark ? "bg-orange-900 text-orange-100" : "bg-orange-100 text-orange-700")
                      : (isDark ? "bg-sky-900 text-sky-100" : "bg-sky-100 text-sky-700");
                  const cardClass = urgency === "urgent"
                    ? (isDark ? "border-red-700 bg-red-950/20" : "border-red-200 bg-red-50/60")
                    : urgency === "high"
                      ? (isDark ? "border-orange-700 bg-orange-950/20" : "border-orange-200 bg-orange-50/60")
                      : (isDark ? "border-sky-700 bg-sky-950/20" : "border-sky-200 bg-sky-50/60");
                  return (
                    <article key={rowKey} className={`w-full rounded-xl border p-3 shadow-sm ${cardClass}`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-base font-semibold ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                            {row.customerName}
                          </p>
                          <p className={`truncate text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            {row.customerPhone}
                          </p>
                        </div>
                        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
                          {urgencyLabel(urgency)}
                        </span>
                        <div className="shrink-0 text-right">
                          <p className={`text-2xl font-extrabold leading-none ${amountColorClass}`}>₹{formatMoney(row.totalDue)}</p>
                          <p className={`mt-1 text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                            Bills: {row.billCount} • {overdueDays}d old
                          </p>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)_auto] gap-1.5">
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
                          <option value="cash">Cash</option>
                          <option value="upi">UPI</option>
                          <option value="card">Card</option>
                        </select>
                        <input
                          ref={(el) => {
                            amountInputRefs.current[rowKey] = el;
                          }}
                          type="number"
                          min="0"
                          step="1"
                          value={dueReceiveAmounts[rowKey] ?? String(row.totalDue)}
                          onChange={(e) =>
                            setDueReceiveAmounts((prev) => ({
                              ...prev,
                              [rowKey]: e.target.value,
                            }))
                          }
                          disabled={dueReceiveBusyKey === rowKey}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          placeholder="Amount"
                        />
                        <button
                          type="button"
                          onClick={() => void receiveDuePayment(row, nextKey)}
                          disabled={dueReceiveBusyKey === rowKey}
                          className="rounded bg-emerald-700 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {dueReceiveBusyKey === rowKey ? "Receiving..." : "Receive"}
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {enhancedBillRows.length === 0 ? (
                <p className={`rounded-lg border p-3 text-xs ${isDark ? "border-slate-700 bg-slate-900/20 text-slate-300" : "border-slate-200 bg-white text-slate-600"}`}>
                  {customerFilter.trim() ? "No matching bill dues for selected filters." : "No pending bill dues in this queue."}
                </p>
              ) : (
                enhancedBillRows.map(({ row, overdueDays, urgency }, index) => {
                  const rowKey = `bill:${row.paymentId}`;
                  const nextKey = enhancedBillRows[index + 1] ? `bill:${enhancedBillRows[index + 1].row.paymentId}` : null;
                  const amountColorClass = urgency === "urgent"
                    ? (isDark ? "text-red-300" : "text-red-700")
                    : urgency === "high"
                      ? (isDark ? "text-orange-300" : "text-orange-700")
                      : (isDark ? "text-sky-300" : "text-sky-700");
                  const badgeClass = urgency === "urgent"
                    ? (isDark ? "bg-red-900 text-red-100" : "bg-red-100 text-red-700")
                    : urgency === "high"
                      ? (isDark ? "bg-orange-900 text-orange-100" : "bg-orange-100 text-orange-700")
                      : (isDark ? "bg-sky-900 text-sky-100" : "bg-sky-100 text-sky-700");

                  return (
                    <article
                      key={row.paymentId}
                      className={`w-full rounded-xl border p-3 shadow-sm ${
                        urgency === "urgent"
                          ? isDark
                            ? "border-red-700 bg-red-950/20"
                            : "border-red-200 bg-red-50/60"
                          : urgency === "high"
                            ? isDark
                              ? "border-orange-700 bg-orange-950/20"
                              : "border-orange-200 bg-orange-50/60"
                            : isDark
                              ? "border-sky-700 bg-sky-950/20"
                              : "border-sky-200 bg-sky-50/60"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-base font-semibold ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                            {row.customerName}
                          </p>
                          <p className={`truncate text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            {row.customerPhone}
                          </p>
                        </div>
                        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
                          {urgencyLabel(urgency)}
                        </span>
                        <div className="shrink-0 text-right">
                          <p className={`text-2xl font-extrabold leading-none ${amountColorClass}`}>₹{formatMoney(row.dueAmount)}</p>
                          <p className={`mt-1 text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                            Bill #{row.billId} • {overdueDays}d old
                          </p>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)_auto] gap-1.5">
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
                          <option value="cash">Cash</option>
                          <option value="upi">UPI</option>
                          <option value="card">Card</option>
                        </select>
                        <input
                          ref={(el) => {
                            amountInputRefs.current[rowKey] = el;
                          }}
                          type="number"
                          min="0"
                          step="1"
                          value={dueReceiveAmounts[rowKey] ?? String(row.dueAmount)}
                          onChange={(e) =>
                            setDueReceiveAmounts((prev) => ({
                              ...prev,
                              [rowKey]: e.target.value,
                            }))
                          }
                          disabled={dueReceiveBusyKey === rowKey}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          placeholder="Amount"
                        />
                        <button
                          type="button"
                          onClick={() => void receiveDuePaymentByBill(row, nextKey)}
                          disabled={dueReceiveBusyKey === rowKey}
                          className="rounded bg-emerald-700 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {dueReceiveBusyKey === rowKey ? "Receiving..." : "Receive"}
                        </button>
                      </div>
                    </article>
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
