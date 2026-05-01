import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOperatorOrAdmin: vi.fn(),
  createBill: vi.fn(),
  applyDiscount: vi.fn(),
  prisma: {
    bill: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/authz", () => ({
  requireOperatorOrAdmin: mocks.requireOperatorOrAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/services/billingService", () => ({
  billingService: {
    createBill: mocks.createBill,
    applyDiscount: mocks.applyDiscount,
  },
}));

import { POST as createBillRoute } from "@/app/api/bill/create/route";
import { POST as discountRoute } from "@/app/api/bill/discount/route";
import { GET as latestBillRoute } from "@/app/api/bill/latest/route";
import { GET as searchBillRoute } from "@/app/api/bill/search/route";
import { GET as unpaidBillRoute } from "@/app/api/bill/unpaid/route";

describe("Bill API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOperatorOrAdmin.mockResolvedValue({ id: 1, role: "admin" });
  });

  describe("POST /api/bill/create", () => {
    it("returns 400 for invalid request body", async () => {
      const req = new Request("http://localhost/api/bill/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(null),
      });

      const res = await createBillRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid request body" });
    });

    it("returns 400 for invalid sessionIds", async () => {
      const req = new Request("http://localhost/api/bill/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionIds: [] }),
      });

      const res = await createBillRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid sessionIds" });
      expect(mocks.createBill).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid discountType", async () => {
      const req = new Request("http://localhost/api/bill/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionIds: [1],
          discountType: "random",
        }),
      });

      const res = await createBillRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid discountType" });
    });

    it("returns 400 for invalid discountValue", async () => {
      const req = new Request("http://localhost/api/bill/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionIds: [1],
          discountType: "fixed",
          discountValue: -1,
        }),
      });

      const res = await createBillRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid discountValue" });
    });

    it("returns 400 for invalid percent discount", async () => {
      const req = new Request("http://localhost/api/bill/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionIds: [1],
          discountType: "percent",
          discountValue: 120,
        }),
      });

      const res = await createBillRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid percent discount" });
    });

    it("creates bill and returns computed response", async () => {
      mocks.createBill.mockResolvedValue({
        id: 99,
        totalAmount: 500,
        discountType: "fixed",
        discountValue: 20,
        discountedAmount: 480,
      });

      const req = new Request("http://localhost/api/bill/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionIds: [3, 3, 1],
          discountType: "fixed",
          discountValue: 20,
        }),
      });

      const res = await createBillRoute(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(mocks.createBill).toHaveBeenCalledWith(mocks.prisma as never, {
        sessionIds: [3, 1],
        discountType: "fixed",
        discountValue: 20,
      });
      expect(data).toMatchObject({
        id: 99,
        subtotal: 500,
        finalAmount: 480,
        remainingAmount: 480,
      });
    });

    it("normalizes discountType none to undefined", async () => {
      mocks.createBill.mockResolvedValue({
        id: 101,
        totalAmount: 200,
        discountType: null,
        discountValue: null,
        discountedAmount: 200,
      });

      const req = new Request("http://localhost/api/bill/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionIds: [1],
          discountType: "none",
          discountValue: "",
        }),
      });

      const res = await createBillRoute(req);
      expect(res.status).toBe(200);
      expect(mocks.createBill).toHaveBeenCalledWith(mocks.prisma as never, {
        sessionIds: [1],
        discountType: undefined,
        discountValue: undefined,
      });
    });
  });

  describe("POST /api/bill/discount", () => {
    it("returns 400 for invalid request body", async () => {
      const req = new Request("http://localhost/api/bill/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(null),
      });

      const res = await discountRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid request body" });
    });

    it("returns 400 for invalid billId", async () => {
      const req = new Request("http://localhost/api/bill/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId: 0 }),
      });

      const res = await discountRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid billId" });
    });

    it("returns 400 for invalid discountType", async () => {
      const req = new Request("http://localhost/api/bill/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId: 1, discountType: "bad" }),
      });

      const res = await discountRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid discountType" });
    });

    it("returns 400 for invalid discountValue", async () => {
      const req = new Request("http://localhost/api/bill/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId: 1, discountType: "fixed", discountValue: -9 }),
      });

      const res = await discountRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid discountValue" });
    });

    it("returns 400 for invalid percent discount", async () => {
      const req = new Request("http://localhost/api/bill/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId: 1, discountType: "percent", discountValue: 120 }),
      });

      const res = await discountRoute(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data).toEqual({ error: "Invalid percent discount" });
    });

    it("applies discount and returns service payload", async () => {
      mocks.applyDiscount.mockResolvedValue({
        billId: 2,
        subtotal: 1000,
        finalAmount: 850,
      });

      const req = new Request("http://localhost/api/bill/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          billId: 2,
          discountType: "percent",
          discountValue: 15,
        }),
      });

      const res = await discountRoute(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(mocks.applyDiscount).toHaveBeenCalledWith(mocks.prisma as never, {
        billId: 2,
        discountType: "percent",
        discountValue: 15,
      });
      expect(data).toEqual({
        billId: 2,
        subtotal: 1000,
        finalAmount: 850,
      });
    });

    it("normalizes discountType none to undefined", async () => {
      mocks.applyDiscount.mockResolvedValue({
        billId: 2,
        subtotal: 1000,
        finalAmount: 1000,
      });
      const req = new Request("http://localhost/api/bill/discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId: 2, discountType: "none", discountValue: "" }),
      });

      const res = await discountRoute(req);
      expect(res.status).toBe(200);
      expect(mocks.applyDiscount).toHaveBeenCalledWith(mocks.prisma as never, {
        billId: 2,
        discountType: undefined,
        discountValue: undefined,
      });
    });
  });

  describe("GET /api/bill/latest", () => {
    it("returns null data when no bill exists", async () => {
      mocks.prisma.bill.findFirst.mockResolvedValue(null);
      const res = await latestBillRoute(new Request("http://localhost/api/bill/latest"));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ data: null });
    });

    it("returns normalized latest bill totals", async () => {
      mocks.prisma.bill.findFirst.mockResolvedValue({
        id: 5,
        totalAmount: 500,
        discountType: "fixed",
        discountValue: 50,
        discountedAmount: 450,
        sessions: [{ amount: 200 }, { amount: 300 }],
        payments: [{ amount: 200, mode: "cash", dueSettledAt: null }],
      });

      const res = await latestBillRoute(new Request("http://localhost/api/bill/latest"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toMatchObject({
        id: 5,
        finalAmount: 450,
        paidAmount: 200,
        remainingAmount: 250,
      });
    });
  });

  describe("GET /api/bill/unpaid", () => {
    it("returns only unpaid bills", async () => {
      mocks.prisma.bill.findMany.mockResolvedValue([
        {
          id: 10,
          totalAmount: 300,
          discountType: null,
          discountValue: null,
          discountedAmount: 300,
          sessions: [{ amount: 300 }],
          payments: [{ amount: 100, mode: "cash", dueSettledAt: null, dueCustomerName: null, dueCustomerPhone: null, dueReceivedMode: null }],
        },
        {
          id: 11,
          totalAmount: 200,
          discountType: null,
          discountValue: null,
          discountedAmount: 200,
          sessions: [{ amount: 200 }],
          payments: [{ amount: 200, mode: "cash", dueSettledAt: null, dueCustomerName: null, dueCustomerPhone: null, dueReceivedMode: null }],
        },
      ]);

      const res = await unpaidBillRoute(new Request("http://localhost/api/bill/unpaid"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(10);
    });

    it("returns 403 for forbidden errors", async () => {
      mocks.requireOperatorOrAdmin.mockRejectedValueOnce(new Error("Forbidden: denied"));
      const res = await unpaidBillRoute(new Request("http://localhost/api/bill/unpaid"));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("GET /api/bill/search", () => {
    it("returns 400 for invalid billId", async () => {
      const res = await searchBillRoute(new Request("http://localhost/api/bill/search?billId=abc"));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "Invalid billId" });
    });

    it("filters by paymentMode", async () => {
      mocks.prisma.bill.findMany.mockResolvedValue([
        {
          id: 100,
          createdAt: new Date("2026-04-20T10:00:00.000Z"),
          totalAmount: 400,
          discountType: null,
          discountValue: null,
          discountedAmount: 400,
          sessions: [
            {
              playerName: "A",
              payerMode: "single",
              payerData: { name: "A" },
              overridePayerMode: null,
              overridePayerData: null,
            },
          ],
          payments: [
            { mode: "upi", amount: 100, dueSettledAt: null },
          ],
        },
        {
          id: 101,
          createdAt: new Date("2026-04-20T11:00:00.000Z"),
          totalAmount: 500,
          discountType: null,
          discountValue: null,
          discountedAmount: 500,
          sessions: [
            {
              playerName: "B",
              payerMode: "single",
              payerData: { name: "B" },
              overridePayerMode: null,
              overridePayerData: null,
            },
          ],
          payments: [
            { mode: "cash", amount: 200, dueSettledAt: null },
          ],
        },
      ]);

      const res = await searchBillRoute(new Request("http://localhost/api/bill/search?paymentMode=cash"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(101);
    });

    it("returns 400 for invalid startDate", async () => {
      const res = await searchBillRoute(new Request("http://localhost/api/bill/search?startDate=2026/04/20"));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "Invalid startDate" });
    });

    it("returns 400 for invalid endDate", async () => {
      const res = await searchBillRoute(new Request("http://localhost/api/bill/search?endDate=2026/04/20"));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "Invalid endDate" });
    });

    it("returns 400 for invalid startTime", async () => {
      const res = await searchBillRoute(new Request("http://localhost/api/bill/search?startDate=2026-04-20&startTime=99:00"));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "Invalid startTime" });
    });

    it("returns 400 for invalid endTime", async () => {
      const res = await searchBillRoute(new Request("http://localhost/api/bill/search?endDate=2026-04-20&endTime=25:00"));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "Invalid endTime" });
    });

    it("filters by payer name and builds createdAt window", async () => {
      mocks.prisma.bill.findMany.mockResolvedValue([
        {
          id: 200,
          createdAt: new Date("2026-04-20T10:20:00.000Z"),
          totalAmount: 300,
          discountType: null,
          discountValue: null,
          discountedAmount: 300,
          sessions: [
            {
              playerName: "Ignored",
              payerMode: "split",
              payerData: [{ name: "John Doe", percentage: 50 }, { name: "Alex", percentage: 50 }],
              overridePayerMode: null,
              overridePayerData: null,
            },
          ],
          payments: [{ mode: "cash", amount: 300, dueSettledAt: null }],
        },
      ]);

      const res = await searchBillRoute(
        new Request(
          "http://localhost/api/bill/search?startDate=2026-04-20&endDate=2026-04-20&startTime=10:15&endTime=10:30&payer=john",
        ),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].payerNames).toContain("John Doe");
      expect(mocks.prisma.bill.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }));
    });
  });
});
