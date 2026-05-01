import { describe, expect, it, vi } from "vitest";

import { paymentService } from "@/lib/services/paymentService";
import { customerService } from "@/lib/services/customerService";

describe("paymentService extra coverage", () => {
  it("adds due payment and links customer to bill", async () => {
    const upsertCustomer = vi.spyOn(customerService, "upsertCustomer").mockResolvedValue({ id: 77 } as never);
    const updateBill = vi.fn().mockResolvedValue({});
    const createPayment = vi.fn().mockResolvedValue({ id: 1, billId: 10, mode: "due", amount: 100 });

    const prisma = {
      bill: {
        findUnique: vi.fn().mockResolvedValue({ id: 10, totalAmount: 300, discountedAmount: 300, discountType: null }),
        update: updateBill,
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        create: createPayment,
      },
      session: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const row = await paymentService.addPayment(prisma as never, {
      billId: 10,
      amount: 100,
      mode: "due",
      dueCustomerName: "John",
      dueCustomerPhone: "9999",
    });
    expect(row).toBeDefined();
    expect(updateBill).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { customerId: 77 },
    });
    upsertCustomer.mockRestore();
  });

  it("rejects due mode without customer details", async () => {
    const prisma = {
      bill: { findUnique: vi.fn().mockResolvedValue({ id: 10, totalAmount: 300, discountedAmount: 300, discountType: null }) },
      payment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
      session: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await expect(
      paymentService.addPayment(prisma as never, {
        billId: 10,
        amount: 50,
        mode: "due",
      }),
    ).rejects.toThrow("Due requires customer name and phone");
  });

  it("aggregates due report by customer", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    const findMany = vi.fn().mockResolvedValue([
      { id: 1, billId: 10, amount: 100, dueCustomerName: "John", dueCustomerPhone: "9999", dueSettledAt: null },
      { id: 2, billId: 11, amount: 50, dueCustomerName: "John", dueCustomerPhone: "9999", dueSettledAt: null },
      { id: 3, billId: 12, amount: 40, dueCustomerName: "Alex", dueCustomerPhone: null, dueSettledAt: null },
    ]);
    const prisma = { payment: { updateMany, findMany } };

    const rows = await paymentService.getDueReport(prisma as never);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(rows[0].totalDue).toBeGreaterThanOrEqual(rows[1].totalDue);
    expect(rows.some((row) => row.customerName === "John" && row.billCount === 2)).toBe(true);
  });

  it("maps due report by bill with earliest session date", async () => {
    const prisma = {
      payment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 9, billId: 20, amount: 120, dueCustomerName: "John", dueCustomerPhone: "9999" },
        ]),
      },
      session: {
        findMany: vi.fn().mockResolvedValue([
          { billId: 20, startTime: new Date("2026-04-20T10:00:00.000Z") },
        ]),
      },
    };
    const rows = await paymentService.getDueReportByBill(prisma as never);
    expect(rows).toHaveLength(1);
    expect(rows[0].billDate).toContain("2026-04-20");
  });

  it("receives due payment partially across entries", async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      payment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, billId: 10, amount: 100, mode: "due", dueSettledAt: null },
          { id: 2, billId: 11, amount: 80, mode: "due", dueSettledAt: null },
        ]),
        findUnique: vi.fn(),
        create,
        update,
      },
      bill: {
        findUnique: vi.fn().mockResolvedValue({ id: 10 }),
      },
    };
    const result = await paymentService.receiveDuePayment(prisma as never, {
      customerPhone: "9999",
      mode: "cash",
      amount: 120,
    });
    expect(result.receivedAmount).toBe(120);
    expect(result.remainingDue).toBe(60);
    expect(create).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it("validates receive due input and not-found path", async () => {
    const prisma = {
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      },
      bill: { findUnique: vi.fn() },
    };
    await expect(
      paymentService.receiveDuePayment(prisma as never, { mode: "cash", amount: 0 }),
    ).rejects.toThrow("Invalid receive amount");
    await expect(
      paymentService.receiveDuePayment(prisma as never, { paymentId: 99, mode: "upi", amount: 10 }),
    ).rejects.toThrow("Due entry not found");
  });
});
