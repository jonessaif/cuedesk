import { describe, expect, it, vi } from "vitest";
import { sessionService } from "@/lib/services/sessionService";

describe("Sessions module", () => {
  it("should start session successfully", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      id: 1,
      ...data,
    }));

    const prisma = {
      sessions: {
        findFirst,
        create,
      },
    };

    const result = await sessionService.startSession(prisma as never, {
      tableId: 7,
      playerName: "Arjun",
    });

    expect(result).toMatchObject({
      tableId: 7,
      playerName: "Arjun",
      status: "running",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { tableId: 7, status: "running" },
    });
  });

  it("should not allow multiple running sessions per table", async () => {
    const create = vi.fn();
    const prisma = {
      sessions: {
        findFirst: vi.fn().mockResolvedValue({
          id: 101,
          tableId: 7,
          status: "running",
        }),
        create,
      },
    };

    await expect(
      sessionService.startSession(prisma as never, {
        tableId: 7,
        playerName: "Rahul",
      }),
    ).rejects.toThrow("Session already running");

    expect(create).not.toHaveBeenCalled();
  });

  it("should end session and calculate amount correctly", async () => {
    const now = new Date("2026-04-12T10:10:00.000Z");
    const startTime = new Date("2026-04-12T10:00:00.000Z");

    const findFirst = vi.fn().mockResolvedValue({
      id: 55,
      tableId: 7,
      playerName: "Arjun",
      status: "running",
      startTime,
    });

    const findUnique = vi.fn().mockResolvedValue({
      id: 7,
      name: "S1",
      ratePerMin: 10,
    });

    const update = vi.fn().mockResolvedValue({
      id: 55,
      tableId: 7,
      status: "completed",
      amount: 100,
      endTime: now,
    });

    const prisma = {
      sessions: {
        findFirst,
        update,
      },
      tables: {
        findUnique,
      },
    };

    const result = await sessionService.endSession(prisma as never, {
      tableId: 7,
      now,
    });

    expect(result).toMatchObject({
      status: "completed",
      amount: 100,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tableId: 7,
        OR: [{ status: "running" }, { overrideStatus: "running" }],
      },
      orderBy: { startTime: "desc" },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
    });
  });

  it("should end session when effective status is running via override", async () => {
    const now = new Date("2026-04-12T10:10:00.000Z");
    const findFirst = vi.fn().mockResolvedValue({
      id: 99,
      tableId: 7,
      status: "completed",
      overrideStatus: "running",
      startTime: new Date("2026-04-12T10:00:00.000Z"),
      overrideStartTime: new Date("2026-04-12T10:01:00.000Z"),
    });
    const findUnique = vi.fn().mockResolvedValue({
      id: 7,
      name: "S1",
      ratePerMin: 10,
    });
    const update = vi.fn().mockResolvedValue({
      id: 99,
      status: "completed",
      overrideStatus: null,
      amount: 90,
    });

    const prisma = {
      sessions: {
        findFirst,
        update,
      },
      tables: {
        findUnique,
      },
    };

    const result = await sessionService.endSession(prisma as never, {
      tableId: 7,
      now,
    });

    expect(result).toBeDefined();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: expect.objectContaining({
          status: "completed",
          overrideStatus: null,
          endTime: now,
        }),
      }),
    );
  });

  it("should reject forward override running to billed by state machine", async () => {
    const findUniqueSession = vi.fn().mockResolvedValue({
      id: 10,
      tableId: 1,
      status: "running",
      startTime: new Date("2026-04-12T10:00:00.000Z"),
      endTime: null,
      payerMode: "none",
      payerData: null,
      billId: null,
    });
    const findUniqueTable = vi.fn().mockResolvedValue({
      id: 1,
      name: "S1",
      ratePerMin: 10,
    });
    const createBill = vi.fn().mockResolvedValue({ id: 900 });
    const update = vi.fn().mockResolvedValue({ id: 10, billId: 900 });

    const prisma = {
      sessions: {
        findUnique: findUniqueSession,
        update,
      },
      tables: {
        findUnique: findUniqueTable,
      },
      bills: {
        create: createBill,
      },
    };

    await expect(
      sessionService.overrideSession(prisma as never, {
        sessionId: 10,
        overrideStatus: "billed",
        overrideEndTime: new Date("2026-04-12T10:30:00.000Z"),
      }),
    ).rejects.toThrow("Invalid state transition");

    expect(createBill).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("should support override completed to running", async () => {
    const findUniqueSession = vi.fn().mockResolvedValue({
      id: 11,
      tableId: 1,
      status: "completed",
      startTime: new Date("2026-04-12T10:00:00.000Z"),
      endTime: new Date("2026-04-12T10:30:00.000Z"),
      payerMode: "single",
      payerData: { name: "A" },
      billId: null,
    });
    const findUniqueTable = vi.fn().mockResolvedValue({
      id: 1,
      name: "S1",
      ratePerMin: 10,
    });
    const update = vi.fn().mockResolvedValue({ id: 11 });

    const prisma = {
      sessions: {
        findUnique: findUniqueSession,
        update,
      },
      tables: {
        findUnique: findUniqueTable,
      },
      bills: {
        create: vi.fn(),
      },
    };

    await sessionService.overrideSession(prisma as never, {
      sessionId: 11,
      overrideStatus: "running",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({
          overrideStatus: "running",
          overrideEndTime: null,
        }),
      }),
    );
  });

  it("should block billed to completed when payments exist", async () => {
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 20,
          tableId: 1,
          status: "billed",
          startTime: new Date("2026-04-12T10:00:00.000Z"),
          endTime: new Date("2026-04-12T10:30:00.000Z"),
          payerMode: "single",
          payerData: { name: "A" },
          billId: 50,
        }),
        update: vi.fn(),
      },
      tables: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1,
          name: "S1",
          ratePerMin: 10,
        }),
      },
      bills: {
        create: vi.fn(),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([{ amount: 10 }]),
      },
    };

    await expect(
      sessionService.overrideSession(prisma as never, {
        sessionId: 20,
        overrideStatus: "completed",
      }),
    ).rejects.toThrow("Cannot move billed session to completed when payments exist");
  });

  it("should require admin override for paid to billed", async () => {
    const basePrisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 21,
          tableId: 1,
          status: "billed",
          startTime: new Date("2026-04-12T10:00:00.000Z"),
          endTime: new Date("2026-04-12T10:30:00.000Z"),
          payerMode: "single",
          payerData: { name: "A" },
          billId: 51,
        }),
        update: vi.fn().mockResolvedValue({ id: 21 }),
      },
      tables: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1,
          name: "S1",
          ratePerMin: 10,
        }),
      },
      bills: {
        create: vi.fn(),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([{ amount: 120 }]),
      },
    };

    await expect(
      sessionService.overrideSession(basePrisma as never, {
        sessionId: 21,
        overrideStatus: "billed",
      }),
    ).rejects.toThrow("Invalid state transition");

    await expect(
      sessionService.overrideSession(basePrisma as never, {
        sessionId: 21,
        overrideStatus: "billed",
        adminOverride: true,
      }),
    ).resolves.toBeDefined();
  });
});
