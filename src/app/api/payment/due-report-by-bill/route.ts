import { prisma } from "@/lib/prisma";
import { paymentService } from "@/lib/services/paymentService";

export async function GET() {
  try {
    const data = await paymentService.getDueReportByBill(prisma as never);
    return Response.json({ data }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
