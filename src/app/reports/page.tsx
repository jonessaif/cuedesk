"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { isNativeServerSetupAvailable, openNativeServerSetup } from "@/lib/native-server-setup";

type ActiveUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
};

type PaymentMode = "cash" | "upi" | "card" | "due";
type LedgerScope = "current" | "day" | "range";
type ReportsTab = "ledger" | "analytics";
type ChartMode = "auto" | "day" | "hour";
type SettingsTarget = "global" | "table";
type ChartSettingsKey = "revenueSeries" | "tablePerformance" | "hourlyBreakdown";

type MergeBucket = {
  startHour: number;
  endHour: number;
  label: string;
};

type ReportChartSettings = {
  target: SettingsTarget;
  tableId: number | null;
  chartMode: ChartMode;
  mergeBuckets: MergeBucket[];
  includeClosed: boolean;
  updatedAt: string | null;
};

type ReportChartSettingsBundle = {
  global: ReportChartSettings;
  table: ReportChartSettings | null;
  effective: ReportChartSettings;
};

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
  settings?: ReportChartSettingsBundle;
};

type TableOption = {
  id: number;
  name: string;
};

type MetricTrend = {
  direction: "up" | "down" | "flat";
  delta: number;
  deltaPct: number | null;
  isBetter: boolean;
};

type SettingsDraft = {
  target: SettingsTarget;
  chartMode: ChartMode;
  includeClosed: boolean;
  mergeBuckets: MergeBucket[];
};

type ChartPreferences = {
  revenueSeries: {
    showValueLabels: boolean;
    barColor: string;
    minBarHeight: number;
  };
  tablePerformance: {
    sortBy: "revenue" | "utilizationPct";
    showCumulativeLine: boolean;
    primaryColor: string;
    secondaryColor: string;
  };
  hourlyBreakdown: {
    metric: "revenue" | "utilizationPct" | "runningMinutes";
    showTopLabel: boolean;
    hideZeroValues: boolean;
    barColor: string;
  };
};

const DEFAULT_MERGE_BUCKETS: MergeBucket[] = [{ startHour: 8, endHour: 11, label: "08-11" }];
const DEFAULT_CHART_PREFERENCES: ChartPreferences = {
  revenueSeries: {
    showValueLabels: true,
    barColor: "#6366f1",
    minBarHeight: 6,
  },
  tablePerformance: {
    sortBy: "revenue",
    showCumulativeLine: true,
    primaryColor: "#4f46e5",
    secondaryColor: "#059669",
  },
  hourlyBreakdown: {
    metric: "revenue",
    showTopLabel: true,
    hideZeroValues: false,
    barColor: "#10b981",
  },
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function sanitizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function hydrateChartPreferences(raw: unknown): ChartPreferences {
  const src = raw as Partial<ChartPreferences> | null | undefined;

  const revenue = src?.revenueSeries;
  const table = src?.tablePerformance;
  const hourly = src?.hourlyBreakdown;

  return {
    revenueSeries: {
      showValueLabels: typeof revenue?.showValueLabels === "boolean" ? revenue.showValueLabels : DEFAULT_CHART_PREFERENCES.revenueSeries.showValueLabels,
      barColor: sanitizeHexColor(String(revenue?.barColor ?? ""), DEFAULT_CHART_PREFERENCES.revenueSeries.barColor),
      minBarHeight: clampNumber(Number(revenue?.minBarHeight), 2, 24),
    },
    tablePerformance: {
      sortBy: table?.sortBy === "utilizationPct" ? "utilizationPct" : "revenue",
      showCumulativeLine: typeof table?.showCumulativeLine === "boolean" ? table.showCumulativeLine : DEFAULT_CHART_PREFERENCES.tablePerformance.showCumulativeLine,
      primaryColor: sanitizeHexColor(String(table?.primaryColor ?? ""), DEFAULT_CHART_PREFERENCES.tablePerformance.primaryColor),
      secondaryColor: sanitizeHexColor(String(table?.secondaryColor ?? ""), DEFAULT_CHART_PREFERENCES.tablePerformance.secondaryColor),
    },
    hourlyBreakdown: {
      metric: hourly?.metric === "utilizationPct" || hourly?.metric === "runningMinutes" ? hourly.metric : "revenue",
      showTopLabel: typeof hourly?.showTopLabel === "boolean" ? hourly.showTopLabel : DEFAULT_CHART_PREFERENCES.hourlyBreakdown.showTopLabel,
      hideZeroValues: typeof hourly?.hideZeroValues === "boolean" ? hourly.hideZeroValues : DEFAULT_CHART_PREFERENCES.hourlyBreakdown.hideZeroValues,
      barColor: sanitizeHexColor(String(hourly?.barColor ?? ""), DEFAULT_CHART_PREFERENCES.hourlyBreakdown.barColor),
    },
  };
}

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

function calculateMetricTrend(current: number, previous: number, higherIsBetter: boolean): MetricTrend {
  const delta = current - previous;
  if (Math.abs(delta) < 0.0001) {
    return {
      direction: "flat",
      delta: 0,
      deltaPct: 0,
      isBetter: false,
    };
  }
  const direction = delta > 0 ? "up" : "down";
  const deltaPct = Math.abs(previous) < 0.0001 ? null : (delta / previous) * 100;
  const isBetter = higherIsBetter ? direction === "up" : direction === "down";
  return {
    direction,
    delta,
    deltaPct,
    isBetter,
  };
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

function normalizeMergeBucket(row: MergeBucket): MergeBucket {
  const startHour = Number.isFinite(row.startHour) ? Math.min(Math.max(Math.round(row.startHour), 0), 23) : 0;
  const endHour = Number.isFinite(row.endHour) ? Math.min(Math.max(Math.round(row.endHour), 0), 23) : 0;
  const orderedStart = Math.min(startHour, endHour);
  const orderedEnd = Math.max(startHour, endHour);
  const fallbackLabel = `${String(orderedStart).padStart(2, "0")}-${String(orderedEnd).padStart(2, "0")}`;
  const label = row.label.trim() || fallbackLabel;
  return { startHour: orderedStart, endHour: orderedEnd, label: label.slice(0, 24) };
}

function normalizeMergeBuckets(rows: MergeBucket[]): MergeBucket[] {
  const normalized = rows.map(normalizeMergeBucket).sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  const deduped: MergeBucket[] = [];
  for (const row of normalized) {
    if (!deduped.find((entry) => entry.startHour === row.startHour && entry.endHour === row.endHour && entry.label === row.label)) {
      deduped.push(row);
    }
  }
  return deduped;
}

export default function ReportsPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<ReportsTab>("ledger");

  const [ledgerScope, setLedgerScope] = useState<LedgerScope>("day");
  const [ledgerDate, setLedgerDate] = useState<string>(todayDateInputValue());
  const [ledgerStartDate, setLedgerStartDate] = useState<string>(todayDateInputValue());
  const [ledgerEndDate, setLedgerEndDate] = useState<string>(todayDateInputValue());

  const [analyticsTableId, setAnalyticsTableId] = useState<string>("all");
  const [tableDetailsView, setTableDetailsView] = useState<"table" | "chart">("chart");
  const [hourlyDetailsView, setHourlyDetailsView] = useState<"table" | "chart">("chart");
  const [chartSettingsFor, setChartSettingsFor] = useState<ChartSettingsKey | null>(null);
  const [chartPreferences, setChartPreferences] = useState<ChartPreferences>(DEFAULT_CHART_PREFERENCES);
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);

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
  const [previousAnalytics, setPreviousAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string>("");
  const [splitViewSession, setSplitViewSession] = useState<LedgerSessionRow | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    target: "global",
    chartMode: "auto",
    includeClosed: true,
    mergeBuckets: [...DEFAULT_MERGE_BUCKETS],
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

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

  function buildBaseParams(): URLSearchParams {
    const params = new URLSearchParams({ scope: ledgerScope });
    if (ledgerScope === "day" && ledgerDate) {
      params.set("date", ledgerDate);
    }
    if (ledgerScope === "range") {
      params.set("startDate", ledgerStartDate);
      params.set("endDate", ledgerEndDate);
    }
    return params;
  }

  async function loadTables() {
    if (!activeUserId) {
      return;
    }
    try {
      const res = await fetch("/api/tables", {
        cache: "no-store",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ data?: Array<{ id?: number; name?: string }>; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to load tables");
      }
      const nextOptions = (data?.data ?? [])
        .filter((row): row is { id: number; name: string } => typeof row.id === "number" && typeof row.name === "string")
        .map((row) => ({ id: row.id, name: row.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTableOptions(nextOptions);
      if (analyticsTableId !== "all" && !nextOptions.find((row) => String(row.id) === analyticsTableId)) {
        setAnalyticsTableId("all");
      }
    } catch {
      setTableOptions([]);
    }
  }

  async function loadReport() {
    if (!activeUserId) {
      return;
    }
    setError("");
    try {
      const baseParams = buildBaseParams();
      const ledgerQuery = baseParams.toString();
      const analyticsParams = new URLSearchParams(baseParams);
      if (analyticsTableId !== "all") {
        analyticsParams.set("tableId", analyticsTableId);
      }
      const analyticsQuery = analyticsParams.toString();

      const [ledgerRes, analyticsRes] = await Promise.all([
        fetch(`/api/sessions/all?${ledgerQuery}`, {
          cache: "no-store",
          headers: authHeaders(),
        }),
        fetch(`/api/reports/analytics?${analyticsQuery}`, {
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

      const currentAnalytics = analyticsData?.data ?? null;
      let previousAnalyticsData: AnalyticsData | null = null;

      if (currentAnalytics?.window?.start && currentAnalytics?.window?.end) {
        const currentStartMs = new Date(currentAnalytics.window.start).getTime();
        const currentEndMs = new Date(currentAnalytics.window.end).getTime();
        const windowDurationMs = currentEndMs - currentStartMs;
        if (Number.isFinite(windowDurationMs) && windowDurationMs > 0) {
          const previousStart = new Date(currentStartMs - windowDurationMs);
          const previousEnd = new Date(currentStartMs);
          const previousParams = new URLSearchParams({
            startAt: previousStart.toISOString(),
            endAt: previousEnd.toISOString(),
          });
          if (analyticsTableId !== "all") {
            previousParams.set("tableId", analyticsTableId);
          }

          try {
            const previousRes = await fetch(`/api/reports/analytics?${previousParams.toString()}`, {
              cache: "no-store",
              headers: authHeaders(),
            });
            const previousData = await readJsonSafe<{ data?: AnalyticsData }>(previousRes);
            if (previousRes.ok) {
              previousAnalyticsData = previousData?.data ?? null;
            }
          } catch {
            previousAnalyticsData = null;
          }
        }
      }

      setRows(ledgerData?.data ?? []);
      if (ledgerData?.summary) {
        setSummary(ledgerData.summary);
      }
      if (ledgerData?.window) {
        setWindowInfo(ledgerData.window);
      }
      setAnalytics(currentAnalytics);
      setPreviousAnalytics(previousAnalyticsData);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to fetch reports";
      setError(message);
      setRows([]);
      setAnalytics(null);
      setPreviousAnalytics(null);
    }
  }

  function applyRangeFilter() {
    if (!ledgerStartDate || !ledgerEndDate || ledgerStartDate > ledgerEndDate) {
      setError("Start date must be before or equal to end date");
      return;
    }
    setLedgerScope("range");
  }

  function applyPresetFilter(preset: "thisWeek" | "thisMonth" | "lastMonth" | "last7Days") {
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
  const collectionTotalLabel = ledgerScope === "range" ? "Total Cash Collected (Selected Range)" : "Total Cash Collected Today";
  const dueRaisedLabel = ledgerScope === "range" ? "Due Raised (Selected Range)" : "Due Raised Today";
  const dueOutstandingLabel = ledgerScope === "range" ? "Due Outstanding (end of selected range)" : "Due Outstanding (end of day)";
  const receivableDeltaTone = summary.netReceivableChange > 0 ? "text-red-700" : summary.netReceivableChange < 0 ? "text-emerald-700" : "text-slate-800";

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

  const isAllTablesAnalytics = analyticsTableId === "all";
  const selectedTableOption = tableOptions.find((row) => String(row.id) === analyticsTableId) ?? null;
  const effectiveSettings = analytics?.settings?.effective ?? null;
  const mergeBucketLabels = effectiveSettings?.mergeBuckets?.map((row) => row.label).join(", ") ?? "-";
  const trendPeriodDays = Math.max(1, Math.round(analyticsWindow.reportDays || 1));
  const trendPeriodLabel = `${trendPeriodDays} day${trendPeriodDays === 1 ? "" : "s"}`;
  const previousAnalyticsOverall = previousAnalytics?.overall ?? null;
  const previousAnalyticsWindow = previousAnalytics?.window ?? null;
  const currentIdlePerTablePerDayMinutes =
    analyticsWindow.tableCount > 0 && analyticsWindow.reportDays > 0
      ? analyticsOverall.totalIdleMinutes / (analyticsWindow.tableCount * analyticsWindow.reportDays)
      : 0;
  const previousIdlePerTablePerDayMinutes =
    previousAnalyticsOverall && previousAnalyticsWindow && previousAnalyticsWindow.tableCount > 0 && previousAnalyticsWindow.reportDays > 0
      ? previousAnalyticsOverall.totalIdleMinutes / (previousAnalyticsWindow.tableCount * previousAnalyticsWindow.reportDays)
      : null;
  const runningTrend = previousAnalyticsOverall
    ? calculateMetricTrend(analyticsOverall.totalRunningMinutes, previousAnalyticsOverall.totalRunningMinutes, true)
    : null;
  const idleTrend = previousIdlePerTablePerDayMinutes !== null
    ? calculateMetricTrend(currentIdlePerTablePerDayMinutes, previousIdlePerTablePerDayMinutes, false)
    : null;
  const utilizationTrend = previousAnalyticsOverall
    ? calculateMetricTrend(analyticsOverall.utilizationPct, previousAnalyticsOverall.utilizationPct, true)
    : null;
  const revenueTrend = previousAnalyticsOverall
    ? calculateMetricTrend(analyticsOverall.revenue, previousAnalyticsOverall.revenue, true)
    : null;
  const dailyAverageTrend = previousAnalyticsOverall
    ? calculateMetricTrend(analyticsOverall.dailyAverageRevenue, previousAnalyticsOverall.dailyAverageRevenue, true)
    : null;

  function trendTone(trend: MetricTrend | null): {
    icon: string;
    textClass: string;
    pillClass: string;
  } {
    if (!trend || trend.direction === "flat") {
      return {
        icon: "→",
        textClass: "text-slate-600",
        pillClass: "border border-slate-300 bg-white text-slate-700 shadow-sm",
      };
    }
    if (trend.isBetter) {
      return {
        icon: trend.direction === "up" ? "↑" : "↓",
        textClass: "text-emerald-700",
        pillClass: "border border-emerald-700 bg-emerald-600 text-white shadow-md",
      };
    }
    return {
      icon: trend.direction === "up" ? "↑" : "↓",
      textClass: "text-rose-700",
      pillClass: "border border-rose-700 bg-rose-600 text-white shadow-md",
    };
  }

  function formatTrendPercent(trend: MetricTrend | null): string {
    if (!trend || trend.deltaPct === null) {
      return "--";
    }
    return `${Math.round(Math.abs(trend.deltaPct) * 10) / 10}%`;
  }

  function getSettingsSource(target: SettingsTarget): ReportChartSettings | null {
    if (!analytics?.settings) {
      return null;
    }
    if (target === "global") {
      return analytics.settings.global;
    }
    return analytics.settings.table ?? null;
  }

  function hydrateDraftFromTarget(target: SettingsTarget): SettingsDraft {
    const source = getSettingsSource(target) ?? (target === "table" ? analytics?.settings?.global ?? null : null);
    if (!source) {
      return {
        target,
        chartMode: "auto",
        includeClosed: true,
        mergeBuckets: [...DEFAULT_MERGE_BUCKETS],
      };
    }

    return {
      target,
      chartMode: source.chartMode,
      includeClosed: source.includeClosed,
      mergeBuckets: source.mergeBuckets.length > 0 ? [...source.mergeBuckets] : [...DEFAULT_MERGE_BUCKETS],
    };
  }

  function openSettingsModal(initialTarget: SettingsTarget) {
    if (initialTarget === "table" && analyticsTableId === "all") {
      setError("Select a table first to configure table-level chart settings");
      return;
    }
    setError("");
    setSettingsDraft(hydrateDraftFromTarget(initialTarget));
    setSettingsOpen(true);
  }

  function addMergeBucket() {
    setSettingsDraft((prev) => ({
      ...prev,
      mergeBuckets: [
        ...prev.mergeBuckets,
        { startHour: 0, endHour: 0, label: "00-00" },
      ],
    }));
  }

  function updateMergeBucket(index: number, patch: Partial<MergeBucket>) {
    setSettingsDraft((prev) => ({
      ...prev,
      mergeBuckets: prev.mergeBuckets.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }));
  }

  function removeMergeBucket(index: number) {
    setSettingsDraft((prev) => ({
      ...prev,
      mergeBuckets: prev.mergeBuckets.filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  async function saveSettings() {
    if (!activeUserId) {
      return;
    }
    if (settingsDraft.target === "table" && analyticsTableId === "all") {
      setError("Select a table first to configure table-level chart settings");
      return;
    }

    setSettingsSaving(true);
    setError("");

    try {
      const mergeBuckets = normalizeMergeBuckets(settingsDraft.mergeBuckets);
      const body: {
        target: SettingsTarget;
        tableId?: number;
        chartMode: ChartMode;
        includeClosed: boolean;
        mergeBuckets: MergeBucket[];
      } = {
        target: settingsDraft.target,
        chartMode: settingsDraft.chartMode,
        includeClosed: settingsDraft.includeClosed,
        mergeBuckets,
      };
      if (settingsDraft.target === "table") {
        body.tableId = Number(analyticsTableId);
      }

      const res = await fetch("/api/reports/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(body),
      });

      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to save report chart settings");
      }

      setSettingsOpen(false);
      await loadReport();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save report chart settings";
      setError(message);
    } finally {
      setSettingsSaving(false);
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
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem("cuedesk-reports-chart-preferences");
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      setChartPreferences(hydrateChartPreferences(parsed));
    } catch {
      // ignore malformed cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("cuedesk-reports-chart-preferences", JSON.stringify(chartPreferences));
  }, [chartPreferences]);

  useEffect(() => {
    if (!activeUserId) {
      return;
    }
    void loadTables();
  }, [activeUserId]);

  useEffect(() => {
    if (!activeUserId) {
      return;
    }
    void loadReport();
  }, [activeUserId, ledgerScope, ledgerDate, ledgerStartDate, ledgerEndDate, analyticsTableId]);

  useEffect(() => {
    if (activeTab === "analytics") {
      setTableDetailsView("chart");
      setHourlyDetailsView("chart");
    }
  }, [activeTab]);

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

  function renderChartSettingsButton(target: ChartSettingsKey, label: string) {
    return (
      <button
        type="button"
        onClick={() => setChartSettingsFor(target)}
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        title={label}
        aria-label={label}
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
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V22a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
    );
  }

  const darkEnabled = themeReady && isDark;
  const showNativeServerButton = themeReady && isNativeServerSetupAvailable();

  if (!activeUserId) {
    return (
      <main className={`reports-page min-h-screen bg-slate-100 p-4 sm:p-6 ${darkEnabled ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">Please login on dashboard first to use Reports.</p>
          <Link href="/" className="mt-3 inline-block rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
            Go to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={`reports-page min-h-screen bg-slate-100 p-4 sm:p-6 ${darkEnabled ? "theme-dark" : ""}`}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Reports"
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
              href: "/due-report",
              label: "Due Report",
              className: "rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900",
            },
            {
              href: "/bills",
              label: "Bills",
              className: "rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700",
            },
            {
              href: "/reports/customers",
              label: "Customers",
              className: "rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700",
            },
            {
              href: "/reports/daily-closing",
              label: "Daily Closing",
              className: "rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800",
            },
            {
              href: "/reports/expenses",
              label: "Expenses",
              className: "rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800",
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
          themeLabel={themeReady ? (isDark ? "Light Theme" : "Dark Theme") : "Theme"}
          isDark={isDark}
        />

        {error ? <p className="mb-3 rounded-md bg-red-100 p-2 text-sm text-red-700">{error}</p> : null}

        <section className="report-shell rounded-xl border border-slate-300 bg-white p-4 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Session Ledger & Analytics</h2>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("ledger")}
                className={`rounded-md px-3 py-1 text-xs font-medium ${activeTab === "ledger" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}
              >
                Ledger
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("analytics")}
                className={`rounded-md px-3 py-1 text-xs font-medium ${activeTab === "analytics" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}
              >
                Analytics
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
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

          {activeTab === "ledger" ? (
            <>
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
            </>
          ) : (
            <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[11px] font-semibold text-slate-700">
                    Table View
                    <select
                      value={analyticsTableId}
                      onChange={(e) => setAnalyticsTableId(e.target.value)}
                      className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="all">All Tables</option>
                      {tableOptions.map((table) => (
                        <option key={table.id} value={String(table.id)}>
                          {table.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
                    Chart:{" "}
                    <span className="font-semibold">
                      {(effectiveSettings?.chartMode ?? analyticsRevenueSeries.mode) === "hour" ? "Hourly" : "Daily"}
                    </span>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
                    Show empty hours: <span className="font-semibold">{effectiveSettings?.includeClosed ? "On" : "Off"}</span>
                  </div>
                </div>

                {activeUser?.role === "admin" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openSettingsModal("global")}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                    >
                      Global Chart Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => openSettingsModal("table")}
                      disabled={analyticsTableId === "all"}
                      className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                    >
                      Table Chart Settings
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                <p>
                  {formatDateTimeFull(analyticsWindow.start)} to {formatDateTimeFull(analyticsWindow.end)}
                </p>
                {selectedTableOption ? <p>Filtered table: <span className="font-semibold text-slate-800">{selectedTableOption.name}</span></p> : null}
                {analyticsRevenueSeries.mode === "hour" ? (
                  <p>Merged slots: <span className="font-semibold text-slate-800">{mergeBucketLabels}</span></p>
                ) : null}
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {(() => {
                  const cards: Array<{
                    key: string;
                    label: string;
                    value: string;
                    trend: MetricTrend | null;
                    valueClass: string;
                    cardClass: string;
                    note?: string;
                    previousValue: string | null;
                  }> = [
                    {
                      key: "run-time",
                      label: "Total Running Time",
                      value: formatDurationMinutes(analyticsOverall.totalRunningMinutes),
                      trend: runningTrend,
                      valueClass: "text-emerald-700",
                      cardClass: "border-emerald-200 bg-emerald-50/80",
                      previousValue: previousAnalyticsOverall ? formatDurationMinutes(previousAnalyticsOverall.totalRunningMinutes) : null,
                    },
                    {
                      key: "idle-time",
                      label: "Avg Idle (per table)",
                      value: formatDurationMinutes(currentIdlePerTablePerDayMinutes),
                      trend: idleTrend,
                      valueClass: "text-amber-700",
                      cardClass: "border-amber-200 bg-amber-50/80",
                      note: `Across ${analyticsWindow.tableCount} table(s)`,
                      previousValue: previousIdlePerTablePerDayMinutes !== null ? formatDurationMinutes(previousIdlePerTablePerDayMinutes) : null,
                    },
                    {
                      key: "utilization",
                      label: "Overall Utilization",
                      value: `${analyticsOverall.utilizationPct}%`,
                      trend: utilizationTrend,
                      valueClass: "text-sky-900",
                      cardClass: "border-sky-300 bg-sky-100/90 ring-1 ring-sky-200 shadow-md",
                      previousValue: previousAnalyticsOverall ? `${previousAnalyticsOverall.utilizationPct}%` : null,
                    },
                    {
                      key: "gross-revenue",
                      label: "Table Revenue (Gross)",
                      value: `₹${formatMoney(analyticsOverall.revenue)}`,
                      trend: revenueTrend,
                      valueClass: "text-indigo-900",
                      cardClass: "border-indigo-300 bg-indigo-100/90 ring-1 ring-indigo-200 shadow-md",
                      previousValue: previousAnalyticsOverall ? `₹${formatMoney(previousAnalyticsOverall.revenue)}` : null,
                    },
                    {
                      key: "daily-average",
                      label: "Daily Avg Revenue",
                      value: `₹${formatMoney(analyticsOverall.dailyAverageRevenue)}`,
                      trend: dailyAverageTrend,
                      valueClass: "text-indigo-700",
                      cardClass: "border-indigo-200 bg-indigo-50/80",
                      note: `Based on ${analyticsWindow.reportDays} day(s)`,
                      previousValue: previousAnalyticsOverall ? `₹${formatMoney(previousAnalyticsOverall.dailyAverageRevenue)}` : null,
                    },
                  ];

                  return cards.map((card) => {
                    const tone = trendTone(card.trend);
                    return (
                      <article key={card.key} className={`rounded-xl border p-3 shadow-sm ${card.cardClass}`}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">{card.label}</p>
                        <p className={`mt-2 text-2xl font-bold leading-none ${card.valueClass}`}>{card.value}</p>
                        <div className="mt-2 flex items-center gap-1.5">
                          <p className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${tone.pillClass}`}>
                            <span aria-hidden>{tone.icon}</span>
                            <span>{formatTrendPercent(card.trend)}</span>
                          </p>
                          <span
                            className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold ${tone.textClass}`}
                            title={card.previousValue ? `Previous ${trendPeriodLabel} value: ${card.previousValue}` : "No previous period data"}
                            aria-label="Trend info"
                          >
                            i
                          </span>
                        </div>
                        {card.note ? <p className="mt-1 text-[10px] text-slate-500">{card.note}</p> : null}
                      </article>
                    );
                  });
                })()}
              </div>

              <div className="mt-2 min-w-0 rounded-md border border-slate-200 bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-800">
                    Revenue by {analyticsRevenueSeries.mode === "day" ? "day" : "hour"}
                  </p>
                  {renderChartSettingsButton("revenueSeries", "Revenue Chart Settings")}
                </div>
                {analyticsRevenueSeries.mode === "hour" ? (
                  <p className="mt-0.5 text-[10px] text-slate-500">Merged buckets: {mergeBucketLabels}</p>
                ) : null}
                <div className="mt-2 w-full max-w-full overflow-x-auto touch-pan-x">
                  <div className="flex min-h-[170px] min-w-full w-max items-end gap-2 pb-1">
                    {(() => {
                      const points = analyticsRevenueSeries.points;
                      const maxRevenue = Math.max(...points.map((point) => point.revenue), 1);
                      return points.map((point) => {
                        const barHeight = Math.max(
                          Math.round((point.revenue / maxRevenue) * 120),
                          chartPreferences.revenueSeries.minBarHeight,
                        );
                        return (
                          <div key={`${point.label}-${point.revenue}`} className="flex w-11 flex-col items-center">
                            {chartPreferences.revenueSeries.showValueLabels ? (
                              <p className="mb-1 text-[10px] font-medium text-slate-700">₹{formatMoney(point.revenue)}</p>
                            ) : null}
                            <div
                              className="w-8 rounded-t"
                              style={{
                                height: `${barHeight}px`,
                                backgroundColor: chartPreferences.revenueSeries.barColor,
                              }}
                              title={`${point.label}: ₹${formatMoney(point.revenue)}`}
                            />
                            <p className="mt-1 text-[10px] text-slate-600">{point.label}</p>
                          </div>
                        );
                      });
                    })()}
                    {analyticsRevenueSeries.points.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No revenue bars in this timeframe.</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-700">Hour Highlights</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-700">
                  <p>
                    <span className="font-semibold text-emerald-700">Best Revenue:</span>{" "}
                    {analyticsHighlights.bestRevenueHour?.label ?? "-"} (₹{formatMoney(analyticsHighlights.bestRevenueHour?.revenue)})
                  </p>
                  <p>
                    <span className="font-semibold text-emerald-700">Best Utilization:</span>{" "}
                    {analyticsHighlights.bestUtilizationHour?.label ?? "-"} ({analyticsHighlights.bestUtilizationHour?.utilizationPct ?? 0}%)
                  </p>
                  <p>
                    <span className="font-semibold text-rose-700">Slowest Revenue (non-zero):</span>{" "}
                    {analyticsHighlights.slowestRevenueHour?.label ?? "-"} (₹{formatMoney(analyticsHighlights.slowestRevenueHour?.revenue)})
                  </p>
                  <p>
                    <span className="font-semibold text-rose-700">Slowest Utilization (non-zero):</span>{" "}
                    {analyticsHighlights.slowestUtilizationHour?.label ?? "-"} ({analyticsHighlights.slowestUtilizationHour?.utilizationPct ?? 0}%)
                  </p>
                </div>
              </div>

              <div className="mt-2 grid min-w-0 gap-2 lg:grid-cols-2">
                <div className="min-w-0 rounded-md border border-slate-200 bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-slate-800">Table Performance</p>
                    <div className="flex items-center gap-1">
                      <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
                        <button
                          type="button"
                          onClick={() => setTableDetailsView("table")}
                          className={`rounded px-2 py-1 text-[10px] font-medium ${tableDetailsView === "table" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}
                        >
                          Table
                        </button>
                        <button
                          type="button"
                          onClick={() => setTableDetailsView("chart")}
                          className={`rounded px-2 py-1 text-[10px] font-medium ${tableDetailsView === "chart" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}
                        >
                          Chart
                        </button>
                      </div>
                      {renderChartSettingsButton("tablePerformance", "Table Performance Chart Settings")}
                    </div>
                  </div>

                  {tableDetailsView === "table" ? (
                    <div className="mt-2 max-h-56 overflow-auto">
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
                  ) : (
                    <div className="mt-2">
                      {isAllTablesAnalytics ? (
                        <>
                          <p className="text-[10px] text-slate-600">
                            Table {chartPreferences.tablePerformance.sortBy === "revenue" ? "revenue" : "utilization"} split
                          </p>
                          <div className="mt-1 space-y-2">
                            {(() => {
                              const rows = [...(analytics?.tables ?? [])].sort((a, b) => {
                                if (chartPreferences.tablePerformance.sortBy === "utilizationPct") {
                                  return b.utilizationPct - a.utilizationPct || b.revenue - a.revenue;
                                }
                                return b.revenue - a.revenue || b.utilizationPct - a.utilizationPct;
                              });
                              const getValue = (row: TableAnalyticsRow): number =>
                                chartPreferences.tablePerformance.sortBy === "utilizationPct" ? row.utilizationPct : row.revenue;
                              const maxValue = Math.max(...rows.map((row) => getValue(row)), 1);
                              return rows.map((row) => {
                                const value = getValue(row);
                                const widthPct = Math.max(Math.round((value / maxValue) * 100), 4);
                                return (
                                  <div key={row.tableId}>
                                    <div className="flex items-center justify-between text-[11px] text-slate-700">
                                      <span className="font-medium text-slate-800">{row.tableName}</span>
                                      <span>
                                        {chartPreferences.tablePerformance.sortBy === "utilizationPct"
                                          ? `${Math.round(value)}%`
                                          : `₹${formatMoney(value)}`}
                                      </span>
                                    </div>
                                    <div className="mt-1 h-2.5 rounded-full bg-slate-100">
                                      <div
                                        className="h-2.5 rounded-full"
                                        title={`${row.tableName}: ${chartPreferences.tablePerformance.sortBy === "utilizationPct" ? `${Math.round(value)}%` : `₹${formatMoney(value)}`}`}
                                        style={{
                                          width: `${widthPct}%`,
                                          backgroundColor: chartPreferences.tablePerformance.primaryColor,
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                            {(analytics?.tables ?? []).length === 0 ? (
                              <p className="text-[11px] text-slate-500">No table revenue data available in this timeframe.</p>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-[10px] text-slate-600">
                            Revenue line chart ({analyticsRevenueSeries.mode === "day" ? "day-wise" : "hour-wise"})
                          </p>
                          {analyticsRevenueSeries.mode === "hour" ? (
                            <p className="mt-0.5 text-[10px] text-slate-500">Merged buckets: {mergeBucketLabels}</p>
                          ) : null}
                          <div className="mt-1 w-full max-w-full overflow-x-auto touch-pan-x">
                            {(() => {
                              const points = analyticsRevenueSeries.points;
                              if (points.length === 0) {
                                return <p className="text-[11px] text-slate-500">No revenue trend data available in this timeframe.</p>;
                              }

                              const cumulativePoints: Array<{ label: string; revenue: number; cumulative: number }> = [];
                              let rolling = 0;
                              for (const point of points) {
                                rolling += point.revenue;
                                cumulativePoints.push({
                                  label: point.label,
                                  revenue: point.revenue,
                                  cumulative: rolling,
                                });
                              }

                              const chartWidth = Math.max(520, cumulativePoints.length * 58);
                              const chartHeight = 220;
                              const leftPad = 24;
                              const rightPad = 12;
                              const topPad = 12;
                              const bottomPad = 36;
                              const usableWidth = chartWidth - leftPad - rightPad;
                              const usableHeight = chartHeight - topPad - bottomPad;

                              const maxRevenue = Math.max(...cumulativePoints.map((point) => point.revenue), 1);
                              const maxCumulative = Math.max(...cumulativePoints.map((point) => point.cumulative), 1);

                              const revenueCoords = cumulativePoints.map((point, index) => {
                                const x = cumulativePoints.length === 1
                                  ? leftPad + usableWidth / 2
                                  : leftPad + (index / (cumulativePoints.length - 1)) * usableWidth;
                                const y = topPad + usableHeight - (point.revenue / maxRevenue) * usableHeight;
                                return { x, y, label: point.label };
                              });
                              const cumulativeCoords = cumulativePoints.map((point, index) => {
                                const x = cumulativePoints.length === 1
                                  ? leftPad + usableWidth / 2
                                  : leftPad + (index / (cumulativePoints.length - 1)) * usableWidth;
                                const y = topPad + usableHeight - (point.cumulative / maxCumulative) * usableHeight;
                                return { x, y, label: point.label };
                              });

                              const revenuePath = revenueCoords
                                .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
                                .join(" ");
                              const cumulativePath = cumulativeCoords
                                .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
                                .join(" ");

                              return (
                                <div className="inline-block min-w-max">
                                  <svg width={chartWidth} height={chartHeight} role="img" aria-label="Table revenue line chart">
                                    <line x1={leftPad} y1={topPad + usableHeight} x2={chartWidth - rightPad} y2={topPad + usableHeight} stroke="#cbd5e1" strokeWidth="1" />
                                    <line x1={leftPad} y1={topPad} x2={leftPad} y2={topPad + usableHeight} stroke="#cbd5e1" strokeWidth="1" />
                                    <path d={revenuePath} fill="none" stroke={chartPreferences.tablePerformance.primaryColor} strokeWidth="2.5" />
                                    {chartPreferences.tablePerformance.showCumulativeLine ? (
                                      <path d={cumulativePath} fill="none" stroke={chartPreferences.tablePerformance.secondaryColor} strokeWidth="2" strokeDasharray="4 3" />
                                    ) : null}
                                    {revenueCoords.map((coord, index) => (
                                      <circle key={`rev-${index}-${coord.label}`} cx={coord.x} cy={coord.y} r="2.75" fill={chartPreferences.tablePerformance.primaryColor} />
                                    ))}
                                    {chartPreferences.tablePerformance.showCumulativeLine
                                      ? cumulativeCoords.map((coord, index) => (
                                        <circle key={`cum-${index}-${coord.label}`} cx={coord.x} cy={coord.y} r="2.4" fill={chartPreferences.tablePerformance.secondaryColor} />
                                      ))
                                      : null}
                                    {revenueCoords.map((coord, index) => (
                                      <text key={`lbl-${index}-${coord.label}`} x={coord.x} y={chartHeight - 16} textAnchor="middle" fontSize="10" fill="#475569">
                                        {coord.label}
                                      </text>
                                    ))}
                                  </svg>
                                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-600">
                                    <span className="inline-flex items-center gap-1">
                                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: chartPreferences.tablePerformance.primaryColor }} /> Period Revenue
                                    </span>
                                    {chartPreferences.tablePerformance.showCumulativeLine ? (
                                      <span className="inline-flex items-center gap-1">
                                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: chartPreferences.tablePerformance.secondaryColor }} /> Cumulative Revenue
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="min-w-0 rounded-md border border-slate-200 bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-slate-800">Hour-wise Breakdown</p>
                    <div className="flex items-center gap-1">
                      <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
                        <button
                          type="button"
                          onClick={() => setHourlyDetailsView("table")}
                          className={`rounded px-2 py-1 text-[10px] font-medium ${hourlyDetailsView === "table" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}
                        >
                          Table
                        </button>
                        <button
                          type="button"
                          onClick={() => setHourlyDetailsView("chart")}
                          className={`rounded px-2 py-1 text-[10px] font-medium ${hourlyDetailsView === "chart" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}
                        >
                          Chart
                        </button>
                      </div>
                      {renderChartSettingsButton("hourlyBreakdown", "Hourly Chart Settings")}
                    </div>
                  </div>

                  {hourlyDetailsView === "table" ? (
                    <div className="mt-2 max-h-56 overflow-auto">
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
                  ) : (
                    <div className="mt-2 w-full max-w-full overflow-x-auto touch-pan-x">
                      <div className="flex min-h-[170px] min-w-full w-max items-end gap-2 pb-1">
                        {(() => {
                          const sourcePoints = analytics?.hourly ?? [];
                          const getValue = (point: HourlyAnalyticsRow): number => {
                            if (chartPreferences.hourlyBreakdown.metric === "utilizationPct") {
                              return point.utilizationPct;
                            }
                            if (chartPreferences.hourlyBreakdown.metric === "runningMinutes") {
                              return point.runningMinutes;
                            }
                            return point.revenue;
                          };
                          const points = chartPreferences.hourlyBreakdown.hideZeroValues
                            ? sourcePoints.filter((point) => getValue(point) > 0)
                            : sourcePoints;
                          const formatValue = (value: number): string => {
                            if (chartPreferences.hourlyBreakdown.metric === "utilizationPct") {
                              return `${Math.round(value)}%`;
                            }
                            if (chartPreferences.hourlyBreakdown.metric === "runningMinutes") {
                              return formatDurationMinutes(value);
                            }
                            return `₹${formatMoney(value)}`;
                          };
                          if (points.length === 0) {
                            return (
                              <p className="text-[11px] text-slate-500">
                                {chartPreferences.hourlyBreakdown.hideZeroValues
                                  ? "No hourly bars after hiding zero values."
                                  : "No hourly data in this timeframe."}
                              </p>
                            );
                          }
                          const maxValue = Math.max(...points.map((point) => getValue(point)), 1);
                          return points.map((point) => {
                            const metricValue = getValue(point);
                            const barHeight = Math.max(Math.round((metricValue / maxValue) * 120), 6);
                            return (
                              <div key={`${point.hour}-${metricValue}`} className="flex w-11 flex-col items-center">
                                {chartPreferences.hourlyBreakdown.showTopLabel ? (
                                  <p className="mb-0.5 text-[9px] text-slate-500">{formatValue(metricValue)}</p>
                                ) : null}
                                <div
                                  className="w-8 rounded-t"
                                  style={{
                                    height: `${barHeight}px`,
                                    backgroundColor: chartPreferences.hourlyBreakdown.barColor,
                                  }}
                                  title={`${point.label}: ${formatValue(metricValue)} (${point.utilizationPct}% util)`}
                                />
                                <p className="mt-1 text-[10px] text-slate-700">{formatValue(metricValue)}</p>
                                <p className="text-[10px] text-slate-500">{point.label}</p>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {analyticsTopTable ? (
                <p className="mt-2 text-[11px] text-slate-600">
                  Top table for selected window: <span className="font-semibold text-slate-800">{analyticsTopTable.tableName}</span>
                  {" "}with ₹{formatMoney(analyticsTopTable.revenue)} revenue and {analyticsTopTable.utilizationPct}% utilization.
                </p>
              ) : null}
            </section>
          )}
        </section>
      </div>

      {splitViewSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">Payment Split - Session #{splitViewSession.id}</h3>
            <p className="mt-1 text-xs text-slate-600">{splitViewSession.billId ? `Bill #${splitViewSession.billId}` : "No bill linked"}</p>
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

      {chartSettingsFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {chartSettingsFor === "revenueSeries"
                    ? "Revenue Chart Settings"
                    : chartSettingsFor === "tablePerformance"
                      ? "Table Performance Settings"
                      : "Hourly Chart Settings"}
                </h3>
                <p className="mt-1 text-xs text-slate-600">Applies only to this chart card.</p>
              </div>
              <button
                type="button"
                onClick={() => setChartSettingsFor(null)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            {chartSettingsFor === "revenueSeries" ? (
              <div className="mt-3 space-y-3">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(chartPreferences.revenueSeries?.showValueLabels)}
                    onChange={(e) => setChartPreferences((prev) => ({
                      ...prev,
                      revenueSeries: {
                        ...prev.revenueSeries,
                        showValueLabels: e.target.checked,
                      },
                    }))}
                  />
                  Show value labels above bars
                </label>
                <label className="block text-xs text-slate-700">
                  Bar color
                  <input
                    type="color"
                    value={chartPreferences.revenueSeries?.barColor ?? DEFAULT_CHART_PREFERENCES.revenueSeries.barColor}
                    onChange={(e) => setChartPreferences((prev) => ({
                      ...prev,
                      revenueSeries: {
                        ...prev.revenueSeries,
                        barColor: sanitizeHexColor(e.target.value, prev.revenueSeries.barColor),
                      },
                    }))}
                    className="mt-1 h-9 w-16 rounded border border-slate-300 bg-white p-1"
                  />
                </label>
                <label className="block text-xs text-slate-700">
                  Minimum bar height
                  <input
                    type="number"
                    min={2}
                    max={24}
                    value={chartPreferences.revenueSeries?.minBarHeight ?? DEFAULT_CHART_PREFERENCES.revenueSeries.minBarHeight}
                    onChange={(e) => setChartPreferences((prev) => ({
                      ...prev,
                      revenueSeries: {
                        ...prev.revenueSeries,
                        minBarHeight: clampNumber(Number(e.target.value), 2, 24),
                      },
                    }))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setChartPreferences((prev) => ({ ...prev, revenueSeries: DEFAULT_CHART_PREFERENCES.revenueSeries }))}
                  className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Reset This Chart
                </button>
              </div>
            ) : null}

            {chartSettingsFor === "tablePerformance" ? (
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-slate-700">
                  All-tables chart sort by
                  <select
                    value={chartPreferences.tablePerformance?.sortBy ?? DEFAULT_CHART_PREFERENCES.tablePerformance.sortBy}
                    onChange={(e) => {
                      const next = e.target.value === "utilizationPct" ? "utilizationPct" : "revenue";
                      setChartPreferences((prev) => ({
                        ...prev,
                        tablePerformance: {
                          ...prev.tablePerformance,
                          sortBy: next,
                        },
                      }));
                    }}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="revenue">Revenue</option>
                    <option value="utilizationPct">Utilization</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(chartPreferences.tablePerformance?.showCumulativeLine)}
                    onChange={(e) => setChartPreferences((prev) => ({
                      ...prev,
                      tablePerformance: {
                        ...prev.tablePerformance,
                        showCumulativeLine: e.target.checked,
                      },
                    }))}
                  />
                  Show cumulative line in single-table chart
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-xs text-slate-700">
                    Primary color
                    <input
                      type="color"
                      value={chartPreferences.tablePerformance?.primaryColor ?? DEFAULT_CHART_PREFERENCES.tablePerformance.primaryColor}
                      onChange={(e) => setChartPreferences((prev) => ({
                        ...prev,
                        tablePerformance: {
                          ...prev.tablePerformance,
                          primaryColor: sanitizeHexColor(e.target.value, prev.tablePerformance.primaryColor),
                        },
                      }))}
                      className="mt-1 h-9 w-16 rounded border border-slate-300 bg-white p-1"
                    />
                  </label>
                  <label className="block text-xs text-slate-700">
                    Secondary color
                    <input
                      type="color"
                      value={chartPreferences.tablePerformance?.secondaryColor ?? DEFAULT_CHART_PREFERENCES.tablePerformance.secondaryColor}
                      onChange={(e) => setChartPreferences((prev) => ({
                        ...prev,
                        tablePerformance: {
                          ...prev.tablePerformance,
                          secondaryColor: sanitizeHexColor(e.target.value, prev.tablePerformance.secondaryColor),
                        },
                      }))}
                      className="mt-1 h-9 w-16 rounded border border-slate-300 bg-white p-1"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => setChartPreferences((prev) => ({ ...prev, tablePerformance: DEFAULT_CHART_PREFERENCES.tablePerformance }))}
                  className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Reset This Chart
                </button>
              </div>
            ) : null}

            {chartSettingsFor === "hourlyBreakdown" ? (
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-slate-700">
                  Chart metric
                  <select
                    value={chartPreferences.hourlyBreakdown?.metric ?? DEFAULT_CHART_PREFERENCES.hourlyBreakdown.metric}
                    onChange={(e) => {
                      const value = e.target.value;
                      const next: ChartPreferences["hourlyBreakdown"]["metric"] =
                        value === "utilizationPct" || value === "runningMinutes" ? value : "revenue";
                      setChartPreferences((prev) => ({
                        ...prev,
                        hourlyBreakdown: {
                          ...prev.hourlyBreakdown,
                          metric: next,
                        },
                      }));
                    }}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="revenue">Revenue</option>
                    <option value="utilizationPct">Utilization %</option>
                    <option value="runningMinutes">Running Time</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(chartPreferences.hourlyBreakdown?.showTopLabel)}
                    onChange={(e) => setChartPreferences((prev) => ({
                      ...prev,
                      hourlyBreakdown: {
                        ...prev.hourlyBreakdown,
                        showTopLabel: e.target.checked,
                      },
                    }))}
                  />
                  Show value labels above bars
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(chartPreferences.hourlyBreakdown?.hideZeroValues)}
                    onChange={(e) => setChartPreferences((prev) => ({
                      ...prev,
                      hourlyBreakdown: {
                        ...prev.hourlyBreakdown,
                        hideZeroValues: e.target.checked,
                      },
                    }))}
                  />
                  Hide zero-value bars in chart
                </label>
                <label className="block text-xs text-slate-700">
                  Bar color
                  <input
                    type="color"
                    value={chartPreferences.hourlyBreakdown?.barColor ?? DEFAULT_CHART_PREFERENCES.hourlyBreakdown.barColor}
                    onChange={(e) => setChartPreferences((prev) => ({
                      ...prev,
                      hourlyBreakdown: {
                        ...prev.hourlyBreakdown,
                        barColor: sanitizeHexColor(e.target.value, prev.hourlyBreakdown.barColor),
                      },
                    }))}
                    className="mt-1 h-9 w-16 rounded border border-slate-300 bg-white p-1"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setChartPreferences((prev) => ({ ...prev, hourlyBreakdown: DEFAULT_CHART_PREFERENCES.hourlyBreakdown }))}
                  className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Reset This Chart
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Chart Settings</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Configure how revenue trend chart is rendered for reports.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-700">
                Target
                <select
                  value={settingsDraft.target}
                  onChange={(e) => {
                    const next = e.target.value === "table" ? "table" : "global";
                    if (next === "table" && analyticsTableId === "all") {
                      setError("Select a table first to edit table-level settings");
                      return;
                    }
                    setSettingsDraft(hydrateDraftFromTarget(next));
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="global">Global (all tables)</option>
                  <option value="table" disabled={analyticsTableId === "all"}>
                    Table specific {selectedTableOption ? `(${selectedTableOption.name})` : ""}
                  </option>
                </select>
              </label>

              <label className="text-xs font-medium text-slate-700">
                Chart Mode
                <select
                  value={settingsDraft.chartMode}
                  onChange={(e) => {
                    const nextMode = e.target.value;
                    if (nextMode === "auto" || nextMode === "day" || nextMode === "hour") {
                      setSettingsDraft((prev) => ({ ...prev, chartMode: nextMode }));
                    }
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="auto">Auto (day for range, hour for single day)</option>
                  <option value="day">Always day-wise</option>
                  <option value="hour">Always hour-wise</option>
                </select>
              </label>
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={settingsDraft.includeClosed}
                onChange={(e) => setSettingsDraft((prev) => ({ ...prev, includeClosed: e.target.checked }))}
              />
              Include zero-revenue bars (closed periods)
            </label>

            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-800">Hour Merge Buckets</p>
                <button
                  type="button"
                  onClick={addMergeBucket}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                >
                  Add Bucket
                </button>
              </div>
              <div className="space-y-2">
                {settingsDraft.mergeBuckets.map((bucket, index) => (
                  <div key={`${bucket.label}-${index}`} className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-4">
                    <label className="text-[11px] text-slate-600">
                      Start Hour
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={bucket.startHour}
                        onChange={(e) => updateMergeBucket(index, { startHour: Number(e.target.value) })}
                        className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600">
                      End Hour
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={bucket.endHour}
                        onChange={(e) => updateMergeBucket(index, { endHour: Number(e.target.value) })}
                        className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600 sm:col-span-2">
                      Label
                      <div className="mt-1 flex gap-2">
                        <input
                          type="text"
                          value={bucket.label}
                          onChange={(e) => updateMergeBucket(index, { label: e.target.value })}
                          className="block w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                          maxLength={24}
                        />
                        <button
                          type="button"
                          onClick={() => removeMergeBucket(index)}
                          className="rounded-md bg-red-100 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-200"
                        >
                          Remove
                        </button>
                      </div>
                    </label>
                  </div>
                ))}
                {settingsDraft.mergeBuckets.length === 0 ? (
                  <p className="text-[11px] text-slate-600">No merge buckets. Chart will show all 24 hour slots.</p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSettings}
                disabled={settingsSaving}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {settingsSaving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
