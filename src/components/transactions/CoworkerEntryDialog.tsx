import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, HandCoins, RotateCcw, UsersRound } from "lucide-react";
import { api, todayIso } from "../../lib/api";
import { money, relativeDay } from "../../lib/format";
import { useCurrency } from "../../lib/app-context";
import { PAYMENT_METHODS } from "../../lib/constants";
import type { Coworker, CoworkerInput, CoworkerKind, CoworkerTransaction } from "../../lib/types";
import {
  Button,
  CurrencyInput,
  FormField,
  SelectField,
  TextArea,
} from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { TransactionSummary } from "../ui/Cards";
import { StatusBadge } from "../ui/DataTable";
import { CoworkerSelector } from "./PartySelector";

/* ===========================================================================
   Coworker ledger entries
   ---------------------------------------------------------------------------
   Three movements: lend (they owe us more), borrow (we owe them more) and
   repayment (moves the balance toward zero and can never exceed it).
   =========================================================================== */

export interface CoworkerEntryDialogProps {
  open: boolean;
  kind: CoworkerKind;
  coworker?: Coworker | null;
  onClose: () => void;
  onCompleted?: (txn: CoworkerTransaction) => void;
}

const KIND_COPY: Record<
  CoworkerKind,
  { title: string; blurb: string; sign: "in" | "out"; icon: typeof ArrowUpRight }
> = {
  LEND: {
    title: "Lend to coworker",
    blurb: "You hand over cash. The amount they owe you increases.",
    sign: "out",
    icon: ArrowUpRight,
  },
  BORROW: {
    title: "Borrow from coworker",
    blurb: "You take cash. The amount you owe them increases.",
    sign: "in",
    icon: ArrowDownLeft,
  },
  REPAYMENT: {
    title: "Record repayment",
    blurb: "Cash changes hands to settle part of the outstanding balance.",
    sign: "in",
    icon: RotateCcw,
  },
};

export function CoworkerEntryDialog({
  open,
  kind,
  coworker,
  onClose,
  onCompleted,
}: CoworkerEntryDialogProps) {
  const currency = useCurrency();
  const spec = KIND_COPY[kind];

  const [who, setWho] = useState<{ id: string; name: string; currentBalance: number } | null>(
    null,
  );
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWho(
      coworker
        ? { id: coworker.id, name: coworker.name, currentBalance: coworker.currentBalance }
        : null,
    );
    setAmount(0);
    setMethod("Cash");
    setDate(todayIso());
    setNotes("");
    setErrors({});
    setServerError(null);
  }, [open, kind, coworker]);

  const balance = who?.currentBalance ?? 0;
  const outstanding = Math.abs(balance);

  const projected = useMemo(() => {
    switch (kind) {
      case "LEND":
        return balance + amount;
      case "BORROW":
        return balance - amount;
      case "REPAYMENT":
        return balance > 0 ? balance - amount : balance + amount;
      default:
        return balance;
    }
  }, [kind, balance, amount]);

  const exceedsOutstanding = kind === "REPAYMENT" && amount > outstanding + 0.005;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!who) next.who = "Choose a coworker - or add one from the list.";
    if (amount <= 0) next.amount = "Enter an amount greater than zero.";
    if (exceedsOutstanding)
      next.amount = `Only ${money(outstanding, currency)} is outstanding.`;
    if (!method) next.method = "Choose how the cash moved.";
    setErrors(next);
    if (Object.keys(next).length) {
      setServerError(null);
      return;
    }

    setBusy(true);
    setServerError(null);
    try {
      const payload: CoworkerInput = {
        coworkerId: who!.id,
        kind,
        amount,
        method,
        notes: notes.trim() || undefined,
        txnDate: date,
      };
      const saved = await api.recordCoworkerEntry(payload);
      onCompleted?.(saved);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = spec.icon;

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
          <Button variant="primary" onClick={submit} loading={busy}>
            Record {kind === "REPAYMENT" ? "repayment" : kind === "LEND" ? "lend" : "borrow"}
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
        <CoworkerSelector
          value={who}
          onChange={(c) => {
            setWho(c);
            setErrors((e) => ({ ...e, who: "" }));
          }}
          label="Coworker"
          required
          error={errors.who}
          disabled={busy}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField
            label="Amount"
            required
            error={errors.amount}
            hint={
              who
                ? outstanding > 0.005
                  ? `Outstanding ${money(outstanding, currency)}`
                  : "Currently settled"
                : undefined
            }
          >
            <div className="flex items-center gap-1.5">
              <CurrencyInput
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                invalid={Boolean(errors.amount) || exceedsOutstanding}
                disabled={busy}
              />
              {kind === "REPAYMENT" && outstanding > 0.005 && (
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => setAmount(outstanding)}
                >
                  Full
                </Button>
              )}
            </div>
          </FormField>

          <FormField label="Cash moved by" required error={errors.method}>
            <SelectField
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={PAYMENT_METHODS.filter((m) => m !== "Credit").map((m) => ({
                value: m,
                label: m,
              }))}
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

        {who && (
          <TransactionSummary
            lines={[
              { label: "Coworker", value: who.name },
              {
                label: "Balance now",
                value: money(balance, currency),
                hint: balance > 0.005 ? "owes you" : balance < -0.005 ? "you owe" : undefined,
                tone: balance > 0.005 ? "warn" : balance < -0.005 ? "brand" : "default",
              },
              { label: "This entry", value: money(amount, currency), tone: "default" },
              {
                label: "Balance after",
                value: money(projected, currency),
                tone: projected > 0.005 ? "warn" : projected < -0.005 ? "brand" : "profit",
                strong: true,
              },
            ]}
          />
        )}

        {kind === "REPAYMENT" && Math.abs(balance) < 0.005 && (
          <p className="rounded-lg border border-line bg-[#fafbfd] p-2.5 text-2xs text-muted">
            <UsersRound className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
            This coworker is settled. A repayment would put them in credit.
          </p>
        )}

        <FormField label="Notes">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What it was for, when it is expected back..."
            disabled={busy}
          />
        </FormField>
      </div>
    </Modal>
  );
}

/* ================================================================ editor === */

export interface CoworkerFormDialogProps {
  open: boolean;
  editing?: Coworker | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function CoworkerFormDialog({
  open,
  editing,
  onClose,
  onSaved,
}: CoworkerFormDialogProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setPhone(editing?.phone ?? "");
    setNotes(editing?.notes ?? "");
    setErrors({});
    setServerError(null);
  }, [open, editing]);

  const submit = async () => {
    if (!name.trim()) {
      setErrors({ name: "A name is required." });
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      if (editing) {
        await api.updateCoworker(editing.id, name.trim(), phone.trim(), notes.trim());
      } else {
        await api.createCoworker(name.trim(), phone.trim(), notes.trim());
      }
      onSaved?.();
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
      title={editing ? `Edit ${editing.name}` : "Add coworker"}
      subtitle="Coworkers keep their own ledger, separate from buyers and sellers."
      icon={<UsersRound className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {editing ? "Save changes" : "Add coworker"}
          </Button>
        </>
      }
    >
      {serverError && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-medium whitespace-pre-wrap text-danger-700"
        >
          {serverError}
        </div>
      )}
      <div className="space-y-3">
        <FormField label="Name" required error={errors.name}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ahmed Nasser"
            aria-invalid={Boolean(errors.name)}
          />
        </FormField>
        <FormField label="Phone">
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+971 50 000 0000"
          />
        </FormField>
        <FormField label="Notes">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering"
          />
        </FormField>
        <p className="flex items-center gap-1.5 text-2xs text-faint">
          <HandCoins className="h-3.5 w-3.5" aria-hidden />
          A balance of {money(0)} means settled. Positive means they owe you.
        </p>
      </div>
    </Modal>
  );
}

/** Compact recent-movement list used inside the ledger dialogs' footer. */
export function RecentEntries({
  entries,
  currency,
}: {
  entries: CoworkerTransaction[];
  currency: string;
}) {
  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center gap-2 py-1.5">
          <StatusBadge
            tone={
              e.kind === "LEND"
                ? "warn"
                : e.kind === "BORROW"
                  ? "brand"
                  : "profit"
            }
          >
            {e.kind === "LEND" ? "Lent" : e.kind === "BORROW" ? "Borrowed" : "Repayment"}
          </StatusBadge>
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {e.notes || e.coworkerName} &middot; {relativeDay(e.txnDate)}
          </span>
          <span className="tnum shrink-0 text-xs font-semibold text-ink">
            {money(e.amount, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
