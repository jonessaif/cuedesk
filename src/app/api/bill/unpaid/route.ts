import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getCollectedPaidAmount, getEffectiveBillTotals } from "@/lib/billTotals";

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
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
            dueCustomerName: true,
            dueCustomerPhone: true,
            dueSettledAt: true,
            dueReceivedMode: true,
          },
        },
      },
    });

    const data = bills
      .map((bill) => {
        const paidAmount = getCollectedPaidAmount(
          bill.payments.map((payment) => ({
            amount: payment.amount,
            mode: payment.mode,
            dueSettledAt: payment.dueSettledAt,
          })),
        );
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
          subtotal: totals.subtotal,
          discount: totals.discount,
          finalAmount: totals.finalAmount,
          totalAmount: totals.totalAmount,
          discountType: bill.discountType,
          discountValue: bill.discountValue,
          discountedAmount: totals.discountedAmount,
          paidAmount: totals.paidAmount,
          remainingAmount: totals.remainingAmount,
          remaining: totals.remaining,
          payments: bill.payments.map((payment) => ({
            mode: payment.mode,
            amount: payment.amount,
            dueCustomerName: payment.dueCustomerName,
            dueCustomerPhone: payment.dueCustomerPhone,
            dueSettledAt: payment.dueSettledAt,
            dueReceivedMode: payment.dueReceivedMode,
          })),
        };
      })
      .filter((bill) => bill.remainingAmount > 0)
      .sort((a, b) => b.id - a.id);

    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
