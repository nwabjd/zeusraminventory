import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, HandCoins, UsersRound } from "lucide-react";
import { api, todayIso } from "../../lib/api";
import { money, paymentLabel, personLabel } from "../../lib/format";
import { useCurrency } from "../../lib/app-context";
import { PAYMENT_METHODS } from "../../lib/constants";
import type { Party, Payment } from "../../lib/types";
import {
  Button,
  CurrencyInput,
  FormField,
  SelectField,
  TextArea,
  TextInput,
} from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { TransactionSummary } from "../ui/Cards";
import { PartySelector } from "./PartySelector";

/* ===========================================================================
   Standalone payments
   ---------------------------------------------------------------------------
   Money in from a buyer, money out to a seller. These write through
   `record_payment`, which applies the balance effect and writes the ledger row
   inside one transaction - the same rule the buy/sell screens use.
   =========================================================================== */

export type PaymentMode = "receive" | "pay";

export interface PaymentDialogProps {
  open: boolean;
  mode: PaymentMode;
  onClose: () => void;
  onCompleted?: (payment: Payment) => void;
}

const MODES: Record<PaymentMode, { type: string; title: string; who: string; blurb: string }> = {
  receive: {
    type: "RECEIVE_FROM_BUYER",
    title: "Receive payment",
    who: "buyer",
    blurb: "Money received from a buyer. It reduces what they owe you.",
  },
  pay: {
    type: "PAY_SELLER",
    title: "Pay seller",
    who: "seller",
    blurb: "Money paid to a supplier. It reduces what you owe them.",
  },
};

export function PaymentDialog({ open, mode, onClose, onCompleted }: PaymentDialogProps) {
  const currency = useCurrency();
  const spec = MODES[mode];
  const Icon = mode === "receive" ? ArrowDownLeft : ArrowUpRight;

  const [party, setParty] = useState<Party | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setParty(null);
    setAmount(0);
    setMethod("Cash");
    setDate(todayIso());
    setReference("");
    setNotes("");
    setError({});
    setServerError(null);
  }, [open, mode]);

  const outstanding = useMemo(
    () => (party ? Math.max(0, party.currentBalance) : 0),
    [party],
  );
  const over = party ? amount > outstanding + 0.005 : false;
  const projected = party ? Math.round((party.currentBalance - amount) * 100) / 100 : 0;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!party) next.party = `Choose the ${spec.who} this ${mode === "receive" ? "payment comes from" : "payment goes to"}.`;
    if (amount <= 0) next.amount = "Enter an amount greater than zero.";
    if (!method) next.method = "Choose a payment method.";
    setError(next);
    if (Object.keys(next).length) {
      setServerError(null);
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const saved = await api.recordPayment({
        paymentType: spec.type as Payment["paymentType"],
        personId: party!.id,
        personName: party!.companyName,
        amount,
        paymentMethod: method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        paymentDate: date,
        allowOverpayment: over,
      });
      onCompleted?.(saved);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="md"
      title={spec.title}
      subtitle={spec.blurb}
      icon={<Icon className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={mode === "receive" ? "profit" : "primary"}
            onClick={submit}
            loading={busy}
            icon={busy ? undefined : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          >
            {mode === "receive" ? "Record receipt" : "Record payment"}
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
        <PartySelector
          kind={mode === "receive" ? "buyer" : "seller"}
          value={party}
          onChange={(p) => {
            setParty(p);
            setError((e) => ({ ...e, party: "" }));
            if (p && p.currentBalance > 0.005) setAmount(p.currentBalance);
          }}
          label={mode === "receive" ? "Buyer" : "Seller"}
          required
          error={error.party}
          disabled={busy}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField
            label="Amount"
            required
            error={error.amount}
            hint={
              party
                ? over
                  ? "More than the outstanding balance"
                  : `Outstanding ${money(outstanding, currency)}`
                : "Outstanding appears once a person is chosen"
            }
          >
            <div className="flex items-center gap-1.5">
              <CurrencyInput
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                invalid={Boolean(error.amount) || over}
                disabled={busy}
              />
              {outstanding > 0.005 && (
                <Button
                  size="sm"
                  onClick={() => setAmount(outstanding)}
                  disabled={busy}
                  className="shrink-0"
                >
                  Full
                </Button>
              )}
            </div>
          </FormField>

          <FormField label="Payment method" required error={error.method}>
            <SelectField
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
              disabled={busy}
            />
          </FormField>

          <FormField label="Date" required>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input tnum"
              disabled={busy}
            />
          </FormField>
        </div>

        <FormField label="Reference" hint="Cheque number, transfer reference, receipt number...">
          <TextInput
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. CHQ-104887"
            disabled={busy}
          />
        </FormField>

        {party && (
          <TransactionSummary
            lines={[
              { label: "Person", value: `${party.code} - ${party.companyName}` },
              {
                label: "Outstanding now",
                value: money(party.currentBalance, currency),
                tone: party.currentBalance > 0.005 ? "danger" : "default",
              },
              { label: "This payment", value: `- ${money(amount, currency)}` },
              {
                label: "Outstanding after",
                value: money(projected, currency),
                tone: projected > 0.005 ? "warn" : "profit",
                strong: true,
              },
            ]}
          />
        )}

        {over && (
          <p className="rounded-lg border border-warn-500/30 bg-warn-50 p-2.5 text-xs leading-relaxed text-warn-700">
            This is more than the {spec.who} currently owes. ZEUS will record it and leave a credit
            balance - use it for advance payments or refunds.
          </p>
        )}

        <FormField label="Notes">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth recording against this payment"
            disabled={busy}
          />
        </FormField>
      </div>
    </Modal>
  );
}

/* ============================================================== coworker === */

export interface CoworkerPaymentDialogProps {
  open: boolean;
  /** Pre-selected payment type, e.g. when opened from the coworker ledger. */
  paymentType?: Payment["paymentType"];
  onClose: () => void;
  onCompleted?: (payment: Payment) => void;
}

/**
 * Coworker money movements. These are the *payment* faces of the coworker
 * ledger; the ledger screen's own LEND / BORROW / RECORD REPAYMENT dialogs cover
 * the same three movements with the full transaction notes.
 */
export function CoworkerPaymentDialog({
  open,
  paymentType = "COWORKER_LEND",
  onClose,
  onCompleted,
}: CoworkerPaymentDialogProps) {
  const currency = useCurrency();
  const [name, setName] = useState("");
  const [coworkerId, setCoworkerId] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCoworkerId("");
    setAmount(0);
    setMethod("Cash");
    setDate(todayIso());
    setNotes("");
    setServerError(null);
  }, [open, paymentType]);

  const submit = async () => {
    setBusy(true);
    setServerError(null);
    try {
      const saved = await api.recordPayment({
        paymentType,
        personId: coworkerId || undefined,
        personName: name.trim(),
        amount,
        paymentMethod: method,
        notes: notes.trim() || undefined,
        paymentDate: date,
      });
      onCompleted?.(saved);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="sm"
      title={paymentLabel(paymentType)}
      subtitle="Records the movement on the coworker ledger and in the payment history."
      icon={<UsersRound className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Record
          </Button>
        </>
      }
    >
      {serverError && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-xs font-medium whitespace-pre-wrap text-danger-700"
        >
          {serverError}
        </div>
      )}
      <div className="space-y-3">
        <FormField label="Coworker" required hint="An existing coworker id, or a new name below.">
          <TextInput
            value={coworkerId}
            onChange={(e) => setCoworkerId(e.target.value)}
            placeholder="Leave blank for a new coworker"
          />
        </FormField>
        <FormField label="Name" required>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Coworker name"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Amount" required>
            <CurrencyInput value={amount} onValueChange={setAmount} currency={currency} />
          </FormField>
          <FormField label="Method" required>
            <SelectField
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
            />
          </FormField>
        </div>
        <FormField label="Date" required>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input tnum"
          />
        </FormField>
        <FormField label="Notes">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <p className="rounded-lg border border-line bg-[#fafbfd] p-2.5 text-2xs leading-relaxed text-muted">
          <HandCoins className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
          {personLabel("coworker")} movements do not touch buyer or seller balances.
        </p>
      </div>
    </Modal>
  );
}
