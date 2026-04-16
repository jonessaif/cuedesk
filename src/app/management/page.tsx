"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ActiveUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
  isActive?: boolean;
};

type TableRow = {
  id: number;
  name: string;
  ratePerMin: number;
  state: string;
  sectionId?: number | null;
  sectionName?: string | null;
};

type AppUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
  isActive: boolean;
};

type SectionRow = {
  id: number;
  name: string;
};

function isHourlyTableName(name: string): boolean {
  return name.trim().toUpperCase().startsWith("PS");
}

function toDisplayRate(ratePerMin: number, unit: "minute" | "hour"): number {
  if (unit === "hour") {
    return Math.round(ratePerMin * 60);
  }
  return Math.round(ratePerMin);
}

export default function ManagementPage() {
  const router = useRouter();
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);

  const [tables, setTables] = useState<TableRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const [newTableName, setNewTableName] = useState("");
  const [newTableRate, setNewTableRate] = useState("");
  const [newTableRateUnit, setNewTableRateUnit] = useState<"minute" | "hour">("minute");
  const [newTableSectionId, setNewTableSectionId] = useState("");
  const [tableBusyId, setTableBusyId] = useState<number | null>(null);
  const [editingTableId, setEditingTableId] = useState<number | null>(null);
  const [editingTableName, setEditingTableName] = useState("");
  const [editingTableRate, setEditingTableRate] = useState("");
  const [editingTableRateUnit, setEditingTableRateUnit] = useState<"minute" | "hour">("minute");
  const [editingTableSectionId, setEditingTableSectionId] = useState("");

  const [newSectionName, setNewSectionName] = useState("");
  const [sectionBusyId, setSectionBusyId] = useState<number | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");

  const [newUserName, setNewUserName] = useState("");
  const [newUserPin, setNewUserPin] = useState("");
  const [newUserRole, setNewUserRole] = useState<"operator" | "admin">("operator");
  const [userBusyId, setUserBusyId] = useState<number | null>(null);
  const [ledgerResetTime, setLedgerResetTime] = useState("10:00");
  const [ledgerResetBusy, setLedgerResetBusy] = useState(false);

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

  async function loadAll() {
    if (!activeUserId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [tablesRes, usersRes, sectionsRes, settingsRes] = await Promise.all([
        fetch("/api/tables", { cache: "no-store", headers: authHeaders() }),
        fetch("/api/users", { cache: "no-store", headers: authHeaders() }),
        fetch("/api/table-sections", { cache: "no-store", headers: authHeaders() }),
        fetch("/api/settings/ledger-reset", { cache: "no-store", headers: authHeaders() }),
      ]);

      const tablesData = await readJsonSafe<{ data?: TableRow[]; error?: string }>(tablesRes);
      const usersData = await readJsonSafe<{ data?: AppUser[]; error?: string }>(usersRes);
      const sectionsData = await readJsonSafe<{ data?: SectionRow[]; error?: string }>(sectionsRes);
      const settingsData = await readJsonSafe<{ data?: { ledgerResetTime?: string }; error?: string }>(settingsRes);

      if (!tablesRes.ok) {
        throw new Error(tablesData?.error ?? "Failed to fetch tables");
      }
      if (!usersRes.ok) {
        throw new Error(usersData?.error ?? "Failed to fetch users");
      }
      if (!sectionsRes.ok) {
        throw new Error(sectionsData?.error ?? "Failed to fetch sections");
      }
      if (!settingsRes.ok) {
        throw new Error(settingsData?.error ?? "Failed to fetch settings");
      }

      setTables(tablesData?.data ?? []);
      setUsers(usersData?.data ?? []);
      setSections(sectionsData?.data ?? []);
      const loadedResetTime = settingsData?.data?.ledgerResetTime;
      if (typeof loadedResetTime === "string" && /^\d{2}:\d{2}$/.test(loadedResetTime)) {
        setLedgerResetTime(loadedResetTime);
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to load management data";
      setError(text);
    } finally {
      setLoading(false);
    }
  }

  async function createTable() {
    const name = newTableName.trim();
    const enteredRate = Number(newTableRate);
    if (!name || !Number.isFinite(enteredRate) || enteredRate <= 0) {
      setError("Enter valid table name and rate");
      return;
    }
    if (!newTableSectionId) {
      setError("Please select a section");
      return;
    }
    const ratePerMin = newTableRateUnit === "hour" ? enteredRate / 60 : enteredRate;
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name,
          ratePerMin,
          sectionId: newTableSectionId ? Number(newTableSectionId) : undefined,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to create table");
      }
      setMessage("Table created");
      setNewTableName("");
      setNewTableRate("");
      setNewTableRateUnit("minute");
      setNewTableSectionId("");
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to create table";
      setError(text);
    }
  }

  function startEditTable(row: TableRow) {
    const asHourly = isHourlyTableName(row.name);
    setEditingTableId(row.id);
    setEditingTableName(row.name);
    setEditingTableRateUnit(asHourly ? "hour" : "minute");
    setEditingTableRate(String(toDisplayRate(row.ratePerMin, asHourly ? "hour" : "minute")));
    setEditingTableSectionId(row.sectionId ? String(row.sectionId) : "");
  }

  async function saveEditTable(tableId: number) {
    const name = editingTableName.trim();
    const enteredRate = Number(editingTableRate);
    if (!name || !Number.isFinite(enteredRate) || enteredRate <= 0) {
      setError("Enter valid table name and rate");
      return;
    }
    const ratePerMin = editingTableRateUnit === "hour" ? enteredRate / 60 : enteredRate;
    setTableBusyId(tableId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/tables/${tableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name,
          ratePerMin,
          sectionId: editingTableSectionId ? Number(editingTableSectionId) : null,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update table");
      }
      setMessage("Table updated");
      setEditingTableId(null);
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to update table";
      setError(text);
    } finally {
      setTableBusyId(null);
    }
  }

  async function deleteTable(tableId: number) {
    if (!window.confirm("Delete this table?")) {
      return;
    }
    setTableBusyId(tableId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/tables/${tableId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to delete table");
      }
      setMessage("Table deleted");
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to delete table";
      setError(text);
    } finally {
      setTableBusyId(null);
    }
  }

  async function createSection() {
    const name = newSectionName.trim();
    if (!name) {
      setError("Section name is required");
      return;
    }
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/table-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to create section");
      }
      setMessage("Section created");
      setNewSectionName("");
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to create section";
      setError(text);
    }
  }

  function startEditSection(row: SectionRow) {
    setEditingSectionId(row.id);
    setEditingSectionName(row.name);
  }

  async function saveSection(sectionId: number) {
    const name = editingSectionName.trim();
    if (!name) {
      setError("Section name is required");
      return;
    }
    setSectionBusyId(sectionId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/table-sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update section");
      }
      setMessage("Section updated");
      setEditingSectionId(null);
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to update section";
      setError(text);
    } finally {
      setSectionBusyId(null);
    }
  }

  async function deleteSection(sectionId: number) {
    if (!window.confirm("Delete this section?")) {
      return;
    }
    setSectionBusyId(sectionId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/table-sections/${sectionId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to delete section");
      }
      setMessage("Section deleted");
      if (editingSectionId === sectionId) {
        setEditingSectionId(null);
      }
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to delete section";
      setError(text);
    } finally {
      setSectionBusyId(null);
    }
  }

  async function saveLedgerResetTime() {
    if (!/^\d{2}:\d{2}$/.test(ledgerResetTime)) {
      setError("Invalid ledger reset time");
      return;
    }
    setLedgerResetBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/settings/ledger-reset", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ledgerResetTime }),
      });
      const data = await readJsonSafe<{ data?: { ledgerResetTime?: string }; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update ledger reset time");
      }
      const updated = data?.data?.ledgerResetTime;
      if (typeof updated === "string" && /^\d{2}:\d{2}$/.test(updated)) {
        setLedgerResetTime(updated);
      }
      setMessage("Ledger reset time updated");
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to update ledger reset time";
      setError(text);
    } finally {
      setLedgerResetBusy(false);
    }
  }

  async function createUser() {
    const name = newUserName.trim();
    const pin = newUserPin.trim();
    if (!name || !/^\d{4}$/.test(pin)) {
      setError("Enter user name and valid 4-digit PIN");
      return;
    }
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name, pin, role: newUserRole, isActive: true }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to create user");
      }
      setMessage("User created");
      setNewUserName("");
      setNewUserPin("");
      setNewUserRole("operator");
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to create user";
      setError(text);
    }
  }

  async function updateUser(
    userId: number,
    payload: { role?: "operator" | "admin"; isActive?: boolean },
  ) {
    setUserBusyId(userId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update user");
      }
      setMessage("User updated");
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to update user";
      setError(text);
    } finally {
      setUserBusyId(null);
    }
  }

  async function deleteUser(userId: number, name: string) {
    if (!window.confirm(`Delete ${name}?`)) {
      return;
    }
    setUserBusyId(userId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to delete user");
      }
      setMessage("User deleted");
      await loadAll();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to delete user";
      setError(text);
    } finally {
      setUserBusyId(null);
    }
  }

  function logout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cuedesk-active-user");
      window.location.href = "/";
    }
  }

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
      setAuthReady(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ActiveUser;
      if (parsed?.id) {
        setActiveUser(parsed);
        setActiveUserId(parsed.id);
      }
    } catch {
      // ignore malformed cached auth
    } finally {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    if (!activeUserId || activeUser?.role !== "admin") {
      return;
    }
    void loadAll();
  }, [activeUserId, activeUser?.role]);

  useEffect(() => {
    if (!authReady || !activeUserId || activeUser?.role === "admin") {
      return;
    }
    router.replace("/access-denied?from=management");
  }, [activeUser?.role, activeUserId, authReady, router]);

  if (!authReady) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <p className="text-sm text-slate-600">Checking access...</p>
        </div>
      </main>
    );
  }

  if (!activeUserId) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Login Required</h1>
          <p className="mt-2 text-sm text-slate-600">Please login first to access Management.</p>
          <div className="mt-3 flex gap-2">
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

  if (activeUser?.role !== "admin") {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <h1 className="text-xl font-bold text-slate-900">Redirecting...</h1>
          <p className="mt-2 text-sm text-slate-600">This page is available only for admin users.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Management</h1>
          <div className="flex flex-wrap items-center gap-2">
            <p className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800">
              {activeUser.name} ({activeUser.role})
            </p>
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
          </div>
        </div>

        {error ? <p className="mb-3 rounded-md bg-red-100 p-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mb-3 rounded-md bg-emerald-100 p-2 text-sm text-emerald-700">{message}</p> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-md">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Table Management</h2>
              <button
                type="button"
                onClick={() => void loadAll()}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-900"
              >
                Refresh
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="Table name"
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              />
              <select
                value={newTableSectionId}
                onChange={(e) => setNewTableSectionId(e.target.value)}
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">Select section</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>{section.name}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newTableRate}
                  onChange={(e) => setNewTableRate(e.target.value)}
                  placeholder={newTableRateUnit === "hour" ? "Rate/hr" : "Rate/min"}
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="rounded border border-slate-300 px-2 py-2 text-sm"
                />
                <select
                  value={newTableRateUnit}
                  onChange={(e) => setNewTableRateUnit(e.target.value as "minute" | "hour")}
                  className="rounded border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="minute">/min</option>
                  <option value="hour">/hr</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => void createTable()}
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Add Table
              </button>
            </div>

            <div className="mt-3 max-h-[60vh] space-y-2 overflow-auto">
              {tables.map((table) => (
                <div key={table.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {editingTableId === table.id ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                      <input
                        value={editingTableName}
                        onChange={(e) => setEditingTableName(e.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-sm sm:col-span-2"
                      />
                      <select
                        value={editingTableSectionId}
                        onChange={(e) => setEditingTableSectionId(e.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="">No section</option>
                        {sections.map((section) => (
                          <option key={section.id} value={section.id}>{section.name}</option>
                        ))}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={editingTableRate}
                          onChange={(e) => setEditingTableRate(e.target.value)}
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                        <select
                          value={editingTableRateUnit}
                          onChange={(e) => setEditingTableRateUnit(e.target.value as "minute" | "hour")}
                          className="rounded border border-slate-300 px-2 py-1 text-sm"
                        >
                          <option value="minute">/min</option>
                          <option value="hour">/hr</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={tableBusyId === table.id}
                          onClick={() => void saveEditTable(table.id)}
                          className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTableId(null)}
                          className="rounded bg-slate-200 px-2 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{table.name}</p>
                        <p className="text-xs text-slate-600">
                          Section: {table.sectionName ?? "Other"} |{" "}
                          Rate: ₹{isHourlyTableName(table.name) ? Math.round(table.ratePerMin * 60) : Math.round(table.ratePerMin)}
                          {isHourlyTableName(table.name) ? "/hr" : "/min"} | State: {table.state}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={tableBusyId === table.id}
                          onClick={() => startEditTable(table)}
                          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-800 hover:bg-slate-300 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={tableBusyId === table.id}
                          onClick={() => void deleteTable(table.id)}
                          className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!loading && tables.length === 0 ? <p className="text-sm text-slate-600">No tables found.</p> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-md">
            <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="User name"
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              />
              <input
                value={newUserPin}
                onChange={(e) => setNewUserPin(e.target.value)}
                placeholder="PIN (4 digits)"
                inputMode="numeric"
                maxLength={4}
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as "operator" | "admin")}
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="operator">operator</option>
                <option value="admin">admin</option>
              </select>
              <button
                type="button"
                onClick={() => void createUser()}
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Add User
              </button>
            </div>

            <div className="mt-3 max-h-[60vh] space-y-2 overflow-auto">
              {users.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-600">#{user.id}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={user.role}
                      disabled={userBusyId === user.id}
                      onChange={(e) =>
                        void updateUser(user.id, { role: e.target.value as "operator" | "admin" })
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="operator">operator</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="button"
                      disabled={userBusyId === user.id}
                      onClick={() => void updateUser(user.id, { isActive: !user.isActive })}
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        user.isActive
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                      }`}
                    >
                      {user.isActive ? "Active" : "Inactive"}
                    </button>
                    <button
                      type="button"
                      disabled={userBusyId === user.id}
                      onClick={() => void deleteUser(user.id, user.name)}
                      className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {!loading && users.length === 0 ? <p className="text-sm text-slate-600">No users found.</p> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-md lg:col-span-2">
            <h2 className="text-lg font-semibold text-slate-900">Section Management</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="New section name"
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void createSection()}
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Add Section
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map((section) => (
                <div key={section.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {editingSectionId === section.id ? (
                    <div className="space-y-2">
                      <input
                        value={editingSectionName}
                        onChange={(e) => setEditingSectionName(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={sectionBusyId === section.id}
                          onClick={() => void saveSection(section.id)}
                          className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSectionId(null)}
                          className="rounded bg-slate-200 px-2 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{section.name}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEditSection(section)}
                          className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-800 hover:bg-slate-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={sectionBusyId === section.id}
                          onClick={() => void deleteSection(section.id)}
                          className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sections.length === 0 ? <p className="text-sm text-slate-600">No sections yet.</p> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-md lg:col-span-2">
            <h2 className="text-lg font-semibold text-slate-900">Ledger Reset Time</h2>
            <p className="mt-1 text-xs text-slate-600">
              Set the daily reset boundary (once every 24 hours). Example: 10:00 means business day runs 10:00 to next day 10:00.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="time"
                value={ledgerResetTime}
                onChange={(e) => setLedgerResetTime(e.target.value)}
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              />
              <button
                type="button"
                disabled={ledgerResetBusy}
                onClick={() => void saveLedgerResetTime()}
                className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {ledgerResetBusy ? "Saving..." : "Save Reset Time"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
