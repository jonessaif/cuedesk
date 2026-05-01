import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  prisma: {
    expenseEntry: { findMany: vi.fn(), create: vi.fn() },
    expenseCategory: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { GET, POST } from "@/app/api/expenses/entries/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/expenses/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("expenses/entries route extra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
  });

  it("supports range query with categoryIds", async () => {
    mocks.prisma.expenseEntry.findMany.mockResolvedValue([
      {
        id: 1,
        date: "2026-04-10",
        item: "Tea",
        amount: 20,
        mode: "cash",
        createdAt: new Date(),
        category: { id: 2, name: "Food" },
        user: { id: 1, name: "Admin" },
      },
    ]);
    const res = await GET(
      new Request("http://localhost/api/expenses/entries?from=2026-04-01&to=2026-04-20&categoryIds=2,3"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary.total).toBe(20);
    expect(body.by_category).toHaveLength(1);
  });

  it("returns empty summary when model missing", async () => {
    const prev = mocks.prisma.expenseEntry;
    // Temporarily simulate missing model branch.
    (mocks.prisma as unknown as { expenseEntry?: unknown }).expenseEntry = undefined;
    const res = await GET(new Request("http://localhost/api/expenses/entries?date=2026-04-20"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary.total).toBe(0);
    (mocks.prisma as unknown as { expenseEntry?: unknown }).expenseEntry = prev;
  });

  it("validates POST body branches and inactive category", async () => {
    let res = await POST(jsonRequest({ date: "2026-04-20", category_id: 1, item: "", amount: 10, mode: "cash" }));
    expect(res.status).toBe(400);
    res = await POST(jsonRequest({ date: "2026-04-20", category_id: 1, item: "x", amount: -1, mode: "cash" }));
    expect(res.status).toBe(400);
    res = await POST(jsonRequest({ date: "2026-04-20", category_id: 1, item: "x", amount: 1, mode: "upi" }));
    expect(res.status).toBe(400);

    mocks.prisma.expenseCategory.findUnique.mockResolvedValue({ id: 1, name: "Food", isActive: false });
    res = await POST(jsonRequest({ date: "2026-04-20", category_id: 1, item: "x", amount: 1, mode: "cash" }));
    expect(res.status).toBe(400);
  });
});
