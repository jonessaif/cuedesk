import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function POST(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const body = await request.json();

    if (
      !body ||
      typeof body.sessionId !== "number" ||
      !Number.isFinite(body.sessionId) ||
      body.sessionId <= 0
    ) {
      return Response.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    if (typeof body.reason !== "string" || body.reason.trim() === "") {
      return Response.json({ error: "Cancellation reason is required" }, { status: 400 });
    }

    const session = await sessionService.cancelSession(prisma as never, {
      sessionId: body.sessionId,
      reason: body.reason,
      changedBy: typeof body.changedBy === "string" ? body.changedBy : undefined,
    });

    return Response.json(session, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
