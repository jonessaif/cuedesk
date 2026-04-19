import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type ExpenseModeInput = "cash" | "bank";

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const model = (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntry
      ?? (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntries;
    if (!model) {
      return Response.json({ data: [], summary: { cash: 0, bank: 0, total: 0 } }, { status: 200 });
    }

    const { searchParams } = new URL(request.url);
    const date = String(searchParams.get("date") ?? "");
    const from = String(searchParams.get("from") ?? "");
    const to = String(searchParams.get("to") ?? "");
    const categoryIdsRaw = String(searchParams.get("categoryIds") ?? "").trim();
    const categoryIds = categoryIdsRaw
      ? categoryIdsRaw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isInteger(id) && id > 0)
      : [];

    const hasDate = isDateKey(date);
    const hasRange = isDateKey(from) && isDateKey(to);
    if (!hasDate && !hasRange) {
      return Response.json({ error: "Provide either date or from/to in YYYY-MM-DD format" }, { status: 400 });
    }

    const rows = await (
      model as {
        findMany: (args: {
          where: {
            date?: string;
            AND?: Array<{ date: { gte: string; lte: string } } | { categoryId: { in: number[] } }>;
          };
          orderBy: Array<{ createdAt: "desc" }>;
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
        }) => Promise<Array<{
          id: number;
          date: string;
          item: string;
          amount: number;
          mode: ExpenseModeInput;
          createdAt: Date;
          category: { id: number; name: string };
          user: { id: number; name: string };
        }>>;
      }
    ).findMany({
      where: hasDate
        ? {
          date,
          ...(categoryIds.length > 0 ? { AND: [{ categoryId: { in: categoryIds } }] } : {}),
        }
        : {
          AND: [
            { date: { gte: from, lte: to } },
            ...(categoryIds.length > 0 ? [{ categoryId: { in: categoryIds } }] : []),
          ],
        },
      orderBy: [{ createdAt: "desc" }],
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

    const cash = Math.round(rows.filter((row) => row.mode === "cash").reduce((sum, row) => sum + row.amount, 0));
    const bank = Math.round(rows.filter((row) => row.mode === "bank").reduce((sum, row) => sum + row.amount, 0));
    const normalizedRows = rows.map((row) => ({
        id: row.id,
        date: row.date,
        item: row.item,
        amount: Math.round(row.amount),
        mode: row.mode,
        category_id: row.category.id,
        category_name: row.category.name,
        created_by_user_id: row.user.id,
        created_by_user_name: row.user.name,
        created_at: row.createdAt,
      }));
    const categoryTotalsMap = new Map<number, { category_id: number; category_name: string; total: number }>();
    for (const row of normalizedRows) {
      const current = categoryTotalsMap.get(row.category_id);
      if (current) {
        current.total += row.amount;
      } else {
        categoryTotalsMap.set(row.category_id, {
          category_id: row.category_id,
          category_name: row.category_name,
          total: row.amount,
        });
      }
    }
    const by_category = Array.from(categoryTotalsMap.values())
      .map((row) => ({ ...row, total: Math.round(row.total) }))
      .sort((a, b) => b.total - a.total || a.category_name.localeCompare(b.category_name));

    return Response.json({
      data: normalizedRows,
      summary: { cash, bank, total: cash + bank },
      by_category,
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireOperatorOrAdmin(prisma, request);
    const entryModel = (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntry
      ?? (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntries;
    const categoryModel = (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategory
      ?? (prisma as { expenseCategory?: unknown; expenseCategories?: unknown }).expenseCategories;
    if (!entryModel || !categoryModel) {
      throw new Error("Expenses are not available. Run prisma db push and prisma generate.");
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
    if (mode !== "cash" && mode !== "bank") {
      return Response.json({ error: "Mode must be cash or bank" }, { status: 400 });
    }

    const category = await (
      categoryModel as {
        findUnique: (args: {
          where: { id: number };
          select: { id: true; name: true; isActive: true };
        }) => Promise<{ id: number; name: string; isActive: boolean } | null>;
      }
    ).findUnique({
      where: { id: categoryId },
      select: { id: true, name: true, isActive: true },
    });
    if (!category || !category.isActive) {
      return Response.json({ error: "Category not found or inactive" }, { status: 400 });
    }

    const created = await (
      entryModel as {
        create: (args: {
          data: {
            date: string;
            categoryId: number;
            item: string;
            amount: number;
            mode: ExpenseModeInput;
            createdBy: number;
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
    ).create({
      data: {
        date,
        categoryId,
        item,
        amount,
        mode,
        createdBy: actor.id,
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
        id: created.id,
        date: created.date,
        item: created.item,
        amount: Math.round(created.amount),
        mode: created.mode,
        category_id: created.category.id,
        category_name: created.category.name,
        created_by_user_id: created.user.id,
        created_by_user_name: created.user.name,
        created_at: created.createdAt,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
