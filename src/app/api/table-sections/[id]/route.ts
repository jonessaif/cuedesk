import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { deleteSection, updateSection } from "@/lib/sections-service";

function parseId(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(prisma, request, "admin");
    const params = await context.params;
    const sectionId = parseId(params.id);
    if (!sectionId) {
      return Response.json({ error: "Invalid section id" }, { status: 400 });
    }
    const body = (await request.json()) as { name?: string };
    const updated = await updateSection(prisma, { id: sectionId, name: body.name ?? "" });
    return Response.json({ data: updated }, { status: 200 });
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
    const sectionId = parseId(params.id);
    if (!sectionId) {
      return Response.json({ error: "Invalid section id" }, { status: 400 });
    }
    await deleteSection(prisma, { id: sectionId });
    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
