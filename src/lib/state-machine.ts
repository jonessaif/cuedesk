export type LifecycleState = "Free" | "Running" | "Completed" | "Billed" | "Paid";

export const STATE_ORDER: Record<LifecycleState, number> = {
  Free: 0,
  Running: 1,
  Completed: 2,
  Billed: 3,
  Paid: 4,
};

export function canTransition(current: LifecycleState, next: LifecycleState): boolean {
  return STATE_ORDER[next] <= STATE_ORDER[current];
}

export function deriveLifecycleState(input: {
  status: "running" | "completed" | "billed";
  billId: number | null;
  paidAmount: number;
}): LifecycleState {
  if (input.status === "running") {
    return "Running";
  }

  if (typeof input.billId !== "number") {
    return "Completed";
  }

  if (input.paidAmount > 0) {
    return "Paid";
  }

  return "Billed";
}

export function toSessionStatus(state: LifecycleState): "running" | "completed" | "billed" {
  if (state === "Running") {
    return "running";
  }

  if (state === "Completed" || state === "Free") {
    return "completed";
  }

  return "billed";
}
