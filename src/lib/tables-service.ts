import type { PrismaClient, SessionStatus, Table } from "@prisma/client";
import { getEffectiveStatus, getTableStatus } from "@/lib/session-status";

export type CreateTableInput = {
  name: string;
  ratePerMin: number;
  sectionId?: number;
};

export type UpdateTableInput = {
  id: number;
  name?: string;
  ratePerMin?: number;
  sectionId?: number | null;
};

export type DashboardTable = {
  id: number;
  name: string;
  ratePerMin: number;
  sectionId?: number | null;
  sectionName?: string | null;
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

type SessionLike = {
  id: number;
  playerName: string;
  startTime: Date;
  status: SessionStatus;
  billId: number | null;
  payerMode: "none" | "single" | "split";
  payerData: unknown;
  overridePayerMode?: string | null;
  overridePayerData?: unknown;
  overrideStatus?: string | null;
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

  const created = await prisma.table.create({
    data: {
      name,
      ratePerMin: input.ratePerMin,
    },
  });
  if (input.sectionId !== undefined) {
    await upsertTableSectionAssignment(prisma, created.id, input.sectionId);
  }
  return created;
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

  const tableIds = tables.map((row) => row.id);
  const runningSessionsRaw = tableIds.length
    ? await prisma.session.findMany({
      where: {
        tableId: { in: tableIds },
        OR: [{ status: "running" }, { overrideStatus: "running" }],
      } as unknown as Record<string, unknown>,
      orderBy: { startTime: "desc" },
    })
    : [];
  const runningSessions = runningSessionsRaw as Array<SessionLike & { tableId: number }>;

  const runningByTableId = new Map<number, SessionLike>();
  for (const session of runningSessions) {
    if (!runningByTableId.has(session.tableId)) {
      runningByTableId.set(session.tableId, session);
    }
  }
  const assignmentsModel = (prisma as { tableSectionAssignment?: unknown }).tableSectionAssignment;
  const sectionByTableId = new Map<number, { sectionId: number; sectionName: string }>();
  if (assignmentsModel && tableIds.length > 0) {
    const assignments = await (
      assignmentsModel as {
        findMany: (args: {
          where: { tableId: { in: number[] } };
          select: { tableId: true; sectionId: true; section: { select: { name: true } } };
        }) => Promise<Array<{ tableId: number; sectionId: number; section: { name: string } }>>;
      }
    ).findMany({
      where: { tableId: { in: tableIds } },
      select: { tableId: true, sectionId: true, section: { select: { name: true } } },
    });
    for (const row of assignments) {
      sectionByTableId.set(row.tableId, { sectionId: row.sectionId, sectionName: row.section.name });
    }
  }

  return tables.map((row) => {
    const selectedSession = runningByTableId.get(row.id) ?? row.sessions[0];
    const assignedSection = sectionByTableId.get(row.id);
    return {
      id: row.id,
      name: row.name,
      ratePerMin: row.ratePerMin,
      sectionId: assignedSection?.sectionId ?? null,
      sectionName: assignedSection?.sectionName ?? inferSectionNameFromTableName(row.name),
      currentSession: selectedSession
        ? {
          id: selectedSession.id,
          playerName: selectedSession.playerName,
          startTime: selectedSession.startTime,
          status: getEffectiveSessionStatus(selectedSession),
          payerMode: getEffectivePayerMode(selectedSession),
          payerData: getEffectivePayerData(selectedSession),
        }
        : undefined,
      state: deriveTableState(selectedSession),
    };
  });
}

export async function updateTable(
  prisma: PrismaClient,
  input: UpdateTableInput,
): Promise<Table> {
  const existing = await prisma.table.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new Error("Table not found");
  }

  const data: { name?: string; ratePerMin?: number } = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new Error("name is required");
    }
    const nameTaken = await prisma.table.findFirst({
      where: {
        name: trimmed,
        id: { not: input.id },
      },
    });
    if (nameTaken) {
      throw new Error("Table name already exists");
    }
    data.name = trimmed;
  }

  if (input.ratePerMin !== undefined) {
    if (input.ratePerMin <= 0) {
      throw new Error("ratePerMin must be greater than 0");
    }
    data.ratePerMin = input.ratePerMin;
  }

  if (Object.keys(data).length === 0) {
    if (input.sectionId === undefined) {
      throw new Error("No fields to update");
    }
  }

  const updated = await prisma.table.update({
    where: { id: input.id },
    data,
  });
  if (input.sectionId !== undefined) {
    if (input.sectionId === null) {
      await removeTableSectionAssignment(prisma, input.id);
    } else {
      await upsertTableSectionAssignment(prisma, input.id, input.sectionId);
    }
  }
  return updated;
}

export async function deleteTable(
  prisma: PrismaClient,
  input: { id: number },
): Promise<void> {
  const existing = await prisma.table.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new Error("Table not found");
  }

  const sessionsCount = await prisma.session.count({
    where: { tableId: input.id },
  });
  if (sessionsCount > 0) {
    throw new Error("Cannot delete table with session history");
  }

  await prisma.table.delete({
    where: { id: input.id },
  });
}

function getEffectivePayerMode(
  session: SessionLike,
): "none" | "single" | "split" {
  const mode = session.overridePayerMode ?? session.payerMode;
  if (mode === "single" || mode === "split" || mode === "none") {
    return mode;
  }
  return "none";
}

function getEffectivePayerData(session: SessionLike): unknown {
  return session.overridePayerData ?? session.payerData;
}

function getEffectiveSessionStatus(
  session: SessionLike,
): "running" | "completed" | "billed" {
  return getEffectiveStatus({
    status: session.status,
    overrideStatus: session.overrideStatus,
  });
}

function deriveTableState(
  latestSession: SessionLike | undefined,
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

function inferSectionNameFromTableName(name: string): string {
  const upper = name.trim().toUpperCase();
  if (upper === "S1" || upper === "S2" || upper === "S3") {
    return "Snooker";
  }
  if (upper === "IP" || upper === "AP") {
    return "Pool Tables";
  }
  if (upper === "PS1" || upper === "PS2") {
    return "PlayStation";
  }
  return "Other";
}

async function upsertTableSectionAssignment(
  prisma: PrismaClient,
  tableId: number,
  sectionId: number,
): Promise<void> {
  const sectionsModel = (prisma as { tableSection?: unknown }).tableSection;
  const mapModel = (prisma as { tableSectionAssignment?: unknown }).tableSectionAssignment;
  if (!sectionsModel || !mapModel) {
    throw new Error("Section model is not available. Run prisma generate and db push.");
  }
  const sectionExists = await (
    sectionsModel as {
      findUnique: (args: { where: { id: number } }) => Promise<{ id: number } | null>;
    }
  ).findUnique({ where: { id: sectionId } });
  if (!sectionExists) {
    throw new Error("Selected section not found");
  }
  const existing = await (
    mapModel as {
      findUnique: (args: { where: { tableId: number } }) => Promise<{ id: number } | null>;
    }
  ).findUnique({ where: { tableId } });
  if (existing) {
    await (
      mapModel as {
        update: (args: { where: { tableId: number }; data: { sectionId: number } }) => Promise<unknown>;
      }
    ).update({
      where: { tableId },
      data: { sectionId },
    });
    return;
  }
  await (
    mapModel as {
      create: (args: { data: { tableId: number; sectionId: number } }) => Promise<unknown>;
    }
  ).create({
    data: { tableId, sectionId },
  });
}

async function removeTableSectionAssignment(prisma: PrismaClient, tableId: number): Promise<void> {
  const mapModel = (prisma as { tableSectionAssignment?: unknown }).tableSectionAssignment;
  if (!mapModel) {
    throw new Error("Section model is not available. Run prisma generate and db push.");
  }
  const existing = await (
    mapModel as {
      findUnique: (args: { where: { tableId: number } }) => Promise<{ id: number } | null>;
    }
  ).findUnique({ where: { tableId } });
  if (!existing) {
    return;
  }
  await (
    mapModel as {
      delete: (args: { where: { tableId: number } }) => Promise<unknown>;
    }
  ).delete({ where: { tableId } });
}
