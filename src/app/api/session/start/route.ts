import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function POST(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const body = await request.json();

    if (
      typeof body.tableId !== "number" ||
      typeof body.playerName !== "string" ||
      body.playerName.trim() === ""
    ) {
      return Response.json({ error: "Invalid input" }, { status: 400 });
    }

    const startTimeRaw =
      body && typeof body.startTime === "string" ? body.startTime : undefined;
    let parsedStartTime: Date | undefined;
    if (startTimeRaw) {
      parsedStartTime = new Date(startTimeRaw);
      if (Number.isNaN(parsedStartTime.getTime())) {
        return Response.json({ error: "Invalid startTime" }, { status: 400 });
      }
    }

    const session = await sessionService.startSession(prisma as never, {
      tableId: body.tableId,
      playerName: body.playerName.trim(),
      startTime: parsedStartTime,
    });

    return Response.json(session, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
