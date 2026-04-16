import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { deleteUser, updateUser } from "@/lib/users-service";

type UserRoleInput = "operator" | "admin";

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
    const userId = parseId(params.id);
    if (!userId) {
      return Response.json({ error: "Invalid user id" }, { status: 400 });
    }

    const body = (await request.json()) as {
      name?: string;
      pin?: string;
      role?: UserRoleInput;
      isActive?: boolean;
    };

    if (body.role !== undefined && body.role !== "operator" && body.role !== "admin") {
      return Response.json({ error: "Invalid role" }, { status: 400 });
    }

    const updated = await updateUser(prisma, {
      id: userId,
      name: body.name,
      pin: body.pin,
      role: body.role,
      isActive: body.isActive,
    });

    return Response.json({
      data: {
        id: updated.id,
        name: updated.name,
        role: updated.role,
        isActive: updated.isActive,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    }, { status: 200 });
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
    const actor = await requireRole(prisma, request, "admin");

    const params = await context.params;
    const userId = parseId(params.id);
    if (!userId) {
      return Response.json({ error: "Invalid user id" }, { status: 400 });
    }

    await deleteUser(prisma, {
      id: userId,
      actorUserId: actor.id,
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
