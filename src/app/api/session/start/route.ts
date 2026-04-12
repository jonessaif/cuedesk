import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (
      typeof body.tableId !== "number" ||
      typeof body.playerName !== "string" ||
      body.playerName.trim() === ""
    ) {
      return Response.json({ error: "Invalid input" }, { status: 400 });
    }

    const session = await sessionService.startSession(prisma as never, {
      tableId: body.tableId,
      playerName: body.playerName.trim(),
    });

    const startTimeRaw =
      body && typeof body.startTime === "string" ? body.startTime : undefined;
    if (startTimeRaw) {
      const parsedStartTime = new Date(startTimeRaw);
      if (Number.isNaN(parsedStartTime.getTime())) {
        return Response.json({ error: "Invalid startTime" }, { status: 400 });
      }

      await sessionService.overrideSession(prisma as never, {
        sessionId: (session as { id: number }).id,
        overrideStartTime: parsedStartTime,
      });
    }

    return Response.json(session, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
