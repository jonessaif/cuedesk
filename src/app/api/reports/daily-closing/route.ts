import { requireOperatorOrAdmin } from "@/lib/authz";
import { getBusinessDayRangeFromKeyWithReset, getBusinessDayRangeWithReset } from "@/lib/businessDay";
import { prisma } from "@/lib/prisma";
import { getLedgerResetMinutesCached, hydrateLedgerResetMinutesCache } from "@/lib/settings-service";

type DailyClosingSnapshot = {
  date: string;
  opening_cash: number;
  opening_bank: number;
  sales_cash: number;
  sales_bank: number;
  food_sales_cash: number;
  food_sales_bank: number;
  food_sales_due: number;
  food_due_received_cash: number;
  food_due_received_bank: number;
  accessories_sales_cash: number;
  accessories_sales_bank: number;
  accessories_sales_due: number;
  due_received_cash: number;
  due_received_bank: number;
  expense_cash: number;
  expense_bank: number;
  new_due_total: number;
  closing_cash: number;
  closing_bank: number;
  total_sales: number;
  total_closing: number;
  is_today: boolean;
  can_edit: boolean;
  can_edit_opening: boolean;
  actual_cash: number | null;
  cash_difference: number | null;
  total_opening_balance: number;
  total_expense: number;
  net_sale: number;
};

type DailyClosingRecord = {
  date: string;
  openingCash: number;
  openingBank: number;
  salesCash: number;
  salesBank: number;
  foodSalesCash?: number;
  foodSalesBank?: number;
  foodSalesDue?: number;
  foodDueReceivedCash?: number;
  foodDueReceivedBank?: number;
  accessoriesSalesCash?: number;
  accessoriesSalesBank?: number;
  accessoriesSalesDue?: number;
  dueReceivedCash: number;
  dueReceivedBank: number;
  expenseCash: number;
  expenseBank: number;
  newDueTotal: number;
  closingCash: number;
  closingBank: number;
  actualCash?: number | null;
};

type BillLite = {
  id: number;
  createdAt: Date;
};

type PaymentLite = {
  billId: number;
  mode: "cash" | "upi" | "card" | "due";
  amount: number;
  createdAt: Date;
  dueSettledAt?: Date | null;
  dueReceivedMode?: "cash" | "upi" | "card" | "due" | null;
  bill?: { createdAt?: Date } | null;
};

function isUnknownFoodSalesArgumentError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("Unknown argument `foodSalesCash`")
    || error.message.includes("Unknown argument `foodSalesBank`")
    || error.message.includes("Unknown argument `foodSalesDue`")
    || error.message.includes("Unknown argument `foodDueReceivedCash`")
    || error.message.includes("Unknown argument `foodDueReceivedBank`")
    || error.message.includes("Unknown argument `accessoriesSalesCash`")
    || error.message.includes("Unknown argument `accessoriesSalesBank`")
    || error.message.includes("Unknown argument `accessoriesSalesDue`");
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDateKey(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function previousDateKey(dateKey: string): string {
  const base = new Date(`${dateKey}T00:00:00`);
  base.setDate(base.getDate() - 1);
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function computeDailyClosingSnapshot(args: {
  dateKey: string;
  resetMinutes: number;
  manual?: {
    openingCash?: number;
    openingBank?: number;
    foodSalesCash?: number;
    foodSalesBank?: number;
    foodSalesDue?: number;
    foodDueReceivedCash?: number;
    foodDueReceivedBank?: number;
    accessoriesSalesCash?: number;
    accessoriesSalesBank?: number;
    accessoriesSalesDue?: number;
    expenseCash?: number;
    expenseBank?: number;
    actualCash?: number | null;
  };
}): Promise<DailyClosingSnapshot> {
  const dailyClosingModel = (prisma as { dailyClosing?: unknown; dailyClosings?: unknown }).dailyClosing ??
    (prisma as { dailyClosing?: unknown; dailyClosings?: unknown }).dailyClosings;
  const billModel = (prisma as { bill?: unknown; bills?: unknown }).bill ??
    (prisma as { bill?: unknown; bills?: unknown }).bills;
  const paymentModel = (prisma as { payment?: unknown; payments?: unknown }).payment ??
    (prisma as { payment?: unknown; payments?: unknown }).payments;
  const expenseEntryModel = (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntry ??
    (prisma as { expenseEntry?: unknown; expenseEntries?: unknown }).expenseEntries;

  if (!dailyClosingModel || !billModel || !paymentModel) {
    throw new Error("Daily closing model is not available");
  }

  const todayKey = getBusinessDayRangeWithReset(new Date(), args.resetMinutes).key;
  const isToday = args.dateKey === todayKey;
  const canEdit = isToday;

  const [existing, previous] = await Promise.all([
    (
      dailyClosingModel as {
        findUnique: (args: { where: { date: string } }) => Promise<DailyClosingRecord | null>;
      }
    ).findUnique({
      where: { date: args.dateKey },
    }),
    (
      dailyClosingModel as {
        findUnique: (args: { where: { date: string } }) => Promise<DailyClosingRecord | null>;
      }
    ).findUnique({
      where: { date: previousDateKey(args.dateKey) },
    }),
  ]);

  const canEditOpening = !previous;

  const openingCash = roundMoney(
    args.manual?.openingCash ??
      existing?.openingCash ??
      (typeof previous?.actualCash === "number" ? previous.actualCash : previous?.closingCash) ??
      0,
  );
  const openingBank = roundMoney(
    args.manual?.openingBank ??
      existing?.openingBank ??
      previous?.closingBank ??
      0,
  );
  let expenseCash = roundMoney(args.manual?.expenseCash ?? existing?.expenseCash ?? 0);
  let expenseBank = roundMoney(args.manual?.expenseBank ?? existing?.expenseBank ?? 0);
  const foodSalesCash = roundMoney(args.manual?.foodSalesCash ?? existing?.foodSalesCash ?? 0);
  const foodSalesBank = roundMoney(args.manual?.foodSalesBank ?? existing?.foodSalesBank ?? 0);
  const foodSalesDue = roundMoney(args.manual?.foodSalesDue ?? existing?.foodSalesDue ?? 0);
  const foodDueReceivedCash = roundMoney(args.manual?.foodDueReceivedCash ?? existing?.foodDueReceivedCash ?? 0);
  const foodDueReceivedBank = roundMoney(args.manual?.foodDueReceivedBank ?? existing?.foodDueReceivedBank ?? 0);
  const accessoriesSalesCash = roundMoney(args.manual?.accessoriesSalesCash ?? existing?.accessoriesSalesCash ?? 0);
  const accessoriesSalesBank = roundMoney(args.manual?.accessoriesSalesBank ?? existing?.accessoriesSalesBank ?? 0);
  const accessoriesSalesDue = roundMoney(args.manual?.accessoriesSalesDue ?? existing?.accessoriesSalesDue ?? 0);
  const actualCash = args.manual?.actualCash !== undefined
    ? args.manual.actualCash
    : (typeof existing?.actualCash === "number" ? existing.actualCash : null);

  const { start, end } = getBusinessDayRangeFromKeyWithReset(args.dateKey, args.resetMinutes);

  if (expenseEntryModel) {
    const expenseRows = await (
      expenseEntryModel as {
        findMany: (args: {
          where: { date: string };
          select: { amount: true; mode: true };
        }) => Promise<Array<{ amount: number; mode: "cash" | "bank" }>>;
      }
    ).findMany({
      where: { date: args.dateKey },
      select: { amount: true, mode: true },
    });
    expenseCash = roundMoney(
      expenseRows
        .filter((row) => row.mode === "cash")
        .reduce((sum, row) => sum + row.amount, 0),
    );
    expenseBank = roundMoney(
      expenseRows
        .filter((row) => row.mode === "bank")
        .reduce((sum, row) => sum + row.amount, 0),
    );
  }

  const billsToday = await (
    billModel as {
      findMany: (args: {
        where: { createdAt: { gte: Date; lt: Date } };
        select: { id: true; createdAt: true };
      }) => Promise<BillLite[]>;
    }
  ).findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { id: true, createdAt: true },
  });
  const todayBillIds = new Set(billsToday.map((bill) => bill.id));

  const paymentsInWindow = await (
    paymentModel as {
      findMany: (args: {
        where: {
          OR: Array<
            | { createdAt: { gte: Date; lt: Date } }
            | { dueSettledAt: { gte: Date; lt: Date } }
          >;
        };
        select: {
          billId: true;
          mode: true;
          amount: true;
          createdAt: true;
          dueSettledAt: true;
          dueReceivedMode: true;
          bill: { select: { createdAt: true } };
        };
      }) => Promise<PaymentLite[]>;
    }
  ).findMany({
    where: {
      OR: [
        { createdAt: { gte: start, lt: end } },
        { dueSettledAt: { gte: start, lt: end } },
      ],
    },
    select: {
      billId: true,
      mode: true,
      amount: true,
      createdAt: true,
      dueSettledAt: true,
      dueReceivedMode: true,
      bill: { select: { createdAt: true } },
    },
  });

  const paymentBillIds = Array.from(new Set(paymentsInWindow.map((payment) => payment.billId)));
  const paymentBillRows = paymentBillIds.length > 0
    ? await (
      billModel as {
        findMany: (args: {
          where: { id: { in: number[] } };
          select: { id: true; createdAt: true };
        }) => Promise<BillLite[]>;
      }
    ).findMany({
      where: { id: { in: paymentBillIds } },
      select: { id: true, createdAt: true },
    })
    : [];
  const billCreatedAtById = new Map<number, Date>(paymentBillRows.map((row) => [row.id, row.createdAt]));

  let salesCash = 0;
  let salesBank = 0;
  let dueReceivedCash = 0;
  let dueReceivedBank = 0;

  for (const payment of paymentsInWindow) {
    if (payment.amount <= 0) {
      continue;
    }

    const dueSettledInWindow = payment.dueSettledAt instanceof Date
      && payment.dueSettledAt.getTime() >= start.getTime()
      && payment.dueSettledAt.getTime() < end.getTime();
    const createdInWindow = payment.createdAt.getTime() >= start.getTime()
      && payment.createdAt.getTime() < end.getTime();

    if (
      payment.mode !== "due"
      && dueSettledInWindow
      && payment.dueReceivedMode === payment.mode
    ) {
      if (payment.mode === "cash") {
        dueReceivedCash += payment.amount;
      } else {
        dueReceivedBank += payment.amount;
      }
      continue;
    }

    if (payment.mode === "due") {
      continue;
    }
    if (!createdInWindow) {
      continue;
    }
    const billCreatedAt = billCreatedAtById.get(payment.billId);
    if (!billCreatedAt) {
      continue;
    }
    const isBillFromToday = billCreatedAt.getTime() >= start.getTime() && billCreatedAt.getTime() < end.getTime();
    const isCash = payment.mode === "cash";
    if (isBillFromToday) {
      if (isCash) {
        salesCash += payment.amount;
      } else {
        salesBank += payment.amount;
      }
    }
  }

  const unsettledDueRows = todayBillIds.size > 0
    ? await (
      paymentModel as {
        findMany: (args: {
          where: {
            billId: { in: number[] };
            mode: "due";
            dueSettledAt: null;
            amount: { gt: number };
          };
          select: { amount: true };
        }) => Promise<Array<{ amount: number }>>;
      }
    ).findMany({
      where: {
        billId: { in: Array.from(todayBillIds) },
        mode: "due",
        dueSettledAt: null,
        amount: { gt: 0 },
      },
      select: { amount: true },
    })
    : [];

  const newDueTotal = roundMoney(unsettledDueRows.reduce((sum, row) => sum + row.amount, 0));
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

  const payload = {
    date: args.dateKey,
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
  };

  const upsertModel = (
    dailyClosingModel as {
      upsert: (args: {
        where: { date: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<unknown>;
    }
  );

  try {
    await upsertModel.upsert({
      where: { date: args.dateKey },
      create: payload as Record<string, unknown>,
      update: payload as Record<string, unknown>,
    });
  } catch (error) {
    if (!isUnknownFoodSalesArgumentError(error)) {
      throw error;
    }

    const legacyPayload = {
      date: payload.date,
      openingCash: payload.openingCash,
      openingBank: payload.openingBank,
      salesCash: payload.salesCash,
      salesBank: payload.salesBank,
      dueReceivedCash: payload.dueReceivedCash,
      dueReceivedBank: payload.dueReceivedBank,
      expenseCash: payload.expenseCash,
      expenseBank: payload.expenseBank,
      newDueTotal: payload.newDueTotal,
      closingCash: payload.closingCash,
      closingBank: payload.closingBank,
      actualCash: payload.actualCash,
    };

    await upsertModel.upsert({
      where: { date: args.dateKey },
      create: legacyPayload,
      update: legacyPayload,
    });
  }

  const cashDifference = actualCash === null ? null : roundMoney(actualCash - closingCash);

  return {
    date: args.dateKey,
    opening_cash: openingCash,
    opening_bank: openingBank,
    sales_cash: salesCash,
    sales_bank: salesBank,
    food_sales_cash: foodSalesCash,
    food_sales_bank: foodSalesBank,
    food_sales_due: foodSalesDue,
    food_due_received_cash: foodDueReceivedCash,
    food_due_received_bank: foodDueReceivedBank,
    accessories_sales_cash: accessoriesSalesCash,
    accessories_sales_bank: accessoriesSalesBank,
    accessories_sales_due: accessoriesSalesDue,
    due_received_cash: dueReceivedCash,
    due_received_bank: dueReceivedBank,
    expense_cash: expenseCash,
    expense_bank: expenseBank,
    new_due_total: newDueTotal,
    closing_cash: closingCash,
    closing_bank: closingBank,
    total_sales: roundMoney(
      salesCash
      + salesBank
      + foodSalesCash
      + foodSalesBank
      + foodSalesDue
      + accessoriesSalesCash
      + accessoriesSalesBank
      + accessoriesSalesDue,
    ),
    total_closing: roundMoney(closingCash + closingBank),
    is_today: isToday,
    can_edit: canEdit,
    can_edit_opening: canEditOpening,
    actual_cash: actualCash,
    cash_difference: cashDifference,
    total_opening_balance: roundMoney(openingCash + openingBank),
    total_expense: roundMoney(expenseCash + expenseBank),
    net_sale: roundMoney(
      salesCash
      + salesBank
      + foodSalesCash
      + foodSalesBank
      + foodSalesDue
      + accessoriesSalesCash
      + accessoriesSalesBank
      + accessoriesSalesDue
      - expenseCash
      - expenseBank,
    ),
  };
}

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    await hydrateLedgerResetMinutesCache(prisma);
    const resetMinutes = getLedgerResetMinutesCached();
    const { searchParams } = new URL(request.url);
    const date = parseDateKey(searchParams.get("date")) ?? getBusinessDayRangeWithReset(new Date(), resetMinutes).key;
    const data = await computeDailyClosingSnapshot({ dateKey: date, resetMinutes });
    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    await hydrateLedgerResetMinutesCache(prisma);
    const resetMinutes = getLedgerResetMinutesCached();
    const body = await request.json() as {
      date?: string;
      opening_cash?: number;
      opening_bank?: number;
      food_sales_cash?: number;
      food_sales_bank?: number;
      food_sales_due?: number;
      food_due_received_cash?: number;
      food_due_received_bank?: number;
      accessories_sales_cash?: number;
      accessories_sales_bank?: number;
      accessories_sales_due?: number;
      expense_cash?: number;
      expense_bank?: number;
      actual_cash?: number | null;
    };
    const todayKey = getBusinessDayRangeWithReset(new Date(), resetMinutes).key;
    const dateKey = parseDateKey(body?.date ?? null) ?? todayKey;
    if (dateKey !== todayKey) {
      return Response.json({ error: "Only today's daily closing can be edited" }, { status: 400 });
    }

    const current = await computeDailyClosingSnapshot({ dateKey, resetMinutes });
    const next = await computeDailyClosingSnapshot({
      dateKey,
      resetMinutes,
      manual: {
        openingCash: current.can_edit_opening ? body.opening_cash : undefined,
        openingBank: current.can_edit_opening ? body.opening_bank : undefined,
        foodSalesCash: body.food_sales_cash,
        foodSalesBank: body.food_sales_bank,
        foodSalesDue: body.food_sales_due,
        foodDueReceivedCash: body.food_due_received_cash,
        foodDueReceivedBank: body.food_due_received_bank,
        accessoriesSalesCash: body.accessories_sales_cash,
        accessoriesSalesBank: body.accessories_sales_bank,
        accessoriesSalesDue: body.accessories_sales_due,
        expenseCash: body.expense_cash,
        expenseBank: body.expense_bank,
        actualCash: body.actual_cash === undefined ? undefined : body.actual_cash,
      },
    });

    return Response.json({ data: next }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
