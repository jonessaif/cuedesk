import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createUser, deleteUser, listUsers, updateUser } from "@/lib/users-service";

type UserRow = {
  id: number;
  name: string;
  pinHash: string;
  role: "operator" | "admin";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function createPrismaMock(seedUsers: UserRow[] = []): PrismaClient {
  const users = seedUsers.map((u) => ({ ...u }));

  return {
    user: {
      findMany: async () => users.slice().sort((a, b) => a.id - b.id),
      findFirst: async ({
        where,
      }: {
        where: { pinHash?: string; id?: { not: number }; isActive?: boolean };
      }) =>
        users.find((u) => {
          if (typeof where.pinHash === "string" && u.pinHash !== where.pinHash) {
            return false;
          }
          if (where.id?.not !== undefined && u.id === where.id.not) {
            return false;
          }
          if (typeof where.isActive === "boolean" && u.isActive !== where.isActive) {
            return false;
          }
          return true;
        }) ?? null,
      findUnique: async ({ where }: { where: { id: number } }) =>
        users.find((u) => u.id === where.id) ?? null,
      create: async ({
        data,
      }: {
        data: { name: string; pinHash: string; role: "operator" | "admin"; isActive: boolean };
      }) => {
        const now = new Date();
        const created: UserRow = {
          id: users.length + 1,
          name: data.name,
          pinHash: data.pinHash,
          role: data.role,
          isActive: data.isActive,
          createdAt: now,
          updatedAt: now,
        };
        users.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: number };
        data: { name?: string; pinHash?: string; role?: "operator" | "admin"; isActive?: boolean };
      }) => {
        const idx = users.findIndex((u) => u.id === where.id);
        if (idx === -1) {
          throw new Error("User not found");
        }
        users[idx] = {
          ...users[idx],
          ...data,
          updatedAt: new Date(),
        };
        return users[idx];
      },
      delete: async ({ where }: { where: { id: number } }) => {
        const idx = users.findIndex((u) => u.id === where.id);
        if (idx === -1) {
          throw new Error("User not found");
        }
        const deleted = users[idx];
        users.splice(idx, 1);
        return deleted;
      },
    },
  } as unknown as PrismaClient;
}

describe("Users management", () => {
  it("should create user with role", async () => {
    const prisma = createPrismaMock();
    const user = await createUser(prisma, { name: "Admin One", pin: "1234", role: "admin" });
    expect(user).toMatchObject({ name: "Admin One", role: "admin", isActive: true });
  });

  it("should list users", async () => {
    const now = new Date();
    const prisma = createPrismaMock([
      { id: 1, name: "A", pinHash: "pa", role: "admin", isActive: true, createdAt: now, updatedAt: now },
      { id: 2, name: "B", pinHash: "pb", role: "operator", isActive: true, createdAt: now, updatedAt: now },
    ]);
    const rows = await listUsers(prisma);
    expect(rows).toHaveLength(2);
  });

  it("should update user role", async () => {
    const now = new Date();
    const prisma = createPrismaMock([
      { id: 1, name: "A", pinHash: "pa", role: "operator", isActive: true, createdAt: now, updatedAt: now },
    ]);
    const updated = await updateUser(prisma, { id: 1, role: "admin" });
    expect(updated.role).toBe("admin");
  });

  it("should prevent deleting own user", async () => {
    const now = new Date();
    const prisma = createPrismaMock([
      { id: 1, name: "A", pinHash: "pa", role: "admin", isActive: true, createdAt: now, updatedAt: now },
    ]);
    await expect(deleteUser(prisma, { id: 1, actorUserId: 1 })).rejects.toThrow(
      "You cannot delete yourself",
    );
  });
});
