"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ActiveUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
};

type PaymentMode = "cash" | "upi" | "card" | "due";
type LedgerScope = "current" | "day" | "range";

type LedgerWindow = {
  scope: LedgerScope;
  key?: string | null;
  start: string | null;
  end: string | null;
};

type LedgerSummary = {
  subtotal: number;
  net: number;
  cash: number;
  upi: number;
  card: number;
  due: number;
  dueReceived: number;
  dueReceivedCash: number;
  dueReceivedUpi: number;
  dueReceivedCard: number;
  openingDueOutstanding: number;
  dueOutstanding: number;
  netReceivableChange: number;
  collectionTotal: number;
  unpaid: number;
  discount: number;
  total: number;
  paid: number;
  isBalanced: boolean;
  ltpCount: number;
  ltpValue: number;
  cancelledCount: number;
};

type LedgerSessionRow = {
  id: number;
  billId: number | null;
  businessDayKey: string | null;
  tableName: string;
  playerName: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  ratePerMin: number;
  amount: number;
  sessionDiscount: number;
  finalAmount: number;
  effectivePaid: number;
  paymentModes: string[];
  paymentSplit: Array<{
    mode: PaymentMode;
    amount: number;
  }>;
  state: "Running" | "Completed" | "Billed-Unpaid" | "Partially-Paid" | "Paid" | "Cancelled" | "LTP-Loss";
  payerMode: "none" | "single" | "split";
  payerData: unknown;
  overrideStartTime: string | null;
  overrideEndTime: string | null;
  overrideRatePerMin: number | null;
  overridePayerMode: "none" | "single" | "split" | null;
  overridePayerData: unknown;
  overrideStatus: "running" | "completed" | "billed" | null;
  overridePaymentModes: PaymentMode[] | null;
};

type TableAnalyticsRow = {
  tableId: number;
  tableName: string;
  runningMinutes: number;
  idleMinutes: number;
  utilizationPct: number;
  revenue: number;
  sessionCount: number;
};

type HourlyAnalyticsRow = {
  hour: number;
  label: string;
  runningMinutes: number;
  idleMinutes: number;
  capacityMinutes: number;
  utilizationPct: number;
  revenue: number;
  sessionCount: number;
};

type AnalyticsData = {
  window: {
    scope: string;
    key: string | null;
    startDate: string | null;
    endDate: string | null;
    start: string;
    end: string;
    totalMinutes: number;
    tableCount: number;
    reportDays: number;
  };
  overall: {
    totalRunningMinutes: number;
    totalIdleMinutes: number;
    totalCapacityMinutes: number;
    utilizationPct: number;
    revenue: number;
    dailyAverageRevenue: number;
  };
  tables: TableAnalyticsRow[];
  hourly: HourlyAnalyticsRow[];
  highlights: {
    bestRevenueHour: HourlyAnalyticsRow | null;
    slowestRevenueHour: HourlyAnalyticsRow | null;
    bestUtilizationHour: HourlyAnalyticsRow | null;
    slowestUtilizationHour: HourlyAnalyticsRow | null;
  };
  revenueSeries: {
    mode: "day" | "hour";
    points: Array<{
      label: string;
      revenue: number;
    }>;
  };
};

function formatMoney(value: number | null | undefined): string {
  const safe = typeof value === "number" ? value : 0;
  return String(Math.round(safe));
}

function formatDurationMinutes(totalMinutes: number | null | undefined): string {
  const safe = Math.max(Math.round(typeof totalMinutes === "number" ? totalMinutes : 0), 0);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatSignedMoney(value: number | null | undefined): string {
  const safe = Math.round(typeof value === "number" ? value : 0);
  if (safe > 0) {
    return `+₹${safe}`;
  }
  if (safe < 0) {
    return `-₹${Math.abs(safe)}`;
  }
  return "₹0";
}

function formatTime12h(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateTimeFull(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function formatRate(value: number | null | undefined, tableName?: string): string {
  const safe = typeof value === "number" ? value : 0;
  if ((tableName ?? "").toUpperCase().startsWith("PS")) {
    return `${formatMoney(safe * 60)}/hr`;
  }
  return `${formatMoney(safe)}/min`;
}

function hasSessionOverrides(row: LedgerSessionRow): boolean {
  return (
    row.overrideStartTime !== null ||
    row.overrideEndTime !== null ||
    row.overrideRatePerMin !== null ||
    row.overridePayerMode !== null ||
    row.overridePayerData !== null ||
    row.overrideStatus !== null ||
    row.overridePaymentModes !== null
  );
}

function ledgerStatusText(state: LedgerSessionRow["state"]): string {
  if (state === "LTP-Loss") {
    return "LTP Loss (No charge)";
  }
  if (state === "Cancelled") {
    return "✖ Cancelled";
  }
  if (state === "Billed-Unpaid") {
    return "⚠ Unpaid";
  }
  if (state === "Partially-Paid") {
    return "⏳ Partial";
  }
  if (state === "Paid") {
    return "✔ Paid";
  }
  return state;
}

function ledgerRowColor(state: LedgerSessionRow["state"]): string {
  if (state === "LTP-Loss") {
    return "bg-fuchsia-100 border-l-4 border-fuchsia-500";
  }
  if (state === "Cancelled") {
    return "bg-red-100 border-l-4 border-red-500";
  }
  if (state === "Running") {
    return "bg-yellow-100 border-l-4 border-yellow-500";
  }
  if (state === "Completed") {
    return "bg-blue-100 border-l-4 border-blue-500";
  }
  if (state === "Billed-Unpaid") {
    return "bg-orange-100 border-l-4 border-orange-500";
  }
  if (state === "Partially-Paid") {
    return "bg-orange-100 border-l-4 border-orange-500";
  }
  return "bg-green-100 border-l-4 border-green-600";
}

function todayDateInputValue(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateInputValue(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ReportsPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [ledgerScope, setLedgerScope] = useState<LedgerScope>("day");
  const [ledgerDate, setLedgerDate] = useState<string>(todayDateInputValue());
  const [ledgerStartDate, setLedgerStartDate] = useState<string>(todayDateInputValue());
  const [ledgerEndDate, setLedgerEndDate] = useState<string>(todayDateInputValue());
  const [rows, setRows] = useState<LedgerSessionRow[]>([]);
  const [summary, setSummary] = useState<LedgerSummary>({
    subtotal: 0,
    net: 0,
    cash: 0,
    upi: 0,
    card: 0,
    due: 0,
    dueReceived: 0,
    dueReceivedCash: 0,
    dueReceivedUpi: 0,
    dueReceivedCard: 0,
    openingDueOutstanding: 0,
    dueOutstanding: 0,
    netReceivableChange: 0,
    collectionTotal: 0,
    unpaid: 0,
    discount: 0,
    total: 0,
    paid: 0,
    isBalanced: true,
    ltpCount: 0,
    ltpValue: 0,
    cancelledCount: 0,
  });
  const [windowInfo, setWindowInfo] = useState<LedgerWindow>({
    scope: "day",
    key: null,
    start: null,
    end: null,
  });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string>("");
  const [splitViewSession, setSplitViewSession] = useState<LedgerSessionRow | null>(null);

  function authHeaders(): HeadersInit {
    if (!activeUserId) {
      return {};
    }
    return { "x-user-id": String(activeUserId) };
  }

  async function readJsonSafe<T>(res: Response): Promise<T | null> {
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async function loadReport() {
    if (!activeUserId) {
      return;
    }
    setError("");
    try {
      const params = new URLSearchParams({ scope: ledgerScope });
      if (ledgerScope === "day" && ledgerDate) {
        params.set("date", ledgerDate);
      }
      if (ledgerScope === "range") {
        params.set("startDate", ledgerStartDate);
        params.set("endDate", ledgerEndDate);
      }
      const query = params.toString();

      const [ledgerRes, analyticsRes] = await Promise.all([
        fetch(`/api/sessions/all?${query}`, {
          cache: "no-store",
          headers: authHeaders(),
        }),
        fetch(`/api/reports/analytics?${query}`, {
          cache: "no-store",
          headers: authHeaders(),
        }),
      ]);

      const ledgerData = await readJsonSafe<{ data?: LedgerSessionRow[]; summary?: LedgerSummary; window?: LedgerWindow; error?: string }>(ledgerRes);
      if (!ledgerRes.ok) {
        throw new Error(ledgerData?.error ?? "Failed to fetch reports");
      }

      const analyticsData = await readJsonSafe<{ data?: AnalyticsData; error?: string }>(analyticsRes);
      if (!analyticsRes.ok) {
        throw new Error(analyticsData?.error ?? "Failed to fetch analytics");
      }

      setRows(ledgerData?.data ?? []);
      if (ledgerData?.summary) {
        setSummary(ledgerData.summary);
      }
      if (ledgerData?.window) {
        setWindowInfo(ledgerData.window);
      }
      setAnalytics(analyticsData?.data ?? null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to fetch reports";
      setError(message);
      setRows([]);
      setAnalytics(null);
    }
  }

  function applyRangeFilter() {
    if (!ledgerStartDate || !ledgerEndDate || ledgerStartDate > ledgerEndDate) {
      setError("Start date must be before or equal to end date");
      return;
    }
    setLedgerScope("range");
  }

  function applyPresetFilter(
    preset: "thisWeek" | "thisMonth" | "lastMonth" | "last7Days",
  ) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(today);
    let end = new Date(today);

    if (preset === "thisWeek") {
      const day = today.getDay();
      const diffToMonday = (day + 6) % 7;
      start.setDate(today.getDate() - diffToMonday);
    } else if (preset === "thisMonth") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (preset === "lastMonth") {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (preset === "last7Days") {
      start.setDate(today.getDate() - 6);
    }

    setLedgerStartDate(formatDateInputValue(start));
    setLedgerEndDate(formatDateInputValue(end));
    setLedgerScope("range");
  }

  const sortedRows = useMemo(() => {
    const stateOrder: Record<LedgerSessionRow["state"], number> = {
      Running: 0,
      Completed: 1,
      "LTP-Loss": 2,
      Cancelled: 3,
      "Billed-Unpaid": 4,
      "Partially-Paid": 5,
      Paid: 6,
    };
    return [...rows].sort((a, b) => {
      const stateDiff = stateOrder[a.state] - stateOrder[b.state];
      if (stateDiff !== 0) {
        return stateDiff;
      }
      const billA = a.billId ?? -1;
      const billB = b.billId ?? -1;
      if (billA !== billB) {
        return billB - billA;
      }
      return b.id - a.id;
    });
  }, [rows]);

  const receivablePeriodLabel = ledgerScope === "range" ? "Selected Range" : "Today";
  const collectionTotalLabel = ledgerScope === "range"
    ? "Total Cash Collected (Selected Range)"
    : "Total Cash Collected Today";
  const dueRaisedLabel = ledgerScope === "range" ? "Due Raised (Selected Range)" : "Due Raised Today";
  const dueOutstandingLabel = ledgerScope === "range"
    ? "Due Outstanding (end of selected range)"
    : "Due Outstanding (end of day)";
  const receivableDeltaTone =
    summary.netReceivableChange > 0
      ? "text-red-700"
      : summary.netReceivableChange < 0
        ? "text-emerald-700"
        : "text-slate-800";
  const analyticsTopTable = analytics?.tables?.[0] ?? null;
  const analyticsWindow = analytics?.window ?? {
    scope: "day",
    key: null,
    startDate: null,
    endDate: null,
    start: null,
    end: null,
    totalMinutes: 0,
    tableCount: 0,
    reportDays: 1,
  };
  const analyticsOverall = analytics?.overall ?? {
    totalRunningMinutes: 0,
    totalIdleMinutes: 0,
    totalCapacityMinutes: 0,
    utilizationPct: 0,
    revenue: 0,
    dailyAverageRevenue: 0,
  };
  const analyticsHighlights = analytics?.highlights ?? {
    bestRevenueHour: null,
    slowestRevenueHour: null,
    bestUtilizationHour: null,
    slowestUtilizationHour: null,
  };
  const analyticsRevenueSeries = analytics?.revenueSeries ?? {
    mode: "hour" as const,
    points: [] as Array<{ label: string; revenue: number }>,
  };

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
    void loadReport();
  }, [activeUserId, ledgerScope, ledgerDate, ledgerStartDate, ledgerEndDate]);

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

  if (!activeUserId) {
    return (
      <main className={`reports-page min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">
            Please login on dashboard first to use Reports.
          </p>
          <Link href="/" className="mt-3 inline-block rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
            Go to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={`reports-page min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
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
            <Link href="/due-report" className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
              Due Report
            </Link>
            <Link href="/bills" className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
              Bills
            </Link>
          </div>
        </div>

        {error ? (
          <p className="mb-3 rounded-md bg-red-100 p-2 text-sm text-red-700">{error}</p>
        ) : null}

        <section className="report-shell rounded-xl border border-slate-300 bg-white p-4 shadow-md">
          <h2 className="text-lg font-semibold text-slate-900">Session Ledger Reports</h2>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLedgerScope("day")}
              className={`rounded-md px-3 py-1 text-xs font-medium ${ledgerScope === "day" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"}`}
            >
              Previous By Date
            </button>
            <button
              type="button"
              onClick={() => setLedgerScope("range")}
              className={`rounded-md px-3 py-1 text-xs font-medium ${ledgerScope === "range" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"}`}
            >
              Date Range
            </button>
            <button
              type="button"
              onClick={() => setLedgerScope("current")}
              className={`rounded-md px-3 py-1 text-xs font-medium ${ledgerScope === "current" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"}`}
            >
              Current (10 AM reset)
            </button>
          </div>

          {ledgerScope === "day" ? (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <label className="text-slate-700">Business Date</label>
              <input
                type="date"
                value={ledgerDate}
                onChange={(e) => setLedgerDate(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
          ) : null}

          {ledgerScope === "range" ? (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <p className="text-[11px] font-semibold text-slate-700">Date Range Filter</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={ledgerStartDate}
                  onChange={(e) => setLedgerStartDate(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <span className="text-xs text-slate-500">to</span>
                <input
                  type="date"
                  value={ledgerEndDate}
                  onChange={(e) => setLedgerEndDate(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={applyRangeFilter}
                  className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-900"
                >
                  Apply
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => applyPresetFilter("thisWeek")} className="rounded-md bg-slate-200 px-2 py-1 text-[11px] text-slate-800 hover:bg-slate-300">This Week</button>
                <button type="button" onClick={() => applyPresetFilter("thisMonth")} className="rounded-md bg-slate-200 px-2 py-1 text-[11px] text-slate-800 hover:bg-slate-300">This Month</button>
                <button type="button" onClick={() => applyPresetFilter("lastMonth")} className="rounded-md bg-slate-200 px-2 py-1 text-[11px] text-slate-800 hover:bg-slate-300">Last Month</button>
                <button type="button" onClick={() => applyPresetFilter("last7Days")} className="rounded-md bg-slate-200 px-2 py-1 text-[11px] text-slate-800 hover:bg-slate-300">Last 7 Days</button>
              </div>
            </div>
          ) : null}

          <p className="report-window-pill mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
            {ledgerScope === "current"
              ? `Business day: ${formatDateTimeFull(windowInfo.start)} to ${formatDateTimeFull(windowInfo.end)}`
              : ledgerScope === "day"
                ? `Business day ${windowInfo.key ?? ledgerDate}: ${formatDateTimeFull(windowInfo.start)} to ${formatDateTimeFull(windowInfo.end)}`
                : `Filtered range: ${ledgerStartDate} to ${ledgerEndDate}`}
          </p>

          <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
            <div className="report-card report-card-performance rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">Business Performance</p>
              <div className="space-y-1.5 text-slate-800">
                <p className="flex items-center justify-between"><span>Session Subtotal</span><span className="font-medium">₹{formatMoney(summary.subtotal)}</span></p>
                <p className="flex items-center justify-between"><span>Discount</span><span className="font-medium">₹{formatMoney(summary.discount)}</span></p>
                <p className="flex items-center justify-between border-t border-amber-200 pt-1.5 text-sm font-semibold text-amber-900"><span>Net Session Revenue</span><span>₹{formatMoney(summary.net)}</span></p>
                <p className="flex items-center justify-between"><span>LTP Sessions</span><span className="font-medium">{summary.ltpCount}</span></p>
                <p className="flex items-center justify-between"><span>LTP Value</span><span className="font-medium">₹{formatMoney(summary.ltpValue)}</span></p>
                <p className="flex items-center justify-between"><span>Cancelled Sessions</span><span className="font-medium">{summary.cancelledCount}</span></p>
              </div>
            </div>
            <div className="report-card report-card-cash rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-800">Cash Movement</p>
              <div className="space-y-1.5 text-slate-800">
                <p className="flex items-center justify-between"><span>Cash In</span><span className="font-medium">₹{formatMoney(summary.cash)}</span></p>
                <p className="flex items-center justify-between"><span>UPI In</span><span className="font-medium">₹{formatMoney(summary.upi)}</span></p>
                <p className="flex items-center justify-between"><span>Card In</span><span className="font-medium">₹{formatMoney(summary.card)}</span></p>
                <p className="flex items-center justify-between border-t border-slate-300 pt-1.5 text-sm font-semibold text-slate-900"><span>{collectionTotalLabel}</span><span>₹{formatMoney(summary.collectionTotal)}</span></p>
                <p className="flex items-center justify-between text-[11px] text-slate-600"><span>Included: Old Due Recovery</span><span className="font-medium">₹{formatMoney(summary.dueReceived)}</span></p>
              </div>
            </div>
            <div className="report-card report-card-receivables rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-900">Receivables</p>
              <div className="space-y-1.5 text-slate-800">
                <p className="flex items-center justify-between"><span>Opening Due (start of period)</span><span className="font-medium">₹{formatMoney(summary.openingDueOutstanding)}</span></p>
                <p className="flex items-center justify-between"><span>{dueRaisedLabel}</span><span className="font-medium">₹{formatMoney(summary.due)}</span></p>
                <p className="flex items-center justify-between"><span>{dueOutstandingLabel}</span><span className="font-medium">₹{formatMoney(summary.dueOutstanding)}</span></p>
                <p className={`flex items-center justify-between border-t border-indigo-200 pt-1.5 text-sm font-semibold ${receivableDeltaTone}`}><span>Net Receivable Change ({receivablePeriodLabel})</span><span>{formatSignedMoney(summary.netReceivableChange)}</span></p>
              </div>
            </div>
          </div>

          <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-800">Table Analytics</p>
              {analytics?.window ? (
                <p className="text-[11px] text-slate-600">
                  {formatDateTimeFull(analyticsWindow.start)} to {formatDateTimeFull(analyticsWindow.end)}
                </p>
              ) : null}
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[11px] text-slate-500">Total Running Time</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {formatDurationMinutes(analyticsOverall.totalRunningMinutes)}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[11px] text-slate-500">Total Idle Time</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {formatDurationMinutes(analyticsOverall.totalIdleMinutes)}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[11px] text-slate-500">Overall Utilization</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {`${analyticsOverall.utilizationPct}%`}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[11px] text-slate-500">Table Revenue (Gross)</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">₹{formatMoney(analyticsOverall.revenue)}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[11px] text-slate-500">Daily Avg Revenue</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">₹{formatMoney(analyticsOverall.dailyAverageRevenue)}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Based on {analyticsWindow.reportDays} day(s)
                </p>
              </div>
            </div>

            <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
              <p className="text-[11px] font-semibold text-slate-800">
                Revenue Trend ({analyticsRevenueSeries.mode === "day" ? "Day-wise" : "Hour-wise"})
              </p>
              {analyticsRevenueSeries.mode === "hour" ? (
                <p className="mt-0.5 text-[10px] text-slate-500">Note: 08-11 is combined (cafe closed).</p>
              ) : null}
              <div className="mt-2 overflow-x-auto">
                <div className="flex min-h-[160px] min-w-max items-end gap-2">
                  {(() => {
                    const points = analyticsRevenueSeries.points;
                    const maxRevenue = Math.max(...points.map((point) => point.revenue), 1);
                    return points.map((point) => {
                      const barHeight = Math.max(Math.round((point.revenue / maxRevenue) * 110), 6);
                      return (
                        <div key={`${point.label}-${point.revenue}`} className="flex w-11 flex-col items-center">
                          <p className="mb-1 text-[10px] font-medium text-slate-700">₹{formatMoney(point.revenue)}</p>
                          <div
                            className="w-8 rounded-t bg-indigo-500"
                            style={{ height: `${barHeight}px` }}
                            title={`${point.label}: ₹${formatMoney(point.revenue)}`}
                          />
                          <p className="mt-1 text-[10px] text-slate-600">{point.label}</p>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                <p className="text-[11px] font-semibold text-emerald-900">Best Hours</p>
                <p className="mt-1 text-[11px] text-emerald-900">
                  Revenue: {analyticsHighlights.bestRevenueHour?.label ?? "-"} (₹{formatMoney(analyticsHighlights.bestRevenueHour?.revenue)})
                </p>
                <p className="text-[11px] text-emerald-900">
                  Utilization: {analyticsHighlights.bestUtilizationHour?.label ?? "-"} ({analyticsHighlights.bestUtilizationHour?.utilizationPct ?? 0}%)
                </p>
              </div>
              <div className="rounded-md border border-rose-200 bg-rose-50 p-2">
                <p className="text-[11px] font-semibold text-rose-900">Slowest Hours</p>
                <p className="mt-1 text-[11px] text-rose-900">
                  Revenue: {analyticsHighlights.slowestRevenueHour?.label ?? "-"} (₹{formatMoney(analyticsHighlights.slowestRevenueHour?.revenue)})
                </p>
                <p className="text-[11px] text-rose-900">
                  Utilization: {analyticsHighlights.slowestUtilizationHour?.label ?? "-"} ({analyticsHighlights.slowestUtilizationHour?.utilizationPct ?? 0}%)
                </p>
              </div>
            </div>

            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <div className="max-h-56 overflow-auto rounded-md border border-slate-200 bg-white">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2 py-1.5">Table</th>
                      <th className="px-2 py-1.5">Run</th>
                      <th className="px-2 py-1.5">Idle</th>
                      <th className="px-2 py-1.5">Util</th>
                      <th className="px-2 py-1.5">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics?.tables ?? []).map((table) => (
                      <tr key={table.tableId} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-900">{table.tableName}</td>
                        <td className="px-2 py-1.5 text-slate-700">{formatDurationMinutes(table.runningMinutes)}</td>
                        <td className="px-2 py-1.5 text-slate-700">{formatDurationMinutes(table.idleMinutes)}</td>
                        <td className="px-2 py-1.5 text-slate-700">{table.utilizationPct}%</td>
                        <td className="px-2 py-1.5 text-slate-700">₹{formatMoney(table.revenue)}</td>
                      </tr>
                    ))}
                    {(analytics?.tables ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-2 py-2 text-slate-500">No table analytics in this timeframe</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="max-h-56 overflow-auto rounded-md border border-slate-200 bg-white">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2 py-1.5">Hour</th>
                      <th className="px-2 py-1.5">Run</th>
                      <th className="px-2 py-1.5">Util</th>
                      <th className="px-2 py-1.5">Revenue</th>
                      <th className="px-2 py-1.5">Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics?.hourly ?? []).map((hour) => (
                      <tr key={hour.hour} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-900">{hour.label}</td>
                        <td className="px-2 py-1.5 text-slate-700">{formatDurationMinutes(hour.runningMinutes)}</td>
                        <td className="px-2 py-1.5 text-slate-700">{hour.utilizationPct}%</td>
                        <td className="px-2 py-1.5 text-slate-700">₹{formatMoney(hour.revenue)}</td>
                        <td className="px-2 py-1.5 text-slate-700">{hour.sessionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {analyticsTopTable ? (
              <p className="mt-2 text-[11px] text-slate-600">
                Top table for selected window: <span className="font-semibold text-slate-800">{analyticsTopTable.tableName}</span>
                {" "}with ₹{formatMoney(analyticsTopTable.revenue)} revenue and {analyticsTopTable.utilizationPct}% utilization.
              </p>
            ) : null}
          </section>

          <div className="mt-3 max-h-[520px] overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-2 py-2">Bill</th>
                  <th className="px-2 py-2">Table</th>
                  <th className="px-2 py-2">Player</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Start</th>
                  <th className="px-2 py-2">End</th>
                  <th className="px-2 py-2">Duration</th>
                  <th className="px-2 py-2">Rate</th>
                  <th className="px-2 py-2">Amount</th>
                  <th className="px-2 py-2">Paid</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Mode</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr
                    key={row.id}
                    className={`${ledgerRowColor(row.state)} ${hasSessionOverrides(row) ? "ring-1 ring-inset ring-indigo-200" : ""}`}
                  >
                    <td className="px-2 py-2">{row.billId ? `Bill #${row.billId}` : "-"}</td>
                    <td className="px-2 py-2">{row.tableName}</td>
                    <td className="px-2 py-2">{row.playerName}</td>
                    <td className="px-2 py-2">{row.businessDayKey ?? "-"}</td>
                    <td className="px-2 py-2">{formatTime12h(row.startTime)}</td>
                    <td className="px-2 py-2">{formatTime12h(row.endTime)}</td>
                    <td className="px-2 py-2">{row.durationMinutes} min</td>
                    <td className="px-2 py-2">{formatRate(row.ratePerMin, row.tableName)}</td>
                    <td className="px-2 py-2">₹{formatMoney(row.amount)}</td>
                    <td className="px-2 py-2">₹{formatMoney(row.effectivePaid)}</td>
                    <td className="px-2 py-2">{ledgerStatusText(row.state)}</td>
                    <td className="px-2 py-2">
                      <span>{row.paymentModes.length > 0 ? row.paymentModes.join(", ") : "-"}</span>
                      {row.paymentSplit.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setSplitViewSession(row)}
                          title="View split"
                          aria-label="View split"
                          className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                          >
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {sortedRows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-slate-500" colSpan={12}>
                      No sessions in report
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {splitViewSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Payment Split - Session #{splitViewSession.id}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              {splitViewSession.billId ? `Bill #${splitViewSession.billId}` : "No bill linked"}
            </p>
            <div className="mt-3">
              {splitViewSession.paymentSplit.length === 0 ? (
                <p className="text-sm text-slate-600">No split payments found.</p>
              ) : (
                <ul className="space-y-1 text-sm text-slate-800">
                  {splitViewSession.paymentSplit.map((entry) => (
                    <li
                      key={`${entry.mode}-${entry.amount}`}
                      className="flex items-center justify-between rounded border border-slate-200 px-2 py-1"
                    >
                      <span className="uppercase">{entry.mode}</span>
                      <span>₹{formatMoney(entry.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSplitViewSession(null)}
                className="rounded-md bg-slate-200 px-3 py-2 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
