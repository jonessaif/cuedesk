import { requireRole } from "@/lib/authz";
import { createTable, listTablesWithState } from "@/lib/tables-service";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, ["admin", "operator"]);
    const rows = await listTablesWithState(prisma);
    return Response.json({ data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const body = (await request.json()) as { name?: string; ratePerMin?: number; sectionId?: number };

    const created = await createTable(prisma, {
      name: body.name ?? "",
      ratePerMin: Number(body.ratePerMin),
      sectionId:
        body.sectionId === undefined || body.sectionId === null
          ? undefined
          : Number(body.sectionId),
    });

    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
