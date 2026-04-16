import { describe, expect, it, vi } from "vitest";
import { billingService } from "@/lib/services/billingService";

describe("Billing module", () => {
  it("should create bill from unbilled non-running sessions", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 1,
        amount: 100,
        status: "completed",
        startTime: new Date("2026-04-12T10:00:00.000Z"),
        endTime: new Date("2026-04-12T10:10:00.000Z"),
        table: { ratePerMin: 10, name: "S1" },
      },
      {
        id: 2,
        amount: 200,
        status: "completed",
        startTime: new Date("2026-04-12T10:00:00.000Z"),
        endTime: new Date("2026-04-12T10:20:00.000Z"),
        table: { ratePerMin: 10, name: "S1" },
      },
    ]);

    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const create = vi.fn().mockResolvedValue({
      id: 10,
      totalAmount: 300,
      discountedAmount: 300,
      discountType: null,
      discountValue: null,
    });

    const prisma = {
      sessions: {
        findMany,
        updateMany,
      },
      bills: {
        create,
      },
    };

    const result = await billingService.createBill(prisma as never, {
      sessionIds: [1, 2],
    });

    expect(result).toBeDefined();
    expect(create).toHaveBeenCalledWith({
      data: {
        totalAmount: 300,
        discountType: null,
        discountValue: null,
        discountedAmount: 300,
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { status: "billed", billId: 10 },
    });
  });

  it("should reject fixed discount exceeding remaining amount", async () => {
    const prisma = {
      bills: {
        findUnique: vi.fn().mockResolvedValue({ id: 1, totalAmount: 500 }),
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue([{ outcome: "NORMAL" }]),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([{ amount: 450 }]),
      },
    };

    await expect(
      billingService.applyDiscount(prisma as never, {
        billId: 1,
        discountType: "fixed",
        discountValue: 100,
      }),
    ).rejects.toThrow("Discount exceeds remaining amount");
  });

  it("should reject discount when bill has LTP sessions", async () => {
    const prisma = {
      bills: {
        findUnique: vi.fn().mockResolvedValue({ id: 1, totalAmount: 500 }),
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue([{ outcome: "LTP_LOSS" }]),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      billingService.applyDiscount(prisma as never, {
        billId: 1,
        discountType: "fixed",
        discountValue: 10,
      }),
    ).rejects.toThrow("Cannot apply discount to non-billable sessions");
  });
});
