import { createTable, listTablesWithState } from "@/lib/tables-service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const rows = await listTablesWithState(prisma);
  return Response.json({ data: rows });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; ratePerMin?: number };

    const created = await createTable(prisma, {
      name: body.name ?? "",
      ratePerMin: Number(body.ratePerMin),
    });

    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
