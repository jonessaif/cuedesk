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

export async function GET(
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

    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";
    if (forceRefresh) {
      await cvConfigService.captureSnapshotForCamera(prisma as never, id);
    }

    const bytes = await cvConfigService.readSnapshot(id);
    const body = Uint8Array.from(bytes).buffer;
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized")
      ? 401
      : message.startsWith("Forbidden")
        ? 403
        : message.includes("ENOENT")
          ? 404
          : 400;
    const normalizedMessage = message.includes("ENOENT")
      ? "No snapshot found for this camera yet. Run probe or refresh snapshot."
      : message;
    return Response.json({ error: normalizedMessage }, { status });
  }
}
