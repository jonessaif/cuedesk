import { describe, expect, it } from "vitest";
import {
  getEffectiveStatus,
  getLedgerStatus,
  getTableStatus,
} from "@/lib/session-status";
import { canTransition } from "@/lib/state-machine";

describe("Session status helpers", () => {
  it("should resolve effective status from override", () => {
    expect(getEffectiveStatus({ status: "running", overrideStatus: null })).toBe("running");
    expect(getEffectiveStatus({ status: "running", overrideStatus: "billed" })).toBe("billed");
    expect(getEffectiveStatus({ status: "completed", overrideStatus: "running" })).toBe("running");
  });

  it("should allow only backward transitions by state order", () => {
    expect(canTransition("Paid", "Billed")).toBe(true);
    expect(canTransition("Billed", "Completed")).toBe(true);
    expect(canTransition("Completed", "Running")).toBe(true);
    expect(canTransition("Running", "Completed")).toBe(false);
  });

  it("should derive ledger statuses for payment edges", () => {
    expect(
      getLedgerStatus({
        effectiveStatus: "running",
        billId: null,
        paidAmount: 0,
        amount: 100,
      }),
    ).toBe("Running");

    expect(
      getLedgerStatus({
        effectiveStatus: "completed",
        billId: null,
        paidAmount: 0,
        amount: 100,
      }),
    ).toBe("Completed");

    expect(
      getLedgerStatus({
        effectiveStatus: "billed",
        billId: 10,
        paidAmount: 0,
        amount: 100,
      }),
    ).toBe("Billed-Unpaid");

    expect(
      getLedgerStatus({
        effectiveStatus: "billed",
        billId: 10,
        paidAmount: 40,
        amount: 100,
      }),
    ).toBe("Partially-Paid");

    expect(
      getLedgerStatus({
        effectiveStatus: "billed",
        billId: 10,
        paidAmount: 100,
        amount: 100,
      }),
    ).toBe("Paid");
  });

  it("should derive table statuses from effective status and billing", () => {
    expect(
      getTableStatus({
        effectiveStatus: "running",
        billId: null,
        payerMode: "none",
      }),
    ).toBe("Running-NoPayer");

    expect(
      getTableStatus({
        effectiveStatus: "running",
        billId: null,
        payerMode: "single",
      }),
    ).toBe("Running-Single");

    expect(
      getTableStatus({
        effectiveStatus: "completed",
        billId: null,
        payerMode: "single",
      }),
    ).toBe("Completed (Unbilled)");

    expect(
      getTableStatus({
        effectiveStatus: "completed",
        billId: 99,
        payerMode: "single",
      }),
    ).toBe("Billed");
  });
});
