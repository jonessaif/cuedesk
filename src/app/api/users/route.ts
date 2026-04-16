import { requireAdminOrBootstrap, requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { createUser, listUsers } from "@/lib/users-service";

type UserRoleInput = "operator" | "admin";

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const users = await listUsers(prisma);
    return Response.json({
      data: users.map((user) => ({
        id: user.id,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminOrBootstrap(prisma, request);
    const body = (await request.json()) as {
      name?: string;
      pin?: string;
      role?: UserRoleInput;
      isActive?: boolean;
    };

    if (body.role !== "operator" && body.role !== "admin") {
      return Response.json({ error: "Invalid role" }, { status: 400 });
    }

    const created = await createUser(prisma, {
      name: body.name ?? "",
      pin: body.pin ?? "",
      role: body.role,
      isActive: body.isActive,
    });

    return Response.json({
      data: {
        id: created.id,
        name: created.name,
        role: created.role,
        isActive: created.isActive,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
