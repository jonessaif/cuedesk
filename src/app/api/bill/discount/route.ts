import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { billingService } from "@/lib/services/billingService";

export async function POST(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (
      typeof body.billId !== "number" ||
      !Number.isFinite(body.billId) ||
      body.billId <= 0
    ) {
      return Response.json({ error: "Invalid billId" }, { status: 400 });
    }

    const discountTypeRaw =
      body.discountType === undefined || body.discountType === null
        ? undefined
        : String(body.discountType).toLowerCase();
    const discountType = discountTypeRaw === "none" ? undefined : discountTypeRaw;
    const discountValueRaw = body.discountValue;
    const discountValue =
      discountValueRaw === undefined || discountValueRaw === null || discountValueRaw === ""
        ? undefined
        : Number(discountValueRaw);

    if (
      discountType !== undefined &&
      discountType !== "fixed" &&
      discountType !== "percent"
    ) {
      return Response.json({ error: "Invalid discountType" }, { status: 400 });
    }

    if (
      discountType !== undefined &&
      discountValue !== undefined &&
      (!Number.isFinite(discountValue) || discountValue < 0)
    ) {
      return Response.json({ error: "Invalid discountValue" }, { status: 400 });
    }

    if (
      discountType === "percent" &&
      discountValue !== undefined &&
      discountValue > 100
    ) {
      return Response.json({ error: "Invalid percent discount" }, { status: 400 });
    }

    const updated = await billingService.applyDiscount(prisma as never, {
      billId: body.billId,
      discountType: discountType as "fixed" | "percent" | undefined,
      discountValue,
    });

    return Response.json(updated, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
