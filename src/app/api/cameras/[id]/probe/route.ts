import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { cvConfigService, probeCameraConnection } from "@/lib/services/cv-config-service";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(prisma, request, ["admin", "operator"]);
    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return Response.json({ error: "Invalid camera id" }, { status: 400 });
    }

    const camera = await cvConfigService.getCameraById(prisma as never, id);
    if (!camera) {
      return Response.json({ error: "Camera not found" }, { status: 400 });
    }

    const probe = await probeCameraConnection(camera.url);
    let snapshotCaptured = false;
    let snapshotError: string | null = null;
    if (probe.status === "online") {
      try {
        await cvConfigService.captureSnapshotForCamera(prisma as never, id);
        snapshotCaptured = true;
      } catch (error) {
        snapshotError = error instanceof Error ? error.message : "Failed to capture snapshot";
      }
    }
    const data = await cvConfigService.updateCamera(prisma as never, {
      id,
      status: probe.status,
      lastError: probe.status === "offline" ? probe.detail : null,
      touchCheckedAt: true,
    });
    return Response.json({ data, probe, snapshotCaptured, snapshotError }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
