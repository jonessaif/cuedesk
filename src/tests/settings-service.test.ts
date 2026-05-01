import { describe, expect, it, vi } from "vitest";

type PrismaLike = {
  appConfig?: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

async function loadSettingsService() {
  vi.resetModules();
  return import("@/lib/settings-service");
}

describe("settings-service", () => {
  it("uses default when appConfig model is missing", async () => {
    const svc = await loadSettingsService();
    const prisma = {} as PrismaLike;
    const value = await svc.getLedgerResetMinutes(prisma as never);
    expect(value).toBe(600);
  });

  it("hydrates cache from stored config and then serves cached value", async () => {
    const svc = await loadSettingsService();
    const prisma: PrismaLike = {
      appConfig: {
        findFirst: vi.fn().mockResolvedValue({ id: 1, ledgerResetMinutes: 540 }),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    const first = await svc.hydrateLedgerResetMinutesCache(prisma as never);
    const second = await svc.hydrateLedgerResetMinutesCache(prisma as never);
    expect(first).toBe(540);
    expect(second).toBe(540);
    expect(prisma.appConfig?.findFirst).toHaveBeenCalledTimes(1);
  });

  it("creates config row when none exists", async () => {
    const svc = await loadSettingsService();
    const prisma: PrismaLike = {
      appConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 1 }),
      },
    };
    const next = await svc.setLedgerResetMinutes(prisma as never, 650);
    expect(next).toBe(650);
    expect(prisma.appConfig?.create).toHaveBeenCalledWith({
      data: { ledgerResetMinutes: 650 },
    });
  });

  it("updates existing config row", async () => {
    const svc = await loadSettingsService();
    const prisma: PrismaLike = {
      appConfig: {
        findFirst: vi.fn().mockResolvedValue({ id: 2, ledgerResetMinutes: 600 }),
        update: vi.fn().mockResolvedValue({ id: 2 }),
        create: vi.fn(),
      },
    };
    const next = await svc.setLedgerResetMinutes(prisma as never, 720);
    expect(next).toBe(720);
    expect(prisma.appConfig?.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { ledgerResetMinutes: 720 },
    });
  });

  it("throws on invalid reset values and missing model", async () => {
    const svc = await loadSettingsService();
    await expect(svc.setLedgerResetMinutes({} as never, 500)).rejects.toThrow(
      "Settings model is not available",
    );
    await expect(svc.setLedgerResetMinutes({ appConfig: {} } as never, -1)).rejects.toThrow(
      "Invalid ledger reset time",
    );
    await expect(svc.setLedgerResetMinutes({ appConfig: {} } as never, 1440)).rejects.toThrow(
      "Invalid ledger reset time",
    );
  });
});
