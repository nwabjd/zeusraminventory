import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Ban,
  Eye,
  FileSpreadsheet,
  FileText,
  MinusCircle,
  Printer,
  RotateCcw,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import { cn, displayDate, money, percent, qty } from "../lib/format";
import { useAsync, useDebounced, usePage } from "../lib/useAsync";
import { mergeValues, speedsFor, useReferenceData } from "../lib/reference-data";
import { CAPACITIES, DEFAULT_MANUFACTURERS, PAYMENT_METHODS } from "../lib/constants";
import type { Party, Sale } from "../lib/types";
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
  usePagedRows,
  useToast,
  type Column,
} from "../components/ui";
import { ReturnDialog } from "../components/transactions";
import { DateField, LabelledSelect } from "../components/shared";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";
import { printSale } from "../lib/doc-print";

/* ===========================================================================
   Sales
   ---------------------------------------------------------------------------
   Every invoice out of the door with revenue, cost and gross profit alongside
   the balance still receivable. SELL RAM sits at the top of the page.
   =========================================================================== */

interface Filters {
  search: string;
  buyerId: string;
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
  buyerId: "",
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
  { value: "profit", label: "Loss making" },
];

const PAGE_SIZE = 25;

export interface SalesProps {
  onSell: () => void;
}

export default function Sales({ onSell }: SalesProps) {
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    search: params.get("q") ?? "",
    buyerId: params.get("buyerId") ?? "",
  }));
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showFilters, setShowFilters] = useState(false);

  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [returnTarget, setReturnTarget] = useState<Sale | null>(null);

  const refs = useReferenceData();
  const buyers = useAsync(() => api.listBuyers(), []);
  const debouncedSearch = useDebounced(filters.search, 220);

  const state = useAsync(
    () =>
      api.salesHistory({
        search: debouncedSearch,
        buyerId: filters.buyerId,
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
      filters.buyerId,
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
    if (filters.status === "outstanding") {
      return all.filter((s) => s.status !== "void" && s.remaining > 0.005);
    }
    if (filters.status === "profit") {
      return all.filter((s) => s.status !== "void" && s.grossProfit < 0);
    }
    return all;
  }, [all, filters.status]);

  const [page, setPage] = usePage(rows, pageSize);
  const visible = usePagedRows(rows, pageSize, page);

  const totals = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let profit = 0;
    let received = 0;
    let due = 0;
    let units = 0;
    let voided = 0;
    rows.forEach((s) => {
      if (s.status === "void") {
        voided += 1;
        return;
      }
      revenue += s.total;
      cost += s.totalCost;
      profit += s.grossProfit;
      received += s.received;
      due += s.remaining;
      units += s.unitCount;
    });
    return { revenue, cost, profit, received, due, units, voided, count: rows.length };
  }, [rows]);

  const set =
    (key: keyof Filters) =>
    (value: string): void =>
      setFilters((f) => ({ ...f, [key]: value === "all" ? "" : value }));

  const clearAll = () => setFilters(EMPTY_FILTERS);
  const activeCount = Object.entries(filters).filter(([, v]) => Boolean(v)).length;

  const exportColumns: ExportColumn<Sale>[] = [
    { header: "Sale", value: (s) => s.saleNumber },
    { header: "Date", value: (s) => s.saleDate },
    { header: "Buyer", value: (s) => s.buyerName },
    { header: "Lines", value: (s) => s.itemCount, numeric: true },
    { header: "Units", value: (s) => s.unitCount, numeric: true },
    { header: "Subtotal", value: (s) => s.subtotal, numeric: true },
    { header: "Discount", value: (s) => s.discount, numeric: true },
    { header: "Revenue", value: (s) => s.total, numeric: true },
    { header: "Cost", value: (s) => s.totalCost, numeric: true },
    { header: "Gross profit", value: (s) => s.grossProfit, numeric: true },
    { header: "Margin %", value: (s) => s.profitMargin, numeric: true },
    { header: "Received", value: (s) => s.received, numeric: true },
    { header: "Balance", value: (s) => s.remaining, numeric: true },
    { header: "Method", value: (s) => s.paymentMethod || "" },
    {
      header: "Status",
      value: (s) =>
        s.status === "void" ? "Voided" : s.remaining > 0.005 ? "Outstanding" : "Paid",
    },
  ];

  const exportOpts = (title: string, filename: string) => ({
    filename,
    title,
    subtitle: `${qty(totals.count)} sales - ${qty(totals.units)} units`,
    meta: [
      { label: "Revenue", value: money(totals.revenue, currency) },
      { label: "Cost of goods", value: money(totals.cost, currency) },
      { label: "Gross profit", value: money(totals.profit, currency) },
      { label: "Received", value: money(totals.received, currency) },
      { label: "Outstanding", value: money(totals.due, currency) },
      { label: "From", value: filters.from || "Any date" },
      { label: "To", value: filters.to || "Today" },
    ],
    columns: exportColumns,
    rows,
  });

  const columns: Column<Sale>[] = [
    {
      key: "number",
      header: "Sale",
      width: "12rem",
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-bold text-brand-800">{s.saleNumber}</p>
          <p className="truncate text-2xs text-muted">{displayDate(s.saleDate)}</p>
        </div>
      ),
    },
    {
      key: "buyer",
      header: "Buyer",
      cell: (s) =>
        s.buyerId ? (
          <button
            type="button"
            className="link truncate text-xs"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/buyers/${s.buyerId}`);
            }}
          >
            {s.buyerName}
          </button>
        ) : (
          <span className="text-xs text-muted">{s.buyerName || "Walk-in"}</span>
        ),
    },
    {
      key: "units",
      header: "Lines / units",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (s) => (
        <span className="whitespace-nowrap text-muted">
          {qty(s.itemCount)} / {qty(s.unitCount)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Revenue",
      align: "right",
      numeric: true,
      cell: (s) => (
        <div>
          <p className="font-semibold text-ink">{money(s.total, currency)}</p>
          {s.discount > 0 && (
            <p className="text-2xs text-faint">discount {money(s.discount, currency)}</p>
          )}
        </div>
      ),
    },
    {
      key: "profit",
      header: "Gross profit",
      align: "right",
      numeric: true,
      cell: (s) => (
        <div>
          <p
            className={cn(
              "font-semibold",
              s.status === "void"
                ? "text-faint"
                : s.grossProfit >= 0
                  ? "text-profit-700"
                  : "text-danger-700",
            )}
          >
            {s.status === "void" ? "-" : money(s.grossProfit, currency)}
          </p>
          <p className="text-2xs text-faint">{percent(s.profitMargin)} margin</p>
        </div>
      ),
    },
    {
      key: "due",
      header: "Balance",
      align: "right",
      numeric: true,
      cell: (s) => (
        <span
          className={cn(
            "font-semibold",
            s.status === "void"
              ? "text-faint line-through"
              : s.remaining > 0.005
                ? "text-warn-700"
                : "text-profit-700",
          )}
        >
          {s.status === "void" ? "-" : money(s.remaining, currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => <PaymentBadge total={s.total} settled={s.received} voided={s.status === "void"} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "9rem",
      cell: (s) => (
        <div
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton label={`View ${s.saleNumber}`} tone="brand" onClick={() => navigate(`/sales/${s.id}`)}>
            <Eye className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Print ${s.saleNumber}`}
            onClick={() => {
              const ok = printSale(s, currency);
              toast[ok ? "info" : "error"](
                ok ? "Print dialog opened" : "Print dialog blocked",
                ok ? `Document ${s.saleNumber}` : "Allow pop-ups for this app, then try again.",
              );
            }}
          >
            <Printer className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Take back goods from ${s.saleNumber}`}
            tone="warn"
            disabled={s.status === "void" || s.unitCount <= 0 || Boolean(s.cloudApprovalId)}
            title={s.cloudApprovalId ? "Cloud documents are finalized on the server" : undefined}
            onClick={() => setReturnTarget(s)}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Void ${s.saleNumber}`}
            tone="danger"
            disabled={s.status === "void" || Boolean(s.cloudApprovalId)}
            title={s.cloudApprovalId ? "Cloud documents are finalized on the server" : undefined}
            onClick={() => {
              setVoidError(null);
              setVoidTarget(s);
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
      await api.voidSale(target.id, reason);
      toast.success(
        `${target.saleNumber} voided`,
        "Stock has been returned to the shelf and any amount received credited back to the buyer.",
      );
      setVoidTarget(null);
      state.reload();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiding(false);
    }
  };

  const buyerOptions = (buyers.data ?? []).map((b: Party) => ({
    value: b.id,
    label: b.companyName,
  }));

  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  return (
    <div className="page">
      <PageHeader
        title="Sales"
        subtitle="Every invoice, the profit it made and what is still owed to you"
        icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              onClick={() => {
                exportCsv(exportOpts("Sales register", "zeus-sales"));
                toast.success("Sales exported", "CSV file downloaded.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
            <Button
              onClick={() => {
                exportExcel(exportOpts("Sales register", "zeus-sales"));
                toast.success("Sales exported", "Excel workbook downloaded.");
              }}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            >
              Excel
            </Button>
            <Button
              onClick={() => {
                const ok = exportPdf(exportOpts("Sales register", "zeus-sales"));
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
            <Button variant="danger" onClick={onSell} icon={<MinusCircle className="h-4 w-4" aria-hidden />}>
              SELL RAM
            </Button>
          </>
        }
      >
        <FilterBar
          search={
            <SearchInput
              value={filters.search}
              onValueChange={(v) => setFilters((f) => ({ ...f, search: v }))}
              placeholder="Search sale number, buyer, notes..."
              className="w-full sm:w-72"
            />
          }
          fields={[
            { key: "buyer", label: "Buyer", value: filters.buyerId, options: buyerOptions, onChange: set("buyerId") },
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
          tone="sell"
          label="Sell RAM"
          description="Send stock out to a buyer. Available stock is checked, and revenue, cost, gross profit and margin are worked out live."
          icon={<MinusCircle className="h-6 w-6" aria-hidden />}
          onClick={onSell}
          shortcut="S"
        />

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label="Revenue in view"
            value={totals.revenue}
            currency={currency}
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            tone="brand"
            direction="up"
            hint={`${qty(totals.count)} sales, ${qty(totals.units)} units`}
          />
          <MoneyStat
            label="Gross profit"
            value={totals.profit}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={totals.profit >= 0 ? "profit" : "danger"}
            hint={`${percent(margin)} margin on ${money(totals.revenue, currency)} revenue`}
          />
          <MoneyStat
            label="Received from buyers"
            value={totals.received}
            currency={currency}
            icon={<Users className="h-4 w-4" aria-hidden />}
            tone="profit"
            hint={`Cost of goods sold ${money(totals.cost, currency)}`}
          />
          <MoneyStat
            label="Still receivable"
            value={totals.due}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={totals.due > 0.005 ? "danger" : "profit"}
            hint={totals.due > 0.005 ? "Chase from the Payments screen" : "Nothing outstanding"}
          />
        </div>

        <SectionCard
          title="Sales register"
          subtitle={`${qty(rows.length)} invoice${rows.length === 1 ? "" : "s"}${
            activeCount > 0 ? " matching your filters" : ""
          } - cost of goods ${money(totals.cost, currency)}`}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
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
              rowKey={(s) => s.id}
              onRowClick={(s) => navigate(`/sales/${s.id}`)}
              footer={
                rows.length > 0 ? (
                  <tr>
                    <td>Totals</td>
                    <td />
                    <td className="num hidden md:table-cell">{qty(totals.units)}</td>
                    <td className="num">{money(totals.revenue, currency)}</td>
                    <td className="num">{money(totals.profit, currency)}</td>
                    <td className="num">{money(totals.due, currency)}</td>
                    <td />
                    <td />
                  </tr>
                ) : undefined
              }
              empty={
                <EmptyState
                  icon={<TrendingUp className="h-5 w-5" aria-hidden />}
                  title={activeCount > 0 ? "No sales match these filters" : "No sales yet"}
                  message={
                    activeCount > 0
                      ? "Try a wider date range or clear the filters."
                      : "Sell RAM to record your first sale. Profit and margin are worked out for you."
                  }
                  action={
                    activeCount > 0 ? (
                      <Button size="sm" onClick={clearAll}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger" onClick={onSell} icon={<MinusCircle className="h-4 w-4" aria-hidden />}>
                        SELL RAM
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
              label="sales"
            />
          )}
        </SectionCard>
      </div>

      <ReturnDialog
        open={returnTarget !== null}
        mode="sale"
        reference={returnTarget}
        onClose={() => setReturnTarget(null)}
        onCompleted={() => {
          setReturnTarget(null);
          state.reload();
        }}
      />

      <ReasonDialog
        open={voidTarget !== null}
        title={`Void ${voidTarget?.saleNumber ?? "sale"}`}
        description="Voiding reverses the whole sale: the stock goes back on the shelf, and any money received is credited back to the buyer's balance."
        points={[
          `${qty(voidTarget?.unitCount ?? 0)} units will be returned to stock.`,
          `${money(voidTarget?.received ?? 0, currency)} received will be credited back to the buyer.`,
          "The document stays in the register marked as void, with your reason recorded.",
          "Use a sale return instead if the buyer is only bringing back part of the order.",
        ]}
        confirmLabel="Explain why this sale is being voided"
        confirmLabelShort="Void sale"
        busy={voiding}
        serverError={voidError}
        placeholder="e.g. wrong buyer selected, duplicate entry"
        onConfirm={confirmVoid}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}