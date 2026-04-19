"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
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

type BillColumnKey = "bill" | "date" | "time" | "payer" | "modes" | "total" | "status";
type SortDirection = "asc" | "desc";

const BILL_COLUMN_ORDER: BillColumnKey[] = ["bill", "date", "time", "payer", "modes", "total", "status"];

const BILL_COLUMN_LABEL: Record<BillColumnKey, string> = {
  bill: "Bill",
  date: "Date",
  time: "Time",
  payer: "Payer",
  modes: "Modes",
  total: "Total",
  status: "Status",
};

function paymentModeLabel(mode: PaymentMode): string {
  return mode;
}

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

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function billStatusMeta(row: BillSearchRow): { label: "Paid" | "Partial" | "Due"; paid: number; due: number } {
  const paid = Math.max(Math.round(row.paidAmount), 0);
  const due = Math.max(Math.round(row.remainingAmount), 0);
  if (due <= 0) {
    return { label: "Paid", paid, due };
  }
  if (paid <= 0) {
    return { label: "Due", paid, due };
  }
  return { label: "Partial", paid, due };
}

function BillStatusPill({ row }: { row: BillSearchRow }) {
  const status = billStatusMeta(row);
  const badgeClass = status.label === "Paid"
    ? "bg-emerald-100 text-emerald-800"
    : status.label === "Due"
      ? "bg-amber-100 text-amber-800"
      : "bg-indigo-100 text-indigo-800";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
        {status.label}
      </span>
      <span className="text-[11px] text-slate-700">Paid ₹{formatMoney(status.paid)}</span>
    </div>
  );
}

type BillRowActionsProps = {
  row: BillSearchRow;
  onView: (row: BillSearchRow) => void;
  onEdit: (row: BillSearchRow) => void;
  onReprint: (row: BillSearchRow) => void;
  showEdit?: boolean;
};

function BillRowActions({ row, onView, onEdit, onReprint, showEdit = true }: BillRowActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => onView(row)}
        className="rounded bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-300"
      >
        View
      </button>
      {showEdit ? (
        <button
          type="button"
          onClick={() => onEdit(row)}
          className="rounded bg-indigo-100 px-2 py-1 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-200"
        >
          Edit
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onReprint(row)}
        className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200"
      >
        Reprint
      </button>
    </div>
  );
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
  const [billSearchQuery, setBillSearchQuery] = useState("");
  const [billFilterStartTime, setBillFilterStartTime] = useState("");
  const [billFilterEndTime, setBillFilterEndTime] = useState("");
  const [billFilterPaymentMode, setBillFilterPaymentMode] = useState<"all" | PaymentMode>("all");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [quickRange, setQuickRange] = useState<"custom" | "today" | "week" | "month">("custom");
  const [currentFiltersOpen, setCurrentFiltersOpen] = useState(true);
  const [summaryMetricsOpen, setSummaryMetricsOpen] = useState(true);
  const [tableToolsEnabled, setTableToolsEnabled] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<BillColumnKey[]>(BILL_COLUMN_ORDER);
  const [columnFilters, setColumnFilters] = useState<Record<BillColumnKey, string>>({
    bill: "",
    date: "",
    time: "",
    payer: "",
    modes: "",
    total: "",
    status: "",
  });
  const [sortConfig, setSortConfig] = useState<{ key: BillColumnKey; direction: SortDirection }>({
    key: "bill",
    direction: "desc",
  });
  const [viewBillId, setViewBillId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<{
    id: number;
    discountType: "none" | "fixed" | "percent";
    discountValue: string;
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const showNativeServerButton = themeReady && isNativeServerSetupAvailable();

  function modeTextForRow(row: BillSearchRow): string {
    const visibleSplit = row.paymentSplit
      .filter((entry) => billFilterPaymentMode === "all" || entry.mode === billFilterPaymentMode);
    if (!visibleSplit.length) {
      return "-";
    }
    return visibleSplit
      .map((entry) => `${paymentModeLabel(entry.mode)}: ₹${formatMoney(entry.amount)}`)
      .join(" | ");
  }

  function columnValue(row: BillSearchRow, key: BillColumnKey): string {
    if (key === "bill") {
      return String(row.id);
    }
    if (key === "date") {
      return formatDate(row.createdAt);
    }
    if (key === "time") {
      return formatTimeHHmm(row.createdAt);
    }
    if (key === "payer") {
      return row.payerNames.length ? row.payerNames.join(", ") : "-";
    }
    if (key === "modes") {
      return modeTextForRow(row);
    }
    if (key === "total") {
      return formatMoney(row.discountedAmount);
    }
    const status = billStatusMeta(row);
    return `${status.label} | Paid ${formatMoney(status.paid)} | Due ${formatMoney(status.due)}`;
  }

  function columnSortValue(row: BillSearchRow, key: BillColumnKey): string | number {
    if (key === "bill") {
      return row.id;
    }
    if (key === "date") {
      return new Date(row.createdAt).getTime() || 0;
    }
    if (key === "time") {
      const date = new Date(row.createdAt);
      if (Number.isNaN(date.getTime())) {
        return 0;
      }
      return date.getHours() * 60 + date.getMinutes();
    }
    if (key === "payer") {
      return (row.payerNames.length ? row.payerNames.join(", ") : "-").toLowerCase();
    }
    if (key === "modes") {
      return modeTextForRow(row).toLowerCase();
    }
    if (key === "total") {
      return row.discountedAmount;
    }
    return row.remainingAmount;
  }

  const tableRows = useMemo(() => {
    const modeFilteredRows = billFilterPaymentMode === "all"
      ? billSearchRows
      : billSearchRows.filter((row) =>
        row.paymentSplit.some((entry) => entry.mode === billFilterPaymentMode),
      );
    const normalizedSearch = billSearchQuery.trim().toLowerCase();
    const searchFiltered = !normalizedSearch
      ? modeFilteredRows
      : modeFilteredRows.filter((row) => {
        const target = [
          String(row.id),
          row.payerNames.join(" "),
          modeTextForRow(row),
          formatDate(row.createdAt),
        ].join(" ").toLowerCase();
        return target.includes(normalizedSearch);
      });

    if (!tableToolsEnabled) {
      return searchFiltered;
    }
    const normalizedFilters = Object.fromEntries(
      (Object.keys(columnFilters) as BillColumnKey[]).map((key) => [key, columnFilters[key].trim().toLowerCase()]),
    ) as Record<BillColumnKey, string>;

    const filtered = searchFiltered.filter((row) =>
      visibleColumns.every((key) => {
        const query = normalizedFilters[key];
        if (!query) {
          return true;
        }
        return columnValue(row, key).toLowerCase().includes(query);
      }),
    );

    const sorted = [...filtered].sort((a, b) => {
      const aValue = columnSortValue(a, sortConfig.key);
      const bValue = columnSortValue(b, sortConfig.key);

      let result = 0;
      if (typeof aValue === "number" && typeof bValue === "number") {
        result = aValue - bValue;
      } else {
        result = String(aValue).localeCompare(String(bValue));
      }

      return sortConfig.direction === "asc" ? result : -result;
    });

    return sorted;
  }, [billSearchRows, columnFilters, sortConfig, billFilterPaymentMode, visibleColumns, tableToolsEnabled, billSearchQuery]);

  const displayedSummary = useMemo(() => {
    const billsCount = tableRows.length;
    const total = tableRows.reduce((sum, row) => sum + row.discountedAmount, 0);
    const paid = tableRows.reduce((sum, row) => sum + row.paidAmount, 0);
    const unpaid = tableRows.reduce((sum, row) => sum + row.remainingAmount, 0);
    const modeTotal = billFilterPaymentMode === "all"
      ? null
      : tableRows.reduce(
        (sum, row) =>
          sum +
          row.paymentSplit
            .filter((entry) => entry.mode === billFilterPaymentMode)
            .reduce((inner, entry) => inner + entry.amount, 0),
        0,
      );
    return { billsCount, total, paid, unpaid, modeTotal };
  }, [tableRows, billFilterPaymentMode]);

  function toggleColumn(column: BillColumnKey) {
    setVisibleColumns((prev) => {
      let next: BillColumnKey[] = prev;
      if (prev.includes(column)) {
        if (prev.length === 1) {
          return prev;
        }
        next = prev.filter((item) => item !== column);
      } else {
        next = BILL_COLUMN_ORDER.filter((item) => [...prev, column].includes(item));
      }
      return next;
    });
  }

  function toggleTableTools() {
    setTableToolsEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setColumnsOpen(false);
      }
      return next;
    });
  }

  function toggleSort(column: BillColumnKey) {
    if (!tableToolsEnabled) {
      return;
    }
    setSortConfig((prev) => {
      if (prev.key !== column) {
        return { key: column, direction: "asc" };
      }
      return { key: column, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  }

  async function applyQuickRange(nextRange: "today" | "week" | "month" | "custom") {
    setQuickRange(nextRange);
    if (nextRange === "custom") {
      return;
    }
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    if (nextRange === "week") {
      start.setDate(end.getDate() - 6);
    } else if (nextRange === "month") {
      start.setDate(1);
    }
    start.setHours(0, 0, 0, 0);
    const startDate = toIsoDate(start);
    const endDate = toIsoDate(end);
    setBillFilterStartDate(startDate);
    setBillFilterEndDate(endDate);
    await loadBillSearch({ startDate, endDate });
  }

  function handleViewRow(row: BillSearchRow) {
    setViewBillId((prev) => (prev === row.id ? null : row.id));
  }

  function handleEditRow(row: BillSearchRow) {
    const discountType = row.discountType ?? "none";
    const discountValue = row.discountType ? String(row.discountValue ?? 0) : "";
    setEditTarget({ id: row.id, discountType, discountValue });
  }

  async function saveDiscountEdit() {
    if (!editTarget) {
      return;
    }
    const discountType = editTarget.discountType === "none" ? undefined : editTarget.discountType;
    const parsedDiscountValue = discountType ? Number(editTarget.discountValue || "0") : null;
    if (discountType && (parsedDiscountValue === null || Number.isNaN(parsedDiscountValue) || parsedDiscountValue < 0)) {
      setBillSearchError("Invalid discount value");
      return;
    }
    if (discountType === "percent" && parsedDiscountValue !== null && parsedDiscountValue > 100) {
      setBillSearchError("Percent discount cannot exceed 100");
      return;
    }
    const discountValue = parsedDiscountValue ?? undefined;
    setEditBusy(true);
    setBillSearchError(null);
    try {
      const res = await fetch("/api/bill/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          billId: editTarget.id,
          discountType,
          discountValue,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update discount");
      }
      setEditTarget(null);
      await loadBillSearch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update discount";
      setBillSearchError(message);
    } finally {
      setEditBusy(false);
    }
  }

  function handleReprintRow(row: BillSearchRow) {
    const status = billStatusMeta(row);
    const popup = window.open("", "_blank", "width=420,height=640");
    if (!popup) {
      setBillSearchError("Popup blocked. Please allow popups to reprint.");
      return;
    }
    const payer = row.payerNames.length ? row.payerNames.join(", ") : "-";
    const modes = modeTextForRow(row);
    popup.document.write(`
      <html>
      <head>
        <title>Bill #${row.id}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 16px; color: #0f172a; }
          h1 { font-size: 18px; margin: 0 0 10px; }
          p { margin: 4px 0; font-size: 13px; }
          .line { border-top: 1px dashed #94a3b8; margin: 10px 0; }
          .big { font-size: 16px; font-weight: 700; }
        </style>
      </head>
      <body>
        <h1>Bill #${row.id}</h1>
        <p>Date: ${formatDate(row.createdAt)} ${formatTimeHHmm(row.createdAt)}</p>
        <p>Payer: ${payer}</p>
        <div class="line"></div>
        <p>Total: ₹${formatMoney(row.discountedAmount)}</p>
        <p>Paid: ₹${formatMoney(status.paid)}</p>
        <p>Due: ₹${formatMoney(status.due)}</p>
        <p class="big">Status: ${status.label}</p>
        <div class="line"></div>
        <p>Modes: ${modes}</p>
      </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
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

  async function loadBillSearch(overrides?: {
    startDate?: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    paymentMode?: "all" | PaymentMode;
  }) {
    setBillSearchLoading(true);
    setBillSearchError(null);
    try {
      const effectiveStartDate = overrides?.startDate ?? billFilterStartDate;
      const effectiveEndDate = overrides?.endDate ?? billFilterEndDate;
      const effectiveStartTime = overrides?.startTime ?? billFilterStartTime;
      const effectiveEndTime = overrides?.endTime ?? billFilterEndTime;
      const effectiveMode = overrides?.paymentMode ?? billFilterPaymentMode;
      const params = new URLSearchParams();
      if (effectiveStartDate) {
        params.set("startDate", effectiveStartDate);
      }
      if (effectiveEndDate) {
        params.set("endDate", effectiveEndDate);
      }
      if (effectiveStartTime) {
        params.set("startTime", effectiveStartTime);
      }
      if (effectiveEndTime) {
        params.set("endTime", effectiveEndTime);
      }
      if (effectiveMode !== "all") {
        params.set("paymentMode", effectiveMode);
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    setCurrentFiltersOpen(!isMobile);
    setSummaryMetricsOpen(!isMobile);
  }, []);

  useEffect(() => {
    if (visibleColumns.includes(sortConfig.key)) {
      return;
    }
    setSortConfig({ key: visibleColumns[0], direction: "asc" });
  }, [visibleColumns, sortConfig.key]);

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
        <PageHeader
          title="Bills"
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
              href: "/due-report",
              label: "Due Report",
              className: "rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900",
            },
          ]}
          userLabel={activeUser ? `${activeUser.name} (${activeUser.role})` : null}
          showServerButton={showNativeServerButton}
          onServerClick={() => {
            if (!openNativeServerSetup()) {
              setBillSearchError("Server setup button works in Android app only");
            }
          }}
          onLogout={logout}
          onToggleTheme={toggleTheme}
          themeLabel={isDark ? "Light Theme" : "Dark Theme"}
          isDark={isDark}
        />

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-md">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-600">Search by bill # or payer, and filter by date range.</p>
            <button
              type="button"
              onClick={() => setCurrentFiltersOpen((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-200"
            >
              {currentFiltersOpen ? "Hide Current Filters" : "Show Current Filters"}
              <span className="text-[10px]">{currentFiltersOpen ? "▲" : "▼"}</span>
            </button>
          </div>

          {currentFiltersOpen ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input
                  type="text"
                  value={billSearchQuery}
                  onChange={(e) => setBillSearchQuery(e.target.value)}
                  placeholder="Search bill #, payer, date"
                  className="rounded border border-slate-300 px-2.5 py-2 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={billFilterStartDate}
                    onChange={(e) => {
                      setBillFilterStartDate(e.target.value);
                      setQuickRange("custom");
                    }}
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={billFilterEndDate}
                    onChange={(e) => {
                      setBillFilterEndDate(e.target.value);
                      setQuickRange("custom");
                    }}
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadBillSearch()}
                    disabled={billSearchLoading}
                    className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                  >
                    {billSearchLoading ? "Loading..." : "Apply"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvancedFiltersOpen((prev) => !prev)}
                    className="rounded border border-slate-300 bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                  >
                    {advancedFiltersOpen ? "Hide More" : "More Filters"}
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void applyQuickRange("today")}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    quickRange === "today" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => void applyQuickRange("week")}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    quickRange === "week" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"
                  }`}
                >
                  Week
                </button>
                <button
                  type="button"
                  onClick={() => void applyQuickRange("month")}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    quickRange === "month" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-800"
                  }`}
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBillSearchQuery("");
                    setBillFilterStartDate("");
                    setBillFilterEndDate("");
                    setBillFilterStartTime("");
                    setBillFilterEndTime("");
                    setBillFilterPaymentMode("all");
                    setQuickRange("custom");
                    void loadBillSearch({
                      startDate: "",
                      endDate: "",
                      startTime: "",
                      endTime: "",
                      paymentMode: "all",
                    });
                  }}
                  className="rounded bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-300"
                >
                  Reset
                </button>
              </div>

              {advancedFiltersOpen ? (
                <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2 sm:grid-cols-3">
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
                </div>
              ) : null}
            </>
          ) : null}

          {billSearchError ? (
            <p className="mt-2 text-xs text-red-600">{billSearchError}</p>
          ) : null}

          <div className={`mt-4 grid grid-cols-1 gap-2 ${summaryMetricsOpen ? "lg:grid-cols-4" : ""}`}>
            <div
              className={`rounded-xl border px-4 py-4 shadow-sm ${
                isDark ? "border-indigo-500/40 bg-indigo-400/20" : "border-indigo-300 bg-indigo-100/90"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-indigo-100" : "text-indigo-800"}`}>
                    Total Revenue
                  </p>
                  <p className={`mt-1 text-3xl font-extrabold ${isDark ? "text-indigo-50" : "text-indigo-900"}`}>
                    ₹{formatMoney(displayedSummary.total)}
                  </p>
                </div>
                {!summaryMetricsOpen ? (
                  <button
                    type="button"
                    onClick={() => setSummaryMetricsOpen((prev) => !prev)}
                    aria-label="Show summary cards"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <span className="leading-none">▼</span>
                  </button>
                ) : null}
              </div>
            </div>

            {summaryMetricsOpen ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Bills</p>
                  <p className="mt-1 text-2xl font-extrabold text-slate-900">{displayedSummary.billsCount}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Paid</p>
                  <p className="mt-1 text-2xl font-extrabold text-emerald-900">₹{formatMoney(displayedSummary.paid)}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Unpaid</p>
                      <p className="mt-1 text-2xl font-extrabold text-amber-900">₹{formatMoney(displayedSummary.unpaid)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSummaryMetricsOpen((prev) => !prev)}
                      aria-label="Hide summary cards"
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <span className="leading-none">▲</span>
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {billFilterPaymentMode !== "all" ? (
            <div className="mt-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
              {paymentModeLabel(billFilterPaymentMode).toUpperCase()} Total: ₹{formatMoney(displayedSummary.modeTotal)}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleTableTools}
              className="hidden items-center gap-2 rounded border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-200 md:inline-flex"
            >
              {tableToolsEnabled ? "Disable sorting & filtering column" : "Enable sorting & filtering column"}
            </button>
            {tableToolsEnabled ? (
              <button
                type="button"
                onClick={() => setColumnsOpen((prev) => !prev)}
                className="hidden items-center gap-2 rounded border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-200 md:inline-flex"
              >
                {columnsOpen ? "Hide Columns" : "Choose Columns"}
                <span className="text-[10px]">{columnsOpen ? "▲" : "▼"}</span>
              </button>
            ) : null}
          </div>

          {tableToolsEnabled && columnsOpen ? (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BILL_COLUMN_ORDER.map((column) => (
                  <label key={column} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(column)}
                      onChange={() => toggleColumn(column)}
                    />
                    <span>{BILL_COLUMN_LABEL[column]}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 hidden overflow-hidden rounded-xl border border-slate-200 shadow-sm md:block">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-800 text-slate-100">
                  <tr>
                    {visibleColumns.map((column) => (
                      <th key={column} className="px-3 py-2 font-semibold uppercase tracking-wide">
                        {tableToolsEnabled ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column)}
                            className="inline-flex items-center gap-1 hover:text-white"
                          >
                            {BILL_COLUMN_LABEL[column]}
                            <span className="text-[10px]">
                              {sortConfig.key === column ? (sortConfig.direction === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        ) : BILL_COLUMN_LABEL[column]}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">Actions</th>
                  </tr>
                  {tableToolsEnabled ? (
                    <tr>
                      {visibleColumns.map((column) => (
                        <th key={`${column}-filter`} className="bg-slate-700/90 px-2 py-1">
                          <input
                            type="text"
                            value={columnFilters[column]}
                            onChange={(e) =>
                              setColumnFilters((prev) => ({
                                ...prev,
                                [column]: e.target.value,
                              }))
                            }
                            placeholder={`Filter ${BILL_COLUMN_LABEL[column]}`}
                            className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-[11px] font-normal text-slate-100 placeholder:text-slate-300"
                          />
                        </th>
                      ))}
                      <th className="bg-slate-700/90 px-2 py-1" />
                    </tr>
                  ) : null}
                </thead>
                <tbody>
                  {tableRows.map((row, index) => (
                    <Fragment key={`row-${row.id}`}>
                      <tr
                        className={`${
                          isDark
                            ? index % 2 === 0
                              ? "bg-slate-700/25"
                              : "bg-slate-700/15"
                            : index % 2 === 0
                              ? "bg-white"
                              : "bg-slate-50/70"
                        } border-b border-slate-100 ${isDark ? "hover:bg-slate-600/25" : "hover:bg-amber-50/70"}`}
                      >
                        {visibleColumns.map((column) => (
                          <td
                            key={`${row.id}-${column}`}
                            className={`px-3 py-2 ${
                              column === "bill"
                                ? "font-semibold text-slate-900"
                                : column === "total"
                                  ? (isDark ? "font-semibold text-indigo-100" : "font-semibold text-indigo-900")
                                  : column === "status"
                                    ? "font-semibold text-slate-800"
                                    : "text-slate-700"
                            }`}
                          >
                            {column === "bill"
                              ? `#${columnValue(row, column)}`
                              : column === "status"
                                ? <BillStatusPill row={row} />
                                : columnValue(row, column)}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <BillRowActions
                            row={row}
                            onView={handleViewRow}
                            onEdit={handleEditRow}
                            onReprint={handleReprintRow}
                            showEdit={false}
                          />
                        </td>
                      </tr>
                      {viewBillId === row.id ? (
                        <tr className={`border-b border-slate-100 ${isDark ? "bg-slate-700/10" : "bg-slate-50"}`}>
                          <td colSpan={visibleColumns.length + 1} className="px-3 py-2 text-xs text-slate-700">
                            <p className="font-semibold text-slate-900">Bill #{row.id} Details</p>
                            <p className="mt-1">Payer: {row.payerNames.length ? row.payerNames.join(", ") : "-"}</p>
                            <p className="mt-1">Modes: {modeTextForRow(row)}</p>
                            <p className="mt-1">
                              Discount: {row.discountType ? `${row.discountType} (${formatMoney(row.discountValue)})` : "None"}
                            </p>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  {tableRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={visibleColumns.length + 1}>
                        No bills found for current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 space-y-2 md:hidden">
            {tableRows.map((row) => (
              <article key={`card-${row.id}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Bill #{row.id}</p>
                    <p className="text-xs text-slate-600">{formatDate(row.createdAt)} {formatTimeHHmm(row.createdAt)}</p>
                    <p className="mt-1 text-xs text-slate-700">{row.payerNames.length ? row.payerNames.join(", ") : "-"}</p>
                  </div>
                  <p className="text-xl font-extrabold text-indigo-900">₹{formatMoney(row.discountedAmount)}</p>
                </div>
                <div className="mt-2">
                  <BillStatusPill row={row} />
                </div>
                <p className="mt-2 text-xs text-slate-700">Modes: {modeTextForRow(row)}</p>
                <div className="mt-2">
                  <BillRowActions
                    row={row}
                    onView={handleViewRow}
                    onEdit={handleEditRow}
                    onReprint={handleReprintRow}
                    showEdit={false}
                  />
                </div>
                {viewBillId === row.id ? (
                  <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Bill Details</p>
                    <p className="mt-1">Discount: {row.discountType ? `${row.discountType} (${formatMoney(row.discountValue)})` : "None"}</p>
                  </div>
                ) : null}
              </article>
            ))}
            {tableRows.length === 0 ? (
              <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No bills found for current filters.
              </p>
            ) : null}
          </div>

          {editTarget ? (
            <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/80 p-3">
              <p className="text-sm font-semibold text-indigo-900">Edit Bill #{editTarget.id}</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[140px_minmax(0,1fr)_auto]">
                <select
                  value={editTarget.discountType}
                  onChange={(e) =>
                    setEditTarget((prev) => prev ? { ...prev, discountType: e.target.value as "none" | "fixed" | "percent" } : prev)
                  }
                  className="rounded border border-indigo-300 px-2 py-1 text-xs"
                >
                  <option value="none">No Discount</option>
                  <option value="fixed">Fixed</option>
                  <option value="percent">Percent</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editTarget.discountValue}
                  onChange={(e) =>
                    setEditTarget((prev) => prev ? { ...prev, discountValue: e.target.value } : prev)
                  }
                  placeholder="Discount value"
                  disabled={editTarget.discountType === "none"}
                  className="rounded border border-indigo-300 px-2 py-1 text-xs disabled:bg-slate-100"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveDiscountEdit()}
                    disabled={editBusy}
                    className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {editBusy ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditTarget(null)}
                    className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
