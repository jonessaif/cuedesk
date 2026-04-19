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

type CustomerInsightRow = {
  customer_id: number | null;
  payer_identity: string;
  name: string;
  visits: number;
  total_spent: number;
  avg_spent: number;
  last_visit: string | null;
  avg_gap: number | null;
  last_gap: number;
  is_high_value?: boolean;
  is_at_risk?: boolean;
  alert?: string;
};

type CustomerInsightsResponse = {
  top_customers: CustomerInsightRow[];
  high_value_customers: CustomerInsightRow[];
  at_risk_customers: CustomerInsightRow[];
};

const RISK_THRESHOLD_DAYS = 4;

function formatMoney(value: number | null | undefined): string {
  const safe = typeof value === "number" ? value : 0;
  return String(Math.round(safe));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function recencyMeta(value: number | null | undefined): {
  dayCount: number;
  label: string;
  badgeClass: string;
} {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      dayCount: -1,
      label: "-",
      badgeClass: "bg-slate-100 text-slate-700",
    };
  }
  const dayCount = Math.max(Math.floor(value), 0);
  const label = dayCount === 0
    ? "Today"
    : dayCount === 1
      ? "Yesterday"
      : `${dayCount} days ago`;
  const badgeClass = dayCount <= 2
    ? "bg-emerald-100 text-emerald-800"
    : dayCount <= 4
      ? "bg-amber-100 text-amber-800"
      : "bg-rose-100 text-rose-800";
  return { dayCount, label, badgeClass };
}

export default function CustomerInsightsPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [topCustomers, setTopCustomers] = useState<CustomerInsightRow[]>([]);
  const [highValueCustomers, setHighValueCustomers] = useState<CustomerInsightRow[]>([]);
  const [atRiskCustomers, setAtRiskCustomers] = useState<CustomerInsightRow[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [topNFilter, setTopNFilter] = useState<"all" | "10" | "20" | "50">("all");
  const actionRequiredRef = useRef<HTMLElement | null>(null);

  const showNativeServerButton = themeReady && isNativeServerSetupAvailable();

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

  async function loadInsights(filterOverride?: { startDate?: string; endDate?: string }) {
    if (!activeUserId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      const effectiveStartDate = filterOverride?.startDate ?? startDate;
      const effectiveEndDate = filterOverride?.endDate ?? endDate;
      if (effectiveStartDate) {
        params.set("startDate", effectiveStartDate);
      }
      if (effectiveEndDate) {
        params.set("endDate", effectiveEndDate);
      }
      const query = params.toString();
      const res = await fetch(`/api/customer-insights${query ? `?${query}` : ""}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<CustomerInsightsResponse & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to load customer insights");
      }
      setTopCustomers(data?.top_customers ?? []);
      setHighValueCustomers(data?.high_value_customers ?? []);
      setAtRiskCustomers(data?.at_risk_customers ?? []);
      setLastRefreshedAt(new Date().toISOString());
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to load customer insights";
      setError(text);
      setTopCustomers([]);
      setHighValueCustomers([]);
      setAtRiskCustomers([]);
    } finally {
      setLoading(false);
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
    void loadInsights();
  }, [activeUserId]);

  function clearDateFilter() {
    setStartDate("");
    setEndDate("");
    void loadInsights({ startDate: "", endDate: "" });
  }

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

  const summary = useMemo(() => {
    const totalTracked = topCustomers.length;
    const topSpend = topCustomers[0]?.total_spent ?? 0;
    const highValueCount = highValueCustomers.length;
    const atRiskCount = atRiskCustomers.length;
    const highValueAtRisk = atRiskCustomers.filter((row) =>
      highValueCustomers.some((high) => high.payer_identity === row.payer_identity),
    ).length;
    return {
      totalTracked,
      topSpend,
      highValueCount,
      atRiskCount,
      highValueAtRisk,
    };
  }, [topCustomers, highValueCustomers, atRiskCustomers]);

  const atRiskHighValueCustomers = useMemo(() => {
    return highValueCustomers
      .filter((row) => recencyMeta(row.last_gap).dayCount > RISK_THRESHOLD_DAYS)
      .sort((a, b) => {
        const dayDiff = recencyMeta(b.last_gap).dayCount - recencyMeta(a.last_gap).dayCount;
        if (dayDiff !== 0) {
          return dayDiff;
        }
        return b.total_spent - a.total_spent;
      });
  }, [highValueCustomers]);

  const activeHighValueCustomers = useMemo(() => {
    return highValueCustomers
      .filter((row) => {
        const dayCount = recencyMeta(row.last_gap).dayCount;
        return dayCount >= 0 && dayCount <= RISK_THRESHOLD_DAYS;
      })
      .sort((a, b) => b.total_spent - a.total_spent);
  }, [highValueCustomers]);

  const actionableCustomers = atRiskHighValueCustomers;

  const displayedTopCustomers = useMemo(() => {
    if (topNFilter === "all") {
      return topCustomers;
    }
    const limit = Number(topNFilter);
    if (!Number.isFinite(limit) || limit <= 0) {
      return topCustomers;
    }
    return topCustomers.slice(0, limit);
  }, [topCustomers, topNFilter]);

  if (!activeUserId) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">
            Please login on dashboard first to use Customer Insights.
          </p>
          <Link href="/" className="mt-3 inline-block rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
            Go to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Customer Insights"
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

        <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600">
              Payer-based customer analytics from billed sessions and payments.
            </p>
            <div className="flex items-center gap-2">
              {lastRefreshedAt ? (
                <span className="text-[11px] text-slate-500">
                  Updated: {formatDateTime(lastRefreshedAt)}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void loadInsights()}
                disabled={loading}
                className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <label className="text-[11px] font-semibold text-slate-700">
              Start Date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="text-[11px] font-semibold text-slate-700">
              End Date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadInsights()}
              disabled={loading}
              className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={clearDateFilter}
              disabled={loading || (!startDate && !endDate)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Clear
            </button>
            {(startDate || endDate) ? (
              <span className="text-[11px] text-slate-600">
                Active range: {startDate || "..."} to {endDate || "..."}
              </span>
            ) : null}
          </div>

          {summary.highValueAtRisk > 0 ? (
            <button
              type="button"
              onClick={() => actionRequiredRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="mt-3 w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-800 hover:bg-amber-100"
            >
              ⚠ {summary.highValueAtRisk} high-value customer(s) haven't visited recently
            </button>
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">Tracked Customers</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{summary.totalTracked}</p>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-[11px] text-indigo-700">Top Spend</p>
              <p className="mt-1 text-xl font-bold text-indigo-900">₹{formatMoney(summary.topSpend)}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[11px] text-emerald-700">High Value</p>
              <p className="mt-1 text-xl font-bold text-emerald-900">{summary.highValueCount}</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-[11px] text-rose-700">At Risk (All Customers)</p>
              <p className="mt-1 text-xl font-bold text-rose-900">{summary.atRiskCount}</p>
              <p className="mt-1 text-[11px] text-rose-700">High Value At Risk: {summary.highValueAtRisk}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="order-2 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:order-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Top Customers</h2>
                <label className="text-[11px] font-semibold text-slate-700">
                  Show
                  <select
                    value={topNFilter}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === "10" || next === "20" || next === "50") {
                        setTopNFilter(next);
                        return;
                      }
                      setTopNFilter("all");
                    }}
                    className="ml-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
                  >
                    <option value="all">All</option>
                    <option value="10">Top 10</option>
                    <option value="20">Top 20</option>
                    <option value="50">Top 50</option>
                  </select>
                </label>
              </div>
              <div className="mt-2 max-h-80 overflow-auto rounded border border-slate-200 bg-white">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2 py-2">Name</th>
                      <th className="px-2 py-2">Total Spend</th>
                      <th className="px-2 py-2">Visits</th>
                      <th className="px-2 py-2">Last Visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedTopCustomers.map((row) => (
                      <tr key={row.payer_identity} className="border-t border-slate-100">
                        <td className="px-2 py-2 font-medium text-slate-900">{row.name}</td>
                        <td className="px-2 py-2 text-slate-800">₹{formatMoney(row.total_spent)}</td>
                        <td className="px-2 py-2 text-slate-700">{row.visits}</td>
                        <td className="px-2 py-2 text-slate-600">{formatDateTime(row.last_visit)}</td>
                      </tr>
                    ))}
                    {displayedTopCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-slate-500">
                          No customer data available yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <h3 className="text-sm font-semibold text-slate-900">At-Risk Customers (All)</h3>
                <p className="mt-1 text-[11px] text-slate-600">
                  At risk = no visit in last {RISK_THRESHOLD_DAYS} days
                </p>
                <div className="mt-2 space-y-2">
                  {atRiskCustomers.map((row) => {
                    const recency = recencyMeta(row.last_gap);
                    return (
                      <article key={`risk-${row.payer_identity}`} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <p className="text-sm font-semibold text-slate-900">⚠ {row.name}</p>
                        <p className="mt-0.5 text-xs text-slate-700">
                          Avg gap {row.avg_gap == null ? "-" : `${Math.max(Math.round(row.avg_gap), 0)}d`} • Spend ₹{formatMoney(row.total_spent)}
                        </p>
                        <p className="mt-1">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${recency.badgeClass}`}>
                            {recency.label}
                          </span>
                        </p>
                      </article>
                    );
                  })}
                  {atRiskCustomers.length === 0 ? (
                    <p className="text-xs text-slate-600">No at-risk customers right now.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <div className="order-1 space-y-4 lg:order-2">
              <section ref={actionRequiredRef} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-rose-900">⚠ Action Required</h2>
                  <p className="text-[11px] text-rose-700">At risk = no visit in last {RISK_THRESHOLD_DAYS} days</p>
                </div>
                <div className="mt-2 space-y-2">
                  {actionableCustomers.map((row) => {
                    const recency = recencyMeta(row.last_gap);
                    return (
                      <article key={`action-${row.payer_identity}`} className="rounded-md border border-rose-300 bg-rose-50 p-2">
                        <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                        <p className="mt-0.5 text-xs text-slate-700">
                          ₹{formatMoney(row.total_spent)} total • {row.visits} visits
                        </p>
                        <p className="mt-1 text-xs font-semibold text-rose-700">Last visit: {recency.label}</p>
                        <p className="mt-0.5 text-[11px] text-rose-700">High priority</p>
                      </article>
                    );
                  })}
                  {actionableCustomers.length === 0 ? (
                    <p className="text-xs text-slate-600">No customers need attention</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <h2 className="text-sm font-semibold text-emerald-900">✓ Active High Value</h2>
                <div className="mt-2 space-y-2">
                  {activeHighValueCustomers.map((row) => {
                    const recency = recencyMeta(row.last_gap);
                    return (
                      <article key={`high-active-${row.payer_identity}`} className="rounded-md border border-emerald-200 bg-white p-2">
                        <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                        <p className="mt-0.5 text-xs text-slate-700">
                          ₹{formatMoney(row.total_spent)} total • {row.visits} visits
                        </p>
                        <p className="mt-1">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${recency.badgeClass}`}>
                            {recency.label}
                          </span>
                        </p>
                      </article>
                    );
                  })}
                  {activeHighValueCustomers.length === 0 ? (
                    <p className="text-xs text-slate-600">No active high-value customers in this range.</p>
                  ) : null}
                </div>
              </section>

            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
