import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function GET() {
  try {
    const sessions = await sessionService.getAllSessions(prisma as never);
    return Response.json(
      { data: sessions },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
