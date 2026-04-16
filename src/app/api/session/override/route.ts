import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { sessionService } from "@/lib/services/sessionService";

type OverridePayerMode = "none" | "single" | "split";
type OverrideStatus = "running" | "completed" | "billed" | "default";
type OverrideOutcome = "NORMAL" | "LTP_LOSS";
type PaymentMode = "cash" | "upi" | "card" | "due";

export async function POST(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (
      typeof body.sessionId !== "number" ||
      !Number.isFinite(body.sessionId) ||
      body.sessionId <= 0
    ) {
      return Response.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    if (
      body.overridePlayerName === undefined &&
      body.overrideStartTime === undefined &&
      body.overrideEndTime === undefined &&
      body.overrideRatePerMin === undefined &&
      body.overridePayerMode === undefined &&
      body.overridePayerData === undefined &&
      body.overrideStatus === undefined &&
      body.overrideOutcome === undefined &&
      body.overridePaymentModes === undefined
    ) {
      return Response.json({ error: "No override fields provided" }, { status: 400 });
    }

    const overrideStartTime =
      body.overrideStartTime === undefined
        ? undefined
        : typeof body.overrideStartTime === "string"
          ? new Date(body.overrideStartTime)
          : null;
    const overrideEndTime =
      body.overrideEndTime === undefined
        ? undefined
        : typeof body.overrideEndTime === "string"
          ? new Date(body.overrideEndTime)
          : null;
    const overrideRatePerMin =
      body.overrideRatePerMin === undefined
        ? undefined
        : Number(body.overrideRatePerMin);
    const overridePlayerName =
      body.overridePlayerName === undefined
        ? undefined
        : typeof body.overridePlayerName === "string"
          ? body.overridePlayerName.trim()
          : null;
    const overridePayerModeRaw =
      body.overridePayerMode === undefined
        ? undefined
        : String(body.overridePayerMode);
    const overridePayerData = body.overridePayerData;
    const overrideStatusRaw =
      body.overrideStatus === undefined ? undefined : String(body.overrideStatus);
    const overrideOutcomeRaw =
      body.overrideOutcome === undefined ? undefined : String(body.overrideOutcome).toUpperCase();
    const overridePaymentModesRaw = body.overridePaymentModes;
    const adminOverride =
      body.adminOverride === undefined ? undefined : Boolean(body.adminOverride);

    if (
      overrideStartTime === null ||
      (overrideStartTime && Number.isNaN(overrideStartTime.getTime()))
    ) {
      return Response.json({ error: "Invalid overrideStartTime" }, { status: 400 });
    }

    if (
      overrideEndTime === null ||
      (overrideEndTime && Number.isNaN(overrideEndTime.getTime()))
    ) {
      return Response.json({ error: "Invalid overrideEndTime" }, { status: 400 });
    }

    if (
      overrideRatePerMin !== undefined &&
      (!Number.isFinite(overrideRatePerMin) || overrideRatePerMin <= 0)
    ) {
      return Response.json({ error: "Invalid overrideRatePerMin" }, { status: 400 });
    }

    if (overridePlayerName === null || (overridePlayerName !== undefined && overridePlayerName === "")) {
      return Response.json({ error: "Invalid overridePlayerName" }, { status: 400 });
    }

    if (
      overridePayerModeRaw !== undefined &&
      overridePayerModeRaw !== "none" &&
      overridePayerModeRaw !== "single" &&
      overridePayerModeRaw !== "split"
    ) {
      return Response.json({ error: "Invalid overridePayerMode" }, { status: 400 });
    }

    const overridePayerMode = overridePayerModeRaw as OverridePayerMode | undefined;
    if (
      overrideStatusRaw !== undefined &&
      overrideStatusRaw !== "running" &&
      overrideStatusRaw !== "completed" &&
      overrideStatusRaw !== "billed" &&
      overrideStatusRaw !== "default"
    ) {
      return Response.json({ error: "Invalid overrideStatus" }, { status: 400 });
    }

    const overrideStatus = overrideStatusRaw as OverrideStatus | undefined;
    if (
      overrideOutcomeRaw !== undefined &&
      overrideOutcomeRaw !== "NORMAL" &&
      overrideOutcomeRaw !== "LTP_LOSS"
    ) {
      return Response.json({ error: "Invalid overrideOutcome" }, { status: 400 });
    }
    const overrideOutcome = overrideOutcomeRaw as OverrideOutcome | undefined;

    let overridePaymentModes: PaymentMode[] | null | undefined;
    if (overridePaymentModesRaw !== undefined) {
      if (overridePaymentModesRaw === null) {
        overridePaymentModes = null;
      } else if (Array.isArray(overridePaymentModesRaw)) {
        const parsed = overridePaymentModesRaw.map((value) => String(value).toLowerCase());
        const valid = parsed.every(
          (mode) => mode === "cash" || mode === "upi" || mode === "card" || mode === "due",
        );
        if (!valid) {
          return Response.json({ error: "Invalid overridePaymentModes" }, { status: 400 });
        }
        overridePaymentModes = Array.from(new Set(parsed)) as PaymentMode[];
      } else {
        return Response.json({ error: "Invalid overridePaymentModes" }, { status: 400 });
      }
    }

    if (overridePayerMode === "single") {
      const name = (overridePayerData as { name?: unknown } | null | undefined)?.name;
      if (typeof name !== "string" || name.trim() === "") {
        return Response.json({ error: "Invalid single payer data" }, { status: 400 });
      }
    }

    if (overridePayerMode === "split") {
      if (!Array.isArray(overridePayerData)) {
        return Response.json({ error: "Invalid split payer data" }, { status: 400 });
      }

      const total = overridePayerData.reduce((sum, row) => {
        const percentage = (row as { percentage?: unknown }).percentage;
        if (typeof percentage !== "number" || Number.isNaN(percentage)) {
          return Number.NaN;
        }
        return sum + percentage;
      }, 0);

      if (!Number.isFinite(total) || total !== 100) {
        return Response.json({ error: "Invalid split percentage" }, { status: 400 });
      }
    }

    if (
      overrideStartTime &&
      overrideEndTime &&
      overrideEndTime.getTime() <= overrideStartTime.getTime()
    ) {
      return Response.json({ error: "Invalid override range" }, { status: 400 });
    }

    const session = await sessionService.overrideSession(prisma as never, {
      sessionId: body.sessionId,
      overridePlayerName,
      overrideStartTime,
      overrideEndTime,
      overrideRatePerMin,
      overridePayerMode,
      overridePayerData,
      overrideStatus,
      overrideOutcome,
      overridePaymentModes,
      adminOverride,
    });

    return Response.json(session, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
