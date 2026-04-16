import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { paymentService } from "@/lib/services/paymentService";

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const data = await paymentService.getDueReport(prisma as never);
    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
