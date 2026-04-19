import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toDateKeyLocal(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(base: Date, offset: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + offset);
  return next;
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function ensureDefaultCategories(): Promise<number[]> {
  const defaults = [
    "Maintenance",
    "Staff Refreshments",
    "Utilities",
    "Supplies",
    "Cleaning",
    "Miscellaneous",
  ];

  const ids: number[] = [];
  for (const name of defaults) {
    const existing = await prisma.expenseCategory.findUnique({
      where: { name },
      select: { id: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) {
        await prisma.expenseCategory.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
      }
      ids.push(existing.id);
      continue;
    }
    const created = await prisma.expenseCategory.create({
      data: { name, isActive: true },
      select: { id: true },
    });
    ids.push(created.id);
  }
  return ids;
}

async function main() {
  const activeUser = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });

  if (!activeUser) {
    throw new Error("No active user found. Create at least one active user before expense backfill.");
  }

  const categoryIds = await ensureDefaultCategories();
  const today = new Date();
  const daysToSeed = 30;
  let inserted = 0;
  let skipped = 0;

  for (let offset = -(daysToSeed - 1); offset <= 0; offset += 1) {
    const dateKey = toDateKeyLocal(addDays(today, offset));
    const existingCount = await prisma.expenseEntry.count({
      where: { date: dateKey },
    });
    if (existingCount > 0) {
      skipped += 1;
      continue;
    }

    const rand = seededRandom(hashSeed(dateKey));
    const entryCount = 2 + Math.floor(rand() * 4); // 2..5 entries/day
    const rows: Array<{
      date: string;
      categoryId: number;
      item: string;
      amount: number;
      mode: "cash" | "bank";
      createdBy: number;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    for (let index = 0; index < entryCount; index += 1) {
      const categoryId = categoryIds[Math.floor(rand() * categoryIds.length)];
      const mode: "cash" | "bank" = rand() < 0.72 ? "cash" : "bank";
      const base = mode === "cash" ? 120 : 180;
      const spread = mode === "cash" ? 420 : 680;
      const amount = Math.round(base + rand() * spread);
      const minuteOffset = Math.floor(rand() * 600); // first 10 hours
      const createdAt = new Date(`${dateKey}T10:00:00`);
      createdAt.setMinutes(createdAt.getMinutes() + minuteOffset);

      rows.push({
        date: dateKey,
        categoryId,
        item: `Backfill expense ${index + 1}`,
        amount,
        mode,
        createdBy: activeUser.id,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await prisma.expenseEntry.createMany({ data: rows });
    inserted += rows.length;
  }

  console.log(
    `Expense backfill complete. Inserted ${inserted} entries across ${daysToSeed - skipped} day(s), skipped ${skipped} day(s) with existing data. User: ${activeUser.name}.`,
  );
}

main()
  .catch((error) => {
    console.error("Expense backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
