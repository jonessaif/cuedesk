import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function POST(request: Request) {
  try {
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
    const now = endTimeRaw ? new Date(endTimeRaw) : new Date();
    if (Number.isNaN(now.getTime())) {
      return Response.json({ error: "Invalid endTime" }, { status: 400 });
    }

    const session = await sessionService.endSession(prisma as never, {
      tableId: body.tableId,
      now,
    });

    return Response.json(session, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
