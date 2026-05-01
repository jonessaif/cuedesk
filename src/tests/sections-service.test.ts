import { describe, expect, it, vi } from "vitest";

import {
  createSection,
  deleteSection,
  listSections,
  updateSection,
} from "@/lib/sections-service";

describe("sections-service", () => {
  it("returns empty list if model missing", async () => {
    await expect(listSections({} as never)).resolves.toEqual([]);
  });

  it("seeds defaults when no sections exist", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, name: "Pool Tables" },
        { id: 2, name: "PlayStation" },
        { id: 3, name: "Snooker" },
      ]);
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      tableSection: { findMany, findUnique, create },
    };

    const rows = await listSections(prisma as never);
    expect(rows).toHaveLength(3);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("creates section with trimmed name and validates duplicates", async () => {
    const prisma = {
      tableSection: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9, name: "Snooker" }),
        create: vi.fn().mockResolvedValue({ id: 10, name: "VIP" }),
      },
    };

    await expect(createSection(prisma as never, { name: "  VIP  " })).resolves.toEqual({ id: 10, name: "VIP" });
    await expect(createSection(prisma as never, { name: " Snooker " })).rejects.toThrow("Section already exists");
    await expect(createSection(prisma as never, { name: "   " })).rejects.toThrow("Section name is required");
  });

  it("updates section and validates name collisions", async () => {
    const prisma = {
      tableSection: {
        findUnique: vi.fn().mockResolvedValueOnce({ id: 1, name: "Old" }).mockResolvedValueOnce(null),
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 4, name: "Taken" }),
        update: vi.fn().mockResolvedValue({ id: 1, name: "New Name" }),
      },
    };

    await expect(updateSection(prisma as never, { id: 1, name: " New Name " })).resolves.toEqual({
      id: 1,
      name: "New Name",
    });
    await expect(updateSection(prisma as never, { id: 2, name: "Taken" })).rejects.toThrow("Section not found");

    const prismaCollision = {
      tableSection: {
        findUnique: vi.fn().mockResolvedValue({ id: 3, name: "Other" }),
        findFirst: vi.fn().mockResolvedValue({ id: 4, name: "Taken" }),
        update: vi.fn(),
      },
    };
    await expect(updateSection(prismaCollision as never, { id: 3, name: "Taken" })).rejects.toThrow(
      "Section already exists",
    );
  });

  it("blocks delete when linked tables exist", async () => {
    const prisma = {
      tableSection: {
        findUnique: vi.fn().mockResolvedValue({ id: 2, name: "Snooker" }),
        delete: vi.fn().mockResolvedValue({}),
      },
      tableSectionAssignment: {
        count: vi.fn().mockResolvedValue(1),
      },
    };

    await expect(deleteSection(prisma as never, { id: 2 })).rejects.toThrow(
      "Cannot delete section with linked tables",
    );
  });
});
