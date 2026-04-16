import type { PrismaClient, User } from "@prisma/client";

function parseActorUserId(request: Request): number | null {
  const raw = request.headers.get("x-user-id");
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function getActorUserOrNull(
  prisma: PrismaClient,
  request: Request,
): Promise<User | null> {
  const actorUserId = parseActorUserId(request);
  if (!actorUserId) {
    return null;
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
  });
  if (!actor || !actor.isActive) {
    return null;
  }
  return actor;
}

export async function requireRole(
  prisma: PrismaClient,
  request: Request,
  role: User["role"] | User["role"][],
): Promise<User> {
  const actor = await getActorUserOrNull(prisma, request);
  if (!actor) {
    throw new Error("Unauthorized: send x-user-id header");
  }
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(actor.role)) {
    throw new Error(`Forbidden: ${allowed.join(" or ")} permission required`);
  }
  return actor;
}

export async function requireOperatorOrAdmin(
  prisma: PrismaClient,
  request: Request,
): Promise<User> {
  return requireRole(prisma, request, ["operator", "admin"]);
}

export async function requireAdminOrBootstrap(
  prisma: PrismaClient,
  request: Request,
): Promise<User | null> {
  const usersCount = await prisma.user.count();
  if (usersCount === 0) {
    // Bootstrap mode: allow creating initial admin and initial setup actions.
    return null;
  }

  return requireRole(prisma, request, "admin");
}
