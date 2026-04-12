import { prisma } from "@/lib/prisma";
import { payerService } from "@/lib/services/payerService";

const VALID_PAYER_MODES = ["none", "single", "split"] as const;

type PayerMode = (typeof VALID_PAYER_MODES)[number];

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (
      typeof body.sessionId !== "number" ||
      !Number.isFinite(body.sessionId) ||
      body.sessionId <= 0
    ) {
      return Response.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    if (
      typeof body.payerMode !== "string" ||
      !VALID_PAYER_MODES.includes(body.payerMode as PayerMode)
    ) {
      return Response.json({ error: "Invalid payerMode" }, { status: 400 });
    }

    const session = await payerService.assignPayer(prisma as never, {
      sessionId: body.sessionId,
      payerMode: body.payerMode,
      payerData: body.payerData,
    });

    return Response.json(session, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
