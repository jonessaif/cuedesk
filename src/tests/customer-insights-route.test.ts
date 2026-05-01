import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

import { GET } from "@/app/api/customer-insights/route";

describe("customer-insights route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 7, role: "operator" });
    mocks.queryRawUnsafe.mockResolvedValue([
      {
        customer_id: 1,
        payer_identity: "john",
        name: "John",
        visits: 5,
        total_spent: 1200,
        avg_spent: 240,
        last_visit: "2026-04-20 18:00:00",
        avg_gap: 3,
        last_gap: 8,
        is_high_value: 1,
        is_at_risk: 1,
      },
    ]);
  });

  it("returns 400 for invalid startDate", async () => {
    const res = await GET(new Request("http://localhost/api/customer-insights?startDate=2026/04/20"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid startDate");
  });

  it("returns 400 for reversed date range", async () => {
    const res = await GET(new Request("http://localhost/api/customer-insights?startDate=2026-04-21&endDate=2026-04-20"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("endDate must be on or after startDate");
  });

  it("returns normalized customer groups for valid request", async () => {
    const res = await GET(new Request("http://localhost/api/customer-insights?startDate=2026-04-01&endDate=2026-04-19"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.top_customers).toHaveLength(1);
    expect(body.high_value_customers).toHaveLength(1);
    expect(body.at_risk_customers).toHaveLength(1);
    expect(body.at_risk_customers[0].alert).toContain("hasn't visited");
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
