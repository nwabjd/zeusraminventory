import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, MinusCircle, PlusCircle, Scale } from "lucide-react";
import { api } from "../../lib/api";
import { money, qty } from "../../lib/format";
import { useCurrency } from "../../lib/app-context";
import { ADJUSTMENT_REASONS } from "../../lib/constants";
import type { AdjustmentInput, AdjustmentOutcome, RamItem } from "../../lib/types";
import {
  Button,
  FormField,
  QuantityInput,
  SelectField,
  TextArea,
} from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { TransactionSummary } from "../ui/Cards";

/* ===========================================================================
   Stock adjustment
   ---------------------------------------------------------------------------
   Used after a physical stock count, for damage, samples and anything else that
   moves stock outside a purchase or a sale. The cost value of an increase is
   booked at the item's current average cost, so no value is invented.
   =========================================================================== */

export interface StockAdjustDialogProps {
  open: boolean;
  item: RamItem | null;
  /** Pre-selects a direction - opened from the decrease action, for example. */
  defaultDirection?: "INCREASE" | "DECREASE";
  onClose: () => void;
  onCompleted?: (outcome: AdjustmentOutcome) => void;
  /**
   * Alternative persistence path used in cloud mode (admin RPC + mirror
   * refresh). Falls back to the engine command when omitted.
   */
  adjustVia?: (input: AdjustmentInput) => Promise<AdjustmentOutcome>;
}

export function StockAdjustDialog({
  open,
  item,
  defaultDirection = "INCREASE",
  onClose,
  onCompleted,
  adjustVia,
}: StockAdjustDialogProps) {
  const currency = useCurrency();
  const [direction, setDirection] = useState<"INCREASE" | "DECREASE">(defaultDirection);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState(ADJUSTMENT_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirection(defaultDirection);
    setQuantity(1);
    setReason(ADJUSTMENT_REASONS[0]);
    setNotes("");
    setErrors({});
    setServerError(null);
  }, [open, defaultDirection, item?.id]);

  if (!item) return null;

  const available = item.quantity;
  const after = direction === "INCREASE" ? available + quantity : available - quantity;
  const tooMany = direction === "DECREASE" && quantity > available;
  const valueAtRisk = Math.abs(after - available) * item.averageCost;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (quantity <= 0) next.quantity = "Enter how many units changed.";
    if (!reason.trim()) next.reason = "A reason is required so the ledger stays readable.";
    if (tooMany) next.quantity = `Only ${qty(available)} unit(s) are in stock.`;
    setErrors(next);
    if (Object.keys(next).length) {
      setServerError(null);
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const input: AdjustmentInput = {
        ramItemId: item.id,
        adjustmentType: direction,
        quantity,
        reason: reason.trim(),
        notes: notes.trim() || undefined,
      };
      const outcome = adjustVia
        ? await adjustVia(input)
        : await api.adjustStock(input);
      onCompleted?.(outcome);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = direction === "INCREASE" ? PlusCircle : MinusCircle;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="md"
      title="Adjust stock"
      subtitle={`${item.sku} - ${item.capacity} ${item.speed} ${item.generation} ${item.category}`}
      icon={<Scale className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={direction === "INCREASE" ? "profit" : "danger-soft"}
            onClick={submit}
            loading={busy}
            icon={busy ? undefined : <Icon className="h-4 w-4" aria-hidden />}
          >
            {direction === "INCREASE" ? "Add to stock" : "Remove from stock"}
          </Button>
        </>
      }
    >
      {serverError && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-xs leading-relaxed font-medium whitespace-pre-wrap text-danger-700"
        >
          {serverError}
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "INCREASE", label: "Increase", icon: ArrowUpFromLine },
              { value: "DECREASE", label: "Decrease", icon: ArrowDownToLine },
            ] as const
          ).map((opt) => {
            const OptIcon = opt.icon;
            const active = direction === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setDirection(opt.value);
                  setErrors({});
                }}
                className={
                  active
                    ? "flex items-center justify-center gap-2 rounded-lg border-2 border-brand-500 bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-800"
                    : "flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-brand-300 hover:text-brand-700"
                }
              >
                <OptIcon className="h-4 w-4" aria-hidden />
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Units" required error={errors.quantity}>
            <QuantityInput
              value={quantity}
              onValueChange={(v) => setQuantity(Math.max(0, Math.trunc(v)))}
              invalid={Boolean(errors.quantity) || tooMany}
              max={direction === "DECREASE" ? available : undefined}
            />
          </FormField>
          <FormField label="Reason" required error={errors.reason}>
            <SelectField
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              options={ADJUSTMENT_REASONS.map((r) => ({ value: r, label: r }))}
              invalid={Boolean(errors.reason)}
            />
          </FormField>
          <FormField label="Counted on">
            <input type="date" readOnly value={new Date().toISOString().slice(0, 10)} className="input tnum" />
          </FormField>
        </div>

        <FormField label="Notes" hint="Optional - who counted it, where, what was found.">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Shelf B recount on Friday morning..."
          />
        </FormField>

        <TransactionSummary
          lines={[
            { label: "In stock now", value: `${qty(available)} units` },
            {
              label: direction === "INCREASE" ? "Added" : "Removed",
              value: `${qty(quantity)} units`,
              tone: direction === "INCREASE" ? "profit" : "danger",
            },
            {
              label: "Stock after",
              value: `${qty(after)} units`,
              tone: after <= 0 ? "danger" : after <= item.minimumStock ? "danger" : "default",
              strong: true,
            },
            {
              label: "Value at average cost",
              value: money(valueAtRisk, currency),
              hint: `${money(item.averageCost, currency)} per unit`,
            },
          ]}
        />

        {tooMany && (
          <p className="rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-semibold text-danger-700">
            You cannot remove more than the {qty(available)} unit(s) currently recorded.
          </p>
        )}
      </div>
    </Modal>
  );
}
