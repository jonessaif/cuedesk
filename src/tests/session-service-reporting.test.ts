import { describe, expect, it, vi } from "vitest";

import { sessionService } from "@/lib/services/sessionService";

describe("sessionService reporting/history", () => {
  it("getAllSessions computes summary and upserts daily snapshot for closed window", async () => {
    const sessionRows = [
      {
        id: 1,
        playerName: "A",
        startTime: new Date("2026-04-10T11:00:00.000Z"),
        endTime: new Date("2026-04-10T12:00:00.000Z"),
        businessDayKey: "2026-04-10",
        status: "billed",
        outcome: "NORMAL",
        billId: 10,
        amount: 100,
        cancellationReason: null,
        canceledAt: null,
        payerMode: "single",
        payerData: { name: "A" },
        overrideStartTime: null,
        overrideEndTime: null,
        overrideRatePerMin: null,
        overridePayerMode: null,
        overridePayerData: null,
        overrideStatus: null,
        overridePaymentModes: null,
        table: { name: "S1", ratePerMin: 2 },
      },
      {
        id: 2,
        playerName: "B",
        startTime: new Date("2026-04-10T13:00:00.000Z"),
        endTime: new Date("2026-04-10T13:20:00.000Z"),
        businessDayKey: "2026-04-10",
        status: "completed",
        outcome: "LTP_LOSS",
        billId: null,
        amount: 0,
        cancellationReason: null,
        canceledAt: null,
        payerMode: "none",
        payerData: null,
        overrideStartTime: null,
        overrideEndTime: null,
        overrideRatePerMin: null,
        overridePayerMode: null,
        overridePayerData: null,
        overrideStatus: null,
        overridePaymentModes: null,
        table: { name: "S2", ratePerMin: 2 },
      },
    ];

    const paymentFindMany = vi.fn().mockImplementation((args: { where?: { billId?: { in: number[] } } }) => {
      if (args?.where?.billId?.in) {
        return Promise.resolve([
          { billId: 10, amount: 100, mode: "cash", createdAt: new Date("2026-04-10T12:10:00.000Z") },
        ]);
      }
      return Promise.resolve([
        {
          amount: 100,
          mode: "cash",
          createdAt: new Date("2026-04-10T12:10:00.000Z"),
          dueSettledAt: null,
          dueReceivedMode: null,
          bill: { createdAt: new Date("2026-04-10T11:00:00.000Z") },
        },
        {
          amount: 50,
          mode: "due",
          createdAt: new Date("2026-04-10T12:15:00.000Z"),
          dueSettledAt: null,
          dueReceivedMode: null,
          bill: { createdAt: new Date("2026-04-10T11:00:00.000Z") },
        },
      ]);
    });

    const dailyUpsert = vi.fn().mockResolvedValue({});
    const prisma = {
      session: {
        findMany: vi.fn().mockResolvedValue(sessionRows),
      },
      payment: {
        findMany: paymentFindMany,
      },
      bill: {
        findMany: vi.fn().mockResolvedValue([
          { id: 10, totalAmount: 120, discountedAmount: 100, discountType: "fixed" },
        ]),
      },
      dailyReport: {
        upsert: dailyUpsert,
      },
    };

    const result = await sessionService.getAllSessions(prisma as never, {
      scope: "day",
      date: "2026-04-10",
      now: new Date("2026-04-12T12:00:00.000Z"),
    });

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.summary.total).toBeGreaterThanOrEqual(0);
    expect(result.summary.ltpCount).toBe(1);
    expect(result.window.scope).toBe("day");
    expect(dailyUpsert).toHaveBeenCalledTimes(1);
  });

  it("getAllSessions validates range scope inputs", async () => {
    const prisma = {
      session: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      bill: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await expect(
      sessionService.getAllSessions(prisma as never, { scope: "range", startDate: "2026-04-10" }),
    ).rejects.toThrow("Start date and end date are required");
    await expect(
      sessionService.getAllSessions(prisma as never, { scope: "range", startDate: "2026-04-12", endDate: "2026-04-10" }),
    ).rejects.toThrow("Invalid date range");
  });

  it("getSessionOverrideHistory builds timeline with synthetic bill and payment events", async () => {
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1,
          startTime: new Date("2026-04-10T10:00:00.000Z"),
          endTime: new Date("2026-04-10T11:00:00.000Z"),
          status: "billed",
          billId: 10,
          amount: 100,
          cancellationReason: null,
          canceledAt: null,
        }),
      },
      sessionOverrideEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 90,
            action: "override_update",
            changedFields: ["status"],
            beforeData: { status: "completed" },
            afterData: { status: "billed", changedBy: "Admin" },
            createdAt: new Date("2026-04-10T11:05:00.000Z"),
          },
        ]),
      },
      bill: {
        findUnique: vi.fn().mockResolvedValue({
          id: 10,
          createdAt: new Date("2026-04-10T11:00:00.000Z"),
          totalAmount: 120,
          discountedAmount: 100,
        }),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 5,
            amount: 100,
            mode: "cash",
            dueCustomerName: null,
            dueCustomerPhone: null,
            dueSettledAt: null,
            dueReceivedMode: null,
          },
        ]),
      },
    };

    const timeline = await sessionService.getSessionOverrideHistory(prisma as never, { sessionId: 1 });
    expect(timeline.length).toBeGreaterThan(1);
    expect(timeline.some((row) => row.action === "bill_created")).toBe(true);
    expect(timeline.some((row) => row.action === "payment_recorded")).toBe(true);
  });
});
