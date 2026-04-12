export type SessionStatusValue = "running" | "completed" | "billed";
export type PayerModeValue = "none" | "single" | "split";

export function getEffectiveStatus(input: {
  status: SessionStatusValue;
  overrideStatus?: string | null;
}): SessionStatusValue {
  const candidate = input.overrideStatus ?? input.status;
  if (candidate === "running" || candidate === "completed" || candidate === "billed") {
    return candidate;
  }
  return input.status;
}

export function isBilled(input: { billId?: number | null }): boolean {
  return typeof input.billId === "number";
}

export function getLedgerStatus(input: {
  effectiveStatus: SessionStatusValue;
  billId: number | null;
  paidAmount: number;
  amount: number;
}): "Running" | "Completed" | "Billed-Unpaid" | "Partially-Paid" | "Paid" {
  if (input.effectiveStatus === "running") {
    return "Running";
  }

  if (!isBilled({ billId: input.billId })) {
    return "Completed";
  }

  if (input.paidAmount === 0) {
    return "Billed-Unpaid";
  }

  if (input.paidAmount < input.amount) {
    return "Partially-Paid";
  }

  return "Paid";
}

export function getTableStatus(input: {
  effectiveStatus: SessionStatusValue;
  billId: number | null;
  payerMode: PayerModeValue;
}):
  | "Free"
  | "Running-NoPayer"
  | "Running-Single"
  | "Running-Split"
  | "Completed (Unbilled)"
  | "Billed" {
  if (input.effectiveStatus === "running") {
    if (input.payerMode === "none") {
      return "Running-NoPayer";
    }
    if (input.payerMode === "single") {
      return "Running-Single";
    }
    return "Running-Split";
  }

  if (!isBilled({ billId: input.billId })) {
    return "Completed (Unbilled)";
  }

  return "Billed";
}
