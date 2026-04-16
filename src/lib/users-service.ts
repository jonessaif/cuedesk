import { createHash } from "node:crypto";
import { compare, hash } from "bcryptjs";
import type { PrismaClient, User, UserRole } from "@prisma/client";

export type CreateUserInput = {
  name: string;
  pin: string;
  role: UserRole;
  isActive?: boolean;
};

export type UpdateUserInput = {
  id: number;
  name?: string;
  pin?: string;
  role?: UserRole;
  isActive?: boolean;
};

function normalizePin(pinInput: string): string {
  const pin = pinInput.trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits");
  }
  return pin;
}

function hashLegacyPin(pin: string): string {
  return createHash("sha256").update(`cuedesk-pin:${pin}`).digest("hex");
}

async function hashPinForStorage(pinInput: string): Promise<string> {
  const pin = normalizePin(pinInput);
  return hash(pin, 10);
}

async function isPinInUse(
  prisma: PrismaClient,
  pinInput: string,
  excludeUserId?: number,
): Promise<boolean> {
  const pin = normalizePin(pinInput);
  const legacyHash = hashLegacyPin(pin);
  const users = await prisma.user.findMany({
    where: excludeUserId ? { id: { not: excludeUserId } } : undefined,
    select: {
      id: true,
      pinHash: true,
    },
  });

  for (const user of users) {
    if (user.pinHash === legacyHash) {
      return true;
    }
    if (await compare(pin, user.pinHash)) {
      return true;
    }
  }

  return false;
}

export async function listUsers(prisma: PrismaClient): Promise<User[]> {
  return prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { id: "asc" }],
  });
}

export async function createUser(
  prisma: PrismaClient,
  input: CreateUserInput,
): Promise<User> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("name is required");
  }
  if (input.role !== "admin" && input.role !== "operator") {
    throw new Error("Invalid role");
  }

  const pinHash = await hashPinForStorage(input.pin);
  const pinTaken = await isPinInUse(prisma, input.pin);
  if (pinTaken) {
    throw new Error("PIN already in use");
  }

  return prisma.user.create({
    data: {
      name,
      pinHash,
      role: input.role,
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateUser(
  prisma: PrismaClient,
  input: UpdateUserInput,
): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: { id: input.id },
  });
  if (!existing) {
    throw new Error("User not found");
  }

  const data: { name?: string; pinHash?: string; role?: UserRole; isActive?: boolean } = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new Error("name is required");
    }
    data.name = trimmed;
  }
  if (input.pin !== undefined) {
    const pinHash = await hashPinForStorage(input.pin);
    const pinTaken = await isPinInUse(prisma, input.pin, input.id);
    if (pinTaken) {
      throw new Error("PIN already in use");
    }
    data.pinHash = pinHash;
  }
  if (input.role !== undefined) {
    if (input.role !== "admin" && input.role !== "operator") {
      throw new Error("Invalid role");
    }
    data.role = input.role;
  }
  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  if (Object.keys(data).length === 0) {
    throw new Error("No fields to update");
  }

  return prisma.user.update({
    where: { id: input.id },
    data,
  });
}

export async function deleteUser(
  prisma: PrismaClient,
  input: { id: number; actorUserId?: number },
): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { id: input.id },
  });
  if (!existing) {
    throw new Error("User not found");
  }
  if (typeof input.actorUserId === "number" && input.actorUserId === input.id) {
    throw new Error("You cannot delete yourself");
  }

  await prisma.user.delete({
    where: { id: input.id },
  });
}

export async function findActiveUserByPin(
  prisma: PrismaClient,
  pinInput: string,
): Promise<User | null> {
  const pin = normalizePin(pinInput);
  const legacyHash = hashLegacyPin(pin);
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
  });

  for (const user of users) {
    if (await compare(pin, user.pinHash)) {
      return user;
    }
    if (user.pinHash === legacyHash) {
      const upgradedHash = await hash(pin, 10);
      await prisma.user.update({
        where: { id: user.id },
        data: { pinHash: upgradedHash },
      });
      return user;
    }
  }

  return null;
}
