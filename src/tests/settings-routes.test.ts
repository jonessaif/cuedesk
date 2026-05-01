import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  requireRole: vi.fn(),
  getReportChartSettingsBundle: vi.fn(),
  upsertReportChartSettings: vi.fn(),
  getLedgerResetMinutes: vi.fn(),
  setLedgerResetMinutes: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/report-chart-settings-service", () => ({
  getReportChartSettingsBundle: mocks.getReportChartSettingsBundle,
  upsertReportChartSettings: mocks.upsertReportChartSettings,
}));

vi.mock("@/lib/settings-service", () => ({
  getLedgerResetMinutes: mocks.getLedgerResetMinutes,
  setLedgerResetMinutes: mocks.setLedgerResetMinutes,
}));

import { GET as reportsSettingsGet, PATCH as reportsSettingsPatch } from "@/app/api/reports/settings/route";
import { GET as ledgerResetGet, PATCH as ledgerResetPatch } from "@/app/api/settings/ledger-reset/route";

describe("settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
    mocks.requireRole.mockResolvedValue({ id: 1, role: "admin" });
  });

  it("reports settings GET validates tableId and returns data", async () => {
    mocks.getReportChartSettingsBundle.mockResolvedValue({ global: {}, table: null, effective: {} });
    const bad = await reportsSettingsGet(new Request("http://localhost/api/reports/settings?tableId=bad"));
    expect(bad.status).toBe(400);

    const ok = await reportsSettingsGet(new Request("http://localhost/api/reports/settings?tableId=2"));
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body.data).toBeDefined();
  });

  it("reports settings PATCH validates target and updates bundle", async () => {
    const badReq = new Request("http://localhost/api/reports/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "bad" }),
    });
    const bad = await reportsSettingsPatch(badReq);
    expect(bad.status).toBe(400);

    mocks.upsertReportChartSettings.mockResolvedValue({ target: "global" });
    mocks.getReportChartSettingsBundle.mockResolvedValue({ global: {}, table: null, effective: {} });
    const okReq = new Request("http://localhost/api/reports/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "global", chartMode: "auto", includeClosed: true }),
    });
    const ok = await reportsSettingsPatch(okReq);
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body.data.updated).toBeDefined();
  });

  it("ledger reset GET/PATCH success and invalid time", async () => {
    mocks.getLedgerResetMinutes.mockResolvedValue(600);
    let res = await ledgerResetGet(new Request("http://localhost/api/settings/ledger-reset"));
    expect(res.status).toBe(200);

    const badReq = new Request("http://localhost/api/settings/ledger-reset", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ledgerResetTime: "abc" }),
    });
    res = await ledgerResetPatch(badReq);
    expect(res.status).toBe(400);

    mocks.setLedgerResetMinutes.mockResolvedValue(630);
    const okReq = new Request("http://localhost/api/settings/ledger-reset", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ledgerResetTime: "10:30" }),
    });
    res = await ledgerResetPatch(okReq);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.ledgerResetMinutes).toBe(630);
    expect(body.data.ledgerResetTime).toBe("10:30");
  });
});
