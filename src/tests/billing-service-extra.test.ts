import { describe, expect, it, vi } from "vitest";

import { billingService } from "@/lib/services/billingService";

describe("billingService extra coverage", () => {
  it("createBill rejects when no eligible sessions", async () => {
    const prisma = {
      session: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      bill: {
        create: vi.fn(),
      },
    };
    await expect(
      billingService.createBill(prisma as never, { sessionIds: [1] }),
    ).rejects.toThrow("No unbilled sessions to bill");
  });

  it("createBill handles single payer identity and PS hourly amount", async () => {
    const create = vi.fn().mockResolvedValue({ id: 10, totalAmount: 120, discountedAmount: 120 });
    const updateMany = vi.fn().mockResolvedValue({});
    const resolveCustomerByPayerName = vi.fn().mockResolvedValue({ id: 42 });
    const prisma = {
      session: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1,
            amount: 0,
            startTime: new Date("2026-04-20T10:00:00.000Z"),
            endTime: new Date("2026-04-20T10:20:00.000Z"),
            overrideStartTime: null,
            overrideEndTime: null,
            overrideRatePerMin: null,
            playerName: "John",
            payerMode: "single",
            payerData: { name: "John" },
            overridePayerMode: null,
            overridePayerData: null,
            table: { ratePerMin: 1, name: "PS1" },
          },
        ]),
        updateMany,
      },
      bill: {
        create,
      },
      customer: {
        findMany: vi.fn().mockResolvedValue([{ id: 42, name: "John", phone: "9999" }]),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    // Stub through actual service method used internally.
    const customerSvc = await import("@/lib/services/customerService");
    const spy = vi.spyOn(customerSvc.customerService, "resolveCustomerByPayerName").mockImplementation(resolveCustomerByPayerName);

    const result = await billingService.createBill(prisma as never, { sessionIds: [1] });
    expect(result).toBeDefined();
    expect(resolveCustomerByPayerName).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: 42 }),
    }));
    spy.mockRestore();
  });

  it("applyDiscount validates not found, invalid discount, and remaining amount guard", async () => {
    const base = {
      bill: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      session: {
        findMany: vi.fn().mockResolvedValue([{ outcome: "NORMAL" }]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([{ amount: 120 }]),
      },
    };

    base.bill.findUnique.mockResolvedValueOnce(null);
    await expect(
      billingService.applyDiscount(base as never, { billId: 1, discountType: "fixed", discountValue: 5 }),
    ).rejects.toThrow("Bill not found");

    base.bill.findUnique.mockResolvedValueOnce({ id: 1, totalAmount: 100 });
    await expect(
      billingService.applyDiscount(base as never, { billId: 1, discountType: "percent", discountValue: 101 }),
    ).rejects.toThrow("Invalid percent discount");

    base.bill.findUnique.mockResolvedValueOnce({ id: 1, totalAmount: 100 });
    await expect(
      billingService.applyDiscount(base as never, { billId: 1, discountType: "fixed", discountValue: 1 }),
    ).rejects.toThrow("Discount exceeds remaining amount");
  });
});
