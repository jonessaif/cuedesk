import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { describe, expect, it, vi } from "vitest";

import {
  createUser,
  deleteUser,
  findActiveUserByPin,
  updateUser,
} from "@/lib/users-service";

function legacyHash(pin: string): string {
  return createHash("sha256").update(`cuedesk-pin:${pin}`).digest("hex");
}

describe("users-service extra coverage", () => {
  it("createUser validates name/role and duplicate pin", async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 2, pinHash: legacyHash("1234") }]),
        create: vi.fn(),
      },
    };
    await expect(createUser(prisma as never, { name: " ", pin: "1234", role: "admin" })).rejects.toThrow("name is required");
    await expect(createUser(prisma as never, { name: "A", pin: "1234", role: "x" as never })).rejects.toThrow("Invalid role");
    await expect(createUser(prisma as never, { name: "A", pin: "1234", role: "admin" })).rejects.toThrow("PIN already in use");
  });

  it("updateUser validates not-found/invalid/no-fields/pin-duplicate", async () => {
    const prismaNotFound = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    await expect(updateUser(prismaNotFound as never, { id: 1, name: "A" })).rejects.toThrow("User not found");

    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 1, name: "A", pinHash: legacyHash("9999"), role: "admin", isActive: true }),
        findMany: vi.fn().mockResolvedValue([{ id: 2, pinHash: legacyHash("1234") }]),
        update: vi.fn().mockResolvedValue({ id: 1 }),
      },
    };
    await expect(updateUser(prisma as never, { id: 1 })).rejects.toThrow("No fields to update");
    await expect(updateUser(prisma as never, { id: 1, name: "   " })).rejects.toThrow("name is required");
    await expect(updateUser(prisma as never, { id: 1, role: "x" as never })).rejects.toThrow("Invalid role");
    await expect(updateUser(prisma as never, { id: 1, pin: "1234" })).rejects.toThrow("PIN already in use");
  });

  it("deleteUser throws for missing user", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    await expect(deleteUser(prisma as never, { id: 7 })).rejects.toThrow("User not found");
  });

  it("findActiveUserByPin validates pin and supports legacy hash upgrade", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 4, pinHash: legacyHash("1234"), isActive: true },
        ]),
        update,
      },
    };
    await expect(findActiveUserByPin(prisma as never, "12")).rejects.toThrow("PIN must be exactly 4 digits");
    const user = await findActiveUserByPin(prisma as never, "1234");
    expect(user).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("findActiveUserByPin matches bcrypt hash path", async () => {
    const pinHash = await hash("5555", 10);
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 2, pinHash, isActive: true }]),
        update: vi.fn(),
      },
    };
    const user = await findActiveUserByPin(prisma as never, "5555");
    expect(user).toBeTruthy();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
