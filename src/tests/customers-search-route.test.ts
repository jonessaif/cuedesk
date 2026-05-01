import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  searchCustomers: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/services/customerService", () => ({
  customerService: {
    searchCustomers: mocks.searchCustomers,
  },
}));

import { GET } from "@/app/api/customers/search/route";

describe("customers/search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
  });

  it("returns empty data when q is empty", async () => {
    const res = await GET(new Request("http://localhost/api/customers/search?q=   "));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [] });
    expect(mocks.searchCustomers).not.toHaveBeenCalled();
  });

  it("searches with includeSessionNames=false for due scope", async () => {
    mocks.searchCustomers.mockResolvedValue([{ id: 9, name: "John" }]);
    const res = await GET(new Request("http://localhost/api/customers/search?q=john&scope=due"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(mocks.searchCustomers).toHaveBeenCalledWith(expect.anything(), {
      query: "john",
      limit: 8,
      includeSessionNames: false,
    });
  });

  it("maps auth errors to 401", async () => {
    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Unauthorized: login required"));
    const res = await GET(new Request("http://localhost/api/customers/search?q=john"));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });
});
