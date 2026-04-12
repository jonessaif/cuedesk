import { prisma } from "@/lib/prisma";
import { getEffectiveBillTotals } from "@/lib/billTotals";

export async function GET() {
  try {
    const bills = await prisma.bill.findMany({
      orderBy: { id: "desc" },
      include: {
        sessions: {
          select: {
            amount: true,
          },
        },
        payments: {
          select: {
            amount: true,
            mode: true,
          },
        },
      },
    });

    const data = bills
      .map((bill) => {
        const paidAmount = bill.payments.reduce((sum, payment) => sum + payment.amount, 0);
        const sessionsAmount = bill.sessions.reduce(
          (sum, session) => sum + (typeof session.amount === "number" ? session.amount : 0),
          0,
        );
        const totals = getEffectiveBillTotals({
          totalAmount: bill.totalAmount,
          discountType: bill.discountType,
          discountedAmount: bill.discountedAmount,
          sessionsAmount,
          paidAmount,
        });

        return {
          id: bill.id,
          totalAmount: totals.totalAmount,
          discountType: bill.discountType,
          discountValue: bill.discountValue,
          discountedAmount: totals.discountedAmount,
          paidAmount: totals.paidAmount,
          remainingAmount: totals.remainingAmount,
          payments: bill.payments.map((payment) => ({
            mode: payment.mode,
            amount: payment.amount,
          })),
        };
      })
      .filter((bill) => bill.remainingAmount > 0)
      .sort((a, b) => b.id - a.id);

    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
