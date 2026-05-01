import { describe, expect, it, vi } from "vitest";

import {
  createTable,
  deleteTable,
  updateTable,
} from "@/lib/tables-service";

describe("tables-service extra coverage", () => {
  it("validates updateTable input and not found", async () => {
    const prisma = {
      table: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };
    await expect(updateTable(prisma as never, { id: 1, name: "A" })).rejects.toThrow("Table not found");
  });

  it("validates updateTable empty/no fields/rate/name-taken", async () => {
    const prisma = {
      table: {
        findUnique: vi.fn().mockResolvedValue({ id: 1, name: "T1", ratePerMin: 10 }),
        findFirst: vi.fn().mockResolvedValue({ id: 2, name: "T2" }),
        update: vi.fn(),
      },
    };

    await expect(updateTable(prisma as never, { id: 1 })).rejects.toThrow("No fields to update");
    await expect(updateTable(prisma as never, { id: 1, name: "   " })).rejects.toThrow("name is required");
    await expect(updateTable(prisma as never, { id: 1, ratePerMin: 0 })).rejects.toThrow("ratePerMin must be greater than 0");
    await expect(updateTable(prisma as never, { id: 1, name: "T2" })).rejects.toThrow("Table name already exists");
  });

  it("updates table and handles section assignment create/update/remove", async () => {
    const findUniqueTable = vi.fn().mockResolvedValue({ id: 1, name: "T1", ratePerMin: 10 });
    const updateTableRow = vi.fn().mockResolvedValue({ id: 1, name: "T1X", ratePerMin: 12 });

    const findUniqueSection = vi.fn().mockResolvedValue({ id: 10 });
    const findUniqueMap = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce({ id: 7 });
    const createMap = vi.fn().mockResolvedValue({});
    const updateMap = vi.fn().mockResolvedValue({});
    const deleteMap = vi.fn().mockResolvedValue({});

    const prisma = {
      table: {
        findUnique: findUniqueTable,
        findFirst: vi.fn().mockResolvedValue(null),
        update: updateTableRow,
      },
      tableSection: {
        findUnique: findUniqueSection,
      },
      tableSectionAssignment: {
        findUnique: findUniqueMap,
        create: createMap,
        update: updateMap,
        delete: deleteMap,
      },
    };

    await expect(updateTable(prisma as never, { id: 1, name: "T1X", ratePerMin: 12, sectionId: 10 })).resolves.toMatchObject({
      id: 1,
      name: "T1X",
    });
    expect(createMap).toHaveBeenCalledTimes(1);

    await updateTable(prisma as never, { id: 1, sectionId: 10 });
    expect(updateMap).toHaveBeenCalledTimes(1);

    await updateTable(prisma as never, { id: 1, sectionId: null });
    expect(deleteMap).toHaveBeenCalledTimes(1);
  });

  it("throws on missing section models and invalid section id", async () => {
    const base = {
      table: {
        findUnique: vi.fn().mockResolvedValue({ id: 1, name: "T1", ratePerMin: 10 }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ id: 1, name: "T1", ratePerMin: 10 }),
      },
    };
    await expect(updateTable(base as never, { id: 1, sectionId: 2 })).rejects.toThrow("Section model is not available");

    const withModels = {
      ...base,
      tableSection: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      tableSectionAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    await expect(updateTable(withModels as never, { id: 1, sectionId: 2 })).rejects.toThrow("Selected section not found");
  });

  it("createTable supports section assignment path", async () => {
    const prisma = {
      table: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 5, name: "T5", ratePerMin: 10 }),
      },
      tableSection: {
        findUnique: vi.fn().mockResolvedValue({ id: 9 }),
      },
      tableSectionAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    await createTable(prisma as never, { name: "T5", ratePerMin: 10, sectionId: 9 });
    expect(prisma.tableSectionAssignment.create).toHaveBeenCalledTimes(1);
  });

  it("deleteTable validates not-found/linked-history/success", async () => {
    const prismaMissing = {
      table: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      session: { count: vi.fn() },
    };
    await expect(deleteTable(prismaMissing as never, { id: 1 })).rejects.toThrow("Table not found");

    const prismaBlocked = {
      table: {
        findUnique: vi.fn().mockResolvedValue({ id: 1 }),
        delete: vi.fn(),
      },
      session: { count: vi.fn().mockResolvedValue(2) },
    };
    await expect(deleteTable(prismaBlocked as never, { id: 1 })).rejects.toThrow("Cannot delete table with session history");

    const prismaOk = {
      table: {
        findUnique: vi.fn().mockResolvedValue({ id: 1 }),
        delete: vi.fn().mockResolvedValue({}),
      },
      session: { count: vi.fn().mockResolvedValue(0) },
    };
    await expect(deleteTable(prismaOk as never, { id: 1 })).resolves.toBeUndefined();
    expect(prismaOk.table.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
