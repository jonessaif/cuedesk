import { describe, expect, it, vi } from "vitest";

import {
  getReportChartSettingsBundle,
  upsertReportChartSettings,
} from "@/lib/report-chart-settings-service";

describe("report-chart-settings-service", () => {
  it("returns defaults when rows do not exist", async () => {
    const prisma = {
      reportChartConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };
    const bundle = await getReportChartSettingsBundle(prisma as never);
    expect(bundle.global.chartMode).toBe("auto");
    expect(bundle.effective.target).toBe("global");
  });

  it("loads global and table-specific rows", async () => {
    const findUnique = vi
      .fn()
      .mockImplementation(({ where }: { where: { targetKey: string } }) => {
        if (where.targetKey === "global") {
          return Promise.resolve({
            id: 1,
            targetKey: "global",
            tableId: null,
            chartMode: "hour",
            mergeBucketsJson: [{ startHour: 12, endHour: 13, label: "Lunch" }],
            includeClosed: false,
            updatedAt: new Date("2026-04-21T10:00:00.000Z"),
          });
        }
        if (where.targetKey === "table:7") {
          return Promise.resolve({
            id: 2,
            targetKey: "table:7",
            tableId: 7,
            chartMode: "day",
            mergeBucketsJson: [{ startHour: 8, endHour: 10, label: "Morning" }],
            includeClosed: true,
            updatedAt: new Date("2026-04-21T10:00:00.000Z"),
          });
        }
        return Promise.resolve(null);
      });
    const prisma = {
      reportChartConfig: {
        findUnique,
        upsert: vi.fn(),
      },
    };
    const bundle = await getReportChartSettingsBundle(prisma as never, 7);
    expect(bundle.global.chartMode).toBe("hour");
    expect(bundle.table?.chartMode).toBe("day");
    expect(bundle.effective.tableId).toBe(7);
  });

  it("validates table target and overlap errors", async () => {
    const prisma = {
      reportChartConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };
    await expect(
      upsertReportChartSettings(prisma as never, {
        target: "table",
        tableId: 0,
      }),
    ).rejects.toThrow("Invalid tableId");

    await expect(
      upsertReportChartSettings(prisma as never, {
        target: "global",
        mergeBuckets: [
          { startHour: 8, endHour: 10, label: "A" },
          { startHour: 10, endHour: 11, label: "B" },
        ],
      }),
    ).rejects.toThrow("Merge buckets cannot overlap");
  });

  it("upserts global settings with parsed defaults", async () => {
    const prisma = {
      reportChartConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: 1,
          targetKey: "global",
          tableId: null,
          chartMode: "auto",
          mergeBucketsJson: [{ startHour: 8, endHour: 11, label: "08-11" }],
          includeClosed: true,
          updatedAt: new Date("2026-04-21T10:00:00.000Z"),
        }),
      },
    };
    const updated = await upsertReportChartSettings(prisma as never, {
      target: "global",
      chartMode: "auto",
      includeClosed: true,
    });
    expect(updated.target).toBe("global");
    expect(updated.mergeBuckets[0].label).toBe("08-11");
    expect(prisma.reportChartConfig.upsert).toHaveBeenCalledTimes(1);
  });
});
