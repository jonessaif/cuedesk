import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { cvConfigService } from "@/lib/services/cv-config-service";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(prisma, request, "admin");
    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid mapping id" }, { status: 400 });
    }

    const body = (await request.json()) as {
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
    const data = await cvConfigService.updateMapping(prisma as never, {
      id,
      detectionType: body.detectionType,
      roi: body.roi === undefined
        ? undefined
        : {
          x: Number(body.roi.x),
          y: Number(body.roi.y),
          width: Number(body.roi.width),
          height: Number(body.roi.height),
          angle: body.roi.angle === undefined ? undefined : Number(body.roi.angle),
          tiltX: body.roi.tiltX === undefined ? undefined : Number(body.roi.tiltX),
          tiltY: body.roi.tiltY === undefined ? undefined : Number(body.roi.tiltY),
          kind: body.roi.kind,
          quadrilateral: body.roi.quadrilateral,
        },
      isEnabled: body.isEnabled,
    });
    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(prisma, request, "admin");
    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid mapping id" }, { status: 400 });
    }
    await cvConfigService.deleteMapping(prisma as never, { id });
    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
