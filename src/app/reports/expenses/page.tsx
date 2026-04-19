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

type ExpenseCategory = {
  id: number;
  name: string;
  isActive: boolean;
};

type ExpenseEntry = {
  id: number;
  date: string;
  item: string;
  amount: number;
  mode: "cash" | "bank";
  category_id: number;
  category_name: string;
  created_by_user_name: string;
  created_at: string;
};

type CategoryTotal = {
  category_id: number;
  category_name: string;
  total: number;
};

function todayDateInputValue(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toDateKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ExpensesPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [fromDate, setFromDate] = useState(todayDateInputValue());
  const [toDate, setToDate] = useState(todayDateInputValue());
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotal[]>([]);
  const [cashTotal, setCashTotal] = useState(0);
  const [bankTotal, setBankTotal] = useState(0);

  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showFullTable, setShowFullTable] = useState(false);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);

  const [entryDateInput, setEntryDateInput] = useState(todayDateInputValue());
  const [entryCategoryId, setEntryCategoryId] = useState("");
  const [entryItem, setEntryItem] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryMode, setEntryMode] = useState<"cash" | "bank">("cash");
  const [entryBusy, setEntryBusy] = useState(false);

  const showNativeServerButton = themeReady && isNativeServerSetupAvailable();
  const totalExpense = cashTotal + bankTotal;

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

  async function loadCategories() {
    const categoriesRes = await fetch("/api/expenses/categories", { cache: "no-store", headers: authHeaders() });
    const categoriesData = await readJsonSafe<{ data?: ExpenseCategory[]; error?: string }>(categoriesRes);
    if (!categoriesRes.ok) {
      throw new Error(categoriesData?.error ?? "Failed to load categories");
    }
    const nextCategories = categoriesData?.data ?? [];
    setCategories(nextCategories);
    if (!entryCategoryId && nextCategories.some((row) => row.isActive)) {
      const firstActive = nextCategories.find((row) => row.isActive);
      if (firstActive) {
        setEntryCategoryId(String(firstActive.id));
      }
    }
  }

  async function loadExpenses() {
    if (!activeUserId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
      });
      if (selectedCategoryIds.length > 0) {
        params.set("categoryIds", selectedCategoryIds.join(","));
      }
      const entriesRes = await fetch(`/api/expenses/entries?${params.toString()}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      const entriesData = await readJsonSafe<{
        data?: ExpenseEntry[];
        summary?: { cash: number; bank: number; total: number };
        by_category?: CategoryTotal[];
        error?: string;
      }>(entriesRes);
      if (!entriesRes.ok) {
        throw new Error(entriesData?.error ?? "Failed to load expenses");
      }
      setEntries(entriesData?.data ?? []);
      setCashTotal(entriesData?.summary?.cash ?? 0);
      setBankTotal(entriesData?.summary?.bank ?? 0);
      setCategoryTotals(entriesData?.by_category ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }

  async function loadAll() {
    if (!activeUserId) {
      return;
    }
    await Promise.all([loadCategories(), loadExpenses()]);
  }

  async function createCategory() {
    if (!activeUserId) {
      return;
    }
    setCategoryBusy(true);
    setError("");
    try {
      const res = await fetch("/api/expenses/categories", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to create category");
      }
      setNewCategoryName("");
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create category");
    } finally {
      setCategoryBusy(false);
    }
  }

  async function updateCategory(id: number) {
    if (!activeUserId || !editingCategoryName.trim()) {
      return;
    }
    setCategoryBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/expenses/categories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: editingCategoryName.trim() }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update category");
      }
      setEditingCategoryId(null);
      setEditingCategoryName("");
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update category");
    } finally {
      setCategoryBusy(false);
    }
  }

  async function toggleCategoryStatus(id: number, nextActive: boolean) {
    if (!activeUserId) {
      return;
    }
    setCategoryBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/expenses/categories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ is_active: nextActive }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update category");
      }
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update category");
    } finally {
      setCategoryBusy(false);
    }
  }

  async function deleteCategory(id: number) {
    if (!activeUserId) {
      return;
    }
    setCategoryBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/expenses/categories/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to delete category");
      }
      setSelectedCategoryIds((prev) => prev.filter((entryId) => entryId !== id));
      await loadCategories();
      await loadExpenses();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete category");
    } finally {
      setCategoryBusy(false);
    }
  }

  async function addExpenseRow() {
    if (!activeUserId) {
      return;
    }
    setEntryBusy(true);
    setError("");
    try {
      const amount = Number(entryAmount);
      const categoryId = Number(entryCategoryId);
      const res = await fetch("/api/expenses/entries", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          date: entryDateInput,
          category_id: categoryId,
          item: entryItem.trim(),
          amount: Number.isFinite(amount) ? amount : 0,
          mode: entryMode,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to add expense");
      }
      setEntryItem("");
      setEntryAmount("");
      await loadExpenses();
      setShowFullTable(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add expense");
    } finally {
      setEntryBusy(false);
    }
  }

  function toggleFilterCategory(id: number) {
    setSelectedCategoryIds((prev) => (prev.includes(id) ? prev.filter((entryId) => entryId !== id) : [...prev, id]));
  }

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

  function toggleTheme() {
    setIsDark((prev) => !prev);
  }

  function applyQuickRange(preset: "today" | "this_week" | "last_week" | "this_month" | "last_month") {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (preset === "today") {
      const key = toDateKey(today);
      setFromDate(key);
      setToDate(key);
      return;
    }

    if (preset === "this_week") {
      const day = today.getDay(); // 0 Sun ... 6 Sat
      const offsetFromMonday = (day + 6) % 7;
      const start = new Date(today);
      start.setDate(today.getDate() - offsetFromMonday);
      setFromDate(toDateKey(start));
      setToDate(toDateKey(today));
      return;
    }

    if (preset === "last_week") {
      const day = today.getDay();
      const offsetFromMonday = (day + 6) % 7;
      const currentWeekStart = new Date(today);
      currentWeekStart.setDate(today.getDate() - offsetFromMonday);
      const lastWeekStart = new Date(currentWeekStart);
      lastWeekStart.setDate(currentWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(currentWeekStart);
      lastWeekEnd.setDate(currentWeekStart.getDate() - 1);
      setFromDate(toDateKey(lastWeekStart));
      setToDate(toDateKey(lastWeekEnd));
      return;
    }

    if (preset === "this_month") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setFromDate(toDateKey(start));
      setToDate(toDateKey(today));
      return;
    }

    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    setFromDate(toDateKey(start));
    setToDate(toDateKey(end));
  }

  function toggleCategoryManagerMode() {
    setShowCategoryManager((prev) => {
      const next = !prev;
      if (next) {
        setShowAddExpense(false);
        setShowFullTable(false);
      }
      return next;
    });
  }

  function toggleAddExpenseMode() {
    setShowAddExpense((prev) => {
      const next = !prev;
      if (next) {
        setShowCategoryManager(false);
        setShowFullTable(false);
        setSelectedCategoryIds([]);
        setFromDate(entryDateInput);
        setToDate(entryDateInput);
      }
      return next;
    });
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
    const fromQuery = new URLSearchParams(window.location.search).get("date");
    if (fromQuery && /^\d{4}-\d{2}-\d{2}$/.test(fromQuery)) {
      setFromDate(fromQuery);
      setToDate(fromQuery);
      setEntryDateInput(fromQuery);
    }
  }, []);

  useEffect(() => {
    if (!activeUserId) {
      return;
    }
    void loadAll();
  }, [activeUserId]);

  useEffect(() => {
    if (!activeUserId) {
      return;
    }
    void loadExpenses();
  }, [activeUserId, fromDate, toDate, selectedCategoryIds.join(",")]);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.isActive),
    [categories],
  );
  const addModeEntries = useMemo(
    () => entries.filter((entry) => entry.date === entryDateInput),
    [entries, entryDateInput],
  );

  if (!activeUserId) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">Please login on dashboard first to use Expenses.</p>
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
          title="Expenses"
          navItems={[
            { href: "/", label: "Dashboard", className: "rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-300" },
            { href: "/reports", label: "Reports", className: "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700" },
            { href: "/reports/daily-closing", label: "Daily Closing", className: "rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-800" },
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

        <section className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Expense Summary</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleCategoryManagerMode}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
              >
                {showCategoryManager ? "Hide Categories" : "Manage Categories"}
              </button>
              <button
                type="button"
                onClick={toggleAddExpenseMode}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                {showAddExpense ? "Hide Add Expense" : "Add Expense"}
              </button>
            </div>
          </div>

          {showCategoryManager ? (
            <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Category Manager</p>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void createCategory()}
                  disabled={categoryBusy}
                  className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {categories.map((category) => (
                  <div key={category.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                    {editingCategoryId === category.id ? (
                      <input
                        type="text"
                        value={editingCategoryName}
                        onChange={(e) => setEditingCategoryName(e.target.value)}
                        className="min-w-[180px] flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    ) : (
                      <p className={`min-w-[180px] flex-1 text-xs font-medium ${category.isActive ? "text-slate-900" : "text-slate-500 line-through"}`}>
                        {category.name}
                      </p>
                    )}
                    {editingCategoryId === category.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void updateCategory(category.id)}
                          disabled={categoryBusy}
                          className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCategoryId(null);
                            setEditingCategoryName("");
                          }}
                          className="rounded bg-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-800"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCategoryId(category.id);
                            setEditingCategoryName(category.name);
                          }}
                          className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleCategoryStatus(category.id, !category.isActive)}
                          disabled={categoryBusy}
                          className={`rounded px-2 py-1 text-[11px] font-semibold text-white ${
                            category.isActive ? "bg-amber-600" : "bg-emerald-700"
                          }`}
                        >
                          {category.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteCategory(category.id)}
                          disabled={categoryBusy}
                          className="rounded bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : showAddExpense ? (
            <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Add Expense Rows</p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-700">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Category</th>
                      <th className="px-2 py-1">Item</th>
                      <th className="px-2 py-1">Amount</th>
                      <th className="px-2 py-1">Mode</th>
                      <th className="px-2 py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-emerald-200">
                      <td className="px-2 py-1">
                        <input
                          type="date"
                          value={entryDateInput}
                          onChange={(e) => {
                            const value = e.target.value;
                            setEntryDateInput(value);
                            setFromDate(value);
                            setToDate(value);
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={entryCategoryId}
                          onChange={(e) => setEntryCategoryId(e.target.value)}
                          className="w-full rounded border border-slate-300 px-2 py-1"
                        >
                          <option value="">Select</option>
                          {activeCategories.map((category) => (
                            <option key={category.id} value={String(category.id)}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={entryItem}
                          onChange={(e) => setEntryItem(e.target.value)}
                          placeholder="Item"
                          className="w-full rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          value={entryAmount}
                          onChange={(e) => setEntryAmount(e.target.value)}
                          placeholder="Amount"
                          className="w-full rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={entryMode}
                          onChange={(e) => setEntryMode(e.target.value as "cash" | "bank")}
                          className="w-full rounded border border-slate-300 px-2 py-1"
                        >
                          <option value="cash">Cash</option>
                          <option value="bank">Bank</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          onClick={() => void addExpenseRow()}
                          disabled={entryBusy}
                          className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {entryBusy ? "Adding..." : "Add Row"}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-emerald-800">Added rows auto-capture user and time.</p>
              <div className="mt-3 overflow-x-auto rounded-md border border-emerald-200 bg-white">
                <div className="border-b border-emerald-200 bg-emerald-100 px-2 py-2 text-xs font-semibold text-emerald-900">
                  Entries for {entryDateInput}
                </div>
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold">Category</th>
                      <th className="px-2 py-2 text-left font-semibold">Item</th>
                      <th className="px-2 py-2 text-left font-semibold">Mode</th>
                      <th className="px-2 py-2 text-right font-semibold">Amount</th>
                      <th className="px-2 py-2 text-left font-semibold">Added By</th>
                      <th className="px-2 py-2 text-left font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="px-2 py-3 text-center text-slate-500">Loading...</td></tr>
                    ) : addModeEntries.length === 0 ? (
                      <tr><td colSpan={6} className="px-2 py-3 text-center text-slate-500">No entries for this day.</td></tr>
                    ) : addModeEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-slate-200">
                        <td className="px-2 py-2">{entry.category_name}</td>
                        <td className="px-2 py-2">{entry.item}</td>
                        <td className="px-2 py-2">{entry.mode === "cash" ? "Cash" : "Bank"}</td>
                        <td className="px-2 py-2 text-right font-semibold">₹{entry.amount}</td>
                        <td className="px-2 py-2">{entry.created_by_user_name}</td>
                        <td className="px-2 py-2">{formatDateTime(entry.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <label className="text-xs font-semibold text-slate-700">
                  From
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  To
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                </label>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                  <p className="flex items-center justify-between"><span>Cash</span><span className="font-semibold">₹{cashTotal}</span></p>
                  <p className="flex items-center justify-between"><span>Bank</span><span className="font-semibold">₹{bankTotal}</span></p>
                  <p className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1 font-bold text-slate-900"><span>Total Expense</span><span>₹{totalExpense}</span></p>
                </div>
              </div>

              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Quick Filters</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyQuickRange("today")}
                    className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickRange("this_week")}
                    className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                  >
                    This Week
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickRange("last_week")}
                    className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                  >
                    Last Week
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickRange("this_month")}
                    className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                  >
                    This Month
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickRange("last_month")}
                    className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                  >
                    Last Month
                  </button>
                </div>
              </div>

              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Filter by Categories</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {activeCategories.length === 0 ? (
                    <p className="text-xs text-slate-500">No active categories yet.</p>
                  ) : activeCategories.map((category) => {
                    const selected = selectedCategoryIds.includes(category.id);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleFilterCategory(category.id)}
                        className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                          selected ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-300"
                        }`}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 rounded-md border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Category Totals</p>
                  <button
                    type="button"
                    onClick={() => setShowFullTable((prev) => !prev)}
                    className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-900"
                  >
                    {showFullTable ? "Hide Full Table" : "View Full Table"}
                  </button>
                </div>
                <div className="p-2">
                  {loading ? (
                    <p className="text-xs text-slate-500">Loading...</p>
                  ) : categoryTotals.length === 0 ? (
                    <p className="text-xs text-slate-500">No expenses in selected filters.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {categoryTotals.map((row) => (
                        <div key={row.category_id} className="rounded border border-slate-200 bg-white p-2 text-xs">
                          <p className="font-semibold text-slate-800">{row.category_name}</p>
                          <p className="mt-1 text-base font-bold text-slate-900">₹{row.total}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {showFullTable ? (
                <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold">Date</th>
                        <th className="px-2 py-2 text-left font-semibold">Category</th>
                        <th className="px-2 py-2 text-left font-semibold">Item</th>
                        <th className="px-2 py-2 text-left font-semibold">Mode</th>
                        <th className="px-2 py-2 text-right font-semibold">Amount</th>
                        <th className="px-2 py-2 text-left font-semibold">Added By</th>
                        <th className="px-2 py-2 text-left font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-500">Loading...</td></tr>
                      ) : entries.length === 0 ? (
                        <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-500">No entries for selected filters.</td></tr>
                      ) : entries.map((entry) => (
                        <tr key={entry.id} className="border-t border-slate-200">
                          <td className="px-2 py-2">{entry.date}</td>
                          <td className="px-2 py-2">{entry.category_name}</td>
                          <td className="px-2 py-2">{entry.item}</td>
                          <td className="px-2 py-2">{entry.mode === "cash" ? "Cash" : "Bank"}</td>
                          <td className="px-2 py-2 text-right font-semibold">₹{entry.amount}</td>
                          <td className="px-2 py-2">{entry.created_by_user_name}</td>
                          <td className="px-2 py-2">{formatDateTime(entry.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
