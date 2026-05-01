import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

type CameraRow = {
  id: number;
  name: string;
  url: string;
  snapshotUrl: string | null;
  isEnabled: boolean;
  status: "online" | "offline" | "unknown";
  lastCheckedAt: Date | null;
  lastOnlineAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MappingRow = {
  id: number;
  cameraId: number;
  tableId: number;
  detectionType: "snooker" | "pool" | "playstation" | "other";
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  roiAngle: number;
  roiTiltX: number;
  roiTiltY: number;
  roiKind: string;
  roiQuadrilateral: unknown;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type RoiPoint = { x: number; y: number };

type CameraModel = {
  findMany: (args?: Record<string, unknown>) => Promise<CameraRow[]>;
  findUnique: (args: { where: { id?: number; url?: string } }) => Promise<CameraRow | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<CameraRow>;
  update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<CameraRow>;
  delete: (args: { where: { id: number } }) => Promise<unknown>;
};

type MappingModel = {
  findMany: (args?: Record<string, unknown>) => Promise<MappingRow[]>;
  findUnique: (args: { where: { id?: number; cameraId_tableId?: { cameraId: number; tableId: number } } }) => Promise<MappingRow | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<MappingRow>;
  update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<MappingRow>;
  delete: (args: { where: { id: number } }) => Promise<unknown>;
};

type TableModel = {
  findUnique: (args: { where: { id: number } }) => Promise<{ id: number } | null>;
  findMany?: (args?: Record<string, unknown>) => Promise<Array<{ id: number; name: string }>>;
};

type CVPrismaLike = {
  camera?: CameraModel;
  cameras?: CameraModel;
  cameraTableMapping?: MappingModel;
  cameraTableMappings?: MappingModel;
  table: TableModel;
};

type DetectionType = "snooker" | "pool" | "playstation" | "other";
const WORKER_CONFIG_RELATIVE_PATH = resolve("dist", "cv-worker-config.json");
const SNAPSHOT_DIR = resolve("dist", "camera-snapshots");

type ProcessRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessRunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function getCameraModel(prisma: CVPrismaLike): CameraModel {
  const model = prisma.camera ?? prisma.cameras;
  if (!model) {
    throw new Error("Camera model is not available");
  }
  return model;
}

function getMappingModel(prisma: CVPrismaLike): MappingModel {
  const model = prisma.cameraTableMapping ?? prisma.cameraTableMappings;
  if (!model) {
    throw new Error("Camera mapping model is not available");
  }
  return model;
}

function normalizeCameraUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Camera URL is required");
  }
  if (!/^rtsp:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Camera URL must start with rtsp://, http://, or https://");
  }
  return trimmed;
}

function normalizeDetectionType(raw: string): DetectionType {
  const value = raw.trim().toLowerCase();
  if (value === "snooker" || value === "pool" || value === "playstation" || value === "other") {
    return value;
  }
  throw new Error("Invalid detectionType");
}

function normalizeRoi(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  tiltX?: number;
  tiltY?: number;
  kind?: string;
  quadrilateral?: unknown;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  tiltX: number;
  tiltY: number;
  kind: "rectangle" | "quadrilateral";
  quadrilateral: RoiPoint[] | null;
} {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    throw new Error("ROI x/y must be finite numbers");
  }
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error("ROI width/height must be greater than 0");
  }
  const angle = input.angle === undefined ? 0 : input.angle;
  if (!Number.isFinite(angle)) {
    throw new Error("ROI angle must be a finite number");
  }
  const tiltX = input.tiltX === undefined ? 0 : input.tiltX;
  if (!Number.isFinite(tiltX)) {
    throw new Error("ROI tiltX must be a finite number");
  }
  const tiltY = input.tiltY === undefined ? 0 : input.tiltY;
  if (!Number.isFinite(tiltY)) {
    throw new Error("ROI tiltY must be a finite number");
  }
  const requestedKind = (input.kind ?? "rectangle").trim().toLowerCase();
  if (requestedKind !== "rectangle" && requestedKind !== "quadrilateral") {
    throw new Error("Invalid ROI kind");
  }
  const kind = requestedKind as "rectangle" | "quadrilateral";

  let quadrilateral: RoiPoint[] | null = null;
  if (kind === "quadrilateral" || input.quadrilateral !== undefined) {
    if (!Array.isArray(input.quadrilateral) || input.quadrilateral.length !== 4) {
      throw new Error("Quadrilateral ROI must contain exactly 4 points");
    }
    quadrilateral = input.quadrilateral.map((point) => {
      if (
        typeof point !== "object"
        || point === null
        || !("x" in point)
        || !("y" in point)
        || !Number.isFinite((point as { x: number }).x)
        || !Number.isFinite((point as { y: number }).y)
      ) {
        throw new Error("Invalid quadrilateral point");
      }
      return { x: (point as { x: number }).x, y: (point as { y: number }).y };
    });
  }

  return { ...input, angle, tiltX, tiltY, kind, quadrilateral };
}

function parseQuadrilateral(value: unknown): RoiPoint[] | null {
  let normalized: unknown = value;
  if (typeof normalized === "string") {
    try {
      normalized = JSON.parse(normalized);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(normalized) || normalized.length !== 4) {
    return null;
  }
  const points: RoiPoint[] = [];
  for (const point of normalized) {
    if (
      typeof point !== "object"
      || point === null
      || !("x" in point)
      || !("y" in point)
      || !Number.isFinite((point as { x: number }).x)
      || !Number.isFinite((point as { y: number }).y)
    ) {
      return null;
    }
    points.push({ x: (point as { x: number }).x, y: (point as { y: number }).y });
  }
  return points;
}

function rotatePointAroundCenter(point: RoiPoint, center: RoiPoint, angleDeg: number): RoiPoint {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos),
  };
}

function polygonArea(points: RoiPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    area += points[index].x * points[nextIndex].y - points[nextIndex].x * points[index].y;
  }
  return area / 2;
}

function normalizePointOrder(points: RoiPoint[]): RoiPoint[] {
  const center = points.reduce(
    (acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }),
    { x: 0, y: 0 },
  );

  const byAngle = [...points].sort((a, b) => {
    const angleA = Math.atan2(a.y - center.y, a.x - center.x);
    const angleB = Math.atan2(b.y - center.y, b.x - center.x);
    return angleA - angleB;
  });

  // Rotate ordering so first point is closest to top-left.
  let startIndex = 0;
  let startScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < byAngle.length; index += 1) {
    const score = byAngle[index].x + byAngle[index].y;
    if (score < startScore) {
      startScore = score;
      startIndex = index;
    }
  }
  const rotated = byAngle.slice(startIndex).concat(byAngle.slice(0, startIndex));

  // Ensure clockwise ordering for OpenCV contour consistency.
  if (polygonArea(rotated) < 0) {
    return [rotated[0], rotated[3], rotated[2], rotated[1]];
  }
  return rotated;
}

function buildStandardRoi(mapping: MappingRow): {
  points: Array<[number, number]>;
  bbox: { x: number; y: number; width: number; height: number };
  coordinateSpace: "pixels";
  sourceResolution?: { width: number; height: number };
} {
  const quad = parseQuadrilateral(mapping.roiQuadrilateral);
  let points: RoiPoint[];
  if (mapping.roiKind === "quadrilateral" && quad) {
    points = quad;
  } else {
    const x1 = mapping.roiX;
    const y1 = mapping.roiY;
    const x2 = mapping.roiX + mapping.roiWidth;
    const y2 = mapping.roiY + mapping.roiHeight;
    points = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ];

    if (mapping.roiAngle) {
      const center = { x: mapping.roiX + mapping.roiWidth / 2, y: mapping.roiY + mapping.roiHeight / 2 };
      points = points.map((point) => rotatePointAroundCenter(point, center, mapping.roiAngle));
    }
  }

  const ordered = normalizePointOrder(points);
  const xs = ordered.map((point) => point.x);
  const ys = ordered.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    points: ordered.map((point) => [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100]),
    bbox: {
      x: Math.round(minX * 100) / 100,
      y: Math.round(minY * 100) / 100,
      width: Math.round((maxX - minX) * 100) / 100,
      height: Math.round((maxY - minY) * 100) / 100,
    },
    coordinateSpace: "pixels",
  };
}

async function getSnapshotResolution(cameraId: number): Promise<{ width: number; height: number } | null> {
  const snapshotPath = resolve(SNAPSHOT_DIR, `camera-${cameraId}.jpg`);
  try {
    const result = await runCommand(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        snapshotPath,
      ],
      3000,
    );
    if (result.code !== 0) {
      return null;
    }
    return parseResolutionFromProbeStdout(result.stdout);
  } catch {
    return null;
  }
}

export type CameraConnectionProbeResult = {
  status: "online" | "offline" | "unknown";
  detail: string;
  resolution: { width: number; height: number } | null;
};

function parseResolutionFromProbeStdout(raw: string): { width: number; height: number } | null {
  if (!raw) {
    return null;
  }
  try {
    const payload = JSON.parse(raw) as {
      streams?: Array<{ width?: number; height?: number }>;
    };
    if (!Array.isArray(payload.streams) || payload.streams.length === 0) {
      return null;
    }
    const stream = payload.streams[0];
    if (!Number.isFinite(stream.width) || !Number.isFinite(stream.height)) {
      return null;
    }
    const width = Math.trunc(stream.width as number);
    const height = Math.trunc(stream.height as number);
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

export async function probeCameraConnection(url: string): Promise<CameraConnectionProbeResult> {
  const normalized = normalizeCameraUrl(url);
  if (/^rtsp:\/\//i.test(normalized)) {
    try {
      const result = await runCommand(
        "ffprobe",
        [
          "-v",
          "error",
          "-rtsp_transport",
          "tcp",
          "-i",
          normalized,
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,width,height",
          "-of",
          "json",
        ],
        5000,
      );
      const resolution = parseResolutionFromProbeStdout(result.stdout);
      if (result.code === 0) {
        return {
          status: "online",
          detail: "RTSP stream reachable",
          resolution,
        };
      }
      return {
        status: "offline",
        detail: result.stderr || "RTSP probe failed",
        resolution,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "RTSP probe failed";
      return {
        status: "offline",
        detail: message,
        resolution: null,
      };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(normalized, {
      method: "HEAD",
      signal: controller.signal,
    });
    if (res.ok) {
      return { status: "online", detail: `HTTP ${res.status}`, resolution: null };
    }
    return { status: "offline", detail: `HTTP ${res.status}`, resolution: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Probe failed";
    return { status: "offline", detail: message, resolution: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function captureCameraSnapshot(url: string, cameraId: number): Promise<string> {
  const normalized = normalizeCameraUrl(url);
  const outputPath = resolve(SNAPSHOT_DIR, `camera-${cameraId}.jpg`);
  await mkdir(dirname(outputPath), { recursive: true });
  const attempts: Array<{ args: string[]; timeoutMs: number }> = [
    {
      // More fault-tolerant path for noisy/corrupt RTSP frames.
      args: [
        "-y",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-fflags",
        "+discardcorrupt",
        "-analyzeduration",
        "1000000",
        "-probesize",
        "1000000",
        "-i",
        normalized,
        "-an",
        "-sn",
        "-dn",
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "scale='min(1280,iw)':-1",
        "-q:v",
        "4",
        outputPath,
      ],
      timeoutMs: 20000,
    },
    {
      // Fallback plain capture path.
      args: [
        "-y",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        normalized,
        "-an",
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        outputPath,
      ],
      timeoutMs: 30000,
    },
  ];

  let lastError = "Failed to capture snapshot";
  for (const attempt of attempts) {
    const result = await runCommand("ffmpeg", attempt.args, attempt.timeoutMs);
    try {
      const file = await stat(outputPath);
      if (file.size > 0) {
        return outputPath;
      }
    } catch {
      // ignore stat errors; continue to next attempt
    }
    if (result.stderr) {
      lastError = result.stderr;
    } else if (result.code !== 0) {
      lastError = `ffmpeg exited with code ${String(result.code)}`;
    }
  }

  const compactError = lastError.split("\n").slice(-8).join(" ").trim();
  throw new Error(compactError || "Failed to capture snapshot");
}

export const cvConfigService = {
  getSnapshotFilePath(cameraId: number): string {
    return resolve(SNAPSHOT_DIR, `camera-${cameraId}.jpg`);
  },

  async readSnapshot(cameraId: number): Promise<Buffer> {
    const path = cvConfigService.getSnapshotFilePath(cameraId);
    return readFile(path);
  },

  async captureSnapshotForCamera(prisma: CVPrismaLike, cameraId: number): Promise<string> {
    const camera = await cvConfigService.getCameraById(prisma, cameraId);
    if (!camera) {
      throw new Error("Camera not found");
    }
    return captureCameraSnapshot(camera.url, cameraId);
  },

  async getCameraById(prisma: CVPrismaLike, id: number): Promise<CameraRow | null> {
    const model = getCameraModel(prisma);
    return model.findUnique({ where: { id } });
  },

  async listCameras(prisma: CVPrismaLike): Promise<CameraRow[]> {
    const model = getCameraModel(prisma);
    return model.findMany({ orderBy: [{ id: "asc" }] });
  },

  async createCamera(
    prisma: CVPrismaLike,
    input: { name: string; url: string; isEnabled?: boolean },
  ): Promise<CameraRow> {
    const model = getCameraModel(prisma);
    const name = input.name.trim();
    if (!name) {
      throw new Error("Camera name is required");
    }
    const url = normalizeCameraUrl(input.url);
    const existing = await model.findUnique({ where: { url } });
    if (existing) {
      throw new Error("Camera URL already exists");
    }
    return model.create({
      data: {
        name,
        url,
        snapshotUrl: null,
        isEnabled: input.isEnabled ?? true,
        status: "unknown",
      },
    });
  },

  async updateCamera(
    prisma: CVPrismaLike,
    input: {
      id: number;
      name?: string;
      url?: string;
      isEnabled?: boolean;
      status?: "online" | "offline" | "unknown";
      lastError?: string | null;
      touchCheckedAt?: boolean;
    },
  ): Promise<CameraRow> {
    const model = getCameraModel(prisma);
    const existing = await model.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new Error("Camera not found");
    }
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new Error("Camera name is required");
      }
      data.name = name;
    }
    if (input.url !== undefined) {
      const url = normalizeCameraUrl(input.url);
      const urlOwner = await model.findUnique({ where: { url } });
      if (urlOwner && urlOwner.id !== input.id) {
        throw new Error("Camera URL already exists");
      }
      data.url = url;
    }
    if (input.isEnabled !== undefined) {
      data.isEnabled = input.isEnabled;
    }
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === "online") {
        data.lastOnlineAt = new Date();
      }
    }
    if (input.lastError !== undefined) {
      data.lastError = input.lastError;
    }
    if (input.touchCheckedAt) {
      data.lastCheckedAt = new Date();
    }
    if (Object.keys(data).length === 0) {
      throw new Error("No fields to update");
    }
    return model.update({
      where: { id: input.id },
      data,
    });
  },

  async deleteCamera(prisma: CVPrismaLike, input: { id: number }): Promise<void> {
    const model = getCameraModel(prisma);
    const existing = await model.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new Error("Camera not found");
    }
    await model.delete({ where: { id: input.id } });
  },

  async listMappings(
    prisma: CVPrismaLike,
    input?: { cameraId?: number },
  ): Promise<MappingRow[]> {
    const model = getMappingModel(prisma);
    if (input?.cameraId) {
      return model.findMany({
        where: { cameraId: input.cameraId },
        orderBy: [{ id: "asc" }],
      });
    }
    return model.findMany({ orderBy: [{ id: "asc" }] });
  },

  async createMapping(
    prisma: CVPrismaLike,
    input: {
      cameraId: number;
      tableId: number;
      detectionType: string;
      roi: {
        x: number;
        y: number;
        width: number;
        height: number;
        angle?: number;
        tiltX?: number;
        tiltY?: number;
        kind?: string;
        quadrilateral?: unknown;
      };
      isEnabled?: boolean;
    },
  ): Promise<MappingRow> {
    const cameraModel = getCameraModel(prisma);
    const model = getMappingModel(prisma);
    if (!Number.isInteger(input.cameraId) || input.cameraId <= 0) {
      throw new Error("Invalid cameraId");
    }
    if (!Number.isInteger(input.tableId) || input.tableId <= 0) {
      throw new Error("Invalid tableId");
    }
    const camera = await cameraModel.findUnique({ where: { id: input.cameraId } });
    if (!camera) {
      throw new Error("Camera not found");
    }
    const table = await prisma.table.findUnique({ where: { id: input.tableId } });
    if (!table) {
      throw new Error("Table not found");
    }
    const existing = await model.findUnique({
      where: { cameraId_tableId: { cameraId: input.cameraId, tableId: input.tableId } },
    });
    if (existing) {
      throw new Error("Mapping already exists for this camera and table");
    }
    const detectionType = normalizeDetectionType(input.detectionType);
    const roi = normalizeRoi(input.roi);
    return model.create({
      data: {
        cameraId: input.cameraId,
        tableId: input.tableId,
        detectionType,
        roiX: roi.x,
        roiY: roi.y,
        roiWidth: roi.width,
        roiHeight: roi.height,
        roiAngle: roi.angle,
        roiTiltX: roi.tiltX,
        roiTiltY: roi.tiltY,
        roiKind: roi.kind,
        roiQuadrilateral: roi.quadrilateral,
        isEnabled: input.isEnabled ?? true,
      },
    });
  },

  async updateMapping(
    prisma: CVPrismaLike,
    input: {
      id: number;
      detectionType?: string;
      roi?: {
        x: number;
        y: number;
        width: number;
        height: number;
        angle?: number;
        tiltX?: number;
        tiltY?: number;
        kind?: string;
        quadrilateral?: unknown;
      };
      isEnabled?: boolean;
    },
  ): Promise<MappingRow> {
    const model = getMappingModel(prisma);
    const existing = await model.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new Error("Mapping not found");
    }
    const data: Record<string, unknown> = {};
    if (input.detectionType !== undefined) {
      data.detectionType = normalizeDetectionType(input.detectionType);
    }
    if (input.roi !== undefined) {
      const roi = normalizeRoi(input.roi);
      data.roiX = roi.x;
      data.roiY = roi.y;
      data.roiWidth = roi.width;
      data.roiHeight = roi.height;
      data.roiAngle = roi.angle;
      data.roiTiltX = roi.tiltX;
      data.roiTiltY = roi.tiltY;
      data.roiKind = roi.kind;
      data.roiQuadrilateral = roi.quadrilateral;
    }
    if (input.isEnabled !== undefined) {
      data.isEnabled = input.isEnabled;
    }
    if (Object.keys(data).length === 0) {
      throw new Error("No fields to update");
    }
    return model.update({
      where: { id: input.id },
      data,
    });
  },

  async deleteMapping(prisma: CVPrismaLike, input: { id: number }): Promise<void> {
    const model = getMappingModel(prisma);
    const existing = await model.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new Error("Mapping not found");
    }
    await model.delete({ where: { id: input.id } });
  },

  async buildWorkerConfig(prisma: CVPrismaLike): Promise<Record<string, unknown>> {
    const cameraModel = getCameraModel(prisma);
    const mappingModel = getMappingModel(prisma);
    const [cameras, mappings, tables] = await Promise.all([
      cameraModel.findMany({ orderBy: [{ id: "asc" }] }),
      mappingModel.findMany({ orderBy: [{ id: "asc" }] }),
      prisma.table.findMany ? prisma.table.findMany({ select: { id: true, name: true } }) : Promise.resolve([]),
    ]);

    const tableNameById = new Map<number, string>();
    for (const table of tables) {
      tableNameById.set(table.id, table.name);
    }

    const mappingsByCamera = new Map<number, MappingRow[]>();
    for (const row of mappings) {
      if (!mappingsByCamera.has(row.cameraId)) {
        mappingsByCamera.set(row.cameraId, []);
      }
      mappingsByCamera.get(row.cameraId)?.push(row);
    }
    const snapshotResolutionEntries = await Promise.all(
      cameras.map(async (camera) => [camera.id, await getSnapshotResolution(camera.id)] as const),
    );
    const snapshotResolutionByCamera = new Map<number, { width: number; height: number } | null>(
      snapshotResolutionEntries,
    );

    return {
      generatedAt: new Date().toISOString(),
      schemaVersion: 5,
      cameras: cameras.map((camera) => ({
        id: camera.id,
        name: camera.name,
        url: camera.url,
        snapshotUrl: camera.snapshotUrl,
        enabled: camera.isEnabled,
        status: camera.status,
        sourceResolution: snapshotResolutionByCamera.get(camera.id) ?? null,
        mappings: (mappingsByCamera.get(camera.id) ?? []).map((mapping) => ({
          id: mapping.id,
          tableId: mapping.tableId,
          tableName: tableNameById.get(mapping.tableId) ?? null,
          detectionType: mapping.detectionType,
          enabled: mapping.isEnabled,
          roi: (() => {
            const roi = buildStandardRoi(mapping);
            const sourceResolution = snapshotResolutionByCamera.get(camera.id) ?? null;
            if (sourceResolution) {
              return { ...roi, sourceResolution };
            }
            return roi;
          })(),
        })),
      })),
    };
  },

  async writeWorkerConfigToFile(payload: Record<string, unknown>): Promise<string> {
    const absPath = WORKER_CONFIG_RELATIVE_PATH;
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, JSON.stringify(payload, null, 2), "utf-8");
    return absPath;
  },
};
