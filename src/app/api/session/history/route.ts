import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const { searchParams } = new URL(request.url);
    const sessionIdRaw = searchParams.get("sessionId");
    const sessionId = sessionIdRaw ? Number(sessionIdRaw) : Number.NaN;

    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      return Response.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    const data = await sessionService.getSessionOverrideHistory(prisma as never, {
      sessionId,
    });

    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
