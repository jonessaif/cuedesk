import { prisma } from "@/lib/prisma";
import { paymentService } from "@/lib/services/paymentService";

const VALID_PAYMENT_MODES = ["cash", "upi", "card", "due"] as const;

type PaymentMode = (typeof VALID_PAYMENT_MODES)[number];

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (
      typeof body.billId !== "number" ||
      !Number.isFinite(body.billId) ||
      body.billId <= 0
    ) {
      return Response.json({ error: "Invalid billId" }, { status: 400 });
    }

    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      body.amount <= 0
    ) {
      return Response.json({ error: "Invalid amount" }, { status: 400 });
    }

    const mode = String(body.mode).toLowerCase();

    if (
      typeof mode !== "string" ||
      !VALID_PAYMENT_MODES.includes(mode as PaymentMode)
    ) {
      return Response.json({ error: "Invalid mode" }, { status: 400 });
    }

    const payment = await paymentService.addPayment(prisma as never, {
      billId: body.billId,
      amount: body.amount,
      mode,
      dueCustomerName:
        body.dueCustomerName === undefined ? undefined : String(body.dueCustomerName),
      dueCustomerPhone:
        body.dueCustomerPhone === undefined ? undefined : String(body.dueCustomerPhone),
    });

    return Response.json(payment, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
