import { prisma } from "@/lib/prisma";
import { getCollectedPaidAmount, getEffectiveBillTotals } from "@/lib/billTotals";

export async function GET() {
  try {
    const latest = await prisma.bill.findFirst({
      orderBy: { createdAt: "desc" },
      include: {
        sessions: {
          select: {
            amount: true,
          },
        },
        payments: true,
      },
    });

    if (!latest) {
      return Response.json({ data: null }, { status: 200 });
    }

    const paidAmount = getCollectedPaidAmount(
      latest.payments.map((payment) => ({
        amount: payment.amount,
        mode: payment.mode,
        dueSettledAt: payment.dueSettledAt,
      })),
    );
    const sessionsAmount = latest.sessions.reduce(
      (sum, session) => sum + (typeof session.amount === "number" ? session.amount : 0),
      0,
    );
    const totals = getEffectiveBillTotals({
      totalAmount: latest.totalAmount,
      discountType: latest.discountType,
      discountedAmount: latest.discountedAmount,
      sessionsAmount,
      paidAmount,
    });

    return Response.json(
      {
        data: {
          id: latest.id,
          subtotal: totals.subtotal,
          discount: totals.discount,
          finalAmount: totals.finalAmount,
          totalAmount: totals.totalAmount,
          discountType: latest.discountType,
          discountValue: latest.discountValue,
          discountedAmount: totals.discountedAmount,
          paidAmount: totals.paidAmount,
          remainingAmount: totals.remainingAmount,
          remaining: totals.remaining,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
