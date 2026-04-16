import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { deleteTable, updateTable } from "@/lib/tables-service";

function parseId(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(prisma, request, "admin");

    const params = await context.params;
    const tableId = parseId(params.id);
    if (!tableId) {
      return Response.json({ error: "Invalid table id" }, { status: 400 });
    }

    const body = (await request.json()) as { name?: string; ratePerMin?: number; sectionId?: number | null };
    const updated = await updateTable(prisma, {
      id: tableId,
      name: body.name,
      ratePerMin:
        body.ratePerMin === undefined ? undefined : Number(body.ratePerMin),
      sectionId:
        body.sectionId === undefined
          ? undefined
          : body.sectionId === null
            ? null
            : Number(body.sectionId),
    });
    return Response.json({ data: updated }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(prisma, request, "admin");

    const params = await context.params;
    const tableId = parseId(params.id);
    if (!tableId) {
      return Response.json({ error: "Invalid table id" }, { status: 400 });
    }

    await deleteTable(prisma, { id: tableId });
    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
