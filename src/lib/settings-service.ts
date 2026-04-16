import type { PrismaClient } from "@prisma/client";

export const DEFAULT_LEDGER_RESET_MINUTES = 10 * 60;

let ledgerResetMinutesCache: number = DEFAULT_LEDGER_RESET_MINUTES;
let hasHydratedCache = false;

function normalizeLedgerResetMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Invalid ledger reset time");
  }
  const rounded = Math.floor(value);
  if (rounded < 0 || rounded > 23 * 60 + 59) {
    throw new Error("Invalid ledger reset time");
  }
  return rounded;
}

type AppConfigRow = {
  id: number;
  ledgerResetMinutes?: number;
  updatedAt?: Date;
};

export function getLedgerResetMinutesCached(): number {
  return ledgerResetMinutesCache;
}

export async function hydrateLedgerResetMinutesCache(prisma: PrismaClient): Promise<number> {
  if (hasHydratedCache) {
    return ledgerResetMinutesCache;
  }
  const model = (prisma as { appConfig?: unknown }).appConfig;
  if (!model) {
    hasHydratedCache = true;
    return ledgerResetMinutesCache;
  }
  const row = await (
    model as {
      findFirst: () => Promise<AppConfigRow | null>;
    }
  ).findFirst();
  if (row && typeof row.ledgerResetMinutes === "number") {
    ledgerResetMinutesCache = normalizeLedgerResetMinutes(row.ledgerResetMinutes);
  }
  hasHydratedCache = true;
  return ledgerResetMinutesCache;
}

export async function getLedgerResetMinutes(prisma: PrismaClient): Promise<number> {
  await hydrateLedgerResetMinutesCache(prisma);
  return ledgerResetMinutesCache;
}

export async function setLedgerResetMinutes(prisma: PrismaClient, minutes: number): Promise<number> {
  const nextValue = normalizeLedgerResetMinutes(minutes);
  const model = (prisma as { appConfig?: unknown }).appConfig;
  if (!model) {
    throw new Error("Settings model is not available. Run prisma generate and db push.");
  }
  const existing = await (
    model as {
      findFirst: () => Promise<AppConfigRow | null>;
    }
  ).findFirst();
  if (existing) {
    await (
      model as {
        update: (args: { where: { id: number }; data: { ledgerResetMinutes: number } }) => Promise<unknown>;
      }
    ).update({
      where: { id: existing.id },
      data: { ledgerResetMinutes: nextValue },
    });
  } else {
    await (
      model as {
        create: (args: { data: { ledgerResetMinutes: number } }) => Promise<unknown>;
      }
    ).create({
      data: { ledgerResetMinutes: nextValue },
    });
  }
  ledgerResetMinutesCache = nextValue;
  hasHydratedCache = true;
  return ledgerResetMinutesCache;
}
