import { describe, expect, it, vi } from "vitest";
import { visionEventService } from "@/lib/services/vision-event-service";

describe("vision-event-service", () => {
  it("ingests validated camera-linked event", async () => {
    const create = vi.fn().mockResolvedValue({
      id: 1,
      tableId: 2,
      cameraId: 5,
      detectionType: "snooker",
      event: "start",
      confidence: 0.9,
      eventAt: new Date("2026-04-22T10:00:00.000Z"),
      source: "cv-worker",
      payload: null,
      receivedAt: new Date("2026-04-22T10:00:01.000Z"),
    });
    const prisma = {
      table: { findUnique: vi.fn().mockResolvedValue({ id: 2 }) },
      camera: { findUnique: vi.fn().mockResolvedValue({ id: 5 }) },
      cameraTableMapping: { findFirst: vi.fn().mockResolvedValue({ id: 99 }) },
      visionEventRaw: { create },
    };
    const row = await visionEventService.ingest(prisma as never, {
      tableId: 2,
      cameraId: 5,
      detectionType: "snooker",
      event: "start",
      confidence: 0.9,
      eventAt: "2026-04-22T10:00:00.000Z",
    });
    expect(row.id).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid payloads and missing mapping", async () => {
    const base = {
      table: { findUnique: vi.fn().mockResolvedValue({ id: 2 }) },
      camera: { findUnique: vi.fn().mockResolvedValue({ id: 5 }) },
      cameraTableMapping: { findFirst: vi.fn().mockResolvedValue(null) },
      visionEventRaw: { create: vi.fn() },
    };

    await expect(
      visionEventService.ingest(base as never, {
        tableId: 2,
        cameraId: 5,
        detectionType: "snooker",
        event: "start",
      }),
    ).rejects.toThrow("No enabled mapping found");

    await expect(
      visionEventService.ingest(base as never, {
        tableId: 2,
        event: "bad",
      }),
    ).rejects.toThrow("Invalid event type");

    await expect(
      visionEventService.ingest(base as never, {
        tableId: 2,
        event: "end",
        confidence: 2,
      }),
    ).rejects.toThrow("Invalid confidence");
  });
});
