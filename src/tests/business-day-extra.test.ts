import { describe, expect, it } from "vitest";

import {
  getBusinessDayRangeFromKeyWithReset,
  getBusinessDayRangeWithReset,
} from "@/lib/businessDay";

describe("businessDay extra coverage", () => {
  it("falls back to default reset on invalid reset minutes", () => {
    const now = new Date("2026-04-21T08:00:00");
    const range = getBusinessDayRangeWithReset(now, Number.NaN);
    expect(range.start.getHours()).toBe(10);
    expect(range.start.getMinutes()).toBe(0);
  });

  it("uses previous day key before reset hour", () => {
    const now = new Date("2026-04-21T09:59:00");
    const range = getBusinessDayRangeWithReset(now, 10 * 60);
    expect(range.key).toBe("2026-04-20");
  });

  it("throws on invalid key format", () => {
    expect(() => getBusinessDayRangeFromKeyWithReset("21-04-2026", 600)).toThrow("Invalid date");
  });

  it("throws on invalid date input object", () => {
    expect(() => getBusinessDayRangeWithReset(new Date("invalid"), 600)).toThrow("Invalid date");
  });
});
