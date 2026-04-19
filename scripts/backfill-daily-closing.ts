import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toDateKeyLocal(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayBounds(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function previousDateKey(dateKey: string): string {
  const current = new Date(`${dateKey}T00:00:00`);
  current.setDate(current.getDate() - 1);
  return toDateKeyLocal(current);
}

function nextDateKey(dateKey: string): string {
  const current = new Date(`${dateKey}T00:00:00`);
  current.setDate(current.getDate() + 1);
  return toDateKeyLocal(current);
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function computeAndUpsert(dateKey: string) {
  const { start, end } = dayBounds(dateKey);
  const [existing, previous] = await Promise.all([
    prisma.dailyClosing.findUnique({ where: { date: dateKey } }),
    prisma.dailyClosing.findUnique({ where: { date: previousDateKey(dateKey) } }),
  ]);

  // For backfill consistency, chain each day from previous day's closing when available.
  // This corrects historical rows that may have started with 0 opening.
  const openingCash = roundMoney(
    (typeof previous?.actualCash === "number" ? previous.actualCash : previous?.closingCash)
    ?? existing?.openingCash
    ?? 0,
  );
  const openingBank = roundMoney(previous?.closingBank ?? existing?.openingBank ?? 0);
  const expenseRows = await prisma.expenseEntry.findMany({
    where: { date: dateKey },
    select: { amount: true, mode: true },
  });
  const expenseCash = expenseRows.length > 0
    ? roundMoney(expenseRows.filter((row) => row.mode === "cash").reduce((sum, row) => sum + row.amount, 0))
    : roundMoney(existing?.expenseCash ?? 0);
  const expenseBank = expenseRows.length > 0
    ? roundMoney(expenseRows.filter((row) => row.mode === "bank").reduce((sum, row) => sum + row.amount, 0))
    : roundMoney(existing?.expenseBank ?? 0);
  const foodSalesCash = roundMoney(existing?.foodSalesCash ?? 0);
  const foodSalesBank = roundMoney(existing?.foodSalesBank ?? 0);
  const foodSalesDue = roundMoney(existing?.foodSalesDue ?? 0);
  const foodDueReceivedCash = roundMoney(existing?.foodDueReceivedCash ?? 0);
  const foodDueReceivedBank = roundMoney(existing?.foodDueReceivedBank ?? 0);
  const accessoriesSalesCash = roundMoney(existing?.accessoriesSalesCash ?? 0);
  const accessoriesSalesBank = roundMoney(existing?.accessoriesSalesBank ?? 0);
  const accessoriesSalesDue = roundMoney(existing?.accessoriesSalesDue ?? 0);
  const actualCash = existing?.actualCash ?? null;

  const billsToday = await prisma.bill.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { id: true, createdAt: true },
  });
  const todayBillIds = new Set(billsToday.map((row) => row.id));

  const paymentsToday = await prisma.payment.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { billId: true, amount: true, mode: true },
  });

  const paymentBillIds = Array.from(new Set(paymentsToday.map((row) => row.billId)));
  const paymentBills = paymentBillIds.length > 0
    ? await prisma.bill.findMany({
      where: { id: { in: paymentBillIds } },
      select: { id: true, createdAt: true },
    })
    : [];
  const billCreatedAtById = new Map<number, Date>(paymentBills.map((row) => [row.id, row.createdAt]));

  let salesCash = 0;
  let salesBank = 0;
  let dueReceivedCash = 0;
  let dueReceivedBank = 0;

  for (const payment of paymentsToday) {
    if (payment.mode === "due" || payment.amount <= 0) {
      continue;
    }
    const billCreatedAt = billCreatedAtById.get(payment.billId);
    if (!billCreatedAt) {
      continue;
    }
    const billIsToday = billCreatedAt.getTime() >= start.getTime() && billCreatedAt.getTime() < end.getTime();
    const isCash = payment.mode === "cash";
    if (billIsToday) {
      if (isCash) {
        salesCash += payment.amount;
      } else {
        salesBank += payment.amount;
      }
    } else if (billCreatedAt.getTime() < start.getTime()) {
      if (isCash) {
        dueReceivedCash += payment.amount;
      } else {
        dueReceivedBank += payment.amount;
      }
    }
  }

  const dueRows = todayBillIds.size > 0
    ? await prisma.payment.findMany({
      where: {
        billId: { in: Array.from(todayBillIds) },
        mode: "due",
        dueSettledAt: null,
        amount: { gt: 0 },
      },
      select: { amount: true },
    })
    : [];

  const newDueTotal = roundMoney(dueRows.reduce((sum, row) => sum + row.amount, 0));
  salesCash = roundMoney(salesCash);
  salesBank = roundMoney(salesBank);
  dueReceivedCash = roundMoney(dueReceivedCash);
  dueReceivedBank = roundMoney(dueReceivedBank);

  const closingCash = roundMoney(
    openingCash + salesCash + foodSalesCash + accessoriesSalesCash + dueReceivedCash + foodDueReceivedCash - expenseCash,
  );
  const closingBank = roundMoney(
    openingBank + salesBank + foodSalesBank + accessoriesSalesBank + dueReceivedBank + foodDueReceivedBank - expenseBank,
  );

  await prisma.dailyClosing.upsert({
    where: { date: dateKey },
    create: {
      date: dateKey,
      openingCash,
      openingBank,
      salesCash,
      salesBank,
      foodSalesCash,
      foodSalesBank,
      foodSalesDue,
      foodDueReceivedCash,
      foodDueReceivedBank,
      accessoriesSalesCash,
      accessoriesSalesBank,
      accessoriesSalesDue,
      dueReceivedCash,
      dueReceivedBank,
      expenseCash,
      expenseBank,
      newDueTotal,
      closingCash,
      closingBank,
      actualCash,
    },
    update: {
      openingCash,
      openingBank,
      salesCash,
      salesBank,
      foodSalesCash,
      foodSalesBank,
      foodSalesDue,
      foodDueReceivedCash,
      foodDueReceivedBank,
      accessoriesSalesCash,
      accessoriesSalesBank,
      accessoriesSalesDue,
      dueReceivedCash,
      dueReceivedBank,
      expenseCash,
      expenseBank,
      newDueTotal,
      closingCash,
      closingBank,
      actualCash,
    },
  });
}

async function main() {
  const minBill = await prisma.bill.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const minPayment = await prisma.payment.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const minExistingClosing = await prisma.dailyClosing.findFirst({
    orderBy: { date: "asc" },
    select: { date: true },
  });

  const candidates: Date[] = [];
  if (minBill?.createdAt) {
    candidates.push(minBill.createdAt);
  }
  if (minPayment?.createdAt) {
    candidates.push(minPayment.createdAt);
  }
  if (minExistingClosing?.date) {
    candidates.push(new Date(`${minExistingClosing.date}T00:00:00`));
  }
  if (candidates.length === 0) {
    console.log("No historical data found to backfill.");
    return;
  }

  const startDate = new Date(Math.min(...candidates.map((d) => d.getTime())));
  const endDate = new Date();
  let cursor = toDateKeyLocal(startDate);
  const endKey = toDateKeyLocal(endDate);

  let count = 0;
  while (cursor <= endKey) {
    await computeAndUpsert(cursor);
    count += 1;
    cursor = nextDateKey(cursor);
  }

  console.log(`Backfilled daily closing snapshots for ${count} day(s).`);
}

main()
  .catch((error) => {
    console.error("Daily closing backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
