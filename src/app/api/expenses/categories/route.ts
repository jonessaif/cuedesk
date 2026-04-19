import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const model = (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategory
      ?? (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategories;
    if (!model) {
      return Response.json({ data: [] }, { status: 200 });
    }

    const rows = await (
      model as {
        findMany: (args: {
          orderBy: { name: "asc" };
          select: { id: true; name: true; isActive: true; createdAt: true; updatedAt: true };
        }) => Promise<Array<{
          id: number;
          name: string;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
        }>>;
      }
    ).findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true },
    });

    return Response.json({ data: rows }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const model = (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategory
      ?? (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategories;
    if (!model) {
      throw new Error("Expense categories are not available. Run prisma db push and prisma generate.");
    }

    const body = (await request.json()) as { name?: string };
    const name = String(body.name ?? "").trim();
    if (!name) {
      return Response.json({ error: "Category name is required" }, { status: 400 });
    }

    const created = await (
      model as {
        create: (args: {
          data: { name: string; isActive: boolean };
          select: { id: true; name: true; isActive: true; createdAt: true; updatedAt: true };
        }) => Promise<{
          id: number;
          name: string;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
        }>;
      }
    ).create({
      data: { name, isActive: true },
      select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true },
    });

    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const duplicate = message.includes("Unique constraint");
    const status = duplicate ? 409 : message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: duplicate ? "Category already exists" : message }, { status });
  }
}
