import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const eventModel = (prisma as { expenseEntryEvent?: unknown; expenseEntryEvents?: unknown }).expenseEntryEvent
      ?? (prisma as { expenseEntryEvent?: unknown; expenseEntryEvents?: unknown }).expenseEntryEvents;
    if (!eventModel) {
      throw new Error("Expense history is not available. Run prisma db push and prisma generate.");
    }

    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid expense id" }, { status: 400 });
    }

    const rows = await (
      eventModel as {
        findMany: (args: {
          where: { entryId: number };
          orderBy: { createdAt: "desc" };
          select: {
            id: true;
            action: true;
            changedFields: true;
            beforeData: true;
            afterData: true;
            changedBy: true;
            changedByName: true;
            createdAt: true;
          };
        }) => Promise<Array<{
          id: number;
          action: string;
          changedFields: unknown;
          beforeData: unknown;
          afterData: unknown;
          changedBy: number | null;
          changedByName: string | null;
          createdAt: Date;
        }>>;
      }
    ).findMany({
      where: { entryId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        changedFields: true,
        beforeData: true,
        afterData: true,
        changedBy: true,
        changedByName: true,
        createdAt: true,
      },
    });

    return Response.json({
      data: rows.map((row) => ({
        id: row.id,
        action: row.action,
        changed_fields: row.changedFields,
        before_data: row.beforeData,
        after_data: row.afterData,
        changed_by: row.changedBy,
        changed_by_name: row.changedByName ?? "System",
        created_at: row.createdAt,
      })),
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
