import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { cvConfigService } from "@/lib/services/cv-config-service";

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, ["admin", "operator"]);
    const data = await cvConfigService.listCameras(prisma as never);
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
      name?: string;
      url?: string;
      isEnabled?: boolean;
    };
    const data = await cvConfigService.createCamera(prisma as never, {
      name: body.name ?? "",
      url: body.url ?? "",
      isEnabled: body.isEnabled,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
