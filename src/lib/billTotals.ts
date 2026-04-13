export type BillTotalsInput = {
  totalAmount: number;
  discountType: string | null | undefined;
  discountedAmount: number | null | undefined;
  sessionsAmount?: number;
  paidAmount?: number;
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getCollectedPaidAmount(
  payments: Array<{
    amount: number;
    mode: string;
    dueSettledAt?: Date | null;
  }>,
): number {
  return roundMoney(payments.reduce(
    (sum, payment) => sum + (typeof payment.amount === "number" ? payment.amount : 0),
    0,
  ));
}

export function getEffectiveBillTotals(input: BillTotalsInput): {
  subtotal: number;
  discount: number;
  finalAmount: number;
  totalAmount: number;
  discountedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  remaining: number;
} {
  const sessionsAmount = roundMoney(
    typeof input.sessionsAmount === "number" ? input.sessionsAmount : 0,
  );
  const paidAmount = roundMoney(typeof input.paidAmount === "number" ? input.paidAmount : 0);

  const totalAmount = roundMoney(input.totalAmount > 0 ? input.totalAmount : sessionsAmount);
  const discountedAmount =
    (input.discountType === "fixed" || input.discountType === "percent") &&
    typeof input.discountedAmount === "number"
      ? roundMoney(input.discountedAmount)
      : totalAmount;
  const remainingAmount = roundMoney(Math.max(discountedAmount - paidAmount, 0));
  const subtotal = totalAmount;
  const finalAmount = discountedAmount;
  const discount = roundMoney(Math.max(subtotal - finalAmount, 0));
  const remaining = remainingAmount;

  return {
    subtotal,
    discount,
    finalAmount,
    totalAmount,
    discountedAmount,
    paidAmount,
    remainingAmount,
    remaining,
  };
}
