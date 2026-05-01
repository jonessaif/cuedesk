type DetectionType = "snooker" | "pool" | "playstation" | "other";
type EventType = "start" | "end";

type VisionEventRow = {
  id: number;
  tableId: number;
  cameraId: number | null;
  detectionType: DetectionType | null;
  event: EventType;
  confidence: number | null;
  eventAt: Date;
  source: string;
  payload: unknown;
  receivedAt: Date;
};

type EventModel = {
  create: (args: { data: Record<string, unknown> }) => Promise<VisionEventRow>;
};

type MappingModel = {
  findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: number } | null>;
};

type TableModel = {
  findUnique: (args: { where: { id: number } }) => Promise<{ id: number } | null>;
};

type CameraModel = {
  findUnique: (args: { where: { id: number } }) => Promise<{ id: number } | null>;
};

type VisionPrismaLike = {
  visionEventRaw?: EventModel;
  visionEventsRaw?: EventModel;
  cameraTableMapping?: MappingModel;
  cameraTableMappings?: MappingModel;
  table: TableModel;
  camera?: CameraModel;
  cameras?: CameraModel;
};

type IngestInput = {
  tableId: number;
  cameraId?: number;
  detectionType?: string;
  event: string;
  confidence?: number;
  eventAt?: string;
  source?: string;
  payload?: unknown;
};

function getEventModel(prisma: VisionPrismaLike): EventModel {
  const model = prisma.visionEventRaw ?? prisma.visionEventsRaw;
  if (!model) {
    throw new Error("Vision event model is not available");
  }
  return model;
}

function getMappingModel(prisma: VisionPrismaLike): MappingModel | null {
  return prisma.cameraTableMapping ?? prisma.cameraTableMappings ?? null;
}

function getCameraModel(prisma: VisionPrismaLike): CameraModel | null {
  return prisma.camera ?? prisma.cameras ?? null;
}

function normalizeDetectionType(raw: string): DetectionType {
  const value = raw.trim().toLowerCase();
  if (value === "snooker" || value === "pool" || value === "playstation" || value === "other") {
    return value;
  }
  throw new Error("Invalid detectionType");
}

function normalizeEvent(raw: string): EventType {
  const value = raw.trim().toLowerCase();
  if (value === "start" || value === "end") {
    return value;
  }
  throw new Error("Invalid event type");
}

export const visionEventService = {
  async ingest(prisma: VisionPrismaLike, input: IngestInput): Promise<VisionEventRow> {
    const model = getEventModel(prisma);
    if (!Number.isInteger(input.tableId) || input.tableId <= 0) {
      throw new Error("Invalid tableId");
    }
    const event = normalizeEvent(input.event);
    const table = await prisma.table.findUnique({ where: { id: input.tableId } });
    if (!table) {
      throw new Error("Table not found");
    }

    let cameraId: number | undefined;
    if (input.cameraId !== undefined) {
      if (!Number.isInteger(input.cameraId) || input.cameraId <= 0) {
        throw new Error("Invalid cameraId");
      }
      const cameraModel = getCameraModel(prisma);
      if (!cameraModel) {
        throw new Error("Camera model is not available");
      }
      const camera = await cameraModel.findUnique({ where: { id: input.cameraId } });
      if (!camera) {
        throw new Error("Camera not found");
      }
      cameraId = input.cameraId;
    }

    let detectionType: DetectionType | undefined;
    if (input.detectionType !== undefined) {
      detectionType = normalizeDetectionType(input.detectionType);
    }

    if (cameraId !== undefined) {
      const mappingModel = getMappingModel(prisma);
      if (!mappingModel) {
        throw new Error("Camera mapping model is not available");
      }
      const mapping = await mappingModel.findFirst({
        where: {
          cameraId,
          tableId: input.tableId,
          ...(detectionType ? { detectionType } : {}),
          isEnabled: true,
        },
      });
      if (!mapping) {
        throw new Error("No enabled mapping found for camera/table/detectionType");
      }
    }

    const eventAtRaw = input.eventAt ?? new Date().toISOString();
    const eventAt = new Date(eventAtRaw);
    if (Number.isNaN(eventAt.getTime())) {
      throw new Error("Invalid eventAt");
    }

    let confidence: number | undefined;
    if (input.confidence !== undefined) {
      if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new Error("Invalid confidence");
      }
      confidence = input.confidence;
    }

    return model.create({
      data: {
        tableId: input.tableId,
        cameraId,
        detectionType,
        event,
        confidence,
        eventAt,
        source: (input.source ?? "cv-worker").trim() || "cv-worker",
        payload: input.payload ?? null,
      },
    });
  },
};
