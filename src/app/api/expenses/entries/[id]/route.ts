import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type ExpenseModeInput = "cash" | "bank" | "upi_other";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isExpenseMode(value: unknown): value is ExpenseModeInput {
  return value === "cash" || value === "bank" || value === "upi_other";
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const entryModel = (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntry
      ?? (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntries;
    const categoryModel = (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategory
      ?? (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategories;
    if (!entryModel || !categoryModel) {
      throw new Error("Expenses are not available. Run prisma db push and prisma generate.");
    }

    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid expense id" }, { status: 400 });
    }

    const body = (await request.json()) as {
      date?: string;
      category_id?: number;
      item?: string;
      amount?: number;
      mode?: ExpenseModeInput;
    };
    const date = String(body.date ?? "");
    const categoryId = Number(body.category_id);
    const item = String(body.item ?? "").trim();
    const amount = Number(body.amount);
    const mode = body.mode;

    if (!isDateKey(date)) {
      return Response.json({ error: "Valid date is required (YYYY-MM-DD)" }, { status: 400 });
    }
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return Response.json({ error: "Valid category is required" }, { status: 400 });
    }
    if (!item) {
      return Response.json({ error: "Item is required" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "Amount must be greater than 0" }, { status: 400 });
    }
    if (!isExpenseMode(mode)) {
      return Response.json({ error: "Mode must be cash, bank, or upi other" }, { status: 400 });
    }

    const category = await (
      categoryModel as {
        findUnique: (args: {
          where: { id: number };
          select: { id: true; isActive: true };
        }) => Promise<{ id: number; isActive: boolean } | null>;
      }
    ).findUnique({
      where: { id: categoryId },
      select: { id: true, isActive: true },
    });
    if (!category || !category.isActive) {
      return Response.json({ error: "Category not found or inactive" }, { status: 400 });
    }

    const updated = await (
      entryModel as {
        update: (args: {
          where: { id: number };
          data: {
            date: string;
            categoryId: number;
            item: string;
            amount: number;
            mode: ExpenseModeInput;
          };
          select: {
            id: true;
            date: true;
            item: true;
            amount: true;
            mode: true;
            createdAt: true;
            category: { select: { id: true; name: true } };
            user: { select: { id: true; name: true } };
          };
        }) => Promise<{
          id: number;
          date: string;
          item: string;
          amount: number;
          mode: ExpenseModeInput;
          createdAt: Date;
          category: { id: number; name: string };
          user: { id: number; name: string };
        }>;
      }
    ).update({
      where: { id },
      data: {
        date,
        categoryId,
        item,
        amount,
        mode,
      },
      select: {
        id: true,
        date: true,
        item: true,
        amount: true,
        mode: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });

    return Response.json({
      data: {
        id: updated.id,
        date: updated.date,
        item: updated.item,
        amount: Math.round(updated.amount),
        mode: updated.mode,
        category_id: updated.category.id,
        category_name: updated.category.name,
        created_by_user_id: updated.user.id,
        created_by_user_name: updated.user.name,
        created_at: updated.createdAt,
      },
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const notFound = message.includes("Record to update not found");
    const status = notFound ? 404 : message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: notFound ? "Expense entry not found" : message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const entryModel = (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntry
      ?? (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntries;
    if (!entryModel) {
      throw new Error("Expenses are not available. Run prisma db push and prisma generate.");
    }

    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid expense id" }, { status: 400 });
    }

    await (
      entryModel as {
        delete: (args: { where: { id: number } }) => Promise<unknown>;
      }
    ).delete({ where: { id } });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const notFound = message.includes("Record to delete does not exist");
    const status = notFound ? 404 : message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: notFound ? "Expense entry not found" : message }, { status });
  }
}
