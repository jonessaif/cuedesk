import { getEffectiveBillTotals, roundMoney } from "@/lib/billTotals";
import { getBusinessDayRangeWithReset, getBusinessDayRangeFromKeyWithReset } from "@/lib/businessDay";
import { getLedgerResetMinutesCached, hydrateLedgerResetMinutesCache } from "@/lib/settings-service";
import {
  getEffectiveStatus,
  getLedgerStatus,
  isBilled,
} from "@/lib/session-status";
import {
  canTransition,
  deriveLifecycleState,
  LifecycleState,
  toSessionStatus,
} from "@/lib/state-machine";

function getEffectiveStartTime(session: {
  startTime: Date;
  overrideStartTime?: Date | null;
}): Date {
  return session.overrideStartTime ?? session.startTime;
}

function getEffectiveEndTime(
  session: {
    endTime?: Date | null;
    overrideEndTime?: Date | null;
    status?: "running" | "completed" | "billed";
    overrideStatus?: string | null;
  },
  fallback?: Date,
): Date | null {
  const effectiveStatus = getEffectiveSessionStatus({
    status: session.status ?? "completed",
    overrideStatus: session.overrideStatus,
  });
  if (effectiveStatus === "running") {
    return null;
  }

  if (session.overrideEndTime) {
    return session.overrideEndTime;
  }
  if (session.endTime) {
    return session.endTime;
  }
  return fallback ?? null;
}

function getEffectiveRatePerMin(
  session: { overrideRatePerMin?: number | null },
  baseRatePerMin: number,
): number {
  return session.overrideRatePerMin ?? baseRatePerMin;
}

function normalizePayerMode(value: unknown): "none" | "single" | "split" {
  if (value === "single" || value === "split" || value === "none") {
    return value;
  }
  return "none";
}

function normalizeSessionOutcome(value: unknown): "NORMAL" | "LTP_LOSS" | "CANCELLED" {
  if (value === "LTP_LOSS" || value === "CANCELLED" || value === "NORMAL") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "LTP_LOSS" || normalized === "LTP-LOSS" || normalized === "LTP") {
      return "LTP_LOSS";
    }
    if (normalized === "CANCELLED" || normalized === "CANCELED") {
      return "CANCELLED";
    }
  }
  return "NORMAL";
}

function getEffectivePayerMode(session: {
  payerMode: "none" | "single" | "split";
  overridePayerMode?: string | null;
}): "none" | "single" | "split" {
  return normalizePayerMode(session.overridePayerMode ?? session.payerMode);
}

function getEffectivePayerData(session: {
  payerData: unknown;
  overridePayerData?: unknown;
}): unknown {
  if (session.overridePayerData !== undefined && session.overridePayerData !== null) {
    return session.overridePayerData;
  }
  return session.payerData;
}

function validateOverridePayer(
  mode: "none" | "single" | "split",
  data: unknown,
): void {
  if (mode === "single") {
    const name = (data as { name?: unknown } | null | undefined)?.name;
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error("Invalid override payer data");
    }
    return;
  }

  if (mode === "split") {
    if (!Array.isArray(data)) {
      throw new Error("Invalid override payer data");
    }

    const total = data.reduce((sum, row) => {
      const entry = row as { percentage?: unknown };
      if (typeof entry.percentage !== "number" || Number.isNaN(entry.percentage)) {
        throw new Error("Invalid override payer data");
      }
      return sum + entry.percentage;
    }, 0);

    if (total !== 100) {
      throw new Error("Invalid split percentage");
    }
  }
}

function calculateDurationMinutes(startTime: Date, endTime: Date | null): number {
  if (!endTime) {
    return 0;
  }

  const minutes = Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
  return minutes > 0 ? minutes : 0;
}

function isHourlyTable(tableName: string | undefined): boolean {
  if (!tableName) {
    return false;
  }
  return tableName.toUpperCase().startsWith("PS");
}

function calculateAmount(
  startTime: Date,
  endTime: Date | null,
  ratePerMin: number,
  tableName?: string,
): number {
  if (!endTime) {
    return 0;
  }

  const diffMs = endTime.getTime() - startTime.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  if (isHourlyTable(tableName)) {
    const hourlyRate = ratePerMin * 60;
    const billedHours = Math.ceil(diffMs / (60 * 60 * 1000));
    return roundMoney(billedHours * hourlyRate);
  }

  const durationMinutes = Math.floor(diffMs / 60000);
  return durationMinutes > 0 ? roundMoney(durationMinutes * ratePerMin) : 0;
}

function getEffectiveSessionStatus(session: {
  status: "running" | "completed" | "billed";
  overrideStatus?: string | null;
}): "running" | "completed" | "billed" {
  return getEffectiveStatus({
    status: session.status,
    overrideStatus: session.overrideStatus,
  });
}

function normalizeOverridePaymentModes(
  value: unknown,
): Array<"cash" | "upi" | "card" | "due"> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const unique: Array<"cash" | "upi" | "card" | "due"> = [];
  for (const item of value) {
    if (item !== "cash" && item !== "upi" && item !== "card" && item !== "due") {
      continue;
    }
    if (!unique.includes(item)) {
      unique.push(item);
    }
  }

  return unique;
}

function deriveLedgerState(input: {
  status: "running" | "completed" | "billed";
  billId: number | null;
  paidAmount: number;
  amount: number;
  outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
  cancellationReason?: string | null;
}): "Running" | "Completed" | "Billed-Unpaid" | "Partially-Paid" | "Paid" | "Cancelled" | "LTP-Loss" {
  if (input.outcome === "LTP_LOSS") {
    return "LTP-Loss";
  }
  if (input.outcome === "CANCELLED") {
    return "Cancelled";
  }
  if (typeof input.cancellationReason === "string" && input.cancellationReason.trim() !== "") {
    return "Cancelled";
  }
  return getLedgerStatus({
    effectiveStatus: input.status,
    billId: input.billId,
    paidAmount: input.paidAmount,
    amount: input.amount,
  });
}

function derivePaymentSplit(
  payments: Array<{
    amount: number;
    mode: "cash" | "upi" | "card" | "due";
  }>,
): Array<{
  mode: "cash" | "upi" | "card" | "due";
  amount: number;
}> {
  if (payments.length === 0) {
    return [];
  }

  const totals: Record<"cash" | "upi" | "card" | "due", number> = {
    cash: 0,
    upi: 0,
    card: 0,
    due: 0,
  };

  for (const payment of payments) {
    totals[payment.mode] += payment.amount;
  }

  const order: Array<"cash" | "upi" | "card" | "due"> = ["cash", "upi", "card", "due"];
  return order
    .map((mode) => ({ mode, amount: roundMoney(totals[mode]) }))
    .filter((entry) => entry.amount > 0);
}

function distributeProportionally(
  total: number,
  weights: Array<{ id: number; weight: number }>,
): Map<number, number> {
  const normalizedTotal = roundMoney(Math.max(total, 0));
  const validWeights = weights.filter((entry) => entry.weight > 0);
  const result = new Map<number, number>();
  if (normalizedTotal <= 0 || validWeights.length === 0) {
    for (const entry of weights) {
      result.set(entry.id, 0);
    }
    return result;
  }

  const weightSum = validWeights.reduce((sum, entry) => sum + entry.weight, 0);
  let assigned = 0;
  for (let index = 0; index < validWeights.length; index += 1) {
    const entry = validWeights[index];
    let share = 0;
    if (index === validWeights.length - 1) {
      share = roundMoney(normalizedTotal - assigned);
    } else {
      share = roundMoney((entry.weight / weightSum) * normalizedTotal);
      assigned = roundMoney(assigned + share);
    }
    result.set(entry.id, share);
  }

  for (const entry of weights) {
    if (!result.has(entry.id)) {
      result.set(entry.id, 0);
    }
  }

  return result;
}

type SessionOverrideAuditSource = {
  playerName?: string;
  status: "running" | "completed" | "billed";
  outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
  cancellationReason?: string | null;
  billId: number | null;
  amount?: number | null;
  overrideStartTime?: Date | null;
  overrideEndTime?: Date | null;
  overrideRatePerMin?: number | null;
  overridePayerMode?: string | null;
  overridePayerData?: unknown;
  overrideStatus?: string | null;
  overridePaymentModes?: unknown;
};

type AuditDiffEntry = {
  field: string;
  before: unknown;
  after: unknown;
};

function toIso(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.toISOString();
}

function buildOverrideAuditSnapshot(session: SessionOverrideAuditSource) {
  return {
    playerName: session.playerName ?? "",
    status: session.status,
    outcome: session.outcome ?? "NORMAL",
    cancellationReason: session.cancellationReason ?? null,
    billId: session.billId,
    amount: typeof session.amount === "number" ? roundMoney(session.amount) : 0,
    overrideStartTime: toIso(session.overrideStartTime),
    overrideEndTime: toIso(session.overrideEndTime),
    overrideRatePerMin: session.overrideRatePerMin ?? null,
    overridePayerMode: session.overridePayerMode ?? null,
    overridePayerData: session.overridePayerData ?? null,
    overrideStatus: session.overrideStatus ?? null,
    overridePaymentModes: normalizeOverridePaymentModes(session.overridePaymentModes),
  };
}

function buildAuditDiffEntries(
  beforeSnapshot: Record<string, unknown>,
  afterSnapshot: Record<string, unknown>,
): AuditDiffEntry[] {
  const keys = Array.from(new Set([
    ...Object.keys(beforeSnapshot),
    ...Object.keys(afterSnapshot),
  ]));
  return keys
    .filter((key) => JSON.stringify(beforeSnapshot[key]) !== JSON.stringify(afterSnapshot[key]))
    .map((key) => ({
      field: key,
      before: beforeSnapshot[key],
      after: afterSnapshot[key],
    }));
}

function toHistoryActionLabel(action: string): string {
  if (action === "session_started") {
    return "Session Started";
  }
  if (action === "session_ended") {
    return "Session Ended";
  }
  if (action === "bill_created") {
    return "Bill Created";
  }
  if (action === "payment_recorded") {
    return "Payment Settled";
  }
  if (action === "due_settled") {
    return "Payment Settled";
  }
  if (action === "override_update") {
    return "Override Updated";
  }
  if (action === "session_cancelled") {
    return "Session Cancelled";
  }
  return action.replaceAll("_", " ");
}

function toBusinessDayStart(input: Date): Date {
  return getBusinessDayRangeWithReset(input, getLedgerResetMinutesCached()).start;
}

function toBusinessDayKeyFromDate(input: Date): string {
  return getBusinessDayRangeWithReset(input, getLedgerResetMinutesCached()).key;
}

function toBusinessDayWindowFromKey(key: string): { start: Date; end: Date } {
  const range = getBusinessDayRangeFromKeyWithReset(key, getLedgerResetMinutesCached());
  return { start: range.start, end: range.end };
}

function normalizeDayKeyInput(dateInput: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    throw new Error("Invalid date");
  }
  return dateInput;
}

function normalizeRangeInput(
  startDateInput: string | undefined,
  endDateInput: string | undefined,
): { startDate: string; endDate: string } {
  if (!startDateInput || !endDateInput) {
    throw new Error("Start date and end date are required");
  }

  const startDate = normalizeDayKeyInput(startDateInput);
  const endDate = normalizeDayKeyInput(endDateInput);
  if (startDate > endDate) {
    throw new Error("Invalid date range");
  }
  return { startDate, endDate };
}

async function ensureLedgerResetHydrated(prisma: unknown): Promise<void> {
  await hydrateLedgerResetMinutesCache(
    prisma as Parameters<typeof hydrateLedgerResetMinutesCache>[0],
  );
}

export const sessionService = {
  async startSession(
    prisma: unknown,
    input: { tableId: number; playerName: string; startTime?: Date },
  ) {
    await ensureLedgerResetHydrated(prisma);
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;

    const runningSession = await (
      sessionModel as {
        findFirst: (args: { where: { tableId: number; status: string } }) => Promise<unknown>;
      }
    ).findFirst({
      where: {
        tableId: input.tableId,
        status: "running",
      },
    });

    if (runningSession) {
      throw new Error("Session already running");
    }

    const startTime = input.startTime ?? new Date();

    return (
      sessionModel as {
        create: (args: {
          data: {
            tableId: number;
            businessDayKey: string;
            playerName: string;
            status: string;
            outcome: "NORMAL";
            startTime: Date;
          };
        }) => Promise<unknown>;
      }
    ).create({
      data: {
        tableId: input.tableId,
        businessDayKey: toBusinessDayKeyFromDate(startTime),
        playerName: input.playerName,
        status: "running",
        outcome: "NORMAL",
        startTime,
      },
    });
  },

  async endSession(
    prisma: unknown,
    input: { tableId: number; now: Date; outcome?: "NORMAL" | "LTP_LOSS" },
  ) {
    await ensureLedgerResetHydrated(prisma);
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const tableModel = (prisma as { table?: unknown; tables?: unknown }).table ??
      (prisma as { table?: unknown; tables?: unknown }).tables;

    const session = (await (
      sessionModel as {
        findFirst: (args: {
          where: {
            tableId: number;
            OR: Array<{ status: string } | { overrideStatus: string }>;
          };
          orderBy: { startTime: "desc" };
        }) => Promise<unknown>;
      }
    ).findFirst({
      where: {
        tableId: input.tableId,
        OR: [{ status: "running" }, { overrideStatus: "running" }],
      },
      orderBy: { startTime: "desc" },
    })) as {
      id: number;
      startTime: Date;
      overrideStatus?: string | null;
      overrideStartTime?: Date | null;
      overrideEndTime?: Date | null;
      overrideRatePerMin?: number | null;
    } | null;

    if (!session) {
      throw new Error("No active session");
    }

    const table = (await (
      tableModel as { findUnique: (args: { where: { id: number } }) => Promise<unknown> }
    ).findUnique({
      where: { id: input.tableId },
    })) as { ratePerMin: number; name: string };

    const effectiveStartTime = getEffectiveStartTime(session);
    const effectiveEndTime = input.now;
    const effectiveRatePerMin = getEffectiveRatePerMin(session, table.ratePerMin);
    const durationMinutes = calculateDurationMinutes(effectiveStartTime, effectiveEndTime);
    if (durationMinutes <= 0) {
      throw new Error("Cannot end session with 0 minutes");
    }
    const amount = calculateAmount(
      effectiveStartTime,
      effectiveEndTime,
      effectiveRatePerMin,
      table.name,
    );

    return (
      sessionModel as {
        update: (args: {
          where: { id: number };
          data: {
            status: string;
            endTime: Date;
            amount: number;
            outcome: "NORMAL" | "LTP_LOSS";
            overrideStatus: null;
          };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id: session.id },
      data: {
        status: "completed",
        endTime: input.now,
        amount: input.outcome === "LTP_LOSS" ? 0 : amount,
        outcome: input.outcome ?? "NORMAL",
        overrideStatus: null,
      },
    });
  },

  async cancelSession(
    prisma: unknown,
    input: { sessionId: number; reason: string; now?: Date; changedBy?: string },
  ) {
    await ensureLedgerResetHydrated(prisma);
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    const overrideEventModel = (prisma as {
      sessionOverrideEvent?: unknown;
      sessionOverrideEvents?: unknown;
    }).sessionOverrideEvent ??
      (prisma as {
        sessionOverrideEvent?: unknown;
        sessionOverrideEvents?: unknown;
      }).sessionOverrideEvents;

    const reason = input.reason.trim();
    if (!reason) {
      throw new Error("Cancellation reason is required");
    }

    const session = (await (
      sessionModel as {
        findUnique: (args: { where: { id: number } }) => Promise<unknown>;
      }
    ).findUnique({
      where: { id: input.sessionId },
    })) as {
      id: number;
      status: "running" | "completed" | "billed";
      outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
      overrideStatus?: string | null;
      startTime: Date;
      endTime: Date | null;
      overrideEndTime?: Date | null;
      amount?: number | null;
      billId: number | null;
      cancellationReason?: string | null;
      canceledAt?: Date | null;
    } | null;

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.cancellationReason) {
      throw new Error("Session already cancelled");
    }
    if (session.outcome === "LTP_LOSS") {
      throw new Error("LTP loss session cannot be cancelled");
    }

    if (session.billId !== null) {
      const payments = await (
        paymentModel as {
          findMany: (args: {
            where: { billId: number };
            select: { id: true };
          }) => Promise<Array<{ id: number }>>;
        }
      ).findMany({
        where: { billId: session.billId },
        select: { id: true },
      });
      if (payments.length > 0) {
        throw new Error("Cannot cancel billed/paid session");
      }
      throw new Error("Cannot cancel billed/paid session");
    }

    const now = input.now ?? new Date();
    const updatedSession = await (
      sessionModel as {
        update: (args: {
          where: { id: number };
          data: {
            status: "completed";
            endTime: Date;
            overrideStatus: null;
            overrideEndTime: null;
            amount: number;
            outcome: "CANCELLED";
            cancellationReason: string;
            canceledAt: Date;
          };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id: session.id },
      data: {
        status: "completed",
        endTime: session.endTime ?? now,
        overrideStatus: null,
        overrideEndTime: null,
        amount: 0,
        outcome: "CANCELLED",
        cancellationReason: reason,
        canceledAt: now,
      },
    });

    if (overrideEventModel) {
      const beforeData = {
        status: session.status,
        outcome: session.outcome ?? "NORMAL",
        billId: session.billId,
        amount: typeof session.amount === "number" ? roundMoney(session.amount) : 0,
        cancellationReason: session.cancellationReason ?? null,
        canceledAt: toIso(session.canceledAt),
      };
      const afterData = {
        status: "completed",
        outcome: "CANCELLED",
        billId: null,
        amount: 0,
        cancellationReason: reason,
        canceledAt: now.toISOString(),
        changedBy: input.changedBy?.trim() || "Operator",
      };
      const changedFields = buildAuditDiffEntries(beforeData, afterData);

      await (
        overrideEventModel as {
          create: (args: {
            data: {
              sessionId: number;
              action: string;
              changedFields: unknown;
              beforeData: unknown;
              afterData: unknown;
            };
          }) => Promise<unknown>;
        }
      ).create({
        data: {
          sessionId: session.id,
          action: "session_cancelled",
          changedFields,
          beforeData,
          afterData,
        },
      });
    }

    return updatedSession;
  },

  async overrideSession(
    prisma: unknown,
    input: {
      sessionId: number;
      overridePlayerName?: string;
      overrideStartTime?: Date;
      overrideEndTime?: Date;
      overrideRatePerMin?: number;
      overridePayerMode?: "none" | "single" | "split";
      overridePayerData?: unknown;
      overrideStatus?: "running" | "completed" | "billed" | "default";
      overrideOutcome?: "NORMAL" | "LTP_LOSS";
      overridePaymentModes?: Array<"cash" | "upi" | "card" | "due"> | null;
      adminOverride?: boolean;
      changedBy?: string;
    },
  ) {
    await ensureLedgerResetHydrated(prisma);
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const tableModel = (prisma as { table?: unknown; tables?: unknown }).table ??
      (prisma as { table?: unknown; tables?: unknown }).tables;
    const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
      (prisma as { bill?: unknown; bills?: unknown }).bills;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    const overrideEventModel = (prisma as {
      sessionOverrideEvent?: unknown;
      sessionOverrideEvents?: unknown;
    }).sessionOverrideEvent ??
      (prisma as {
        sessionOverrideEvent?: unknown;
        sessionOverrideEvents?: unknown;
      }).sessionOverrideEvents;

    const session = (await (
      sessionModel as {
        findUnique: (args: { where: { id: number } }) => Promise<unknown>;
      }
    ).findUnique({
      where: { id: input.sessionId },
    })) as {
      id: number;
      tableId: number;
      playerName: string;
      status: "running" | "completed" | "billed";
      outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
      startTime: Date;
      endTime: Date | null;
      payerMode: "none" | "single" | "split";
      payerData: unknown;
      overrideStartTime?: Date | null;
      overrideEndTime?: Date | null;
      overrideRatePerMin?: number | null;
      overridePayerMode?: string | null;
      overridePayerData?: unknown;
      overrideStatus?: string | null;
      overridePaymentModes?: unknown;
      billId: number | null;
      amount?: number | null;
      cancellationReason?: string | null;
      businessDayKey?: string | null;
    } | null;

    if (!session) {
      throw new Error("Session not found");
    }
    if (session.outcome === "CANCELLED" || session.cancellationReason) {
      throw new Error("Cancelled session cannot be overridden");
    }

    const table = (await (
      tableModel as { findUnique: (args: { where: { id: number } }) => Promise<unknown> }
    ).findUnique({
      where: { id: session.tableId },
    })) as { ratePerMin: number; name: string } | null;

    if (!table) {
      throw new Error("Table not found");
    }

    const overridePlayerName = input.overridePlayerName?.trim();
    if (input.overridePlayerName !== undefined && !overridePlayerName) {
      throw new Error("Invalid player name");
    }

    const billId = session.billId;
    const existingPayments = billId
      ? await (
        paymentModel as {
          findMany: (args: {
            where: { billId: number };
          }) => Promise<Array<{
            id?: number;
            billId?: number;
            amount: number;
            mode?: "cash" | "upi" | "card" | "due";
            dueCustomerName?: string | null;
            dueCustomerPhone?: string | null;
            dueSettledAt?: Date | null;
            dueReceivedMode?: "cash" | "upi" | "card" | "due" | null;
          }>>;
        }
      ).findMany({
        where: { billId },
      })
      : [];
    const existingPaidAmount = existingPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const lifecycleBillTotal = billId &&
      (billModel as { findUnique?: unknown }).findUnique &&
      (sessionModel as { findMany?: unknown }).findMany
      ? await (async () => {
        const bill = await (
          billModel as {
            findUnique: (args: {
              where: { id: number };
              select: { id: true; totalAmount: true; discountedAmount: true; discountType: true };
            }) => Promise<{
              id: number;
              totalAmount: number;
              discountedAmount: number;
              discountType: string | null;
            } | null>;
          }
        ).findUnique({
          where: { id: billId },
          select: { id: true, totalAmount: true, discountedAmount: true, discountType: true },
        });
        if (!bill) {
          return 0;
        }
        const billSessions = await (
          sessionModel as {
            findMany: (args: {
              where: { billId: number };
              select: { amount: true };
            }) => Promise<Array<{ amount: number | null }>>;
          }
        ).findMany({
          where: { billId },
          select: { amount: true },
        });
        const sessionsAmount = roundMoney(billSessions.reduce(
          (sum, row) => sum + (typeof row.amount === "number" ? row.amount : 0),
          0,
        ));
        return getEffectiveBillTotals({
          totalAmount: bill.totalAmount,
          discountType: bill.discountType,
          discountedAmount: bill.discountedAmount,
          sessionsAmount,
          paidAmount: existingPaidAmount,
        }).discountedAmount;
      })()
      : 0;

    const effectiveStatus = getEffectiveSessionStatus({
      status: session.status,
      overrideStatus:
        input.overrideStatus === "default"
          ? null
          : (input.overrideStatus ?? session.overrideStatus),
    });

    const currentLifecycleState = deriveLifecycleState({
      status: getEffectiveSessionStatus({
        status: session.status,
        overrideStatus: session.overrideStatus,
      }),
      billId: session.billId,
      paidAmount: existingPaidAmount,
      billedAmount: lifecycleBillTotal,
    });
    const requestedLifecycleState: LifecycleState | undefined =
      input.overrideStatus === "running"
        ? "Running"
        : input.overrideStatus === "completed"
          ? "Completed"
          : input.overrideStatus === "billed"
            ? "Billed"
            : undefined;
    const nextLifecycleState = requestedLifecycleState ??
      deriveLifecycleState({
        status: effectiveStatus,
        billId: session.billId,
        paidAmount: existingPaidAmount,
        billedAmount: lifecycleBillTotal,
      });
    const hasOverrideStart = input.overrideStartTime !== undefined;
    const hasOverridePlayerName = overridePlayerName !== undefined;
    const hasOverrideEnd = input.overrideEndTime !== undefined;
    const hasOverrideRate = input.overrideRatePerMin !== undefined;
    const hasOverridePayer = input.overridePayerMode !== undefined || input.overridePayerData !== undefined;
    const hasOverrideStatus = input.overrideStatus !== undefined && input.overrideStatus !== "default";
    const hasOverrideOutcome = input.overrideOutcome !== undefined;
    const hasOverridePaymentModes = input.overridePaymentModes !== undefined;

    if (currentLifecycleState === "Running") {
      if (hasOverrideEnd || hasOverrideStatus || hasOverrideOutcome || hasOverridePaymentModes) {
        throw new Error("Running overrides allow player name, start time, rate, or payer details");
      }
      if (!hasOverridePlayerName && !hasOverrideStart && !hasOverrideRate && !hasOverridePayer) {
        throw new Error("No allowed override fields for running session");
      }
    }

    if (currentLifecycleState === "Completed") {
      if (hasOverrideStatus || hasOverridePaymentModes) {
        throw new Error("Completed overrides allow player name, start time, end time, rate, or payer details");
      }
      if (!hasOverridePlayerName && !hasOverrideStart && !hasOverrideEnd && !hasOverrideRate && !hasOverridePayer && !hasOverrideOutcome) {
        throw new Error("No allowed override fields for completed session");
      }
    }

    if (currentLifecycleState === "Billed") {
      if (
        input.overrideStatus !== "completed" ||
        hasOverridePlayerName ||
        hasOverrideStart ||
        hasOverrideEnd ||
        hasOverrideRate ||
        hasOverridePayer ||
        hasOverrideOutcome ||
        hasOverridePaymentModes
      ) {
        throw new Error("Billed session can only be moved back to unbilled");
      }
    }

    if (currentLifecycleState === "Paid") {
      if (
        input.overrideStatus !== "billed" ||
        hasOverridePlayerName ||
        hasOverrideStart ||
        hasOverrideEnd ||
        hasOverrideRate ||
        hasOverridePayer ||
        hasOverrideOutcome ||
        hasOverridePaymentModes
      ) {
        throw new Error("Paid session can only be moved back to billed");
      }
    }

    if (!canTransition(currentLifecycleState, nextLifecycleState)) {
      throw new Error("Invalid state transition");
    }

    const effectiveStartTime =
      input.overrideStartTime ??
      session.overrideStartTime ??
      session.startTime;
    const nextBusinessDayKey = toBusinessDayKeyFromDate(effectiveStartTime);
    const effectiveEndTime =
      effectiveStatus === "running"
        ? null
        : (input.overrideEndTime ??
          session.overrideEndTime ??
          session.endTime);
    const effectiveRatePerMin =
      input.overrideRatePerMin ??
      session.overrideRatePerMin ??
      table.ratePerMin;

    if (
      effectiveStatus !== "running" &&
      (!effectiveEndTime || effectiveEndTime.getTime() <= effectiveStartTime.getTime())
    ) {
      throw new Error("Invalid override range");
    }

    if (input.overrideStatus === "billed" && !effectiveEndTime) {
      throw new Error("Cannot mark billed without finalized amount");
    }

    if (effectiveRatePerMin <= 0) {
      throw new Error("Invalid override rate");
    }

    if (input.overridePayerMode !== undefined || input.overridePayerData !== undefined) {
      const effectivePayerMode = normalizePayerMode(
        input.overridePayerMode ??
          session.overridePayerMode ??
          session.payerMode,
      );
      const effectivePayerData =
        input.overridePayerData !== undefined
          ? input.overridePayerData
          : (session.overridePayerData ?? session.payerData);
      validateOverridePayer(effectivePayerMode, effectivePayerData);
    }

    if (input.overridePaymentModes !== undefined && input.overridePaymentModes !== null) {
      const valid = input.overridePaymentModes.every(
        (mode) => mode === "cash" || mode === "upi" || mode === "card" || mode === "due",
      );
      if (!valid) {
        throw new Error("Invalid payment mode override");
      }
    }

    const durationMinutes = calculateDurationMinutes(effectiveStartTime, effectiveEndTime);
    const calculatedAmount = calculateAmount(
      effectiveStartTime,
      effectiveEndTime,
      effectiveRatePerMin,
      table.name,
    );
    const nextOutcome = input.overrideOutcome ?? session.outcome ?? "NORMAL";
    if (nextOutcome === "LTP_LOSS" && isBilled({ billId: session.billId })) {
      throw new Error("Billed session cannot be marked as LTP loss");
    }
    if (input.overrideStatus === "billed" && nextOutcome !== "NORMAL") {
      throw new Error("LTP loss session cannot be billed");
    }
    const amount = nextOutcome === "LTP_LOSS" ? 0 : calculatedAmount;

    const shouldCancelOldBill = Boolean(
      currentLifecycleState === "Billed" &&
      requestedLifecycleState === "Completed" &&
      typeof session.billId === "number",
    );

    let nextBillId = session.billId;
    if (requestedLifecycleState === "Running") {
      // Returning a session to running means it should re-enter unbilled flow.
      nextBillId = null;
    }
    if (shouldCancelOldBill) {
      nextBillId = null;
    }

    if (effectiveStatus === "billed" && !isBilled({ billId: nextBillId })) {
      const createdBill = await (
        billModel as {
          create: (args: {
            data: {
              totalAmount: number;
              discountType: string | null;
              discountValue: number | null;
              discountedAmount: number;
            };
          }) => Promise<{ id: number }>;
        }
      ).create({
        data: {
          totalAmount: amount,
          discountType: null,
          discountValue: null,
          discountedAmount: amount,
        },
      });
      nextBillId = createdBill.id;
    }

    const beforeAuditSnapshot = buildOverrideAuditSnapshot({
      playerName: session.playerName,
      status: session.status,
      outcome: session.outcome ?? "NORMAL",
      cancellationReason: session.cancellationReason ?? null,
      billId: session.billId,
      amount: session.amount ?? 0,
      overrideStartTime: session.overrideStartTime ?? null,
      overrideEndTime: session.overrideEndTime ?? null,
      overrideRatePerMin: session.overrideRatePerMin ?? null,
      overridePayerMode: session.overridePayerMode ?? null,
      overridePayerData: session.overridePayerData ?? null,
      overrideStatus: session.overrideStatus ?? null,
      overridePaymentModes: session.overridePaymentModes,
    });
    const paymentHistorySnapshot = existingPayments.map((payment) => ({
      id: payment.id ?? null,
      billId: payment.billId ?? session.billId,
      amount: payment.amount,
      mode: payment.mode ?? null,
      dueCustomerName: payment.dueCustomerName ?? null,
      dueCustomerPhone: payment.dueCustomerPhone ?? null,
      dueSettledAt: payment.dueSettledAt ? payment.dueSettledAt.toISOString() : null,
      dueReceivedMode: payment.dueReceivedMode ?? null,
    }));

    if (currentLifecycleState === "Paid" && requestedLifecycleState === "Billed" && session.billId) {
      await (
        paymentModel as {
          deleteMany: (args: { where: { billId: number } }) => Promise<unknown>;
        }
      ).deleteMany({
        where: { billId: session.billId },
      });
    }

    const updatedSession = await (
      sessionModel as {
        update: (args: {
          where: { id: number };
          data: {
            overrideStartTime?: Date;
            playerName?: string;
            overrideEndTime?: Date | null;
            overrideRatePerMin?: number;
            overridePayerMode?: string;
            overridePayerData?: unknown;
            overrideStatus?: string | null;
            outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
            cancellationReason?: string | null;
            overridePaymentModes?: unknown;
            billId?: number | null;
            businessDayKey?: string;
            amount: number;
          };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id: session.id },
      data: {
        ...(input.overrideStartTime ? { overrideStartTime: input.overrideStartTime } : {}),
        ...(overridePlayerName !== undefined ? { playerName: overridePlayerName } : {}),
        ...(input.overrideEndTime ? { overrideEndTime: input.overrideEndTime } : {}),
        ...(typeof input.overrideRatePerMin === "number"
          ? { overrideRatePerMin: input.overrideRatePerMin }
          : {}),
        ...(input.overridePayerMode !== undefined
          ? { overridePayerMode: input.overridePayerMode }
          : {}),
        ...(input.overridePayerData !== undefined
          ? { overridePayerData: input.overridePayerData ?? null }
          : {}),
        ...(input.overrideStatus !== undefined
          ? { overrideStatus: input.overrideStatus === "default" ? null : input.overrideStatus }
          : {}),
        ...(input.overrideOutcome !== undefined ? { outcome: input.overrideOutcome } : {}),
        ...(input.overridePaymentModes !== undefined
          ? { overridePaymentModes: input.overridePaymentModes }
          : {}),
        ...(nextBillId !== session.billId ? { billId: nextBillId } : {}),
        ...(nextBusinessDayKey !== session.businessDayKey
          ? { businessDayKey: nextBusinessDayKey }
          : {}),
        ...(effectiveStatus === "running" ? { overrideEndTime: null } : {}),
        ...((input.overrideStatus !== undefined && input.overrideStatus !== "default")
          ? { status: toSessionStatus(nextLifecycleState) }
          : {}),
        amount,
      },
    });

    const updatedSessionRow = updatedSession as {
      playerName?: string;
      status: "running" | "completed" | "billed";
      outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
      cancellationReason?: string | null;
      billId: number | null;
      amount: number | null;
      overrideStartTime?: Date | null;
      overrideEndTime?: Date | null;
      overrideRatePerMin?: number | null;
      overridePayerMode?: string | null;
      overridePayerData?: unknown;
      overrideStatus?: string | null;
      overridePaymentModes?: unknown;
    };

    if (shouldCancelOldBill && session.billId) {
      await (
        sessionModel as {
          updateMany: (args: {
            where: { billId: number };
            data: { billId: null; status: "completed"; overrideStatus: null };
          }) => Promise<unknown>;
        }
      ).updateMany({
        where: { billId: session.billId },
        data: {
          billId: null,
          status: "completed",
          overrideStatus: null,
        },
      });

      await (
        paymentModel as {
          deleteMany: (args: { where: { billId: number } }) => Promise<unknown>;
        }
      ).deleteMany({
        where: { billId: session.billId },
      });

      await (
        billModel as {
          delete: (args: { where: { id: number } }) => Promise<unknown>;
        }
      ).delete({
        where: { id: session.billId },
      });
    }

    const afterAuditSnapshot = buildOverrideAuditSnapshot(updatedSessionRow);
    const beforeAuditData = {
      ...beforeAuditSnapshot,
      payments: paymentHistorySnapshot,
    };
    const afterAuditData = {
      ...afterAuditSnapshot,
      payments:
        currentLifecycleState === "Paid" && requestedLifecycleState === "Billed"
          ? []
          : paymentHistorySnapshot,
      changedBy: input.changedBy?.trim() || "Operator",
    };
    const diffEntries = buildAuditDiffEntries(beforeAuditData, afterAuditData);

    if (diffEntries.length > 0 && overrideEventModel) {
      await (
        overrideEventModel as {
          create: (args: {
            data: {
              sessionId: number;
              action: string;
              changedFields: unknown;
              beforeData: unknown;
              afterData: unknown;
            };
          }) => Promise<unknown>;
        }
      ).create({
        data: {
          sessionId: session.id,
          action: "override_update",
          changedFields: diffEntries,
          beforeData: beforeAuditData,
          afterData: afterAuditData,
        },
      });
    }

    return updatedSession;
  },

  async getSessionOverrideHistory(
    prisma: unknown,
    input: { sessionId: number },
  ) {
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const overrideEventModel = (prisma as {
      sessionOverrideEvent?: unknown;
      sessionOverrideEvents?: unknown;
    }).sessionOverrideEvent ??
      (prisma as {
        sessionOverrideEvent?: unknown;
        sessionOverrideEvents?: unknown;
      }).sessionOverrideEvents;

    const session = await (
      sessionModel as {
        findUnique: (args: {
          where: { id: number };
          select: {
            id: true;
            startTime: true;
            endTime: true;
            status: true;
            billId: true;
            amount: true;
            cancellationReason: true;
            canceledAt: true;
          };
        }) => Promise<{
          id: number;
          startTime?: Date;
          endTime?: Date | null;
          status?: "running" | "completed" | "billed";
          billId?: number | null;
          amount?: number | null;
          cancellationReason?: string | null;
          canceledAt?: Date | null;
        } | null>;
      }
    ).findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        billId: true,
        amount: true,
        cancellationReason: true,
        canceledAt: true,
      },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    const rows = overrideEventModel
      ? await (
        overrideEventModel as {
          findMany: (args: {
            where: { sessionId: number };
            orderBy: { createdAt: "desc" };
            select: {
              id: true;
              action: true;
              changedFields: true;
              beforeData: true;
              afterData: true;
              createdAt: true;
            };
          }) => Promise<
            Array<{
              id: number;
              action: string;
              changedFields: unknown;
              beforeData: unknown;
              afterData: unknown;
              createdAt: Date;
            }>
          >;
        }
      ).findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          changedFields: true,
          beforeData: true,
          afterData: true,
          createdAt: true,
        },
      })
      : [];

    const timeline = rows.map((row) => {
      const changedBy = (
        row.afterData &&
        typeof row.afterData === "object" &&
        typeof (row.afterData as { changedBy?: unknown }).changedBy === "string"
      )
        ? ((row.afterData as { changedBy: string }).changedBy || "System")
        : "System";

      const diffs: AuditDiffEntry[] = Array.isArray(row.changedFields)
        ? row.changedFields
          .map((entry) => {
            if (
              entry &&
              typeof entry === "object" &&
              typeof (entry as { field?: unknown }).field === "string"
            ) {
              return {
                field: (entry as { field: string }).field,
                before: (entry as { before?: unknown }).before,
                after: (entry as { after?: unknown }).after,
              } satisfies AuditDiffEntry;
            }
            if (typeof entry === "string") {
              return {
                field: entry,
                before:
                  row.beforeData && typeof row.beforeData === "object"
                    ? (row.beforeData as Record<string, unknown>)[entry]
                    : undefined,
                after:
                  row.afterData && typeof row.afterData === "object"
                    ? (row.afterData as Record<string, unknown>)[entry]
                    : undefined,
              } satisfies AuditDiffEntry;
            }
            return null;
          })
          .filter((entry): entry is AuditDiffEntry => entry !== null)
        : [];

      return {
        id: row.id,
        action: row.action,
        actionLabel: toHistoryActionLabel(row.action),
        changedBy,
        diffs,
        createdAt: row.createdAt,
      };
    });

    let syntheticId = -1;
    const synthetic: Array<{
      id: number;
      action: string;
      actionLabel: string;
      changedBy: string;
      diffs: AuditDiffEntry[];
      createdAt: Date;
    }> = [];

    if (session.startTime instanceof Date) {
      synthetic.push({
        id: syntheticId--,
        action: "session_started",
        actionLabel: toHistoryActionLabel("session_started"),
        changedBy: "System",
        diffs: [
          { field: "status", before: "free", after: "running" },
          { field: "startTime", before: null, after: session.startTime.toISOString() },
        ],
        createdAt: session.startTime,
      });
    }

    if (session.endTime instanceof Date) {
      synthetic.push({
        id: syntheticId--,
        action: "session_ended",
        actionLabel: toHistoryActionLabel("session_ended"),
        changedBy: "System",
        diffs: [
          { field: "status", before: "running", after: session.status ?? "completed" },
          { field: "endTime", before: null, after: session.endTime.toISOString() },
          { field: "amount", before: null, after: typeof session.amount === "number" ? session.amount : 0 },
        ],
        createdAt: session.endTime,
      });
    }

    if (session.canceledAt instanceof Date && session.cancellationReason) {
      synthetic.push({
        id: syntheticId--,
        action: "session_cancelled",
        actionLabel: toHistoryActionLabel("session_cancelled"),
        changedBy: "System",
        diffs: [
          { field: "cancellationReason", before: null, after: session.cancellationReason },
          { field: "canceledAt", before: null, after: session.canceledAt.toISOString() },
          { field: "amount", before: session.amount ?? 0, after: 0 },
        ],
        createdAt: session.canceledAt,
      });
    }

    if (typeof session.billId === "number") {
      const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
        (prisma as { bill?: unknown; bills?: unknown }).bills;
      const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
        (prisma as { payment?: unknown; payments?: unknown }).payments;

      const bill = await (
        billModel as {
          findUnique: (args: {
            where: { id: number };
            select: { id: true; createdAt: true; totalAmount: true; discountedAmount: true };
          }) => Promise<{
            id: number;
            createdAt: Date;
            totalAmount: number;
            discountedAmount: number;
          } | null>;
        }
      ).findUnique({
        where: { id: session.billId },
        select: { id: true, createdAt: true, totalAmount: true, discountedAmount: true },
      });

      if (bill) {
        synthetic.push({
          id: syntheticId--,
          action: "bill_created",
          actionLabel: toHistoryActionLabel("bill_created"),
          changedBy: "System",
          diffs: [
            { field: "status", before: "completed", after: "billed" },
            { field: "billId", before: null, after: bill.id },
            { field: "totalAmount", before: null, after: bill.totalAmount },
            {
              field: "discount",
              before: null,
              after: roundMoney(Math.max(bill.totalAmount - bill.discountedAmount, 0)),
            },
            { field: "discountedAmount", before: null, after: bill.discountedAmount },
          ],
          createdAt: bill.createdAt,
        });

        const billPayments = await (
          paymentModel as {
            findMany: (args: {
              where: { billId: number };
              orderBy: { id: "asc" };
              select: {
                id: true;
                amount: true;
                mode: true;
                dueCustomerName: true;
                dueCustomerPhone: true;
                dueSettledAt: true;
                dueReceivedMode: true;
              };
            }) => Promise<Array<{
              id: number;
              amount: number;
              mode: string;
              dueCustomerName: string | null;
              dueCustomerPhone: string | null;
              dueSettledAt: Date | null;
              dueReceivedMode: string | null;
            }>>;
          }
        ).findMany({
          where: { billId: session.billId },
          orderBy: { id: "asc" },
          select: {
            id: true,
            amount: true,
            mode: true,
            dueCustomerName: true,
            dueCustomerPhone: true,
            dueSettledAt: true,
            dueReceivedMode: true,
          },
        });

        for (const payment of billPayments) {
          synthetic.push({
            id: syntheticId--,
            action: payment.mode === "due" && payment.dueSettledAt ? "due_settled" : "payment_recorded",
            actionLabel: toHistoryActionLabel(
              payment.mode === "due" && payment.dueSettledAt ? "due_settled" : "payment_recorded",
            ),
            changedBy: "System",
            diffs: [
              {
                field: "payments",
                before: [],
                after: [{
                  id: payment.id,
                  amount: payment.amount,
                  mode: payment.mode,
                  dueCustomerName: payment.dueCustomerName,
                  dueCustomerPhone: payment.dueCustomerPhone,
                  dueSettledAt: payment.dueSettledAt
                    ? payment.dueSettledAt.toISOString()
                    : null,
                  dueReceivedMode: payment.dueReceivedMode,
                }],
              },
            ],
            createdAt: payment.dueSettledAt ?? bill.createdAt,
          });
        }
      }
    }

    return [...timeline, ...synthetic].sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return b.id - a.id;
    });
  },

  async getCompletedSessions(prisma: unknown) {
    await ensureLedgerResetHydrated(prisma);
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;

    const rows = (await (
      sessionModel as {
        findMany: (args: {
          where: {
            billId: null;
            status: { not: "running" };
            outcome: "NORMAL";
            cancellationReason: null;
          };
          orderBy: { endTime: "desc" };
          include: { table: { select: { name: true; ratePerMin: true } } };
        }) => Promise<
          Array<{
            id: number;
            playerName: string;
            status: "running" | "completed" | "billed";
            outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
            billId: number | null;
            startTime: Date;
            endTime: Date | null;
            amount: number | null;
            payerMode: "none" | "single" | "split";
            payerData: unknown;
            overrideStartTime?: Date | null;
            overrideEndTime?: Date | null;
            overrideRatePerMin?: number | null;
            overridePayerMode?: string | null;
            overridePayerData?: unknown;
            overrideStatus?: string | null;
            table: { name: string; ratePerMin: number };
          }>
        >;
      }
    ).findMany({
      where: {
        billId: null,
        status: { not: "running" },
        outcome: "NORMAL",
        cancellationReason: null,
      },
      orderBy: { endTime: "desc" },
      include: { table: { select: { name: true, ratePerMin: true } } },
    })) as Array<{
      id: number;
      playerName: string;
      status: "running" | "completed" | "billed";
      outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
      billId: number | null;
      startTime: Date;
      endTime: Date | null;
      amount: number | null;
      payerMode: "none" | "single" | "split";
      payerData: unknown;
      overrideStartTime?: Date | null;
      overrideEndTime?: Date | null;
      overrideRatePerMin?: number | null;
      overridePayerMode?: string | null;
      overridePayerData?: unknown;
      overrideStatus?: string | null;
      table: { name: string; ratePerMin: number };
    }>;

    return rows.map((row) => {
      const effectiveStatus = getEffectiveSessionStatus({
        status: row.status ?? "completed",
        overrideStatus: row.overrideStatus,
      });
      if (effectiveStatus !== "completed" || isBilled({ billId: row.billId })) {
        return null;
      }

      const effectiveStartTime = getEffectiveStartTime(row);
      const effectiveEndTime = getEffectiveEndTime(row);
      const effectiveRatePerMin = getEffectiveRatePerMin(row, row.table.ratePerMin);
      const durationMinutes = calculateDurationMinutes(effectiveStartTime, effectiveEndTime);
        const amount = calculateAmount(
          effectiveStartTime,
          effectiveEndTime,
          effectiveRatePerMin,
          row.table.name,
        );

        return {
          id: row.id,
        tableName: row.table.name,
        playerName: row.playerName,
        durationMinutes,
          amount: row.outcome === "LTP_LOSS" || row.outcome === "CANCELLED" ? 0 : amount,
          payerMode: getEffectivePayerMode(row),
          payerData: getEffectivePayerData(row),
        };
    }).filter((row): row is {
      id: number;
      tableName: string;
      playerName: string;
      durationMinutes: number;
      amount: number;
      payerMode: "none" | "single" | "split";
      payerData: unknown;
    } => row !== null);
  },

  async getAllSessions(
    prisma: unknown,
    input?: {
      scope?: "current" | "day" | "range";
      now?: Date;
      date?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    await ensureLedgerResetHydrated(prisma);
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
      (prisma as { bill?: unknown; bills?: unknown }).bills;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    const dailyReportModel = (prisma as { dailyReport?: unknown; dailyReports?: unknown }).dailyReport ??
      (prisma as { dailyReport?: unknown; dailyReports?: unknown }).dailyReports;

    const rows = (await (
      sessionModel as {
        findMany: (args: {
          orderBy: { startTime: "desc" };
          include: {
            table: { select: { name: true; ratePerMin: true } };
          };
        }) => Promise<
          Array<{
            id: number;
            playerName: string;
            startTime: Date;
            endTime: Date | null;
            businessDayKey?: string | null;
            status: "running" | "completed" | "billed";
            outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
            billId: number | null;
            amount: number | null;
            cancellationReason?: string | null;
            canceledAt?: Date | null;
            payerMode: "none" | "single" | "split";
            payerData: unknown;
            overrideStartTime?: Date | null;
            overrideEndTime?: Date | null;
            overrideRatePerMin?: number | null;
            overridePayerMode?: string | null;
            overridePayerData?: unknown;
            overrideStatus?: string | null;
            overridePaymentModes?: unknown;
            table: { name: string; ratePerMin: number };
          }>
        >;
      }
    ).findMany({
      orderBy: { startTime: "desc" },
      include: {
        table: { select: { name: true, ratePerMin: true } },
      },
    })) as Array<{
      id: number;
      playerName: string;
      startTime: Date;
      endTime: Date | null;
      businessDayKey?: string | null;
      status: "running" | "completed" | "billed";
      outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED";
      billId: number | null;
      amount: number | null;
      cancellationReason?: string | null;
      canceledAt?: Date | null;
      payerMode: "none" | "single" | "split";
      payerData: unknown;
      overrideStartTime?: Date | null;
      overrideEndTime?: Date | null;
      overrideRatePerMin?: number | null;
      overridePayerMode?: string | null;
      overridePayerData?: unknown;
      overrideStatus?: string | null;
      overridePaymentModes?: unknown;
      table: { name: string; ratePerMin: number };
    }>;

    const billIds = Array.from(
      new Set(
        rows
          .map((row) => row.billId)
          .filter((billId): billId is number => typeof billId === "number"),
      ),
    );

    const allBillPayments = billIds.length > 0
      ? await (
        paymentModel as {
          findMany: (args: {
            where: { billId: { in: number[] } };
          }) => Promise<Array<{
            billId: number;
            amount: number;
            mode: "cash" | "upi" | "card" | "due";
            createdAt?: Date;
            dueSettledAt?: Date | null;
            dueReceivedMode?: "cash" | "upi" | "card" | "due" | null;
          }>>;
        }
      ).findMany({
        where: { billId: { in: billIds } },
      })
      : [];

    const bills = billIds.length > 0
      ? await (
        billModel as {
          findMany: (args: {
            where: { id: { in: number[] } };
            select: { id: true; totalAmount: true; discountedAmount: true; discountType: true };
          }) => Promise<
            Array<{
              id: number;
              totalAmount: number;
              discountedAmount: number;
              discountType: string | null;
            }>
          >;
        }
      ).findMany({
        where: { id: { in: billIds } },
        select: { id: true, totalAmount: true, discountedAmount: true, discountType: true },
      })
      : [];

    const billById = new Map<number, {
      totalAmount: number;
      discountedAmount: number;
      discountType: string | null;
    }>();
    for (const bill of bills) {
      billById.set(bill.id, {
        totalAmount: bill.totalAmount,
        discountedAmount: bill.discountedAmount,
        discountType: bill.discountType,
      });
    }

    const paymentsByBillId = new Map<number, Array<{
      amount: number;
      mode: "cash" | "upi" | "card" | "due";
      createdAt: Date;
      dueSettledAt?: Date | null;
      dueReceivedMode?: "cash" | "upi" | "card" | "due" | null;
    }>>();
    for (const payment of allBillPayments) {
      const existing = paymentsByBillId.get(payment.billId) ?? [];
      existing.push({
        amount: payment.amount,
        mode: payment.mode,
        createdAt: payment.createdAt instanceof Date ? payment.createdAt : new Date(0),
        dueSettledAt: payment.dueSettledAt ?? null,
        dueReceivedMode: payment.dueReceivedMode ?? null,
      });
      paymentsByBillId.set(payment.billId, existing);
    }

    const calculatedRows = rows.map((row) => {
      const effectiveStartTime = getEffectiveStartTime(row);
      const effectiveEndTime = getEffectiveEndTime(row);
      const effectiveRatePerMin = getEffectiveRatePerMin(row, row.table.ratePerMin);
      const durationMinutes = calculateDurationMinutes(effectiveStartTime, effectiveEndTime);
      const calculatedAmount = calculateAmount(
        effectiveStartTime,
        effectiveEndTime,
        effectiveRatePerMin,
        row.table.name,
      );
      const outcome = normalizeSessionOutcome(row.outcome);
      const isNonChargeOutcome = outcome === "LTP_LOSS" || outcome === "CANCELLED";
      const amount = isNonChargeOutcome ? 0 : calculatedAmount;

      return {
        ...row,
        outcome,
        effectiveStartTime,
        effectiveEndTime,
        effectiveRatePerMin,
        durationMinutes,
        amount,
        ltpValue: outcome === "LTP_LOSS" ? calculatedAmount : 0,
      };
    });

    const collectedBySessionId = new Map<number, number>();
    const discountBySessionId = new Map<number, number>();
    const finalAmountBySessionId = new Map<number, number>();

    for (const billId of billIds) {
      const sessionsInBill = calculatedRows
        .filter((row) => row.billId === billId)
        .sort((a, b) => {
          const byStart = a.effectiveStartTime.getTime() - b.effectiveStartTime.getTime();
          if (byStart !== 0) {
            return byStart;
          }
          return a.id - b.id;
        });

      const billMeta = billById.get(billId);
      const sessionsAmount = sessionsInBill.reduce((sum, session) => sum + session.amount, 0);
      const billTotals = billMeta
        ? getEffectiveBillTotals({
          totalAmount: billMeta.totalAmount,
          discountType: billMeta.discountType,
          discountedAmount: billMeta.discountedAmount,
          sessionsAmount,
        })
        : getEffectiveBillTotals({
          totalAmount: sessionsAmount,
          discountType: null,
          discountedAmount: sessionsAmount,
          sessionsAmount,
        });

      const perSessionFinal = distributeProportionally(
        billTotals.finalAmount,
        sessionsInBill.map((session) => ({ id: session.id, weight: session.amount })),
      );
      for (const session of sessionsInBill) {
        const allocatedFinal = roundMoney(perSessionFinal.get(session.id) ?? 0);
        const finalAmount = roundMoney(Math.max(Math.min(allocatedFinal, session.amount), 0));
        const discountShare = roundMoney(Math.max(session.amount - finalAmount, 0));
        discountBySessionId.set(session.id, discountShare);
        finalAmountBySessionId.set(session.id, finalAmount);
      }

      const totalPaid = roundMoney((paymentsByBillId.get(billId) ?? []).reduce(
        (sum, payment) => sum + payment.amount,
        0,
      ));
      const perSessionCollected = distributeProportionally(
        totalPaid,
        sessionsInBill.map((session) => ({
          id: session.id,
          weight: finalAmountBySessionId.get(session.id) ?? session.amount,
        })),
      );

      for (const session of sessionsInBill) {
        const finalAmount = finalAmountBySessionId.get(session.id) ?? session.amount;
        const collectedShare = roundMoney(
          Math.min(perSessionCollected.get(session.id) ?? 0, finalAmount),
        );
        collectedBySessionId.set(session.id, collectedShare);
      }
    }

    const sortedRows = calculatedRows
      .map((row) => {
        const outcome = normalizeSessionOutcome(row.outcome);
        const isNonChargeOutcome = outcome === "LTP_LOSS" || outcome === "CANCELLED";
        const billed = isBilled({ billId: row.billId });
        const billPayments = billed ? paymentsByBillId.get(row.billId as number) ?? [] : [];
        const paymentSplit = isNonChargeOutcome ? [] : derivePaymentSplit(billPayments);
        const defaultPaymentModes = paymentSplit.map((entry) => entry.mode);
        const overridePaymentModes = normalizeOverridePaymentModes(row.overridePaymentModes);
        const paymentModes = overridePaymentModes ?? defaultPaymentModes;
        const sessionDiscount = isNonChargeOutcome
          ? 0
          : billed
            ? discountBySessionId.get(row.id) ?? 0
            : 0;
        const finalAmount = isNonChargeOutcome
          ? 0
          : billed
          ? finalAmountBySessionId.get(row.id) ?? row.amount
          : row.amount;
        const collectedAmount = isNonChargeOutcome ? 0 : billed ? collectedBySessionId.get(row.id) ?? 0 : 0;
        const paidAmount = roundMoney(Math.min(collectedAmount + sessionDiscount, row.amount));
        const effectivePaid = roundMoney(Math.max(paidAmount - sessionDiscount, 0));
        const remainingAmount = roundMoney(Math.max(finalAmount - effectivePaid, 0));
        const effectiveStatus = getEffectiveSessionStatus({
          status: row.status,
          overrideStatus: row.overrideStatus,
        });
        const state = deriveLedgerState({
          status: effectiveStatus,
          billId: row.billId,
          paidAmount: effectivePaid,
          amount: finalAmount,
          outcome,
          cancellationReason: row.cancellationReason ?? null,
        });

        return {
          id: row.id,
          billId: row.billId,
          businessDayKey: row.businessDayKey ?? toBusinessDayKeyFromDate(row.effectiveStartTime),
          originalStatus: row.status,
          tableName: row.table.name,
          playerName: row.playerName,
          originalStartTime: row.startTime,
          startTime: row.effectiveStartTime,
          originalEndTime: row.endTime,
          endTime: row.effectiveEndTime,
          durationMinutes: row.durationMinutes,
          originalRatePerMin: row.table.ratePerMin,
          ratePerMin: row.effectiveRatePerMin,
          amount: row.amount,
          outcome,
          ltpValue: row.ltpValue ?? 0,
          sessionDiscount,
          finalAmount,
          effectivePaid,
          paidAmount,
          remainingAmount,
          paymentModes,
          paymentSplit,
          state,
          cancellationReason: row.cancellationReason ?? null,
          canceledAt: row.canceledAt ?? null,
          originalPayerMode: row.payerMode,
          originalPayerData: row.payerData,
          payerMode: getEffectivePayerMode(row),
          payerData: getEffectivePayerData(row),
          overrideStartTime: row.overrideStartTime ?? null,
          overrideEndTime: row.overrideEndTime ?? null,
          overrideRatePerMin: row.overrideRatePerMin ?? null,
          overridePayerMode: row.overridePayerMode ?? null,
          overridePayerData: row.overridePayerData ?? null,
          overrideStatus: row.overrideStatus ?? null,
          overridePaymentModes,
        };
      })
      .sort((a, b) => {
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

    const now = input?.now ?? new Date();
    const scope = input?.scope ?? "current";
    const currentBusinessDay = getBusinessDayRangeWithReset(now, getLedgerResetMinutesCached());
    const currentBusinessDayKey = currentBusinessDay.key;
    const selectedDayKey = scope === "day" && input?.date
      ? normalizeDayKeyInput(input.date)
      : currentBusinessDayKey;
    const selectedRange = scope === "range"
      ? normalizeRangeInput(input?.startDate, input?.endDate)
      : null;

    const nowMs = now.getTime();
    const scopedRows = sortedRows.filter((row) => {
      const rowKey = row.businessDayKey ?? toBusinessDayKeyFromDate(new Date(row.startTime));
      if (scope === "day") {
        return rowKey === selectedDayKey;
      }
      if (scope === "range" && selectedRange) {
        return rowKey >= selectedRange.startDate && rowKey <= selectedRange.endDate;
      }
      if (rowKey !== currentBusinessDayKey) {
        return false;
      }
      const effectiveStart = new Date(row.startTime).getTime();
      return effectiveStart <= nowMs;
    });
    const currentWindow = toBusinessDayWindowFromKey(currentBusinessDayKey);
    const selectedWindow = toBusinessDayWindowFromKey(selectedDayKey);
    const rangeStartWindow = selectedRange
      ? toBusinessDayWindowFromKey(selectedRange.startDate)
      : null;
    const rangeEndWindow = selectedRange
      ? toBusinessDayWindowFromKey(selectedRange.endDate)
      : null;

    const reportStart = scope === "day"
      ? selectedWindow.start
      : scope === "range" && rangeStartWindow
        ? rangeStartWindow.start
        : currentWindow.start;
    const reportEnd = scope === "day"
      ? selectedWindow.end
      : scope === "range" && rangeEndWindow
        ? rangeEndWindow.end
        : now;

    const allPayments = await (
      paymentModel as {
      findMany: (args: {
        select: {
          amount: true;
          mode: true;
          createdAt: true;
          dueSettledAt: true;
          dueReceivedMode: true;
          bill: {
            select: {
              createdAt: true;
            };
          };
        };
      }) => Promise<Array<{
        amount: number;
        mode: "cash" | "upi" | "card" | "due";
        createdAt?: Date;
        dueSettledAt?: Date | null;
        dueReceivedMode?: "cash" | "upi" | "card" | "due" | null;
        bill?: { createdAt?: Date } | null;
      }>>;
    }
  ).findMany({
    select: {
      amount: true,
      mode: true,
      createdAt: true,
      dueSettledAt: true,
      dueReceivedMode: true,
      bill: {
        select: {
          createdAt: true,
        },
      },
    },
  });
    const paymentTotals = {
      cash: 0,
      upi: 0,
      card: 0,
      due: 0,
      dueReceivedCash: 0,
      dueReceivedUpi: 0,
      dueReceivedCard: 0,
      oldDueReceivedCash: 0,
      oldDueReceivedUpi: 0,
      oldDueReceivedCard: 0,
    };
    for (const payment of allPayments) {
      if (payment.mode === "due") {
        if (payment.dueSettledAt) {
          if (
            payment.dueSettledAt.getTime() >= reportStart.getTime() &&
            payment.dueSettledAt.getTime() < reportEnd.getTime()
          ) {
            if (payment.dueReceivedMode === "cash") {
              // settled-due principal lives in the receive entry (mode cash/upi/card)
              // so we do not add this zeroed due row to collections.
            } else if (payment.dueReceivedMode === "upi") {
            } else if (payment.dueReceivedMode === "card") {
            }
          }
        } else if (
          payment.createdAt instanceof Date &&
          payment.createdAt.getTime() >= reportStart.getTime() &&
          payment.createdAt.getTime() < reportEnd.getTime()
        ) {
          paymentTotals.due += payment.amount;
        }
      } else if (
        payment.dueSettledAt instanceof Date &&
        payment.dueReceivedMode === payment.mode &&
        payment.dueSettledAt.getTime() >= reportStart.getTime() &&
        payment.dueSettledAt.getTime() < reportEnd.getTime()
      ) {
        const isOldDueRecovery =
          payment.bill?.createdAt instanceof Date &&
          payment.bill.createdAt.getTime() < reportStart.getTime();
        if (payment.mode === "cash") {
          paymentTotals.cash += payment.amount;
          paymentTotals.dueReceivedCash += payment.amount;
          if (isOldDueRecovery) {
            paymentTotals.oldDueReceivedCash += payment.amount;
          }
        } else if (payment.mode === "upi") {
          paymentTotals.upi += payment.amount;
          paymentTotals.dueReceivedUpi += payment.amount;
          if (isOldDueRecovery) {
            paymentTotals.oldDueReceivedUpi += payment.amount;
          }
        } else if (payment.mode === "card") {
          paymentTotals.card += payment.amount;
          paymentTotals.dueReceivedCard += payment.amount;
          if (isOldDueRecovery) {
            paymentTotals.oldDueReceivedCard += payment.amount;
          }
        }
      } else if (
        payment.createdAt instanceof Date &&
        payment.createdAt.getTime() >= reportStart.getTime() &&
        payment.createdAt.getTime() < reportEnd.getTime()
      ) {
        if (payment.mode === "cash") {
          paymentTotals.cash += payment.amount;
        } else if (payment.mode === "upi") {
          paymentTotals.upi += payment.amount;
        } else if (payment.mode === "card") {
          paymentTotals.card += payment.amount;
        }
      }
    }

    const activeRows = scopedRows.filter((row) => row.state !== "Cancelled" && row.state !== "LTP-Loss");
    const ltpRows = scopedRows.filter((row) => row.outcome === "LTP_LOSS");
    const cancelledRows = scopedRows.filter((row) => row.outcome === "CANCELLED");
    const subtotal = roundMoney(activeRows.reduce((sum, row) => sum + row.amount, 0));
    const discount = roundMoney(activeRows.reduce((sum, row) => sum + row.sessionDiscount, 0));
    const net = roundMoney(subtotal - discount);
    const dueReceived = roundMoney(
      paymentTotals.oldDueReceivedCash + paymentTotals.oldDueReceivedUpi + paymentTotals.oldDueReceivedCard,
    );
    const openingDueOutstandingCurrent = roundMoney(
      allPayments
        .filter(
          (payment) =>
            payment.mode === "due" &&
            !payment.dueSettledAt &&
            payment.amount > 0 &&
            payment.createdAt instanceof Date &&
            payment.createdAt.getTime() < reportStart.getTime(),
        )
        .reduce((sum, payment) => sum + payment.amount, 0),
    );
    const openingDueOutstanding = roundMoney(openingDueOutstandingCurrent + dueReceived);
    const dueOutstanding = roundMoney(
      allPayments
        .filter(
          (payment) =>
            payment.mode === "due" &&
            !payment.dueSettledAt &&
            payment.amount > 0 &&
            payment.createdAt instanceof Date &&
            payment.createdAt.getTime() < reportEnd.getTime(),
        )
        .reduce((sum, payment) => sum + payment.amount, 0),
    );
    const netReceivableChange = roundMoney(dueOutstanding - openingDueOutstanding);
    const collectionTotal = roundMoney(paymentTotals.cash + paymentTotals.upi + paymentTotals.card);
    const paid = roundMoney(activeRows.reduce((sum, row) => sum + row.effectivePaid, 0));
    const unpaid = roundMoney(activeRows.reduce((sum, row) => sum + row.remainingAmount, 0));
    const total = roundMoney(net);
    const isBalanced = Math.abs(total - roundMoney(paid + unpaid)) < 0.01;

    const summary = {
      subtotal,
      discount,
      net,
      cash: roundMoney(paymentTotals.cash),
      upi: roundMoney(paymentTotals.upi),
      card: roundMoney(paymentTotals.card),
      due: roundMoney(paymentTotals.due),
      dueReceived,
      dueReceivedCash: roundMoney(paymentTotals.dueReceivedCash),
      dueReceivedUpi: roundMoney(paymentTotals.dueReceivedUpi),
      dueReceivedCard: roundMoney(paymentTotals.dueReceivedCard),
      openingDueOutstanding,
      dueOutstanding,
      netReceivableChange,
      collectionTotal,
      unpaid,
      total,
      paid,
      isBalanced,
      ltpCount: ltpRows.length,
      ltpValue: roundMoney(ltpRows.reduce((sum, row) => sum + (row.ltpValue ?? 0), 0)),
      cancelledCount: cancelledRows.length,
    };

    const snapshotKey = scope === "day" ? selectedDayKey : currentBusinessDayKey;
    if (dailyReportModel && reportEnd.getTime() <= now.getTime()) {
      await (
        dailyReportModel as {
          upsert: (args: {
            where: { businessDayKey: string };
            create: {
              businessDayKey: string;
              startAt: Date;
              endAt: Date;
              subtotal: number;
              discount: number;
              net: number;
              cash: number;
              upi: number;
              card: number;
              paid: number;
              unpaid: number;
              isBalanced: boolean;
            };
            update: {
              subtotal: number;
              discount: number;
              net: number;
              cash: number;
              upi: number;
              card: number;
              paid: number;
              unpaid: number;
              isBalanced: boolean;
            };
          }) => Promise<unknown>;
        }
      ).upsert({
        where: { businessDayKey: snapshotKey },
        create: {
          businessDayKey: snapshotKey,
          startAt: reportStart,
          endAt: reportEnd,
          subtotal: summary.subtotal,
          discount: summary.discount,
          net: summary.net,
          cash: summary.cash,
          upi: summary.upi,
          card: summary.card,
          paid: summary.paid,
          unpaid: summary.unpaid,
          isBalanced: summary.isBalanced,
        },
        update: {
          subtotal: summary.subtotal,
          discount: summary.discount,
          net: summary.net,
          cash: summary.cash,
          upi: summary.upi,
          card: summary.card,
          paid: summary.paid,
          unpaid: summary.unpaid,
          isBalanced: summary.isBalanced,
        },
      });
    }

    return {
      rows: scopedRows,
      summary,
      window: {
        scope,
        key: scope === "day"
          ? selectedDayKey
          : scope === "range" && selectedRange
            ? `${selectedRange.startDate}..${selectedRange.endDate}`
            : currentBusinessDayKey,
        start: scope === "day"
          ? selectedWindow.start
          : scope === "range" && rangeStartWindow
            ? rangeStartWindow.start
            : currentWindow.start,
        end: scope === "day"
          ? selectedWindow.end
          : scope === "range" && rangeEndWindow
            ? rangeEndWindow.end
            : now,
      },
    };
  },
};
