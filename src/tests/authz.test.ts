import { describe, expect, it } from "vitest";

import {
  getActorUserOrNull,
  requireAdminOrBootstrap,
  requireOperatorOrAdmin,
  requireRole,
} from "@/lib/authz";

describe("authz", () => {
  it("returns null when x-user-id is missing/invalid/inactive", async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ id: 1, role: "admin", isActive: false }),
      },
    };
    await expect(getActorUserOrNull(prisma as never, new Request("http://localhost"))).resolves.toBeNull();
    await expect(
      getActorUserOrNull(
        prisma as never,
        new Request("http://localhost", { headers: { "x-user-id": "abc" } }),
      ),
    ).resolves.toBeNull();
  });

  it("resolves actor and enforces roles", async () => {
    const prisma = {
      user: {
        findUnique: async ({ where }: { where: { id: number } }) => ({
          id: where.id,
          role: where.id === 2 ? "operator" : "admin",
          isActive: true,
        }),
      },
    };
    const adminReq = new Request("http://localhost", { headers: { "x-user-id": "1" } });
    const operatorReq = new Request("http://localhost", { headers: { "x-user-id": "2" } });

    await expect(requireRole(prisma as never, adminReq, "admin")).resolves.toMatchObject({ id: 1, role: "admin" });
    await expect(requireRole(prisma as never, operatorReq, ["admin", "operator"])).resolves.toMatchObject({
      id: 2,
      role: "operator",
    });
    await expect(requireOperatorOrAdmin(prisma as never, operatorReq)).resolves.toMatchObject({ id: 2 });
    await expect(requireRole(prisma as never, operatorReq, "admin")).rejects.toThrow("Forbidden");
  });

  it("rejects when actor missing and supports bootstrap mode", async () => {
    const prismaWithUsers = {
      user: {
        count: async () => 1,
        findUnique: async () => null,
      },
    };
    const req = new Request("http://localhost");
    await expect(requireRole(prismaWithUsers as never, req, "admin")).rejects.toThrow("Unauthorized");
    await expect(requireAdminOrBootstrap(prismaWithUsers as never, req)).rejects.toThrow("Unauthorized");

    const prismaBootstrap = {
      user: {
        count: async () => 0,
      },
    };
    await expect(requireAdminOrBootstrap(prismaBootstrap as never, req)).resolves.toBeNull();
  });
});
