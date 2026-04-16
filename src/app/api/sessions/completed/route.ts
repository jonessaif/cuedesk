import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const sessions = await sessionService.getCompletedSessions(prisma as never);
    return Response.json({ data: sessions }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
