import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toBusinessDayKey(input: Date): string {
  const start = new Date(input);
  start.setHours(10, 0, 0, 0);
  if (input.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, "0");
  const dd = String(start.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  const sessions = await prisma.session.findMany({
    where: { businessDayKey: null },
    select: { id: true, overrideStartTime: true, startTime: true },
  });

  if (sessions.length === 0) {
    console.log("No sessions need businessDayKey backfill.");
    return;
  }

  await prisma.$transaction(
    sessions.map((session) =>
      prisma.session.update({
        where: { id: session.id },
        data: {
          businessDayKey: toBusinessDayKey(session.overrideStartTime ?? session.startTime),
        },
      }),
    ),
  );

  console.log(`Backfilled businessDayKey for ${sessions.length} sessions.`);
}

main()
  .catch((error) => {
    console.error("Business day key backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

