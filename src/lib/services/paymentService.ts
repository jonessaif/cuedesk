import {
  getCollectedPaidAmount,
  getEffectiveBillTotals,
  roundMoney,
} from "@/lib/billTotals";
import { customerService } from "@/lib/services/customerService";

export const paymentService = {
  async addPayment(
    prisma: unknown,
    input: {
      billId: number;
      amount: number;
      mode: string;
      dueCustomerName?: string;
      dueCustomerPhone?: string;
    },
  ) {
    if (!Number.isFinite(input.billId) || input.billId <= 0) {
      throw new Error("Bill not found");
    }

    const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
      (prisma as { bill?: unknown; bills?: unknown }).bills;
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;

    const bill = (await (
      billModel as {
        findUnique: (args: { where: { id: number } }) => Promise<unknown>;
      }
    ).findUnique({
      where: { id: input.billId },
    })) as {
      totalAmount: number;
      discountedAmount?: number | null;
      discountType?: string | null;
    } | null;

    if (!bill) {
      throw new Error("Bill not found");
    }

    const linkedSessions = await (
      sessionModel as {
        findMany: (args: {
          where: { billId: number };
          select: { id: true; outcome: true };
        }) => Promise<Array<{ id: number; outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED" }>>;
      }
    ).findMany({
      where: { billId: input.billId },
      select: { id: true, outcome: true },
    });

    const hasNonBillableOutcome = linkedSessions.some(
      (session) => session.outcome === "LTP_LOSS" || session.outcome === "CANCELLED",
    );
    if (hasNonBillableOutcome) {
      throw new Error("Cannot add payment to non-billable session bill");
    }

    const payments = await (
      paymentModel as {
        findMany: (args: { where: { billId: number } }) => Promise<
          Array<{ amount: number; mode: string; dueSettledAt?: Date | null }>
        >;
      }
    ).findMany({
      where: { billId: input.billId },
    });

    if (input.amount <= 0) {
      throw new Error("Invalid payment amount");
    }

    const totalPaid = getCollectedPaidAmount(payments);
    let sessionsTotal = 0;

    // Legacy fallback: some older billed sessions were linked to bills with totalAmount=0.
    if (
      bill.totalAmount <= 0 &&
      bill.discountType !== "fixed" &&
      bill.discountType !== "percent" &&
      sessionModel
    ) {
      const linkedSessions = await (
        sessionModel as {
          findMany: (args: { where: { billId: number } }) => Promise<Array<{ amount: number | null }>>;
        }
      ).findMany({
        where: { billId: input.billId },
      });

      sessionsTotal = roundMoney(linkedSessions.reduce(
        (sum, session) => sum + (typeof session.amount === "number" ? session.amount : 0),
        0,
      ));
    }

    const billTotal = getEffectiveBillTotals({
      totalAmount: bill.totalAmount,
      discountType: bill.discountType,
      discountedAmount: bill.discountedAmount,
      sessionsAmount: sessionsTotal,
      paidAmount: totalPaid,
    }).discountedAmount;

    const remaining = roundMoney(billTotal - totalPaid);

    if (roundMoney(input.amount) > remaining) {
      throw new Error("Payment exceeds bill amount");
    }

    const dueCustomerName = input.dueCustomerName?.trim() ?? "";
    const dueCustomerPhone = input.dueCustomerPhone?.trim() ?? "";
    if (input.mode === "due") {
      if (!dueCustomerName || !dueCustomerPhone) {
        throw new Error("Due requires customer name and phone");
      }
      await customerService.upsertCustomer(prisma, {
        name: dueCustomerName,
        phone: dueCustomerPhone,
      });
    }

    return (
      paymentModel as {
        create: (args: {
          data: {
            billId: number;
            amount: number;
            mode: string;
            dueCustomerName?: string | null;
            dueCustomerPhone?: string | null;
            dueSettledAt?: Date | null;
            dueReceivedMode?: string | null;
          };
        }) => Promise<unknown>;
      }
    ).create({
      data: {
        billId: input.billId,
        amount: roundMoney(input.amount),
        mode: input.mode,
        dueCustomerName: input.mode === "due" ? dueCustomerName : null,
        dueCustomerPhone: input.mode === "due" ? dueCustomerPhone : null,
        dueSettledAt: input.mode === "due" ? null : null,
        dueReceivedMode: null,
      },
    });
  },

  async getDueReport(prisma: unknown) {
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;

    // Cleanup legacy stale due rows with zero/negative amount but no settled timestamp.
    await (
      paymentModel as {
        updateMany: (args: {
          where: { mode: "due"; dueSettledAt: null; amount: { lte: number } };
          data: { dueSettledAt: Date };
        }) => Promise<unknown>;
      }
    ).updateMany({
      where: { mode: "due", dueSettledAt: null, amount: { lte: 0 } },
      data: { dueSettledAt: new Date() },
    });

    const rows = await (
      paymentModel as {
        findMany: (args: {
          where: { mode: "due"; dueSettledAt: null; amount: { gt: number } };
          orderBy: { id: "desc" };
          select: {
            id: true;
            billId: true;
            amount: true;
            dueCustomerName: true;
            dueCustomerPhone: true;
            dueSettledAt: true;
          };
        }) => Promise<Array<{
          id: number;
          billId: number;
          amount: number;
          dueCustomerName: string | null;
          dueCustomerPhone: string | null;
          dueSettledAt: Date | null;
        }>>;
      }
    ).findMany({
      where: { mode: "due", dueSettledAt: null, amount: { gt: 0 } },
      orderBy: { id: "desc" },
      select: {
        id: true,
        billId: true,
        amount: true,
        dueCustomerName: true,
        dueCustomerPhone: true,
        dueSettledAt: true,
      },
    });

    const byCustomer = new Map<string, {
      rowKey: string;
      customerName: string;
      customerPhone: string;
      totalDue: number;
      billIds: Set<number>;
      paymentIds: number[];
    }>();

    for (const row of rows) {
      const phone = (row.dueCustomerPhone ?? "").trim();
      const name = (row.dueCustomerName ?? "").trim();
      const key = phone && phone !== "-" ? `phone:${phone}` : `payment:${row.id}`;
      const existing = byCustomer.get(key) ?? {
        rowKey: key,
        customerName: name || "-",
        customerPhone: phone || "-",
        totalDue: 0,
        billIds: new Set<number>(),
        paymentIds: [],
      };
      existing.totalDue += row.amount;
      existing.billIds.add(row.billId);
      existing.paymentIds.push(row.id);
      if (existing.customerName === "-" && name) {
        existing.customerName = name;
      }
      byCustomer.set(key, existing);
    }

    return Array.from(byCustomer.values())
      .map((row) => ({
        rowKey: row.rowKey,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        totalDue: roundMoney(row.totalDue),
        billCount: row.billIds.size,
        paymentIds: row.paymentIds,
      }))
      .sort((a, b) => b.totalDue - a.totalDue);
  },

  async getDueReportByBill(prisma: unknown) {
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;

    const rows = await (
      paymentModel as {
        findMany: (args: {
          where: { mode: "due"; dueSettledAt: null; amount: { gt: number } };
          orderBy: { id: "desc" };
          select: {
            id: true;
            billId: true;
            amount: true;
            dueCustomerName: true;
            dueCustomerPhone: true;
          };
        }) => Promise<Array<{
          id: number;
          billId: number;
          amount: number;
          dueCustomerName: string | null;
          dueCustomerPhone: string | null;
        }>>;
      }
    ).findMany({
      where: { mode: "due", dueSettledAt: null, amount: { gt: 0 } },
      orderBy: { id: "desc" },
      select: {
        id: true,
        billId: true,
        amount: true,
        dueCustomerName: true,
        dueCustomerPhone: true,
      },
    });

    const billIds = Array.from(new Set(rows.map((row) => row.billId)));
    const billDateById = new Map<number, string | null>();

    if (billIds.length > 0) {
      const sessions = await (
        sessionModel as {
          findMany: (args: {
            where: { billId: { in: number[] } };
            select: { billId: true; startTime: true };
            orderBy: Array<{ billId: "asc" } | { startTime: "asc" }>;
          }) => Promise<Array<{
            billId: number | null;
            startTime: Date;
          }>>;
        }
      ).findMany({
        where: { billId: { in: billIds } },
        select: { billId: true, startTime: true },
        orderBy: [{ billId: "asc" }, { startTime: "asc" }],
      });

      for (const session of sessions) {
        if (!session.billId || billDateById.has(session.billId)) {
          continue;
        }
        billDateById.set(session.billId, session.startTime.toISOString());
      }
    }

    return rows.map((row) => ({
      paymentId: row.id,
      billId: row.billId,
      dueAmount: roundMoney(row.amount),
      customerName: (row.dueCustomerName ?? "").trim() || "-",
      customerPhone: (row.dueCustomerPhone ?? "").trim() || "-",
      billDate: billDateById.get(row.billId) ?? null,
    }));
  },

  async receiveDuePayment(
    prisma: unknown,
    input: {
      paymentId?: number;
      customerPhone?: string;
      mode: "cash" | "upi" | "card";
      amount: number;
    },
  ) {
    const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
      (prisma as { payment?: unknown; payments?: unknown }).payments;
    const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
      (prisma as { bill?: unknown; bills?: unknown }).bills;

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Invalid receive amount");
    }

    let dueEntries: Array<{
      id: number;
      billId: number;
      amount: number;
      mode: string;
      dueSettledAt?: Date | null;
    }> = [];

    if (input.customerPhone) {
      dueEntries = await (
        paymentModel as {
          findMany: (args: {
            where: {
              mode: "due";
              dueSettledAt: null;
              dueCustomerPhone: string;
              amount: { gt: number };
            };
            orderBy: { id: "asc" };
          }) => Promise<Array<{
            id: number;
            billId: number;
            amount: number;
            mode: string;
            dueSettledAt?: Date | null;
          }>>;
        }
      ).findMany({
        where: {
          mode: "due",
          dueSettledAt: null,
          dueCustomerPhone: input.customerPhone,
          amount: { gt: 0 },
        },
        orderBy: { id: "asc" },
      });
    } else if (input.paymentId) {
      const row = await (
        paymentModel as {
          findUnique: (args: { where: { id: number } }) => Promise<{
            id: number;
            billId: number;
            amount: number;
            mode: string;
            dueSettledAt?: Date | null;
          } | null>;
        }
      ).findUnique({
        where: { id: input.paymentId },
      });
      if (row) {
        dueEntries = [row];
      }
    }

    const activeDueEntries = dueEntries
      .filter((row): row is {
        id: number;
        billId: number;
        amount: number;
        mode: string;
        dueSettledAt?: Date | null;
      } => Boolean(row))
      .filter((row) => row.mode === "due" && !row.dueSettledAt && row.amount > 0);

    if (activeDueEntries.length === 0) {
      throw new Error("Due entry not found");
    }

    const totalDue = roundMoney(activeDueEntries.reduce((sum, row) => sum + row.amount, 0));
    if (roundMoney(input.amount) > totalDue) {
      throw new Error("Receive amount exceeds due");
    }

    let pendingToReceive = roundMoney(input.amount);
    const receiveTimestamp = new Date();
    for (const duePayment of activeDueEntries) {
      if (pendingToReceive <= 0) {
        break;
      }
      const bill = (await (
        billModel as {
          findUnique: (args: { where: { id: number } }) => Promise<unknown>;
        }
      ).findUnique({
        where: { id: duePayment.billId },
      })) as { id: number } | null;
      if (!bill) {
        throw new Error("Bill not found");
      }

      const receiveNow = roundMoney(Math.min(duePayment.amount, pendingToReceive));
      await (
        paymentModel as {
          create: (args: {
            data: {
              billId: number;
              amount: number;
              mode: string;
              dueSettledAt?: Date | null;
              dueReceivedMode?: string | null;
            };
          }) => Promise<unknown>;
        }
      ).create({
        data: {
          billId: duePayment.billId,
          amount: receiveNow,
          mode: input.mode,
          dueSettledAt: receiveTimestamp,
          dueReceivedMode: input.mode,
        },
      });

      const remainingDueForEntry = roundMoney(duePayment.amount - receiveNow);
      await (
        paymentModel as {
          update: (args: {
            where: { id: number };
            data: { amount: number; dueSettledAt: Date | null; dueReceivedMode: string | null };
          }) => Promise<unknown>;
        }
      ).update({
        where: { id: duePayment.id },
        data: {
          amount: remainingDueForEntry,
          dueSettledAt: remainingDueForEntry === 0 ? receiveTimestamp : null,
          dueReceivedMode: remainingDueForEntry === 0 ? input.mode : null,
        },
      });

      pendingToReceive = roundMoney(pendingToReceive - receiveNow);
    }

    return {
      receivedAmount: roundMoney(input.amount),
      remainingDue: roundMoney(totalDue - roundMoney(input.amount)),
    };
  },
};
