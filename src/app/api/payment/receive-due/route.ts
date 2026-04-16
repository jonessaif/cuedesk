import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { paymentService } from "@/lib/services/paymentService";

const VALID_RECEIVE_MODES = ["cash", "upi", "card"] as const;
type ReceiveMode = (typeof VALID_RECEIVE_MODES)[number];

export async function POST(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const body = await request.json();

    if (
      typeof body.paymentId !== "number" ||
      !Number.isFinite(body.paymentId) ||
      body.paymentId <= 0
    ) {
      if (typeof body.customerPhone !== "string" || body.customerPhone.trim() === "") {
        return Response.json({ error: "Invalid paymentId" }, { status: 400 });
      }
    }

    const mode = String(body.mode).toLowerCase();
    if (!VALID_RECEIVE_MODES.includes(mode as ReceiveMode)) {
      return Response.json({ error: "Invalid receive mode" }, { status: 400 });
    }
    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      body.amount <= 0
    ) {
      return Response.json({ error: "Invalid amount" }, { status: 400 });
    }

    const data = await paymentService.receiveDuePayment(prisma as never, {
      paymentId:
        typeof body.paymentId === "number" && Number.isFinite(body.paymentId) && body.paymentId > 0
          ? body.paymentId
          : undefined,
      customerPhone:
        typeof body.customerPhone === "string" && body.customerPhone.trim() !== ""
          ? body.customerPhone.trim()
          : undefined,
      mode: mode as ReceiveMode,
      amount: body.amount,
    });
    return Response.json(data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
