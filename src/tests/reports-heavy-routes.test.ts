import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  hydrateLedgerResetMinutesCache: vi.fn(),
  getLedgerResetMinutesCached: vi.fn(),
  getReportChartSettingsBundle: vi.fn(),
  prisma: {
    table: { findMany: vi.fn() },
    session: { findMany: vi.fn() },
    bill: { findMany: vi.fn() },
    dailyClosing: { findUnique: vi.fn(), upsert: vi.fn() },
    payment: { findMany: vi.fn() },
    expenseEntry: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/settings-service", () => ({
  hydrateLedgerResetMinutesCache: mocks.hydrateLedgerResetMinutesCache,
  getLedgerResetMinutesCached: mocks.getLedgerResetMinutesCached,
}));

vi.mock("@/lib/report-chart-settings-service", () => ({
  getReportChartSettingsBundle: mocks.getReportChartSettingsBundle,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { GET as reportsAnalyticsGet } from "@/app/api/reports/analytics/route";
import { GET as dailyClosingGet, PATCH as dailyClosingPatch } from "@/app/api/reports/daily-closing/route";

describe("reports heavy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 3, role: "operator" });
    mocks.hydrateLedgerResetMinutesCache.mockResolvedValue(undefined);
    mocks.getLedgerResetMinutesCached.mockReturnValue(600);
  });

  it("returns analytics happy-path payload with hourly/day structures", async () => {
    mocks.getReportChartSettingsBundle.mockResolvedValue({
      global: {
        target: "global",
        tableId: null,
        chartMode: "auto",
        mergeBuckets: [{ startHour: 8, endHour: 11, label: "08-11" }],
        includeClosed: true,
        updatedAt: null,
      },
      table: null,
      effective: {
        target: "global",
        tableId: null,
        chartMode: "auto",
        mergeBuckets: [{ startHour: 8, endHour: 11, label: "08-11" }],
        includeClosed: true,
        updatedAt: null,
      },
    });
    mocks.prisma.table.findMany.mockResolvedValue([
      { id: 1, name: "Snooker 1", ratePerMin: 2 },
    ]);
    mocks.prisma.session.findMany.mockResolvedValue([
      {
        id: 10,
        tableId: 1,
        startTime: new Date("2026-04-20T11:00:00.000Z"),
        endTime: new Date("2026-04-20T12:00:00.000Z"),
        businessDayKey: "2026-04-20",
        overrideStartTime: null,
        overrideEndTime: null,
        status: "billed",
        overrideStatus: null,
        overrideRatePerMin: null,
        outcome: "NORMAL",
        billId: 5,
      },
    ]);
    mocks.prisma.bill.findMany.mockResolvedValue([
      { id: 5, totalAmount: 120, discountedAmount: 100, discountType: "fixed" },
    ]);

    const res = await reportsAnalyticsGet(
      new Request("http://localhost/api/reports/analytics?scope=day&date=2026-04-20"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.window.scope).toBe("day");
    expect(body.data.tables.length).toBe(1);
    expect(body.data.hourly.length).toBe(24);
    expect(body.data.overall.revenue).toBeGreaterThanOrEqual(0);
    expect(body.data.revenueSeries).toBeDefined();
  });

  it("returns daily-closing snapshot and supports legacy upsert fallback", async () => {
    mocks.prisma.dailyClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.prisma.bill.findMany
      .mockResolvedValueOnce([{ id: 100, createdAt: new Date("2026-04-20T11:00:00.000Z") }])
      .mockResolvedValueOnce([{ id: 100, createdAt: new Date("2026-04-20T11:00:00.000Z") }]);
    mocks.prisma.payment.findMany
      .mockResolvedValueOnce([
        {
          billId: 100,
          mode: "cash",
          amount: 300,
          createdAt: new Date("2026-04-20T12:00:00.000Z"),
          dueSettledAt: null,
          dueReceivedMode: null,
          bill: { createdAt: new Date("2026-04-20T11:00:00.000Z") },
        },
      ])
      .mockResolvedValueOnce([{ amount: 50 }]);
    mocks.prisma.expenseEntry.findMany.mockResolvedValue([{ amount: 40, mode: "cash" }]);
    mocks.prisma.dailyClosing.upsert
      .mockRejectedValueOnce(new Error("Unknown argument `foodSalesCash`"))
      .mockResolvedValueOnce({});

    const res = await dailyClosingGet(
      new Request("http://localhost/api/reports/daily-closing?date=2026-04-20"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.date).toBe("2026-04-20");
    expect(body.data.sales_cash).toBeGreaterThanOrEqual(0);
    expect(body.data.closing_cash).toBeGreaterThanOrEqual(0);
    expect(mocks.prisma.dailyClosing.upsert).toHaveBeenCalledTimes(2);
  });

  it("covers mixed payment branches including missing bill map and non-cash sales", async () => {
    mocks.prisma.dailyClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    mocks.prisma.bill.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 200, createdAt: new Date("2026-04-20T11:00:00.000Z") },
      ]);

    mocks.prisma.payment.findMany.mockResolvedValueOnce([
      {
        billId: 210,
        mode: "upi",
        amount: 120,
        createdAt: new Date("2026-04-20T10:00:00.000Z"),
        dueSettledAt: new Date("2026-04-20T12:00:00.000Z"),
        dueReceivedMode: "upi",
        bill: { createdAt: new Date("2026-04-20T09:00:00.000Z") },
      },
      {
        billId: 220,
        mode: "due",
        amount: 90,
        createdAt: new Date("2026-04-20T12:10:00.000Z"),
        dueSettledAt: null,
        dueReceivedMode: null,
        bill: { createdAt: new Date("2026-04-20T10:00:00.000Z") },
      },
      {
        billId: 200,
        mode: "upi",
        amount: 60,
        createdAt: new Date("2026-04-20T12:15:00.000Z"),
        dueSettledAt: null,
        dueReceivedMode: null,
        bill: { createdAt: new Date("2026-04-20T11:00:00.000Z") },
      },
      {
        billId: 999,
        mode: "cash",
        amount: 50,
        createdAt: new Date("2026-04-20T12:20:00.000Z"),
        dueSettledAt: null,
        dueReceivedMode: null,
        bill: { createdAt: new Date("2026-04-20T11:00:00.000Z") },
      },
    ]);
    mocks.prisma.expenseEntry.findMany.mockResolvedValueOnce([]);
    mocks.prisma.dailyClosing.upsert.mockResolvedValueOnce({});

    const res = await dailyClosingGet(
      new Request("http://localhost/api/reports/daily-closing?date=2026-04-20"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.sales_bank).toBeGreaterThanOrEqual(60);
    expect(body.data.due_received_bank).toBeGreaterThanOrEqual(120);
  });

  it("covers PATCH success path for today's daily closing", async () => {
    mocks.prisma.dailyClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        date: "2026-04-19",
        openingCash: 10,
        openingBank: 20,
        salesCash: 0,
        salesBank: 0,
        dueReceivedCash: 0,
        dueReceivedBank: 0,
        expenseCash: 0,
        expenseBank: 0,
        newDueTotal: 0,
        closingCash: 50,
        closingBank: 80,
        actualCash: null,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        date: "2026-04-19",
        openingCash: 10,
        openingBank: 20,
        salesCash: 0,
        salesBank: 0,
        dueReceivedCash: 0,
        dueReceivedBank: 0,
        expenseCash: 0,
        expenseBank: 0,
        newDueTotal: 0,
        closingCash: 50,
        closingBank: 80,
        actualCash: null,
      });
    mocks.prisma.bill.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.prisma.payment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.prisma.expenseEntry.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.prisma.dailyClosing.upsert
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await dailyClosingPatch(new Request("http://localhost/api/reports/daily-closing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opening_cash: 999,
        opening_bank: 555,
        food_sales_cash: 20,
        food_sales_bank: 30,
        actual_cash: 70,
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(mocks.prisma.dailyClosing.upsert).toHaveBeenCalledTimes(2);
  });

  it("returns 400 when upsert throws non-legacy error", async () => {
    mocks.prisma.dailyClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.prisma.bill.findMany.mockResolvedValueOnce([]);
    mocks.prisma.payment.findMany.mockResolvedValueOnce([]);
    mocks.prisma.expenseEntry.findMany.mockResolvedValueOnce([]);
    mocks.prisma.dailyClosing.upsert.mockRejectedValueOnce(new Error("upsert failed hard"));

    const res = await dailyClosingGet(
      new Request("http://localhost/api/reports/daily-closing?date=2026-04-20"),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("upsert failed hard");
  });

  it("uses plural prisma model aliases for daily closing compute", async () => {
    const prismaRef = mocks.prisma as Record<string, unknown>;
    const originalDailyClosing = prismaRef.dailyClosing;
    const originalBill = prismaRef.bill;
    const originalPayment = prismaRef.payment;
    const originalExpenseEntry = prismaRef.expenseEntry;

    prismaRef.dailyClosing = undefined;
    prismaRef.bill = undefined;
    prismaRef.payment = undefined;
    prismaRef.expenseEntry = undefined;

    prismaRef.dailyClosings = {
      findUnique: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      upsert: vi.fn().mockResolvedValue({}),
    };
    prismaRef.bills = {
      findMany: vi.fn()
        .mockResolvedValueOnce([{ id: 10, createdAt: new Date("2026-04-20T10:00:00.000Z") }])
        .mockResolvedValueOnce([{ id: 10, createdAt: new Date("2026-04-20T10:00:00.000Z") }]),
    };
    prismaRef.payments = {
      findMany: vi.fn()
        .mockResolvedValueOnce([
          {
            billId: 10,
            mode: "cash",
            amount: 50,
            createdAt: new Date("2026-04-20T11:00:00.000Z"),
            dueSettledAt: null,
            dueReceivedMode: null,
            bill: { createdAt: new Date("2026-04-20T10:00:00.000Z") },
          },
        ])
        .mockResolvedValueOnce([]),
    };
    prismaRef.expenseEntries = {
      findMany: vi.fn().mockResolvedValue([]),
    };

    const res = await dailyClosingGet(
      new Request("http://localhost/api/reports/daily-closing?date=2026-04-20"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.sales_cash).toBeGreaterThanOrEqual(50);

    prismaRef.dailyClosing = originalDailyClosing;
    prismaRef.bill = originalBill;
    prismaRef.payment = originalPayment;
    prismaRef.expenseEntry = originalExpenseEntry;
    delete prismaRef.dailyClosings;
    delete prismaRef.bills;
    delete prismaRef.payments;
    delete prismaRef.expenseEntries;
  });

  it("returns 400 when required daily closing models are unavailable", async () => {
    const prismaRef = mocks.prisma as Record<string, unknown>;
    const originalBill = prismaRef.bill;
    delete prismaRef.bill;
    delete prismaRef.bills;

    const res = await dailyClosingGet(
      new Request("http://localhost/api/reports/daily-closing?date=2026-04-20"),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Daily closing model is not available");

    prismaRef.bill = originalBill;
  });

  it("covers payment-loop edge branches for amount, due-settled-cash, and created-outside-window", async () => {
    mocks.prisma.dailyClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.prisma.bill.findMany
      .mockResolvedValueOnce([{ id: 100, createdAt: new Date("2026-04-20T10:00:00.000Z") }])
      .mockResolvedValueOnce([{ id: 100, createdAt: new Date("2026-04-20T10:00:00.000Z") }]);
    mocks.prisma.payment.findMany
      .mockResolvedValueOnce([
        {
          billId: 100,
          mode: "cash",
          amount: 0,
          createdAt: new Date("2026-04-20T10:30:00.000Z"),
          dueSettledAt: null,
          dueReceivedMode: null,
          bill: { createdAt: new Date("2026-04-20T10:00:00.000Z") },
        },
        {
          billId: 100,
          mode: "cash",
          amount: 25,
          createdAt: new Date("2026-04-20T11:00:00.000Z"),
          dueSettledAt: new Date("2026-04-20T12:00:00.000Z"),
          dueReceivedMode: "cash",
          bill: { createdAt: new Date("2026-04-20T10:00:00.000Z") },
        },
        {
          billId: 100,
          mode: "cash",
          amount: 30,
          createdAt: new Date("2026-04-19T11:00:00.000Z"),
          dueSettledAt: null,
          dueReceivedMode: null,
          bill: { createdAt: new Date("2026-04-20T10:00:00.000Z") },
        },
        {
          billId: 100,
          mode: "upi",
          amount: 40,
          createdAt: new Date("2026-04-20T11:30:00.000Z"),
          dueSettledAt: null,
          dueReceivedMode: null,
          bill: { createdAt: new Date("2026-04-20T10:00:00.000Z") },
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.prisma.expenseEntry.findMany.mockResolvedValueOnce([]);
    mocks.prisma.dailyClosing.upsert.mockResolvedValueOnce({});

    const res = await dailyClosingGet(
      new Request("http://localhost/api/reports/daily-closing?date=2026-04-20"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.due_received_cash).toBeGreaterThanOrEqual(25);
    expect(body.data.sales_bank).toBeGreaterThanOrEqual(40);
  });
});
