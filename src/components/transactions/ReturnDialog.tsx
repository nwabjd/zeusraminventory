import { useEffect, useMemo, useState } from "react";
import { CornerUpLeft, Search, Trash2 } from "lucide-react";
import { api, todayIso } from "../../lib/api";
import { money, qty, skuSummary } from "../../lib/format";
import { useCurrency } from "../../lib/app-context";
import type { Purchase, ReturnLine, ReturnType, Sale } from "../../lib/types";
import { Button, CurrencyInput, FormField, QuantityInput, TextInput } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/Feedback";
import { StatusBadge } from "../ui/DataTable";
import { TransactionSummary } from "../ui/Cards";

/* ===========================================================================
   Returns
   ---------------------------------------------------------------------------
   A sale return puts stock back and credits the buyer; a purchase return takes
   stock back out and reduces what we owe the seller. Prices and the
   "how many may still come back" ceiling come from the source document, and are
   re-checked by the backend inside the write transaction.
   =========================================================================== */

export interface ReturnDialogProps {
  open: boolean;
  mode: "sale" | "purchase";
  /** Pre-selected source document, when opened from a sale/purchase. */
  reference?: Sale | Purchase | null;
  onClose: () => void;
  onCompleted?: () => void;
}

interface DocLine {
  ramItemId: string;
  sku: string;
  summary: string;
  quantity: number;
  returned: number;
  unitPrice: number;
  inStock: number;
}

function docNumber(d: Sale | Purchase): string {
  return "saleNumber" in d ? d.saleNumber : d.purchaseNumber;
}
function docWho(d: Sale | Purchase): string {
  return "buyerName" in d ? d.buyerName : d.sellerName;
}
function docDate(d: Sale | Purchase): string {
  return "saleDate" in d ? d.saleDate : d.purchaseDate;
}

export function ReturnDialog({ open, mode, reference, onClose, onCompleted }: ReturnDialogProps) {
  const currency = useCurrency();
  const isSale = mode === "sale";
  const returnType: ReturnType = isSale ? "SALE_RETURN" : "PURCHASE_RETURN";

  const [doc, setDoc] = useState<Sale | Purchase | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<(Sale | Purchase)[]>([]);
  const [resolved, setResolved] = useState<DocLine[]>([]);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [refund, setRefund] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDoc(reference ?? null);
    setLines([]);
    setQuery("");
    setRefund(0);
    setDate(todayIso());
    setNote("");
    setError(null);
    setServerError(null);
  }, [open, reference, mode]);

  /* ---- source document picker ------------------------------------------- */
  useEffect(() => {
    if (!open || doc) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = isSale
          ? await api.listSales({ limit: 80 })
          : await api.listPurchases({ limit: 80 });
        if (!cancelled) setCandidates(res as (Sale | Purchase)[]);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, doc, isSale]);

  /* ---- what may still come back, per line -------------------------------- */
  useEffect(() => {
    if (!open || !doc) {
      setResolved([]);
      return;
    }
    let cancelled = false;
    const src = "items" in doc ? doc.items : [];
    void (async () => {
      const out: DocLine[] = [];
      for (const l of src) {
        try {
          const [already, stock] = await Promise.all([
            api.returnedQuantity(l.ramItemId, doc.id),
            api.getRamItem(l.ramItemId),
          ]);
          out.push({
            ramItemId: l.ramItemId,
            sku: l.sku,
            summary: skuSummary(l),
            quantity: l.quantity,
            returned: already,
            unitPrice: "sellingPrice" in l ? l.sellingPrice : l.costPerUnit,
            inStock: stock.quantity,
          });
        } catch {
          /* An archived item simply is not offered for return. */
        }
      }
      if (!cancelled) setResolved(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, doc]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (d) =>
        docNumber(d).toLowerCase().includes(q) ||
        docWho(d).toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const quantityOf = (ramItemId: string) =>
    lines.filter((l) => l.ramItemId === ramItemId).reduce((a, l) => a + l.quantity, 0);

  const total = lines.reduce((a, l) => {
    const line = resolved.find((r) => r.ramItemId === l.ramItemId);
    return a + l.quantity * (line?.unitPrice ?? 0);
  }, 0);

  const blocked = resolved.some((r) => {
    const used = quantityOf(r.ramItemId);
    const returnable = Math.max(0, r.quantity - r.returned);
    return used > returnable || (!isSale && used > r.inStock);
  });

  const setLineQuantity = (ramItemId: string, quantity: number) => {
    const clean = Math.max(0, Math.trunc(quantity));
    setLines((prev) => {
      const rest = prev.filter((l) => l.ramItemId !== ramItemId);
      return clean > 0 ? [...rest, { ramItemId, quantity: clean }] : rest;
    });
  };

  const submit = async () => {
    if (!doc) {
      setError("Choose the document being returned against.");
      return;
    }
    if (!lines.length) {
      setError("Select at least one item to return.");
      return;
    }
    if (blocked) {
      setError("A line exceeds the quantity that can still come back on this document.");
      return;
    }
    setError(null);
    setBusy(true);
    setServerError(null);
    try {
      await api.createReturn({
        returnType,
        referenceId: doc.id,
        returnDate: date,
        refund,
        note: note.trim() || undefined,
        items: lines,
      });
      onCompleted?.();
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const noun = isSale ? "sale" : "purchase";

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={isSale ? "Sale return" : "Purchase return"}
      subtitle={
        isSale
          ? "Take RAM back against an existing sale. Stock increases and the buyer's balance is credited."
          : "Send RAM back to a supplier. Stock decreases and what we owe the seller falls."
      }
      icon={<CornerUpLeft className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Record return
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
        {!doc ? (
          <div className="rounded-lg border border-line">
            <div className="border-b border-line p-2">
              <div className="input-group">
                <Search className="input-group-icon h-4 w-4" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${noun} number or ${isSale ? "buyer" : "seller"}`}
                  className="input"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <EmptyState
                  compact
                  title={`No ${noun}s to return against`}
                  message="Record the transaction first, then return the RAM against it."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {filtered.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        disabled={d.status === "void"}
                        onClick={() => setDoc(d)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs font-bold text-brand-800">
                            {docNumber(d)}
                          </span>
                          <span className="block truncate text-2xs text-muted">
                            {docWho(d)} &middot; {docDate(d)}
                          </span>
                        </span>
                        <span className="tnum shrink-0 text-xs font-semibold text-ink">
                          {money(d.total, currency)}
                        </span>
                        {d.status === "void" && <StatusBadge tone="neutral">Voided</StatusBadge>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-[#fafbfd] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-bold text-brand-800">
                  {docNumber(doc)}
                </p>
                <p className="truncate text-2xs text-muted">
                  {docWho(doc)} &middot; {docDate(doc)} &middot; {money(doc.total, currency)}
                </p>
              </div>
              <Button
                size="xs"
                onClick={() => {
                  setDoc(null);
                  setLines([]);
                }}
              >
                Change document
              </Button>
            </div>

            {resolved.length === 0 ? (
              <EmptyState
                compact
                title="Reading the items on this document"
                message="Returnable quantities come from the ledger, including anything already returned."
              />
            ) : (
              <div className="table-wrap rounded-lg border border-line">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-right">{isSale ? "Sold" : "Bought"}</th>
                      <th className="text-right">Returned</th>
                      <th className="text-right">Returnable</th>
                      <th className="w-28 text-right">Return now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolved.map((r) => {
                      const used = quantityOf(r.ramItemId);
                      const returnable = Math.max(0, r.quantity - r.returned);
                      const over = used > returnable;
                      const stockShort = !isSale && used > r.inStock;
                      return (
                        <tr key={r.ramItemId}>
                          <td>
                            <p className="truncate font-mono text-xs font-bold text-brand-800">
                              {r.sku}
                            </p>
                            <p className="truncate text-2xs text-muted">{r.summary}</p>
                          </td>
                          <td className="num">{qty(r.quantity)}</td>
                          <td className="num">{r.returned ? qty(r.returned) : "-"}</td>
                          <td className="num">
                            <span className={returnable > 0 ? "text-profit-700" : "text-faint"}>
                              {qty(returnable)}
                            </span>
                          </td>
                          <td>
                            <QuantityInput
                              value={used}
                              onValueChange={(v) => setLineQuantity(r.ramItemId, v)}
                              max={returnable}
                              invalid={over || stockShort}
                              disabled={returnable <= 0}
                              className="[&_input]:h-8"
                            />
                            {(over || stockShort) && (
                              <p className="mt-0.5 text-2xs font-semibold text-danger-700">
                                {stockShort ? `Only ${qty(r.inStock)} in stock` : `Max ${qty(returnable)}`}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Return date" required>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input tnum"
                />
              </FormField>
              <FormField
                label={`Cash ${isSale ? "refunded to buyer" : "refunded by supplier"}`}
                hint="Only if cash changed hands now"
              >
                <CurrencyInput value={refund} onValueChange={setRefund} currency={currency} />
              </FormField>
              <TransactionSummary
                className="self-end"
                lines={[
                  { label: "Units", value: qty(lines.reduce((a, l) => a + l.quantity, 0)) },
                  {
                    label: isSale ? "Credit to buyer" : "Debit from supplier",
                    value: money(total, currency),
                    tone: "brand",
                    strong: true,
                  },
                ]}
              />
            </div>

            <FormField label="Note">
              <TextInput
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason for the return, condition of the module..."
              />
            </FormField>

            {lines.length > 0 && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => setLines([])}
                >
                  Clear selection
                </Button>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-semibold text-danger-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
