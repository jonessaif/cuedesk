import type { PrismaClient } from "@prisma/client";

export type ChartModeValue = "auto" | "day" | "hour";

export type MergeBucket = {
  startHour: number;
  endHour: number;
  label: string;
};

export type ReportChartSettings = {
  target: "global" | "table";
  tableId: number | null;
  chartMode: ChartModeValue;
  mergeBuckets: MergeBucket[];
  includeClosed: boolean;
  updatedAt: string | null;
};

export type ReportChartSettingsBundle = {
  global: ReportChartSettings;
  table: ReportChartSettings | null;
  effective: ReportChartSettings;
};

const DEFAULT_MERGE_BUCKETS: MergeBucket[] = [
  { startHour: 8, endHour: 11, label: "08-11" },
];

function ensureModel(prisma: PrismaClient): {
  findUnique: (args: { where: { targetKey: string } }) => Promise<ReportChartConfigRow | null>;
  upsert: (args: {
    where: { targetKey: string };
    update: {
      tableId?: number | null;
      chartMode: ChartModeValue;
      mergeBucketsJson: unknown;
      includeClosed: boolean;
    };
    create: {
      targetKey: string;
      tableId?: number | null;
      chartMode: ChartModeValue;
      mergeBucketsJson: unknown;
      includeClosed: boolean;
    };
  }) => Promise<ReportChartConfigRow>;
} {
  const model = (prisma as { reportChartConfig?: unknown }).reportChartConfig;
  if (!model) {
    throw new Error("Report chart settings model is not available. Run prisma generate and db push.");
  }
  return model as {
    findUnique: (args: { where: { targetKey: string } }) => Promise<ReportChartConfigRow | null>;
    upsert: (args: {
      where: { targetKey: string };
      update: {
        tableId?: number | null;
        chartMode: ChartModeValue;
        mergeBucketsJson: unknown;
        includeClosed: boolean;
      };
      create: {
        targetKey: string;
        tableId?: number | null;
        chartMode: ChartModeValue;
        mergeBucketsJson: unknown;
        includeClosed: boolean;
      };
    }) => Promise<ReportChartConfigRow>;
  };
}

type ReportChartConfigRow = {
  id: number;
  targetKey: string;
  tableId: number | null;
  chartMode: ChartModeValue;
  mergeBucketsJson: unknown;
  includeClosed: boolean;
  updatedAt: Date;
};

function defaultSettings(target: "global" | "table", tableId: number | null): ReportChartSettings {
  return {
    target,
    tableId,
    chartMode: "auto",
    mergeBuckets: [...DEFAULT_MERGE_BUCKETS],
    includeClosed: true,
    updatedAt: null,
  };
}

function normalizeHour(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function normalizeLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, 24);
}

function parseMergeBuckets(value: unknown): MergeBucket[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_MERGE_BUCKETS];
  }

  const parsed = value.map((row) => {
    const startHour = normalizeHour(Number((row as { startHour?: unknown }).startHour), "startHour");
    const endHour = normalizeHour(Number((row as { endHour?: unknown }).endHour), "endHour");
    if (endHour < startHour) {
      throw new Error("Invalid merge bucket range");
    }
    const defaultLabel = `${String(startHour).padStart(2, "0")}-${String(endHour).padStart(2, "0")}`;
    const label = normalizeLabel(String((row as { label?: unknown }).label ?? defaultLabel), defaultLabel);
    return { startHour, endHour, label };
  });

  parsed.sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  for (let index = 1; index < parsed.length; index += 1) {
    const prev = parsed[index - 1];
    const current = parsed[index];
    if (current.startHour <= prev.endHour) {
      throw new Error("Merge buckets cannot overlap");
    }
  }

  return parsed;
}

function normalizeChartMode(value: unknown): ChartModeValue {
  if (value === "auto" || value === "day" || value === "hour") {
    return value;
  }
  throw new Error("Invalid chartMode");
}

function normalizeIncludeClosed(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Invalid includeClosed");
  }
  return value;
}

function normalizeTableId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid tableId");
  }
  return parsed;
}

function rowToSettings(row: ReportChartConfigRow, target: "global" | "table"): ReportChartSettings {
  return {
    target,
    tableId: row.tableId,
    chartMode: row.chartMode,
    mergeBuckets: parseMergeBuckets(row.mergeBucketsJson),
    includeClosed: row.includeClosed,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function tableTargetKey(tableId: number): string {
  return `table:${tableId}`;
}

async function loadByTargetKey(
  prisma: PrismaClient,
  targetKey: string,
): Promise<ReportChartConfigRow | null> {
  const model = ensureModel(prisma);
  return model.findUnique({ where: { targetKey } });
}

export async function getReportChartSettingsBundle(
  prisma: PrismaClient,
  tableId?: number,
): Promise<ReportChartSettingsBundle> {
  const globalRow = await loadByTargetKey(prisma, "global");
  const globalSettings = globalRow ? rowToSettings(globalRow, "global") : defaultSettings("global", null);

  if (!tableId) {
    return {
      global: globalSettings,
      table: null,
      effective: globalSettings,
    };
  }

  const tableRow = await loadByTargetKey(prisma, tableTargetKey(tableId));
  const tableSettings = tableRow ? rowToSettings(tableRow, "table") : null;

  return {
    global: globalSettings,
    table: tableSettings,
    effective: tableSettings ?? globalSettings,
  };
}

export async function upsertReportChartSettings(
  prisma: PrismaClient,
  input: {
    target: "global" | "table";
    tableId?: number;
    chartMode?: ChartModeValue;
    mergeBuckets?: MergeBucket[];
    includeClosed?: boolean;
  },
): Promise<ReportChartSettings> {
  const model = ensureModel(prisma);

  const target = input.target;
  let tableId: number | null = null;
  if (target === "table") {
    tableId = normalizeTableId(input.tableId);
  }
  let targetKey = "global";
  if (target === "table") {
    if (tableId === null) {
      throw new Error("Invalid tableId");
    }
    targetKey = tableTargetKey(tableId);
  }
  const existing = await model.findUnique({ where: { targetKey } });

  const prev = existing
    ? rowToSettings(existing, target)
    : defaultSettings(target, target === "table" ? tableId : null);

  const chartMode = input.chartMode === undefined ? prev.chartMode : normalizeChartMode(input.chartMode);
  const mergeBuckets = input.mergeBuckets === undefined
    ? prev.mergeBuckets
    : parseMergeBuckets(input.mergeBuckets);
  const includeClosed = input.includeClosed === undefined
    ? prev.includeClosed
    : normalizeIncludeClosed(input.includeClosed);

  const updated = await model.upsert({
    where: { targetKey },
    update: {
      tableId: target === "table" ? tableId : null,
      chartMode,
      mergeBucketsJson: mergeBuckets,
      includeClosed,
    },
    create: {
      targetKey,
      tableId: target === "table" ? tableId : null,
      chartMode,
      mergeBucketsJson: mergeBuckets,
      includeClosed,
    },
  });

  return rowToSettings(updated, target);
}
