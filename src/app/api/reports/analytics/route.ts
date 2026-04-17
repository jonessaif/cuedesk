import { requireOperatorOrAdmin } from "@/lib/authz";
import { getBusinessDayRangeFromKeyWithReset, getBusinessDayRangeWithReset } from "@/lib/businessDay";
import { prisma } from "@/lib/prisma";
import { getLedgerResetMinutesCached, hydrateLedgerResetMinutesCache } from "@/lib/settings-service";
import { getEffectiveStatus } from "@/lib/session-status";

type Scope = "current" | "day" | "range";

type Interval = {
  startMs: number;
  endMs: number;
};

type WindowInfo = {
  scope: Scope | "custom";
  start: Date;
  end: Date;
  reportDays: number;
  key?: string;
  startDate?: string;
  endDate?: string;
};

type RevenueSeriesPoint = {
  label: string;
  revenue: number;
};

function parseIsoDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMinutes(ms: number): number {
  return ms / 60000;
}

function toDayCountInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 1;
  }
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) {
    return 1;
  }
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

function splitByBusinessDay(
  startMs: number,
  endMs: number,
  resetMinutes: number,
): Array<{ key: string; startMs: number; endMs: number }> {
  const segments: Array<{ key: string; startMs: number; endMs: number }> = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const dayRange = getBusinessDayRangeWithReset(new Date(cursor), resetMinutes);
    const segmentEnd = Math.min(endMs, dayRange.end.getTime());
    segments.push({
      key: dayRange.key,
      startMs: cursor,
      endMs: segmentEnd,
    });
    cursor = segmentEnd;
  }
  return segments;
}

function buildHourlyRevenueSeries(
  hourlyRows: Array<{ hour: number; revenue: number }>,
): RevenueSeriesPoint[] {
  const byHour = new Map(hourlyRows.map((row) => [row.hour, row.revenue]));
  const points: RevenueSeriesPoint[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    if (hour === 8) {
      const combined = (byHour.get(8) ?? 0) + (byHour.get(9) ?? 0) + (byHour.get(10) ?? 0) + (byHour.get(11) ?? 0);
      points.push({
        label: "08-11",
        revenue: roundMoney(combined),
      });
      hour = 11;
      continue;
    }
    points.push({
      label: String(hour).padStart(2, "0"),
      revenue: roundMoney(byHour.get(hour) ?? 0),
    });
  }
  return points;
}

function roundMoney(value: number): number {
  return Math.round(value);
}

function roundMinutes(value: number): number {
  return Math.round(value);
}

function toPercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.round((part / total) * 1000) / 10;
}

function clampOverlap(startMs: number, endMs: number, windowStartMs: number, windowEndMs: number): Interval | null {
  const overlapStart = Math.max(startMs, windowStartMs);
  const overlapEnd = Math.min(endMs, windowEndMs);
  if (overlapEnd <= overlapStart) {
    return null;
  }
  return {
    startMs: overlapStart,
    endMs: overlapEnd,
  };
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) {
    return intervals;
  }

  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const prev = merged[merged.length - 1];
    if (current.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, current.endMs);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function deriveWindowFromParams(searchParams: URLSearchParams, resetMinutes: number): WindowInfo {
  const startAtRaw = searchParams.get("startAt");
  const endAtRaw = searchParams.get("endAt");

  if (startAtRaw && endAtRaw) {
    const startAt = parseIsoDate(startAtRaw);
    const endAt = parseIsoDate(endAtRaw);
    if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
      throw new Error("Invalid custom timeframe");
    }
    return {
      scope: "custom",
      start: startAt,
      end: endAt,
      reportDays: 1,
    };
  }

  const scopeRaw = searchParams.get("scope");
  const scope: Scope = scopeRaw === "day" || scopeRaw === "range" ? scopeRaw : "current";

  if (scope === "day") {
    const key = searchParams.get("date");
    if (!key) {
      throw new Error("date is required for day scope");
    }
    const range = getBusinessDayRangeFromKeyWithReset(key, resetMinutes);
    return {
      scope,
      key,
      start: range.start,
      end: range.end,
      reportDays: 1,
    };
  }

  if (scope === "range") {
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    if (!startDate || !endDate) {
      throw new Error("startDate and endDate are required for range scope");
    }
    const startRange = getBusinessDayRangeFromKeyWithReset(startDate, resetMinutes);
    const endRange = getBusinessDayRangeFromKeyWithReset(endDate, resetMinutes);
    if (endRange.end.getTime() <= startRange.start.getTime()) {
      throw new Error("Invalid range");
    }
    return {
      scope,
      startDate,
      endDate,
      start: startRange.start,
      end: endRange.end,
      reportDays: toDayCountInclusive(startDate, endDate),
    };
  }

  const current = getBusinessDayRangeWithReset(new Date(), resetMinutes);
  return {
    scope,
    key: current.key,
    start: current.start,
    end: new Date(),
    reportDays: 1,
  };
}

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    await hydrateLedgerResetMinutesCache(prisma);
    const resetMinutes = getLedgerResetMinutesCached();

    const { searchParams } = new URL(request.url);
    const windowInfo = deriveWindowFromParams(searchParams, resetMinutes);
    const windowStartMs = windowInfo.start.getTime();
    const windowEndMs = windowInfo.end.getTime();

    if (windowEndMs <= windowStartMs) {
      throw new Error("Invalid timeframe");
    }

    const tables = await prisma.table.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        ratePerMin: true,
      },
    });

    const sessions = await prisma.session.findMany({
      where: {
        OR: [
          { startTime: { lt: windowInfo.end } },
          { overrideStartTime: { lt: windowInfo.end } },
        ],
      },
      select: {
        id: true,
        tableId: true,
        startTime: true,
        endTime: true,
        overrideStartTime: true,
        overrideEndTime: true,
        status: true,
        overrideStatus: true,
        overrideRatePerMin: true,
        amount: true,
        outcome: true,
      },
    });

    const tableIds = tables.map((table) => table.id);
    const tableById = new Map(tables.map((table) => [table.id, table]));

    const tableIntervals = new Map<number, Interval[]>();
    const tableRevenue = new Map<number, number>();
    const tableSessionIds = new Map<number, Set<number>>();

    const hourlyRunningMinutes = new Array<number>(24).fill(0);
    const hourlyRevenue = new Array<number>(24).fill(0);
    const hourlySessionIds = Array.from({ length: 24 }, () => new Set<number>());
    const hourlyCapacityMinutes = new Array<number>(24).fill(0);
    const revenueByBusinessDayKey = new Map<string, number>();

    const windowMinutes = toMinutes(windowEndMs - windowStartMs);

    for (const tableId of tableIds) {
      tableIntervals.set(tableId, []);
      tableRevenue.set(tableId, 0);
      tableSessionIds.set(tableId, new Set<number>());
    }

    for (const session of sessions) {
      const table = tableById.get(session.tableId);
      if (!table) {
        continue;
      }

      const effectiveStatus = getEffectiveStatus({
        status: session.status,
        overrideStatus: session.overrideStatus,
      });
      const effectiveStart = session.overrideStartTime ?? session.startTime;
      const rawEnd = effectiveStatus === "running"
        ? windowInfo.end
        : session.overrideEndTime ?? session.endTime ?? windowInfo.end;

      const overlap = clampOverlap(
        effectiveStart.getTime(),
        rawEnd.getTime(),
        windowStartMs,
        windowEndMs,
      );

      if (!overlap) {
        continue;
      }

      const overlapMinutes = toMinutes(overlap.endMs - overlap.startMs);
      if (overlapMinutes <= 0) {
        continue;
      }

      tableIntervals.get(session.tableId)?.push(overlap);
      tableSessionIds.get(session.tableId)?.add(session.id);

      const fullDurationMinutes = Math.max(
        toMinutes(rawEnd.getTime() - effectiveStart.getTime()),
        overlapMinutes,
      );
      const effectiveRate = session.overrideRatePerMin ?? table.ratePerMin;
      const fallbackAmount = effectiveRate * fullDurationMinutes;
      const sessionAmount = typeof session.amount === "number" ? session.amount : fallbackAmount;
      const revenueShare = session.outcome === "NORMAL"
        ? sessionAmount * (overlapMinutes / fullDurationMinutes)
        : 0;

      tableRevenue.set(
        session.tableId,
        (tableRevenue.get(session.tableId) ?? 0) + revenueShare,
      );

      let chunkStart = overlap.startMs;
      while (chunkStart < overlap.endMs) {
        const chunkDate = new Date(chunkStart);
        const hour = chunkDate.getHours();
        const nextHour = new Date(chunkDate);
        nextHour.setMinutes(0, 0, 0);
        nextHour.setHours(nextHour.getHours() + 1);
        const chunkEnd = Math.min(overlap.endMs, nextHour.getTime());
        const chunkMinutes = toMinutes(chunkEnd - chunkStart);
        if (chunkMinutes > 0) {
          hourlyRunningMinutes[hour] += chunkMinutes;
          if (revenueShare > 0) {
            hourlyRevenue[hour] += revenueShare * (chunkMinutes / overlapMinutes);
          }
          hourlySessionIds[hour].add(session.id);
        }
        chunkStart = chunkEnd;
      }

      const daySegments = splitByBusinessDay(overlap.startMs, overlap.endMs, resetMinutes);
      for (const segment of daySegments) {
        const segmentMinutes = toMinutes(segment.endMs - segment.startMs);
        if (segmentMinutes <= 0) {
          continue;
        }
        const segmentRevenue = revenueShare > 0
          ? revenueShare * (segmentMinutes / overlapMinutes)
          : 0;
        revenueByBusinessDayKey.set(
          segment.key,
          (revenueByBusinessDayKey.get(segment.key) ?? 0) + segmentRevenue,
        );
      }
    }

    let capacityCursor = windowStartMs;
    while (capacityCursor < windowEndMs) {
      const chunkDate = new Date(capacityCursor);
      const hour = chunkDate.getHours();
      const nextHour = new Date(chunkDate);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      const chunkEnd = Math.min(windowEndMs, nextHour.getTime());
      const chunkMinutes = toMinutes(chunkEnd - capacityCursor);
      hourlyCapacityMinutes[hour] += chunkMinutes * tableIds.length;
      capacityCursor = chunkEnd;
    }

    const tableRows = tables.map((table) => {
      const merged = mergeIntervals(tableIntervals.get(table.id) ?? []);
      const runningMinutes = merged.reduce((sum, interval) => sum + toMinutes(interval.endMs - interval.startMs), 0);
      const idleMinutes = Math.max(windowMinutes - runningMinutes, 0);
      const revenue = tableRevenue.get(table.id) ?? 0;
      return {
        tableId: table.id,
        tableName: table.name,
        runningMinutes: roundMinutes(runningMinutes),
        idleMinutes: roundMinutes(idleMinutes),
        utilizationPct: toPercent(runningMinutes, windowMinutes),
        revenue: roundMoney(revenue),
        sessionCount: tableSessionIds.get(table.id)?.size ?? 0,
      };
    });

    const totalRunningMinutes = tableRows.reduce((sum, row) => sum + row.runningMinutes, 0);
    const totalIdleMinutes = tableRows.reduce((sum, row) => sum + row.idleMinutes, 0);
    const totalRevenue = tableRows.reduce((sum, row) => sum + row.revenue, 0);
    const totalCapacityMinutes = roundMinutes(windowMinutes * tableIds.length);
    const reportDays = Math.max(windowInfo.reportDays, 1);
    const dailyAverageRevenue = roundMoney(totalRevenue / reportDays);

    const hourlyRows = Array.from({ length: 24 }, (_, hour) => {
      const running = hourlyRunningMinutes[hour];
      const capacity = hourlyCapacityMinutes[hour];
      const idle = Math.max(capacity - running, 0);
      return {
        hour,
        label: `${String(hour).padStart(2, "0")}:00`,
        runningMinutes: roundMinutes(running),
        idleMinutes: roundMinutes(idle),
        capacityMinutes: roundMinutes(capacity),
        utilizationPct: toPercent(running, capacity),
        revenue: roundMoney(hourlyRevenue[hour]),
        sessionCount: hourlySessionIds[hour].size,
      };
    });

    const byRevenue = [...hourlyRows].sort((a, b) => b.revenue - a.revenue || b.runningMinutes - a.runningMinutes);
    const byUtilization = [...hourlyRows].sort((a, b) => b.utilizationPct - a.utilizationPct || b.runningMinutes - a.runningMinutes);

    let revenueSeries: { mode: "day" | "hour"; points: RevenueSeriesPoint[] };
    if (windowInfo.reportDays > 1) {
      const dayPoints: RevenueSeriesPoint[] = [];
      const rangeStart = windowInfo.startDate ?? getBusinessDayRangeWithReset(windowInfo.start, resetMinutes).key;
      const rangeEnd = windowInfo.endDate ?? getBusinessDayRangeWithReset(new Date(windowInfo.end.getTime() - 1), resetMinutes).key;
      const startRange = getBusinessDayRangeFromKeyWithReset(rangeStart, resetMinutes).start;
      const endRange = getBusinessDayRangeFromKeyWithReset(rangeEnd, resetMinutes).start;

      const cursor = new Date(startRange);
      while (cursor.getTime() <= endRange.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        dayPoints.push({
          label: key.slice(5),
          revenue: roundMoney(revenueByBusinessDayKey.get(key) ?? 0),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      revenueSeries = {
        mode: "day",
        points: dayPoints,
      };
    } else {
      revenueSeries = {
        mode: "hour",
        points: buildHourlyRevenueSeries(hourlyRows),
      };
    }

    return Response.json(
      {
        data: {
          window: {
            scope: windowInfo.scope,
            key: windowInfo.key ?? null,
            startDate: windowInfo.startDate ?? null,
            endDate: windowInfo.endDate ?? null,
            start: windowInfo.start.toISOString(),
            end: windowInfo.end.toISOString(),
            totalMinutes: roundMinutes(windowMinutes),
            tableCount: tableIds.length,
            reportDays,
          },
          overall: {
            totalRunningMinutes,
            totalIdleMinutes,
            totalCapacityMinutes,
            utilizationPct: toPercent(totalRunningMinutes, totalCapacityMinutes),
            revenue: totalRevenue,
            dailyAverageRevenue,
          },
          tables: tableRows.sort((a, b) => b.revenue - a.revenue || b.utilizationPct - a.utilizationPct),
          hourly: hourlyRows,
          highlights: {
            bestRevenueHour: byRevenue[0] ?? null,
            slowestRevenueHour: byRevenue[byRevenue.length - 1] ?? null,
            bestUtilizationHour: byUtilization[0] ?? null,
            slowestUtilizationHour: byUtilization[byUtilization.length - 1] ?? null,
          },
          revenueSeries,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
