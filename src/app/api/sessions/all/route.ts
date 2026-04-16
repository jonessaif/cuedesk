import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const { searchParams } = new URL(request.url);
    const scopeRaw = searchParams.get("scope");
    const scope = scopeRaw === "day" || scopeRaw === "range" ? scopeRaw : "current";
    const date = searchParams.get("date") ?? undefined;
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;
    const sessions = await sessionService.getAllSessions(prisma as never, {
      scope: scope as "current" | "day" | "range",
      date,
      startDate,
      endDate,
      now: new Date(),
    });
    return Response.json(
      {
        data: sessions.rows,
        summary: sessions.summary,
        window: sessions.window,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
