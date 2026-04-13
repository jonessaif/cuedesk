import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_TAG = "[demo-ledger]";

function at(dayOffset: number, hour: number, minute: number): Date {
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    hour,
    minute,
    0,
    0,
  );
  return d;
}

function minutesAfter(base: Date, mins: number): Date {
  return new Date(base.getTime() + mins * 60_000);
}

async function ensureTable(name: string, fallbackRate: number) {
  const existing = await prisma.table.findUnique({ where: { name } });
  if (existing) {
    return existing;
  }
  return prisma.table.create({
    data: { name, ratePerMin: fallbackRate },
  });
}

async function createCompletedSession(args: {
  tableId: number;
  playerName: string;
  start: Date;
  end: Date;
  status?: "completed" | "billed";
  amount: number;
  billId?: number | null;
  payerMode?: "none" | "single" | "split";
  payerData?: unknown;
  overrideStatus?: string | null;
  overrideRatePerMin?: number | null;
}) {
  return prisma.session.create({
    data: {
      tableId: args.tableId,
      playerName: args.playerName,
      startTime: args.start,
      endTime: args.end,
      status: args.status ?? "completed",
      amount: args.amount,
      billId: args.billId ?? null,
      payerMode: args.payerMode ?? "none",
      payerData: args.payerData ?? null,
      overrideStatus: args.overrideStatus ?? null,
      overrideRatePerMin: args.overrideRatePerMin ?? null,
    },
  });
}

async function main() {
  const existingDemo = await prisma.session.findFirst({
    where: { playerName: { contains: DEMO_TAG } },
    select: { id: true },
  });

  if (existingDemo) {
    console.log("Demo ledger backfill already exists. Skipping.");
    return;
  }

  const s1 = await ensureTable("S1", 6);
  const s2 = await ensureTable("S2", 6);
  const ps1 = await ensureTable("PS1", 200 / 60);

  // Day -3: billed + partial paid (cash + due)
  const b1 = await prisma.bill.create({
    data: {
      totalAmount: 480,
      discountType: null,
      discountValue: null,
      discountedAmount: 480,
      createdAt: at(-3, 22, 0),
    },
  });

  const sAStart = at(-3, 20, 0);
  const sAEnd = minutesAfter(sAStart, 40);
  const sA = await createCompletedSession({
    tableId: s1.id,
    playerName: `${DEMO_TAG} Armaan vs Zaid`,
    start: sAStart,
    end: sAEnd,
    status: "billed",
    amount: 240,
    billId: b1.id,
    payerMode: "split",
    payerData: [
      { name: "Armaan", percentage: 50 },
      { name: "Zaid", percentage: 50 },
    ],
  });

  const sBStart = at(-3, 21, 0);
  const sBEnd = minutesAfter(sBStart, 40);
  const sB = await createCompletedSession({
    tableId: s2.id,
    playerName: `${DEMO_TAG} Faizan`,
    start: sBStart,
    end: sBEnd,
    status: "billed",
    amount: 240,
    billId: b1.id,
    payerMode: "single",
    payerData: { name: "Faizan" },
  });

  await prisma.payment.createMany({
    data: [
      { billId: b1.id, mode: "cash", amount: 200 },
      { billId: b1.id, mode: "due", amount: 80 },
    ],
  });

  // Day -2: fully paid bill with discount + override marker
  const b2 = await prisma.bill.create({
    data: {
      totalAmount: 400,
      discountType: "fixed",
      discountValue: 40,
      discountedAmount: 360,
      createdAt: at(-2, 23, 15),
    },
  });

  const sCStart = at(-2, 21, 0);
  const sCEnd = minutesAfter(sCStart, 60);
  const sC = await createCompletedSession({
    tableId: s1.id,
    playerName: `${DEMO_TAG} Salman`,
    start: sCStart,
    end: sCEnd,
    status: "billed",
    amount: 360,
    billId: b2.id,
    payerMode: "single",
    payerData: { name: "Salman" },
    overrideRatePerMin: 6,
  });

  await prisma.payment.createMany({
    data: [
      { billId: b2.id, mode: "upi", amount: 200 },
      { billId: b2.id, mode: "card", amount: 160 },
    ],
  });

  // Day -1: completed unbilled (to show completed bucket in old data)
  const sDStart = at(-1, 7, 30);
  const sDEnd = minutesAfter(sDStart, 30);
  const sD = await createCompletedSession({
    tableId: s2.id,
    playerName: `${DEMO_TAG} Rizwan`,
    start: sDStart,
    end: sDEnd,
    status: "completed",
    amount: 180,
    billId: null,
    payerMode: "none",
    payerData: null,
  });

  // Day -4: PS hourly example
  const b3 = await prisma.bill.create({
    data: {
      totalAmount: 400,
      discountType: null,
      discountValue: null,
      discountedAmount: 400,
      createdAt: at(-4, 23, 45),
    },
  });

  const sEStart = at(-4, 22, 0);
  const sEEnd = minutesAfter(sEStart, 70);
  const sE = await createCompletedSession({
    tableId: ps1.id,
    playerName: `${DEMO_TAG} PS Match`,
    start: sEStart,
    end: sEEnd,
    status: "billed",
    amount: 400,
    billId: b3.id,
    payerMode: "single",
    payerData: { name: "PS Player" },
  });
  await prisma.payment.create({
    data: { billId: b3.id, mode: "cash", amount: 400 },
  });

  // Add some override event history so "History" modal has timeline
  await prisma.sessionOverrideEvent.createMany({
    data: [
      {
        sessionId: sC.id,
        action: "override_update",
        changedFields: ["overrideRatePerMin", "amount"],
        beforeData: { overrideRatePerMin: null, amount: 400 },
        afterData: { overrideRatePerMin: 6, amount: 360 },
        createdAt: at(-2, 23, 5),
      },
      {
        sessionId: sB.id,
        action: "override_update",
        changedFields: ["overridePayerMode", "overridePayerData"],
        beforeData: { overridePayerMode: null, overridePayerData: null },
        afterData: { overridePayerMode: "single", overridePayerData: { name: "Faizan" } },
        createdAt: at(-3, 22, 10),
      },
    ],
  });

  console.log("Demo ledger backfill completed.");
  console.log(
    `Sessions: ${[sA.id, sB.id, sC.id, sD.id, sE.id].join(", ")} | Bills: ${[
      b1.id,
      b2.id,
      b3.id,
    ].join(", ")}`,
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

