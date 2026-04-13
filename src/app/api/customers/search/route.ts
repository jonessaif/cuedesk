import { prisma } from "@/lib/prisma";
import { customerService } from "@/lib/services/customerService";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (!q) {
      return Response.json({ data: [] }, { status: 200 });
    }

    const data = await customerService.searchCustomers(prisma as never, {
      query: q,
      limit: 8,
    });

    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}

