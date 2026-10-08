import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, MinusCircle, PlusCircle, ShieldCheck } from "lucide-react";
import { api, todayIso } from "../../lib/api";
import { grossProfit, marginPercent, money, qty, remainingOf } from "../../lib/format";
import { useCurrency } from "../../lib/app-context";
import { useAuth } from "../../lib/auth";
import { buildRequestPayload, isProvisioned } from "../../lib/approval";
import { cloudSubmitRequest } from "../../lib/cloud";
import type { Party, Purchase, RamItem, Sale } from "../../lib/types";
import { Button, FormField, TextArea, TextInput } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { TransactionSummary, type SummaryLine } from "../ui/Cards";
import { PaymentPanel } from "../ui/PaymentPanel";
import { PartySelector } from "./PartySelector";
import { AvailableStockPanel, InventorySelector, type PickedLine } from "./InventorySelector";

/* ===========================================================================
   BUY RAM / SELL RAM
   ---------------------------------------------------------------------------
   These two screens are the reason the application exists, so they share one
   shell (`TransactionDialog`) and differ only in wording, direction and which
   extra panels matter. Everything is written through a single Rust command,
   which performs the whole document - lines, stock movements, weighted average
   cost, balances and audit entry - inside one SQLite transaction.
   =========================================================================== */

export type TransactionMode = "buy" | "sell";

export interface TransactionDialogProps {
  open: boolean;
  mode: TransactionMode;
  onClose: () => void;
  /** No argument means "submitted for approval" instead of completed. */
  onCompleted?: (doc?: Purchase | Sale) => void;
}

export function TransactionDialog({ open, mode, onClose, onCompleted }: TransactionDialogProps) {
  const currency = useCurrency();
  const auth = useAuth();
  const isBuy = mode === "buy";
  /** In cloud mode every document is submitted for approval, never finalized. */
  const cloudSubmit = auth.cloud && isProvisioned(auth.profile);

  const [party, setParty] = useState<Party | null>(null);
  const [lines, setLines] = useState<PickedLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [settled, setSettled] = useState(0);
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [stockById, setStockById] = useState<Record<string, RamItem>>({});
  const [error, setError] = useState<Record<string, string>>({});

  /* ---- reset on every open so a half-finished document is never reused --- */
  useEffect(() => {
    if (!open) return;
    setParty(null);
    setLines([]);
    setDiscount(0);
    setSettled(0);
    setMethod("Cash");
    setDate(todayIso());
    setReference("");
    setNotes("");
    setServerError(null);
    setError({});
  }, [open, mode]);

  /* ---- live stock snapshot: drives the cost preview, the AVAILABLE STOCK
         panel and the insufficient-stock check before the backend is called. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .listRamItems({ includeArchived: false })
      .then((items) => {
        if (cancelled) return;
        const map: Record<string, RamItem> = {};
        items.forEach((i) => {
          map[i.id] = i;
        });
        setStockById(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, lines]);

  const { subtotal, discount: appliedDiscount, total, units, itemCount } = useMemo(() => {
    const raw = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    const d = Math.min(Math.max(0, discount), raw);
    return {
      subtotal: Math.round(raw * 100) / 100,
      discount: Math.round(d * 100) / 100,
      total: Math.round((raw - d) * 100) / 100,
      units: lines.reduce((a, l) => a + l.quantity, 0),
      itemCount: lines.length,
    };
  }, [lines, discount]);

  /** Cost basis of the sale, from each line's current weighted average cost. */
  const costTotal = useMemo(() => {
    if (isBuy) return 0;
    const raw = lines.reduce((a, l) => {
      const avg = stockById[l.ramItemId]?.averageCost ?? 0;
      return a + l.quantity * avg;
    }, 0);
    return Math.round(raw * 100) / 100;
  }, [isBuy, lines, stockById]);

  const profit = isBuy ? 0 : grossProfit(total, costTotal);
  const margin = isBuy ? 0 : marginPercent(total, costTotal);
  const remaining = remainingOf(total, settled);

  const shortSkus = useMemo(() => {
    if (isBuy) return [] as string[];
    const wanted: Record<string, number> = {};
    lines.forEach((l) => {
      wanted[l.ramItemId] = (wanted[l.ramItemId] ?? 0) + l.quantity;
    });
    return Object.keys(wanted).filter((id) => wanted[id] > (stockById[id]?.quantity ?? 0));
  }, [isBuy, lines, stockById]);

  const summaryLines: SummaryLine[] = [
    {
      label: "Items",
      value: `${itemCount} line${itemCount === 1 ? "" : "s"} / ${qty(units)} unit${
        units === 1 ? "" : "s"
      }`,
    },
    { label: "Subtotal", value: money(subtotal, currency) },
    { label: "Discount", value: `- ${money(appliedDiscount, currency)}` },
    {
      label: isBuy ? "Total purchase" : "Revenue",
      value: money(total, currency),
      strong: true,
      tone: isBuy ? "default" : "brand",
    },
  ];

  if (!isBuy) {
    summaryLines.push(
      { label: "Cost of goods sold", value: money(costTotal, currency) },
      {
        label: "Gross profit",
        value: money(profit, currency),
        tone: profit >= 0 ? "profit" : "danger",
        strong: true,
      },
      {
        label: "Margin",
        value: `${margin.toFixed(1)}%`,
        hint: "of revenue",
        tone: margin >= 0 ? "profit" : "danger",
      },
    );
  }

  if (remaining > 0.005) {
    summaryLines.push({
      label: isBuy ? "Payable to seller" : "Receivable from buyer",
      value: money(remaining, currency),
      tone: isBuy ? "brand" : "danger",
      hint: remaining === total ? "on account" : undefined,
    });
  }

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!party) next.party = isBuy ? "Choose the seller you are buying from." : "Choose the buyer.";
    if (!lines.length) next.items = "Add at least one RAM item.";
    else if (lines.some((l) => l.quantity <= 0)) next.items = "Every line needs a quantity of at least 1.";
    else if (shortSkus.length)
      next.items = "One or more lines exceed the available stock - see the stock panel below.";
    if (!method) next.method = "Choose a payment method.";
    if (!date) next.date = "Enter the transaction date.";
    setError(next);
    if (Object.keys(next).length) {
      setServerError(null);
      return;
    }

    setBusy(true);
    setServerError(null);
    const docNotes = [reference.trim() ? `Ref: ${reference.trim()}` : "", notes.trim()]
      .filter(Boolean)
      .join(" - ");
    try {
      if (cloudSubmit) {
        /* Cloud mode: freeze the request (with the device-local SKUs and spec
           facts) and submit it to the approval queue. Nothing hits the local
           ledger until an administrator decides. */
        const payload = buildRequestPayload({
          kind: isBuy ? "purchase" : "sale",
          partyName: party!.companyName,
          date,
          discount: appliedDiscount,
          payment: settled,
          method,
          notes: docNotes,
          lines,
          stockById,
        });
        await cloudSubmitRequest(isBuy ? "purchase" : "sale", payload);
        onCompleted?.();
        onClose();
        return;
      }
      const doc = isBuy
        ? await api.createPurchase({
            sellerId: party!.id,
            sellerName: party!.companyName,
            purchaseDate: date,
            discount: appliedDiscount,
            amountPaid: settled,
            paymentMethod: method,
            notes: docNotes || undefined,
            items: lines,
          })
        : await api.createSale({
            buyerId: party!.id,
            buyerName: party!.companyName,
            saleDate: date,
            discount: appliedDiscount,
            amountReceived: settled,
            paymentMethod: method,
            notes: docNotes || undefined,
            items: lines,
          });
      onCompleted?.(doc);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const noun = isBuy ? "purchase" : "sale";
  const Icon = isBuy ? PlusCircle : MinusCircle;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="xl"
      title={isBuy ? "Buy RAM" : "Sell RAM"}
      subtitle={
        cloudSubmit
          ? isBuy
            ? "Request to bring stock in from a seller. Nothing moves until an administrator approves."
            : "Request to send stock out to a buyer. Available stock is checked before submitting."
          : isBuy
            ? "Record stock coming in from a seller. The weighted average cost is recalculated automatically."
            : "Record stock going out to a buyer. Available stock is checked before anything is written."
      }
      icon={<Icon className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1.5 text-2xs text-faint sm:flex">
            {cloudSubmit ? (
              <>
                <Clock3 className="h-4 w-4 shrink-0 text-warn-600" aria-hidden />
                Submitted for approval - stock does not move until an administrator decides
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4 shrink-0 text-profit-600" aria-hidden />
                One database transaction - nothing is saved if any part fails
              </>
            )}
          </span>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={isBuy ? "profit" : "danger"}
            onClick={submit}
            loading={busy}
            disabled={shortSkus.length > 0}
            icon={busy ? undefined : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          >
            {cloudSubmit ? `Submit ${noun} for approval` : `Complete ${noun}`}
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

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PartySelector
              kind={isBuy ? "seller" : "buyer"}
              value={party}
              onChange={(p) => {
                setParty(p);
                setError((e) => ({ ...e, party: "" }));
              }}
              label={isBuy ? "Seller" : "Buyer"}
              required
              error={error.party}
              disabled={busy}
            />
          </div>
          <FormField
            label="Reference"
            hint={isBuy ? "Supplier invoice number (optional)" : "Customer reference (optional)"}
          >
            <TextInput
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={isBuy ? "e.g. INV-44821" : "e.g. PO-9931"}
              disabled={busy}
            />
          </FormField>
        </div>

        <InventorySelector
          lines={lines}
          onChange={(next) => {
            setLines(next);
            setError((e) => ({ ...e, items: "" }));
          }}
          mode={mode}
          currency={currency}
          errors={error}
          onQuickCreate={(item) => {
            setLines((prev) =>
              prev.some((l) => l.ramItemId === item.id)
                ? prev
                : [
                    ...prev,
                    {
                      ramItemId: item.id,
                      quantity: 1,
                      unitPrice: isBuy
                        ? item.purchasePrice || item.averageCost
                        : item.sellingPrice,
                    },
                  ],
            );
            setStockById((prev) => ({ ...prev, [item.id]: item }));
          }}
        />

        {!isBuy && lines.length > 0 && <AvailableStockPanel lines={lines} stockById={stockById} />}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <PaymentPanel
            kind={isBuy ? "paid" : "received"}
            currency={currency}
            total={total}
            settled={0}
            amount={settled}
            onAmountChange={setSettled}
            method={method}
            onMethodChange={setMethod}
            date={date}
            onDateChange={setDate}
            allowCredit
            error={error.method || error.date}
            disabled={busy}
          />
          <div className="lg:col-span-2">
            <TransactionSummary lines={summaryLines} />
          </div>
        </div>

        <FormField label="Notes" hint="Anything about this transaction worth remembering.">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              isBuy
                ? "Agreed price, delivery terms, warranty..."
                : "Paid by transfer, collecting the balance next week..."
            }
            disabled={busy}
          />
        </FormField>

        {lines.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-2xs text-faint">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {cloudSubmit ? (
              <>
                ZEUS submits this as an approval request with the request number assigned when it
                lands. {isBuy ? "Stock increases" : "Stock decreases"} only after an administrator
                approves it.
              </>
            ) : (
              <>
                ZEUS assigns the document number on completion (
                {isBuy ? "PUR" : "SAL"}-YYYYMMDD-NNNN) and {isBuy ? "increases" : "decreases"} stock
                for every line above.
              </>
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function BuyRamDialog(props: TransactionDialogProps) {
  return <TransactionDialog {...props} mode="buy" />;
}

export function SellRamDialog(props: TransactionDialogProps) {
  return <TransactionDialog {...props} mode="sell" />;
}
