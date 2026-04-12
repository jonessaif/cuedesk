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

export function getEffectiveBillTotals(input: BillTotalsInput): {
  totalAmount: number;
  discountedAmount: number;
  paidAmount: number;
  remainingAmount: number;
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

  return {
    totalAmount,
    discountedAmount,
    paidAmount,
    remainingAmount,
  };
}
