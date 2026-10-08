/* ===========================================================================
   Payment panel - the settlement half of a transaction.
   ---------------------------------------------------------------------------
   Shared by BUY RAM, SELL RAM and the standalone payment dialog so the "how much
   is being paid, by which method, and what is left" logic is written once. The
   backend re-validates every one of these rules; this only keeps the operator
   from having to fix mistakes twice.
   =========================================================================== */

import { Check, Wallet } from "lucide-react";
import { cn, money, remainingOf } from "../../lib/format";
import { PAYMENT_METHODS } from "../../lib/constants";
import { CurrencyInput, FormField, SelectField } from "./Controls";

export type PayKind = "paid" | "received";

export interface PaymentPanelProps {
  kind: PayKind;
  currency: string;
  /** Document total after discount - the amount settlement is measured against. */
  total: number;
  /** Amount already settled against the document (0 for a new document). */
  settled?: number;
  amount: number;
  onAmountChange: (value: number) => void;
  method: string;
  onMethodChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  /** Credit / on-account is allowed for these document types. */
  allowCredit?: boolean;
  error?: string;
  disabled?: boolean;
}

/**
 * Payment method, amount and date for a document.
 *
 * `amount` is capped at the outstanding balance by default so the common
 * "paid in full" case is one click, while a part payment is still reachable by
 * typing any smaller number.
 */
export function PaymentPanel({
  kind,
  currency,
  total,
  settled = 0,
  amount,
  onAmountChange,
  method,
  onMethodChange,
  date,
  onDateChange,
  allowCredit = true,
  error,
  disabled,
}: PaymentPanelProps) {
  const outstanding = remainingOf(total, settled);
  const isSettleInFull = outstanding > 0.005;
  const entered = Math.max(0, amount);
  const over = entered > outstanding + 0.005;
  const effectiveMethod = allowCredit ? method : method === "Credit" ? "Cash" : method;
  const leaveOnAccount = effectiveMethod === "Credit";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField
          label={kind === "paid" ? "Amount paid now" : "Amount received now"}
          required={!leaveOnAccount}
          hint={
            outstanding <= 0.005
              ? "Fully settled"
              : `${kind === "paid" ? "Outstanding" : "Receivable"} ${money(outstanding, currency)}`
          }
          error={over ? `Only ${money(outstanding, currency)} is outstanding.` : undefined}
        >
          <div className="flex items-center gap-1.5">
            <CurrencyInput
              value={amount}
              onValueChange={(v) => onAmountChange(Math.max(0, v))}
              currency={currency}
              disabled={disabled || outstanding <= 0.005}
              invalid={over}
              autoFocus
            />
            {isSettleInFull && (
              <button
                type="button"
                title={`${kind === "paid" ? "Pay" : "Receive"} the full ${money(outstanding, currency)}`}
                aria-label={`${kind === "paid" ? "Pay" : "Receive"} the full amount`}
                onClick={() => onAmountChange(outstanding)}
                disabled={disabled}
                className={cn(
                  "btn btn-secondary btn-icon h-9 w-9 shrink-0",
                  Math.abs(entered - outstanding) < 0.005 &&
                    "border-profit-500 bg-profit-50 text-profit-700",
                )}
              >
                {Math.abs(entered - outstanding) < 0.005 ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <Wallet className="h-4 w-4" aria-hidden />
                )}
              </button>
            )}
          </div>
        </FormField>

        <FormField label="Payment method" required error={error}>
          <SelectField
            value={effectiveMethod}
            onChange={(e) => onMethodChange(e.target.value)}
            disabled={disabled}
            options={PAYMENT_METHODS.filter((m) => allowCredit || m !== "Credit").map((m) => ({
              value: m,
              label: m,
            }))}
          />
        </FormField>

        <FormField label="Date" required>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            disabled={disabled}
            className="input tnum"
          />
        </FormField>
      </div>

      {leaveOnAccount && (
        <div className="rounded-lg border border-warn-500/30 bg-warn-50 px-3 py-2">
          <p className="text-xs font-semibold text-warn-700">
            On account &mdash; the balance{" "}
            {kind === "paid" ? "stays payable to the seller" : "stays receivable from the buyer"}{" "}
            ({money(remainingOf(total, settled + entered), currency)}) and appears on their
            balance until it is settled.
          </p>
        </div>
      )}
    </div>
  );
}
