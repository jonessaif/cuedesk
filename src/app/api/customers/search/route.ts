import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { customerService } from "@/lib/services/customerService";

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    const scope = (searchParams.get("scope") ?? "").trim().toLowerCase();
    if (!q) {
      return Response.json({ data: [] }, { status: 200 });
    }

    const data = await customerService.searchCustomers(prisma as never, {
      query: q,
      limit: 8,
      includeSessionNames: scope !== "due",
    });

    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
