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

import { GET } from "@/app/api/reports/analytics/route";

describe("reports/analytics route extra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
    mocks.hydrateLedgerResetMinutesCache.mockResolvedValue(undefined);
    mocks.getLedgerResetMinutesCached.mockReturnValue(600);
    mocks.getReportChartSettingsBundle.mockResolvedValue({
      global: {
        target: "global",
        tableId: null,
        chartMode: "auto",
        mergeBuckets: [],
        includeClosed: true,
        updatedAt: null,
      },
      table: null,
      effective: {
        target: "global",
        tableId: null,
        chartMode: "auto",
        mergeBuckets: [],
        includeClosed: true,
        updatedAt: null,
      },
    });
    mocks.prisma.session.findMany.mockResolvedValue([]);
    mocks.prisma.bill.findMany.mockResolvedValue([]);
  });

  it("returns 400 for invalid custom timeframe", async () => {
    const res = await GET(
      new Request("http://localhost/api/reports/analytics?startAt=bad&endAt=2026-04-20T10:00:00.000Z"),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid custom timeframe");
  });

  it("returns 400 when selected table does not exist", async () => {
    mocks.getReportChartSettingsBundle.mockResolvedValue({
      global: { chartMode: "auto", mergeBuckets: [], includeClosed: true },
      table: null,
      effective: { chartMode: "auto", mergeBuckets: [], includeClosed: true },
    });
    mocks.prisma.table.findMany.mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/reports/analytics?tableId=9"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Table not found");
  });

  it("covers day-series mode and range validation", async () => {
    mocks.getReportChartSettingsBundle.mockResolvedValue({
      global: {
        target: "global",
        tableId: null,
        chartMode: "day",
        mergeBuckets: [],
        includeClosed: false,
        updatedAt: null,
      },
      table: null,
      effective: {
        target: "global",
        tableId: null,
        chartMode: "day",
        mergeBuckets: [],
        includeClosed: false,
        updatedAt: null,
      },
    });
    mocks.prisma.table.findMany.mockResolvedValue([{ id: 1, name: "S1", ratePerMin: 10 }]);
    mocks.prisma.session.findMany.mockResolvedValue([
      {
        id: 1,
        tableId: 1,
        startTime: new Date("2026-04-10T11:00:00.000Z"),
        endTime: new Date("2026-04-10T12:00:00.000Z"),
        businessDayKey: "2026-04-10",
        overrideStartTime: null,
        overrideEndTime: null,
        status: "completed",
        overrideStatus: null,
        overrideRatePerMin: null,
        outcome: "NORMAL",
        billId: null,
      },
    ]);
    const ok = await GET(new Request("http://localhost/api/reports/analytics?scope=range&startDate=2026-04-10&endDate=2026-04-12"));
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body.data.revenueSeries.mode).toBe("day");

    const bad = await GET(new Request("http://localhost/api/reports/analytics?scope=range&startDate=2026-04-12&endDate=2026-04-10"));
    expect(bad.status).toBe(400);
  });
});
