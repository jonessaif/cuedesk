import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  listTablesWithState: vi.fn(),
  getCompletedSessions: vi.fn(),
  getAllSessions: vi.fn(),
  billFindMany: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/tables-service", () => ({
  listTablesWithState: mocks.listTablesWithState,
}));

vi.mock("@/lib/services/sessionService", () => ({
  sessionService: {
    getCompletedSessions: mocks.getCompletedSessions,
    getAllSessions: mocks.getAllSessions,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bill: {
      findMany: mocks.billFindMany,
    },
  },
}));

import { GET } from "@/app/api/dashboard-live/route";

describe("dashboard-live route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 13, role: "operator" });
    mocks.listTablesWithState.mockResolvedValue([{ id: 1, name: "T1" }]);
    mocks.getCompletedSessions.mockResolvedValue([{ id: 11 }]);
    mocks.getAllSessions.mockResolvedValue({
      rows: [{ id: 21 }],
      summary: { total: 1 },
      window: { scope: "current" },
    });
    mocks.billFindMany.mockResolvedValue([
      {
        id: 100,
        totalAmount: 300,
        discountType: null,
        discountValue: null,
        discountedAmount: 300,
        sessions: [{ amount: 300 }],
        payments: [{ amount: 100, mode: "cash", dueSettledAt: null }],
      },
    ]);
  });

  it("returns 401 when auth fails", async () => {
    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Unauthorized: login required"));
    const res = await GET(new Request("http://localhost/api/dashboard-live"));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("serves MISS then HIT from short-lived cache", async () => {
    const requestUrl = "http://localhost/api/dashboard-live?scope=current&date=2026-04-20";
    const first = await GET(new Request(requestUrl));
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBe("MISS");
    expect(firstBody.data.tables).toHaveLength(1);
    expect(mocks.billFindMany).toHaveBeenCalledTimes(1);

    const second = await GET(new Request(requestUrl));
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(mocks.billFindMany).toHaveBeenCalledTimes(1);
  });
});
