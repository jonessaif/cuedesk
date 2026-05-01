import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  getDueReport: vi.fn(),
  getDueReportByBill: vi.fn(),
  sessionsAllGet: vi.fn(),
  prisma: {},
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/services/paymentService", () => ({
  paymentService: {
    getDueReport: mocks.getDueReport,
    getDueReportByBill: mocks.getDueReportByBill,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/app/api/sessions/all/route", () => ({
  GET: mocks.sessionsAllGet,
}));

import { GET as dueReportGet } from "@/app/api/payment/due-report/route";
import { GET as dueReportByBillGet } from "@/app/api/payment/due-report-by-bill/route";
import { GET as ledgerGet } from "@/app/api/ledger/route";

describe("low branch route wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
    mocks.sessionsAllGet.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });

  it("covers payment due-report success and forbidden branches", async () => {
    mocks.getDueReport.mockResolvedValue([{ customerName: "A", dueAmount: 100 }]);

    let res = await dueReportGet(new Request("http://localhost/api/payment/due-report"));
    let body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);

    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Forbidden: operator required"));
    res = await dueReportGet(new Request("http://localhost/api/payment/due-report"));
    body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");
  });

  it("covers payment due-report-by-bill success and forbidden branches", async () => {
    mocks.getDueReportByBill.mockResolvedValue([{ billId: 10, dueAmount: 50 }]);

    let res = await dueReportByBillGet(new Request("http://localhost/api/payment/due-report-by-bill"));
    let body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);

    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Forbidden: operator required"));
    res = await dueReportByBillGet(new Request("http://localhost/api/payment/due-report-by-bill"));
    body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");
  });

  it("covers ledger scope normalization branches", async () => {
    await ledgerGet(new Request("http://localhost/api/ledger?scope=weird&date=2026-04-20"));
    let forwarded = mocks.sessionsAllGet.mock.calls[0][0] as Request;
    let forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.pathname).toBe("/api/sessions/all");
    expect(forwardedUrl.searchParams.get("scope")).toBe("day");
    expect(forwardedUrl.searchParams.get("date")).toBe("2026-04-20");

    await ledgerGet(new Request("http://localhost/api/ledger?scope=range&startDate=bad&endDate=2026-04-20&date=2026-04-21"));
    forwarded = mocks.sessionsAllGet.mock.calls[1][0] as Request;
    forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.searchParams.get("scope")).toBe("day");
    expect(forwardedUrl.searchParams.get("date")).toBe("2026-04-21");

    await ledgerGet(new Request("http://localhost/api/ledger?scope=range&startDate=2026-04-01&endDate=2026-04-20"));
    forwarded = mocks.sessionsAllGet.mock.calls[2][0] as Request;
    forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.searchParams.get("scope")).toBe("range");
    expect(forwardedUrl.searchParams.get("startDate")).toBe("2026-04-01");
    expect(forwardedUrl.searchParams.get("endDate")).toBe("2026-04-20");

    await ledgerGet(new Request("http://localhost/api/ledger?scope=current"));
    forwarded = mocks.sessionsAllGet.mock.calls[3][0] as Request;
    forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.searchParams.get("scope")).toBe("current");
    expect(forwardedUrl.searchParams.get("date")).toBeNull();
  });
});
