import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  FileSpreadsheet,
  FileText,
  Layers,
  Pencil,
  Printer,
  ShoppingCart,
  Tag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import { useAuth } from "../lib/auth";
import { useSync } from "../lib/sync";
import { isAdmin } from "../lib/approval";
import {
  cloudAdjustStock,
  cloudCatalogRowFrom,
  cloudCatalogRowFromItem,
  cloudSaveCatalogItem,
  cloudUpsertCatalog,
} from "../lib/cloud";
import {
  amount,
  displayDate,
  displayDateTime,
  money,
  movementLabel,
  percent,
  qty,
} from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type { Purchase, Sale, StockMovement } from "../lib/types";
import {
  Button,
  DataList,
  DataTable,
  EmptyState,
  InlineError,
  LoadingState,
  MoneyStat,
  PageHeader,
  ReasonDialog,
  SectionCard,
  StatCard,
  StatusBadge,
  StockBadge,
  useToast,
  type Column,
} from "../components/ui";
import { RamItemDialog, StockAdjustDialog } from "../components/transactions";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";

/* ===========================================================================
   Inventory detail
   ---------------------------------------------------------------------------
   One SKU, everything known about it: specifications, live valuation, and the
   full audit trail of every unit that came in and went out.
   =========================================================================== */

export default function InventoryDetail() {
  const { id = "" } = useParams();
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();
  const { cloud, profile } = useAuth();
  const { syncNow } = useSync();
  // Cloud mode: the catalogue is authoritative on the server; catalog edits,
  // archiving and stock adjustments are admin-only (also enforced server-side).
  const canMutateCatalog = !cloud || isAdmin(profile);

  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const item = useAsync(() => api.getRamItem(id), [id]);
  const movements = useAsync(() => api.itemMovements(id), [id]);
  const purchases = useAsync(() => api.itemPurchases(id), [id]);
  const sales = useAsync(() => api.itemSales(id), [id]);

  const current = item.data;

  const marginPercentValue = useMemo(() => {
    if (!current || current.sellingPrice <= 0) return 0;
    return percent(((current.sellingPrice - current.averageCost) / current.sellingPrice) * 100);
  }, [current]);

  const movementColumns: Column<StockMovement>[] = [
    {
      key: "when",
      header: "When",
      width: "9rem",
      cell: (m) => (
        <span className="whitespace-nowrap text-xs text-muted">{displayDateTime(m.createdAt)}</span>
      ),
    },
    {
      key: "type",
      header: "Movement",
      cell: (m) => (
        <StatusBadge tone={m.quantityChange >= 0 ? "profit" : "danger"}>
          {movementLabel(m.movementType)}
        </StatusBadge>
      ),
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      numeric: true,
      cell: (m) => (
        <span
          className={
            m.quantityChange >= 0 ? "font-bold text-profit-700" : "font-bold text-danger-700"
          }
        >
          {m.quantityChange >= 0 ? "+" : ""}
          {qty(m.quantityChange)}
        </span>
      ),
    },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      numeric: true,
      cell: (m) => (
        <span className="whitespace-nowrap text-muted">
          {qty(m.previousStock)} &rarr;{" "}
          <span className="font-bold text-ink">{qty(m.newStock)}</span>
        </span>
      ),
    },
    {
      key: "reference",
      header: "Reference",
      cell: (m) =>
        m.referenceNumber ? (
          <span className="font-mono text-xs font-semibold text-brand-800">
            {m.referenceNumber}
          </span>
        ) : (
          <span className="text-2xs text-faint">-</span>
        ),
      hideBelow: "md",
    },
    {
      key: "notes",
      header: "Note",
      cell: (m) => <span className="text-xs text-muted">{m.notes || "-"}</span>,
      hideBelow: "lg",
    },
  ];

  const movementExport: ExportColumn<StockMovement>[] = [
    { header: "When", value: (m) => m.createdAt },
    { header: "Movement", value: (m) => movementLabel(m.movementType) },
    { header: "Change", value: (m) => m.quantityChange, numeric: true },
    { header: "Stock before", value: (m) => m.previousStock, numeric: true },
    { header: "Stock after", value: (m) => m.newStock, numeric: true },
    { header: "Reference", value: (m) => m.referenceNumber || "" },
    { header: "Note", value: (m) => m.notes || "" },
  ];

  const historyOpts = (title: string, filename: string) => ({
    filename,
    title,
    subtitle: current ? skuLine(current.sku, current) : "",
    meta: current
      ? [
          { label: "In stock", value: qty(current.quantity) },
          { label: "Average cost", value: money(current.averageCost, currency) },
        ]
      : [],
    columns: movementExport,
    rows: movements.data ?? [],
  });

  const inRows = (movements.data ?? []).filter((m) => m.quantityChange > 0);
  const outRows = (movements.data ?? []).filter((m) => m.quantityChange < 0);
  const unitsIn = inRows.reduce((a, m) => a + m.quantityChange, 0);
  const unitsOut = Math.abs(outRows.reduce((a, m) => a + m.quantityChange, 0));

  const toggleArchive = async (reason: string) => {
    if (!current) return;
    setBusy(true);
    setArchiveError(null);
    try {
      if (cloud) {
        // Authoritative server write + mirror refresh so all devices converge.
        const row = cloudCatalogRowFromItem(current, { is_archived: !current.isArchived });
        await cloudUpsertCatalog([row], false);
        await syncNow();
      } else {
        await api.setRamArchived(current.id, !current.isArchived);
      }
      toast.success(
        current.isArchived ? `${current.sku} restored` : `${current.sku} archived`,
        current.isArchived
          ? "The SKU is back in the active catalogue."
          : "Hidden from the working catalogue. " + reason,
      );
      setArchiving(false);
      item.reload();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (item.loading && !current) {
    return (
      <div className="page">
        <LoadingState label="Loading RAM item" />
      </div>
    );
  }

  if (item.error && !current) {
    return (
      <div className="page">
        <PageHeader
          title="RAM item"
          icon={<Tag className="h-5 w-5" aria-hidden />}
          actions={
            <Button onClick={() => navigate("/inventory")} icon={<ArrowLeft className="h-4 w-4" />}>
              Back to inventory
            </Button>
          }
        />
        <InlineError message={item.error} onRetry={item.reload} />
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="page">
      <PageHeader
        title={current.sku}
        subtitle={skuLine(current.sku, current)}
        icon={<Tag className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button onClick={() => navigate("/inventory")} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Inventory
            </Button>
            <Button
              onClick={() => {
                exportCsv(historyOpts(`Stock history - ${current.sku}`, "zeus-stock-history"));
                toast.success("Stock history exported", "CSV file downloaded.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
            <Button
              onClick={() => {
                exportExcel(historyOpts(`Stock history - ${current.sku}`, "zeus-stock-history"));
                toast.success("Stock history exported", "Excel workbook downloaded.");
              }}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            >
              Excel
            </Button>
            <Button
              onClick={() => {
                const ok = exportPdf(historyOpts(`Stock history - ${current.sku}`, "zeus-stock-history"));
                toast[ok ? "info" : "error"](
                  ok ? "Print dialog opened" : "Print dialog blocked",
                  ok
                    ? "Choose 'Microsoft Print to PDF' to save a PDF."
                    : "Allow pop-ups for this app, then try again.",
                );
              }}
              icon={<Printer className="h-4 w-4" aria-hidden />}
            >
              PDF
            </Button>
            <Button
              onClick={() => setAdjusting(true)}
              disabled={!canMutateCatalog}
              title={canMutateCatalog ? undefined : "Only administrators can adjust stock"}
              icon={<Layers className="h-4 w-4" aria-hidden />}
            >
              Adjust stock
            </Button>
            <Button
              variant="primary"
              onClick={() => setEditing(true)}
              disabled={!canMutateCatalog}
              title={canMutateCatalog ? undefined : "Only administrators can edit the catalogue"}
              icon={<Pencil className="h-4 w-4" aria-hidden />}
            >
              Edit item
            </Button>
          </>
        }
      />

      <div className="page-scroll space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label="Stock at average cost"
            value={current.inventoryValue}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={`${qty(current.quantity)} units at ${money(current.averageCost, currency)}`}
          />
          <MoneyStat
            label="Retail value"
            value={current.retailValue}
            currency={currency}
            icon={<Tag className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint={`Selling price ${money(current.sellingPrice, currency)}`}
          />
          <StatCard
            label="Potential profit"
            value={money(current.retailValue - current.inventoryValue, currency)}
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            tone="profit"
            hint={`${marginPercentValue} margin at today's prices`}
          />
          <StatCard
            label="Stock position"
            value={qty(current.quantity)}
            icon={<Layers className="h-4 w-4" aria-hidden />}
            tone={current.quantity <= 0 ? "danger" : current.quantity <= current.minimumStock ? "warn" : "profit"}
            hint={`Reorder point ${qty(current.minimumStock)} units`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Specifications"
            subtitle="What this SKU is"
            icon={<Tag className="h-4 w-4" aria-hidden />}
            bodyClassName="p-4"
            className="xl:col-span-2"
            actions={
              current.isArchived ? (
                <StatusBadge tone="neutral">Archived</StatusBadge>
              ) : (
                <StatusBadge tone="brand">Active</StatusBadge>
              )
            }
          >
            <DataList
              columns={3}
              items={[
                { label: "Generation", value: current.generation },
                { label: "Category", value: current.category },
                { label: "Capacity", value: `${current.capacity} (${qty(current.capacityGb)} GB)` },
                { label: "Speed", value: current.speed },
                { label: "Module type", value: current.ramType || "-" },
                { label: "Rank", value: current.rank || "-" },
                { label: "Manufacturer", value: current.manufacturer || "-" },
                { label: "Model", value: current.model || "-" },
                { label: "Part number", value: current.partNumber || "-" },
                { label: "Condition", value: current.condition || "-" },
                { label: "ECC", value: current.ecc ? "Registered ECC" : "Non-ECC" },
                { label: "Registered", value: current.registered ? "Yes" : "No" },
                { label: "Modules per pack", value: qty(current.moduleCount) },
                { label: "Location", value: current.location || "-" },
                { label: "Reorder point", value: `${qty(current.minimumStock)} units` },
                { label: "Added", value: displayDateTime(current.createdAt) },
                { label: "Last updated", value: displayDateTime(current.updatedAt) },
                { label: "Last purchase price", value: money(current.purchasePrice, currency) },
              ]}
            />
            {current.notes && (
              <div className="mt-4 rounded-lg border border-line bg-[#fafbfd] p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">Notes</p>
                <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-ink">
                  {current.notes}
                </p>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Button size="sm" onClick={() => navigate("/purchases")} icon={<ShoppingCart className="h-4 w-4" aria-hidden />}>
                See purchases of this item
              </Button>
              <Button size="sm" onClick={() => navigate("/sales")} icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
                See sales of this item
              </Button>
              <Button
                size="sm"
                variant={current.isArchived ? "secondary" : "danger-soft"}
                onClick={() => {
                  setArchiveError(null);
                  setArchiving(true);
                }}
                disabled={!canMutateCatalog}
                title={canMutateCatalog ? undefined : "Only administrators can archive items"}
                icon={
                  current.isArchived ? (
                    <ArchiveRestore className="h-4 w-4" aria-hidden />
                  ) : (
                    <Archive className="h-4 w-4" aria-hidden />
                  )
                }
              >
                {current.isArchived ? "Restore SKU" : "Archive SKU"}
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="Unit flow"
            subtitle="Every unit accounted for"
            icon={<Layers className="h-4 w-4" aria-hidden />}
            bodyClassName="p-3"
          >
            <div className="space-y-2.5">
              <div className="rounded-lg border border-line p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                  Received in
                </p>
                <p className="tnum mt-1 text-2xl font-bold text-profit-700">{qty(unitsIn)}</p>
                <p className="text-2xs text-faint">{qty(inRows.length)} movements</p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">Sent out</p>
                <p className="tnum mt-1 text-2xl font-bold text-danger-700">{qty(unitsOut)}</p>
                <p className="text-2xs text-faint">{qty(outRows.length)} movements</p>
              </div>
              <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
                <p className="text-2xs font-bold tracking-wider text-brand-700 uppercase">
                  On hand now
                </p>
                <p className="tnum mt-1 text-2xl font-bold text-brand-800">{qty(current.quantity)}</p>
                <div className="mt-2">
                  <StockBadge quantity={current.quantity} minimum={current.minimumStock} />
                </div>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                  Linked documents
                </p>
                <p className="tnum mt-1 text-lg font-bold text-ink">
                  {qty((purchases.data ?? []).length + (sales.data ?? []).length)}
                </p>
                <p className="text-2xs text-faint">
                  {qty((purchases.data ?? []).length)} purchase
                  {(purchases.data ?? []).length === 1 ? "" : "s"},{" "}
                  {qty((sales.data ?? []).length)} sale{(sales.data ?? []).length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Stock movements"
          subtitle="Purchases, sales, returns and manual adjustments in order"
          icon={<Layers className="h-4 w-4" aria-hidden />}
          bodyClassName="p-0"
        >
          {movements.loading && !movements.data ? (
            <div className="p-4">
              <LoadingState label="Loading movements" />
            </div>
          ) : movements.error ? (
            <div className="p-4">
              <InlineError message={movements.error} onRetry={movements.reload} />
            </div>
          ) : (
            <DataTable
              columns={movementColumns}
              rows={movements.data ?? []}
              rowKey={(m) => m.id}
              footer={
                (movements.data ?? []).length > 0 ? (
                  <tr>
                    <td>Total movements</td>
                    <td>{qty((movements.data ?? []).length)}</td>
                    <td className="num">
                      {unitsIn - unitsOut >= 0 ? "+" : ""}
                      {qty(unitsIn - unitsOut)}
                    </td>
                    <td className="num">{qty(current.quantity)}</td>
                    <td className="hidden md:table-cell" />
                    <td className="hidden lg:table-cell" />
                  </tr>
                ) : undefined
              }
              empty={
                <EmptyState
                  compact
                  icon={<Layers className="h-5 w-5" aria-hidden />}
                  title="No movements recorded"
                  message="Buy RAM to bring this SKU in, or adjust the stock manually to record opening stock."
                  action={
                    <Button size="sm" onClick={() => setAdjusting(true)} disabled={!canMutateCatalog}>
                      Adjust stock
                    </Button>
                  }
                />
              }
            />
          )}
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DocumentList
            title="Purchased from"
            icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
            rows={purchases.data ?? []}
            loading={purchases.loading}
            error={purchases.error}
            onRetry={purchases.reload}
            currency={currency}
            onOpen={(p) => navigate(`/purchases/${p.id}`)}
            emptyMessage="This SKU has not been bought yet."
          />
          <DocumentList
            title="Sold to"
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            rows={sales.data ?? []}
            loading={sales.loading}
            error={sales.error}
            onRetry={sales.reload}
            currency={currency}
            onOpen={(s) => navigate(`/sales/${s.id}`)}
            emptyMessage="This SKU has not been sold yet."
          />
        </div>
      </div>

      <RamItemDialog
        open={editing}
        editing={current}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          item.reload();
        }}
        saveVia={
          cloud
            ? async (payload, editingItem) =>
                cloudSaveCatalogItem(cloudCatalogRowFrom(payload, editingItem), syncNow, editingItem)
            : undefined
        }
      />

      <StockAdjustDialog
        open={adjusting}
        item={current}
        onClose={() => setAdjusting(false)}
        onCompleted={() => {
          setAdjusting(false);
          item.reload();
          movements.reload();
        }}
        adjustVia={
          cloud
            ? async (input) => {
                if (!current) throw new Error("No item selected.");
                const delta = input.adjustmentType === "INCREASE" ? input.quantity : -input.quantity;
                const source = await cloudAdjustStock(current.sku, delta, input.reason);
                await syncNow();
                const rows = await api.listRamItems({ search: current.sku, limit: 100 });
                const mirrored = rows.find((r) => r.sku === current.sku) ?? current;
                return {
                  item: mirrored,
                  adjustment: {
                    id: `cloud-adjust-${Date.now()}`,
                    ramItemId: current.id,
                    sku: current.sku,
                    adjustmentType: input.adjustmentType,
                    quantity: input.quantity,
                    previousStock: current.quantity,
                    newStock: source.quantity,
                    reason: input.reason,
                    notes: input.notes,
                    createdAt: new Date().toISOString(),
                  },
                };
              }
            : undefined
        }
      />

      <ReasonDialog
        open={archiving}
        title={current.isArchived ? `Restore ${current.sku}` : `Archive ${current.sku}`}
        description={
          current.isArchived
            ? "The SKU returns to the active catalogue and can be bought, sold and adjusted again."
            : "Archiving hides the SKU from the working catalogue. Every purchase, sale and movement it appears in is kept, and you can restore it at any time."
        }
        points={
          current.isArchived
            ? undefined
            : [
                `Stock on hand stays as it is: ${qty(current.quantity)} units.`,
                "The SKU disappears from the BUY RAM and SELL RAM pickers.",
                "Reports and this history remain complete.",
              ]
        }
        confirmLabel="Explain why this SKU is being archived"
        confirmLabelShort={current.isArchived ? "Restore SKU" : "Archive SKU"}
        busy={busy}
        serverError={archiveError}
        placeholder="e.g. replaced by a newer DDR5 range"
        onConfirm={toggleArchive}
        onCancel={() => setArchiving(false)}
      />
    </div>
  );
}

/* -------------------------------------------------------------- helpers --- */

function skuLine(
  sku: string,
  item: { generation: string; category: string; capacity: string; speed: string },
): string {
  return `${sku} - ${item.generation} ${item.category} ${item.capacity} ${item.speed}`;
}

interface DocRow {
  id: string;
  total: number;
  received?: number;
  paid?: number;
  remaining: number;
  status: "completed" | "void";
}

function DocumentList({
  title,
  icon,
  rows,
  loading,
  error,
  onRetry,
  currency,
  onOpen,
  emptyMessage,
}: {
  title: string;
  icon: React.ReactNode;
  rows: (Purchase | Sale)[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  currency: string;
  onOpen: (row: Purchase | Sale) => void;
  emptyMessage: string;
}) {
  return (
    <SectionCard
      title={title}
      subtitle={`${qty(rows.length)} document${rows.length === 1 ? "" : "s"}`}
      icon={icon}
      bodyClassName="p-0"
    >
      {loading && rows.length === 0 ? (
        <div className="p-4">
          <LoadingState label="Loading" />
        </div>
      ) : error ? (
        <div className="p-4">
          <InlineError message={error} onRetry={onRetry} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState compact icon={<Ban className="h-5 w-5" aria-hidden />} title="Nothing linked yet" message={emptyMessage} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const doc = r as DocRow;
            const settled = doc.received ?? doc.paid ?? 0;
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-bold text-brand-800">
                      {"purchaseNumber" in r ? r.purchaseNumber : r.saleNumber}
                    </p>
                    <p className="truncate text-2xs text-muted">
                      {"buyerName" in r ? r.buyerName : r.sellerName} &middot;{" "}
                      {"purchaseDate" in r ? displayDate(r.purchaseDate) : displayDate(r.saleDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tnum text-sm font-semibold text-ink">{money(doc.total, currency)}</p>
                    <p className="tnum text-2xs text-muted">
                      {doc.status === "void"
                        ? "Voided"
                        : doc.remaining > 0.005
                          ? `${money(doc.remaining, currency)} due`
                          : `Settled ${amount(settled)}`}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}