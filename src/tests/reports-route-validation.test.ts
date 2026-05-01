import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  hydrateLedgerResetMinutesCache: vi.fn(),
  getLedgerResetMinutesCached: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/settings-service", () => ({
  hydrateLedgerResetMinutesCache: mocks.hydrateLedgerResetMinutesCache,
  getLedgerResetMinutesCached: mocks.getLedgerResetMinutesCached,
}));

import { GET as reportsAnalyticsGet } from "@/app/api/reports/analytics/route";
import { PATCH as dailyClosingPatch } from "@/app/api/reports/daily-closing/route";

describe("reports route validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 3, role: "operator" });
    mocks.hydrateLedgerResetMinutesCache.mockResolvedValue(undefined);
    mocks.getLedgerResetMinutesCached.mockReturnValue(600);
  });

  it("returns 400 for invalid analytics tableId", async () => {
    const res = await reportsAnalyticsGet(new Request("http://localhost/api/reports/analytics?tableId=-4"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid tableId");
  });

  it("returns 400 when editing daily closing for non-current business day", async () => {
    const request = new Request("http://localhost/api/reports/daily-closing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2020-01-01",
        opening_cash: 100,
      }),
    });
    const res = await dailyClosingPatch(request);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Only today's daily closing can be edited");
  });
});
