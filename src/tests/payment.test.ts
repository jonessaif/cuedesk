import { describe, expect, it, vi } from "vitest";
import { paymentService } from "@/lib/services/paymentService";

describe("Payments module", () => {
  it("should add single payment to a bill", async () => {
    const create = vi.fn().mockResolvedValue({
      id: 1,
      billId: 10,
      amount: 300,
      mode: "cash",
    });

    const prisma = {
      bills: {
        findUnique: vi.fn().mockResolvedValue({
          id: 10,
          totalAmount: 500,
          discountType: null,
          discountedAmount: 500,
        }),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([{ amount: 200 }]),
        create,
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await paymentService.addPayment(prisma as never, {
      billId: 10,
      amount: 300,
      mode: "cash",
    });

    expect(result).toBeDefined();
    expect(result.billId).toBe(10);
    expect(result.amount).toBe(300);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("should reject zero payment", async () => {
    const prisma = {
      bills: {
        findUnique: vi.fn().mockResolvedValue({ id: 10, totalAmount: 300 }),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      paymentService.addPayment(prisma as never, {
        billId: 10,
        amount: 0,
        mode: "cash",
      }),
    ).rejects.toThrow("Invalid payment amount");
  });

  it("should reject payment if it exceeds remaining bill amount", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 10,
      totalAmount: 300,
    });
    const findMany = vi.fn().mockResolvedValue([{ amount: 200 }]);
    const create = vi.fn();

    const prisma = {
      bills: {
        findUnique,
      },
      payments: {
        findMany,
        create,
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      paymentService.addPayment(prisma as never, {
        billId: 10,
        amount: 150,
        mode: "cash",
      }),
    ).rejects.toThrow("Payment exceeds bill amount");

    expect(create).not.toHaveBeenCalled();
  });

  it("should allow partial and exact payments within bill total", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 2, billId: 10, amount: 150, mode: "cash" })
      .mockResolvedValueOnce({ id: 3, billId: 10, amount: 200, mode: "cash" });

    const prisma = {
      bills: {
        findUnique: vi.fn().mockResolvedValue({
          id: 10,
          totalAmount: 300,
        }),
      },
      payments: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ amount: 100 }])
          .mockResolvedValueOnce([{ amount: 100 }]),
        create,
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const partialResult = await paymentService.addPayment(prisma as never, {
      billId: 10,
      amount: 150,
      mode: "cash",
    });
    expect(partialResult.amount).toBe(150);

    const exactResult = await paymentService.addPayment(prisma as never, {
      billId: 10,
      amount: 200,
      mode: "cash",
    });
    expect(exactResult.amount).toBe(200);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("should reject when bill is missing", async () => {
    const prisma = {
      bills: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      paymentService.addPayment(prisma as never, {
        billId: 999,
        amount: 50,
        mode: "cash",
      }),
    ).rejects.toThrow("Bill not found");
  });
});
