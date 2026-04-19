import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const model = (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategory
      ?? (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategories;
    if (!model) {
      throw new Error("Expense categories are not available. Run prisma db push and prisma generate.");
    }

    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid category id" }, { status: 400 });
    }

    const body = (await request.json()) as { name?: string; is_active?: boolean };
    const data: { name?: string; isActive?: boolean } = {};
    if (typeof body.name === "string") {
      const nextName = body.name.trim();
      if (!nextName) {
        return Response.json({ error: "Category name cannot be empty" }, { status: 400 });
      }
      data.name = nextName;
    }
    if (typeof body.is_active === "boolean") {
      data.isActive = body.is_active;
    }
    if (Object.keys(data).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await (
      model as {
        update: (args: {
          where: { id: number };
          data: { name?: string; isActive?: boolean };
          select: { id: true; name: true; isActive: true; createdAt: true; updatedAt: true };
        }) => Promise<{
          id: number;
          name: string;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
        }>;
      }
    ).update({
      where: { id },
      data,
      select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true },
    });

    return Response.json({ data: updated }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const duplicate = message.includes("Unique constraint");
    const status = duplicate ? 409 : message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: duplicate ? "Category already exists" : message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const model = (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategory
      ?? (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategories;
    if (!model) {
      throw new Error("Expense categories are not available. Run prisma db push and prisma generate.");
    }

    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid category id" }, { status: 400 });
    }

    await (
      model as {
        delete: (args: { where: { id: number } }) => Promise<unknown>;
      }
    ).delete({ where: { id } });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const inUse = message.includes("Foreign key constraint");
    const status = inUse ? 409 : message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json(
      { error: inUse ? "Category is in use by expense entries; deactivate or rename instead." : message },
      { status },
    );
  }
}
