import { describe, expect, it } from "vitest";
import { calculateDurationMinutes } from "@/lib/services/timerService";

describe("Timer logic module", () => {
  it("should calculate floor minutes elapsed from start_time to now", () => {
    const startTime = new Date("2026-04-12T10:00:00.000Z");
    const now = new Date("2026-04-12T10:10:45.000Z");

    const result = calculateDurationMinutes(startTime, now);

    expect(result).toBe(10);
  });

  it("should return zero when elapsed is below one minute", () => {
    const startTime = new Date("2026-04-12T10:00:30.000Z");
    const now = new Date("2026-04-12T10:00:50.000Z");

    const result = calculateDurationMinutes(startTime, now);

    expect(result).toBe(0);
  });
});
