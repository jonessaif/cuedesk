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
      return Response.json({ error: "Invalid camera id" }, { status: 400 });
    }

    const body = (await request.json()) as {
      name?: string;
      url?: string;
      isEnabled?: boolean;
      status?: "online" | "offline" | "unknown";
      lastError?: string | null;
    };
    const data = await cvConfigService.updateCamera(prisma as never, {
      id,
      name: body.name,
      url: body.url,
      isEnabled: body.isEnabled,
      status: body.status,
      lastError: body.lastError,
      touchCheckedAt: true,
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
      return Response.json({ error: "Invalid camera id" }, { status: 400 });
    }
    await cvConfigService.deleteCamera(prisma as never, { id });
    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
