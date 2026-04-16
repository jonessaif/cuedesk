import { prisma } from "@/lib/prisma";
import { findActiveUserByPin } from "@/lib/users-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { pin?: string };
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!/^\d{4}$/.test(pin.trim())) {
      return Response.json({ error: "Invalid PIN" }, { status: 401 });
    }
    const user = await findActiveUserByPin(prisma, pin);
    if (!user) {
      return Response.json({ error: "Invalid PIN" }, { status: 401 });
    }

    return Response.json({
      data: {
        id: user.id,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      },
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
