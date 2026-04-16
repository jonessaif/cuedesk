import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function POST(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const body = await request.json();

    if (
      !body ||
      typeof body.tableId !== "number" ||
      !Number.isFinite(body.tableId) ||
      body.tableId <= 0
    ) {
      return Response.json({ error: "Invalid tableId" }, { status: 400 });
    }

    const endTimeRaw =
      body && typeof body.endTime === "string" ? body.endTime : undefined;
    const outcomeRaw =
      body && typeof body.outcome === "string" ? body.outcome.toUpperCase() : "NORMAL";
    if (outcomeRaw !== "NORMAL" && outcomeRaw !== "LTP_LOSS") {
      return Response.json({ error: "Invalid outcome" }, { status: 400 });
    }
    const now = endTimeRaw ? new Date(endTimeRaw) : new Date();
    if (Number.isNaN(now.getTime())) {
      return Response.json({ error: "Invalid endTime" }, { status: 400 });
    }

    const session = await sessionService.endSession(prisma as never, {
      tableId: body.tableId,
      now,
      outcome: outcomeRaw as "NORMAL" | "LTP_LOSS",
    });

    return Response.json(session, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
