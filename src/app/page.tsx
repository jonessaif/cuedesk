"use client";

import { useEffect, useMemo, useState } from "react";

type TableRow = {
  id: number;
  name: string;
  ratePerMin: number;
  state: string;
  currentSession?: {
    id?: number;
    playerName?: string;
    startTime?: string;
    payerMode?: "none" | "single" | "split";
    payerData?: unknown;
  };
};

type SplitRow = {
  name: string;
  percentage: string;
};

type CompletedSessionRow = {
  id: number;
  tableName?: string;
  playerName?: string;
  durationMinutes?: number;
  amount: number;
  payerMode?: "none" | "single" | "split";
  payerData?: unknown;
};

type LedgerSessionRow = {
  id: number;
  billId: number | null;
  tableName: string;
  playerName: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  ratePerMin: number;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentModes: string[];
  state: "Running" | "Completed" | "Billed-Unpaid" | "Partially-Paid" | "Paid";
  payerMode: "none" | "single" | "split";
  payerData: unknown;
  overrideStartTime: string | null;
  overrideEndTime: string | null;
  overrideRatePerMin: number | null;
  overridePayerMode: "none" | "single" | "split" | null;
  overridePayerData: unknown;
  overrideStatus: "running" | "billed" | null;
  overridePaymentModes: PaymentMode[] | null;
};

type PaymentMode = "cash" | "upi" | "card" | "due";
type LifecycleState = "Free" | "Running" | "Completed" | "Billed" | "Paid";
type UnpaidBill = {
  id: number;
  totalAmount: number;
  discountType: "fixed" | "percent" | null;
  discountValue: number | null;
  discountedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  payments: Array<{ mode: PaymentMode; amount: number }>;
};

function isRunningState(state: string): boolean {
  return state.startsWith("Running");
}

function elapsedMinutes(startTime?: string): number {
  if (!startTime) {
    return 0;
  }

  const start = new Date(startTime);
  const diffMs = Date.now() - start.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 0) {
    return 0;
  }
  if (minutes > 720) {
    return 720;
  }
  return minutes;
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

function formatMoney(value: number | null | undefined): string {
  const safe = typeof value === "number" ? value : 0;
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(2);
}

const LIFECYCLE_ORDER: Record<LifecycleState, number> = {
  Free: 0,
  Running: 1,
  Completed: 2,
  Billed: 3,
  Paid: 4,
};

function toLifecycleState(state: LedgerSessionRow["state"]): LifecycleState {
  if (state === "Running") {
    return "Running";
  }
  if (state === "Completed") {
    return "Completed";
  }
  if (state === "Paid") {
    return "Paid";
  }
  return "Billed";
}

function canTransitionLifecycle(current: LifecycleState, next: LifecycleState): boolean {
  return LIFECYCLE_ORDER[next] <= LIFECYCLE_ORDER[current];
}

function formatRate(value: number | null | undefined, tableName?: string): string {
  const safe = typeof value === "number" ? value : 0;
  if ((tableName ?? "").toUpperCase().startsWith("PS")) {
    return `${formatMoney(safe * 60)}/hr`;
  }
  return `${formatMoney(safe)}/min`;
}

function toDateTimeLocalInput(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toSplitRows(data: unknown): SplitRow[] {
  if (!Array.isArray(data)) {
    return [
      { name: "", percentage: "" },
      { name: "", percentage: "" },
    ];
  }

  const rows = data.map((row) => ({
    name: typeof (row as { name?: unknown }).name === "string"
      ? ((row as { name?: string }).name ?? "")
      : "",
    percentage: typeof (row as { percentage?: unknown }).percentage === "number"
      ? String((row as { percentage?: number }).percentage ?? "")
      : "",
  }));

  return rows.length >= 2 ? rows : [{ name: "", percentage: "" }, { name: "", percentage: "" }];
}

function tableStateStripColor(state: string): string {
  return (
    {
      Free: "bg-green-500",
      "Running-NoPayer": "bg-red-500",
      "Running-Single": "bg-orange-500",
      "Running-Split": "bg-purple-500",
      Completed: "bg-blue-500",
      "Completed (Unbilled)": "bg-blue-500",
      Billed: "bg-slate-500",
    }[state] ?? "bg-gray-500"
  );
}

function tableStateLabel(state: string): string {
  if (state === "Billed") {
    return "Last session billed";
  }
  return state;
}

function ledgerRowColor(state: LedgerSessionRow["state"]): string {
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

function ledgerStatusText(state: LedgerSessionRow["state"]): string {
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

function formatPayer(
  payerMode: "none" | "single" | "split" | undefined,
  payerData: unknown,
): string {
  if (!payerMode || payerMode === "none") {
    return "No payer";
  }

  if (payerMode === "single") {
    const data = payerData as { name?: string } | undefined;
    return data?.name?.trim() ? data.name : "No payer";
  }

  const rows = Array.isArray(payerData)
    ? (payerData as Array<{ name?: string; percentage?: number }>)
    : [];
  const text = rows
    .map((row) => `${row.name ?? "-"} (${typeof row.percentage === "number" ? row.percentage : 0}%)`)
    .join(", ");
  return text || "No payer";
}

function payerDisplayText(table: TableRow): string {
  if (!isRunningState(table.state)) {
    return "";
  }

  if (table.state === "Running-NoPayer") {
    return "No payer assigned";
  }

  if (table.state === "Running-Single") {
    return `Payer: ${formatPayer("single", table.currentSession?.payerData)}`;
  }

  if (table.state === "Running-Split") {
    return `Split: ${formatPayer("split", table.currentSession?.payerData)}`;
  }

  return "";
}

export default function HomePage() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busyTableId, setBusyTableId] = useState<number | null>(null);
  const [startTable, setStartTable] = useState<TableRow | null>(null);
  const [startPlayerName, setStartPlayerName] = useState("");
  const [startTimeInput, setStartTimeInput] = useState("");
  const [endTable, setEndTable] = useState<TableRow | null>(null);
  const [endTimeInput, setEndTimeInput] = useState("");
  const [endPayerName, setEndPayerName] = useState("");
  const [payerTable, setPayerTable] = useState<TableRow | null>(null);
  const [payerMode, setPayerMode] = useState<"single" | "split">("single");
  const [singlePayerName, setSinglePayerName] = useState("");
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    { name: "", percentage: "" },
    { name: "", percentage: "" },
  ]);
  const [completedSessions, setCompletedSessions] = useState<CompletedSessionRow[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<number[]>([]);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [sessionsLedger, setSessionsLedger] = useState<LedgerSessionRow[]>([]);
  const [unpaidBills, setUnpaidBills] = useState<UnpaidBill[]>([]);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [billDiscountType, setBillDiscountType] = useState<"none" | "fixed" | "percent">(
    "none",
  );
  const [billDiscountValue, setBillDiscountValue] = useState("");
  const [discountDraftBillId, setDiscountDraftBillId] = useState<number | null>(null);
  const [discountBusy, setDiscountBusy] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<LedgerSessionRow | null>(null);
  const [overrideStartTime, setOverrideStartTime] = useState("");
  const [overrideEndTime, setOverrideEndTime] = useState("");
  const [overrideRatePerMin, setOverrideRatePerMin] = useState("");
  const [overridePayerMode, setOverridePayerMode] = useState<"none" | "single" | "split">(
    "none",
  );
  const [overrideSinglePayerName, setOverrideSinglePayerName] = useState("");
  const [overrideSplitRows, setOverrideSplitRows] = useState<SplitRow[]>([
    { name: "", percentage: "" },
    { name: "", percentage: "" },
  ]);
  const [overrideStatus, setOverrideStatus] = useState<"default" | "running" | "completed" | "billed">(
    "default",
  );
  const [overridePaymentModes, setOverridePaymentModes] = useState<PaymentMode[]>([]);
  const [overrideAdmin, setOverrideAdmin] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);

  async function readJsonSafe<T>(res: Response): Promise<T | null> {
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async function loadTables() {
    try {
      setError(null);
      const res = await fetch("/api/tables", { cache: "no-store" });
      const data = await readJsonSafe<{ data?: TableRow[]; error?: string }>(res);

      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch tables");
      }

      setTables(data?.data ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch tables";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCompletedSessions() {
    try {
      setBillingError(null);
      const res = await fetch("/api/sessions/completed", { cache: "no-store" });
      const data = await readJsonSafe<{ data?: CompletedSessionRow[]; error?: string }>(res);

      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch completed sessions");
      }

      const sorted = [...(data?.data ?? [])].sort((a, b) => b.id - a.id);
      setCompletedSessions(sorted);
      setSelectedSessionIds((prev) =>
        prev.filter((id) => sorted.some((row) => row.id === id)),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch completed sessions";
      setBillingError(message);
    }
  }

  async function loadUnpaidBills(): Promise<UnpaidBill[]> {
    try {
      const res = await fetch("/api/bill/unpaid", { cache: "no-store" });
      const data = await readJsonSafe<{ data?: UnpaidBill[]; error?: string }>(res);

      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch unpaid bills");
      }

      const rows = data?.data ?? [];
      setUnpaidBills(rows);
      setSelectedBillId((prev) => (prev !== null && rows.some((b) => b.id === prev) ? prev : null));
      return rows;
    } catch {
      setUnpaidBills([]);
      setSelectedBillId(null);
      return [];
    }
  }

  async function loadAllSessions() {
    try {
      const res = await fetch("/api/sessions/all", { cache: "no-store" });
      const data = await readJsonSafe<{ data?: LedgerSessionRow[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch session ledger");
      }
      setSessionsLedger(data?.data ?? []);
    } catch {
      setSessionsLedger([]);
    }
  }

  useEffect(() => {
    void loadTables();
    void loadCompletedSessions();
    void loadUnpaidBills();
    void loadAllSessions();
    const poll = setInterval(() => {
      void loadTables();
      void loadCompletedSessions();
      void loadUnpaidBills();
      void loadAllSessions();
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((v) => v + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const renderedTables = useMemo(() => tables, [tables, tick]);

  function openStartSession(table: TableRow) {
    setStartTable(table);
    setStartPlayerName("");
    setStartTimeInput("");
  }

  function closeStartSession() {
    setStartTable(null);
  }

  async function submitStartSession() {
    if (!startTable) {
      return;
    }

    const playerName = startPlayerName.trim();
    if (!playerName) {
      alert("Player name is required");
      return;
    }

    const tableId = startTable.id;
    const parsedStartTime = startTimeInput ? new Date(startTimeInput) : null;
    if (parsedStartTime && Number.isNaN(parsedStartTime.getTime())) {
      alert("Invalid start time format");
      return;
    }

    const optimisticStartTime = parsedStartTime
      ? parsedStartTime.toISOString()
      : new Date().toISOString();

    setTables((prev) =>
      prev.map((t) =>
        t.id === tableId
          ? {
              ...t,
              state: "Running-NoPayer",
              currentSession: {
                playerName,
                startTime: optimisticStartTime,
              },
            }
          : t,
      ),
    );

    setBusyTableId(tableId);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId,
          playerName,
          ...(parsedStartTime ? { startTime: parsedStartTime.toISOString() } : {}),
        }),
      });

      if (!res.ok) {
        const data = await readJsonSafe<{ error?: string }>(res);
        alert(data?.error ?? "Failed to start session");
        void loadTables();
        void loadAllSessions();
        return;
      }

      alert("Session started successfully");
      closeStartSession();
      void loadTables();
      void loadCompletedSessions();
      void loadAllSessions();
    } finally {
      setBusyTableId(null);
    }
  }

  function openEndSession(table: TableRow) {
    setEndTable(table);
    setEndTimeInput("");
    setEndPayerName(table.currentSession?.playerName ?? "");
  }

  function closeEndSession() {
    setEndTable(null);
  }

  async function submitEndSession() {
    if (!endTable) {
      return;
    }

    const tableId = endTable.id;
    const sessionId = endTable.currentSession?.id;
    if (!sessionId) {
      alert("Active session id is missing");
      return;
    }

    if (endTable.state === "Running-NoPayer") {
      const payerName = endPayerName.trim();
      if (!payerName) {
        alert("Payer is required to end session");
        return;
      }

      const payerRes = await fetch("/api/session/assign-payer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          payerMode: "single",
          payerData: { name: payerName },
        }),
      });

      if (!payerRes.ok) {
        const data = await readJsonSafe<{ error?: string }>(payerRes);
        alert(data?.error ?? "Failed to assign payer");
        return;
      }
    }

    let parsedEndTime: Date | null = null;
    if (endTimeInput) {
      parsedEndTime = new Date(endTimeInput);
      if (Number.isNaN(parsedEndTime.getTime())) {
        alert("Invalid end time format");
        return;
      }
    }

    // Stop timer immediately in UI while request completes.
    setTables((prev) =>
      prev.map((t) =>
        t.id === tableId
          ? {
              ...t,
              state: "Completed (Unbilled)",
              currentSession: undefined,
            }
          : t,
      ),
    );

    setBusyTableId(tableId);
    try {
      const res = await fetch("/api/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId,
          ...(parsedEndTime ? { endTime: parsedEndTime.toISOString() } : {}),
        }),
      });

      if (!res.ok) {
        const data = await readJsonSafe<{ error?: string }>(res);
        alert(data?.error ?? "Failed to end session");
        void loadTables();
        void loadAllSessions();
        return;
      }

      alert("Session ended successfully");
      closeEndSession();
      void loadTables();
      void loadCompletedSessions();
      void loadAllSessions();
    } finally {
      setBusyTableId(null);
    }
  }

  function openAssignPayer(table: TableRow) {
    setPayerTable(table);
    setPayerMode("single");
    setSinglePayerName(table.currentSession?.playerName ?? "");
    setSplitRows([
      { name: "", percentage: "" },
      { name: "", percentage: "" },
    ]);
  }

  function closeAssignPayer() {
    setPayerTable(null);
  }

  function updateSplitRow(index: number, next: SplitRow) {
    setSplitRows((prev) => prev.map((row, i) => (i === index ? next : row)));
  }

  function updateOverrideSplitRow(index: number, next: SplitRow) {
    setOverrideSplitRows((prev) => prev.map((row, i) => (i === index ? next : row)));
  }

  function toggleOverridePaymentMode(mode: PaymentMode) {
    setOverridePaymentModes((prev) =>
      prev.includes(mode) ? prev.filter((value) => value !== mode) : [...prev, mode],
    );
  }

  async function submitAssignPayer() {
    if (!payerTable) {
      return;
    }

    const sessionId = payerTable.currentSession?.id;
    if (!sessionId) {
      alert("Active session id is missing");
      return;
    }

    if (payerMode === "single" && singlePayerName.trim() === "") {
      alert("Payer name is required");
      return;
    }

    if (payerMode === "split") {
      const invalid = splitRows.some(
        (row) =>
          row.name.trim() === "" ||
          row.percentage.trim() === "" ||
          !Number.isFinite(Number(row.percentage)),
      );
      if (invalid) {
        alert("All split names and percentages must be valid");
        return;
      }
    }

    const payload =
      payerMode === "single"
        ? {
            sessionId,
            payerMode: "single",
            payerData: { name: singlePayerName.trim() },
          }
        : {
            sessionId,
            payerMode: "split",
            payerData: splitRows.map((row) => ({
              name: row.name.trim(),
              percentage: Number(row.percentage),
            })),
          };

    setBusyTableId(payerTable.id);
    try {
      const res = await fetch("/api/session/assign-payer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await readJsonSafe<{ error?: string }>(res);
        alert(data?.error ?? "Failed to assign payer");
        return;
      }

      alert("Payer assigned successfully");
      closeAssignPayer();
      void loadTables();
      void loadCompletedSessions();
      void loadAllSessions();
    } finally {
      setBusyTableId(null);
    }
  }

  const selectedTotalAmount = useMemo(() => {
    return completedSessions
      .filter((row) => selectedSessionIds.includes(row.id))
      .reduce((sum, row) => sum + row.amount, 0);
  }, [completedSessions, selectedSessionIds]);
  const selectedBill = useMemo(
    () => unpaidBills.find((bill) => bill.id === selectedBillId) ?? null,
    [unpaidBills, selectedBillId],
  );
  const sortedLedgerRows = useMemo(() => {
    const stateOrder: Record<LedgerSessionRow["state"], number> = {
      Running: 0,
      Completed: 1,
      "Billed-Unpaid": 2,
      "Partially-Paid": 3,
      Paid: 4,
    };

    return [...sessionsLedger].sort((a, b) => {
      const stateDiff = stateOrder[a.state] - stateOrder[b.state];
      if (stateDiff !== 0) {
        return stateDiff;
      }

      const billA = a.billId ?? -1;
      const billB = b.billId ?? -1;
      if (billA !== billB) {
        return billB - billA;
      }

      const startA = new Date(a.startTime).getTime();
      const startB = new Date(b.startTime).getTime();
      if (startA !== startB) {
        return startB - startA;
      }

      return b.id - a.id;
    });
  }, [sessionsLedger]);

  useEffect(() => {
    if (selectedBillId === null) {
      setBillDiscountType("none");
      setBillDiscountValue("");
      setDiscountDraftBillId(null);
      return;
    }

    if (discountDraftBillId === selectedBillId) {
      return;
    }

    const bill = unpaidBills.find((row) => row.id === selectedBillId);
    if (!bill) {
      return;
    }

    if (bill.discountType === "fixed" || bill.discountType === "percent") {
      setBillDiscountType(bill.discountType);
      setBillDiscountValue(String(bill.discountValue ?? 0));
    } else {
      setBillDiscountType("none");
      setBillDiscountValue("");
    }

    setDiscountDraftBillId(selectedBillId);
  }, [selectedBillId, unpaidBills, discountDraftBillId]);

  function toggleSessionSelection(sessionId: number) {
    setSelectedSessionIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId],
    );
  }

  async function createBill() {
    if (selectedSessionIds.length === 0) {
      return;
    }

    const ids = Array.from(new Set(selectedSessionIds));
    setBillingBusy(true);
    setBillingError(null);
    try {
      const res = await fetch("/api/bill/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIds: ids,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        setBillingError(data?.error ?? "Failed to create bill");
        return;
      }

      setSelectedSessionIds([]);
      await loadCompletedSessions();
      await loadTables();
      await loadUnpaidBills();
      await loadAllSessions();
      alert("Bill created successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create bill";
      setBillingError(message);
    } finally {
      setBillingBusy(false);
    }
  }

  async function addPayment() {
    if (paymentBusy) {
      return;
    }

    if (selectedBillId === null) {
      setPaymentError("No bill selected");
      return;
    }

    setPaymentBusy(true);
    setPaymentError(null);
    setPaymentSuccess(null);

    try {
      const res = await fetch("/api/payment/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billId: selectedBillId,
          amount: Number(paymentAmount),
          mode: paymentMode,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        setPaymentError(data?.error ?? "Failed to add payment");
        return;
      }

      setPaymentSuccess("Payment added successfully");
      setPaymentAmount("");
      await loadAllSessions();
      const rows = await loadUnpaidBills();
      if (!rows.some((bill) => bill.id === selectedBillId)) {
        setSelectedBillId(null);
      }
      alert("Payment added successfully");
    } catch {
      setPaymentError("Failed to add payment");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function applyBillDiscount() {
    if (!selectedBill || discountBusy) {
      return;
    }

    const parsedValue = billDiscountType === "none" ? undefined : Number(billDiscountValue);

    if (
      billDiscountType !== "none" &&
      (parsedValue === undefined || !Number.isFinite(parsedValue) || parsedValue < 0)
    ) {
      setPaymentError("Invalid discount value");
      return;
    }

    if (billDiscountType === "percent" && parsedValue !== undefined && parsedValue > 100) {
      setPaymentError("Percent discount cannot exceed 100");
      return;
    }

    setDiscountBusy(true);
    setPaymentError(null);
    setPaymentSuccess(null);

    try {
      const res = await fetch("/api/bill/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billId: selectedBill.id,
          discountType: billDiscountType === "none" ? undefined : billDiscountType,
          discountValue: parsedValue,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        setPaymentError(data?.error ?? "Failed to apply discount");
        return;
      }

      setPaymentSuccess("Discount updated successfully");
      await loadUnpaidBills();
      await loadAllSessions();
      setDiscountDraftBillId(null);
    } finally {
      setDiscountBusy(false);
    }
  }

  function openOverrideModal(session: LedgerSessionRow) {
    setEditingSession(session);
    setOverrideStartTime(
      toDateTimeLocalInput(session.overrideStartTime),
    );
    setOverrideEndTime(
      toDateTimeLocalInput(session.overrideEndTime),
    );
    setOverrideRatePerMin(
      session.overrideRatePerMin !== null ? String(session.overrideRatePerMin) : "",
    );
    setOverrideStatus(session.overrideStatus ?? "default");
    setOverrideAdmin(false);
    setOverridePaymentModes(session.overridePaymentModes ?? []);
    setOverridePayerMode(session.overridePayerMode ?? "none");
    if (session.overridePayerMode === "single") {
      const name = (session.overridePayerData as { name?: string } | null | undefined)?.name ?? "";
      setOverrideSinglePayerName(name);
      setOverrideSplitRows([
        { name: "", percentage: "" },
        { name: "", percentage: "" },
      ]);
    } else if (session.overridePayerMode === "split") {
      setOverrideSplitRows(toSplitRows(session.overridePayerData));
      setOverrideSinglePayerName("");
    } else {
      setOverrideSinglePayerName("");
      setOverrideSplitRows([
        { name: "", percentage: "" },
        { name: "", percentage: "" },
      ]);
    }
  }

  function closeOverrideModal() {
    setEditingSession(null);
  }

  async function submitSessionOverride() {
    if (!editingSession || overrideBusy) {
      return;
    }

    const startRaw = overrideStartTime.trim();
    const endRaw = overrideEndTime.trim();
    const rateRaw = overrideRatePerMin.trim();

    const startDate = startRaw ? new Date(startRaw) : undefined;
    const endDate = endRaw ? new Date(endRaw) : undefined;
    const rate = rateRaw ? Number(rateRaw) : undefined;

    if (startDate && Number.isNaN(startDate.getTime())) {
      alert("Please enter a valid start time");
      return;
    }

    if (endDate && Number.isNaN(endDate.getTime())) {
      alert("Please enter a valid end time");
      return;
    }

    if (startDate && endDate && endDate.getTime() <= startDate.getTime()) {
      alert("End time must be after start time");
      return;
    }

    if (rate !== undefined && (!Number.isFinite(rate) || rate <= 0)) {
      alert("Rate must be greater than 0");
      return;
    }

    let overridePayerData: unknown = null;
    let includePayerOverride = false;
    if (editingSession.overridePayerMode !== null || editingSession.overridePayerData !== null) {
      includePayerOverride = true;
    }

    if (overridePayerMode === "single") {
      const name = overrideSinglePayerName.trim();
      if (!name) {
        alert("Single payer name is required");
        return;
      }
      overridePayerData = { name };
      includePayerOverride = true;
    }

    if (overridePayerMode === "split") {
      const invalid = overrideSplitRows.some(
        (row) =>
          row.name.trim() === "" ||
          row.percentage.trim() === "" ||
          !Number.isFinite(Number(row.percentage)),
      );
      if (invalid) {
        alert("All split names and percentages must be valid");
        return;
      }

      const splitData = overrideSplitRows.map((row) => ({
        name: row.name.trim(),
        percentage: Number(row.percentage),
      }));
      const total = splitData.reduce((sum, row) => sum + row.percentage, 0);
      if (total !== 100) {
        alert("Split percentage must sum to 100");
        return;
      }
      overridePayerData = splitData;
      includePayerOverride = true;
    }

    if (overridePayerMode === "none" && includePayerOverride) {
      overridePayerData = null;
    }

    const payload: Record<string, unknown> = {
      sessionId: editingSession.id,
    };

    if (startDate) {
      payload.overrideStartTime = startDate.toISOString();
    }
    if (endDate) {
      payload.overrideEndTime = endDate.toISOString();
    }
    if (rate !== undefined) {
      payload.overrideRatePerMin = rate;
    }
    if (overrideStatus !== "default" || editingSession.overrideStatus !== null) {
      payload.overrideStatus = overrideStatus;
    }
    if (overrideAdmin) {
      payload.adminOverride = true;
    }
    if (includePayerOverride) {
      payload.overridePayerMode = overridePayerMode;
      payload.overridePayerData = overridePayerData;
    }
    if (overridePaymentModes.length > 0 || editingSession.overridePaymentModes !== null) {
      payload.overridePaymentModes = overridePaymentModes;
    }

    setOverrideBusy(true);
    try {
      const res = await fetch("/api/session/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        alert(data?.error ?? "Failed to update session override");
        return;
      }

      alert("Session override updated");
      closeOverrideModal();
      await loadAllSessions();
      await loadTables();
      await loadCompletedSessions();
      await loadUnpaidBills();
    } finally {
      setOverrideBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-4 text-2xl font-bold text-slate-900">CueDesk Dashboard</h1>

        {error ? (
          <p className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loading ? <p className="text-slate-600">Loading tables...</p> : null}

        <div className="flex flex-col gap-6 lg:flex-row">
          <section className="flex-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {renderedTables.map((table) => {
                const running = isRunningState(table.state);
                const minutes = elapsedMinutes(table.currentSession?.startTime);
                const payerText = payerDisplayText(table);
                const statusText = tableStateLabel(table.state);
                const canStartSession = !running;

                return (
                  <article
                    key={table.id}
                    className="overflow-hidden rounded-xl border border-slate-300 bg-white p-5 shadow-md transition hover:shadow-lg"
                  >
                    <div
                      className={`-mt-5 mb-4 h-1.5 w-full ${tableStateStripColor(table.state)}`}
                    />
                    <h2 className="text-lg font-semibold text-slate-900">{table.name}</h2>
                    <p className="mt-1 text-sm text-slate-700">
                      Rate: {formatRate(table.ratePerMin, table.name)}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">Status: {statusText}</p>

                    {running ? (
                      <>
                        <p className="mt-2 text-sm text-slate-800">
                          Player: {table.currentSession?.playerName ?? "-"}
                        </p>
                        <p className="mt-1 text-sm text-slate-800">Timer: {minutes} min</p>
                        <p className="mt-1 text-sm text-slate-800">{payerText}</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => openEndSession(table)}
                            disabled={busyTableId === table.id}
                            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                          >
                            End Session
                          </button>
                          <button
                            type="button"
                            onClick={() => openAssignPayer(table)}
                            disabled={busyTableId === table.id}
                            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900"
                          >
                            Assign Payer
                          </button>
                        </div>
                      </>
                    ) : canStartSession ? (
                      <button
                        type="button"
                        onClick={() => openStartSession(table)}
                        disabled={busyTableId === table.id}
                        className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        Start Session
                      </button>
                    ) : null}

                    {table.state === "Billed" ? (
                      <p className="mt-2 text-xs font-medium text-slate-600">Last session billed</p>
                    ) : null}
                    {table.state === "Free" ? (
                      <p className="mt-2 text-xs font-medium text-slate-600">Table is available</p>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <section className="mt-6 rounded-xl border border-slate-300 bg-white p-4 shadow-md">
              <h2 className="text-lg font-semibold text-slate-900">Session Ledger</h2>
              <div className="mt-3 max-h-[420px] overflow-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2 py-2">Bill</th>
                      <th className="px-2 py-2">Table</th>
                      <th className="px-2 py-2">Player</th>
                      <th className="px-2 py-2">Start</th>
                      <th className="px-2 py-2">End</th>
                      <th className="px-2 py-2">Duration</th>
                      <th className="px-2 py-2">Rate</th>
                      <th className="px-2 py-2">Amount</th>
                      <th className="px-2 py-2">Paid</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Mode</th>
                      <th className="px-2 py-2">Payer</th>
                      <th className="px-2 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLedgerRows.map((row, index) => {
                      const modeText = row.paymentModes?.length
                        ? row.paymentModes.join(", ")
                        : "-";
                      const prev = index > 0 ? sortedLedgerRows[index - 1] : null;
                      const groupDivider = prev && prev.billId !== row.billId
                        ? "border-t-4 border-slate-300"
                        : "";

                      return (
                      <tr key={row.id} className={`${ledgerRowColor(row.state)} ${groupDivider}`}>
                        <td className="px-2 py-2">{row.billId ? `Bill #${row.billId}` : "-"}</td>
                        <td className="px-2 py-2">{row.tableName}</td>
                        <td className="px-2 py-2">{row.playerName}</td>
                        <td className="px-2 py-2">{formatTimeHHmm(row.startTime)}</td>
                        <td className="px-2 py-2">{formatTimeHHmm(row.endTime)}</td>
                        <td className="px-2 py-2">{row.durationMinutes} min</td>
                        <td className="px-2 py-2">{formatRate(row.ratePerMin, row.tableName)}</td>
                        <td className="px-2 py-2">{formatMoney(row.amount)}</td>
                        <td className="px-2 py-2">{formatMoney(row.paidAmount)}</td>
                        <td className="px-2 py-2">{ledgerStatusText(row.state)}</td>
                        <td className="px-2 py-2">{modeText}</td>
                        <td className="px-2 py-2">{formatPayer(row.payerMode, row.payerData)}</td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => openOverrideModal(row)}
                            className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-900"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                    {sortedLedgerRows.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-slate-500" colSpan={13}>
                          No sessions in ledger
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <aside className="w-full space-y-6 lg:w-[350px]">
            <section className="flex max-h-[480px] flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-md">
              <h2 className="text-xl font-semibold text-slate-900">Billing Panel</h2>
              <p className="mt-1 text-sm text-slate-600">Completed sessions (unbilled)</p>

              {billingError && <p className="mb-2 mt-2 text-sm text-red-600">{billingError}</p>}

              <div className="mt-3 flex-1 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-700">
                      <th className="py-2 pr-3">Select</th>
                      <th className="py-2 pr-3">Table</th>
                      <th className="py-2 pr-3">Player</th>
                      <th className="py-2 pr-3">Duration</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2 pr-3">Payer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedSessions.map((row) => {
                      const selected = selectedSessionIds.includes(row.id);
                      return (
                      <tr
                        key={row.id}
                        onClick={() => toggleSessionSelection(row.id)}
                        className={`cursor-pointer border-b border-slate-100 hover:bg-slate-100 ${
                          selected ? "bg-indigo-50" : ""
                        }`}
                      >
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={selectedSessionIds.includes(row.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSessionSelection(row.id)}
                          />
                        </td>
                        <td className="py-2 pr-3">{row.tableName ?? "-"}</td>
                        <td className="py-2 pr-3">{row.playerName ?? "-"}</td>
                        <td className="py-2 pr-3">
                          {typeof row.durationMinutes === "number"
                            ? `${row.durationMinutes} min`
                            : "-"}
                        </td>
                        <td className="py-2 pr-3">{formatMoney(row.amount)}</td>
                        <td className="py-2 pr-3">{formatPayer(row.payerMode, row.payerData)}</td>
                      </tr>
                      );
                    })}
                    {completedSessions.length === 0 ? (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan={6}>
                          No completed sessions yet
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="sticky bottom-0 mt-3 border-t border-slate-200 bg-white pt-3">
                <p className="text-sm text-slate-700">Selected: {selectedSessionIds.length}</p>
                <p className="text-xl font-bold text-slate-900">
                  Subtotal: {formatMoney(selectedTotalAmount)}
                </p>
                <button
                  type="button"
                  onClick={() => void createBill()}
                  disabled={billingBusy || selectedSessionIds.length === 0}
                  className="mt-3 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Create Bill
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-md">
              <h2 className="text-xl font-semibold text-slate-900">Payment Panel</h2>

              {paymentError ? <p className="mt-2 text-sm text-red-600">{paymentError}</p> : null}
              {paymentSuccess ? (
                <p className="mt-2 text-sm text-green-700">{paymentSuccess}</p>
              ) : null}

              <div className="mt-3 max-h-36 overflow-auto rounded-md border border-slate-200">
                {unpaidBills.map((bill) => (
                  <button
                    key={bill.id}
                    type="button"
                    onClick={() => setSelectedBillId(bill.id)}
                    disabled={paymentBusy}
                    className={`w-full border-b border-slate-200 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-100 ${
                      selectedBillId === bill.id ? "bg-indigo-50 font-semibold" : "bg-white"
                    }`}
                  >
                    Bill #{bill.id} - ₹{formatMoney(bill.discountedAmount)} - Remaining ₹{formatMoney(bill.remainingAmount)}
                  </button>
                ))}
                {unpaidBills.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-500">No unpaid bills</p>
                ) : null}
              </div>

              <div className="mt-3 rounded-md border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Bill Discount</p>
                <div className="mt-2 space-y-2">
                  <select
                    value={billDiscountType}
                    onChange={(e) =>
                      setBillDiscountType(e.target.value as "none" | "fixed" | "percent")
                    }
                    disabled={!selectedBill || discountBusy || paymentBusy}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="none">none</option>
                    <option value="fixed">fixed</option>
                    <option value="percent">percent</option>
                  </select>
                  {billDiscountType !== "none" ? (
                    <input
                      type="number"
                      value={billDiscountValue}
                      onChange={(e) => setBillDiscountValue(e.target.value)}
                      placeholder={billDiscountType === "fixed" ? "Amount" : "Percent"}
                      disabled={!selectedBill || discountBusy || paymentBusy}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void applyBillDiscount()}
                    disabled={!selectedBill || discountBusy || paymentBusy}
                    className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Apply Discount
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <p>Bill ID: {selectedBill?.id ?? "-"}</p>
                <p>Subtotal: {formatMoney(selectedBill?.totalAmount)}</p>
                <p>
                  Discount:{" "}
                  {selectedBill
                    ? selectedBill.discountType === "fixed"
                      ? `₹${selectedBill.discountValue ?? 0}`
                      : selectedBill.discountType === "percent"
                        ? `${selectedBill.discountValue ?? 0}%`
                        : "-"
                    : "-"}
                </p>
                <p>Total: {formatMoney(selectedBill?.discountedAmount)}</p>
                <p>Paid: {formatMoney(selectedBill?.paidAmount)}</p>
                <p className="font-semibold">Remaining: {formatMoney(selectedBill?.remainingAmount)}</p>
                <div className="mt-2">
                  <p className="text-xs font-semibold text-slate-600">Payment History</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {selectedBill?.payments.map((payment, index) => (
                      <li key={`${payment.mode}-${index}`}>
                        {payment.mode} ₹{formatMoney(payment.amount)}
                      </li>
                    ))}
                    {selectedBill && selectedBill.payments.length === 0 ? (
                      <li className="text-slate-500">No payments yet</li>
                    ) : null}
                    {!selectedBill ? <li className="text-slate-500">Select a bill</li> : null}
                  </ul>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentAmount(String(selectedBill?.remainingAmount ?? 0))}
                  disabled={!selectedBill || paymentBusy}
                  className="rounded-md bg-slate-200 px-3 py-1 text-xs disabled:opacity-50"
                >
                  Pay Full
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentAmount("100")}
                  disabled={!selectedBill || paymentBusy}
                  className="rounded-md bg-slate-200 px-3 py-1 text-xs disabled:opacity-50"
                >
                  ₹100
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentAmount("200")}
                  disabled={!selectedBill || paymentBusy}
                  className="rounded-md bg-slate-200 px-3 py-1 text-xs disabled:opacity-50"
                >
                  ₹200
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="Amount"
                  disabled={paymentBusy || !selectedBill}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                  disabled={paymentBusy || !selectedBill}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="cash">cash</option>
                  <option value="upi">upi</option>
                  <option value="card">card</option>
                  <option value="due">due</option>
                </select>
                <button
                  type="button"
                  onClick={() => void addPayment()}
                  disabled={paymentBusy || !selectedBill}
                  className="w-full rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  Add Payment
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>

      {editingSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Edit Session Override - #{editingSession.id}
            </h3>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-sm text-slate-700">Start Time</label>
                <input
                  type="datetime-local"
                  value={overrideStartTime}
                  onChange={(e) => setOverrideStartTime(e.target.value)}
                  disabled={overrideBusy}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-700">End Time</label>
                <input
                  type="datetime-local"
                  value={overrideEndTime}
                  onChange={(e) => setOverrideEndTime(e.target.value)}
                  disabled={overrideBusy}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-700">Rate Per Min</label>
                <input
                  type="number"
                  value={overrideRatePerMin}
                  onChange={(e) => setOverrideRatePerMin(e.target.value)}
                  disabled={overrideBusy}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-700">Status Override</label>
                {(() => {
                  const currentLifecycle = toLifecycleState(editingSession.state);
                  const allowRunning = canTransitionLifecycle(currentLifecycle, "Running");
                  const allowCompleted = canTransitionLifecycle(currentLifecycle, "Completed");
                  const allowBilled = canTransitionLifecycle(currentLifecycle, "Billed");
                  return (
                    <select
                      value={overrideStatus}
                      onChange={(e) =>
                        setOverrideStatus(
                          e.target.value as "default" | "running" | "completed" | "billed",
                        )
                      }
                      disabled={overrideBusy}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="default">default (use original)</option>
                      <option value="running" disabled={!allowRunning}>running</option>
                      <option value="completed" disabled={!allowCompleted}>completed</option>
                      <option value="billed" disabled={!allowBilled}>billed</option>
                    </select>
                  );
                })()}
              </div>
              {toLifecycleState(editingSession.state) === "Paid" ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={overrideAdmin}
                    onChange={(e) => setOverrideAdmin(e.target.checked)}
                    disabled={overrideBusy}
                  />
                  Admin override (required for Paid to Billed)
                </label>
              ) : null}
              <div>
                <label className="mb-1 block text-sm text-slate-700">Payment Mode Override</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["cash", "upi", "card", "due"] as PaymentMode[]).map((mode) => (
                    <label
                      key={mode}
                      className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={overridePaymentModes.includes(mode)}
                        onChange={() => toggleOverridePaymentMode(mode)}
                        disabled={overrideBusy}
                      />
                      {mode}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-700">Payer Override</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOverridePayerMode("none")}
                    disabled={overrideBusy}
                    className={`rounded-md px-3 py-1 text-sm ${
                      overridePayerMode === "none" ? "bg-slate-900 text-white" : "bg-slate-200"
                    }`}
                  >
                    None
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverridePayerMode("single")}
                    disabled={overrideBusy}
                    className={`rounded-md px-3 py-1 text-sm ${
                      overridePayerMode === "single" ? "bg-slate-900 text-white" : "bg-slate-200"
                    }`}
                  >
                    Single
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverridePayerMode("split")}
                    disabled={overrideBusy}
                    className={`rounded-md px-3 py-1 text-sm ${
                      overridePayerMode === "split" ? "bg-slate-900 text-white" : "bg-slate-200"
                    }`}
                  >
                    Split
                  </button>
                </div>
              </div>

              {overridePayerMode === "single" ? (
                <div>
                  <label className="mb-1 block text-sm text-slate-700">Payer Name</label>
                  <input
                    value={overrideSinglePayerName}
                    onChange={(e) => setOverrideSinglePayerName(e.target.value)}
                    disabled={overrideBusy}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Enter name"
                  />
                </div>
              ) : null}

              {overridePayerMode === "split" ? (
                <div className="space-y-2">
                  {overrideSplitRows.map((row, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        value={row.name}
                        onChange={(e) =>
                          updateOverrideSplitRow(index, { ...row, name: e.target.value })
                        }
                        disabled={overrideBusy}
                        className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Name"
                      />
                      <input
                        value={row.percentage}
                        onChange={(e) =>
                          updateOverrideSplitRow(index, {
                            ...row,
                            percentage: e.target.value,
                          })
                        }
                        disabled={overrideBusy}
                        className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Percentage"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setOverrideSplitRows((prev) => [...prev, { name: "", percentage: "" }])
                    }
                    disabled={overrideBusy}
                    className="rounded-md bg-slate-200 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Add Row
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeOverrideModal}
                disabled={overrideBusy}
                className="rounded-md bg-slate-200 px-3 py-2 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitSessionOverride()}
                disabled={overrideBusy}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Save Override
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {startTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Start Session - {startTable.name}
            </h3>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-sm text-slate-700">Player Name</label>
                <input
                  value={startPlayerName}
                  onChange={(e) => setStartPlayerName(e.target.value)}
                  disabled={busyTableId === startTable.id}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Enter player name"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-700">
                  Start Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  disabled={busyTableId === startTable.id}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeStartSession}
                disabled={busyTableId === startTable.id}
                className="rounded-md bg-slate-200 px-3 py-2 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitStartSession()}
                disabled={busyTableId === startTable.id}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Start Session
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {endTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              End Session - {endTable.name}
            </h3>

            <div className="mt-3 space-y-3">
              {endTable.state === "Running-NoPayer" ? (
                <div>
                  <label className="mb-1 block text-sm text-slate-700">Payer Name</label>
                  <input
                    value={endPayerName}
                    onChange={(e) => setEndPayerName(e.target.value)}
                    disabled={busyTableId === endTable.id}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Assign payer before ending"
                  />
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-sm text-slate-700">
                  End Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={endTimeInput}
                  onChange={(e) => setEndTimeInput(e.target.value)}
                  disabled={busyTableId === endTable.id}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEndSession}
                disabled={busyTableId === endTable.id}
                className="rounded-md bg-slate-200 px-3 py-2 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitEndSession()}
                disabled={busyTableId === endTable.id}
                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {payerTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Assign Payer - {payerTable.name}
            </h3>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPayerMode("single")}
                className={`rounded-md px-3 py-1 text-sm ${
                  payerMode === "single" ? "bg-slate-900 text-white" : "bg-slate-200"
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => setPayerMode("split")}
                className={`rounded-md px-3 py-1 text-sm ${
                  payerMode === "split" ? "bg-slate-900 text-white" : "bg-slate-200"
                }`}
              >
                Split
              </button>
            </div>

            {payerMode === "single" ? (
              <div className="mt-3">
                <label className="mb-1 block text-sm text-slate-700">Payer Name</label>
                <input
                  value={singlePayerName}
                  onChange={(e) => setSinglePayerName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Enter name"
                />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {splitRows.map((row, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={row.name}
                      onChange={(e) =>
                        updateSplitRow(index, { ...row, name: e.target.value })
                      }
                      className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Name"
                    />
                    <input
                      value={row.percentage}
                      onChange={(e) =>
                        updateSplitRow(index, {
                          ...row,
                          percentage: e.target.value,
                        })
                      }
                      className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Percentage"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setSplitRows((prev) => [...prev, { name: "", percentage: "" }])
                  }
                  className="rounded-md bg-slate-200 px-3 py-2 text-sm"
                >
                  Add Row
                </button>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAssignPayer}
                className="rounded-md bg-slate-200 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitAssignPayer()}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
