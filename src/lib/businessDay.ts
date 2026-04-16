export type BusinessDayRange = {
  key: string;
  start: Date;
  end: Date;
};

const DEFAULT_LEDGER_RESET_MINUTES = 10 * 60;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeResetMinutes(resetMinutes: number): number {
  if (!Number.isFinite(resetMinutes)) {
    return DEFAULT_LEDGER_RESET_MINUTES;
  }
  const rounded = Math.floor(resetMinutes);
  if (rounded < 0 || rounded > 23 * 60 + 59) {
    return DEFAULT_LEDGER_RESET_MINUTES;
  }
  return rounded;
}

function toResetHourMinute(resetMinutes: number): { hour: number; minute: number } {
  const safe = normalizeResetMinutes(resetMinutes);
  return {
    hour: Math.floor(safe / 60),
    minute: safe % 60,
  };
}

export function getBusinessDayRangeWithReset(now: Date, resetMinutes: number): BusinessDayRange {
  const anchor = new Date(now);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Invalid date");
  }

  const { hour, minute } = toResetHourMinute(resetMinutes);
  const start = new Date(anchor);
  start.setHours(hour, minute, 0, 0);
  if (anchor.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const key = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
  return { key, start, end };
}

export function getBusinessDayRange(now: Date): BusinessDayRange {
  return getBusinessDayRangeWithReset(now, DEFAULT_LEDGER_RESET_MINUTES);
}

export function getBusinessDayRangeFromKeyWithReset(
  key: string,
  resetMinutes: number,
): BusinessDayRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error("Invalid date");
  }
  const [yearRaw, monthRaw, dayRaw] = key.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const { hour, minute } = toResetHourMinute(resetMinutes);
  const start = new Date(year, month - 1, day, hour, minute, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { key, start, end };
}

export function getBusinessDayRangeFromKey(key: string): BusinessDayRange {
  return getBusinessDayRangeFromKeyWithReset(key, DEFAULT_LEDGER_RESET_MINUTES);
}
