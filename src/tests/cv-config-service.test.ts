import { describe, expect, it, vi } from "vitest";
import { cvConfigService } from "@/lib/services/cv-config-service";

describe("cv-config-service", () => {
  it("creates and updates camera with validation", async () => {
    const cameraModel = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1, name: "Cam A", url: "rtsp://a", snapshotUrl: null }),
      create: vi.fn().mockResolvedValue({
        id: 1,
        name: "Cam A",
        url: "rtsp://a",
        snapshotUrl: null,
        isEnabled: true,
        status: "unknown",
      }),
      update: vi.fn().mockResolvedValue({
        id: 1,
        name: "Cam B",
        url: "rtsp://a",
        snapshotUrl: null,
        isEnabled: false,
        status: "online",
      }),
      delete: vi.fn(),
    };

    const prisma = {
      camera: cameraModel,
      table: { findUnique: vi.fn() },
      cameraTableMapping: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };

    const created = await cvConfigService.createCamera(prisma as never, {
      name: "Cam A",
      url: "rtsp://a",
    });
    expect(created.id).toBe(1);
    expect(cameraModel.create).toHaveBeenCalledTimes(1);

    const updated = await cvConfigService.updateCamera(prisma as never, {
      id: 1,
      name: "Cam B",
      isEnabled: false,
      status: "online",
      touchCheckedAt: true,
    });
    expect(updated.name).toBe("Cam B");
    expect(cameraModel.update).toHaveBeenCalledTimes(1);
  });

  it("creates, updates, lists and deletes mapping", async () => {
    const mappingModel = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 9, cameraId: 1, tableId: 2 })
        .mockResolvedValueOnce({ id: 9, cameraId: 1, tableId: 2 }),
      create: vi.fn().mockResolvedValue({
        id: 9,
        cameraId: 1,
        tableId: 2,
        detectionType: "snooker",
        roiX: 10,
        roiY: 20,
        roiWidth: 120,
        roiHeight: 80,
        roiAngle: 0,
        roiTiltX: 0,
        roiTiltY: 0,
        roiKind: "rectangle",
        roiQuadrilateral: null,
        isEnabled: true,
      }),
      update: vi.fn().mockResolvedValue({
        id: 9,
        cameraId: 1,
        tableId: 2,
        detectionType: "pool",
        roiX: 12,
        roiY: 22,
        roiWidth: 110,
        roiHeight: 70,
        roiAngle: 15,
        roiTiltX: -10,
        roiTiltY: 12,
        roiKind: "rectangle",
        roiQuadrilateral: null,
        isEnabled: false,
      }),
      delete: vi.fn().mockResolvedValue({}),
    };
    const prisma = {
      camera: {
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ id: 1 }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      table: {
        findUnique: vi.fn().mockResolvedValue({ id: 2 }),
      },
      cameraTableMapping: mappingModel,
    };

    const created = await cvConfigService.createMapping(prisma as never, {
      cameraId: 1,
      tableId: 2,
      detectionType: "snooker",
      roi: { x: 10, y: 20, width: 120, height: 80 },
    });
    expect(created.id).toBe(9);

    const updated = await cvConfigService.updateMapping(prisma as never, {
      id: 9,
      detectionType: "pool",
      roi: { x: 12, y: 22, width: 110, height: 70 },
      isEnabled: false,
    });
    expect(updated.detectionType).toBe("pool");

    await cvConfigService.deleteMapping(prisma as never, { id: 9 });
    expect(mappingModel.delete).toHaveBeenCalledWith({ where: { id: 9 } });
  });

  it("builds worker config grouped by camera", async () => {
    const prisma = {
      camera: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1,
            name: "Cam 1",
            url: "rtsp://cam1",
            snapshotUrl: "http://cam1/snap.jpg",
            isEnabled: true,
            status: "online",
            lastCheckedAt: null,
            lastOnlineAt: null,
            lastError: null,
            createdAt: new Date("2026-04-22T00:00:00.000Z"),
            updatedAt: new Date("2026-04-22T00:00:00.000Z"),
          },
        ]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      table: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 4, name: "Table 4" }]),
      },
      cameraTableMapping: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 11,
            cameraId: 1,
            tableId: 4,
            detectionType: "playstation",
            roiX: 10,
            roiY: 10,
            roiWidth: 100,
            roiHeight: 50,
            roiAngle: 25,
            roiTiltX: -8,
            roiTiltY: 14,
            roiKind: "quadrilateral",
            roiQuadrilateral: [
              { x: 10, y: 10 },
              { x: 110, y: 12 },
              { x: 102, y: 62 },
              { x: 9, y: 58 },
            ],
            isEnabled: true,
            createdAt: new Date("2026-04-22T00:00:00.000Z"),
            updatedAt: new Date("2026-04-22T00:00:00.000Z"),
          },
        ]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    const config = await cvConfigService.buildWorkerConfig(prisma as never);
    const cameras = (config.cameras ?? []) as Array<{ mappings: Array<{ tableId: number }> }>;
    expect(cameras).toHaveLength(1);
    expect(cameras[0].mappings[0].tableId).toBe(4);
    expect((cameras[0].mappings[0] as { tableName: string | null }).tableName).toBe("Table 4");
    const roi = (cameras[0].mappings[0] as {
      roi: {
        points: Array<[number, number]>;
        bbox: { x: number; y: number; width: number; height: number };
        coordinateSpace: string;
      };
    }).roi;
    expect(roi.coordinateSpace).toBe("pixels");
    expect(roi.points).toHaveLength(4);
    expect(roi.bbox.width).toBeGreaterThan(0);
    expect(roi.bbox.height).toBeGreaterThan(0);
  });
});
