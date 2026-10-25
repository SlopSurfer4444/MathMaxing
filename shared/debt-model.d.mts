export type DebtModelFacts = {
  /** Positive principal up to 1e9, with at most 12 decimal places. */
  principal: number;
  /** Percentage per period in [0, 100]; 10 means 10%, not 0.1. */
  rate: number;
};
export type DebtModelStep = {
  id: 'initial' | 'interest-1' | 'payment-1' | 'interest-2' | 'payment-2';
  label: string;
  /** Balance after the named event, not its delta. A negative balance is overpayment. */
  amount: number;
};
export type DebtModelResult = {
  status: 'correct' | 'incorrect' | 'unknown';
  summary: string;
  scope: string;
  mastery: false;
  steps: DebtModelStep[];
  outcome: 'remaining' | 'settled' | 'overpaid' | 'early' | 'invalid';
  /** Final shown balance; for early stops this is the balance after the first payment. */
  finalBalance?: number;
};
/** Pure, bounded check of a proposed payment up to 1e12. Accepts comma or dot decimal
 * input with at most 12 fractional digits. It never rounds the supplied payment.
 * P >= first accrued debt stops at payment-1; no second interest is accrued. */
export function evaluateDebtModel(facts: DebtModelFacts, input: string): DebtModelResult;
