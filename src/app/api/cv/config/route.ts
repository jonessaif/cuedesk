import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { cvConfigService } from "@/lib/services/cv-config-service";

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, ["admin", "operator"]);
    const { searchParams } = new URL(request.url);
    const shouldWrite = searchParams.get("write") === "1";

    const data = await cvConfigService.buildWorkerConfig(prisma as never);
    if (!shouldWrite) {
      return Response.json({ data }, { status: 200 });
    }
    const path = await cvConfigService.writeWorkerConfigToFile(data);
    return Response.json({ data, path }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

