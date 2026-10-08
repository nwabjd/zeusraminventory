import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Building2,
  CalendarDays,
  Cloud,
  FileSpreadsheet,
  FileText,
  MapPin,
  Phone,
  Printer,
  RotateCcw,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import { cn, displayDate, displayDateTime, money, paymentState, qty, remainingOf } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type { Purchase } from "../lib/types";
import {
  Button,
  DataList,
  DataTable,
  EmptyState,
  InlineError,
  LoadingState,
  MoneyStat,
  PageHeader,
  PaymentBadge,
  ReasonDialog,
  SectionCard,
  StatCard,
  StatusBadge,
  TransactionSummary,
  useToast,
  type Column,
} from "../components/ui";
import { PaymentDialog, ReturnDialog } from "../components/transactions";
import { exportCsv, exportExcel, type ExportColumn } from "../lib/export";
import { printPurchase } from "../lib/doc-print";

/* ===========================================================================
   Purchase detail
   ---------------------------------------------------------------------------
   The document as the supplier and the operator see it: header, settlement,
   lines, and the audit trail. Settle the balance, return part of the order, or
   void the whole thing - each from this screen.
   =========================================================================== */

export default function PurchaseDetail() {
  const { id = "" } = useParams();
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();

  const [voiding, setVoiding] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [returning, setReturning] = useState(false);

  const state = useAsync(() => api.getPurchase(id), [id]);
  const seller = useAsync(
    () => (state.data?.sellerId ? api.getSeller(state.data.sellerId) : Promise.resolve(null)),
    [state.data?.sellerId],
    { skip: !state.data?.sellerId },
  );

  const doc = state.data;

  const lines: ExportColumn<Purchase["items"][number]>[] = useMemo(
    () => [
      { header: "SKU", value: (i) => i.sku },
      { header: "Generation", value: (i) => i.generation },
      { header: "Category", value: (i) => i.category },
      { header: "Capacity", value: (i) => i.capacity },
      { header: "Speed", value: (i) => i.speed },
      { header: "Qty", value: (i) => i.quantity, numeric: true },
      { header: "Unit cost", value: (i) => i.costPerUnit, numeric: true },
      { header: "Amount", value: (i) => i.subtotal, numeric: true },
    ],
    [],
  );

  if (state.loading && !doc) {
    return (
      <div className="page">
        <LoadingState label="Loading purchase" />
      </div>
    );
  }

  if (state.error && !doc) {
    return (
      <div className="page">
        <PageHeader
          title="Purchase"
          icon={<ShoppingCart className="h-5 w-5" aria-hidden />}
          actions={
            <Button onClick={() => navigate("/purchases")} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Back to purchases
            </Button>
          }
        />
        <InlineError message={state.error} onRetry={state.reload} />
      </div>
    );
  }

  if (!doc) return null;

  const voided = doc.status === "void";
  const isCloudDoc = Boolean(doc.cloudApprovalId);
  const outstanding = remainingOf(doc.total, doc.paid);
  const settlement = paymentState(doc.total, doc.paid);

  const exportOpts = (format: "csv" | "xls" | "pdf") => {
    const opts = {
      filename: `purchase-${doc.purchaseNumber}`,
      title: `Purchase ${doc.purchaseNumber}`,
      subtitle: `${doc.sellerName} - ${displayDate(doc.purchaseDate)}`,
      meta: [
        { label: "Seller", value: doc.sellerName },
        { label: "Date", value: displayDate(doc.purchaseDate) },
        { label: "Total", value: money(doc.total, currency) },
        { label: "Paid", value: money(doc.paid, currency) },
        { label: "Balance", value: money(outstanding, currency) },
        { label: "Units", value: qty(doc.unitCount) },
        { label: "Status", value: voided ? "Voided" : settlement === "paid" ? "Paid" : settlement === "partial" ? "Partial" : "Unpaid" },
      ],
      columns: lines,
      rows: doc.items,
    };
    if (format === "csv") {
      exportCsv(opts);
      toast.success("Purchase lines exported", "CSV file downloaded.");
    } else if (format === "xls") {
      exportExcel(opts);
      toast.success("Purchase lines exported", "Excel workbook downloaded.");
    } else {
      const ok = printPurchase(doc, currency);
      toast[ok ? "info" : "error"](
        ok ? "Print dialog opened" : "Print dialog blocked",
        ok
          ? `Document ${doc.purchaseNumber} - choose 'Microsoft Print to PDF' to save it.`
          : "Allow pop-ups for this app, then try again.",
      );
    }
  };

  const confirmVoid = async (reason: string) => {
    setVoidBusy(true);
    setVoidError(null);
    try {
      await api.voidPurchase(doc.id, reason);
      toast.success(
        `${doc.purchaseNumber} voided`,
        "Stock reversed, weighted average cost recalculated, and the seller balance credited back.",
      );
      setVoiding(false);
      state.reload();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoidBusy(false);
    }
  };

  const lineColumns: Column<Purchase["items"][number]>[] = [
    {
      key: "sku",
      header: "SKU",
      cell: (i) => (
        <button
          type="button"
          className="link font-mono text-xs font-bold"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/inventory/${i.ramItemId}`);
          }}
        >
          {i.sku}
        </button>
      ),
    },
    {
      key: "description",
      header: "Description",
      cell: (i) => (
        <span className="text-xs text-ink">
          {i.generation} {i.category} {i.capacity} {i.speed}
        </span>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      numeric: true,
      cell: (i) => <span className="font-bold">{qty(i.quantity)}</span>,
    },
    {
      key: "unit",
      header: "Unit cost",
      align: "right",
      numeric: true,
      cell: (i) => <span className="text-muted">{money(i.costPerUnit, currency)}</span>,
    },
    {
      key: "subtotal",
      header: "Amount",
      align: "right",
      numeric: true,
      cell: (i) => <span className="font-semibold text-ink">{money(i.subtotal, currency)}</span>,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={doc.purchaseNumber}
        subtitle={`${doc.sellerName} - ${displayDate(doc.purchaseDate)}`}
        icon={<ShoppingCart className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button onClick={() => navigate("/purchases")} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Purchases
            </Button>
            <Button onClick={() => exportOpts("csv")} icon={<FileText className="h-4 w-4" aria-hidden />}>
              CSV
            </Button>
            <Button onClick={() => exportOpts("xls")} icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}>
              Excel
            </Button>
            <Button onClick={() => exportOpts("pdf")} icon={<Printer className="h-4 w-4" aria-hidden />}>
              Print
            </Button>
            <Button
              onClick={() => setReturning(true)}
              disabled={voided || isCloudDoc}
              title={isCloudDoc ? "Cloud documents are finalized on the server" : undefined}
              icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            >
              Return goods
            </Button>
            <Button
              variant={outstanding > 0.005 ? "primary" : "secondary"}
              onClick={() => setPaying(true)}
              disabled={voided || isCloudDoc || outstanding <= 0.005}
              title={isCloudDoc ? "Cloud documents are finalized on the server" : undefined}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
            >
              Pay seller
            </Button>
            <Button
              variant="danger-soft"
              onClick={() => {
                setVoidError(null);
                setVoiding(true);
              }}
              disabled={voided || isCloudDoc}
              title={isCloudDoc ? "Cloud documents are finalized on the server" : undefined}
              icon={<Ban className="h-4 w-4" aria-hidden />}
            >
              Void
            </Button>
          </>
        }
      />

      <div className="page-scroll space-y-4">
        {voided && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3">
            <StatusBadge tone="danger">Voided</StatusBadge>
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-danger-700">
              This purchase was voided on {displayDateTime(doc.voidedAt)} - {doc.voidReason}.
              Its stock has been reversed and the amounts paid credited back to the seller.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label="Purchase total"
            value={doc.total}
            currency={currency}
            icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={`${qty(doc.itemCount)} lines, ${qty(doc.unitCount)} units`}
          />
          <MoneyStat
            label="Paid to date"
            value={doc.paid}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint={doc.paymentMethod || "No method recorded"}
          />
          <MoneyStat
            label="Balance due"
            value={outstanding}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={outstanding > 0.005 ? "danger" : "profit"}
            hint={outstanding > 0.005 ? "Still owed to the seller" : "Fully settled"}
          />
          <StatCard
            label="Settlement"
            value={
              <PaymentBadge total={doc.total} settled={doc.paid} voided={voided} />
            }
            icon={<Building2 className="h-4 w-4" aria-hidden />}
            tone={settlement === "paid" ? "profit" : settlement === "partial" ? "warn" : "danger"}
            hint={doc.discount > 0 ? `${money(doc.discount, currency)} discount given` : "No discount"}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Seller"
            subtitle={doc.sellerId ? "Registered supplier" : "Recorded without a seller record"}
            icon={<Building2 className="h-4 w-4" aria-hidden />}
            bodyClassName="p-4"
          >
            {seller.data ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate(`/sellers/${seller.data?.id}`)}
                  className="link mb-3 block truncate text-sm font-semibold"
                >
                  {seller.data.companyName}
                </button>
                <DataList
                  columns={1}
                  items={[
                    { label: "Code", value: seller.data.code },
                    { label: "Contact", value: seller.data.contactPerson || "-" },
                    { label: "Phone", value: seller.data.phone || "-" },
                    { label: "WhatsApp", value: seller.data.whatsapp || "-" },
                    { label: "Email", value: seller.data.email || "-" },
                    { label: "City", value: seller.data.city || "-" },
                    { label: "TRN", value: seller.data.trnVat || "-" },
                  ]}
                />
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">{doc.sellerName || "Walk-in supplier"}</p>
                <p className="text-xs leading-relaxed text-muted">
                  This purchase was recorded without linking a seller record, so no supplier
                  balance is tracked for it. Link the seller next time to keep the ledger complete.
                </p>
                <Button size="sm" onClick={() => navigate("/sellers")} icon={<Building2 className="h-4 w-4" aria-hidden />}>
                  Open sellers
                </Button>
              </div>
            )}
            <div className="mt-4 border-t border-line pt-3">
              <DataList
                columns={1}
                items={[
                  { label: "Purchase date", value: displayDate(doc.purchaseDate) },
                  { label: "Recorded", value: displayDateTime(doc.createdAt) },
                  { label: "Last updated", value: displayDateTime(doc.updatedAt) },
                ]}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Summary"
            subtitle="How the total is made up"
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            bodyClassName="space-y-3 p-4"
          >
            <TransactionSummary
              lines={[
                { label: "Subtotal", value: money(doc.subtotal, currency) },
                {
                  label: "Discount",
                  value: doc.discount > 0 ? `- ${money(doc.discount, currency)}` : money(0, currency),
                  tone: doc.discount > 0 ? "danger" : "default",
                },
                { label: "Total", value: money(doc.total, currency), strong: true, tone: "brand" },
                { label: "Paid", value: money(doc.paid, currency), tone: "profit" },
                {
                  label: "Balance",
                  value: money(outstanding, currency),
                  tone: outstanding > 0.005 ? "danger" : "profit",
                  strong: true,
                },
              ]}
            />
            {doc.paymentMethod && (
              <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <Wallet className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                <div className="min-w-0">
                  <p className="text-2xs font-bold tracking-wider text-muted uppercase">Method</p>
                  <p className="truncate text-sm font-semibold text-ink">{doc.paymentMethod}</p>
                </div>
              </div>
            )}
            {doc.notes && (
              <div className="rounded-lg border border-line bg-[#fafbfd] p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">Notes</p>
                <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-ink">
                  {doc.notes}
                </p>
              </div>
            )}
            {!voided && !isCloudDoc && outstanding > 0.005 && (
              <Button variant="primary" block onClick={() => setPaying(true)} icon={<Wallet className="h-4 w-4" aria-hidden />}>
                Pay {money(outstanding, currency)} to {doc.sellerName}
              </Button>
            )}
          </SectionCard>

          <SectionCard
            title="Document facts"
            subtitle="Reference details"
            icon={<CalendarDays className="h-4 w-4" aria-hidden />}
            bodyClassName="p-4"
          >
            <DataList
              columns={1}
              items={[
                { label: "Purchase number", value: doc.purchaseNumber },
                { label: "Status", value: voided ? "Voided" : "Completed" },
                { label: "Payment method", value: doc.paymentMethod || "Not recorded" },
                { label: "Lines", value: `${qty(doc.itemCount)} line${doc.itemCount === 1 ? "" : "s"}` },
                { label: "Units", value: qty(doc.unitCount) },
                { label: "Average unit cost", value: money(doc.unitCount > 0 ? doc.subtotal / doc.unitCount : 0, currency) },
              ]}
            />
            <div className="mt-4 space-y-1.5 border-t border-line pt-3">
              <Fact icon={<Phone className="h-3.5 w-3.5" aria-hidden />} label="Payment was by" value={doc.paymentMethod || "any agreed method"} />
              <Fact icon={<FileText className="h-3.5 w-3.5" aria-hidden />} label="Settlement state" value={settlement === "paid" ? "Fully paid" : settlement === "partial" ? "Part paid" : "Unpaid"} />
              <Fact icon={<MapPin className="h-3.5 w-3.5" aria-hidden />} label="Stock landed in" value={doc.items[0] ? "Inventory (average cost updated)" : "No stock"} />
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Items purchased"
          subtitle={`${qty(doc.itemCount)} line${doc.itemCount === 1 ? "" : "s"} - ${qty(doc.unitCount)} units`}
          icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
          bodyClassName="p-0"
        >
          <DataTable
            columns={lineColumns}
            rows={doc.items}
            rowKey={(i) => i.id}
            onRowClick={(i) => navigate(`/inventory/${i.ramItemId}`)}
            footer={
              <tr>
                <td>Total</td>
                <td />
                <td className="num">{qty(doc.unitCount)}</td>
                <td />
                <td className="num">
                  {money(doc.subtotal, currency)}
                  {doc.discount > 0 && (
                    <span className={cn("ml-2 text-2xs font-semibold text-profit-700")}>
                      less {money(doc.discount, currency)} discount
                    </span>
                  )}
                </td>
              </tr>
            }
            empty={
              <EmptyState
                compact
                icon={<ShoppingCart className="h-5 w-5" aria-hidden />}
                title="No lines on this purchase"
                message="A purchase always has at least one line. If you are seeing this, the document was edited in the database directly."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Settlement"
          subtitle="How this purchase stands with the seller"
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          bodyClassName="p-4"
        >
          {voided ? (
            <EmptyState
              compact
              icon={<Ban className="h-5 w-5" aria-hidden />}
              title="This purchase is void"
              message="A voided document cannot be settled. Record a new purchase instead."
            />
          ) : isCloudDoc ? (
            <EmptyState
              compact
              icon={<Cloud className="h-5 w-5" aria-hidden />}
              title="Finalized in the cloud"
              message="This document was finalized on the server. Settlement is recorded there; the mirror keeps it read-only."
            />
          ) : outstanding <= 0.005 ? (
            <EmptyState
              compact
              icon={<Wallet className="h-5 w-5" aria-hidden />}
              title="Nothing left to pay"
              message={`${money(doc.total, currency)} has been settled in full against ${doc.sellerName}.`}
              action={
                doc.sellerId ? (
                  <Button size="sm" onClick={() => navigate(`/sellers/${doc.sellerId}`)}>
                    View seller statement
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="space-y-3">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{
                    width: `${Math.min(100, Math.max(2, (doc.paid / (doc.total || 1)) * 100))}%`,
                  }}
                />
              </div>
              <TransactionSummary
                lines={[
                  { label: "Purchase total", value: money(doc.total, currency) },
                  { label: "Already paid", value: money(doc.paid, currency), tone: "profit" },
                  {
                    label: "Still owed",
                    value: money(outstanding, currency),
                    tone: "danger",
                    strong: true,
                  },
                  {
                    label: "Settled",
                    hint: doc.paymentMethod || "any method",
                    value: `${doc.total > 0 ? Math.round((doc.paid / doc.total) * 100) : 0}%`,
                  },
                ]}
              />
              <Button variant="primary" block onClick={() => setPaying(true)} icon={<Wallet className="h-4 w-4" aria-hidden />}>
                Record a payment of {money(outstanding, currency)}
              </Button>
            </div>
          )}
        </SectionCard>

        <p className="pb-1 text-2xs text-faint">
          The reference number is generated automatically and never reused, so this document stays
          traceable even after it is voided. Settle it from here, or from{" "}
          {doc.sellerId ? (
            <button
              type="button"
              className="link"
              onClick={() => navigate(`/sellers/${doc.sellerId}`)}
            >
              {doc.sellerName}
            </button>
          ) : (
            "the seller record"
          )}{" "}
          on the Sellers screen.
        </p>
      </div>

      <PaymentDialog
        open={paying}
        mode="pay"
        onClose={() => setPaying(false)}
        onCompleted={() => {
          setPaying(false);
          state.reload();
        }}
      />

      <ReturnDialog
        open={returning}
        mode="purchase"
        reference={doc}
        onClose={() => setReturning(false)}
        onCompleted={() => {
          setReturning(false);
          state.reload();
        }}
      />

      <ReasonDialog
        open={voiding}
        title={`Void ${doc.purchaseNumber}`}
        description="Voiding reverses the whole purchase: the stock comes back off the shelf, the weighted average cost is recalculated, and any amount paid to the seller is credited back."
        points={[
          `${qty(doc.unitCount)} units will be removed from stock.`,
          `${money(doc.paid, currency)} paid will be credited back to the seller's balance.`,
          "The document stays in the register marked as void, with your reason recorded.",
          "Use Return goods instead if the supplier only takes back part of the order.",
        ]}
        confirmLabel="Explain why this purchase is being voided"
        confirmLabelShort="Void purchase"
        busy={voidBusy}
        serverError={voidError}
        placeholder="e.g. wrong seller selected, duplicate entry"
        onConfirm={confirmVoid}
        onCancel={() => setVoiding(false)}
      />
    </div>
  );
}

/* -------------------------------------------------------------- helpers --- */

function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-faint">{icon}</span>
      <div className="min-w-0">
        <p className="text-2xs font-bold tracking-wider text-muted uppercase">{label}</p>
        <p className="truncate text-xs text-ink">{value}</p>
      </div>
    </div>
  );
}