import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key") ?? undefined;
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;

    if (key) {
      const data = await prisma.dailyReport.findUnique({
        where: { businessDayKey: key },
      });
      return Response.json({ data }, { status: 200 });
    }

    const where = startDate && endDate
      ? {
        businessDayKey: {
          gte: startDate,
          lte: endDate,
        },
      }
      : undefined;

    const data = await prisma.dailyReport.findMany({
      where,
      orderBy: { businessDayKey: "desc" },
    });
    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
