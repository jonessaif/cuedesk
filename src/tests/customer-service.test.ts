import { describe, expect, it, vi } from "vitest";

import { customerService } from "@/lib/services/customerService";

describe("customerService", () => {
  it("upsertCustomer returns null for missing model and invalid input", async () => {
    await expect(customerService.upsertCustomer({} as never, { name: "A", phone: "1" })).resolves.toBeNull();
    const prisma = { customer: { upsert: vi.fn() } };
    await expect(customerService.upsertCustomer(prisma as never, { name: " ", phone: "1" })).resolves.toBeNull();
    await expect(customerService.upsertCustomer(prisma as never, { name: "A", phone: " " })).resolves.toBeNull();
  });

  it("upsertCustomer trims and upserts", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 9, name: "John", phone: "9999" });
    const prisma = { customer: { upsert } };
    const row = await customerService.upsertCustomer(prisma as never, { name: " John ", phone: " 9999 " });
    expect(row).toEqual({ id: 9, name: "John", phone: "9999" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: "9999" },
      create: expect.objectContaining({ name: "John", phone: "9999" }),
      update: expect.objectContaining({ name: "John" }),
    }));
  });

  it("searchCustomers handles due fallback when includeSessionNames=false", async () => {
    const prisma = {
      customer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, name: "John", phone: "9999", lastSeenAt: new Date("2026-04-20T12:00:00.000Z") },
        ]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11, dueCustomerName: "Alex", dueCustomerPhone: "8888" },
          { id: 12, dueCustomerName: "John", dueCustomerPhone: "9999" },
        ]),
      },
    };
    const rows = await customerService.searchCustomers(prisma as never, {
      query: "j",
      includeSessionNames: false,
      limit: 8,
    });
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.name === "Alex")).toBe(true);
  });

  it("searchCustomers guarantees session-only rows in top list", async () => {
    const prisma = {
      customer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, name: "Alice", phone: "1111", lastSeenAt: new Date("2026-04-20T12:00:00.000Z") },
          { id: 2, name: "Asha", phone: "2222", lastSeenAt: new Date("2026-04-20T11:00:00.000Z") },
          { id: 3, name: "Aman", phone: "3333", lastSeenAt: new Date("2026-04-20T10:00:00.000Z") },
        ]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      session: {
        findMany: vi.fn().mockResolvedValue([
          { playerName: "Aaron", startTime: new Date("2026-04-01T10:00:00.000Z") },
          { playerName: "Adam", startTime: new Date("2026-04-01T09:00:00.000Z") },
        ]),
      },
    };
    const rows = await customerService.searchCustomers(prisma as never, {
      query: "a",
      includeSessionNames: true,
      limit: 3,
    });
    expect(rows).toHaveLength(3);
    const names = rows.map((row) => row.name);
    expect(names).toContain("Aaron");
    expect(names).toContain("Adam");
  });

  it("searchCustomers updates existing name when newer session has same identity", async () => {
    const prisma = {
      customer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, name: "john", phone: "9999", lastSeenAt: new Date("2026-04-20T10:00:00.000Z") },
        ]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      session: {
        findMany: vi.fn().mockResolvedValue([
          { playerName: "JOHN", startTime: new Date("2026-04-21T10:00:00.000Z") },
        ]),
      },
    };
    const rows = await customerService.searchCustomers(prisma as never, {
      query: "john",
      includeSessionNames: true,
      limit: 5,
    });
    expect(rows[0].name).toBe("JOHN");
  });

  it("searchCustomers supports customers/payments alias models and due merge updates", async () => {
    const prisma = {
      customers: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, name: "Same", phone: "", lastSeenAt: "2026-04-20T10:00:00.000Z" },
        ]),
      },
      payments: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11, dueCustomerName: "Same", dueCustomerPhone: "9999" },
        ]),
      },
      sessions: {
        findMany: vi.fn().mockRejectedValue(new Error("session query failed")),
      },
    };
    const rows = await customerService.searchCustomers(prisma as never, {
      query: "sa",
      includeSessionNames: false,
      limit: 5,
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((row) => row.phone === "9999")).toBe(true);
  });

  it("resolveCustomerByPayerName updates existing or creates new", async () => {
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({ id: 6, name: "New", phone: null });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 5, name: "Old", phone: "9999" }])
      .mockResolvedValueOnce([]);
    const prisma = { customer: { findMany, update, create } };

    await expect(
      customerService.resolveCustomerByPayerName(prisma as never, { payerName: "  " }),
    ).resolves.toBeNull();

    await expect(
      customerService.resolveCustomerByPayerName(prisma as never, { payerName: " John " }),
    ).resolves.toEqual({ id: 5, name: "John", phone: "9999" });
    expect(update).toHaveBeenCalled();

    await expect(
      customerService.resolveCustomerByPayerName(prisma as never, { payerName: "New" }),
    ).resolves.toEqual({ id: 6, name: "New", phone: null });
    expect(create).toHaveBeenCalled();
  });

  it("resolveCustomerByPayerName returns null when model is missing", async () => {
    await expect(
      customerService.resolveCustomerByPayerName({} as never, { payerName: "John" }),
    ).resolves.toBeNull();
  });
});
