import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireOperatorOrAdmin: vi.fn(),
  requireAdminOrBootstrap: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  listTablesWithState: vi.fn(),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  listSections: vi.fn(),
  createSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  cancelSession: vi.fn(),
  getSessionOverrideHistory: vi.fn(),
  getAllSessions: vi.fn(),
  getCompletedSessions: vi.fn(),
  assignPayer: vi.fn(),
  overrideSession: vi.fn(),
  addPayment: vi.fn(),
  receiveDuePayment: vi.fn(),
  reportsAnalyticsGet: vi.fn(),
  prisma: {
    user: { findMany: vi.fn() },
    dailyReport: { findUnique: vi.fn(), findMany: vi.fn() },
    expenseCategory: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    expenseEntry: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/authz", () => ({
  requireRole: mocks.requireRole,
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
  requireAdminOrBootstrap: mocks.requireAdminOrBootstrap,
}));

vi.mock("@/lib/users-service", () => ({
  listUsers: mocks.listUsers,
  createUser: mocks.createUser,
  updateUser: mocks.updateUser,
  deleteUser: mocks.deleteUser,
}));

vi.mock("@/lib/tables-service", () => ({
  listTablesWithState: mocks.listTablesWithState,
  createTable: mocks.createTable,
  updateTable: mocks.updateTable,
  deleteTable: mocks.deleteTable,
}));

vi.mock("@/lib/sections-service", () => ({
  listSections: mocks.listSections,
  createSection: mocks.createSection,
  updateSection: mocks.updateSection,
  deleteSection: mocks.deleteSection,
}));

vi.mock("@/lib/services/sessionService", () => ({
  sessionService: {
    startSession: mocks.startSession,
    endSession: mocks.endSession,
    cancelSession: mocks.cancelSession,
    getSessionOverrideHistory: mocks.getSessionOverrideHistory,
    getAllSessions: mocks.getAllSessions,
    getCompletedSessions: mocks.getCompletedSessions,
    overrideSession: mocks.overrideSession,
  },
}));

vi.mock("@/lib/services/payerService", () => ({
  payerService: {
    assignPayer: mocks.assignPayer,
  },
}));

vi.mock("@/lib/services/paymentService", () => ({
  paymentService: {
    addPayment: mocks.addPayment,
    receiveDuePayment: mocks.receiveDuePayment,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/app/api/reports/analytics/route", () => ({
  GET: mocks.reportsAnalyticsGet,
}));

import { GET as usersGet, POST as usersPost } from "@/app/api/users/route";
import { PATCH as usersPatch, DELETE as usersDelete } from "@/app/api/users/[id]/route";
import { GET as userOptionsGet } from "@/app/api/users/options/route";
import { GET as tablesGet, POST as tablesPost } from "@/app/api/tables/route";
import { PATCH as tablesPatch, DELETE as tablesDelete } from "@/app/api/tables/[id]/route";
import { GET as sectionsGet, POST as sectionsPost } from "@/app/api/table-sections/route";
import { PATCH as sectionPatch, DELETE as sectionDelete } from "@/app/api/table-sections/[id]/route";
import { POST as sessionStart } from "@/app/api/session/start/route";
import { POST as sessionEnd } from "@/app/api/session/end/route";
import { POST as sessionCancel } from "@/app/api/session/cancel/route";
import { GET as sessionHistory } from "@/app/api/session/history/route";
import { POST as assignPayer } from "@/app/api/session/assign-payer/route";
import { POST as sessionOverride } from "@/app/api/session/override/route";
import { GET as sessionsAll } from "@/app/api/sessions/all/route";
import { GET as sessionsCompleted } from "@/app/api/sessions/completed/route";
import { POST as paymentAdd } from "@/app/api/payment/add/route";
import { POST as receiveDue } from "@/app/api/payment/receive-due/route";
import { GET as expenseCategoriesGet, POST as expenseCategoriesPost } from "@/app/api/expenses/categories/route";
import { PATCH as expenseCategoryPatch, DELETE as expenseCategoryDelete } from "@/app/api/expenses/categories/[id]/route";
import { GET as expenseEntriesGet, POST as expenseEntriesPost } from "@/app/api/expenses/entries/route";
import { GET as reportsDailyGet } from "@/app/api/reports/daily/route";
import { GET as analyticsProxyGet } from "@/app/api/analytics/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("routes batch high impact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ id: 1, role: "admin" });
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "operator" });
    mocks.requireAdminOrBootstrap.mockResolvedValue({ id: 1, role: "admin" });
  });

  it("covers users and user-options routes", async () => {
    mocks.listUsers.mockResolvedValue([{ id: 1, name: "A", role: "admin", isActive: true }]);
    let res = await usersGet(new Request("http://localhost/api/users"));
    expect(res.status).toBe(200);

    res = await usersPost(jsonRequest("http://localhost/api/users", "POST", { role: "bad" }));
    expect(res.status).toBe(400);

    mocks.createUser.mockResolvedValue({ id: 2, name: "B", role: "operator", isActive: true });
    res = await usersPost(jsonRequest("http://localhost/api/users", "POST", { role: "operator", name: "B", pin: "1234" }));
    expect(res.status).toBe(201);

    mocks.updateUser.mockResolvedValue({ id: 2, name: "C", role: "operator", isActive: true });
    res = await usersPatch(jsonRequest("http://localhost/api/users/2", "PATCH", { role: "operator", name: "C" }), { params: Promise.resolve({ id: "2" }) });
    expect(res.status).toBe(200);

    res = await usersDelete(new Request("http://localhost/api/users/2", { method: "DELETE" }), { params: Promise.resolve({ id: "2" }) });
    expect(res.status).toBe(200);

    mocks.prisma.user.findMany.mockResolvedValue([{ id: 1, name: "Admin", role: "admin", isActive: true }]);
    res = await userOptionsGet(new Request("http://localhost/api/users/options"));
    expect(res.status).toBe(200);
  });

  it("covers tables and sections routes", async () => {
    mocks.listTablesWithState.mockResolvedValue([{ id: 1, name: "T1" }]);
    let res = await tablesGet(new Request("http://localhost/api/tables"));
    expect(res.status).toBe(200);

    mocks.createTable.mockResolvedValue({ id: 3, name: "T3" });
    res = await tablesPost(jsonRequest("http://localhost/api/tables", "POST", { name: "T3", ratePerMin: 10 }));
    expect(res.status).toBe(201);

    mocks.updateTable.mockResolvedValue({ id: 3, name: "T3X" });
    res = await tablesPatch(jsonRequest("http://localhost/api/tables/3", "PATCH", { name: "T3X" }), { params: Promise.resolve({ id: "3" }) });
    expect(res.status).toBe(200);
    res = await tablesDelete(new Request("http://localhost/api/tables/3", { method: "DELETE" }), { params: Promise.resolve({ id: "3" }) });
    expect(res.status).toBe(200);

    mocks.listSections.mockResolvedValue([{ id: 1, name: "Snooker" }]);
    res = await sectionsGet(new Request("http://localhost/api/table-sections"));
    expect(res.status).toBe(200);
    mocks.createSection.mockResolvedValue({ id: 2, name: "Pool" });
    res = await sectionsPost(jsonRequest("http://localhost/api/table-sections", "POST", { name: "Pool" }));
    expect(res.status).toBe(201);
    mocks.updateSection.mockResolvedValue({ id: 2, name: "Pool X" });
    res = await sectionPatch(jsonRequest("http://localhost/api/table-sections/2", "PATCH", { name: "Pool X" }), { params: Promise.resolve({ id: "2" }) });
    expect(res.status).toBe(200);
    res = await sectionDelete(new Request("http://localhost/api/table-sections/2", { method: "DELETE" }), { params: Promise.resolve({ id: "2" }) });
    expect(res.status).toBe(200);
  });

  it("covers id parsing and role validation branches for [id] routes", async () => {
    let res = await usersPatch(
      jsonRequest("http://localhost/api/users/NaN", "PATCH", { role: "operator" }),
      { params: Promise.resolve({ id: "NaN" }) },
    );
    expect(res.status).toBe(400);

    res = await usersPatch(
      jsonRequest("http://localhost/api/users/2", "PATCH", { role: "invalid-role" }),
      { params: Promise.resolve({ id: "2" }) },
    );
    expect(res.status).toBe(400);

    res = await usersDelete(new Request("http://localhost/api/users/0", { method: "DELETE" }), {
      params: Promise.resolve({ id: "0" }),
    });
    expect(res.status).toBe(400);

    res = await tablesPatch(
      jsonRequest("http://localhost/api/tables/NaN", "PATCH", { name: "X" }),
      { params: Promise.resolve({ id: "NaN" }) },
    );
    expect(res.status).toBe(400);

    res = await tablesDelete(new Request("http://localhost/api/tables/-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "-1" }),
    });
    expect(res.status).toBe(400);

    res = await sectionPatch(
      jsonRequest("http://localhost/api/table-sections/0", "PATCH", { name: "X" }),
      { params: Promise.resolve({ id: "0" }) },
    );
    expect(res.status).toBe(400);

    res = await sectionDelete(
      new Request("http://localhost/api/table-sections/not-id", { method: "DELETE" }),
      { params: Promise.resolve({ id: "not-id" }) },
    );
    expect(res.status).toBe(400);
  });

  it("covers session routes and validation branches", async () => {
    let res = await sessionStart(jsonRequest("http://localhost/api/session/start", "POST", { tableId: 1, playerName: "" }));
    expect(res.status).toBe(400);
    mocks.startSession.mockResolvedValue({ id: 10, tableId: 1, playerName: "A" });
    res = await sessionStart(jsonRequest("http://localhost/api/session/start", "POST", { tableId: 1, playerName: "A", startTime: "2026-04-20T10:00:00.000Z" }));
    expect(res.status).toBe(200);

    res = await sessionEnd(jsonRequest("http://localhost/api/session/end", "POST", { tableId: 1, outcome: "bad" }));
    expect(res.status).toBe(400);
    mocks.endSession.mockResolvedValue({ id: 10, status: "completed" });
    res = await sessionEnd(jsonRequest("http://localhost/api/session/end", "POST", { tableId: 1, outcome: "NORMAL" }));
    expect(res.status).toBe(200);

    res = await sessionCancel(jsonRequest("http://localhost/api/session/cancel", "POST", { sessionId: 1, reason: "" }));
    expect(res.status).toBe(400);
    mocks.cancelSession.mockResolvedValue({ id: 10, status: "completed" });
    res = await sessionCancel(jsonRequest("http://localhost/api/session/cancel", "POST", { sessionId: 1, reason: "mistake" }));
    expect(res.status).toBe(200);

    res = await sessionHistory(new Request("http://localhost/api/session/history?sessionId=abc"));
    expect(res.status).toBe(400);
    mocks.getSessionOverrideHistory.mockResolvedValue([{ field: "x" }]);
    res = await sessionHistory(new Request("http://localhost/api/session/history?sessionId=1"));
    expect(res.status).toBe(200);

    res = await assignPayer(jsonRequest("http://localhost/api/session/assign-payer", "POST", { sessionId: 0, payerMode: "none" }));
    expect(res.status).toBe(400);
    mocks.assignPayer.mockResolvedValue({ id: 11, payerMode: "none" });
    res = await assignPayer(jsonRequest("http://localhost/api/session/assign-payer", "POST", { sessionId: 11, payerMode: "none" }));
    expect(res.status).toBe(200);

    res = await sessionOverride(jsonRequest("http://localhost/api/session/override", "POST", { sessionId: 1 }));
    expect(res.status).toBe(400);
    mocks.overrideSession.mockResolvedValue({ id: 11, overrideStatus: "completed" });
    res = await sessionOverride(jsonRequest("http://localhost/api/session/override", "POST", {
      sessionId: 1,
      overrideStartTime: "2026-04-20T10:00:00.000Z",
      overrideEndTime: "2026-04-20T11:00:00.000Z",
      overrideStatus: "completed",
    }));
    expect(res.status).toBe(200);
  });

  it("covers sessions list routes", async () => {
    mocks.getAllSessions.mockResolvedValue({ rows: [{ id: 1 }], summary: { total: 1 }, window: { scope: "current" } });
    let res = await sessionsAll(new Request("http://localhost/api/sessions/all?scope=current"));
    expect(res.status).toBe(200);

    mocks.getCompletedSessions.mockResolvedValue([{ id: 1 }]);
    res = await sessionsCompleted(new Request("http://localhost/api/sessions/completed"));
    expect(res.status).toBe(200);
  });

  it("covers payment routes", async () => {
    let res = await paymentAdd(jsonRequest("http://localhost/api/payment/add", "POST", { billId: 1, amount: 10, mode: "bad" }));
    expect(res.status).toBe(400);
    mocks.addPayment.mockResolvedValue({ id: 1, billId: 1, amount: 10, mode: "cash" });
    res = await paymentAdd(jsonRequest("http://localhost/api/payment/add", "POST", { billId: 1, amount: 10, mode: "cash" }));
    expect(res.status).toBe(200);

    res = await receiveDue(jsonRequest("http://localhost/api/payment/receive-due", "POST", { paymentId: 0, mode: "cash", amount: 10 }));
    expect(res.status).toBe(400);
    mocks.receiveDuePayment.mockResolvedValue({ receivedAmount: 10, remainingDue: 0 });
    res = await receiveDue(jsonRequest("http://localhost/api/payment/receive-due", "POST", { paymentId: 1, mode: "upi", amount: 10 }));
    expect(res.status).toBe(200);
  });

  it("covers expenses category and entry routes", async () => {
    mocks.prisma.expenseCategory.findMany.mockResolvedValue([{ id: 1, name: "Rent", isActive: true }]);
    let res = await expenseCategoriesGet(new Request("http://localhost/api/expenses/categories"));
    expect(res.status).toBe(200);

    res = await expenseCategoriesPost(jsonRequest("http://localhost/api/expenses/categories", "POST", { name: "" }));
    expect(res.status).toBe(400);
    mocks.prisma.expenseCategory.create.mockResolvedValue({ id: 2, name: "Food", isActive: true });
    res = await expenseCategoriesPost(jsonRequest("http://localhost/api/expenses/categories", "POST", { name: "Food" }));
    expect(res.status).toBe(201);

    res = await expenseCategoryPatch(jsonRequest("http://localhost/api/expenses/categories/1", "PATCH", { name: " " }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    mocks.prisma.expenseCategory.update.mockResolvedValue({ id: 1, name: "Updated", isActive: true });
    res = await expenseCategoryPatch(jsonRequest("http://localhost/api/expenses/categories/1", "PATCH", { name: "Updated" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    mocks.prisma.expenseCategory.delete.mockResolvedValue({});
    res = await expenseCategoryDelete(new Request("http://localhost/api/expenses/categories/1", { method: "DELETE" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);

    res = await expenseEntriesGet(new Request("http://localhost/api/expenses/entries"));
    expect(res.status).toBe(400);
    mocks.prisma.expenseEntry.findMany.mockResolvedValue([]);
    res = await expenseEntriesGet(new Request("http://localhost/api/expenses/entries?date=2026-04-20"));
    expect(res.status).toBe(200);

    res = await expenseEntriesPost(jsonRequest("http://localhost/api/expenses/entries", "POST", { date: "bad" }));
    expect(res.status).toBe(400);
    mocks.prisma.expenseCategory.findUnique.mockResolvedValue({ id: 1, name: "Food", isActive: true });
    mocks.prisma.expenseEntry.create.mockResolvedValue({
      id: 1,
      date: "2026-04-20",
      item: "Tea",
      amount: 20,
      mode: "cash",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      category: { id: 1, name: "Food" },
      user: { id: 1, name: "Admin" },
    });
    res = await expenseEntriesPost(jsonRequest("http://localhost/api/expenses/entries", "POST", {
      date: "2026-04-20",
      category_id: 1,
      item: "Tea",
      amount: 20,
      mode: "cash",
    }));
    expect(res.status).toBe(201);
  });

  it("covers reports daily and analytics proxy", async () => {
    mocks.prisma.dailyReport.findUnique.mockResolvedValue({ businessDayKey: "2026-04-20" });
    let res = await reportsDailyGet(new Request("http://localhost/api/reports/daily?key=2026-04-20"));
    expect(res.status).toBe(200);
    mocks.prisma.dailyReport.findMany.mockResolvedValue([]);
    res = await reportsDailyGet(new Request("http://localhost/api/reports/daily?startDate=2026-04-01&endDate=2026-04-20"));
    expect(res.status).toBe(200);

    mocks.reportsAnalyticsGet.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    res = await analyticsProxyGet(new Request("http://localhost/api/analytics?scope=day&date=2026-04-20&tableId=2"));
    expect(res.status).toBe(200);
    expect(mocks.reportsAnalyticsGet).toHaveBeenCalledTimes(1);
  });
});
