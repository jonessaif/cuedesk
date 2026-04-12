import { getEffectiveBillTotals, roundMoney } from "@/lib/billTotals";
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
}): "Running" | "Completed" | "Billed-Unpaid" | "Partially-Paid" | "Paid" {
  return getLedgerStatus({
    effectiveStatus: input.status,
    billId: input.billId,
    paidAmount: input.paidAmount,
    amount: input.amount,
  });
}

export const sessionService = {
  async startSession(
    prisma: unknown,
    input: { tableId: number; playerName: string },
  ) {
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

    return (
      sessionModel as {
        create: (args: {
          data: {
            tableId: number;
            playerName: string;
            status: string;
            startTime: Date;
          };
        }) => Promise<unknown>;
      }
    ).create({
      data: {
        tableId: input.tableId,
        playerName: input.playerName,
        status: "running",
        startTime: new Date(),
      },
    });
  },

  async endSession(
    prisma: unknown,
    input: { tableId: number; now: Date },
  ) {
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
            overrideStatus: null;
          };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id: session.id },
      data: {
        status: "completed",
        endTime: input.now,
        amount,
        overrideStatus: null,
      },
    });
  },

  async overrideSession(
    prisma: unknown,
    input: {
      sessionId: number;
      overrideStartTime?: Date;
      overrideEndTime?: Date;
      overrideRatePerMin?: number;
      overridePayerMode?: "none" | "single" | "split";
      overridePayerData?: unknown;
      overrideStatus?: "running" | "completed" | "billed" | "default";
      overridePaymentModes?: Array<"cash" | "upi" | "card" | "due"> | null;
      adminOverride?: boolean;
    },
  ) {
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const tableModel = (prisma as { table?: unknown; tables?: unknown }).table ??
      (prisma as { table?: unknown; tables?: unknown }).tables;
    const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
      (prisma as { bill?: unknown; bills?: unknown }).bills;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;

    const session = (await (
      sessionModel as {
        findUnique: (args: { where: { id: number } }) => Promise<unknown>;
      }
    ).findUnique({
      where: { id: input.sessionId },
    })) as {
      id: number;
      tableId: number;
      status: "running" | "completed" | "billed";
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
    } | null;

    if (!session) {
      throw new Error("Session not found");
    }

    const table = (await (
      tableModel as { findUnique: (args: { where: { id: number } }) => Promise<unknown> }
    ).findUnique({
      where: { id: session.tableId },
    })) as { ratePerMin: number; name: string } | null;

    if (!table) {
      throw new Error("Table not found");
    }

    const existingPayments = session.billId
      ? await (
        paymentModel as {
          findMany: (args: { where: { billId: number } }) => Promise<Array<{ amount: number }>>;
        }
      ).findMany({
        where: { billId: session.billId },
      })
      : [];
    const existingPaidAmount = existingPayments.reduce((sum, payment) => sum + payment.amount, 0);

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
      });
    if (!canTransition(currentLifecycleState, nextLifecycleState)) {
      throw new Error("Invalid state transition");
    }

    if (requestedLifecycleState === "Completed" && isBilled({ billId: session.billId }) && existingPaidAmount > 0) {
      throw new Error("Cannot move billed session to completed when payments exist");
    }
    if (
      currentLifecycleState === "Paid" &&
      nextLifecycleState === "Billed" &&
      !input.adminOverride
    ) {
      throw new Error("Invalid state transition");
    }

    const effectiveStartTime =
      input.overrideStartTime ??
      session.overrideStartTime ??
      session.startTime;
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
    const amount = calculateAmount(
      effectiveStartTime,
      effectiveEndTime,
      effectiveRatePerMin,
      table.name,
    );

    let nextBillId = session.billId;
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

    return (
      sessionModel as {
        update: (args: {
          where: { id: number };
          data: {
            overrideStartTime?: Date;
            overrideEndTime?: Date | null;
            overrideRatePerMin?: number;
            overridePayerMode?: string;
            overridePayerData?: unknown;
            overrideStatus?: string | null;
            overridePaymentModes?: unknown;
            billId?: number | null;
            amount: number;
          };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id: session.id },
      data: {
        ...(input.overrideStartTime ? { overrideStartTime: input.overrideStartTime } : {}),
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
        ...(input.overridePaymentModes !== undefined
          ? { overridePaymentModes: input.overridePaymentModes }
          : {}),
        ...(nextBillId !== session.billId ? { billId: nextBillId } : {}),
        ...(effectiveStatus === "running" ? { overrideEndTime: null } : {}),
        ...((input.overrideStatus !== undefined && input.overrideStatus !== "default")
          ? { status: toSessionStatus(nextLifecycleState) }
          : {}),
        amount,
      },
    });
  },

  async getCompletedSessions(prisma: unknown) {
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;

    const rows = (await (
      sessionModel as {
        findMany: (args: {
          where: {
            billId: null;
            status: { not: "running" };
          };
          orderBy: { endTime: "desc" };
          include: { table: { select: { name: true; ratePerMin: true } } };
        }) => Promise<
          Array<{
            id: number;
            playerName: string;
            status: "running" | "completed" | "billed";
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
      },
      orderBy: { endTime: "desc" },
      include: { table: { select: { name: true, ratePerMin: true } } },
    })) as Array<{
      id: number;
      playerName: string;
      status: "running" | "completed" | "billed";
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
        amount,
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

  async getAllSessions(prisma: unknown) {
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
      (prisma as { bill?: unknown; bills?: unknown }).bills;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;

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
            status: "running" | "completed" | "billed";
            billId: number | null;
            amount: number | null;
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
      status: "running" | "completed" | "billed";
      billId: number | null;
      amount: number | null;
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
          }) => Promise<Array<{ billId: number; amount: number; mode: "cash" | "upi" | "card" | "due" }>>;
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

    const paymentsByBillId = new Map<number, Array<{ amount: number; mode: "cash" | "upi" | "card" | "due" }>>();
    for (const payment of allBillPayments) {
      const existing = paymentsByBillId.get(payment.billId) ?? [];
      existing.push({ amount: payment.amount, mode: payment.mode });
      paymentsByBillId.set(payment.billId, existing);
    }

    const calculatedRows = rows.map((row) => {
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
        ...row,
        effectiveStartTime,
        effectiveEndTime,
        effectiveRatePerMin,
        durationMinutes,
        amount,
      };
    });

    const allocatedBySessionId = new Map<number, number>();
    const billAmountBySessionId = new Map<number, number>();

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
      const billTargetAmount = billMeta
        ? getEffectiveBillTotals({
          totalAmount: billMeta.totalAmount,
          discountType: billMeta.discountType,
          discountedAmount: billMeta.discountedAmount,
          sessionsAmount,
        }).discountedAmount
        : sessionsAmount;
      let remainingBillAmount = billTargetAmount;

      for (const session of sessionsInBill) {
        if (remainingBillAmount <= 0) {
          billAmountBySessionId.set(session.id, 0);
          continue;
        }
        const sessionBillAmount = Math.min(session.amount, remainingBillAmount);
        billAmountBySessionId.set(session.id, sessionBillAmount);
        remainingBillAmount -= sessionBillAmount;
      }

      const totalPaid = (paymentsByBillId.get(billId) ?? []).reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );

      let remaining = totalPaid;
      for (const session of sessionsInBill) {
        const sessionBillAmount = billAmountBySessionId.get(session.id) ?? session.amount;
        if (remaining <= 0) {
          allocatedBySessionId.set(session.id, 0);
        } else if (remaining >= sessionBillAmount) {
          allocatedBySessionId.set(session.id, sessionBillAmount);
          remaining -= sessionBillAmount;
        } else {
          allocatedBySessionId.set(session.id, remaining);
          remaining = 0;
        }
      }
    }

    return calculatedRows
      .map((row) => {
        const billed = isBilled({ billId: row.billId });
        const billPayments = billed ? paymentsByBillId.get(row.billId as number) ?? [] : [];
        const defaultPaymentModes = Array.from(new Set(billPayments.map((payment) => payment.mode)));
        const overridePaymentModes = normalizeOverridePaymentModes(row.overridePaymentModes);
        const paymentModes = overridePaymentModes ?? defaultPaymentModes;
        const billAdjustedAmount = billed
          ? billAmountBySessionId.get(row.id) ?? row.amount
          : row.amount;
        const paidAmount = allocatedBySessionId.get(row.id) ?? 0;
        const remainingAmount = Math.max(billAdjustedAmount - paidAmount, 0);
        const effectiveStatus = getEffectiveSessionStatus({
          status: row.status,
          overrideStatus: row.overrideStatus,
        });
        const state = deriveLedgerState({
          status: effectiveStatus,
          billId: row.billId,
          paidAmount,
          amount: billAdjustedAmount,
        });

        return {
          id: row.id,
          billId: row.billId,
          tableName: row.table.name,
          playerName: row.playerName,
          startTime: row.effectiveStartTime,
          endTime: row.effectiveEndTime,
          durationMinutes: row.durationMinutes,
          ratePerMin: row.effectiveRatePerMin,
          amount: row.amount,
          paidAmount,
          remainingAmount,
          paymentModes,
          state,
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
  },
};
