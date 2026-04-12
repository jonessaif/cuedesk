import { getEffectiveBillTotals, roundMoney } from "@/lib/billTotals";

export const paymentService = {
  async addPayment(
    prisma: unknown,
    input: {
      billId: number;
      amount: number;
      mode: string;
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

    const payments = await (
      paymentModel as {
        findMany: (args: { where: { billId: number } }) => Promise<Array<{ amount: number }>>;
      }
    ).findMany({
      where: { billId: input.billId },
    });

    if (input.amount <= 0) {
      throw new Error("Invalid payment amount");
    }

    const totalPaid = roundMoney(payments.reduce((sum, p) => {
      const amt = typeof p.amount === "number" ? p.amount : 0;
      return sum + amt;
    }, 0));
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

    return (
      paymentModel as {
        create: (args: {
          data: { billId: number; amount: number; mode: string };
        }) => Promise<unknown>;
      }
    ).create({
      data: {
        billId: input.billId,
        amount: roundMoney(input.amount),
        mode: input.mode,
      },
    });
  },
};
