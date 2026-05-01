import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  requireRole: vi.fn(),
  requireAdminOrBootstrap: vi.fn(),
  findActiveUserByPin: vi.fn(),
  prisma: {
    user: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
  requireRole: mocks.requireRole,
  requireAdminOrBootstrap: mocks.requireAdminOrBootstrap,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/users-service", () => ({
  findActiveUserByPin: mocks.findActiveUserByPin,
}));

import { GET as analyticsGet } from "@/app/api/analytics/route";
import { POST as authLoginPost } from "@/app/api/auth/login/route";
import { POST as billCreatePost } from "@/app/api/bill/create/route";
import { POST as billDiscountPost } from "@/app/api/bill/discount/route";
import { GET as billLatestGet } from "@/app/api/bill/latest/route";
import { GET as billSearchGet } from "@/app/api/bill/search/route";
import { GET as billUnpaidGet } from "@/app/api/bill/unpaid/route";
import { GET as customerInsightsGet } from "@/app/api/customer-insights/route";
import { GET as customerSearchGet } from "@/app/api/customers/search/route";
import { GET as dashboardLiveGet } from "@/app/api/dashboard-live/route";
import { GET as expenseCategoriesGet, POST as expenseCategoriesPost } from "@/app/api/expenses/categories/route";
import { PATCH as expenseCategoryPatch, DELETE as expenseCategoryDelete } from "@/app/api/expenses/categories/[id]/route";
import { GET as expenseEntriesGet, POST as expenseEntriesPost } from "@/app/api/expenses/entries/route";
import { GET as ledgerGet } from "@/app/api/ledger/route";
import { POST as paymentAddPost } from "@/app/api/payment/add/route";
import { GET as dueReportGet } from "@/app/api/payment/due-report/route";
import { GET as dueReportByBillGet } from "@/app/api/payment/due-report-by-bill/route";
import { POST as receiveDuePost } from "@/app/api/payment/receive-due/route";
import { GET as reportsAnalyticsGet } from "@/app/api/reports/analytics/route";
import { GET as reportsDailyGet } from "@/app/api/reports/daily/route";
import { GET as dailyClosingGet, PATCH as dailyClosingPatch } from "@/app/api/reports/daily-closing/route";
import { GET as reportsSettingsGet, PATCH as reportsSettingsPatch } from "@/app/api/reports/settings/route";
import { POST as assignPayerPost } from "@/app/api/session/assign-payer/route";
import { POST as cancelSessionPost } from "@/app/api/session/cancel/route";
import { POST as endSessionPost } from "@/app/api/session/end/route";
import { GET as sessionHistoryGet } from "@/app/api/session/history/route";
import { POST as overrideSessionPost } from "@/app/api/session/override/route";
import { POST as startSessionPost } from "@/app/api/session/start/route";
import { GET as sessionsAllGet } from "@/app/api/sessions/all/route";
import { GET as sessionsCompletedGet } from "@/app/api/sessions/completed/route";
import { GET as ledgerResetGet, PATCH as ledgerResetPatch } from "@/app/api/settings/ledger-reset/route";
import { GET as sectionsGet, POST as sectionsPost } from "@/app/api/table-sections/route";
import { PATCH as sectionPatch, DELETE as sectionDelete } from "@/app/api/table-sections/[id]/route";
import { GET as tablesGet, POST as tablesPost } from "@/app/api/tables/route";
import { PATCH as tablePatch, DELETE as tableDelete } from "@/app/api/tables/[id]/route";
import { GET as usersGet, POST as usersPost } from "@/app/api/users/route";
import { PATCH as userPatch, DELETE as userDelete } from "@/app/api/users/[id]/route";
import { GET as usersOptionsGet } from "@/app/api/users/options/route";

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectUnauthorized(invoke: () => Promise<Response>) {
  const res = await invoke();
  const data = await res.json();
  expect([400, 401, 403]).toContain(res.status);
  const errorText = String(data?.error ?? "");
  const isAuthError = errorText.includes("Unauthorized") || errorText.includes("Forbidden");
  expect(isAuthError).toBe(true);
}

describe("API routes auth smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockRejectedValue(new Error("Unauthorized: login required"));
    mocks.requireRole.mockRejectedValue(new Error("Unauthorized: login required"));
    mocks.requireAdminOrBootstrap.mockRejectedValue(new Error("Unauthorized: login required"));
  });

  it("returns unauthorized for protected routes", async () => {
    const cases: Array<{ name: string; invoke: () => Promise<Response> }> = [
      { name: "analytics", invoke: () => analyticsGet(new Request("http://localhost/api/analytics")) },
      { name: "bill create", invoke: () => billCreatePost(jsonRequest("http://localhost/api/bill/create", "POST", { sessionIds: [1] })) },
      { name: "bill discount", invoke: () => billDiscountPost(jsonRequest("http://localhost/api/bill/discount", "POST", { billId: 1 })) },
      { name: "bill latest", invoke: () => billLatestGet(new Request("http://localhost/api/bill/latest")) },
      { name: "bill search", invoke: () => billSearchGet(new Request("http://localhost/api/bill/search")) },
      { name: "bill unpaid", invoke: () => billUnpaidGet(new Request("http://localhost/api/bill/unpaid")) },
      { name: "customer insights", invoke: () => customerInsightsGet(new Request("http://localhost/api/customer-insights")) },
      { name: "customer search", invoke: () => customerSearchGet(new Request("http://localhost/api/customers/search")) },
      { name: "dashboard live", invoke: () => dashboardLiveGet(new Request("http://localhost/api/dashboard-live")) },
      { name: "expense categories get", invoke: () => expenseCategoriesGet(new Request("http://localhost/api/expenses/categories")) },
      { name: "expense categories post", invoke: () => expenseCategoriesPost(jsonRequest("http://localhost/api/expenses/categories", "POST", { name: "snacks" })) },
      { name: "expense category patch", invoke: () => expenseCategoryPatch(jsonRequest("http://localhost/api/expenses/categories/1", "PATCH", { name: "snacks" }), { params: Promise.resolve({ id: "1" }) }) },
      { name: "expense category delete", invoke: () => expenseCategoryDelete(new Request("http://localhost/api/expenses/categories/1", { method: "DELETE" }), { params: Promise.resolve({ id: "1" }) }) },
      { name: "expense entries get", invoke: () => expenseEntriesGet(new Request("http://localhost/api/expenses/entries")) },
      { name: "expense entries post", invoke: () => expenseEntriesPost(jsonRequest("http://localhost/api/expenses/entries", "POST", {})) },
      { name: "ledger", invoke: () => ledgerGet(new Request("http://localhost/api/ledger")) },
      { name: "payment add", invoke: () => paymentAddPost(jsonRequest("http://localhost/api/payment/add", "POST", {})) },
      { name: "due report", invoke: () => dueReportGet(new Request("http://localhost/api/payment/due-report")) },
      { name: "due report by bill", invoke: () => dueReportByBillGet(new Request("http://localhost/api/payment/due-report-by-bill")) },
      { name: "receive due", invoke: () => receiveDuePost(jsonRequest("http://localhost/api/payment/receive-due", "POST", {})) },
      { name: "reports analytics", invoke: () => reportsAnalyticsGet(new Request("http://localhost/api/reports/analytics")) },
      { name: "reports daily", invoke: () => reportsDailyGet(new Request("http://localhost/api/reports/daily")) },
      { name: "daily closing get", invoke: () => dailyClosingGet(new Request("http://localhost/api/reports/daily-closing")) },
      { name: "daily closing patch", invoke: () => dailyClosingPatch(jsonRequest("http://localhost/api/reports/daily-closing", "PATCH", {})) },
      { name: "reports settings get", invoke: () => reportsSettingsGet(new Request("http://localhost/api/reports/settings")) },
      { name: "reports settings patch", invoke: () => reportsSettingsPatch(jsonRequest("http://localhost/api/reports/settings", "PATCH", {})) },
      { name: "assign payer", invoke: () => assignPayerPost(jsonRequest("http://localhost/api/session/assign-payer", "POST", {})) },
      { name: "cancel session", invoke: () => cancelSessionPost(jsonRequest("http://localhost/api/session/cancel", "POST", {})) },
      { name: "end session", invoke: () => endSessionPost(jsonRequest("http://localhost/api/session/end", "POST", {})) },
      { name: "session history", invoke: () => sessionHistoryGet(new Request("http://localhost/api/session/history")) },
      { name: "session override", invoke: () => overrideSessionPost(jsonRequest("http://localhost/api/session/override", "POST", {})) },
      { name: "start session", invoke: () => startSessionPost(jsonRequest("http://localhost/api/session/start", "POST", {})) },
      { name: "sessions all", invoke: () => sessionsAllGet(new Request("http://localhost/api/sessions/all")) },
      { name: "sessions completed", invoke: () => sessionsCompletedGet(new Request("http://localhost/api/sessions/completed")) },
      { name: "ledger reset get", invoke: () => ledgerResetGet(new Request("http://localhost/api/settings/ledger-reset")) },
      { name: "ledger reset patch", invoke: () => ledgerResetPatch(jsonRequest("http://localhost/api/settings/ledger-reset", "PATCH", {})) },
      { name: "sections get", invoke: () => sectionsGet(new Request("http://localhost/api/table-sections")) },
      { name: "sections post", invoke: () => sectionsPost(jsonRequest("http://localhost/api/table-sections", "POST", {})) },
      { name: "section patch", invoke: () => sectionPatch(jsonRequest("http://localhost/api/table-sections/1", "PATCH", {}), { params: Promise.resolve({ id: "1" }) }) },
      { name: "section delete", invoke: () => sectionDelete(new Request("http://localhost/api/table-sections/1", { method: "DELETE" }), { params: Promise.resolve({ id: "1" }) }) },
      { name: "tables get", invoke: () => tablesGet(new Request("http://localhost/api/tables")) },
      { name: "tables post", invoke: () => tablesPost(jsonRequest("http://localhost/api/tables", "POST", {})) },
      { name: "table patch", invoke: () => tablePatch(jsonRequest("http://localhost/api/tables/1", "PATCH", {}), { params: Promise.resolve({ id: "1" }) }) },
      { name: "table delete", invoke: () => tableDelete(new Request("http://localhost/api/tables/1", { method: "DELETE" }), { params: Promise.resolve({ id: "1" }) }) },
      { name: "users get", invoke: () => usersGet(new Request("http://localhost/api/users")) },
      { name: "users post", invoke: () => usersPost(jsonRequest("http://localhost/api/users", "POST", {})) },
      { name: "user patch", invoke: () => userPatch(jsonRequest("http://localhost/api/users/1", "PATCH", {}), { params: Promise.resolve({ id: "1" }) }) },
      { name: "user delete", invoke: () => userDelete(new Request("http://localhost/api/users/1", { method: "DELETE" }), { params: Promise.resolve({ id: "1" }) }) },
      { name: "users options", invoke: () => usersOptionsGet(new Request("http://localhost/api/users/options")) },
    ];

    for (const testCase of cases) {
      // eslint-disable-next-line no-await-in-loop
      await expectUnauthorized(testCase.invoke);
    }
  });

  it("handles login invalid pin", async () => {
    const res = await authLoginPost(jsonRequest("http://localhost/api/auth/login", "POST", { pin: "12" }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data).toEqual({ error: "Invalid PIN" });
  });

  it("handles login valid pin with no user", async () => {
    mocks.findActiveUserByPin.mockResolvedValue(null);
    const res = await authLoginPost(jsonRequest("http://localhost/api/auth/login", "POST", { pin: "1234" }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data).toEqual({ error: "Invalid PIN" });
  });

  it("handles login valid pin with active user", async () => {
    mocks.findActiveUserByPin.mockResolvedValue({
      id: 7,
      name: "Operator",
      role: "operator",
      isActive: true,
    });
    const res = await authLoginPost(jsonRequest("http://localhost/api/auth/login", "POST", { pin: "1234" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({
      data: {
        id: 7,
        name: "Operator",
        role: "operator",
        isActive: true,
      },
    });
  });

  it("handles login service error", async () => {
    mocks.findActiveUserByPin.mockRejectedValue(new Error("DB unavailable"));
    const res = await authLoginPost(jsonRequest("http://localhost/api/auth/login", "POST", { pin: "1234" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data).toEqual({ error: "DB unavailable" });
  });
});
