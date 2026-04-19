import { requireOperatorOrAdmin } from "@/lib/authz";
import { getCollectedPaidAmount, getEffectiveBillTotals } from "@/lib/billTotals";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";
import { listTablesWithState } from "@/lib/tables-service";

const DASHBOARD_TTL_MS = 3000;

type DashboardLiveData = {
  tables: unknown[];
  unpaid: unknown[];
  completed: unknown[];
  all: {
    data: unknown[];
    summary: unknown;
    window: unknown;
  };
};

type DashboardCacheEntry = {
  data?: DashboardLiveData;
  expiresAt: number;
  inflight?: Promise<DashboardLiveData>;
};

const dashboardCacheStore: Map<string, DashboardCacheEntry> = new Map();

function createCacheKey(params: URLSearchParams, actorId: number): string {
  const scope = params.get("scope") ?? "current";
  const date = params.get("date") ?? "";
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  return `${actorId}|${scope}|${date}|${startDate}|${endDate}`;
}

async function getUnpaidBills() {
  const bills = await prisma.bill.findMany({
    orderBy: { id: "desc" },
    include: {
      sessions: {
        select: {
          amount: true,
        },
      },
      payments: {
        select: {
          amount: true,
          mode: true,
          dueCustomerName: true,
          dueCustomerPhone: true,
          dueSettledAt: true,
          dueReceivedMode: true,
        },
      },
    },
  });

  return bills
    .map((bill) => {
      const paidAmount = getCollectedPaidAmount(
        bill.payments.map((payment) => ({
          amount: payment.amount,
          mode: payment.mode,
          dueSettledAt: payment.dueSettledAt,
        })),
      );
      const sessionsAmount = bill.sessions.reduce(
        (sum, session) => sum + (typeof session.amount === "number" ? session.amount : 0),
        0,
      );
      const totals = getEffectiveBillTotals({
        totalAmount: bill.totalAmount,
        discountType: bill.discountType,
        discountedAmount: bill.discountedAmount,
        sessionsAmount,
        paidAmount,
      });

      return {
        id: bill.id,
        subtotal: totals.subtotal,
        discount: totals.discount,
        finalAmount: totals.finalAmount,
        totalAmount: totals.totalAmount,
        discountType: bill.discountType,
        discountValue: bill.discountValue,
        discountedAmount: totals.discountedAmount,
        paidAmount: totals.paidAmount,
        remainingAmount: totals.remainingAmount,
        remaining: totals.remaining,
        payments: bill.payments.map((payment) => ({
          mode: payment.mode,
          amount: payment.amount,
          dueCustomerName: payment.dueCustomerName,
          dueCustomerPhone: payment.dueCustomerPhone,
          dueSettledAt: payment.dueSettledAt,
          dueReceivedMode: payment.dueReceivedMode,
        })),
      };
    })
    .filter((bill) => bill.remainingAmount > 0)
    .sort((a, b) => b.id - a.id);
}

async function computeDashboard(params: URLSearchParams): Promise<DashboardLiveData> {
  const scopeRaw = params.get("scope");
  const scope = scopeRaw === "day" || scopeRaw === "range" ? scopeRaw : "current";
  const date = params.get("date") ?? undefined;
  const startDate = params.get("startDate") ?? undefined;
  const endDate = params.get("endDate") ?? undefined;

  const [tables, unpaid, completedSessions, allSessions] = await Promise.all([
    listTablesWithState(prisma),
    getUnpaidBills(),
    sessionService.getCompletedSessions(prisma as never),
    sessionService.getAllSessions(prisma as never, {
      scope: scope as "current" | "day" | "range",
      date,
      startDate,
      endDate,
      now: new Date(),
    }),
  ]);

  return {
    tables,
    unpaid,
    completed: completedSessions,
    all: {
      data: allSessions.rows,
      summary: allSessions.summary,
      window: allSessions.window,
    },
  };
}

export async function GET(request: Request) {
  try {
    const actor = await requireOperatorOrAdmin(prisma, request);
    const { searchParams } = new URL(request.url);
    const key = createCacheKey(searchParams, actor.id);
    const now = Date.now();
    const cached = dashboardCacheStore.get(key);

    if (cached?.data && cached.expiresAt > now) {
      return Response.json({ data: cached.data }, { status: 200, headers: { "x-cache": "HIT" } });
    }

    if (cached?.inflight) {
      const data = await cached.inflight;
      return Response.json({ data }, { status: 200, headers: { "x-cache": "SHARED" } });
    }

    const inflight = computeDashboard(searchParams)
      .then((data) => {
        dashboardCacheStore.set(key, {
          data,
          expiresAt: Date.now() + DASHBOARD_TTL_MS,
        });
        return data;
      })
      .catch((error) => {
        dashboardCacheStore.delete(key);
        throw error;
      });

    dashboardCacheStore.set(key, {
      data: cached?.data,
      expiresAt: cached?.expiresAt ?? 0,
      inflight,
    });

    const data = await inflight;
    return Response.json({ data }, { status: 200, headers: { "x-cache": "MISS" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
