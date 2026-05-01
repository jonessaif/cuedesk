import { prisma } from "@/lib/prisma";
import { visionEventService } from "@/lib/services/vision-event-service";

function validateWorkerToken(request: Request): void {
  const required = process.env.CV_WORKER_TOKEN;
  if (!required) {
    return;
  }
  const sent = request.headers.get("x-cv-token");
  if (!sent || sent !== required) {
    throw new Error("Unauthorized: invalid CV worker token");
  }
}

export async function POST(request: Request) {
  try {
    validateWorkerToken(request);
    const body = (await request.json()) as {
      tableId?: number;
      cameraId?: number;
      detectionType?: string;
      event?: string;
      confidence?: number;
      eventAt?: string;
      source?: string;
      payload?: unknown;
    };
    const data = await visionEventService.ingest(prisma as never, {
      tableId: Number(body.tableId),
      cameraId: body.cameraId === undefined ? undefined : Number(body.cameraId),
      detectionType: body.detectionType,
      event: body.event ?? "",
      confidence: body.confidence,
      eventAt: body.eventAt,
      source: body.source,
      payload: body.payload,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}

