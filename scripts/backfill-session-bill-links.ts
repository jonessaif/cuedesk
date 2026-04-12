import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CandidateSession = {
  id: number;
  amount: number;
  endTime: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toCents(value: number): number {
  return Math.round(value * 100);
}

function findUniqueExactSubset(
  sessions: CandidateSession[],
  targetCents: number,
): number[] | null {
  let found: number[] | null = null;
  let ambiguous = false;

  function dfs(index: number, remaining: number, picked: number[]): void {
    if (ambiguous) {
      return;
    }

    if (remaining === 0) {
      if (found !== null) {
        ambiguous = true;
        return;
      }
      found = [...picked];
      return;
    }

    if (remaining < 0 || index >= sessions.length) {
      return;
    }

    const current = sessions[index];
    const currentCents = toCents(current.amount);

    if (currentCents <= remaining) {
      picked.push(current.id);
      dfs(index + 1, remaining - currentCents, picked);
      picked.pop();
    }

    dfs(index + 1, remaining, picked);
  }

  dfs(0, targetCents, []);

  if (ambiguous) {
    return null;
  }

  return found;
}

async function main() {
  const billedWithoutLink = await prisma.session.findMany({
    where: {
      status: "billed",
      billId: null,
      amount: { not: null },
    },
    select: {
      id: true,
      amount: true,
      endTime: true,
    },
    orderBy: {
      endTime: "desc",
    },
  });

  if (billedWithoutLink.length === 0) {
    console.log("No billed sessions with missing billId found.");
    return;
  }

  const emptyBills = await prisma.bill.findMany({
    include: {
      sessions: {
        select: { id: true },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const unlinkedBills = emptyBills.filter((bill) => bill.sessions.length === 0);

  if (unlinkedBills.length === 0) {
    console.log("No bills without linked sessions found.");
    return;
  }

  const assignedSessionIds = new Set<number>();
  const updates: Array<{ billId: number; sessionIds: number[] }> = [];

  for (const bill of unlinkedBills) {
    const targetCents = toCents(bill.totalAmount);

    const candidates = billedWithoutLink
      .filter((session) => {
        if (assignedSessionIds.has(session.id)) {
          return false;
        }

        if (session.amount === null) {
          return false;
        }

        if (toCents(session.amount) > targetCents) {
          return false;
        }

        if (!session.endTime) {
          return false;
        }

        const diff = bill.createdAt.getTime() - session.endTime.getTime();
        return diff >= 0 && diff <= DAY_MS;
      })
      .slice(0, 14)
      .map((session) => ({
        id: session.id,
        amount: session.amount ?? 0,
        endTime: session.endTime,
      }));

    if (candidates.length === 0) {
      continue;
    }

    const matchedIds = findUniqueExactSubset(candidates, targetCents);
    if (!matchedIds || matchedIds.length === 0) {
      continue;
    }

    updates.push({ billId: bill.id, sessionIds: matchedIds });
    matchedIds.forEach((id) => assignedSessionIds.add(id));
  }

  if (updates.length === 0) {
    console.log("No safe backfill matches found.");
    return;
  }

  await prisma.$transaction(
    updates.map((entry) =>
      prisma.session.updateMany({
        where: {
          id: { in: entry.sessionIds },
          billId: null,
          status: "billed",
        },
        data: {
          billId: entry.billId,
        },
      }),
    ),
  );

  const linkedRows = updates.reduce((sum, entry) => sum + entry.sessionIds.length, 0);

  console.log(`Backfill complete. Linked ${linkedRows} session rows across ${updates.length} bills.`);
  for (const entry of updates) {
    console.log(`- Bill #${entry.billId} <- sessions [${entry.sessionIds.join(", ")}]`);
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
