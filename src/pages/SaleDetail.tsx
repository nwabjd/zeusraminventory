import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Cloud,
  FileSpreadsheet,
  FileText,
  Package,
  Printer,
  RotateCcw,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import {
  cn,
  displayDate,
  displayDateTime,
  money,
  paymentState,
  percent,
  qty,
  remainingOf,
  skuSummary,
} from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type { Sale } from "../lib/types";
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
import { printSale } from "../lib/doc-print";

/* ===========================================================================
   Sale detail
   ---------------------------------------------------------------------------
   The invoice as the operator sees it: what was sold, what it cost, what was
   made, and what is still to be collected.
   =========================================================================== */

export default function SaleDetail() {
  const { id = "" } = useParams();
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();

  const [voiding, setVoiding] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [returning, setReturning] = useState(false);

  const state = useAsync(() => api.getSale(id), [id]);
  const buyer = useAsync(
    () => (state.data?.buyerId ? api.getBuyer(state.data.buyerId) : Promise.resolve(null)),
    [state.data?.buyerId],
    { skip: !state.data?.buyerId },
  );

  const doc = state.data;

  const lines: ExportColumn<Sale["items"][number]>[] = useMemo(
    () => [
      { header: "SKU", value: (i) => i.sku },
      { header: "Description", value: (i) => skuSummary(i) },
      { header: "Qty", value: (i) => i.quantity, numeric: true },
      { header: "Unit price", value: (i) => i.sellingPrice, numeric: true },
      { header: "Amount", value: (i) => i.subtotal, numeric: true },
      { header: "Unit cost", value: (i) => i.costPerUnit, numeric: true },
      { header: "Gross profit", value: (i) => i.profit, numeric: true },
    ],
    [],
  );

  if (state.loading && !doc) {
    return (
      <div className="page">
        <LoadingState label="Loading sale" />
      </div>
    );
  }

  if (state.error && !doc) {
    return (
      <div className="page">
        <PageHeader
          title="Sale"
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
          actions={
            <Button onClick={() => navigate("/sales")} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Back to sales
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
  const outstanding = remainingOf(doc.total, doc.received);
  const settlement = paymentState(doc.total, doc.received);

  const exportLines = (format: "csv" | "xls" | "pdf") => {
    const opts = {
      filename: `sale-${doc.saleNumber}`,
      title: `Sale ${doc.saleNumber}`,
      subtitle: `${doc.buyerName} - ${displayDate(doc.saleDate)}`,
      meta: [
        { label: "Buyer", value: doc.buyerName },
        { label: "Date", value: displayDate(doc.saleDate) },
        { label: "Revenue", value: money(doc.total, currency) },
        { label: "Cost of goods", value: money(doc.totalCost, currency) },
        { label: "Gross profit", value: money(doc.grossProfit, currency) },
        { label: "Margin", value: percent(doc.profitMargin) },
        { label: "Received", value: money(doc.received, currency) },
        { label: "Balance", value: money(outstanding, currency) },
        { label: "Units", value: qty(doc.unitCount) },
        { label: "Status", value: voided ? "Voided" : settlement === "paid" ? "Paid" : settlement === "partial" ? "Partial" : "Unpaid" },
      ],
      columns: lines,
      rows: doc.items,
    };
    if (format === "csv") {
      exportCsv(opts);
      toast.success("Sale lines exported", "CSV file downloaded.");
    } else if (format === "xls") {
      exportExcel(opts);
      toast.success("Sale lines exported", "Excel workbook downloaded.");
    } else {
      const ok = printSale(doc, currency);
      toast[ok ? "info" : "error"](
        ok ? "Print dialog opened" : "Print dialog blocked",
        ok
          ? `Invoice ${doc.saleNumber} - choose 'Microsoft Print to PDF' to save it.`
          : "Allow pop-ups for this app, then try again.",
      );
    }
  };

  const confirmVoid = async (reason: string) => {
    setVoidBusy(true);
    setVoidError(null);
    try {
      await api.voidSale(doc.id, reason);
      toast.success(
        `${doc.saleNumber} voided`,
        "Stock returned to the shelf and any amount received credited back to the buyer.",
      );
      setVoiding(false);
      state.reload();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoidBusy(false);
    }
  };

  const lineColumns: Column<Sale["items"][number]>[] = [
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
      cell: (i) => <span className="text-xs text-ink">{skuSummary(i)}</span>,
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
      header: "Unit price",
      align: "right",
      numeric: true,
      cell: (i) => <span className="text-muted">{money(i.sellingPrice, currency)}</span>,
    },
    {
      key: "cost",
      header: "Unit cost",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (i) => <span className="text-faint">{money(i.costPerUnit, currency)}</span>,
    },
    {
      key: "profit",
      header: "Profit",
      align: "right",
      numeric: true,
      cell: (i) => (
        <span className={i.profit >= 0 ? "font-semibold text-profit-700" : "font-semibold text-danger-700"}>
          {money(i.profit, currency)}
        </span>
      ),
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
        title={doc.saleNumber}
        subtitle={`${doc.buyerName} - ${displayDate(doc.saleDate)}`}
        icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button onClick={() => navigate("/sales")} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Sales
            </Button>
            <Button onClick={() => exportLines("csv")} icon={<FileText className="h-4 w-4" aria-hidden />}>
              CSV
            </Button>
            <Button onClick={() => exportLines("xls")} icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}>
              Excel
            </Button>
            <Button onClick={() => exportLines("pdf")} icon={<Printer className="h-4 w-4" aria-hidden />}>
              Print
            </Button>
            <Button onClick={() => setReturning(true)} disabled={voided || isCloudDoc} title={isCloudDoc ? "Cloud documents are finalized on the server" : undefined} icon={<RotateCcw className="h-4 w-4" aria-hidden />}>
              Take goods back
            </Button>
            <Button
              variant={outstanding > 0.005 ? "primary" : "secondary"}
              onClick={() => setReceiving(true)}
              disabled={voided || isCloudDoc || outstanding <= 0.005}
              title={isCloudDoc ? "Cloud documents are finalized on the server" : undefined}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
            >
              Receive payment
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
              This sale was voided on {displayDateTime(doc.voidedAt)} - {doc.voidReason}. The stock
              has gone back on the shelf and the money received credited back to the buyer.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label="Revenue"
            value={doc.total}
            currency={currency}
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            tone="brand"
            direction="up"
            hint={`${qty(doc.itemCount)} lines, ${qty(doc.unitCount)} units`}
          />
          <MoneyStat
            label="Gross profit"
            value={doc.grossProfit}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={doc.grossProfit >= 0 ? "profit" : "danger"}
            hint={`${percent(doc.profitMargin)} margin on cost of ${money(doc.totalCost, currency)}`}
          />
          <MoneyStat
            label="Received"
            value={doc.received}
            currency={currency}
            icon={<Users className="h-4 w-4" aria-hidden />}
            tone="profit"
            hint={doc.paymentMethod || "No method recorded"}
          />
          <MoneyStat
            label="Balance receivable"
            value={outstanding}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={outstanding > 0.005 ? "danger" : "profit"}
            hint={outstanding > 0.005 ? "Still owed to you" : "Fully collected"}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Buyer"
            subtitle={doc.buyerId ? "Registered customer" : "Recorded without a buyer record"}
            icon={<Users className="h-4 w-4" aria-hidden />}
            bodyClassName="p-4"
          >
            {buyer.data ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate(`/buyers/${buyer.data?.id}`)}
                  className="link mb-3 block truncate text-sm font-semibold"
                >
                  {buyer.data.companyName}
                </button>
                <DataList
                  columns={1}
                  items={[
                    { label: "Code", value: buyer.data.code },
                    { label: "Contact", value: buyer.data.contactPerson || "-" },
                    { label: "Phone", value: buyer.data.phone || "-" },
                    { label: "WhatsApp", value: buyer.data.whatsapp || "-" },
                    { label: "Email", value: buyer.data.email || "-" },
                    { label: "City", value: buyer.data.city || "-" },
                    { label: "TRN", value: buyer.data.trnVat || "-" },
                  ]}
                />
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">{doc.buyerName || "Walk-in customer"}</p>
                <p className="text-xs leading-relaxed text-muted">
                  This sale was recorded without linking a buyer record, so no receivable is tracked
                  for it. Link the buyer next time to keep the ledger complete.
                </p>
                <Button size="sm" onClick={() => navigate("/buyers")} icon={<Users className="h-4 w-4" aria-hidden />}>
                  Open buyers
                </Button>
              </div>
            )}
            <div className="mt-4 border-t border-line pt-3">
              <DataList
                columns={1}
                items={[
                  { label: "Sale date", value: displayDate(doc.saleDate) },
                  { label: "Recorded", value: displayDateTime(doc.createdAt) },
                  { label: "Last updated", value: displayDateTime(doc.updatedAt) },
                ]}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Summary"
            subtitle="Revenue, cost and profit"
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
                { label: "Revenue", value: money(doc.total, currency), strong: true, tone: "brand" },
                { label: "Cost of goods", value: `- ${money(doc.totalCost, currency)}`, tone: "danger" },
                {
                  label: "Gross profit",
                  value: money(doc.grossProfit, currency),
                  tone: doc.grossProfit >= 0 ? "profit" : "danger",
                  strong: true,
                },
                { label: "Margin", value: percent(doc.profitMargin) },
                { label: "Received", value: money(doc.received, currency), tone: "profit" },
                {
                  label: "Receivable",
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
                { label: "Sale number", value: doc.saleNumber },
                { label: "Status", value: voided ? "Voided" : "Completed" },
                { label: "Settlement", value: settlement === "paid" ? "Paid in full" : settlement === "partial" ? "Part paid" : "Unpaid" },
                { label: "Units", value: qty(doc.unitCount) },
                { label: "Average selling price", value: money(doc.unitCount > 0 ? doc.total / doc.unitCount : 0, currency) },
                { label: "Average unit cost", value: money(doc.unitCount > 0 ? doc.totalCost / doc.unitCount : 0, currency) },
              ]}
            />
            <div className="mt-4 border-t border-line pt-3">
              <StatCard
                dense
                label="Stock movement"
                value={`${qty(doc.unitCount)} units out`}
                icon={<Package className="h-4 w-4" aria-hidden />}
                tone="warn"
                hint="Deducted from inventory at the weighted average cost frozen on this invoice"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <PaymentBadge total={doc.total} settled={doc.received} voided={voided} />
              <StatusBadge tone={doc.grossProfit >= 0 ? "profit" : "danger"}>
                {doc.grossProfit >= 0 ? "Profitable" : "Sold at a loss"}
              </StatusBadge>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Items sold"
          subtitle={`${qty(doc.itemCount)} line${doc.itemCount === 1 ? "" : "s"} - ${qty(doc.unitCount)} units`}
          icon={<Package className="h-4 w-4" aria-hidden />}
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
                <td className="num">{money(doc.subtotal, currency)}</td>
                <td className="num hidden md:table-cell">{money(doc.totalCost, currency)}</td>
                <td className="num">{money(doc.grossProfit, currency)}</td>
                <td className="num">
                  {money(doc.total, currency)}
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
                icon={<TrendingUp className="h-5 w-5" aria-hidden />}
                title="No lines on this sale"
                message="A sale always has at least one line. If you are seeing this, the document was edited in the database directly."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Settlement"
          subtitle="How this invoice stands with the buyer"
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          bodyClassName="p-4"
        >
          {voided ? (
            <EmptyState
              compact
              icon={<Ban className="h-5 w-5" aria-hidden />}
              title="This sale is void"
              message="A voided invoice cannot be settled. Record a new sale instead."
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
              title="Collected in full"
              message={`${money(doc.total, currency)} has been received from ${doc.buyerName}.`}
              action={
                doc.buyerId ? (
                  <Button size="sm" onClick={() => navigate(`/buyers/${doc.buyerId}`)}>
                    View buyer statement
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="space-y-3">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-profit-600"
                  style={{
                    width: `${Math.min(100, Math.max(2, (doc.received / (doc.total || 1)) * 100))}%`,
                  }}
                />
              </div>
              <TransactionSummary
                lines={[
                  { label: "Invoice total", value: money(doc.total, currency) },
                  { label: "Already received", value: money(doc.received, currency), tone: "profit" },
                  {
                    label: "Still receivable",
                    value: money(outstanding, currency),
                    tone: "danger",
                    strong: true,
                  },
                  {
                    label: "Collected",
                    value: `${doc.total > 0 ? Math.round((doc.received / doc.total) * 100) : 0}%`,
                    hint: doc.paymentMethod ? `via ${doc.paymentMethod}` : undefined,
                  },
                ]}
              />
              <Button variant="primary" block onClick={() => setReceiving(true)} icon={<Wallet className="h-4 w-4" aria-hidden />}>
                Receive {money(outstanding, currency)} from {doc.buyerName}
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      <PaymentDialog
        open={receiving}
        mode="receive"
        onClose={() => setReceiving(false)}
        onCompleted={() => {
          setReceiving(false);
          state.reload();
        }}
      />

      <ReturnDialog
        open={returning}
        mode="sale"
        reference={doc}
        onClose={() => setReturning(false)}
        onCompleted={() => {
          setReturning(false);
          state.reload();
        }}
      />

      <ReasonDialog
        open={voiding}
        title={`Void ${doc.saleNumber}`}
        description="Voiding reverses the whole sale: the stock goes back on the shelf, and any money received is credited back to the buyer's balance."
        points={[
          `${qty(doc.unitCount)} units will be returned to stock.`,
          `${money(doc.received, currency)} received will be credited back to the buyer.`,
          "The document stays in the register marked as void, with your reason recorded.",
          "Use Take goods back instead if the buyer is only returning part of the order.",
        ]}
        confirmLabel="Explain why this sale is being voided"
        confirmLabelShort="Void sale"
        busy={voidBusy}
        serverError={voidError}
        placeholder="e.g. wrong buyer selected, duplicate entry"
        onConfirm={confirmVoid}
        onCancel={() => setVoiding(false)}
      />
    </div>
  );
}