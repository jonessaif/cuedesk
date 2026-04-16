import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { createSection, listSections } from "@/lib/sections-service";

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const rows = await listSections(prisma);
    return Response.json({ data: rows }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const body = (await request.json()) as { name?: string };
    const created = await createSection(prisma, { name: body.name ?? "" });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
