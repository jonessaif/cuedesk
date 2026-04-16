import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getLedgerResetMinutes, setLedgerResetMinutes } from "@/lib/settings-service";

function toHHmm(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes)));
  const hh = String(Math.floor(safe / 60)).padStart(2, "0");
  const mm = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseHHmm(value: string): number {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error("Invalid time");
  }
  const [hhRaw, mmRaw] = value.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error("Invalid time");
  }
  return hh * 60 + mm;
}

export async function GET(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const minutes = await getLedgerResetMinutes(prisma);
    return Response.json({
      data: {
        ledgerResetMinutes: minutes,
        ledgerResetTime: toHHmm(minutes),
      },
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireRole(prisma, request, "admin");
    const body = (await request.json()) as { ledgerResetTime?: string };
    const time = String(body.ledgerResetTime ?? "");
    const minutes = parseHHmm(time);
    const updated = await setLedgerResetMinutes(prisma, minutes);
    return Response.json({
      data: {
        ledgerResetMinutes: updated,
        ledgerResetTime: toHHmm(updated),
      },
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
