import type { PrismaClient, Session, Table } from "@prisma/client";
import { getEffectiveStatus, getTableStatus } from "@/lib/session-status";

export type CreateTableInput = {
  name: string;
  ratePerMin: number;
};

export type DashboardTable = {
  id: number;
  name: string;
  ratePerMin: number;
  currentSession?: {
    id: number;
    playerName: string;
    startTime: Date;
    status: "running" | "completed" | "billed";
    payerMode: "none" | "single" | "split";
    payerData: unknown;
  };
  state:
    | "Free"
    | "Running-NoPayer"
    | "Running-Single"
    | "Running-Split"
    | "Completed (Unbilled)"
    | "Billed";
};

export async function createTable(
  prisma: PrismaClient,
  input: CreateTableInput,
): Promise<Table> {
  const name = input.name.trim();

  if (!name) {
    throw new Error("name is required");
  }

  if (input.ratePerMin <= 0) {
    throw new Error("ratePerMin must be greater than 0");
  }

  const existing = await prisma.table.findUnique({ where: { name } });
  if (existing) {
    throw new Error("Table name already exists");
  }

  return prisma.table.create({
    data: {
      name,
      ratePerMin: input.ratePerMin,
    },
  });
}

export async function listTablesWithState(
  prisma: PrismaClient,
): Promise<DashboardTable[]> {
  const tables = await prisma.table.findMany({
    orderBy: { id: "asc" },
    include: {
      sessions: {
        orderBy: { startTime: "desc" },
        take: 1,
      },
    },
  });

  return tables.map((row) => ({
    id: row.id,
    name: row.name,
    ratePerMin: row.ratePerMin,
    currentSession: row.sessions[0]
      ? {
          id: row.sessions[0].id,
          playerName: row.sessions[0].playerName,
          startTime: row.sessions[0].startTime,
          status: getEffectiveSessionStatus(row.sessions[0]),
          payerMode: getEffectivePayerMode(row.sessions[0]),
          payerData: getEffectivePayerData(row.sessions[0]),
        }
      : undefined,
    state: deriveTableState(row.sessions[0]),
  }));
}

function getEffectivePayerMode(
  session: Session,
): "none" | "single" | "split" {
  const mode = session.overridePayerMode ?? session.payerMode;
  if (mode === "single" || mode === "split" || mode === "none") {
    return mode;
  }
  return "none";
}

function getEffectivePayerData(session: Session): unknown {
  return session.overridePayerData ?? session.payerData;
}

function getEffectiveSessionStatus(
  session: Session,
): "running" | "completed" | "billed" {
  return getEffectiveStatus({
    status: session.status,
    overrideStatus: session.overrideStatus,
  });
}

function deriveTableState(
  latestSession: Session | undefined,
): DashboardTable["state"] {
  if (!latestSession) {
    return "Free";
  }

  return getTableStatus({
    effectiveStatus: getEffectiveSessionStatus(latestSession),
    billId: latestSession.billId,
    payerMode: getEffectivePayerMode(latestSession),
  });
}
