import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createTable, listTablesWithState } from "@/lib/tables-service";

type SessionStatus = "running" | "completed" | "billed";
type PayerMode = "none" | "single" | "split";

type SessionRow = {
  id: number;
  tableId: number;
  playerName: string;
  payerMode: PayerMode;
  payerData: unknown;
  startTime: Date;
  endTime: Date | null;
  status: SessionStatus;
  amount: number | null;
  billId: number | null;
};

type TableRow = {
  id: number;
  name: string;
  ratePerMin: number;
  sessions: SessionRow[];
};

function createPrismaMock(seedTables: TableRow[] = []): PrismaClient {
  const tables = seedTables.map((t) => ({ ...t, sessions: [...t.sessions] }));

  return {
    table: {
      findUnique: async ({ where }: { where: { name: string } }) =>
        tables.find((t) => t.name === where.name) ?? null,
      create: async ({ data }: { data: { name: string; ratePerMin: number } }) => {
        const created: TableRow = {
          id: tables.length + 1,
          name: data.name,
          ratePerMin: data.ratePerMin,
          sessions: [],
        };

        tables.push(created);
        return created;
      },
      findMany: async () =>
        tables
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((t) => ({
            ...t,
            sessions: t.sessions
              .slice()
              .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
              .slice(0, 1),
          })),
    },
    session: {
      findMany: async ({
        where,
      }: {
        where: {
          tableId: { in: number[] };
          OR: Array<{ status: SessionStatus } | { overrideStatus: SessionStatus }>;
        };
      }) => {
        const ids = new Set(where.tableId.in);
        return tables
          .flatMap((t) => t.sessions)
          .filter((s) => ids.has(s.tableId) && s.status === "running")
          .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
          .map((s) => ({
            id: s.id,
            tableId: s.tableId,
            playerName: s.playerName,
            startTime: s.startTime,
            status: s.status,
            billId: s.billId,
            payerMode: s.payerMode,
            payerData: s.payerData,
            overridePayerMode: null,
            overridePayerData: null,
            overrideStatus: null,
          }));
      },
    },
  } as unknown as PrismaClient;
}

describe("Tables module", () => {
  it("should create table successfully", async () => {
    const prisma = createPrismaMock();

    const created = await createTable(prisma, {
      name: "Table 1",
      ratePerMin: 15,
    });

    expect(created.name).toBe("Table 1");
    expect(created.ratePerMin).toBe(15);
  });

  it("should reject duplicate table name", async () => {
    const prisma = createPrismaMock([
      {
        id: 1,
        name: "Table A",
        ratePerMin: 12,
        sessions: [],
      },
    ]);

    await expect(
      createTable(prisma, { name: "Table A", ratePerMin: 10 }),
    ).rejects.toThrow("Table name already exists");
  });

  it("should reject non-positive rate per minute", async () => {
    const prisma = createPrismaMock();

    await expect(
      createTable(prisma, { name: "Table B", ratePerMin: 0 }),
    ).rejects.toThrow("ratePerMin must be greater than 0");
  });

  it("should list all tables with rate and derived dashboard state", async () => {
    const now = new Date();
    const prisma = createPrismaMock([
      {
        id: 1,
        name: "Table 1",
        ratePerMin: 10,
        sessions: [
          {
            id: 1,
            tableId: 1,
            playerName: "A",
            payerMode: "none",
            payerData: null,
            startTime: new Date(now.getTime() - 30_000),
            endTime: null,
            status: "running",
            amount: null,
            billId: null,
          },
        ],
      },
      {
        id: 2,
        name: "Table 2",
        ratePerMin: 15,
        sessions: [
          {
            id: 2,
            tableId: 2,
            playerName: "B",
            payerMode: "split",
            payerData: [
              { name: "B1", percentage: 50 },
              { name: "B2", percentage: 50 },
            ],
            startTime: new Date(now.getTime() - 60_000),
            endTime: null,
            status: "running",
            amount: null,
            billId: null,
          },
        ],
      },
      {
        id: 3,
        name: "Table 3",
        ratePerMin: 20,
        sessions: [
          {
            id: 3,
            tableId: 3,
            playerName: "C",
            payerMode: "single",
            payerData: { name: "C" },
            startTime: new Date(now.getTime() - 120_000),
            endTime: new Date(now.getTime() - 10_000),
            status: "completed",
            amount: 40,
            billId: null,
          },
        ],
      },
    ]);

    const rows = await listTablesWithState(prisma);

    expect(rows).toEqual([
      expect.objectContaining({ name: "Table 1", state: "Running-NoPayer" }),
      expect.objectContaining({ name: "Table 2", state: "Running-Split" }),
      expect.objectContaining({ name: "Table 3", state: "Completed (Unbilled)" }),
    ]);
  });

  it("should derive billed table state from billId even when status is completed", async () => {
    const now = new Date();
    const prisma = createPrismaMock([
      {
        id: 1,
        name: "Table 1",
        ratePerMin: 10,
        sessions: [
          {
            id: 1,
            tableId: 1,
            playerName: "A",
            payerMode: "single",
            payerData: { name: "A" },
            startTime: new Date(now.getTime() - 120_000),
            endTime: new Date(now.getTime() - 10_000),
            status: "completed",
            amount: 40,
            billId: 90,
          },
        ],
      },
    ]);

    const rows = await listTablesWithState(prisma);
    expect(rows[0].state).toBe("Billed");
  });

  it("should prioritize running session even when latest by time is completed", async () => {
    const now = new Date("2026-04-15T12:00:00.000Z");
    const prisma = createPrismaMock([
      {
        id: 1,
        name: "S1",
        ratePerMin: 6,
        sessions: [
          {
            id: 101,
            tableId: 1,
            playerName: "Older Running",
            payerMode: "none",
            payerData: null,
            startTime: new Date("2026-04-15T08:00:00.000Z"),
            endTime: null,
            status: "running",
            amount: null,
            billId: null,
          },
          {
            id: 102,
            tableId: 1,
            playerName: "Newer Completed",
            payerMode: "single",
            payerData: { name: "A" },
            startTime: new Date(now.getTime() - 60_000),
            endTime: now,
            status: "completed",
            amount: 6,
            billId: null,
          },
        ],
      },
    ]);

    const rows = await listTablesWithState(prisma);
    expect(rows[0].state).toBe("Running-NoPayer");
    expect(rows[0].currentSession?.playerName).toBe("Older Running");
  });
});
