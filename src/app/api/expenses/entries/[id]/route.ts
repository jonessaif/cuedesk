import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type ExpenseModeInput = "cash" | "bank" | "upi_other";

type ExpenseSnapshot = {
  date: string;
  categoryId: number;
  categoryName: string;
  item: string;
  amount: number;
  mode: ExpenseModeInput;
  isDeleted: boolean;
};

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

function buildDiffEntries(before: ExpenseSnapshot, after: ExpenseSnapshot): Array<{ field: string; before: unknown; after: unknown }> {
  const fields: Array<keyof ExpenseSnapshot> = [
    "date",
    "categoryId",
    "categoryName",
    "item",
    "amount",
    "mode",
    "isDeleted",
  ];
  const diffs: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const field of fields) {
    if (before[field] !== after[field]) {
      diffs.push({ field, before: before[field], after: after[field] });
    }
  }
  return diffs;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireOperatorOrAdmin(prisma, request);
    const entryModel = (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntry
      ?? (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntries;
    const categoryModel = (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategory
      ?? (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategories;
    const eventModel = (prisma as { expenseEntryEvent?: unknown; expenseEntryEvents?: unknown }).expenseEntryEvent
      ?? (prisma as { expenseEntryEvent?: unknown; expenseEntryEvents?: unknown }).expenseEntryEvents;
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

    const existing = await (
      entryModel as {
        findUnique: (args: {
          where: { id: number };
          select: {
            id: true;
            date: true;
            categoryId: true;
            item: true;
            amount: true;
            mode: true;
            isDeleted: true;
            category: { select: { id: true; name: true } };
          };
        }) => Promise<{
          id: number;
          date: string;
          categoryId: number;
          item: string;
          amount: number;
          mode: ExpenseModeInput;
          isDeleted?: boolean;
          category: { id: number; name: string };
        } | null>;
      }
    ).findUnique({
      where: { id },
      select: {
        id: true,
        date: true,
        categoryId: true,
        item: true,
        amount: true,
        mode: true,
        isDeleted: true,
        category: { select: { id: true, name: true } },
      },
    });
    if (!existing) {
      return Response.json({ error: "Expense entry not found" }, { status: 404 });
    }
    if (existing.isDeleted) {
      return Response.json({ error: "Deleted expense entry cannot be edited" }, { status: 400 });
    }

    const beforeSnapshot: ExpenseSnapshot = {
      date: existing.date,
      categoryId: existing.categoryId,
      categoryName: existing.category.name,
      item: existing.item,
      amount: Math.round(existing.amount),
      mode: existing.mode,
      isDeleted: Boolean(existing.isDeleted),
    };

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
            isDeleted: true;
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
          isDeleted?: boolean;
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
        isDeleted: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });

    const afterSnapshot: ExpenseSnapshot = {
      date: updated.date,
      categoryId: updated.category.id,
      categoryName: updated.category.name,
      item: updated.item,
      amount: Math.round(updated.amount),
      mode: updated.mode,
      isDeleted: Boolean(updated.isDeleted),
    };
    const diffEntries = buildDiffEntries(beforeSnapshot, afterSnapshot);
    if (eventModel && diffEntries.length > 0) {
      await (
        eventModel as {
          create: (args: {
            data: {
              entryId: number;
              action: string;
              changedFields: unknown;
              beforeData: unknown;
              afterData: unknown;
              changedBy: number;
              changedByName: string;
            };
          }) => Promise<unknown>;
        }
      ).create({
        data: {
          entryId: id,
          action: "edit",
          changedFields: diffEntries,
          beforeData: beforeSnapshot,
          afterData: afterSnapshot,
          changedBy: actor.id,
          changedByName: actor.name,
        },
      });
    }

    return Response.json({
      data: {
        id: updated.id,
        date: updated.date,
        item: updated.item,
        amount: Math.round(updated.amount),
        mode: updated.mode,
        is_deleted: Boolean(updated.isDeleted),
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
    const actor = await requireOperatorOrAdmin(prisma, request);
    const entryModel = (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntry
      ?? (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntries;
    const eventModel = (prisma as { expenseEntryEvent?: unknown; expenseEntryEvents?: unknown }).expenseEntryEvent
      ?? (prisma as { expenseEntryEvent?: unknown; expenseEntryEvents?: unknown }).expenseEntryEvents;
    if (!entryModel) {
      throw new Error("Expenses are not available. Run prisma db push and prisma generate.");
    }

    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid expense id" }, { status: 400 });
    }

    const existing = await (
      entryModel as {
        findUnique: (args: {
          where: { id: number };
          select: {
            id: true;
            date: true;
            categoryId: true;
            item: true;
            amount: true;
            mode: true;
            isDeleted: true;
            category: { select: { id: true; name: true } };
          };
        }) => Promise<{
          id: number;
          date: string;
          categoryId: number;
          item: string;
          amount: number;
          mode: ExpenseModeInput;
          isDeleted?: boolean;
          category: { id: number; name: string };
        } | null>;
      }
    ).findUnique({
      where: { id },
      select: {
        id: true,
        date: true,
        categoryId: true,
        item: true,
        amount: true,
        mode: true,
        isDeleted: true,
        category: { select: { id: true, name: true } },
      },
    });
    if (!existing) {
      return Response.json({ error: "Expense entry not found" }, { status: 404 });
    }
    if (existing.isDeleted) {
      return Response.json({ ok: true }, { status: 200 });
    }

    const beforeSnapshot: ExpenseSnapshot = {
      date: existing.date,
      categoryId: existing.categoryId,
      categoryName: existing.category.name,
      item: existing.item,
      amount: Math.round(existing.amount),
      mode: existing.mode,
      isDeleted: false,
    };

    await (
      entryModel as {
        update: (args: {
          where: { id: number };
          data: { isDeleted: true; deletedAt: Date; deletedBy: number };
        }) => Promise<unknown>;
      }
    ).update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: actor.id,
      },
    });

    const afterSnapshot = { ...beforeSnapshot, isDeleted: true };
    if (eventModel) {
      await (
        eventModel as {
          create: (args: {
            data: {
              entryId: number;
              action: string;
              changedFields: unknown;
              beforeData: unknown;
              afterData: unknown;
              changedBy: number;
              changedByName: string;
            };
          }) => Promise<unknown>;
        }
      ).create({
        data: {
          entryId: id,
          action: "delete",
          changedFields: buildDiffEntries(beforeSnapshot, afterSnapshot),
          beforeData: beforeSnapshot,
          afterData: afterSnapshot,
          changedBy: actor.id,
          changedByName: actor.name,
        },
      });
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const notFound = message.includes("Record to update not found");
    const status = notFound ? 404 : message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: notFound ? "Expense entry not found" : message }, { status });
  }
}
