import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireOperatorOrAdmin: vi.fn(),
  requireAdminOrBootstrap: vi.fn(),
  addPayment: vi.fn(),
  receiveDuePayment: vi.fn(),
  getCompletedSessions: vi.fn(),
  getSessionOverrideHistory: vi.fn(),
  startSession: vi.fn(),
  listSections: vi.fn(),
  createSection: vi.fn(),
  listTablesWithState: vi.fn(),
  createTable: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  prisma: {
    user: { findMany: vi.fn() },
    expenseCategory: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as Record<string, unknown>,
}));

vi.mock("@/lib/authz", () => ({
  requireRole: mocks.requireRole,
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
  requireAdminOrBootstrap: mocks.requireAdminOrBootstrap,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/services/paymentService", () => ({
  paymentService: {
    addPayment: mocks.addPayment,
    receiveDuePayment: mocks.receiveDuePayment,
  },
}));

vi.mock("@/lib/services/sessionService", () => ({
  sessionService: {
    getCompletedSessions: mocks.getCompletedSessions,
    getSessionOverrideHistory: mocks.getSessionOverrideHistory,
    startSession: mocks.startSession,
  },
}));

vi.mock("@/lib/sections-service", () => ({
  listSections: mocks.listSections,
  createSection: mocks.createSection,
}));

vi.mock("@/lib/tables-service", () => ({
  listTablesWithState: mocks.listTablesWithState,
  createTable: mocks.createTable,
}));

vi.mock("@/lib/users-service", () => ({
  listUsers: mocks.listUsers,
  createUser: mocks.createUser,
}));

import { GET as expenseCategoriesGet, POST as expenseCategoriesPost } from "@/app/api/expenses/categories/route";
import { PATCH as expenseCategoryPatch, DELETE as expenseCategoryDelete } from "@/app/api/expenses/categories/[id]/route";
import { POST as paymentAddPost } from "@/app/api/payment/add/route";
import { POST as receiveDuePost } from "@/app/api/payment/receive-due/route";
import { GET as sessionsCompletedGet } from "@/app/api/sessions/completed/route";
import { GET as sessionHistoryGet } from "@/app/api/session/history/route";
import { POST as sessionStartPost } from "@/app/api/session/start/route";
import { GET as tableSectionsGet, POST as tableSectionsPost } from "@/app/api/table-sections/route";
import { GET as tablesGet, POST as tablesPost } from "@/app/api/tables/route";
import { GET as usersGet, POST as usersPost } from "@/app/api/users/route";
import { GET as usersOptionsGet } from "@/app/api/users/options/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("branch status routes extra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ id: 1, role: "admin" });
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
    mocks.requireAdminOrBootstrap.mockResolvedValue({ id: 1, role: "admin" });
    mocks.addPayment.mockResolvedValue({ id: 1 });
    mocks.receiveDuePayment.mockResolvedValue({ ok: true });
    mocks.getCompletedSessions.mockResolvedValue([]);
    mocks.getSessionOverrideHistory.mockResolvedValue([]);
    mocks.startSession.mockResolvedValue({ id: 1, tableId: 1, playerName: "A" });
    mocks.listSections.mockResolvedValue([]);
    mocks.createSection.mockResolvedValue({ id: 1, name: "Pool" });
    mocks.listTablesWithState.mockResolvedValue([]);
    mocks.createTable.mockResolvedValue({ id: 1, name: "T1" });
    mocks.listUsers.mockResolvedValue([]);
    mocks.createUser.mockResolvedValue({
      id: 2,
      name: "Admin",
      role: "admin",
      isActive: true,
      createdAt: new Date("2026-04-21T00:00:00.000Z"),
      updatedAt: new Date("2026-04-21T00:00:00.000Z"),
    });
    (mocks.prisma as { user: { findMany: ReturnType<typeof vi.fn> } }).user.findMany.mockResolvedValue([]);
    (mocks.prisma as { expenseCategory: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } }).expenseCategory.findMany.mockResolvedValue([]);
  });

  it("covers expenses categories model-missing and duplicate branches", async () => {
    const prismaRef = mocks.prisma as Record<string, unknown>;
    const originalModel = prismaRef.expenseCategory;
    delete prismaRef.expenseCategory;
    delete prismaRef.expenseCategories;

    let res = await expenseCategoriesGet(new Request("http://localhost/api/expenses/categories"));
    let body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);

    res = await expenseCategoriesPost(
      jsonRequest("http://localhost/api/expenses/categories", "POST", { name: "X" }),
    );
    body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Expense categories are not available");

    prismaRef.expenseCategory = originalModel;
    (mocks.prisma as { expenseCategory: { create: ReturnType<typeof vi.fn> } }).expenseCategory.create
      .mockRejectedValueOnce(new Error("Unique constraint failed"));
    res = await expenseCategoriesPost(
      jsonRequest("http://localhost/api/expenses/categories", "POST", { name: "Food" }),
    );
    body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe("Category already exists");
  });

  it("covers expenses categories [id] validation and in-use branches", async () => {
    let res = await expenseCategoryPatch(
      jsonRequest("http://localhost/api/expenses/categories/1", "PATCH", { is_active: "bad" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    let body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Nothing to update");

    res = await expenseCategoryDelete(new Request("http://localhost/api/expenses/categories/abc", { method: "DELETE" }), {
      params: Promise.resolve({ id: "abc" }),
    });
    body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid category id");

    (mocks.prisma as { expenseCategory: { delete: ReturnType<typeof vi.fn> } }).expenseCategory.delete
      .mockRejectedValueOnce(new Error("Foreign key constraint failed"));
    res = await expenseCategoryDelete(new Request("http://localhost/api/expenses/categories/1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "1" }),
    });
    body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toContain("Category is in use");
  });

  it("covers payment add and receive-due branches", async () => {
    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Forbidden: role"));
    let res = await paymentAddPost(
      jsonRequest("http://localhost/api/payment/add", "POST", { billId: 1, amount: 10, mode: "cash" }),
    );
    let body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");

    res = await receiveDuePost(
      jsonRequest("http://localhost/api/payment/receive-due", "POST", {
        paymentId: 0,
        customerPhone: "9999",
        mode: "upi",
        amount: 10,
      }),
    );
    body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.receiveDuePayment).toHaveBeenCalledWith(expect.anything(), {
      paymentId: undefined,
      customerPhone: "9999",
      mode: "upi",
      amount: 10,
    });

    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Forbidden: role"));
    res = await receiveDuePost(
      jsonRequest("http://localhost/api/payment/receive-due", "POST", {
        paymentId: 1,
        mode: "cash",
        amount: 10,
      }),
    );
    body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");

    res = await paymentAddPost(
      jsonRequest("http://localhost/api/payment/add", "POST", { billId: 0, amount: 10, mode: "cash" }),
    );
    body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid billId");

    res = await paymentAddPost(
      jsonRequest("http://localhost/api/payment/add", "POST", { billId: 1, amount: 0, mode: "cash" }),
    );
    body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid amount");
  });

  it("covers completed sessions and admin wrapper auth-status branches", async () => {
    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Forbidden: no access"));
    let res = await sessionsCompletedGet(new Request("http://localhost/api/sessions/completed"));
    let body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");

    mocks.requireRole.mockRejectedValueOnce(new Error("Forbidden: admin only"));
    res = await tableSectionsGet(new Request("http://localhost/api/table-sections"));
    body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");

    mocks.requireRole.mockRejectedValueOnce(new Error("Unexpected failure"));
    res = await tableSectionsPost(
      jsonRequest("http://localhost/api/table-sections", "POST", { name: "Pool" }),
    );
    body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Unexpected failure");

    mocks.requireRole.mockRejectedValueOnce(new Error("Forbidden: admin only"));
    res = await usersOptionsGet(new Request("http://localhost/api/users/options"));
    body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");
  });

  it("covers tables route sectionId and auth branches", async () => {
    let res = await tablesGet(new Request("http://localhost/api/tables"));
    expect(res.status).toBe(200);

    res = await tablesPost(
      jsonRequest("http://localhost/api/tables", "POST", {
        name: "T-null",
        ratePerMin: 10,
        sectionId: null,
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.createTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sectionId: undefined,
    }));

    res = await tablesPost(
      jsonRequest("http://localhost/api/tables", "POST", {
        name: "T-num",
        ratePerMin: 10,
        sectionId: 2,
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.createTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sectionId: 2,
    }));

    mocks.requireRole.mockRejectedValueOnce(new Error("Unauthorized: login required"));
    res = await tablesGet(new Request("http://localhost/api/tables"));
    expect(res.status).toBe(401);
  });

  it("covers users route admin creation and auth branches", async () => {
    let res = await usersGet(new Request("http://localhost/api/users"));
    expect(res.status).toBe(200);

    res = await usersPost(jsonRequest("http://localhost/api/users", "POST", {
      name: "Admin",
      pin: "1234",
      role: "admin",
    }));
    expect(res.status).toBe(201);

    mocks.requireAdminOrBootstrap.mockRejectedValueOnce(new Error("Unauthorized: login required"));
    res = await usersPost(jsonRequest("http://localhost/api/users", "POST", {
      name: "A",
      pin: "1234",
      role: "admin",
    }));
    expect(res.status).toBe(401);
  });

  it("covers session history and start route validation/auth branches", async () => {
    let res = await sessionHistoryGet(new Request("http://localhost/api/session/history?sessionId=0"));
    let body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid sessionId");

    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Forbidden: denied"));
    res = await sessionHistoryGet(new Request("http://localhost/api/session/history?sessionId=1"));
    body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Forbidden");

    res = await sessionStartPost(jsonRequest("http://localhost/api/session/start", "POST", {
      tableId: 1,
      playerName: "A",
      startTime: "bad-date",
    }));
    body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid startTime");

    mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Unauthorized: login required"));
    res = await sessionStartPost(jsonRequest("http://localhost/api/session/start", "POST", {
      tableId: 1,
      playerName: "A",
    }));
    body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });
});
