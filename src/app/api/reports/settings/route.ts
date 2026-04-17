import { requireOperatorOrAdmin, requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  getReportChartSettingsBundle,
  upsertReportChartSettings,
  type ChartModeValue,
  type MergeBucket,
} from "@/lib/report-chart-settings-service";

function parseTableId(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid tableId");
  }
  return parsed;
}

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);

    const { searchParams } = new URL(request.url);
    const tableId = parseTableId(searchParams.get("tableId"));
    const data = await getReportChartSettingsBundle(prisma, tableId);

    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireRole(prisma, request, "admin");

    const body = (await request.json()) as {
      target?: "global" | "table";
      tableId?: number;
      chartMode?: ChartModeValue;
      mergeBuckets?: MergeBucket[];
      includeClosed?: boolean;
    };

    if (body.target !== "global" && body.target !== "table") {
      return Response.json({ error: "Invalid target" }, { status: 400 });
    }

    const updated = await upsertReportChartSettings(prisma, {
      target: body.target,
      tableId: body.tableId,
      chartMode: body.chartMode,
      mergeBuckets: body.mergeBuckets,
      includeClosed: body.includeClosed,
    });

    const bundle = await getReportChartSettingsBundle(prisma, body.target === "table" ? body.tableId : undefined);

    return Response.json({ data: { updated, bundle } }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
