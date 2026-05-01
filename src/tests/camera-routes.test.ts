import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listCameras: vi.fn(),
  getCameraById: vi.fn(),
  createCamera: vi.fn(),
  updateCamera: vi.fn(),
  deleteCamera: vi.fn(),
  captureSnapshotForCamera: vi.fn(),
  readSnapshot: vi.fn(),
  listMappings: vi.fn(),
  createMapping: vi.fn(),
  updateMapping: vi.fn(),
  deleteMapping: vi.fn(),
  buildWorkerConfig: vi.fn(),
  writeWorkerConfigToFile: vi.fn(),
  probeCameraConnection: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/authz", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/services/cv-config-service", () => ({
  cvConfigService: {
    listCameras: mocks.listCameras,
    getCameraById: mocks.getCameraById,
    createCamera: mocks.createCamera,
    updateCamera: mocks.updateCamera,
    deleteCamera: mocks.deleteCamera,
    captureSnapshotForCamera: mocks.captureSnapshotForCamera,
    readSnapshot: mocks.readSnapshot,
    listMappings: mocks.listMappings,
    createMapping: mocks.createMapping,
    updateMapping: mocks.updateMapping,
    deleteMapping: mocks.deleteMapping,
    buildWorkerConfig: mocks.buildWorkerConfig,
    writeWorkerConfigToFile: mocks.writeWorkerConfigToFile,
  },
  probeCameraConnection: mocks.probeCameraConnection,
}));

import { GET as camerasGet, POST as camerasPost } from "@/app/api/cameras/route";
import { PATCH as cameraPatch, DELETE as cameraDelete } from "@/app/api/cameras/[id]/route";
import { POST as cameraProbePost } from "@/app/api/cameras/[id]/probe/route";
import { GET as cameraSnapshotGet } from "@/app/api/cameras/[id]/snapshot/route";
import { GET as mappingsGet, POST as mappingsPost } from "@/app/api/camera-mappings/route";
import { PATCH as mappingPatch, DELETE as mappingDelete } from "@/app/api/camera-mappings/[id]/route";
import { GET as cvConfigGet } from "@/app/api/cv/config/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("camera config routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ id: 1, role: "admin" });
    mocks.listCameras.mockResolvedValue([{ id: 1, name: "A", url: "rtsp://cam" }]);
    mocks.getCameraById.mockResolvedValue({ id: 1, name: "A", url: "rtsp://cam" });
    mocks.createCamera.mockResolvedValue({ id: 2, name: "B", url: "rtsp://cam2" });
    mocks.updateCamera.mockResolvedValue({ id: 1, name: "A-updated", url: "rtsp://cam" });
    mocks.deleteCamera.mockResolvedValue(undefined);
    mocks.captureSnapshotForCamera.mockResolvedValue("/tmp/camera-1.jpg");
    mocks.readSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.listMappings.mockResolvedValue([{ id: 11, cameraId: 1, tableId: 2 }]);
    mocks.createMapping.mockResolvedValue({ id: 12, cameraId: 1, tableId: 3 });
    mocks.updateMapping.mockResolvedValue({ id: 11, detectionType: "pool" });
    mocks.deleteMapping.mockResolvedValue(undefined);
    mocks.buildWorkerConfig.mockResolvedValue({ cameras: [] });
    mocks.writeWorkerConfigToFile.mockResolvedValue("/tmp/cv-worker-config.json");
    mocks.probeCameraConnection.mockResolvedValue({ status: "online", detail: "HTTP 200" });
  });

  it("covers camera CRUD and probe endpoints", async () => {
    let res = await camerasGet(new Request("http://localhost/api/cameras"));
    expect(res.status).toBe(200);

    res = await camerasPost(jsonRequest("http://localhost/api/cameras", "POST", {
      name: "B",
      url: "rtsp://cam2",
    }));
    expect(res.status).toBe(201);

    res = await cameraPatch(
      jsonRequest("http://localhost/api/cameras/1", "PATCH", { name: "A-updated" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(200);

    res = await cameraDelete(
      new Request("http://localhost/api/cameras/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(200);

    res = await cameraProbePost(new Request("http://localhost/api/cameras/1/probe", { method: "POST" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.probeCameraConnection).toHaveBeenCalledWith("rtsp://cam");
    expect(mocks.captureSnapshotForCamera).toHaveBeenCalledWith(expect.anything(), 1);

    res = await cameraSnapshotGet(new Request("http://localhost/api/cameras/1/snapshot?refresh=1"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.captureSnapshotForCamera).toHaveBeenCalledWith(expect.anything(), 1);
    expect(mocks.readSnapshot).toHaveBeenCalledWith(1);
  });

  it("covers mapping and config export endpoints", async () => {
    let res = await mappingsGet(new Request("http://localhost/api/camera-mappings?cameraId=1"));
    expect(res.status).toBe(200);

    res = await mappingsPost(jsonRequest("http://localhost/api/camera-mappings", "POST", {
      cameraId: 1,
      tableId: 2,
      detectionType: "snooker",
      roi: {
        x: 1,
        y: 2,
        width: 10,
        height: 20,
        angle: 30,
        tiltX: -10,
        tiltY: 12,
        kind: "quadrilateral",
        quadrilateral: [
          { x: 1, y: 2 },
          { x: 11, y: 3 },
          { x: 10, y: 19 },
          { x: 2, y: 20 },
        ],
      },
    }));
    expect(res.status).toBe(201);
    expect(mocks.createMapping).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      roi: expect.objectContaining({ angle: 30, tiltX: -10, tiltY: 12, kind: "quadrilateral" }),
    }));

    res = await mappingPatch(
      jsonRequest("http://localhost/api/camera-mappings/11", "PATCH", { detectionType: "pool" }),
      { params: Promise.resolve({ id: "11" }) },
    );
    expect(res.status).toBe(200);

    res = await mappingDelete(
      new Request("http://localhost/api/camera-mappings/11", { method: "DELETE" }),
      { params: Promise.resolve({ id: "11" }) },
    );
    expect(res.status).toBe(200);

    res = await cvConfigGet(new Request("http://localhost/api/cv/config?write=1"));
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid ids and params", async () => {
    let res = await cameraPatch(
      jsonRequest("http://localhost/api/cameras/abc", "PATCH", { name: "x" }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(400);

    res = await mappingsGet(new Request("http://localhost/api/camera-mappings?cameraId=abc"));
    expect(res.status).toBe(400);

    res = await mappingDelete(
      new Request("http://localhost/api/camera-mappings/not-id", { method: "DELETE" }),
      { params: Promise.resolve({ id: "not-id" }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when snapshot file is missing", async () => {
    mocks.readSnapshot.mockRejectedValueOnce(new Error("ENOENT: no such file or directory"));
    const res = await cameraSnapshotGet(new Request("http://localhost/api/cameras/1/snapshot"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: string };
    expect(body.error).toContain("No snapshot found");
  });
});
