"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type TableRow = {
  id: number;
  name: string;
  ratePerMin: number;
  sectionId?: number | null;
  sectionName?: string | null;
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
  businessDayKey: string | null;
  originalStatus: "running" | "completed" | "billed";
  tableName: string;
  playerName: string;
  originalStartTime: string;
  startTime: string;
  originalEndTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  originalRatePerMin: number;
  ratePerMin: number;
  amount: number;
  sessionDiscount: number;
  finalAmount: number;
  effectivePaid: number;
  paidAmount: number;
  remainingAmount: number;
  paymentModes: string[];
  paymentSplit: Array<{
    mode: PaymentMode;
    amount: number;
  }>;
  state: "Running" | "Completed" | "Billed-Unpaid" | "Partially-Paid" | "Paid" | "Cancelled" | "LTP-Loss";
  outcome: "NORMAL" | "LTP_LOSS" | "CANCELLED";
  ltpValue: number;
  cancellationReason: string | null;
  canceledAt: string | null;
  originalPayerMode: "none" | "single" | "split";
  originalPayerData: unknown;
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

type PaymentMode = "cash" | "upi" | "card" | "due";
type LifecycleState = "Free" | "Running" | "Completed" | "Billed" | "Paid";
type UnpaidBill = {
  id: number;
  subtotal?: number;
  discount?: number;
  finalAmount?: number;
  totalAmount: number;
  discountType: "fixed" | "percent" | null;
  discountValue: number | null;
  discountedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  remaining?: number;
  payments: Array<{
    mode: PaymentMode;
    amount: number;
    dueCustomerName?: string | null;
    dueCustomerPhone?: string | null;
    dueSettledAt?: string | null;
    dueReceivedMode?: PaymentMode | null;
  }>;
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
  collectionTotal: number;
  unpaid: number;
  discount: number;
  total: number;
  paid: number;
  isBalanced: boolean;
  ltpCount: number;
  ltpValue: number;
};

type LedgerScope = "current" | "day" | "range";

type LedgerWindow = {
  scope: LedgerScope;
  key?: string | null;
  start: string | null;
  end: string | null;
};

type OverrideHistoryEvent = {
  id: number;
  action: string;
  actionLabel: string;
  changedBy: string;
  diffs: Array<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
  createdAt: string;
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
  paymentCount: number;
};

type CustomerSuggestion = {
  id: number;
  name: string;
  phone: string;
  lastSeenAt?: string;
};

type ToastMessage = {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
};

type AppUser = {
  id: number;
  name: string;
  role: "operator" | "admin";
  isActive: boolean;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function formatSplitPercentage(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
}

function applyEqualSplit(rows: SplitRow[]): SplitRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const participants = rows.length;
  const base = Math.floor((100 / participants) * 100) / 100;
  const result: SplitRow[] = rows.map((row, index) => {
    const value = index === participants - 1
      ? Math.round((100 - base * (participants - 1)) * 100) / 100
      : base;
    return {
      ...row,
      percentage: formatSplitPercentage(value),
    };
  });

  return result;
}

function isRunningState(state: string): boolean {
  return state.startsWith("Running");
}

function formatElapsedFromStart(startTime?: string): string {
  if (!startTime) {
    return "00:00";
  }

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return "00:00";
  }

  const diffMs = Date.now() - start.getTime();
  if (diffMs <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

function todayDateInputValue(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) {
    return todayDateInputValue();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return todayDateInputValue();
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function buildDateTimeFromParts(
  timeValue: string,
  dateValue?: string,
): Date | null {
  const time = timeValue.trim();
  if (!time) {
    return null;
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const baseDate = dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? dateValue
    : todayDateInputValue();
  const parsed = new Date(`${baseDate}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function formatDateInputValue(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatMoney(value: number | null | undefined): string {
  const safe = typeof value === "number" ? value : 0;
  return String(Math.round(safe));
}

function buildGenericPlayerName(tableName: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `Walk-in ${tableName} ${hh}:${mm}`;
}

function toLifecycleState(state: LedgerSessionRow["state"]): LifecycleState {
  if (state === "Running") {
    return "Running";
  }
  if (state === "Completed") {
    return "Completed";
  }
  if (state === "Cancelled") {
    return "Completed";
  }
  if (state === "LTP-Loss") {
    return "Completed";
  }
  if (state === "Paid") {
    return "Paid";
  }
  return "Billed";
}

function formatRate(value: number | null | undefined, tableName?: string): string {
  const safe = typeof value === "number" ? value : 0;
  if ((tableName ?? "").toUpperCase().startsWith("PS")) {
    return `${formatMoney(safe * 60)}/hr`;
  }
  return `${formatMoney(safe)}/min`;
}

function toSplitRows(data: unknown): SplitRow[] {
  if (!Array.isArray(data)) {
    return [
      { name: "", percentage: "" },
      { name: "", percentage: "" },
    ];
  }

  const rows = data
    .map((row) => {
      const name = typeof (row as { name?: unknown }).name === "string"
        ? ((row as { name?: string }).name ?? "").trim()
        : "";
      const percentage = typeof (row as { percentage?: unknown }).percentage === "number"
        ? String((row as { percentage?: number }).percentage ?? "")
        : "";
      if (!name || !percentage) {
        return null;
      }
      return { name, percentage };
    })
    .filter((row): row is SplitRow => row !== null);

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

function getSessionOverrideDiffs(row: LedgerSessionRow): Array<{ field: string; value: unknown }> {
  const diffs: Array<{ field: string; value: unknown }> = [];
  if (row.outcome !== "NORMAL") {
    diffs.push({ field: "outcome", value: row.outcome });
  }
  if (row.overrideStatus !== null) {
    diffs.push({ field: "overrideStatus", value: row.overrideStatus });
  }
  if (row.overrideStartTime !== null) {
    diffs.push({ field: "overrideStartTime", value: row.overrideStartTime });
  }
  if (row.overrideEndTime !== null) {
    diffs.push({ field: "overrideEndTime", value: row.overrideEndTime });
  }
  if (row.overrideRatePerMin !== null) {
    diffs.push({ field: "overrideRatePerMin", value: row.overrideRatePerMin });
  }
  if (row.overridePayerMode !== null) {
    diffs.push({ field: "overridePayerMode", value: row.overridePayerMode });
  }
  if (row.overridePayerData !== null) {
    diffs.push({ field: "overridePayerData", value: row.overridePayerData });
  }
  if (row.overridePaymentModes !== null) {
    diffs.push({ field: "overridePaymentModes", value: row.overridePaymentModes });
  }
  if (row.cancellationReason) {
    diffs.push({ field: "cancellationReason", value: row.cancellationReason });
  }
  return diffs;
}

function getHistoryFieldLabel(field: string): string {
  if (field === "overrideStartTime") {
    return "Start Time";
  }
  if (field === "overrideEndTime") {
    return "End Time";
  }
  if (field === "overrideRatePerMin") {
    return "Rate";
  }
  if (field === "overrideStatus") {
    return "Status Action";
  }
  if (field === "overridePayerMode") {
    return "Payer Mode";
  }
  if (field === "overridePayerData") {
    return "Payer Details";
  }
  if (field === "overridePaymentModes") {
    return "Payment Modes";
  }
  if (field === "payments") {
    return "Payments";
  }
  if (field === "startTime") {
    return "Start Time";
  }
  if (field === "endTime") {
    return "End Time";
  }
  if (field === "totalAmount") {
    return "Bill Amount";
  }
  if (field === "discount") {
    return "Discount";
  }
  if (field === "discountedAmount") {
    return "Discounted Amount";
  }
  if (field === "status") {
    return "Final Status";
  }
  if (field === "outcome") {
    return "Outcome";
  }
  if (field === "cancellationReason") {
    return "Cancellation Reason";
  }
  if (field === "canceledAt") {
    return "Cancelled At";
  }
  if (field === "billId") {
    return "Bill";
  }
  if (field === "amount") {
    return "Total Amount";
  }
  if (field === "playerName") {
    return "Player Name";
  }
  return field;
}

function formatPaymentsSummary(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "No entries";
  }
  const rows = value as Array<{ amount?: unknown; mode?: unknown }>;
  const total = rows.reduce((sum, row) => {
    const amount = typeof row.amount === "number" ? row.amount : 0;
    return sum + amount;
  }, 0);
  const modes = Array.from(
    new Set(
      rows
        .map((row) => row.mode)
        .filter((mode): mode is string => typeof mode === "string" && mode.length > 0),
    ),
  );
  return `${rows.length} entry${rows.length === 1 ? "" : "ies"} | ₹${formatMoney(total)}${
    modes.length ? ` | ${modes.join(", ")}` : ""
  }`;
}

function formatHistoryFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (
    field === "overrideStartTime" ||
    field === "overrideEndTime" ||
    field === "startTime" ||
    field === "endTime" ||
    field === "canceledAt"
  ) {
    if (typeof value === "string") {
      return formatDateTimeFull(value);
    }
    return "-";
  }

  if (field === "overrideRatePerMin") {
    return typeof value === "number" ? `${formatMoney(value)}/min` : "-";
  }

  if (field === "overrideStatus") {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    return "default";
  }

  if (field === "overridePayerMode") {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    return "default";
  }

  if (field === "overridePayerData" || field === "overridePaymentModes") {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "No entries";
      }
      return `${value.length} item(s)`;
    }
    if (value && typeof value === "object") {
      return "Updated";
    }
    return "-";
  }

  if (field === "billId") {
    return typeof value === "number" ? `Bill #${value}` : "-";
  }

  if (field === "amount" || field === "totalAmount" || field === "discountedAmount" || field === "discount") {
    return typeof value === "number" ? `₹${formatMoney(value)}` : "-";
  }

  if (field === "outcome") {
    if (value === "LTP_LOSS") {
      return "LTP Loss";
    }
    if (value === "CANCELLED") {
      return "Cancelled";
    }
    if (value === "NORMAL") {
      return "Normal";
    }
    return typeof value === "string" ? value : "-";
  }

  if (field === "payments") {
    return formatPaymentsSummary(value);
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length ? `${value.length} item(s)` : "No entries";
  }
  if (value && typeof value === "object") {
    return "Updated";
  }
  return "-";
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

function formatLedgerAmountWithDiscount(row: LedgerSessionRow): string {
  const discount = typeof row.sessionDiscount === "number" ? row.sessionDiscount : 0;
  if (discount <= 0) {
    return `₹${formatMoney(row.amount)}`;
  }
  return `₹${formatMoney(row.amount)} (-₹${formatMoney(discount)}) = ₹${formatMoney(row.finalAmount)}`;
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

function getTableSection(name: string): string {
  const upper = name.trim().toUpperCase();
  if (upper === "S1" || upper === "S2" || upper === "S3") {
    return "Snooker";
  }
  if (upper === "IP" || upper === "AP") {
    return "Pool Tables";
  }
  if (upper === "PS1" || upper === "PS2") {
    return "PlayStation";
  }
  return "Other";
}

function tableSortRank(name: string): number {
  const order = ["S1", "S2", "S3", "IP", "AP", "PS1", "PS2"];
  const upper = name.trim().toUpperCase();
  const index = order.indexOf(upper);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export default function HomePage() {
  const {
    authReady,
    loginBusy,
    activeUser,
    activeUserId,
    authHeaders,
    loginWithPin,
    logout: logoutAuth,
    switchUser,
  } = useAuth();
  const [isDark, setIsDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [managementUsers, setManagementUsers] = useState<AppUser[]>([]);
  const [showManagement, setShowManagement] = useState(false);
  const [loginPin, setLoginPin] = useState("");
  const autoSubmittedPinRef = useRef<string | null>(null);
  const [newTableName, setNewTableName] = useState("");
  const [newTableRate, setNewTableRate] = useState("");
  const [tableManageBusyId, setTableManageBusyId] = useState<number | null>(null);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPin, setNewUserPin] = useState("");
  const [newUserRole, setNewUserRole] = useState<"operator" | "admin">("operator");
  const [userManageBusyId, setUserManageBusyId] = useState<number | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busyTableId, setBusyTableId] = useState<number | null>(null);
  const [startTable, setStartTable] = useState<TableRow | null>(null);
  const [startPlayerName, setStartPlayerName] = useState("");
  const [startPlayerSuggestions, setStartPlayerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showStartPlayerSuggestions, setShowStartPlayerSuggestions] = useState(false);
  const [startVoiceListening, setStartVoiceListening] = useState(false);
  const startSpeechRef = useRef<SpeechRecognitionLike | null>(null);
  const [startTimeInput, setStartTimeInput] = useState("");
  const [startDateInput, setStartDateInput] = useState(todayDateInputValue());
  const [startIncludeDate, setStartIncludeDate] = useState(false);
  const [endTable, setEndTable] = useState<TableRow | null>(null);
  const [endTimeInput, setEndTimeInput] = useState("");
  const [endDateInput, setEndDateInput] = useState(todayDateInputValue());
  const [endIncludeDate, setEndIncludeDate] = useState(false);
  const [endPayerName, setEndPayerName] = useState("");
  const [endAsLtpLoss, setEndAsLtpLoss] = useState(false);
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
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary>({
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
    collectionTotal: 0,
    unpaid: 0,
    discount: 0,
    total: 0,
    paid: 0,
    isBalanced: true,
    ltpCount: 0,
    ltpValue: 0,
  });
  const [ledgerScope, setLedgerScope] = useState<LedgerScope>("current");
  const [ledgerDate, setLedgerDate] = useState<string>(todayDateInputValue());
  const [ledgerStartDate, setLedgerStartDate] = useState<string>(todayDateInputValue());
  const [ledgerEndDate, setLedgerEndDate] = useState<string>(todayDateInputValue());
  const [ledgerWindow, setLedgerWindow] = useState<LedgerWindow>({
    scope: "current",
    key: null,
    start: null,
    end: null,
  });
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
  const [dueCustomerName, setDueCustomerName] = useState("");
  const [dueCustomerPhone, setDueCustomerPhone] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const [showDueReport, setShowDueReport] = useState(false);
  const [dueReport, setDueReport] = useState<DueReportRow[]>([]);
  const [dueReportByBill, setDueReportByBill] = useState<DueByBillRow[]>([]);
  const [dueViewMode, setDueViewMode] = useState<"customer" | "bill">("customer");
  const [showBillsPanel, setShowBillsPanel] = useState(false);
  const [showReportsSidebar, setShowReportsSidebar] = useState(false);
  const [billSearchRows, setBillSearchRows] = useState<BillSearchRow[]>([]);
  const [billSearchLoading, setBillSearchLoading] = useState(false);
  const [billSearchError, setBillSearchError] = useState<string | null>(null);
  const [billFilterStartDate, setBillFilterStartDate] = useState("");
  const [billFilterEndDate, setBillFilterEndDate] = useState("");
  const [billFilterStartTime, setBillFilterStartTime] = useState("");
  const [billFilterEndTime, setBillFilterEndTime] = useState("");
  const [billFilterId, setBillFilterId] = useState("");
  const [billFilterPayer, setBillFilterPayer] = useState("");
  const [billFilterPaymentMode, setBillFilterPaymentMode] = useState<"all" | PaymentMode>("all");
  const [dueReceiveModes, setDueReceiveModes] = useState<Record<string, "cash" | "upi" | "card">>({});
  const [dueReceiveAmounts, setDueReceiveAmounts] = useState<Record<string, string>>({});
  const [dueReceiveBusyKey, setDueReceiveBusyKey] = useState<string | null>(null);
  const [historySession, setHistorySession] = useState<LedgerSessionRow | null>(null);
  const [splitViewSession, setSplitViewSession] = useState<LedgerSessionRow | null>(null);
  const [historyEvents, setHistoryEvents] = useState<OverrideHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<LedgerSessionRow | null>(null);
  const [cancelSessionTarget, setCancelSessionTarget] = useState<LedgerSessionRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [overridePlayerName, setOverridePlayerName] = useState("");
  const [overrideStartTime, setOverrideStartTime] = useState("");
  const [overrideStartDate, setOverrideStartDate] = useState(todayDateInputValue());
  const [overrideStartIncludeDate, setOverrideStartIncludeDate] = useState(false);
  const [overrideEndTime, setOverrideEndTime] = useState("");
  const [overrideEndDate, setOverrideEndDate] = useState(todayDateInputValue());
  const [overrideEndIncludeDate, setOverrideEndIncludeDate] = useState(false);
  const [overrideRatePerMin, setOverrideRatePerMin] = useState("");
  const [overrideOutcome, setOverrideOutcome] = useState<"NORMAL" | "LTP_LOSS">("NORMAL");
  const [overridePayerMode, setOverridePayerMode] = useState<"none" | "single" | "split">(
    "none",
  );
  const [overrideSinglePayerName, setOverrideSinglePayerName] = useState("");
  const [overrideSplitRows, setOverrideSplitRows] = useState<SplitRow[]>([
    { name: "", percentage: "" },
    { name: "", percentage: "" },
  ]);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const isAdminUser = activeUser?.role === "admin";
  const canManage = isAdminUser;

  function pushToast(kind: ToastMessage["kind"], text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, kind, text }]);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 2800);
    return () => clearTimeout(timer);
  }, [toasts]);

  async function readJsonSafe<T>(res: Response): Promise<T | null> {
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async function loadManagementUsers() {
    if (!activeUserId) {
      setManagementUsers([]);
      return;
    }
    try {
      const res = await fetch("/api/users", {
        cache: "no-store",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ data?: AppUser[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch users");
      }
      setManagementUsers(data?.data ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch users";
      pushToast("error", message);
      setManagementUsers([]);
    }
  }

  async function loadTables() {
    try {
      setError(null);
      const res = await fetch("/api/tables", { cache: "no-store", headers: authHeaders() });
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
      const res = await fetch("/api/sessions/completed", { cache: "no-store", headers: authHeaders() });
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
      const res = await fetch("/api/bill/unpaid", { cache: "no-store", headers: authHeaders() });
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

  async function loadDueReport() {
    try {
      const res = await fetch("/api/payment/due-report", { cache: "no-store", headers: authHeaders() });
      const data = await readJsonSafe<{ data?: DueReportRow[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch due report");
      }
      const rows = data?.data ?? [];
      setDueReport(rows);
      setDueReceiveModes((prev) => {
        const next: Record<string, "cash" | "upi" | "card"> = {};
        for (const row of rows) {
          next[row.rowKey] = prev[row.rowKey] ?? "cash";
        }
        return next;
      });
      setDueReceiveAmounts((prev) => {
        const next: Record<string, string> = {};
        for (const row of rows) {
          next[row.rowKey] = prev[row.rowKey] ?? String(row.totalDue);
        }
        return next;
      });
    } catch {
      setDueReport([]);
    }
  }

  async function loadDueReportByBill() {
    try {
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
    } catch {
      setDueReportByBill([]);
    }
  }

  async function loadBillSearch() {
    setBillSearchLoading(true);
    setBillSearchError(null);
    try {
      const params = new URLSearchParams();
      if (billFilterStartDate) {
        params.set("startDate", billFilterStartDate);
      }
      if (billFilterEndDate) {
        params.set("endDate", billFilterEndDate);
      }
      if (billFilterStartTime) {
        params.set("startTime", billFilterStartTime);
      }
      if (billFilterEndTime) {
        params.set("endTime", billFilterEndTime);
      }
      if (billFilterId.trim()) {
        params.set("billId", billFilterId.trim());
      }
      if (billFilterPayer.trim()) {
        params.set("payer", billFilterPayer.trim());
      }
      if (billFilterPaymentMode !== "all") {
        params.set("paymentMode", billFilterPaymentMode);
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

  async function submitPinLogin() {
    const result = await loginWithPin(loginPin);
    if (!result.ok) {
      pushToast("error", result.error ?? "Login failed");
      return;
    }
    if (loginPin.trim()) {
      setLoginPin("");
    }
    pushToast("success", "Login successful");
  }

  useEffect(() => {
    if (!authReady || loginBusy) {
      return;
    }
    const normalizedPin = loginPin.trim();
    if (!/^\d{4}$/.test(normalizedPin)) {
      autoSubmittedPinRef.current = null;
      return;
    }
    if (autoSubmittedPinRef.current === normalizedPin) {
      return;
    }
    autoSubmittedPinRef.current = normalizedPin;
    void submitPinLogin();
  }, [authReady, loginBusy, loginPin]);

  function logout() {
    logoutAuth("manual");
    setShowManagement(false);
    pushToast("info", "Logged out");
  }

  function handleSwitchUser() {
    switchUser();
    setShowManagement(false);
    pushToast("info", "Switched user");
  }

  function ensureAdminAction(): boolean {
    if (!activeUserId) {
      pushToast("error", "Please log in first");
      return false;
    }
    if (!isAdminUser) {
      pushToast("error", "Only admin can access management actions");
      return false;
    }
    return true;
  }

  async function submitCreateTable() {
    if (!ensureAdminAction()) {
      return;
    }
    const name = newTableName.trim();
    const rate = Number(newTableRate);
    if (!name || !Number.isFinite(rate) || rate <= 0) {
      pushToast("error", "Table name and valid rate are required");
      return;
    }
    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name, ratePerMin: rate }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to create table");
      }
      pushToast("success", "Table created");
      setNewTableName("");
      setNewTableRate("");
      await loadTables();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create table";
      pushToast("error", message);
    }
  }

  async function editTableInline(table: TableRow) {
    if (!ensureAdminAction()) {
      return;
    }
    const nextName = window.prompt("Table name", table.name);
    if (nextName === null) {
      return;
    }
    const nextRateRaw = window.prompt("Rate per min", String(table.ratePerMin));
    if (nextRateRaw === null) {
      return;
    }
    const nextRate = Number(nextRateRaw);
    if (!nextName.trim() || !Number.isFinite(nextRate) || nextRate <= 0) {
      pushToast("error", "Invalid name or rate");
      return;
    }
    setTableManageBusyId(table.id);
    try {
      const res = await fetch(`/api/tables/${table.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: nextName.trim(), ratePerMin: nextRate }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to update table");
      }
      pushToast("success", "Table updated");
      await loadTables();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update table";
      pushToast("error", message);
    } finally {
      setTableManageBusyId(null);
    }
  }

  async function deleteTableInline(table: TableRow) {
    if (!ensureAdminAction()) {
      return;
    }
    if (!window.confirm(`Delete table ${table.name}?`)) {
      return;
    }
    setTableManageBusyId(table.id);
    try {
      const res = await fetch(`/api/tables/${table.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to delete table");
      }
      pushToast("success", "Table deleted");
      await loadTables();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete table";
      pushToast("error", message);
    } finally {
      setTableManageBusyId(null);
    }
  }

  async function submitCreateUser() {
    if (!ensureAdminAction()) {
      return;
    }
    const name = newUserName.trim();
    const pin = newUserPin.trim();
    if (!name || !/^\d{4}$/.test(pin)) {
      pushToast("error", "User name and valid 4-digit PIN are required");
      return;
    }
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
      pushToast("success", "User created");
      setNewUserName("");
      setNewUserPin("");
      setNewUserRole("operator");
      await loadManagementUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create user";
      pushToast("error", message);
    }
  }

  async function updateUserInline(
    userId: number,
    payload: { role?: "operator" | "admin"; isActive?: boolean },
  ) {
    if (!ensureAdminAction()) {
      return;
    }
    setUserManageBusyId(userId);
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
      pushToast("success", "User updated");
      await loadManagementUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update user";
      pushToast("error", message);
    } finally {
      setUserManageBusyId(null);
    }
  }

  async function deleteUserInline(user: AppUser) {
    if (!ensureAdminAction()) {
      return;
    }
    if (!window.confirm(`Delete user ${user.name}?`)) {
      return;
    }
    setUserManageBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to delete user");
      }
      pushToast("success", "User deleted");
      await loadManagementUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete user";
      pushToast("error", message);
    } finally {
      setUserManageBusyId(null);
    }
  }

  useEffect(() => {
    if (paymentMode !== "due") {
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
      return;
    }

    const q = dueCustomerPhone.trim() || dueCustomerName.trim();
    if (!q) {
      setCustomerSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}&scope=due`, {
            cache: "no-store",
            headers: authHeaders(),
          });
          const data = await readJsonSafe<{ data?: CustomerSuggestion[] }>(res);
          if (!res.ok) {
            setCustomerSuggestions([]);
            return;
          }
          setCustomerSuggestions(data?.data ?? []);
        } catch {
          setCustomerSuggestions([]);
        }
      })();
    }, 180);

    return () => clearTimeout(timer);
  }, [paymentMode, dueCustomerName, dueCustomerPhone]);

  useEffect(() => {
    if (!startTable) {
      setStartPlayerSuggestions([]);
      setShowStartPlayerSuggestions(false);
      return;
    }

    const q = startPlayerName.trim();
    if (!q) {
      setStartPlayerSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}&scope=player`, {
            cache: "no-store",
            headers: authHeaders(),
          });
          const data = await readJsonSafe<{ data?: CustomerSuggestion[] }>(res);
          if (!res.ok) {
            setStartPlayerSuggestions([]);
            return;
          }
          setStartPlayerSuggestions(data?.data ?? []);
        } catch {
          setStartPlayerSuggestions([]);
        }
      })();
    }, 180);

    return () => clearTimeout(timer);
  }, [startTable, startPlayerName]);

  function stopStartPlayerVoiceInput() {
    const recognition = startSpeechRef.current;
    if (recognition) {
      recognition.stop();
      startSpeechRef.current = null;
    }
    setStartVoiceListening(false);
  }

  function startPlayerVoiceInput() {
    if (typeof window === "undefined") {
      return;
    }
    if (startVoiceListening) {
      stopStartPlayerVoiceInput();
      return;
    }

    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      pushToast("error", "Voice input is not supported on this browser");
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "en-IN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event: unknown) => {
        const speechEvent = event as {
          results?: ArrayLike<ArrayLike<{ transcript?: string }>>;
        };
        const transcript = String(speechEvent.results?.[0]?.[0]?.transcript ?? "").trim();
        if (!transcript) {
          pushToast("error", "Could not detect name from voice input");
          return;
        }
        setStartPlayerName(transcript);
        setShowStartPlayerSuggestions(false);
      };
      recognition.onerror = () => {
        pushToast("error", "Voice input failed, please try again");
      };
      recognition.onend = () => {
        setStartVoiceListening(false);
        startSpeechRef.current = null;
      };
      startSpeechRef.current = recognition;
      setStartVoiceListening(true);
      recognition.start();
    } catch {
      setStartVoiceListening(false);
      startSpeechRef.current = null;
      pushToast("error", "Unable to start voice input");
    }
  }

  useEffect(() => () => {
    const recognition = startSpeechRef.current;
    if (recognition) {
      recognition.stop();
      startSpeechRef.current = null;
    }
  }, []);

  async function loadAllSessions(scope: LedgerScope = ledgerScope) {
    try {
      const params = new URLSearchParams({ scope });
      if (scope === "day" && ledgerDate) {
        params.set("date", ledgerDate);
      }
      if (scope === "range") {
        params.set("startDate", ledgerStartDate);
        params.set("endDate", ledgerEndDate);
      }
      const res = await fetch(`/api/sessions/all?${params.toString()}`, { cache: "no-store", headers: authHeaders() });
      const data = await readJsonSafe<{
        data?: LedgerSessionRow[];
        summary?: LedgerSummary;
        window?: LedgerWindow;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to fetch session ledger");
      }
      setSessionsLedger(data?.data ?? []);
      setLedgerSummary(
        data?.summary ?? {
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
          collectionTotal: 0,
          unpaid: 0,
          discount: 0,
          total: 0,
          paid: 0,
          isBalanced: true,
          ltpCount: 0,
          ltpValue: 0,
        },
      );
      setLedgerWindow(
        data?.window ?? {
          scope,
          key: null,
          start: null,
          end: null,
        },
      );
    } catch {
      setSessionsLedger([]);
      setLedgerSummary({
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
        collectionTotal: 0,
        unpaid: 0,
        discount: 0,
        total: 0,
        paid: 0,
        isBalanced: true,
        ltpCount: 0,
        ltpValue: 0,
      });
      setLedgerWindow({
        scope,
        key: null,
        start: null,
        end: null,
      });
    }
  }

  useEffect(() => {
    if (!isAdminUser || !showManagement) {
      return;
    }
    void loadManagementUsers();
  }, [isAdminUser, showManagement, activeUserId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setIsDark(window.localStorage.getItem("cuedesk-theme") === "dark");
    if (window.localStorage.getItem("cuedesk-auth-timeout") === "1") {
      window.localStorage.removeItem("cuedesk-auth-timeout");
      pushToast("info", "Logged out after 2 hours of inactivity");
    }
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
    if (!activeUserId) {
      return;
    }
    void loadTables();
    void loadCompletedSessions();
    void loadUnpaidBills();
    void loadAllSessions(ledgerScope);
    void loadDueReport();
    void loadDueReportByBill();
    void loadBillSearch();
    const poll = setInterval(() => {
      void loadTables();
      void loadCompletedSessions();
      void loadUnpaidBills();
      void loadAllSessions(ledgerScope);
      void loadDueReport();
      void loadDueReportByBill();
      void loadBillSearch();
    }, 5000);
    return () => clearInterval(poll);
  }, [
    activeUserId,
    ledgerScope,
    ledgerDate,
    ledgerStartDate,
    ledgerEndDate,
    billFilterStartDate,
    billFilterEndDate,
    billFilterStartTime,
    billFilterEndTime,
    billFilterId,
    billFilterPayer,
    billFilterPaymentMode,
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((v) => v + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  function switchLedgerScope(scope: LedgerScope) {
    setLedgerScope(scope);
  }

  function applyRangeFilter() {
    if (!ledgerStartDate || !ledgerEndDate) {
      pushToast("error", "Start and end date are required");
      return;
    }
    if (ledgerStartDate > ledgerEndDate) {
      pushToast("error", "Start date must be before or equal to end date");
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

  const tableSections = useMemo(() => {
    const grouped = new Map<string, TableRow[]>();
    for (const table of tables) {
      const sectionTitle = (table.sectionName ?? "").trim() || getTableSection(table.name);
      const bucket = grouped.get(sectionTitle) ?? [];
      bucket.push(table);
      grouped.set(sectionTitle, bucket);
    }

    for (const rows of grouped.values()) {
      rows.sort((a, b) => {
        const rankDiff = tableSortRank(a.name) - tableSortRank(b.name);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return a.name.localeCompare(b.name);
      });
    }

    const preferred = ["Snooker", "Pool Tables", "PlayStation"];
    const titles = Array.from(grouped.keys()).sort((a, b) => {
      const ai = preferred.indexOf(a);
      const bi = preferred.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });

    return titles.map((title) => ({
      title,
      rows: grouped.get(title) ?? [],
    }));
  }, [tables, tick]);

  function openStartSession(table: TableRow) {
    setStartTable(table);
    setStartPlayerName("");
    setStartPlayerSuggestions([]);
    setShowStartPlayerSuggestions(false);
    setStartVoiceListening(false);
    setStartTimeInput("");
    setStartDateInput(todayDateInputValue());
    setStartIncludeDate(false);
  }

  function closeStartSession() {
    stopStartPlayerVoiceInput();
    setStartPlayerSuggestions([]);
    setShowStartPlayerSuggestions(false);
    setStartTable(null);
  }

  async function submitStartSession() {
    if (!startTable) {
      return;
    }

    const typedPlayerName = startPlayerName.trim();
    const playerName = typedPlayerName || buildGenericPlayerName(startTable.name);
    if (!typedPlayerName) {
      pushToast("info", `No player name entered. Using "${playerName}"`);
    }

    const tableId = startTable.id;
    const parsedStartTime = buildDateTimeFromParts(
      startTimeInput,
      startIncludeDate ? startDateInput : undefined,
    );
    if (startTimeInput.trim() && !parsedStartTime) {
      pushToast("error", "Invalid start time");
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
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          tableId,
          playerName,
          ...(parsedStartTime ? { startTime: parsedStartTime.toISOString() } : {}),
        }),
      });

      if (!res.ok) {
        const data = await readJsonSafe<{ error?: string }>(res);
        pushToast("error", data?.error ?? "Failed to start session");
        void loadTables();
        void loadAllSessions();
        return;
      }

      pushToast("success", "Session started successfully");
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
    setEndDateInput(todayDateInputValue());
    setEndIncludeDate(false);
    setEndPayerName(table.currentSession?.playerName ?? "");
    setEndAsLtpLoss(false);
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
      pushToast("error", "Active session id is missing");
      return;
    }

    if (endTable.state === "Running-NoPayer" && !endAsLtpLoss) {
      const payerName = endPayerName.trim();
      if (!payerName) {
        pushToast("error", "Payer is required to end session");
        return;
      }

      const payerRes = await fetch("/api/session/assign-payer", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          sessionId,
          payerMode: "single",
          payerData: { name: payerName },
        }),
      });

      if (!payerRes.ok) {
        const data = await readJsonSafe<{ error?: string }>(payerRes);
        pushToast("error", data?.error ?? "Failed to assign payer");
        return;
      }
    }

    let parsedEndTime: Date | null = null;
    if (endTimeInput.trim()) {
      parsedEndTime = buildDateTimeFromParts(
        endTimeInput,
        endIncludeDate ? endDateInput : undefined,
      );
      if (!parsedEndTime) {
        pushToast("error", "Invalid end time");
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
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          tableId,
          outcome: endAsLtpLoss ? "LTP_LOSS" : "NORMAL",
          ...(parsedEndTime ? { endTime: parsedEndTime.toISOString() } : {}),
        }),
      });

      if (!res.ok) {
        const data = await readJsonSafe<{ error?: string }>(res);
        pushToast("error", data?.error ?? "Failed to end session");
        void loadTables();
        void loadAllSessions();
        return;
      }

      pushToast("success", "Session ended successfully");
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

  async function submitAssignPayer() {
    if (!payerTable) {
      return;
    }

    const sessionId = payerTable.currentSession?.id;
    if (!sessionId) {
      pushToast("error", "Active session id is missing");
      return;
    }

    if (payerMode === "single" && singlePayerName.trim() === "") {
      pushToast("error", "Payer name is required");
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
        pushToast("error", "All split names and percentages must be valid");
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
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await readJsonSafe<{ error?: string }>(res);
        pushToast("error", data?.error ?? "Failed to assign payer");
        return;
      }

      pushToast("success", "Payer assigned successfully");
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
      "LTP-Loss": 2,
      Cancelled: 3,
      "Billed-Unpaid": 4,
      "Partially-Paid": 5,
      Paid: 6,
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
        headers: { "Content-Type": "application/json", ...authHeaders() },
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
      pushToast("success", "Bill created successfully");
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

    if (paymentMode === "due") {
      if (!dueCustomerName.trim() || !dueCustomerPhone.trim()) {
        setPaymentError("Due requires customer name and phone");
        return;
      }
    }

    setPaymentBusy(true);
    setPaymentError(null);
    setPaymentSuccess(null);

    try {
      const res = await fetch("/api/payment/add", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          billId: selectedBillId,
          amount: Number(paymentAmount),
          mode: paymentMode,
          ...(paymentMode === "due"
            ? {
                dueCustomerName: dueCustomerName.trim(),
                dueCustomerPhone: dueCustomerPhone.trim(),
              }
            : {}),
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        setPaymentError(data?.error ?? "Failed to add payment");
        return;
      }

      setPaymentSuccess("Payment added successfully");
      setPaymentAmount("");
      setDueCustomerName("");
      setDueCustomerPhone("");
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
      await loadAllSessions();
      const rows = await loadUnpaidBills();
      await loadDueReport();
      await loadDueReportByBill();
      if (!rows.some((bill) => bill.id === selectedBillId)) {
        setSelectedBillId(null);
      }
      pushToast("success", "Payment added successfully");
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
        headers: { "Content-Type": "application/json", ...authHeaders() },
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

  async function receiveDuePayment(row: DueReportRow) {
    if (dueReceiveBusyKey !== null) {
      return;
    }
    const mode = dueReceiveModes[row.rowKey] ?? "cash";
    const amountRaw = dueReceiveAmounts[row.rowKey] ?? "";
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a valid receive amount");
      return;
    }
    if (amount > row.totalDue) {
      setPaymentError("Receive amount exceeds total due");
      return;
    }
    setDueReceiveBusyKey(row.rowKey);
    setPaymentError(null);
    setPaymentSuccess(null);
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
        setPaymentError(data?.error ?? "Failed to receive due payment");
        return;
      }

      setPaymentSuccess("Due payment received");
      await loadDueReport();
      await loadDueReportByBill();
      await loadUnpaidBills();
      await loadAllSessions();
    } finally {
      setDueReceiveBusyKey(null);
    }
  }

  async function receiveDuePaymentByBill(row: DueByBillRow) {
    if (dueReceiveBusyKey !== null) {
      return;
    }
    const rowKey = `bill:${row.paymentId}`;
    const mode = dueReceiveModes[rowKey] ?? "cash";
    const amountRaw = dueReceiveAmounts[rowKey] ?? "";
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a valid receive amount");
      return;
    }
    if (amount > row.dueAmount) {
      setPaymentError("Receive amount exceeds due");
      return;
    }
    setDueReceiveBusyKey(rowKey);
    setPaymentError(null);
    setPaymentSuccess(null);
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
        setPaymentError(data?.error ?? "Failed to receive due payment");
        return;
      }

      setPaymentSuccess("Due payment received");
      await loadDueReport();
      await loadDueReportByBill();
      await loadUnpaidBills();
      await loadAllSessions();
    } finally {
      setDueReceiveBusyKey(null);
    }
  }

  function openOverrideModal(session: LedgerSessionRow) {
    if (session.state === "Cancelled") {
      pushToast("info", "This session cannot be overridden");
      return;
    }
    setEditingSession(session);
    setOverridePlayerName(session.playerName ?? "");
    setOverrideStartTime(toTimeInputValue(session.overrideStartTime));
    setOverrideStartDate(toDateInputValue(session.overrideStartTime));
    setOverrideStartIncludeDate(false);
    setOverrideEndTime(toTimeInputValue(session.overrideEndTime));
    setOverrideEndDate(toDateInputValue(session.overrideEndTime));
    setOverrideEndIncludeDate(false);
    setOverrideRatePerMin(
      session.overrideRatePerMin !== null ? String(session.overrideRatePerMin) : "",
    );
    setOverrideOutcome(session.outcome === "LTP_LOSS" ? "LTP_LOSS" : "NORMAL");
    const initialPayerMode = session.overridePayerMode ?? session.payerMode;
    setOverridePayerMode(initialPayerMode);
    if (initialPayerMode === "single") {
      const payerData = (session.overridePayerData ?? session.payerData) as
        | { name?: string }
        | null
        | undefined;
      setOverrideSinglePayerName(payerData?.name?.trim() ?? "");
      setOverrideSplitRows([
        { name: "", percentage: "" },
        { name: "", percentage: "" },
      ]);
    } else if (initialPayerMode === "split") {
      setOverrideSplitRows(toSplitRows(session.overridePayerData ?? session.payerData));
      setOverrideSinglePayerName("");
    } else {
      setOverrideSinglePayerName("");
      setOverrideSplitRows([
        { name: "", percentage: "" },
        { name: "", percentage: "" },
      ]);
    }
  }

  async function openHistoryModal(session: LedgerSessionRow) {
    setHistorySession(session);
    setHistoryEvents([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/session/history?sessionId=${session.id}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      const data = await readJsonSafe<{ data?: OverrideHistoryEvent[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to load override history");
      }
      setHistoryEvents(data?.data ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load override history";
      setHistoryError(message);
      setHistoryEvents([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistoryModal() {
    setHistorySession(null);
    setHistoryEvents([]);
    setHistoryError(null);
    setHistoryLoading(false);
  }

  function closeSplitViewModal() {
    setSplitViewSession(null);
  }

  function closeOverrideModal() {
    setEditingSession(null);
  }

  function openCancelSessionModal(session: LedgerSessionRow) {
    if (session.state === "Cancelled") {
      return;
    }
    if (session.state !== "Running" && session.state !== "Completed") {
      pushToast("error", "Only running or completed unbilled sessions can be cancelled");
      return;
    }
    setCancelSessionTarget(session);
    setCancelReason("");
  }

  function closeCancelSessionModal() {
    if (cancelBusy) {
      return;
    }
    setCancelSessionTarget(null);
    setCancelReason("");
  }

  async function submitCancelSession() {
    if (!cancelSessionTarget || cancelBusy) {
      return;
    }
    const reason = cancelReason.trim();
    if (!reason) {
      pushToast("error", "Cancellation reason is required");
      return;
    }

    setCancelBusy(true);
    try {
      const res = await fetch("/api/session/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          sessionId: cancelSessionTarget.id,
          reason,
        }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        pushToast("error", data?.error ?? "Failed to cancel session");
        return;
      }

      pushToast("success", "Session cancelled");
      setCancelSessionTarget(null);
      setCancelReason("");
      await loadAllSessions();
      await loadCompletedSessions();
      await loadTables();
      await loadUnpaidBills();
    } finally {
      setCancelBusy(false);
    }
  }

  async function submitSessionOverride() {
    if (!editingSession || overrideBusy) {
      return;
    }

    const startRaw = overrideStartTime.trim();
    const endRaw = overrideEndTime.trim();
    const rateRaw = overrideRatePerMin.trim();
    const playerNameRaw = overridePlayerName.trim();

    const startDate = startRaw
      ? buildDateTimeFromParts(startRaw, overrideStartIncludeDate ? overrideStartDate : undefined) ?? undefined
      : undefined;
    const endDate = endRaw
      ? buildDateTimeFromParts(endRaw, overrideEndIncludeDate ? overrideEndDate : undefined) ?? undefined
      : undefined;
    const rate = rateRaw ? Number(rateRaw) : undefined;

    if (startRaw && !startDate) {
      pushToast("error", "Please enter a valid start time");
      return;
    }

    if (endRaw && !endDate) {
      pushToast("error", "Please enter a valid end time");
      return;
    }

    if (startDate && endDate && endDate.getTime() <= startDate.getTime()) {
      pushToast("error", "End time must be after start time");
      return;
    }

    if (rate !== undefined && (!Number.isFinite(rate) || rate <= 0)) {
      pushToast("error", "Rate must be greater than 0");
      return;
    }

    const currentLifecycle = toLifecycleState(editingSession.state);
    if ((currentLifecycle === "Running" || currentLifecycle === "Completed") && !playerNameRaw) {
      pushToast("error", "Player name is required");
      return;
    }
    let overridePayerData: unknown = null;
    let includePayerOverride = false;

    if (currentLifecycle === "Running" || currentLifecycle === "Completed") {
      if (overridePayerMode === "single") {
        const name = overrideSinglePayerName.trim();
        if (!name) {
          pushToast("error", "Single payer name is required");
          return;
        }
        overridePayerData = { name };
        includePayerOverride = true;
      } else if (overridePayerMode === "split") {
        const invalid = overrideSplitRows.some(
          (row) =>
            row.name.trim() === "" ||
            row.percentage.trim() === "" ||
            !Number.isFinite(Number(row.percentage)),
        );
        if (invalid) {
          pushToast("error", "All split names and percentages must be valid");
          return;
        }

        const splitData = overrideSplitRows.map((row) => ({
          name: row.name.trim(),
          percentage: Number(row.percentage),
        }));
        const total = splitData.reduce((sum, row) => sum + row.percentage, 0);
        if (total !== 100) {
          pushToast("error", "Split percentage must sum to 100");
          return;
        }
        overridePayerData = splitData;
        includePayerOverride = true;
      } else {
        includePayerOverride =
          editingSession.overridePayerMode !== null || editingSession.overridePayerData !== null;
        overridePayerData = null;
      }
    }

    const payload: Record<string, unknown> = {
      sessionId: editingSession.id,
    };

    if (currentLifecycle === "Running") {
      if (
        playerNameRaw === editingSession.playerName &&
        !startDate &&
        rate === undefined &&
        !includePayerOverride
      ) {
        pushToast("error", "For running sessions, update player name, start time, rate, or payer");
        return;
      }
      if (playerNameRaw !== editingSession.playerName) {
        payload.overridePlayerName = playerNameRaw;
      }
      if (startDate) {
        payload.overrideStartTime = startDate.toISOString();
      }
      if (rate !== undefined) {
        payload.overrideRatePerMin = rate;
      }
      if (includePayerOverride) {
        payload.overridePayerMode = overridePayerMode;
        payload.overridePayerData = overridePayerData;
      }
    } else if (currentLifecycle === "Completed") {
      if (
        playerNameRaw === editingSession.playerName &&
        !startDate &&
        !endDate &&
        rate === undefined &&
        overrideOutcome === editingSession.outcome &&
        !includePayerOverride
      ) {
        pushToast("error", "For completed sessions, update player name, start time, end time, rate, or payer");
        return;
      }
      if (playerNameRaw !== editingSession.playerName) {
        payload.overridePlayerName = playerNameRaw;
      }
      if (startDate) {
        payload.overrideStartTime = startDate.toISOString();
      }
      if (endDate) {
        payload.overrideEndTime = endDate.toISOString();
      }
      if (rate !== undefined) {
        payload.overrideRatePerMin = rate;
      }
      if (includePayerOverride) {
        payload.overridePayerMode = overridePayerMode;
        payload.overridePayerData = overridePayerData;
      }
      if (overrideOutcome !== editingSession.outcome) {
        payload.overrideOutcome = overrideOutcome;
      }
    } else if (currentLifecycle === "Billed") {
      payload.overrideStatus = "completed";
    } else if (currentLifecycle === "Paid") {
      payload.overrideStatus = "billed";
    }

    setOverrideBusy(true);
    try {
      const res = await fetch("/api/session/override", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        pushToast("error", data?.error ?? "Failed to update session override");
        return;
      }

      pushToast("success", "Session override updated");
      closeOverrideModal();
      await loadAllSessions();
      await loadTables();
      await loadCompletedSessions();
      await loadUnpaidBills();
    } finally {
      setOverrideBusy(false);
    }
  }

  function appendPinDigit(digit: string) {
    if (loginBusy) {
      return;
    }
    setLoginPin((prev) => {
      const next = `${prev}${digit}`.replace(/\D/g, "").slice(0, 4);
      return next;
    });
  }

  function clearPin() {
    if (loginBusy) {
      return;
    }
    setLoginPin("");
  }

  function backspacePin() {
    if (loginBusy) {
      return;
    }
    setLoginPin((prev) => prev.slice(0, -1));
  }

  if (!authReady) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto mt-10 max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-md">
          <p className="text-sm text-slate-600">Loading session...</p>
        </div>
      </main>
    );
  }

  if (!activeUser) {
    return (
      <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
        <div className="mx-auto mt-4 flex min-h-[80vh] max-w-md items-center">
          <div className="w-full rounded-2xl border border-slate-300 bg-white p-6 shadow-md sm:p-8">
            <h1 className="text-center text-2xl font-bold text-slate-900">CueDesk Login</h1>
            <p className="mt-2 text-center text-sm text-slate-600">
            Login is required before any operation.
            </p>

            <input
              value={loginPin}
              onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Enter 4-digit PIN"
              inputMode="numeric"
              maxLength={4}
              className="mt-5 w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-center text-2xl tracking-[0.5em] text-slate-900"
            />

            <div className="mt-4 grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={loginBusy}
                  onClick={() => appendPinDigit(digit)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-4 text-xl font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                disabled={loginBusy}
                onClick={clearPin}
                className="rounded-xl border border-slate-300 bg-white px-4 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={loginBusy}
                onClick={() => appendPinDigit("0")}
                className="rounded-xl border border-slate-300 bg-white px-4 py-4 text-xl font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              >
                0
              </button>
              <button
                type="button"
                disabled={loginBusy}
                onClick={backspacePin}
                className="rounded-xl border border-slate-300 bg-white px-4 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Del
              </button>
            </div>

            <button
              type="button"
              disabled={loginBusy || loginPin.trim().length !== 4}
              onClick={() => void submitPinLogin()}
              className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-4 text-base font-semibold text-white hover:bg-slate-950 disabled:opacity-50"
            >
              {loginBusy ? "Logging in..." : "Login"}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              {isDark ? "Light Theme" : "Dark Theme"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen bg-slate-100 p-4 sm:p-6 ${isDark ? "theme-dark" : ""}`}>
      {toasts.length > 0 ? (
        <div className="fixed right-4 top-4 z-[100] flex w-[92vw] max-w-sm flex-col gap-2 sm:right-6 sm:top-6">
          {toasts.map((toast) => {
            const tone =
              toast.kind === "success"
                ? (isDark
                  ? "border-emerald-700 bg-emerald-950/80 text-emerald-200"
                  : "border-emerald-300 bg-emerald-50 text-emerald-900")
                : toast.kind === "error"
                  ? (isDark
                    ? "border-red-700 bg-red-950/80 text-red-200"
                    : "border-red-300 bg-red-50 text-red-900")
                  : (isDark
                    ? "border-slate-700 bg-slate-900/90 text-slate-100"
                    : "border-slate-300 bg-slate-50 text-slate-900");
            return (
              <button
                key={toast.id}
                type="button"
                onClick={() => removeToast(toast.id)}
                className={`rounded-lg border px-3 py-2 text-left text-sm shadow ${tone}`}
              >
                {toast.text}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">CueDesk Dashboard</h1>
          <div className="flex flex-wrap items-center gap-2">
            {activeUser ? (
              <p className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800">
                {activeUser.name} ({activeUser.role})
              </p>
            ) : (
              <>
                <input
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="PIN"
                  inputMode="numeric"
                  maxLength={4}
                  className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                />
                <button
                  type="button"
                  disabled={loginBusy}
                  onClick={() => void submitPinLogin()}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                >
                  Login
                </button>
              </>
            )}
            {activeUser ? (
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                Logout
              </button>
            ) : null}
            {activeUser ? (
              <button
                type="button"
                onClick={handleSwitchUser}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                Switch User
              </button>
            ) : null}
            {canManage ? (
              <Link
                href="/management"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                Management
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setShowReportsSidebar((prev) => !prev)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              {showReportsSidebar ? "Hide Reports" : "Reports"}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              {isDark ? "Light Theme" : "Dark Theme"}
            </button>
          </div>
        </div>

        {showManagement && canManage ? (
          <section className="mb-4 rounded-xl border border-slate-300 bg-white p-4 shadow-md">
            <h2 className="text-lg font-semibold text-slate-900">Management</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-200 p-3">
                <h3 className="text-sm font-semibold text-slate-900">Manage Tables</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    placeholder="Table name"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <input
                    value={newTableRate}
                    onChange={(e) => setNewTableRate(e.target.value)}
                    placeholder="Rate/min"
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void submitCreateTable()}
                    className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-2 max-h-40 overflow-auto rounded-md border border-slate-200">
                  {tables.map((table) => (
                    <div
                      key={`manage-table-${table.id}`}
                      className="flex items-center justify-between border-b border-slate-100 px-2 py-1 text-xs last:border-b-0"
                    >
                      <span>{table.name} - ₹{formatMoney(table.ratePerMin)}/min</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={tableManageBusyId === table.id}
                          onClick={() => void editTableInline(table)}
                          className="rounded bg-slate-200 px-2 py-0.5 text-[11px] text-slate-800 hover:bg-slate-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={tableManageBusyId === table.id}
                          onClick={() => void deleteTableInline(table)}
                          className="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 p-3">
                <h3 className="text-sm font-semibold text-slate-900">Manage Users</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="User name"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <input
                    value={newUserPin}
                    onChange={(e) => setNewUserPin(e.target.value)}
                    placeholder="PIN"
                    inputMode="numeric"
                    maxLength={4}
                    className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as "operator" | "admin")}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="operator">operator</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void submitCreateUser()}
                    className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-2 max-h-40 overflow-auto rounded-md border border-slate-200">
                  {managementUsers.map((user) => (
                    <div
                      key={`manage-user-${user.id}`}
                      className="flex items-center justify-between border-b border-slate-100 px-2 py-1 text-xs last:border-b-0"
                    >
                      <span>{user.name}</span>
                      <div className="flex items-center gap-1">
                        <select
                          value={user.role}
                          disabled={userManageBusyId === user.id}
                          onChange={(e) =>
                            void updateUserInline(user.id, {
                              role: e.target.value as "operator" | "admin",
                            })}
                          className="rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                        >
                          <option value="operator">operator</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          type="button"
                          disabled={userManageBusyId === user.id}
                          onClick={() => void updateUserInline(user.id, { isActive: !user.isActive })}
                          className="rounded bg-slate-200 px-2 py-0.5 text-[11px] text-slate-800 hover:bg-slate-300"
                        >
                          {user.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          disabled={userManageBusyId === user.id}
                          onClick={() => void deleteUserInline(user)}
                          className="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loading ? <p className="text-slate-600">Loading tables...</p> : null}

        <div className="flex flex-col gap-6 lg:flex-row">
          <section className="flex-1">
            <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-md">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Tables</h2>
              <div className="space-y-4">
                {tableSections.map((section) => (
                  <section key={section.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-base font-semibold text-slate-900">{section.title}</h3>
                    <div
                      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
                        (section.title === "Pool Tables" || section.title === "PlayStation") &&
                          section.rows.length === 2
                          ? "lg:mx-auto lg:max-w-[66.666667%] lg:grid-cols-2"
                          : "lg:grid-cols-3"
                      }`}
                    >
                      {section.rows.map((table) => {
                        const running = isRunningState(table.state);
                        const startedAt = formatTime12h(table.currentSession?.startTime);
                        const elapsed = formatElapsedFromStart(table.currentSession?.startTime);
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
                            <h3 className="text-lg font-semibold text-slate-900">{table.name}</h3>
                            <p className="mt-1 text-sm text-slate-700">
                              Rate: {formatRate(table.ratePerMin, table.name)}
                            </p>
                            <p className="mt-1 text-sm font-medium text-slate-900">Status: {statusText}</p>

                            {running ? (
                              <>
                                <p className="mt-2 text-sm text-slate-800">
                                  Player: {table.currentSession?.playerName ?? "-"}
                                </p>
                                <p className="mt-1 text-sm text-slate-800">
                                  Started {startedAt} • {elapsed} elapsed
                                </p>
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
                      {section.rows.length === 0 ? (
                        <p className="text-sm text-slate-500">No tables in this section.</p>
                      ) : null}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <section className="mt-6 rounded-xl border border-slate-300 bg-white p-4 shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Session Ledger (Current)</h2>
                <Link
                  href="/reports"
                  className="rounded-md bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-900"
                >
                  Open Reports
                </Link>
              </div>
              <p className="mt-1 text-[11px] text-slate-600">
                Business day: {formatDateTimeFull(ledgerWindow.start)} to {formatDateTimeFull(ledgerWindow.end)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-500 align-middle" />
                Rows with overrides are marked.
              </p>
              <div className="mt-3 max-h-[420px] overflow-auto">
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
                      <th className="px-2 py-2">Payer</th>
                      <th className="px-2 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLedgerRows.map((row, index) => {
                      const modeText = row.paymentModes?.length
                        ? row.paymentModes.join(", ")
                        : "-";
                      const overridden = hasSessionOverrides(row);
                      const prev = index > 0 ? sortedLedgerRows[index - 1] : null;
                      const groupDivider = prev && prev.billId !== row.billId
                        ? "border-t-4 border-slate-300"
                        : "";

                      return (
                      <tr
                        key={row.id}
                        className={`${ledgerRowColor(row.state)} ${groupDivider} ${
                          overridden ? "ring-1 ring-inset ring-indigo-200" : ""
                        }`}
                      >
                        <td className="px-2 py-2">
                          {row.billId ? `Bill #${row.billId}` : "-"}
                          {overridden ? (
                            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-indigo-500" />
                          ) : null}
                        </td>
                        <td className="px-2 py-2">{row.tableName}</td>
                        <td className="px-2 py-2">{row.playerName}</td>
                        <td className="px-2 py-2">{row.businessDayKey ?? "-"}</td>
                        <td className="px-2 py-2">{formatTime12h(row.startTime)}</td>
                        <td className="px-2 py-2">{formatTime12h(row.endTime)}</td>
                        <td className="px-2 py-2">{row.durationMinutes} min</td>
                        <td className="px-2 py-2">{formatRate(row.ratePerMin, row.tableName)}</td>
                        <td className="px-2 py-2">{formatLedgerAmountWithDiscount(row)}</td>
                        <td className="px-2 py-2">{formatMoney(row.effectivePaid)}</td>
                        <td className="px-2 py-2">{ledgerStatusText(row.state)}</td>
                        <td className="px-2 py-2">
                          <span>{modeText}</span>
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
                        <td className="px-2 py-2">{formatPayer(row.payerMode, row.payerData)}</td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => void openHistoryModal(row)}
                            className="mr-2 rounded-md bg-indigo-100 px-2 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-200"
                          >
                            History
                          </button>
                          {row.state !== "Cancelled" ? (
                            <button
                              type="button"
                              onClick={() => openOverrideModal(row)}
                              className="mr-2 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-900"
                            >
                              Edit
                            </button>
                          ) : null}
                          {(row.state === "Running" || row.state === "Completed") ? (
                            <button
                              type="button"
                              onClick={() => openCancelSessionModal(row)}
                              className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      );
                    })}
                    {sortedLedgerRows.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-slate-500" colSpan={14}>
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

              {selectedBill ? (
                <>
                  <div className="mt-3 rounded-md border border-slate-200 p-3">
                    <p className="text-sm font-semibold text-slate-800">Bill Discount</p>
                    <div className="mt-2 space-y-2">
                      <select
                        value={billDiscountType}
                        onChange={(e) =>
                          setBillDiscountType(e.target.value as "none" | "fixed" | "percent")
                        }
                        disabled={discountBusy || paymentBusy}
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
                          disabled={discountBusy || paymentBusy}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void applyBillDiscount()}
                        disabled={discountBusy || paymentBusy}
                        className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Apply Discount
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    <p>Bill ID: {selectedBill.id}</p>
                    <p>Subtotal: {formatMoney(selectedBill.totalAmount)}</p>
                    <p>
                      Discount:{" "}
                      {selectedBill.discountType === "fixed"
                        ? `₹${selectedBill.discountValue ?? 0}`
                        : selectedBill.discountType === "percent"
                          ? `${selectedBill.discountValue ?? 0}%`
                          : "-"}
                    </p>
                    <p>Total: {formatMoney(selectedBill.discountedAmount)}</p>
                    <p>Paid: {formatMoney(selectedBill.paidAmount)}</p>
                    <p className="font-semibold">Remaining: {formatMoney(selectedBill.remainingAmount)}</p>
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-slate-600">Payment History</p>
                      <ul className="mt-1 space-y-1 text-xs">
                        {selectedBill.payments.map((payment, index) => (
                          <li key={`${payment.mode}-${index}`}>
                            {payment.mode} ₹{formatMoney(payment.amount)}
                            {payment.mode === "due" ? (
                              <>
                                {" - "}
                                {(payment.dueCustomerName ?? "Unknown")} ({payment.dueCustomerPhone ?? "-"})
                                {payment.dueSettledAt
                                  ? ` [received via ${payment.dueReceivedMode ?? "cash"}]`
                                  : " [pending]"}
                              </>
                            ) : null}
                          </li>
                        ))}
                        {selectedBill.payments.length === 0 ? (
                          <li className="text-slate-500">No payments yet</li>
                        ) : null}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentAmount(String(selectedBill.remainingAmount))}
                      disabled={paymentBusy}
                      className="rounded-md bg-slate-200 px-3 py-1 text-xs disabled:opacity-50"
                    >
                      Pay Full
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentAmount("100")}
                      disabled={paymentBusy}
                      className="rounded-md bg-slate-200 px-3 py-1 text-xs disabled:opacity-50"
                    >
                      ₹100
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentAmount("200")}
                      disabled={paymentBusy}
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
                      disabled={paymentBusy}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                      disabled={paymentBusy}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="cash">cash</option>
                      <option value="upi">upi</option>
                      <option value="card">card</option>
                      <option value="due">due</option>
                    </select>
                    {paymentMode === "due" ? (
                      <div className="relative grid grid-cols-1 gap-2">
                        <input
                          type="text"
                          value={dueCustomerName}
                          onFocus={() => setShowCustomerSuggestions(true)}
                          onChange={(e) => {
                            setDueCustomerName(e.target.value);
                            setShowCustomerSuggestions(true);
                          }}
                          placeholder="Customer name"
                          disabled={paymentBusy}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          type="text"
                          value={dueCustomerPhone}
                          onFocus={() => setShowCustomerSuggestions(true)}
                          onChange={(e) => {
                            setDueCustomerPhone(e.target.value);
                            setShowCustomerSuggestions(true);
                          }}
                          placeholder="Customer phone number"
                          disabled={paymentBusy}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        {showCustomerSuggestions && customerSuggestions.length > 0 ? (
                          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                            {customerSuggestions.map((customer) => (
                              <button
                                key={customer.id}
                                type="button"
                                onClick={() => {
                                  setDueCustomerName(customer.name);
                                  setDueCustomerPhone(customer.phone);
                                  setShowCustomerSuggestions(false);
                                }}
                                className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50"
                              >
                                <span className="font-medium text-slate-800">{customer.name}</span>
                                <span className="text-slate-600">{customer.phone}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void addPayment()}
                      disabled={paymentBusy}
                      className="w-full rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      Add Payment
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                  Select a bill to view discount and payment controls.
                </div>
              )}
            </section>

          </aside>
        </div>
      </div>

      {showReportsSidebar ? (
        <button
          type="button"
          aria-label="Close reports sidebar"
          onClick={() => setShowReportsSidebar(false)}
          className="fixed inset-0 z-30 bg-black/30"
        />
      ) : null}
      <aside
        className={`fixed right-0 top-0 z-40 h-full w-[min(88vw,320px)] border-l border-slate-300 bg-white p-4 shadow-2xl transition-transform duration-300 ${
          showReportsSidebar ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Reports</h2>
            <p className="mt-1 text-xs text-slate-600">
              Open reports and analysis pages from here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowReportsSidebar(false)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          <Link
            href="/reports"
            onClick={() => setShowReportsSidebar(false)}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900"
          >
            Session Reports
          </Link>
          <Link
            href="/due-report"
            onClick={() => setShowReportsSidebar(false)}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Due Report
          </Link>
          <Link
            href="/bills"
            onClick={() => setShowReportsSidebar(false)}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Bills
          </Link>
        </div>
      </aside>

      {historySession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Session History - #{historySession.id}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Original values are kept for audit. Override values are applied as effective values.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-slate-800 md:grid-cols-2">
              <div className="rounded-md border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Original</p>
                <p>Status: {historySession.originalStatus}</p>
                <p>Bill: {historySession.billId ? `Bill #${historySession.billId}` : "-"}</p>
                <p>Start: {formatTimeHHmm(historySession.originalStartTime)}</p>
                <p>End: {formatTimeHHmm(historySession.originalEndTime)}</p>
                <p>Rate: {formatRate(historySession.originalRatePerMin, historySession.tableName)}</p>
                <p>Payer: {formatPayer(historySession.originalPayerMode, historySession.originalPayerData)}</p>
              </div>
              <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-indigo-700">Overrides</p>
                {getSessionOverrideDiffs(historySession).length === 0 ? (
                  <p>No overrides applied</p>
                ) : (
                  <div className="space-y-1">
                    {getSessionOverrideDiffs(historySession).map((diff) => (
                      <p key={diff.field}>
                        {getHistoryFieldLabel(diff.field)}: {formatHistoryFieldValue(diff.field, diff.value)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-md border border-slate-200 p-3 text-sm text-slate-800">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Effective Snapshot</p>
              <p>Final Status: {ledgerStatusText(historySession.state)}</p>
              <p>Start: {formatTimeHHmm(historySession.startTime)}</p>
              <p>End: {formatTimeHHmm(historySession.endTime)}</p>
              <p>Duration: {historySession.durationMinutes} min</p>
              <p>Total Amount: {formatMoney(historySession.amount)}</p>
              <p>Discount: {formatMoney(historySession.sessionDiscount)}</p>
              <p>Paid: {formatMoney(historySession.effectivePaid)}</p>
              <p>Remaining: {formatMoney(historySession.remainingAmount)}</p>
              <p>Payment Modes: {historySession.paymentModes.length ? historySession.paymentModes.join(", ") : "-"}</p>
              <p>Payer: {formatPayer(historySession.payerMode, historySession.payerData)}</p>
            </div>

            <div className="mt-3 rounded-md border border-slate-200 p-3 text-sm text-slate-800">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Session Timeline</p>
              {historyLoading ? (
                <p className="text-slate-600">Loading history...</p>
              ) : null}
              {historyError ? (
                <p className="text-red-600">{historyError}</p>
              ) : null}
              {!historyLoading && !historyError && historyEvents.length === 0 ? (
                <p className="text-slate-600">No history available for this session.</p>
              ) : null}
              {!historyLoading && !historyError && historyEvents.length > 0 ? (
                <div className="max-h-60 space-y-2 overflow-auto pr-1">
                  {historyEvents.map((event, index) => {
                    const isFirstInActionGroup =
                      index === 0 || historyEvents[index - 1]?.actionLabel !== event.actionLabel;
                    const visibleDiffs =
                      event.action === "override_update"
                        ? event.diffs.filter(
                          (diff) =>
                            diff.field.startsWith("override") ||
                            diff.field === "playerName" ||
                            diff.field === "outcome" ||
                            diff.field === "amount" ||
                            diff.field === "status" ||
                            diff.field === "billId" ||
                            diff.field === "cancellationReason",
                        )
                        : event.diffs;
                    return (
                      <div key={event.id} className="rounded border border-slate-200 bg-slate-50 p-2">
                        {isFirstInActionGroup ? (
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                            {event.actionLabel}
                          </p>
                        ) : null}
                        <p className="text-xs font-semibold text-slate-700">
                          {formatDateTimeFull(event.createdAt)}
                        </p>
                        <p className="text-xs text-slate-600">Changed by: {event.changedBy || "System"}</p>
                        {visibleDiffs.length === 0 ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {event.action === "override_update"
                              ? "No overrides applied"
                              : "No field-level changes available."}
                          </p>
                        ) : (
                          <div className="mt-2 space-y-1 rounded bg-white p-2 text-xs">
                            {visibleDiffs.map((diff) => {
                              return (
                                <p key={`${event.id}-${diff.field}`} className="text-slate-700">
                                  <span className="font-semibold">{getHistoryFieldLabel(diff.field)}:</span>{" "}
                                  <span className="text-slate-600">
                                    {formatHistoryFieldValue(diff.field, diff.before)}
                                  </span>{" "}
                                  {"->"}{" "}
                                  <span className="font-semibold text-slate-900">
                                    {formatHistoryFieldValue(diff.field, diff.after)}
                                  </span>
                                </p>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={closeHistoryModal}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {splitViewSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Payment Split - Session #{splitViewSession.id}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              {splitViewSession.billId ? `Bill #${splitViewSession.billId}` : "No bill linked"}
            </p>

            <div className="mt-3 rounded-md border border-slate-200 p-3">
              {splitViewSession.paymentSplit.length === 0 ? (
                <p className="text-sm text-slate-600">No split payments found.</p>
              ) : (
                <ul className="space-y-1 text-sm text-slate-800">
                  {splitViewSession.paymentSplit.map((entry) => (
                    <li key={`${entry.mode}-${entry.amount}`}>
                      {entry.mode.toUpperCase()}: ₹{formatMoney(entry.amount)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={closeSplitViewModal}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Edit Session Override - #{editingSession.id}
            </h3>

            {(() => {
              const currentLifecycle = toLifecycleState(editingSession.state);
              return (
            <div className="mt-3 space-y-3">
              {currentLifecycle === "Running" || currentLifecycle === "Completed" ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm text-slate-700">Player Name</label>
                    <input
                      value={overridePlayerName}
                      onChange={(e) => setOverridePlayerName(e.target.value)}
                      disabled={overrideBusy}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Enter player name"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-700">Start Time</label>
                    <input
                      type="time"
                      value={overrideStartTime}
                      onChange={(e) => setOverrideStartTime(e.target.value)}
                      disabled={overrideBusy}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={overrideStartIncludeDate}
                        onChange={(e) => setOverrideStartIncludeDate(e.target.checked)}
                        disabled={overrideBusy}
                      />
                      Include date
                    </label>
                    {overrideStartIncludeDate ? (
                      <input
                        type="date"
                        value={overrideStartDate}
                        onChange={(e) => setOverrideStartDate(e.target.value)}
                        disabled={overrideBusy}
                        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                    ) : null}
                  </div>
                  {currentLifecycle === "Completed" ? (
                    <div>
                      <label className="mb-1 block text-sm text-slate-700">End Time</label>
                      <input
                        type="time"
                        value={overrideEndTime}
                        onChange={(e) => setOverrideEndTime(e.target.value)}
                        disabled={overrideBusy}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={overrideEndIncludeDate}
                          onChange={(e) => setOverrideEndIncludeDate(e.target.checked)}
                          disabled={overrideBusy}
                        />
                        Include date
                      </label>
                      {overrideEndIncludeDate ? (
                        <input
                          type="date"
                          value={overrideEndDate}
                          onChange={(e) => setOverrideEndDate(e.target.value)}
                          disabled={overrideBusy}
                          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      ) : null}
                    </div>
                  ) : null}
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
                  {currentLifecycle === "Completed" ? (
                    <div>
                      <label className="mb-1 block text-sm text-slate-700">Outcome</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setOverrideOutcome("NORMAL")}
                          disabled={overrideBusy}
                          className={`rounded-md px-3 py-1 text-sm ${
                            overrideOutcome === "NORMAL" ? "bg-slate-900 text-white" : "bg-slate-200"
                          }`}
                        >
                          Normal
                        </button>
                        <button
                          type="button"
                          onClick={() => setOverrideOutcome("LTP_LOSS")}
                          disabled={overrideBusy}
                          className={`rounded-md px-3 py-1 text-sm ${
                            overrideOutcome === "LTP_LOSS" ? "bg-fuchsia-700 text-white" : "bg-slate-200"
                          }`}
                        >
                          LTP Loss
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <label className="mb-1 block text-sm text-slate-700">Payer Details</label>
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
                        placeholder="Enter payer name"
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
                      <button
                        type="button"
                        onClick={() => setOverrideSplitRows((prev) => applyEqualSplit(prev))}
                        disabled={overrideBusy}
                        className="rounded-md bg-blue-100 px-3 py-2 text-sm text-blue-800 hover:bg-blue-200 disabled:opacity-50"
                      >
                        Split Equally
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {currentLifecycle === "Billed" ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This billed session can only be moved back to unbilled.
                </div>
              ) : null}

              {currentLifecycle === "Paid" ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  This paid session can only be moved back to billed. Payments will be cleared
                  from active bill data and preserved in override history.
                </div>
              ) : null}
            </div>
              );
            })()}

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

      {cancelSessionTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Cancel Session - #{cancelSessionTarget.id}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              {cancelSessionTarget.tableName} | {cancelSessionTarget.playerName}
            </p>

            <div className="mt-3">
              <label className="mb-1 block text-sm text-slate-700">Cancellation Reason</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                disabled={cancelBusy}
                className="min-h-[92px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Enter reason"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCancelSessionModal}
                disabled={cancelBusy}
                className="rounded-md bg-slate-200 px-3 py-2 text-sm disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void submitCancelSession()}
                disabled={cancelBusy}
                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Cancel Session
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
                <div className="relative">
                  <div className="flex gap-2">
                    <input
                      value={startPlayerName}
                      onFocus={() => setShowStartPlayerSuggestions(true)}
                      onChange={(e) => {
                        setStartPlayerName(e.target.value);
                        setShowStartPlayerSuggestions(true);
                      }}
                      disabled={busyTableId === startTable.id}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Enter player name or phone"
                    />
                    <button
                      type="button"
                      onClick={startPlayerVoiceInput}
                      disabled={busyTableId === startTable.id}
                      className={`rounded-md px-3 py-2 text-xs font-medium text-white ${
                        startVoiceListening ? "bg-red-600 hover:bg-red-700" : "bg-slate-700 hover:bg-slate-800"
                      }`}
                    >
                      {startVoiceListening ? "Stop" : "Speak"}
                    </button>
                  </div>
                  {showStartPlayerSuggestions && startPlayerSuggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                      {startPlayerSuggestions.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => {
                            setStartPlayerName(customer.name);
                            setShowStartPlayerSuggestions(false);
                          }}
                          className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50"
                        >
                          <span className="font-medium text-slate-800">{customer.name}</span>
                          <span className="text-slate-600">{customer.phone}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Leave empty to auto-use a generic walk-in name.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-700">
                  Start Time (Optional)
                </label>
                <input
                  type="time"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  disabled={busyTableId === startTable.id}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={startIncludeDate}
                    onChange={(e) => setStartIncludeDate(e.target.checked)}
                    disabled={busyTableId === startTable.id}
                  />
                  Include date
                </label>
                {startIncludeDate ? (
                  <input
                    type="date"
                    value={startDateInput}
                    onChange={(e) => setStartDateInput(e.target.value)}
                    disabled={busyTableId === startTable.id}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                ) : null}
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
              {endTable.state === "Running-NoPayer" && !endAsLtpLoss ? (
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
                  type="time"
                  value={endTimeInput}
                  onChange={(e) => setEndTimeInput(e.target.value)}
                  disabled={busyTableId === endTable.id}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={endIncludeDate}
                    onChange={(e) => setEndIncludeDate(e.target.checked)}
                    disabled={busyTableId === endTable.id}
                  />
                  Include date
                </label>
                {endIncludeDate ? (
                  <input
                    type="date"
                    value={endDateInput}
                    onChange={(e) => setEndDateInput(e.target.value)}
                    disabled={busyTableId === endTable.id}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                ) : null}
              </div>
              <label className="flex items-center gap-2 rounded border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-sm text-fuchsia-900">
                <input
                  type="checkbox"
                  checked={endAsLtpLoss}
                  onChange={(e) => setEndAsLtpLoss(e.target.checked)}
                  disabled={busyTableId === endTable.id}
                />
                End as LTP Loss (No charge)
              </label>
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
                className={`rounded-md px-3 py-2 text-sm text-white disabled:opacity-50 ${
                  endAsLtpLoss ? "bg-fuchsia-600" : "bg-red-600"
                }`}
              >
                {endAsLtpLoss ? "End as LTP Loss" : "End Session"}
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
                <button
                  type="button"
                  onClick={() => setSplitRows((prev) => applyEqualSplit(prev))}
                  className="rounded-md bg-blue-100 px-3 py-2 text-sm text-blue-800 hover:bg-blue-200"
                >
                  Split Equally
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
