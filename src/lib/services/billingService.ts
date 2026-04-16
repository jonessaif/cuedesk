import { roundMoney } from "@/lib/billTotals";

function calculateEffectiveSessionAmount(session: {
  startTime: Date;
  endTime: Date | null;
  overrideStartTime?: Date | null;
  overrideEndTime?: Date | null;
  overrideRatePerMin?: number | null;
  table: { ratePerMin: number; name: string };
  amount?: number;
}): number {
  const effectiveStartTime = session.overrideStartTime ?? session.startTime;
  const effectiveEndTime = session.overrideEndTime ?? session.endTime;
  const effectiveRatePerMin = session.overrideRatePerMin ?? session.table.ratePerMin;

  if (!effectiveEndTime) {
    return typeof session.amount === "number" ? session.amount : 0;
  }

  const diffMs = effectiveEndTime.getTime() - effectiveStartTime.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  if (session.table.name.toUpperCase().startsWith("PS")) {
    const hourlyRate = effectiveRatePerMin * 60;
    const billedHours = Math.ceil(diffMs / (60 * 60 * 1000));
    return roundMoney(billedHours * hourlyRate);
  }

  const safeDurationMinutes = Math.floor(diffMs / 60000);
  return safeDurationMinutes > 0 ? roundMoney(safeDurationMinutes * effectiveRatePerMin) : 0;
}

function calculateDiscountedAmount(
  totalAmount: number,
  discountType?: "fixed" | "percent",
  discountValue?: number,
): { discountType: "fixed" | "percent" | null; discountValue: number | null; discountedAmount: number } {
  if (discountValue !== undefined && (!Number.isFinite(discountValue) || discountValue < 0)) {
    throw new Error("Invalid discount value");
  }

  if (
    discountType !== undefined &&
    discountType !== "fixed" &&
    discountType !== "percent"
  ) {
    throw new Error("Invalid discount type");
  }

  if (
    discountType === "percent" &&
    (discountValue === undefined || discountValue > 100)
  ) {
    throw new Error("Invalid percent discount");
  }

  const finalType = discountType ?? null;
  const finalValue = discountType ? discountValue ?? 0 : null;

  let discountedAmount = totalAmount;
  if (finalType === "fixed") {
    discountedAmount = Math.max(0, totalAmount - (finalValue ?? 0));
  } else if (finalType === "percent") {
    discountedAmount = Math.max(0, totalAmount - (totalAmount * (finalValue ?? 0)) / 100);
  }

  return {
    discountType: finalType,
    discountValue: finalValue,
    discountedAmount,
  };
}

export const billingService = {
  async createBill(
    prisma: unknown,
    input: {
      sessionIds: number[];
      discountType?: "fixed" | "percent";
      discountValue?: number;
    },
  ) {
    const sessionModel = (prisma as { session?: unknown; sessions?: unknown }).session ??
      (prisma as { session?: unknown; sessions?: unknown }).sessions;
    const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
      (prisma as { bill?: unknown; bills?: unknown }).bills;

    const sessions = await (
      sessionModel as {
        findMany: (args: {
          where: {
            id: { in: number[] };
            billId: null;
            status: { not: "running" };
            outcome: "NORMAL";
            cancellationReason: null;
          };
          include: { table: { select: { ratePerMin: true; name: true } } };
        }) => Promise<
          Array<{
            id: number;
            amount: number;
            startTime: Date;
            endTime: Date | null;
            overrideStartTime?: Date | null;
            overrideEndTime?: Date | null;
            overrideRatePerMin?: number | null;
            table: { ratePerMin: number; name: string };
          }>
        >;
      }
    ).findMany({
      where: {
        id: { in: input.sessionIds },
        billId: null,
        status: { not: "running" },
        outcome: "NORMAL",
        cancellationReason: null,
      },
      include: {
        table: { select: { ratePerMin: true, name: true } },
      },
    });

    if (sessions.length === 0) {
      throw new Error("No unbilled sessions to bill");
    }

    const totalAmount = sessions.reduce(
      (sum, session) => sum + calculateEffectiveSessionAmount(session),
      0,
    );

    const discount = calculateDiscountedAmount(
      totalAmount,
      input.discountType,
      input.discountValue,
    );

    const bill = await (
      billModel as {
        create: (args: {
          data: {
            totalAmount: number;
            discountType: string | null;
            discountValue: number | null;
            discountedAmount: number;
          };
        }) => Promise<unknown>;
      }
    ).create({
      data: {
        totalAmount,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        discountedAmount: discount.discountedAmount,
      },
    });

    const sessionIds = sessions.map((s: { id: number }) => s.id);

    await (
      sessionModel as {
        updateMany: (args: {
          where: { id: { in: number[] } };
          data: { status: string; billId: number };
        }) => Promise<unknown>;
      }
    ).updateMany({
      where: { id: { in: sessionIds } },
      data: { status: "billed", billId: (bill as { id: number }).id },
    });

    return bill;
  },

  async applyDiscount(
    prisma: unknown,
    input: {
      billId: number;
      discountType?: "fixed" | "percent";
      discountValue?: number;
    },
  ) {
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
    })) as { id: number; totalAmount: number } | null;

    if (!bill) {
      throw new Error("Bill not found");
    }

    const linkedSessions = await (
      sessionModel as {
        findMany: (args: {
          where: { billId: number };
          select: { outcome: true };
        }) => Promise<Array<{ outcome?: "NORMAL" | "LTP_LOSS" | "CANCELLED" }>>;
      }
    ).findMany({
      where: { billId: input.billId },
      select: { outcome: true },
    });
    if (linkedSessions.some((session) => session.outcome === "LTP_LOSS" || session.outcome === "CANCELLED")) {
      throw new Error("Cannot apply discount to non-billable sessions");
    }

    const payments = await (
      paymentModel as {
        findMany: (args: { where: { billId: number } }) => Promise<Array<{ amount: number }>>;
      }
    ).findMany({
      where: { billId: input.billId },
    });

    const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const remainingBeforeDiscount = bill.totalAmount - paidAmount;

    const discount = calculateDiscountedAmount(
      bill.totalAmount,
      input.discountType,
      input.discountValue,
    );
    const effectiveDiscount = roundMoney(Math.max(bill.totalAmount - discount.discountedAmount, 0));
    if (effectiveDiscount > roundMoney(Math.max(remainingBeforeDiscount, 0))) {
      throw new Error("Discount exceeds remaining amount");
    }

    if (discount.discountedAmount < paidAmount) {
      throw new Error("Discounted total below paid amount");
    }

    const updated = await (
      billModel as {
        update: (args: {
          where: { id: number };
          data: {
            discountType: string | null;
            discountValue: number | null;
            discountedAmount: number;
          };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id: input.billId },
      data: {
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        discountedAmount: discount.discountedAmount,
      },
    });

    const remainingAmount = Math.max(discount.discountedAmount - paidAmount, 0);
    const discountAmount = Math.max(bill.totalAmount - discount.discountedAmount, 0);
    return {
      ...(updated as object),
      subtotal: bill.totalAmount,
      discount: discountAmount,
      finalAmount: discount.discountedAmount,
      paidAmount,
      remainingAmount,
      remaining: remainingAmount,
    };
  },
};
