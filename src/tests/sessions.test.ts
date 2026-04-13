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

  it("should reject ending session when duration is 0 minutes", async () => {
    const now = new Date("2026-04-12T10:00:20.000Z");
    const startTime = new Date("2026-04-12T10:00:00.000Z");

    const findFirst = vi.fn().mockResolvedValue({
      id: 77,
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

    const update = vi.fn();

    const prisma = {
      sessions: {
        findFirst,
        update,
      },
      tables: {
        findUnique,
      },
    };

    await expect(
      sessionService.endSession(prisma as never, {
        tableId: 7,
        now,
      }),
    ).rejects.toThrow("Cannot end session with 0 minutes");

    expect(update).not.toHaveBeenCalled();
  });

  it("should reject running override fields other than start time or rate", async () => {
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
    ).rejects.toThrow("Running overrides allow only start time, rate, or payer details");

    expect(createBill).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("should support completed override for start/end/rate updates", async () => {
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
      overrideRatePerMin: 8,
      overrideEndTime: new Date("2026-04-12T10:40:00.000Z"),
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({
          overrideRatePerMin: 8,
          overrideEndTime: new Date("2026-04-12T10:40:00.000Z"),
        }),
      }),
    );
  });

  it("should support running override payer details", async () => {
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 13,
          tableId: 1,
          status: "running",
          startTime: new Date("2026-04-12T10:00:00.000Z"),
          endTime: null,
          payerMode: "none",
          payerData: null,
          billId: null,
        }),
        update: vi.fn().mockResolvedValue({ id: 13, overridePayerMode: "single" }),
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
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      sessionService.overrideSession(prisma as never, {
        sessionId: 13,
        overridePayerMode: "single",
        overridePayerData: { name: "Saif" },
      }),
    ).resolves.toBeDefined();
  });

  it("should reject completed override status changes", async () => {
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 12,
          tableId: 1,
          status: "completed",
          startTime: new Date("2026-04-12T10:00:00.000Z"),
          endTime: new Date("2026-04-12T10:30:00.000Z"),
          payerMode: "single",
          payerData: { name: "A" },
          billId: null,
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
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      sessionService.overrideSession(prisma as never, {
        sessionId: 12,
        overrideStatus: "running",
      }),
    ).rejects.toThrow("Completed overrides allow start time, end time, rate, or payer details");
  });

  it("should move billed session back to unbilled", async () => {
    const findUniqueSession = vi.fn().mockResolvedValue({
      id: 31,
      tableId: 1,
      status: "billed",
      startTime: new Date("2026-04-12T10:00:00.000Z"),
      endTime: new Date("2026-04-12T10:30:00.000Z"),
      payerMode: "single",
      payerData: { name: "A" },
      billId: 77,
    });
    const findUniqueTable = vi.fn().mockResolvedValue({
      id: 1,
      name: "S1",
      ratePerMin: 10,
    });
    const update = vi.fn().mockResolvedValue({ id: 31, billId: null, status: "completed" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const deleteBill = vi.fn().mockResolvedValue({ id: 77 });

    const prisma = {
      sessions: {
        findUnique: findUniqueSession,
        update,
        updateMany,
      },
      tables: {
        findUnique: findUniqueTable,
      },
      bills: {
        create: vi.fn(),
        delete: deleteBill,
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany,
      },
    };

    await sessionService.overrideSession(prisma as never, {
      sessionId: 31,
      overrideStatus: "completed",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 31 },
        data: expect.objectContaining({
          status: "completed",
          overrideStatus: "completed",
          billId: null,
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { billId: 77 },
      data: {
        billId: null,
        status: "completed",
        overrideStatus: null,
      },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { billId: 77 } });
    expect(deleteBill).toHaveBeenCalledWith({ where: { id: 77 } });
  });

  it("should create override history event when override updates session", async () => {
    const findUniqueSession = vi.fn().mockResolvedValue({
      id: 41,
      tableId: 1,
      status: "completed",
      startTime: new Date("2026-04-12T10:00:00.000Z"),
      endTime: new Date("2026-04-12T10:30:00.000Z"),
      payerMode: "single",
      payerData: { name: "A" },
      billId: null,
      amount: 300,
    });
    const findUniqueTable = vi.fn().mockResolvedValue({
      id: 1,
      name: "S1",
      ratePerMin: 10,
    });
    const update = vi.fn().mockResolvedValue({
      id: 41,
      status: "completed",
      billId: null,
      amount: 280,
      overrideRatePerMin: 8,
      overrideStatus: null,
      overrideStartTime: null,
      overrideEndTime: null,
      overridePayerMode: null,
      overridePayerData: null,
      overridePaymentModes: null,
    });
    const createHistory = vi.fn().mockResolvedValue({ id: 1 });

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
      payments: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sessionOverrideEvents: {
        create: createHistory,
      },
    };

    await sessionService.overrideSession(prisma as never, {
      sessionId: 41,
      overrideRatePerMin: 8,
    });

    expect(createHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 41,
          action: "override_update",
        }),
      }),
    );
  });

  it("should return override history with timestamps", async () => {
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 55,
          startTime: null,
          endTime: null,
          status: "running",
          billId: null,
          amount: 0,
        }),
      },
      sessionOverrideEvents: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1,
            action: "override_update",
            changedFields: ["overrideRatePerMin"],
            beforeData: { overrideRatePerMin: null },
            afterData: { overrideRatePerMin: 8 },
            createdAt: new Date("2026-04-12T12:00:00.000Z"),
          },
        ]),
      },
    };

    const result = await sessionService.getSessionOverrideHistory(prisma as never, {
      sessionId: 55,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      action: "override_update",
      actionLabel: "Override Updated",
      changedBy: "System",
      diffs: [{ field: "overrideRatePerMin", before: null, after: 8 }],
    });
    expect(result[0].createdAt).toBeInstanceOf(Date);
  });

  it("should block paid session from moving to unbilled", async () => {
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
        findMany: vi.fn().mockResolvedValue([
          { amount: 10 },
        ]),
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
        findUnique: vi.fn().mockResolvedValue({
          id: 50,
          totalAmount: 10,
          discountedAmount: 10,
          discountType: null,
        }),
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
    ).rejects.toThrow("Paid session can only be moved back to billed");
  });

  it("should move paid session back to billed and clear payments", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
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
        findMany: vi.fn().mockResolvedValue([
          { amount: 140 },
        ]),
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
        findUnique: vi.fn().mockResolvedValue({
          id: 51,
          totalAmount: 140,
          discountedAmount: 140,
          discountType: null,
        }),
        create: vi.fn(),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, billId: 51, amount: 120, mode: "cash" },
          { id: 2, billId: 51, amount: 20, mode: "upi" },
        ]),
        deleteMany,
      },
    };

    await expect(
      sessionService.overrideSession(basePrisma as never, {
        sessionId: 21,
        overrideStatus: "billed",
      }),
    ).resolves.toBeDefined();

    expect(deleteMany).toHaveBeenCalledWith({ where: { billId: 51 } });
  });
});
