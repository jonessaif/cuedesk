import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ role: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    return Response.json({ data: users }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
