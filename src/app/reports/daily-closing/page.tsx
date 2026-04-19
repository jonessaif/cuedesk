"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { isNativeServerSetupAvailable, openNativeServerSetup } from "@/lib/native-server-setup";

type ActiveUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
};

type DailyClosingData = {
  date: string;
  opening_cash: number;
  opening_bank: number;
  sales_cash: number;
  sales_bank: number;
  food_sales_cash: number;
  food_sales_bank: number;
  food_sales_due: number;
  food_due_received_cash: number;
  food_due_received_bank: number;
  accessories_sales_cash: number;
  accessories_sales_bank: number;
  accessories_sales_due: number;
  due_received_cash: number;
  due_received_bank: number;
  expense_cash: number;
  expense_bank: number;
  new_due_total: number;
  closing_cash: number;
  closing_bank: number;
  total_sales: number;
  total_closing: number;
  total_opening_balance: number;
  total_expense: number;
  net_sale: number;
  is_today: boolean;
  can_edit: boolean;
  can_edit_opening: boolean;
  actual_cash: number | null;
  cash_difference: number | null;
};

function formatMoney(value: number | null | undefined): string {
  const safe = typeof value === "number" ? value : 0;
  return String(Math.round(safe));
}

function todayDateInputValue(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function DailyClosingPage() {
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [dailyClosingDate, setDailyClosingDate] = useState<string>(todayDateInputValue());
  const [dailyClosing, setDailyClosing] = useState<DailyClosingData | null>(null);
  const [dailyClosingLoading, setDailyClosingLoading] = useState(false);
  const [dailyClosingSaving, setDailyClosingSaving] = useState(false);
  const [dailyClosingError, setDailyClosingError] = useState<string>("");
  const [expenseCashInput, setExpenseCashInput] = useState<string>("0");
  const [expenseBankInput, setExpenseBankInput] = useState<string>("0");
  const [foodSalesCashInput, setFoodSalesCashInput] = useState<string>("0");
  const [foodSalesBankInput, setFoodSalesBankInput] = useState<string>("0");
  const [foodSalesDueInput, setFoodSalesDueInput] = useState<string>("0");
  const [foodDueReceivedCashInput, setFoodDueReceivedCashInput] = useState<string>("0");
  const [foodDueReceivedBankInput, setFoodDueReceivedBankInput] = useState<string>("0");
  const [accessoriesSalesCashInput, setAccessoriesSalesCashInput] = useState<string>("0");
  const [accessoriesSalesBankInput, setAccessoriesSalesBankInput] = useState<string>("0");
  const [accessoriesSalesDueInput, setAccessoriesSalesDueInput] = useState<string>("0");
  const [openingCashInput, setOpeningCashInput] = useState<string>("0");
  const [openingBankInput, setOpeningBankInput] = useState<string>("0");
  const [actualCashInput, setActualCashInput] = useState<string>("");

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

  function setDailyClosingForm(data: DailyClosingData) {
    setExpenseCashInput(String(Math.round(data.expense_cash)));
    setExpenseBankInput(String(Math.round(data.expense_bank)));
    setFoodSalesCashInput(String(Math.round(data.food_sales_cash)));
    setFoodSalesBankInput(String(Math.round(data.food_sales_bank)));
    setFoodSalesDueInput(String(Math.round(data.food_sales_due)));
    setFoodDueReceivedCashInput(String(Math.round(data.food_due_received_cash)));
    setFoodDueReceivedBankInput(String(Math.round(data.food_due_received_bank)));
    setAccessoriesSalesCashInput(String(Math.round(data.accessories_sales_cash)));
    setAccessoriesSalesBankInput(String(Math.round(data.accessories_sales_bank)));
    setAccessoriesSalesDueInput(String(Math.round(data.accessories_sales_due)));
    setOpeningCashInput(String(Math.round(data.opening_cash)));
    setOpeningBankInput(String(Math.round(data.opening_bank)));
    setActualCashInput(data.actual_cash == null ? "" : String(Math.round(data.actual_cash)));
  }

  async function loadDailyClosing(targetDate?: string) {
    if (!activeUserId) {
      return;
    }
    const date = targetDate ?? dailyClosingDate;
    setDailyClosingLoading(true);
    setDailyClosingError("");
    try {
      const res = await fetch(`/api/reports/daily-closing?date=${encodeURIComponent(date)}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ data?: DailyClosingData; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to load daily closing");
      }
      const next = data?.data ?? null;
      setDailyClosing(next);
      if (next) {
        setDailyClosingForm(next);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load daily closing";
      setDailyClosingError(message);
      setDailyClosing(null);
    } finally {
      setDailyClosingLoading(false);
    }
  }

  async function saveDailyClosing() {
    if (!activeUserId || !dailyClosing) {
      return;
    }
    setDailyClosingSaving(true);
    setDailyClosingError("");
    try {
      const parseNumber = (value: string): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const payload: {
        date: string;
        food_sales_cash: number;
        food_sales_bank: number;
        food_sales_due: number;
        food_due_received_cash: number;
        food_due_received_bank: number;
        accessories_sales_cash: number;
        accessories_sales_bank: number;
        accessories_sales_due: number;
        opening_cash?: number;
        opening_bank?: number;
        actual_cash?: number | null;
      } = {
        date: dailyClosing.date,
        food_sales_cash: parseNumber(foodSalesCashInput),
        food_sales_bank: parseNumber(foodSalesBankInput),
        food_sales_due: parseNumber(foodSalesDueInput),
        food_due_received_cash: parseNumber(foodDueReceivedCashInput),
        food_due_received_bank: parseNumber(foodDueReceivedBankInput),
        accessories_sales_cash: parseNumber(accessoriesSalesCashInput),
        accessories_sales_bank: parseNumber(accessoriesSalesBankInput),
        accessories_sales_due: parseNumber(accessoriesSalesDueInput),
        actual_cash: actualCashInput.trim() === "" ? null : parseNumber(actualCashInput),
      };
      if (dailyClosing.can_edit_opening) {
        payload.opening_cash = parseNumber(openingCashInput);
        payload.opening_bank = parseNumber(openingBankInput);
      }

      const res = await fetch("/api/reports/daily-closing", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await readJsonSafe<{ data?: DailyClosingData; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to save daily closing");
      }
      const next = data?.data ?? null;
      setDailyClosing(next);
      if (next) {
        setDailyClosingForm(next);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save daily closing";
      setDailyClosingError(message);
    } finally {
      setDailyClosingSaving(false);
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
    if (!activeUserId || !dailyClosingDate) {
      return;
    }
    void loadDailyClosing(dailyClosingDate);
  }, [activeUserId, dailyClosingDate]);

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("cuedesk-theme", next ? "dark" : "light");
      }
      return next;
    });
  }

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

  const parseInputNumber = (value: string): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const liveOpeningCash = dailyClosing
    ? (dailyClosing.can_edit_opening && dailyClosing.can_edit
      ? parseInputNumber(openingCashInput)
      : dailyClosing.opening_cash)
    : 0;
  const liveOpeningBank = dailyClosing
    ? (dailyClosing.can_edit_opening && dailyClosing.can_edit
      ? parseInputNumber(openingBankInput)
      : dailyClosing.opening_bank)
    : 0;
  const liveFoodSalesCash = parseInputNumber(foodSalesCashInput);
  const liveFoodSalesBank = parseInputNumber(foodSalesBankInput);
  const liveFoodSalesDue = parseInputNumber(foodSalesDueInput);
  const liveAccessoriesSalesCash = parseInputNumber(accessoriesSalesCashInput);
  const liveAccessoriesSalesBank = parseInputNumber(accessoriesSalesBankInput);
  const liveAccessoriesSalesDue = parseInputNumber(accessoriesSalesDueInput);
  const liveExpenseCash = dailyClosing?.expense_cash ?? 0;
  const liveExpenseBank = dailyClosing?.expense_bank ?? 0;
  const liveFoodDueReceivedCash = parseInputNumber(foodDueReceivedCashInput);
  const liveFoodDueReceivedBank = parseInputNumber(foodDueReceivedBankInput);
  const liveTableSalesTotal = dailyClosing
    ? dailyClosing.sales_cash + dailyClosing.sales_bank + dailyClosing.new_due_total
    : 0;
  const liveFoodSalesTotal = liveFoodSalesCash + liveFoodSalesBank + liveFoodSalesDue;
  const liveFoodDueReceivedTotal = liveFoodDueReceivedCash + liveFoodDueReceivedBank;
  const liveTableDueReceivedTotal = dailyClosing
    ? dailyClosing.due_received_cash + dailyClosing.due_received_bank
    : 0;
  const liveTotalDueReceived = liveTableDueReceivedTotal + liveFoodDueReceivedTotal;
  const liveAccessoriesSalesTotal = liveAccessoriesSalesCash + liveAccessoriesSalesBank + liveAccessoriesSalesDue;
  const liveTotalSales = liveTableSalesTotal + liveFoodSalesTotal + liveAccessoriesSalesTotal;
  const liveTotalDue = (dailyClosing?.new_due_total ?? 0) + liveFoodSalesDue + liveAccessoriesSalesDue;
  const liveTotalExpense = liveExpenseCash + liveExpenseBank;
  const liveNetSale = liveTotalSales - liveTotalExpense;
  const liveTotalOpeningBalance = liveOpeningCash + liveOpeningBank;
  const liveDueReceivedCash = dailyClosing?.due_received_cash ?? 0;
  const liveDueReceivedBank = dailyClosing?.due_received_bank ?? 0;
  const liveClosingCash = liveOpeningCash
    + (dailyClosing?.sales_cash ?? 0)
    + liveFoodSalesCash
    + liveAccessoriesSalesCash
    + liveDueReceivedCash
    + liveFoodDueReceivedCash
    - liveExpenseCash;
  const liveClosingBank = liveOpeningBank
    + (dailyClosing?.sales_bank ?? 0)
    + liveFoodSalesBank
    + liveAccessoriesSalesBank
    + liveDueReceivedBank
    + liveFoodDueReceivedBank
    - liveExpenseBank;
  const liveTotalClosing = liveClosingCash + liveClosingBank;
  const liveActualCash = actualCashInput.trim() === "" ? null : parseInputNumber(actualCashInput);
  const liveCashDifference = liveActualCash === null ? null : liveActualCash - liveClosingCash;

  if (!activeUserId) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">Please login on dashboard first to use Daily Closing.</p>
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
          title="Daily Closing"
          navItems={[
            {
              href: "/",
              label: "Dashboard",
              className: "rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-300",
            },
            {
              href: "/reports",
              label: "Reports",
              className: "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700",
            },
            {
              href: "/reports/customers",
              label: "Customers",
              className: "rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700",
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
          themeLabel={isDark ? "Light Theme" : "Dark Theme"}
          isDark={isDark}
        />

        {error ? <p className="mb-3 rounded-md bg-red-100 p-2 text-sm text-red-700">{error}</p> : null}

        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-emerald-900">Daily Closing</h3>
              <p className="text-[11px] text-emerald-700">Cash and bank closing with table sales, food sales, due recovery, and expenses.</p>
            </div>
            <label className="text-[11px] font-semibold text-slate-700">
              Date
              <input
                type="date"
                value={dailyClosingDate}
                onChange={(e) => setDailyClosingDate(e.target.value)}
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
          </div>

          {dailyClosingError ? (
            <p className="mt-2 rounded-md bg-red-100 px-2 py-1 text-xs text-red-700">{dailyClosingError}</p>
          ) : null}

          {dailyClosingLoading ? (
            <p className="mt-2 text-xs text-slate-600">Loading daily closing...</p>
          ) : null}

          {dailyClosing ? (
            <>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white p-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Opening Balance</p>
                  <div className="mt-1 grid gap-2 sm:grid-cols-3">
                    <label className="text-[11px] text-slate-700">
                      Opening Cash
                      <input
                        type="number"
                        value={openingCashInput}
                        onChange={(e) => setOpeningCashInput(e.target.value)}
                        disabled={!dailyClosing.can_edit_opening || !dailyClosing.can_edit}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-[11px] text-slate-700">
                      Opening Bank
                      <input
                        type="number"
                        value={openingBankInput}
                        onChange={(e) => setOpeningBankInput(e.target.value)}
                        disabled={!dailyClosing.can_edit_opening || !dailyClosing.can_edit}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:bg-slate-100"
                      />
                    </label>
                  </div>
                  {!dailyClosing.can_edit_opening ? (
                    <p className="mt-1 text-[10px] text-slate-500">Auto-filled from yesterday closing</p>
                  ) : null}
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Expense Register</p>
                  <div className="mt-1 space-y-1 text-slate-800">
                    <p className="flex items-center justify-between"><span>Expense Cash</span><span className="font-medium">₹{formatMoney(liveExpenseCash)}</span></p>
                    <p className="flex items-center justify-between"><span>Expense Bank</span><span className="font-medium">₹{formatMoney(liveExpenseBank)}</span></p>
                    <p className="flex items-center justify-between font-semibold text-slate-900"><span>Total Expense</span><span>₹{formatMoney(liveTotalExpense)}</span></p>
                  </div>
                  <div className="mt-2">
                    <Link
                      href={`/reports/expenses?date=${encodeURIComponent(dailyClosing.date)}`}
                      className="inline-flex rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                    >
                      Add / Manage Expenses
                    </Link>
                  </div>
                </div>
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Table Sale (Auto)</p>
                  <div className="mt-1 space-y-1 text-slate-800">
                    <p className="flex items-center justify-between"><span>Cash</span><span className="font-medium">₹{formatMoney(dailyClosing.sales_cash)}</span></p>
                    <p className="flex items-center justify-between"><span>UPI/Card</span><span className="font-medium">₹{formatMoney(dailyClosing.sales_bank)}</span></p>
                    <p className="flex items-center justify-between"><span>Due</span><span className="font-medium">₹{formatMoney(dailyClosing.new_due_total)}</span></p>
                    <p className="flex items-center justify-between font-semibold text-slate-900"><span>Total Sale</span><span>₹{formatMoney(liveTableSalesTotal)}</span></p>
                    <p className="my-1 border-t border-slate-200" />
                    <p className="flex items-center justify-between"><span>Due Received Cash</span><span className="font-medium">₹{formatMoney(dailyClosing.due_received_cash)}</span></p>
                    <p className="flex items-center justify-between"><span>Due Received UPI/Card</span><span className="font-medium">₹{formatMoney(dailyClosing.due_received_bank)}</span></p>
                    <p className="flex items-center justify-between font-semibold text-slate-900"><span>Total Due Received</span><span>₹{formatMoney(liveTableDueReceivedTotal)}</span></p>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Food Sales (Petpooja)</p>
                  <div className="mt-1 space-y-1 text-slate-800">
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>Cash</span>
                      <input
                        type="number"
                        value={foodSalesCashInput}
                        onChange={(e) => setFoodSalesCashInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>UPI/Card</span>
                      <input
                        type="number"
                        value={foodSalesBankInput}
                        onChange={(e) => setFoodSalesBankInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>Due</span>
                      <input
                        type="number"
                        value={foodSalesDueInput}
                        onChange={(e) => setFoodSalesDueInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <p className="flex items-center justify-between font-semibold text-slate-900">
                      <span>Total Sale</span>
                      <span>₹{formatMoney(liveFoodSalesTotal)}</span>
                    </p>
                    <p className="my-1 border-t border-slate-200" />
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>Due Received Cash</span>
                      <input
                        type="number"
                        value={foodDueReceivedCashInput}
                        onChange={(e) => setFoodDueReceivedCashInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>Due Received UPI/Card</span>
                      <input
                        type="number"
                        value={foodDueReceivedBankInput}
                        onChange={(e) => setFoodDueReceivedBankInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <p className="flex items-center justify-between font-semibold text-slate-900">
                      <span>Total Due Received</span>
                      <span>₹{formatMoney(liveFoodDueReceivedTotal)}</span>
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Accessories Sale</p>
                  <div className="mt-1 space-y-1 text-slate-800">
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>Cash</span>
                      <input
                        type="number"
                        value={accessoriesSalesCashInput}
                        onChange={(e) => setAccessoriesSalesCashInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>UPI/Card</span>
                      <input
                        type="number"
                        value={accessoriesSalesBankInput}
                        onChange={(e) => setAccessoriesSalesBankInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span>Due</span>
                      <input
                        type="number"
                        value={accessoriesSalesDueInput}
                        onChange={(e) => setAccessoriesSalesDueInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right disabled:bg-slate-100"
                      />
                    </label>
                    <p className="flex items-center justify-between font-semibold text-slate-900">
                      <span>Total</span>
                      <span>₹{formatMoney(liveAccessoriesSalesTotal)}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Summary</p>
                  <div className="mt-1 space-y-1 text-slate-800">
                    <p className="flex items-center justify-between"><span>Total Opening Balance</span><span className="font-medium">₹{formatMoney(liveTotalOpeningBalance)}</span></p>
                    <p className="flex items-center justify-between"><span>Total Sale</span><span className="font-medium">₹{formatMoney(liveTotalSales)}</span></p>
                    <p className="flex items-center justify-between"><span>Total Due</span><span className="font-medium">₹{formatMoney(liveTotalDue)}</span></p>
                    <p className="flex items-center justify-between"><span>Total Due Received</span><span className="font-medium">₹{formatMoney(liveTotalDueReceived)}</span></p>
                    <p className="flex items-center justify-between"><span>Total Expense</span><span className="font-medium">₹{formatMoney(liveTotalExpense)}</span></p>
                    <p className="flex items-center justify-between font-semibold text-slate-900"><span>Net Sale</span><span>₹{formatMoney(liveNetSale)}</span></p>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">Closing Balance (Computed)</p>
                  <div className="mt-1 space-y-1 text-slate-800">
                    <p className="flex items-center justify-between"><span>Closing Cash</span><span className="font-semibold text-emerald-800">₹{formatMoney(liveClosingCash)}</span></p>
                    <p className="flex items-center justify-between"><span>Closing Bank</span><span className="font-semibold text-indigo-800">₹{formatMoney(liveClosingBank)}</span></p>
                    <p className="flex items-center justify-between border-t border-slate-200 pt-1 text-sm font-bold text-slate-900"><span>Total Closing</span><span>₹{formatMoney(liveTotalClosing)}</span></p>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="text-[11px] text-slate-700">
                      Actual Physical Cash (optional)
                      <input
                        type="number"
                        value={actualCashInput}
                        onChange={(e) => setActualCashInput(e.target.value)}
                        disabled={!dailyClosing.can_edit}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:bg-slate-100"
                      />
                    </label>
                    <p className={`text-xs font-semibold ${liveCashDifference === null ? "text-slate-500" : liveCashDifference === 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      Cash Difference: {liveCashDifference === null ? "-" : `₹${formatMoney(liveCashDifference)}`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-600">
                  {dailyClosing.can_edit ? "Today is editable. Past dates are read-only." : "Past date is read-only."}
                </p>
                <button
                  type="button"
                  onClick={() => void saveDailyClosing()}
                  disabled={!dailyClosing.can_edit || dailyClosingSaving}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {dailyClosingSaving ? "Saving..." : "Save Daily Closing"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
