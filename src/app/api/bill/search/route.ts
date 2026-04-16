import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getCollectedPaidAmount, getEffectiveBillTotals } from "@/lib/billTotals";

type PaymentMode = "cash" | "upi" | "card" | "due";
const PAYMENT_MODE_ORDER: PaymentMode[] = ["cash", "upi", "card", "due"];

function parseDateStart(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTime(value: string): { hours: number; minutes: number } | null {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

function normalizePayerMode(value: unknown): "none" | "single" | "split" {
  if (value === "single" || value === "split" || value === "none") {
    return value;
  }
  return "none";
}

function getPayerNamesForSession(session: {
  playerName: string;
  payerMode: "none" | "single" | "split";
  payerData: unknown;
  overridePayerMode: string | null;
  overridePayerData: unknown;
}): string[] {
  const mode = normalizePayerMode(session.overridePayerMode ?? session.payerMode);
  const data = session.overridePayerData ?? session.payerData;
  if (mode === "single") {
    const name = (data as { name?: unknown } | null | undefined)?.name;
    if (typeof name === "string" && name.trim()) {
      return [name.trim()];
    }
  }
  if (mode === "split") {
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((row) => (row as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim());
  }
  return session.playerName?.trim() ? [session.playerName.trim()] : [];
}

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const { searchParams } = new URL(request.url);
    const billIdRaw = searchParams.get("billId");
    const payerRaw = (searchParams.get("payer") ?? "").trim().toLowerCase();
    const paymentModeRaw = (searchParams.get("paymentMode") ?? "all").toLowerCase();
    const startDateRaw = searchParams.get("startDate");
    const endDateRaw = searchParams.get("endDate");
    const startTimeRaw = searchParams.get("startTime");
    const endTimeRaw = searchParams.get("endTime");

    const parsedBillId = billIdRaw ? Number(billIdRaw) : null;
    if (billIdRaw && (parsedBillId === null || !Number.isFinite(parsedBillId) || parsedBillId <= 0)) {
      return Response.json({ error: "Invalid billId" }, { status: 400 });
    }

    const paymentMode = paymentModeRaw === "cash" ||
        paymentModeRaw === "upi" ||
        paymentModeRaw === "card" ||
        paymentModeRaw === "due"
      ? (paymentModeRaw as PaymentMode)
      : "all";

    const where: {
      id?: number;
      createdAt?: { gte?: Date; lte?: Date };
    } = {};

    if (parsedBillId) {
      where.id = parsedBillId;
    }

    if (startDateRaw || endDateRaw) {
      const gte = startDateRaw ? parseDateStart(startDateRaw) : null;
      const lte = endDateRaw ? parseDateEnd(endDateRaw) : null;
      if (startDateRaw && !gte) {
        return Response.json({ error: "Invalid startDate" }, { status: 400 });
      }
      if (endDateRaw && !lte) {
        return Response.json({ error: "Invalid endDate" }, { status: 400 });
      }
      if (gte || lte) {
        const parsedStartTime = startTimeRaw ? parseTime(startTimeRaw) : null;
        const parsedEndTime = endTimeRaw ? parseTime(endTimeRaw) : null;
        if (startTimeRaw && !parsedStartTime) {
          return Response.json({ error: "Invalid startTime" }, { status: 400 });
        }
        if (endTimeRaw && !parsedEndTime) {
          return Response.json({ error: "Invalid endTime" }, { status: 400 });
        }
        if (gte && parsedStartTime) {
          gte.setHours(parsedStartTime.hours, parsedStartTime.minutes, 0, 0);
        }
        if (lte && parsedEndTime) {
          lte.setHours(parsedEndTime.hours, parsedEndTime.minutes, 59, 999);
        }
        where.createdAt = {
          ...(gte ? { gte } : {}),
          ...(lte ? { lte } : {}),
        };
      }
    }

    const bills = await prisma.bill.findMany({
      where,
      orderBy: { id: "desc" },
      include: {
        sessions: {
          select: {
            playerName: true,
            payerMode: true,
            payerData: true,
            overridePayerMode: true,
            overridePayerData: true,
          },
        },
        payments: {
          select: {
            mode: true,
            amount: true,
            dueSettledAt: true,
          },
        },
      },
      take: 300,
    });

    const rows = bills
      .map((bill) => {
        const paidAmount = getCollectedPaidAmount(
          bill.payments.map((payment) => ({
            amount: payment.amount,
            mode: payment.mode,
            dueSettledAt: payment.dueSettledAt,
          })),
        );

        const totals = getEffectiveBillTotals({
          totalAmount: bill.totalAmount,
          discountType: bill.discountType,
          discountedAmount: bill.discountedAmount,
          sessionsAmount: bill.totalAmount,
          paidAmount,
        });

        const payerNames = Array.from(
          new Set(
            bill.sessions.flatMap((session) =>
              getPayerNamesForSession({
                playerName: session.playerName,
                payerMode: session.payerMode,
                payerData: session.payerData,
                overridePayerMode: session.overridePayerMode,
                overridePayerData: session.overridePayerData,
              })
            ),
          ),
        );

        const paymentModes = Array.from(new Set(bill.payments.map((payment) => payment.mode)));
        const paymentSplit = PAYMENT_MODE_ORDER
          .map((mode) => ({
            mode,
            amount: getCollectedPaidAmount(
              bill.payments
                .filter((payment) => payment.mode === mode)
                .map((payment) => ({
                  amount: payment.amount,
                  mode: payment.mode,
                  dueSettledAt: payment.dueSettledAt,
                })),
            ),
          }))
          .filter((entry) => entry.amount > 0);

        return {
          id: bill.id,
          createdAt: bill.createdAt.toISOString(),
          totalAmount: totals.totalAmount,
          discountType: bill.discountType,
          discountValue: bill.discountValue,
          discountedAmount: totals.discountedAmount,
          paidAmount: totals.paidAmount,
          remainingAmount: totals.remainingAmount,
          payerNames,
          paymentModes,
          paymentSplit,
          paymentCount: bill.payments.length,
        };
      })
      .filter((row) => {
        if (paymentMode !== "all" && !row.paymentSplit.some((entry) => entry.mode === paymentMode)) {
          return false;
        }
        if (payerRaw) {
          const hit = row.payerNames.some((name) => name.toLowerCase().includes(payerRaw));
          if (!hit) {
            return false;
          }
        }
        return true;
      });

    return Response.json({ data: rows }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
