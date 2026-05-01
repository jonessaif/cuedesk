import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { cvConfigService } from "@/lib/services/cv-config-service";

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, ["admin", "operator"]);
    const { searchParams } = new URL(request.url);
    const cameraIdRaw = searchParams.get("cameraId");
    const cameraId = cameraIdRaw ? Number(cameraIdRaw) : undefined;
    if (cameraIdRaw && (!Number.isInteger(cameraId) || (cameraId ?? 0) <= 0)) {
      return Response.json({ error: "Invalid cameraId" }, { status: 400 });
    }
    const data = await cvConfigService.listMappings(prisma as never, { cameraId });
    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const body = (await request.json()) as {
      cameraId?: number;
      tableId?: number;
      detectionType?: string;
      roi?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        angle?: number;
        tiltX?: number;
        tiltY?: number;
        kind?: string;
        quadrilateral?: unknown;
      };
      isEnabled?: boolean;
    };
    const data = await cvConfigService.createMapping(prisma as never, {
      cameraId: Number(body.cameraId),
      tableId: Number(body.tableId),
      detectionType: body.detectionType ?? "",
      roi: {
        x: Number(body.roi?.x),
        y: Number(body.roi?.y),
        width: Number(body.roi?.width),
        height: Number(body.roi?.height),
        angle: body.roi?.angle === undefined ? undefined : Number(body.roi.angle),
        tiltX: body.roi?.tiltX === undefined ? undefined : Number(body.roi.tiltX),
        tiltY: body.roi?.tiltY === undefined ? undefined : Number(body.roi.tiltY),
        kind: body.roi?.kind,
        quadrilateral: body.roi?.quadrilateral,
      },
      isEnabled: body.isEnabled,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
