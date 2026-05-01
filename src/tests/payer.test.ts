import { describe, expect, it, vi } from "vitest";
import { payerService } from "@/lib/services/payerService";

describe("Payer system module", () => {
  it("should assign single payer to a running session", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 21,
      tableId: 7,
      status: "running",
      payerMode: "none",
      payerData: null,
    });

    const update = vi.fn().mockResolvedValue({
      id: 21,
      tableId: 7,
      status: "running",
      payerMode: "single",
      payerData: { name: "Arjun" },
    });

    const prisma = {
      sessions: {
        findUnique,
        update,
      },
    };

    const result = await payerService.assignPayer(prisma as never, {
      sessionId: 21,
      payerMode: "single",
      payerData: { name: "Arjun" },
    });

    expect(result).toBeDefined();
    expect(result.payerMode).toBe("single");
    expect(result.payerData).toEqual({ name: "Arjun" });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 21 },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: {
        payerMode: "single",
        payerData: { name: "Arjun" },
      },
    });
  });

  it("should validate split payer percentages sum to 100", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 21,
      tableId: 7,
      status: "running",
      payerMode: "none",
      payerData: null,
    });

    const update = vi.fn().mockImplementation(({ data }: { data: { payerMode: string; payerData: unknown } }) =>
      Promise.resolve({
        id: 21,
        tableId: 7,
        status: "running",
        payerMode: data.payerMode,
        payerData: data.payerData,
      }),
    );

    const prisma = {
      sessions: {
        findUnique,
        update,
      },
    };

    await expect(
      payerService.assignPayer(prisma as never, {
        sessionId: 21,
        payerMode: "split",
        payerData: [
          { name: "A", percentage: 50 },
          { name: "B", percentage: 40 },
        ],
      }),
    ).rejects.toThrow("Invalid split percentage");

    expect(update).not.toHaveBeenCalled();

    const result = await payerService.assignPayer(prisma as never, {
      sessionId: 21,
      payerMode: "split",
      payerData: [
        { name: "A", percentage: 50 },
        { name: "B", percentage: 50 },
      ],
    });

    expect(result.payerMode).toBe("split");
    expect(result.payerData).toEqual([
      { name: "A", percentage: 50 },
      { name: "B", percentage: 50 },
    ]);

    expect(update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: {
        payerMode: "split",
        payerData: [
          { name: "A", percentage: 50 },
          { name: "B", percentage: 50 },
        ],
      },
    });
  });

  it("should reject when session is not found", async () => {
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };

    await expect(
      payerService.assignPayer(prisma as never, {
        sessionId: 999,
        payerMode: "single",
        payerData: { name: "A" },
      }),
    ).rejects.toThrow("Session not found");
  });

  it("should reject when session is not running", async () => {
    const update = vi.fn();
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 31,
          status: "completed",
        }),
        update,
      },
    };

    await expect(
      payerService.assignPayer(prisma as never, {
        sessionId: 31,
        payerMode: "single",
        payerData: { name: "A" },
      }),
    ).rejects.toThrow("Session not running");

    expect(update).not.toHaveBeenCalled();
  });

  it("should reject split mode with non-array payerData", async () => {
    const update = vi.fn();
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 22,
          status: "running",
        }),
        update,
      },
    };

    await expect(
      payerService.assignPayer(prisma as never, {
        sessionId: 22,
        payerMode: "split",
        payerData: { name: "A", percentage: 100 },
      }),
    ).rejects.toThrow("Invalid split percentage");

    expect(update).not.toHaveBeenCalled();
  });

  it("should reject split mode with non-number percentage", async () => {
    const update = vi.fn();
    const prisma = {
      sessions: {
        findUnique: vi.fn().mockResolvedValue({
          id: 23,
          status: "running",
        }),
        update,
      },
    };

    await expect(
      payerService.assignPayer(prisma as never, {
        sessionId: 23,
        payerMode: "split",
        payerData: [{ name: "A", percentage: "100" }],
      }),
    ).rejects.toThrow("Invalid split percentage");

    expect(update).not.toHaveBeenCalled();
  });
});
