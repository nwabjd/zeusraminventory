import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Ban,
  Eye,
  FileSpreadsheet,
  FileText,
  Printer,
  PlusCircle,
  Printer as PrintIcon,
  RotateCcw,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import { cn, displayDate, money, qty } from "../lib/format";
import { useAsync, useDebounced, usePage } from "../lib/useAsync";
import { mergeValues, speedsFor, useReferenceData } from "../lib/reference-data";
import { CAPACITIES, DEFAULT_MANUFACTURERS, PAYMENT_METHODS } from "../lib/constants";
import type { Party, Purchase } from "../lib/types";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  IconButton,
  InlineError,
  MoneyStat,
  PageHeader,
  Pagination,
  PaymentBadge,
  PrimaryActionCard,
  ReasonDialog,
  SearchInput,
  SectionCard,
  SkeletonTable,
  StatCard,
  usePagedRows,
  useToast,
  type Column,
} from "../components/ui";
import { ReturnDialog } from "../components/transactions";
import { DateField, LabelledSelect } from "../components/shared";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";
import { printPurchase } from "../lib/doc-print";

/* ===========================================================================
   Purchases
   ---------------------------------------------------------------------------
   Everything bought in, with the two things that matter on a purchase list:
   what is still owed to the seller, and a one-click route back into the
   document. BUY RAM lives at the top of the page.
   =========================================================================== */

interface Filters {
  search: string;
  sellerId: string;
  status: string;
  method: string;
  from: string;
  to: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  manufacturer: string;
  location: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  sellerId: "",
  status: "",
  method: "",
  from: "",
  to: "",
  generation: "",
  category: "",
  capacity: "",
  speed: "",
  manufacturer: "",
  location: "",
};

const STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "void", label: "Voided" },
  { value: "outstanding", label: "Outstanding" },
];

const PAGE_SIZE = 25;

export interface PurchasesProps {
  onBuy: () => void;
}

export default function Purchases({ onBuy }: PurchasesProps) {
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    search: params.get("q") ?? "",
    sellerId: params.get("sellerId") ?? "",
  }));
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showFilters, setShowFilters] = useState(false);

  const [voidTarget, setVoidTarget] = useState<Purchase | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [returnTarget, setReturnTarget] = useState<Purchase | null>(null);

  const refs = useReferenceData();
  const sellers = useAsync(() => api.listSellers(), []);
  const debouncedSearch = useDebounced(filters.search, 220);

  const state = useAsync(
    () =>
      api.purchasesHistory({
        search: debouncedSearch,
        sellerId: filters.sellerId,
        status: filters.status,
        method: filters.method,
        from: filters.from,
        to: filters.to,
        generation: filters.generation,
        category: filters.category,
        capacity: filters.capacity,
        speed: filters.speed,
        manufacturer: filters.manufacturer,
        location: filters.location,
      }),
    [
      debouncedSearch,
      filters.sellerId,
      filters.status,
      filters.method,
      filters.from,
      filters.to,
      filters.generation,
      filters.category,
      filters.capacity,
      filters.speed,
      filters.manufacturer,
      filters.location,
    ],
  );

  const all = state.data ?? [];
  const rows = useMemo(() => {
    if (filters.status !== "outstanding") return all;
    return all.filter((p) => p.status !== "void" && p.remaining > 0.005);
  }, [all, filters.status]);

  const [page, setPage] = usePage(rows, pageSize);
  const visible = usePagedRows(rows, pageSize, page);

  const totals = useMemo(() => {
    let value = 0;
    let paid = 0;
    let due = 0;
    let units = 0;
    let discount = 0;
    let voided = 0;
    rows.forEach((p) => {
      if (p.status === "void") {
        voided += 1;
        return;
      }
      value += p.total;
      paid += p.paid;
      due += p.remaining;
      discount += p.discount;
      units += p.unitCount;
    });
    return { value, paid, due, units, discount, voided, count: rows.length };
  }, [rows]);

  const set =
    (key: keyof Filters) =>
    (value: string): void =>
      setFilters((f) => ({ ...f, [key]: value === "all" ? "" : value }));

  const clearAll = () => setFilters(EMPTY_FILTERS);
  const activeCount = Object.entries(filters).filter(([, v]) => Boolean(v)).length;

  const exportColumns: ExportColumn<Purchase>[] = [
    { header: "Purchase", value: (p) => p.purchaseNumber },
    { header: "Date", value: (p) => p.purchaseDate },
    { header: "Seller", value: (p) => p.sellerName },
    { header: "Lines", value: (p) => p.itemCount, numeric: true },
    { header: "Units", value: (p) => p.unitCount, numeric: true },
    { header: "Subtotal", value: (p) => p.subtotal, numeric: true },
    { header: "Discount", value: (p) => p.discount, numeric: true },
    { header: "Total", value: (p) => p.total, numeric: true },
    { header: "Paid", value: (p) => p.paid, numeric: true },
    { header: "Balance", value: (p) => p.remaining, numeric: true },
    { header: "Method", value: (p) => p.paymentMethod || "" },
    { header: "Status", value: (p) => (p.status === "void" ? "Voided" : p.remaining > 0.005 ? "Outstanding" : "Paid") },
  ];

  const exportOpts = (rowsIn: Purchase[], title: string, filename: string) => ({
    filename,
    title,
    subtitle: `${qty(rowsIn.length)} purchases - ${qty(totals.units)} units`,
    meta: [
      { label: "Total value", value: money(totals.value, currency) },
      { label: "Paid", value: money(totals.paid, currency) },
      { label: "Outstanding", value: money(totals.due, currency) },
      { label: "From", value: filters.from || "Any date" },
      { label: "To", value: filters.to || "Today" },
    ],
    columns: exportColumns,
    rows: rowsIn,
  });

  const columns: Column<Purchase>[] = [
    {
      key: "number",
      header: "Purchase",
      width: "12rem",
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-bold text-brand-800">{p.purchaseNumber}</p>
          <p className="truncate text-2xs text-muted">{displayDate(p.purchaseDate)}</p>
        </div>
      ),
    },
    {
      key: "seller",
      header: "Seller",
      cell: (p) =>
        p.sellerId ? (
          <button
            type="button"
            className="link truncate text-xs"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/sellers/${p.sellerId}`);
            }}
          >
            {p.sellerName}
          </button>
        ) : (
          <span className="text-xs text-muted">{p.sellerName || "Walk-in"}</span>
        ),
    },
    {
      key: "units",
      header: "Lines / units",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (p) => (
        <span className="whitespace-nowrap text-muted">
          {qty(p.itemCount)} / {qty(p.unitCount)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      numeric: true,
      cell: (p) => (
        <div>
          <p className="font-semibold text-ink">{money(p.total, currency)}</p>
          {p.discount > 0 && (
            <p className="text-2xs text-faint">discount {money(p.discount, currency)}</p>
          )}
        </div>
      ),
    },
    {
      key: "due",
      header: "Balance",
      align: "right",
      numeric: true,
      cell: (p) => (
        <span
          className={cn(
            "font-semibold",
            p.status === "void"
              ? "text-faint line-through"
              : p.remaining > 0.005
                ? "text-warn-700"
                : "text-profit-700",
          )}
        >
          {p.status === "void" ? "-" : money(p.remaining, currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => <PaymentBadge total={p.total} settled={p.paid} voided={p.status === "void"} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "9rem",
      cell: (p) => (
        <div
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton label={`View ${p.purchaseNumber}`} tone="brand" onClick={() => navigate(`/purchases/${p.id}`)}>
            <Eye className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Print ${p.purchaseNumber}`}
            onClick={() => {
              const ok = printPurchase(p, currency);
              toast[ok ? "info" : "error"](
                ok ? "Print dialog opened" : "Print dialog blocked",
                ok ? `Document ${p.purchaseNumber}` : "Allow pop-ups for this app, then try again.",
              );
            }}
          >
            <PrintIcon className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Return goods from ${p.purchaseNumber}`}
            tone="warn"
            disabled={p.status === "void" || p.unitCount <= 0 || Boolean(p.cloudApprovalId)}
            title={p.cloudApprovalId ? "Cloud documents are finalized on the server" : undefined}
            onClick={() => setReturnTarget(p)}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Void ${p.purchaseNumber}`}
            tone="danger"
            disabled={p.status === "void" || Boolean(p.cloudApprovalId)}
            title={p.cloudApprovalId ? "Cloud documents are finalized on the server" : undefined}
            onClick={() => {
              setVoidError(null);
              setVoidTarget(p);
            }}
          >
            <Ban className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      ),
    },
  ];

  const confirmVoid = async (reason: string) => {
    const target = voidTarget;
    if (!target) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await api.voidPurchase(target.id, reason);
      toast.success(
        `${target.purchaseNumber} voided`,
        "Stock from this purchase has been reversed and the seller balance restored.",
      );
      setVoidTarget(null);
      state.reload();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiding(false);
    }
  };

  const sellerOptions = (sellers.data ?? []).map((s: Party) => ({
    value: s.id,
    label: s.companyName,
  }));

  return (
    <div className="page">
      <PageHeader
        title="Purchases"
        subtitle="Everything bought in, and what is still owed to each supplier"
        icon={<ShoppingCart className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              onClick={() => {
                exportCsv(exportOpts(rows, "Purchase register", "zeus-purchases"));
                toast.success("Purchases exported", "CSV file downloaded.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
            <Button
              onClick={() => {
                exportExcel(exportOpts(rows, "Purchase register", "zeus-purchases"));
                toast.success("Purchases exported", "Excel workbook downloaded.");
              }}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            >
              Excel
            </Button>
            <Button
              onClick={() => {
                const ok = exportPdf(exportOpts(rows, "Purchase register", "zeus-purchases"));
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
            <Button variant="profit" onClick={onBuy} icon={<PlusCircle className="h-4 w-4" aria-hidden />}>
              BUY RAM
            </Button>
          </>
        }
      >
        <FilterBar
          search={
            <SearchInput
              value={filters.search}
              onValueChange={(v) => setFilters((f) => ({ ...f, search: v }))}
              placeholder="Search purchase number, seller, notes..."
              className="w-full sm:w-72"
            />
          }
          fields={[
            { key: "seller", label: "Seller", value: filters.sellerId, options: sellerOptions, onChange: set("sellerId") },
            { key: "status", label: "Status", value: filters.status, options: STATUS_OPTIONS, onChange: set("status") },
            { key: "method", label: "Method", value: filters.method, options: PAYMENT_METHODS.map((m) => ({ value: m, label: m })), onChange: set("method") },
          ]}
        >
          <Button
            size="sm"
            variant={showFilters ? "primary" : "secondary"}
            onClick={() => setShowFilters((v) => !v)}
          >
            Dates &amp; RAM
          </Button>
        </FilterBar>

        {showFilters && (
          <div className="anim-fade-in card mt-2 grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
            <DateField label="From" value={filters.from} onChange={set("from")} />
            <DateField label="To" value={filters.to} onChange={set("to")} />
            <LabelledSelect
              label="Generation"
              value={filters.generation}
              options={mergeValues([], refs.usedGenerations, ["DDR3", "DDR4", "DDR5"])}
              onChange={set("generation")}
            />
            <LabelledSelect
              label="Category"
              value={filters.category}
              options={mergeValues(refs.named.categories, refs.usedCategories)}
              onChange={set("category")}
            />
            <LabelledSelect
              label="Capacity"
              value={filters.capacity}
              options={mergeValues([], refs.usedCapacities, CAPACITIES)}
              onChange={set("capacity")}
            />
            <LabelledSelect
              label="Speed"
              value={filters.speed}
              options={mergeValues(
                [],
                speedsFor(refs.speeds, filters.generation, refs.usedSpeeds),
              )}
              onChange={set("speed")}
            />
            <LabelledSelect
              label="Manufacturer"
              value={filters.manufacturer}
              options={mergeValues(
                refs.named.manufacturers,
                refs.usedManufacturers,
                DEFAULT_MANUFACTURERS,
              )}
              onChange={set("manufacturer")}
            />
            <LabelledSelect
              label="Location"
              value={filters.location}
              options={mergeValues(refs.named.locations, refs.usedLocations)}
              onChange={set("location")}
            />
          </div>
        )}
      </PageHeader>

      <div className="page-scroll space-y-4">
        <PrimaryActionCard
          tone="buy"
          label="Buy RAM"
          description="Record stock coming in from a seller. Cost, weighted average and seller balance all update in one transaction."
          icon={<PlusCircle className="h-6 w-6" aria-hidden />}
          onClick={onBuy}
          shortcut="B"
        />

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label="Purchased in view"
            value={totals.value}
            currency={currency}
            icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
            tone="warn"
            direction="down"
            hint={`${qty(totals.count)} purchases, ${qty(totals.units)} units`}
          />
          <MoneyStat
            label="Paid to sellers"
            value={totals.paid}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint={`Discounts given ${money(totals.discount, currency)}`}
          />
          <MoneyStat
            label="Still owed"
            value={totals.due}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={totals.due > 0.005 ? "danger" : "profit"}
            hint={totals.due > 0.005 ? "Settle from the Payments screen" : "Nothing outstanding"}
          />
          <StatCard
            label="Voided purchases"
            value={qty(totals.voided)}
            icon={<Ban className="h-4 w-4" aria-hidden />}
            tone={totals.voided > 0 ? "warn" : "neutral"}
            hint={totals.voided > 0 ? "Stock from these was reversed" : "No voids in this view"}
          />
        </div>

        <SectionCard
          title="Purchase register"
          subtitle={`${qty(rows.length)} document${rows.length === 1 ? "" : "s"}${
            activeCount > 0 ? " matching your filters" : ""
          }`}
          icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
          bodyClassName="p-0"
          className="min-h-[18rem]"
        >
          {state.loading && !state.data ? (
            <SkeletonTable rows={8} columns={7} />
          ) : state.error ? (
            <div className="p-4">
              <InlineError message={state.error} onRetry={state.reload} />
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(p) => p.id}
              onRowClick={(p) => navigate(`/purchases/${p.id}`)}
              footer={
                rows.length > 0 ? (
                  <tr>
                    <td>Totals</td>
                    <td />
                    <td className="num hidden md:table-cell">{qty(totals.units)}</td>
                    <td className="num">{money(totals.value, currency)}</td>
                    <td className="num">{money(totals.due, currency)}</td>
                    <td />
                    <td />
                  </tr>
                ) : undefined
              }
              empty={
                <EmptyState
                  icon={<ShoppingCart className="h-5 w-5" aria-hidden />}
                  title={activeCount > 0 ? "No purchases match these filters" : "No purchases yet"}
                  message={
                    activeCount > 0
                      ? "Try a wider date range or clear the filters."
                      : "Record your first purchase and stock levels update automatically."
                  }
                  action={
                    activeCount > 0 ? (
                      <Button size="sm" onClick={clearAll}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button size="sm" variant="profit" onClick={onBuy} icon={<PlusCircle className="h-4 w-4" aria-hidden />}>
                        BUY RAM
                      </Button>
                    )
                  }
                />
              }
            />
          )}
          {rows.length > 0 && (
            <Pagination
              total={rows.length}
              pageSize={pageSize}
              page={page}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              label="purchases"
            />
          )}
        </SectionCard>
      </div>

      <ReturnDialog
        open={returnTarget !== null}
        mode="purchase"
        reference={returnTarget}
        onClose={() => setReturnTarget(null)}
        onCompleted={() => {
          setReturnTarget(null);
          state.reload();
        }}
      />

      <ReasonDialog
        open={voidTarget !== null}
        title={`Void ${voidTarget?.purchaseNumber ?? "purchase"}`}
        description="Voiding reverses the whole purchase: the stock comes back off the shelf, the weighted average cost is recalculated, and any amount paid to the seller is credited back."
        points={[
          `${qty(voidTarget?.unitCount ?? 0)} units will be removed from stock.`,
          `${money(voidTarget?.paid ?? 0, currency)} paid will be credited back to the seller's balance.`,
          "The document stays in the register marked as void, with your reason recorded.",
          "Use a purchase return instead if the supplier only takes back part of the order.",
        ]}
        confirmLabel="Explain why this purchase is being voided"
        confirmLabelShort="Void purchase"
        busy={voiding}
        serverError={voidError}
        placeholder="e.g. wrong seller selected, duplicate entry"
        onConfirm={confirmVoid}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}