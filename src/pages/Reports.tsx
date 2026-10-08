import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Banknote,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Coins,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Package,
  Percent,
  Printer,
  Receipt,
  RotateCcw,
  ShoppingCart,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp, useCurrency } from "../lib/app-context";
import {
  cn,
  coworkerLabel,
  displayDate,
  money,
  movementLabel,
  paymentLabel,
  percent,
  qty,
  relativeDay,
} from "../lib/format";
import { useAsync } from "../lib/useAsync";
import {
  CATEGORIES,
  CAPACITIES,
  DEFAULT_MANUFACTURERS,
  DEFAULT_LOCATIONS,
  GENERATIONS,
  PAYMENT_METHODS,
  STOCK_STATUS_FILTERS,
} from "../lib/constants";
import { mergeValues, speedsFor, useReferenceData } from "../lib/reference-data";
import { emptyReportFilter } from "../lib/types";
import type {
  Coworker,
  CoworkerTransaction,
  InventoryReportRow,
  Party,
  Payment,
  ProfitRow,
  Purchase,
  ReportFilter,
  Sale,
  StockMovement,
} from "../lib/types";
import {
  ArchivedBadge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  InlineError,
  LoadingState,
  MoneyStat,
  PageHeader,
  PaymentBadge,
  SectionCard,
  StatCard,
  StatusBadge,
  useToast,
  type Column,
} from "../components/ui";
import { DateField, DatePresetBar } from "../components/shared";
import {
  exportCsv,
  exportExcel,
  exportPdf,
  printElement,
  type ExportOptions,
} from "../lib/export";

/* ===========================================================================
   Reports
   ---------------------------------------------------------------------------
   Ten finished reports over one shared filter. Every report is a real query in
   the Rust backend - nothing here is computed in the browser from cached rows -
   so the numbers on screen are the numbers on disk.

   Layout: a row of report cards to pick the report, the filter bar underneath
   (it applies to whichever report is selected), then the report itself with its
   own totals, table and export buttons.
   =========================================================================== */

type ReportKey =
  | "inventory"
  | "purchases"
  | "sales"
  | "profit"
  | "buyers"
  | "sellers"
  | "payments"
  | "coworkers"
  | "movements"
  | "returns";

interface ReportDef {
  key: ReportKey;
  label: string;
  blurb: string;
  icon: typeof BarChart3;
  /** Reports that ignore the RAM catalogue filters. */
  ignoresCatalogue?: boolean;
  /** Reports that ignore the party filter. */
  ignoresParty?: boolean;
}

const REPORTS: ReportDef[] = [
  {
    key: "inventory",
    label: "Inventory valuation",
    blurb: "Stock on hand, valued at average cost and at retail",
    icon: Package,
  },
  {
    key: "purchases",
    label: "Purchases",
    blurb: "What was bought, from whom, and what is still owed",
    icon: ShoppingCart,
    ignoresParty: true,
  },
  {
    key: "sales",
    label: "Sales",
    blurb: "What was sold, to whom, cost, profit and what is still due",
    icon: TrendingUp,
    ignoresParty: true,
  },
  {
    key: "profit",
    label: "Profit & margin",
    blurb: "Revenue against cost, grouped by day, week, month or quarter",
    icon: Percent,
    ignoresParty: true,
    ignoresCatalogue: true,
  },
  {
    key: "buyers",
    label: "Buyer balances",
    blurb: "Who owes the most, billed against received",
    icon: Users,
    ignoresCatalogue: true,
  },
  {
    key: "sellers",
    label: "Seller balances",
    blurb: "Who the shop owes the most, billed against paid",
    icon: Building2,
    ignoresCatalogue: true,
  },
  {
    key: "payments",
    label: "Payments",
    blurb: "Every dirham in and out, split by method",
    icon: Banknote,
    ignoresCatalogue: true,
  },
  {
    key: "coworkers",
    label: "Coworker ledger",
    blurb: "Lent, borrowed and repaid with the net position",
    icon: UsersRound,
    ignoresCatalogue: true,
    ignoresParty: true,
  },
  {
    key: "movements",
    label: "Stock movements",
    blurb: "Every quantity change with its cause and running stock",
    icon: Coins,
    ignoresParty: true,
  },
  {
    key: "returns",
    label: "Returns",
    blurb: "Goods coming back from buyers and going back to suppliers",
    icon: RotateCcw,
    ignoresCatalogue: true,
    ignoresParty: true,
  },
];

const GROUPINGS = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "quarter", label: "By quarter" },
];



/* ================================================================ screen === */

export default function Reports() {
  const currency = useCurrency();
  const toast = useToast();
  const { business } = useApp();
  const reference = useReferenceData();

  const [report, setReport] = useState<ReportKey>("inventory");
  const [filter, setFilter] = useState<ReportFilter>(emptyReportFilter);
  const [grouping, setGrouping] = useState("day");

  const def = REPORTS.find((r) => r.key === report) ?? REPORTS[0];

  const state = useAsync(async () => {
    const f: ReportFilter = {
      ...filter,
      partyId: def.ignoresParty ? "" : filter.partyId,
      generation: def.ignoresCatalogue ? "" : filter.generation,
      category: def.ignoresCatalogue ? "" : filter.category,
      capacity: def.ignoresCatalogue ? "" : filter.capacity,
      speed: def.ignoresCatalogue ? "" : filter.speed,
      manufacturer: def.ignoresCatalogue ? "" : filter.manufacturer,
      location: def.ignoresCatalogue ? "" : filter.location,
    };
    switch (report) {
      case "inventory":
        return api.reportInventory(f);
      case "purchases":
        return api.reportPurchases(f);
      case "sales":
        return api.reportSales(f);
      case "profit":
        return api.reportProfit(f, grouping);
      case "buyers":
        return api.reportBuyerBalances(f);
      case "sellers":
        return api.reportSellerBalances(f);
      case "payments":
        return api.reportPayments(f);
      case "coworkers":
        return api.reportCoworkers(f);
      case "movements":
        return api.reportStockMovements(f);
      case "returns":
        return api.reportReturns(f);
      default:
        return api.reportInventory(f);
    }
  }, [
    report,
    grouping,
    filter.from,
    filter.to,
    filter.generation,
    filter.category,
    filter.capacity,
    filter.speed,
    filter.manufacturer,
    filter.location,
    filter.partyId,
    filter.method,
    filter.status,
    def.ignoresParty,
    def.ignoresCatalogue,
  ]);

  const topMoversState = useAsync(
    () =>
      report === "inventory" || report === "sales"
        ? api.reportTopMovers({ ...filter, from: filter.from, to: filter.to }, 10)
        : Promise.resolve([]),
    [report, filter.from, filter.to],
  );

  const partiesState = useAsync(
    () =>
      report === "buyers"
        ? api.listBuyers("", true)
        : report === "sellers"
          ? api.listSellers("", true)
          : Promise.resolve<Party[]>([]),
    [report],
  );

  const set = (key: keyof ReportFilter) => (value: string) =>
    setFilter((f) => ({ ...f, [key]: value === "all" ? "" : value }));

  const clearAll = () => setFilter(emptyReportFilter());

  const activeFilters = Object.entries(filter).filter(
    ([k, v]) => v !== "" && k !== "capacity" ? true : v !== "",
  ).length;

  const generations = mergeValues([], reference.usedGenerations, GENERATIONS);
  const categories = mergeValues(reference.named.categories ?? [], reference.usedCategories, CATEGORIES);
  const capacities = mergeValues([], reference.usedCapacities, CAPACITIES);
  const speeds = speedsFor(
    reference.speeds,
    filter.generation,
    reference.usedSpeeds,
  );
  const manufacturers = mergeValues(
    reference.named.manufacturers ?? [],
    reference.usedManufacturers,
    DEFAULT_MANUFACTURERS,
  );
  const locations = mergeValues(
    reference.named.locations ?? [],
    reference.usedLocations,
    DEFAULT_LOCATIONS,
  );

  const body = useMemo(
    () => renderBody(report, state.data, state.loading, state.error, state.reload, currency),
    [report, state.data, state.loading, state.error, state.reload, currency],
  );

  const exportSpec = useMemo(
    () => exportFor(report, state.data, currency, filter),
    [report, state.data, currency, filter],
  );

  const runExport = (mode: "csv" | "xls" | "pdf") => {
    const opts: ExportOptions<unknown> = { ...exportSpec, business } as ExportOptions<unknown>;
    if (mode === "csv") {
      exportCsv(opts);
      toast.success("Report exported", "CSV file downloaded.");
    } else if (mode === "xls") {
      exportExcel(opts);
      toast.success("Report exported", "Excel workbook downloaded.");
    } else {
      const ok = exportPdf(opts);
      toast[ok ? "info" : "error"](
        ok ? "Print dialog opened" : "Print dialog blocked",
        ok
          ? "Choose 'Microsoft Print to PDF' to save a PDF."
          : "Allow pop-ups for this app, then try again.",
      );
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle="Ten finished reports over one shared filter - export any of them to CSV, Excel or PDF"
        icon={<BarChart3 className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              icon={<FileText className="h-4 w-4" aria-hidden />}
              onClick={() => runExport("csv")}
            >
              CSV
            </Button>
            <Button
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
              onClick={() => runExport("xls")}
            >
              Excel
            </Button>
            <Button icon={<Printer className="h-4 w-4" aria-hidden />} onClick={() => runExport("pdf")}>
              PDF
            </Button>
            <Button
              icon={<ArrowRight className="h-4 w-4" aria-hidden />}
              onClick={() => {
                printElement("zeus-report");
                toast.info("Printing", "The report on screen is what will come out of the printer.");
              }}
            >
              Print screen
            </Button>
          </>
        }
      />

      <div className="page-scroll space-y-4">
        {/* ---- report picker ------------------------------------------- */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            const active = r.key === report;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setReport(r.key)}
                aria-pressed={active}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all",
                  active
                    ? "border-brand-500 bg-brand-50 shadow-[var(--shadow-card)]"
                    : "border-line bg-surface hover:border-brand-300 hover:bg-[#fafbfd]",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-brand-600 text-white" : "bg-canvas text-brand-600",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-xs font-bold",
                      active ? "text-brand-800" : "text-ink",
                    )}
                  >
                    {r.label}
                  </span>
                  <span className="mt-0.5 block text-2xs leading-snug text-muted">
                    {r.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* ---- shared filter ------------------------------------------- */}
        <SectionCard
          title="Report filter"
          subtitle={
            filter.from || filter.to
              ? `From ${displayDate(filter.from)} to ${displayDate(filter.to)}`
              : "Every date on record"
          }
          icon={<FilterIcon />}
          bodyClassName="p-3"
          actions={
            <DatePresetBar
              from={filter.from}
              to={filter.to}
              onChange={({ from, to }) => setFilter((f) => ({ ...f, from, to }))}
            />
          }
        >
          <FilterBar
            fields={
              def.ignoresCatalogue
                ? []
                : [
                    {
                      key: "generation",
                      label: "Generation",
                      value: filter.generation,
                      options: generations.map((g) => ({ value: g, label: g })),
                      onChange: set("generation"),
                    },
                    {
                      key: "category",
                      label: "Category",
                      value: filter.category,
                      options: categories.map((c) => ({ value: c, label: c })),
                      onChange: set("category"),
                    },
                    {
                      key: "capacity",
                      label: "Capacity",
                      value: filter.capacity,
                      options: capacities.map((c) => ({ value: c, label: c })),
                      onChange: set("capacity"),
                    },
                    {
                      key: "speed",
                      label: "Speed",
                      value: filter.speed,
                      options: speeds.map((s) => ({ value: s, label: s })),
                      onChange: set("speed"),
                    },
                    {
                      key: "manufacturer",
                      label: "Make",
                      value: filter.manufacturer,
                      options: manufacturers.map((m) => ({ value: m, label: m })),
                      onChange: set("manufacturer"),
                    },
                    {
                      key: "location",
                      label: "Location",
                      value: filter.location,
                      options: locations.map((l) => ({ value: l, label: l })),
                      onChange: set("location"),
                    },
                  ]
            }
          >
            <DateField label="From" value={filter.from} onChange={set("from")} className="w-36" />
            <DateField label="To" value={filter.to} onChange={set("to")} className="w-36" />
            {report === "profit" && (
              <select
                value={grouping}
                aria-label="Group profit by"
                onChange={(e) => setGrouping(e.target.value)}
                className="input h-9 w-auto min-w-[9.5rem] cursor-pointer text-xs"
              >
                {GROUPINGS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
            {report === "inventory" && (
              <select
                value={filter.status}
                aria-label="Stock status"
                onChange={(e) => set("status")(e.target.value)}
                className={cn(
                  "input h-9 w-auto min-w-[10rem] cursor-pointer text-xs",
                  filter.status && "border-brand-400 bg-brand-50 text-brand-800",
                )}
              >
                <option value="">Stock status: All</option>
                {STOCK_STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            {(report === "payments" || report === "purchases" || report === "sales") && (
              <select
                value={filter.method}
                aria-label="Payment method"
                onChange={(e) => set("method")(e.target.value)}
                className={cn(
                  "input h-9 w-auto min-w-[9.5rem] cursor-pointer text-xs",
                  filter.method && "border-brand-400 bg-brand-50 text-brand-800",
                )}
              >
                <option value="">Method: All</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            {!def.ignoresParty && (
              <select
                value={filter.partyId}
                aria-label={report === "sellers" ? "Seller" : "Buyer"}
                onChange={(e) => set("partyId")(e.target.value)}
                className={cn(
                  "input h-9 w-auto min-w-[11rem] cursor-pointer text-xs",
                  filter.partyId && "border-brand-400 bg-brand-50 text-brand-800",
                )}
              >
                <option value="">{report === "sellers" ? "Seller: All" : "Buyer: All"}</option>
                {(partiesState.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.companyName}
                  </option>
                ))}
              </select>
            )}
          </FilterBar>
          {activeFilters > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={clearAll}>
                Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
              </Button>
              <p className="text-2xs text-faint">
                {def.ignoresCatalogue
                  ? "This report is about money and people, so the RAM filters do not apply to it."
                  : "The RAM filters narrow the catalogue rows behind this report."}
              </p>
            </div>
          )}
        </SectionCard>

        {/* ---- the report itself --------------------------------------- */}
        <div id="zeus-report" className="space-y-4">
          <SectionCard
            title={def.label}
            subtitle={`${def.blurb} - void documents are excluded from every total`}
            icon={<def.icon className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[20rem]"
          >
            {body}
          </SectionCard>

          {(report === "inventory" || report === "sales") &&
            (topMoversState.data ?? []).length > 0 && (
              <TopMovers rows={topMoversState.data ?? []} currency={currency} />
            )}
        </div>
      </div>
    </div>
  );
}

/** The filter-bar icon, kept local so the header import list stays short. */
function FilterIcon() {
  return <Receipt className="h-4 w-4" aria-hidden />;
}

/* ============================================================= top movers === */

function TopMovers({
  rows,
  currency,
}: {
  rows: { label: string; value: number; count: number }[];
  currency: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <SectionCard
      title="Top moving SKUs"
      subtitle="Ranked by units sold in the current date range"
      icon={<TrendingUp className="h-4 w-4" aria-hidden />}
      bodyClassName="p-3"
    >
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-center gap-3">
            <span
              className={cn(
                "tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-2xs font-bold",
                i === 0
                  ? "bg-brand-600 text-white"
                  : i === 1
                    ? "bg-brand-100 text-brand-700"
                    : i === 2
                      ? "bg-brand-50 text-brand-700"
                      : "bg-canvas text-faint",
              )}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs font-bold text-brand-800">
                {r.label}
              </span>
              <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-canvas">
                <span
                  className="block h-full rounded-full bg-profit-500"
                  style={{ width: `${max > 0 ? Math.max(3, (r.value / max) * 100) : 0}%` }}
                />
              </span>
            </span>
            <span className="tnum w-20 shrink-0 text-right text-xs text-muted">
              {qty(r.value)} units
            </span>
            <span className="tnum w-24 shrink-0 text-right text-xs font-bold text-profit-700">
              {money(r.count, currency)}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* ============================================================ report body === */

/**
 * Each report body knows the exact shape its own backend command returns; this
 * is the erased form they all receive, narrowed again by `useSafe` inside each
 * body. Keeping it `unknown` means a new report shape never has to be widened
 * here to satisfy the union.
 */
type AnyData = unknown;

function renderBody(
  key: ReportKey,
  data: AnyData,
  loading: boolean,
  error: string | null,
  reload: () => void,
  currency: string,
): ReactNode {
  if (loading && !data) return <LoadingState label="Building report" />;
  if (error) {
    return (
      <div className="p-4">
        <InlineError message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return <LoadingState label="Building report" />;

  switch (key) {
    case "inventory":
      return <InventoryBody data={data} currency={currency} />;
    case "purchases":
      return <PurchasesBody data={data} currency={currency} />;
    case "sales":
      return <SalesBody data={data} currency={currency} />;
    case "profit":
      return <ProfitBody data={data} currency={currency} />;
    case "buyers":
    case "sellers":
      return <BalancesBody data={data} currency={currency} kind={key} />;
    case "payments":
      return <PaymentsBody data={data} currency={currency} />;
    case "coworkers":
      return <CoworkersBody data={data} currency={currency} />;
    case "movements":
      return <MovementsBody data={data} currency={currency} />;
    case "returns":
      return <ReturnsBody data={data} currency={currency} />;
    default:
      return <LoadingState label="Building report" />;
  }
}

function useSafe<T>(data: AnyData): T {
  return data as unknown as T;
}

/* ---- 1. inventory ------------------------------------------------------- */

function InventoryBody({ data, currency }: { data: AnyData; currency: string }) {
  const navigate = useNavigate();
  const r = useSafe<{
    rows: InventoryReportRow[];
    totalSkus: number;
    totalUnits: number;
    totalCostValue: number;
    totalRetailValue: number;
    expectedProfit: number;
    lowStockCount: number;
    outOfStockCount: number;
  }>(data);

  const columns: Column<InventoryReportRow>[] = [
    {
      key: "sku",
      header: "SKU",
      width: "14rem",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-bold text-brand-800">{row.sku}</p>
          <p className="truncate text-2xs text-muted">
            {[row.generation, row.category, row.capacity, row.speed].filter(Boolean).join(" ")}
          </p>
        </div>
      ),
    },
    {
      key: "make",
      header: "Make",
      hideBelow: "lg",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-ink">{row.manufacturer || "-"}</p>
          {row.location && <p className="truncate text-2xs text-faint">{row.location}</p>}
        </div>
      ),
    },
    {
      key: "qty",
      header: "Units",
      align: "right",
      numeric: true,
      cell: (row) => (
        <span
          className={cn(
            "font-semibold",
            row.quantity <= 0
              ? "text-danger-700"
              : row.quantity <= row.minimumStock
                ? "text-warn-700"
                : "text-ink",
          )}
        >
          {qty(row.quantity)}
        </span>
      ),
    },
    {
      key: "minimum",
      header: "Min",
      align: "right",
      numeric: true,
      hideBelow: "xl",
      cell: (row) => <span className="text-muted">{qty(row.minimumStock)}</span>,
    },
    {
      key: "cost",
      header: "Avg cost",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (row) => <span className="text-muted">{money(row.averageCost, currency)}</span>,
    },
    {
      key: "value",
      header: "Stock value",
      align: "right",
      numeric: true,
      cell: (row) => <span className="font-semibold text-ink">{money(row.costValue, currency)}</span>,
    },
    {
      key: "retail",
      header: "Retail value",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => <span className="text-brand-700">{money(row.retailValue, currency)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          tone={
            row.stockStatus === "out_of_stock"
              ? "danger"
              : row.stockStatus === "low_stock"
                ? "warn"
                : "profit"
          }
        >
          {row.stockStatus === "out_of_stock"
            ? "Out of stock"
            : row.stockStatus === "low_stock"
              ? "Low stock"
              : "In stock"}
        </StatusBadge>
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Stock at cost"
          value={r.totalCostValue}
          currency={currency}
          icon={<Package className="h-4 w-4" aria-hidden />}
          tone="navy"
          hint={`${qty(r.totalUnits)} units`}
        />
        <MoneyStat
          label="Retail value"
          value={r.totalRetailValue}
          currency={currency}
          icon={<Coins className="h-4 w-4" aria-hidden />}
          tone="brand"
          hint="If every unit sold at list price"
        />
        <MoneyStat
          label="Potential profit"
          value={r.expectedProfit}
          currency={currency}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          tone="profit"
          hint="Retail value less cost value"
        />
        <StatCard
          label="SKU health"
          value={`${qty(r.totalSkus)} SKU`}
          icon={<Coins className="h-4 w-4" aria-hidden />}
          tone={r.outOfStockCount > 0 ? "danger" : r.lowStockCount > 0 ? "warn" : "profit"}
          hint={`${qty(r.lowStockCount)} low, ${qty(r.outOfStockCount)} out of stock`}
        />
      </div>
      <DataTable
        columns={columns}
        rows={r.rows}
        rowKey={(row) => row.sku}
        footer={
          r.rows.length > 0 ? (
            <tr>
              <td>Totals</td>
              <td className="hidden lg:table-cell" />
              <td className="num">{qty(r.totalUnits)}</td>
              <td className="hidden xl:table-cell" />
              <td className="hidden md:table-cell" />
              <td className="num">{money(r.totalCostValue, currency)}</td>
              <td className="num hidden lg:table-cell">{money(r.totalRetailValue, currency)}</td>
              <td />
            </tr>
          ) : undefined
        }
        empty={
          <EmptyState
            icon={<Package className="h-5 w-5" aria-hidden />}
            title="No stock matches this filter"
            message="Widen the RAM filters, or buy RAM to bring stock into the catalogue."
            action={
              <Button
                size="sm"
                variant="profit"
                onClick={() => navigate("/inventory")}
              >
                Go to Inventory
              </Button>
            }
          />
        }
      />
    </>
  );
}

/* ---- 2. purchases ------------------------------------------------------- */

function PurchasesBody({ data, currency }: { data: AnyData; currency: string }) {
  const r = useSafe<{
    rows: Purchase[];
    totalDocuments: number;
    totalUnits: number;
    subtotal: number;
    discount: number;
    total: number;
    paid: number;
    balance: number;
    voided: number;
  }>(data);

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
      cell: (p) => <span className="block max-w-[16rem] truncate text-xs text-ink">{p.sellerName}</span>,
    },
    {
      key: "units",
      header: "Units",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (p) => <span className="text-muted">{qty(p.unitCount)}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      numeric: true,
      cell: (p) => <span className="font-semibold text-ink">{money(p.total, currency)}</span>,
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (p) => <span className="text-profit-700">{money(p.paid, currency)}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      numeric: true,
      cell: (p) => (
        <span className={p.remaining > 0.005 ? "font-semibold text-warn-700" : "text-profit-700"}>
          {p.status === "void" ? "-" : money(p.remaining, currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <PaymentBadge total={p.total} settled={p.paid} voided={p.status === "void"} />
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Purchased"
          value={r.total}
          currency={currency}
          icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
          tone="warn"
          hint={`${qty(r.totalDocuments)} documents, ${qty(r.totalUnits)} units`}
        />
        <MoneyStat
          label="Discount given"
          value={r.discount}
          currency={currency}
          icon={<Percent className="h-4 w-4" aria-hidden />}
          tone="neutral"
          hint={`Subtotal was ${money(r.subtotal, currency)}`}
        />
        <MoneyStat
          label="Paid"
          value={r.paid}
          currency={currency}
          icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
          tone="profit"
          direction="up"
        />
        <MoneyStat
          label="Still owed"
          value={r.balance}
          currency={currency}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          tone={r.balance > 0.005 ? "danger" : "profit"}
          hint={r.voided > 0 ? `${qty(r.voided)} voided excluded` : "Nothing outstanding"}
        />
      </div>
      <DataTable
        columns={columns}
        rows={r.rows}
        rowKey={(p) => p.id}
        empty={
          <EmptyState
            icon={<ShoppingCart className="h-5 w-5" aria-hidden />}
            title="No purchases in this period"
            message="Pick a wider date range, or record a purchase so the report has something to summarise."
          />
        }
      />
    </>
  );
}

/* ---- 3. sales ----------------------------------------------------------- */

function SalesBody({ data, currency }: { data: AnyData; currency: string }) {
  const r = useSafe<{
    rows: Sale[];
    totalDocuments: number;
    totalUnits: number;
    subtotal: number;
    discount: number;
    total: number;
    received: number;
    outstanding: number;
    totalCost: number;
    grossProfit: number;
    averageMargin: number;
    voided: number;
  }>(data);

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
      cell: (s) => <span className="block max-w-[16rem] truncate text-xs text-ink">{s.buyerName}</span>,
    },
    {
      key: "units",
      header: "Units",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (s) => <span className="text-muted">{qty(s.unitCount)}</span>,
    },
    {
      key: "total",
      header: "Revenue",
      align: "right",
      numeric: true,
      cell: (s) => <span className="font-semibold text-ink">{money(s.total, currency)}</span>,
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      numeric: true,
      hideBelow: "xl",
      cell: (s) => <span className="text-muted">{money(s.totalCost, currency)}</span>,
    },
    {
      key: "profit",
      header: "Profit",
      align: "right",
      numeric: true,
      cell: (s) => (
        <span className={cn("font-semibold", s.grossProfit >= 0 ? "text-profit-700" : "text-danger-700")}>
          {money(s.grossProfit, currency)}
        </span>
      ),
    },
    {
      key: "margin",
      header: "Margin",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (s) => <span className="text-muted">{percent(s.profitMargin)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => <PaymentBadge total={s.total} settled={s.received} voided={s.status === "void"} />,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Revenue"
          value={r.total}
          currency={currency}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          tone="brand"
          direction="up"
          hint={`${qty(r.totalDocuments)} documents, ${qty(r.totalUnits)} units`}
        />
        <MoneyStat
          label="Gross profit"
          value={r.grossProfit}
          currency={currency}
          icon={<Coins className="h-4 w-4" aria-hidden />}
          tone="profit"
          hint={`Cost of goods ${money(r.totalCost, currency)}`}
        />
        <MoneyStat
          label="Received"
          value={r.received}
          currency={currency}
          icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
          tone="profit"
          direction="up"
          hint={`Discount given ${money(r.discount, currency)}`}
        />
        <MoneyStat
          label="Still due"
          value={r.outstanding}
          currency={currency}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          tone={r.outstanding > 0.005 ? "danger" : "profit"}
          hint={
            r.voided > 0
              ? `${qty(r.voided)} voided excluded, margin ${percent(r.averageMargin)}`
              : `Average margin ${percent(r.averageMargin)}`
          }
        />
      </div>
      <DataTable
        columns={columns}
        rows={r.rows}
        rowKey={(s) => s.id}
        empty={
          <EmptyState
            icon={<TrendingUp className="h-5 w-5" aria-hidden />}
            title="No sales in this period"
            message="Pick a wider date range, or record a sale so the report has something to summarise."
          />
        }
      />
    </>
  );
}

/* ---- 4. profit ---------------------------------------------------------- */

function ProfitBody({ data, currency }: { data: AnyData; currency: string }) {
  const r = useSafe<{
    rows: ProfitRow[];
    salesTotal: number;
    salesCost: number;
    grossProfit: number;
    purchasesTotal: number;
    netCashFlow: number;
    averageMargin: number;
    bestDay: string;
    bestDayProfit: number;
    profitByGeneration: { label: string; value: number }[];
    profitByCategory: { label: string; value: number }[];
  }>(data);

  const columns: Column<ProfitRow>[] = [
    {
      key: "period",
      header: "Period",
      width: "12rem",
      cell: (row) => (
        <span className="font-mono text-xs font-bold text-brand-800">
          {row.period.length > 10 ? displayDate(row.period) : row.period}
        </span>
      ),
    },
    {
      key: "invoiced",
      header: "Invoiced",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => <span className="text-muted">{money(row.salesTotal, currency)}</span>,
    },
    {
      key: "revenue",
      header: "Net revenue",
      align: "right",
      numeric: true,
      cell: (row) => <span className="font-semibold text-ink">{money(row.salesTotal, currency)}</span>,
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (row) => <span className="text-muted">{money(row.salesCost, currency)}</span>,
    },
    {
      key: "profit",
      header: "Gross profit",
      align: "right",
      numeric: true,
      cell: (row) => (
        <span className={cn("font-semibold", row.grossProfit >= 0 ? "text-profit-700" : "text-danger-700")}>
          {money(row.grossProfit, currency)}
        </span>
      ),
    },
    {
      key: "margin",
      header: "Margin",
      align: "right",
      numeric: true,
      cell: (row) => (
        <StatusBadge tone={row.margin >= 0 ? "profit" : "danger"}>{percent(row.margin)}</StatusBadge>
      ),
    },
    {
      key: "units",
      header: "Units",
      align: "right",
      numeric: true,
      hideBelow: "xl",
      cell: (row) => <span className="text-muted">{qty(row.unitsSold)}</span>,
    },
    {
      key: "txns",
      header: "Sales",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (row) => <span className="text-muted">{qty(row.transactions)}</span>,
    },
  ];

  const totalUnits = r.rows.reduce((a, row) => a + row.unitsSold, 0);
  const totalTxns = r.rows.reduce((a, row) => a + row.transactions, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Sales"
          value={r.salesTotal}
          currency={currency}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          tone="brand"
          direction="up"
          hint={`${qty(totalTxns)} sales, ${qty(totalUnits)} units`}
        />
        <MoneyStat
          label="Gross profit"
          value={r.grossProfit}
          currency={currency}
          icon={<Coins className="h-4 w-4" aria-hidden />}
          tone="profit"
          hint={`Cost of goods ${money(r.salesCost, currency)}`}
        />
        <MoneyStat
          label="Purchases in period"
          value={r.purchasesTotal}
          currency={currency}
          icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
          tone="warn"
          direction="down"
        />
        <MoneyStat
          label="Net cash flow"
          value={r.netCashFlow}
          currency={currency}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          tone={r.netCashFlow >= 0 ? "profit" : "danger"}
          hint={`Average margin ${percent(r.averageMargin)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 border-b border-line p-4 xl:grid-cols-3">
        <StatCard
          dense
          label="Best period"
          value={r.bestDay || "No sales yet"}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          tone="profit"
          hint={r.bestDay ? `${money(r.bestDayProfit, currency)} of profit` : "Nothing to rank"}
        />
        <SectionCard
          title="Profit by generation"
          subtitle="Which memory type earns"
          icon={<BarChart3 className="h-4 w-4" aria-hidden />}
          bodyClassName="p-3"
        >
          {r.profitByGeneration.length === 0 ? (
            <p className="py-2 text-xs text-muted">No sales in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {r.profitByGeneration.map((s) => (
                <li key={s.label} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-ink">{s.label}</span>
                  <span
                    className={cn(
                      "tnum shrink-0 font-bold",
                      s.value >= 0 ? "text-profit-700" : "text-danger-700",
                    )}
                  >
                    {money(s.value, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard
          title="Profit by category"
          subtitle="Which product line earns"
          icon={<BarChart3 className="h-4 w-4" aria-hidden />}
          bodyClassName="p-3"
        >
          {r.profitByCategory.length === 0 ? (
            <p className="py-2 text-xs text-muted">No sales in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {r.profitByCategory.map((s) => (
                <li key={s.label} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-ink">{s.label}</span>
                  <span
                    className={cn(
                      "tnum shrink-0 font-bold",
                      s.value >= 0 ? "text-profit-700" : "text-danger-700",
                    )}
                  >
                    {money(s.value, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <DataTable
        columns={columns}
        rows={r.rows}
        rowKey={(row) => row.period}
        footer={
          r.rows.length > 0 ? (
            <tr>
              <td>Totals</td>
              <td className="num hidden lg:table-cell">{money(r.salesTotal, currency)}</td>
              <td className="num">{money(r.salesTotal, currency)}</td>
              <td className="num hidden md:table-cell">{money(r.salesCost, currency)}</td>
              <td className="num">{money(r.grossProfit, currency)}</td>
              <td className="num">{percent(r.averageMargin)}</td>
              <td className="num hidden xl:table-cell">{qty(totalUnits)}</td>
              <td className="num hidden md:table-cell">{qty(totalTxns)}</td>
            </tr>
          ) : undefined
        }
        empty={
          <EmptyState
            icon={<Percent className="h-5 w-5" aria-hidden />}
            title="No sales in this period"
            message="Profit is built from sales, so widen the date range or record a sale first."
          />
        }
      />
    </>
  );
}

/* ---- 5 & 6. party balances ---------------------------------------------- */

function BalancesBody({
  data,
  currency,
  kind,
}: {
  data: AnyData;
  currency: string;
  kind: "buyers" | "sellers";
}) {
  const isBuyer = kind === "buyers";
  const r = useSafe<{
    rows: Party[];
    totalOutstanding: number;
    totalBilled: number;
    totalPaid: number;
    partyCount: number;
  }>(data);

  const columns: Column<Party>[] = [
    {
      key: "party",
      header: isBuyer ? "Buyer" : "Seller",
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">{p.companyName}</p>
          <p className="truncate text-2xs text-muted">
            {p.code}
            {p.city ? ` - ${p.city}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "docs",
      header: "Documents",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (p) => <span className="text-muted">{qty(p.transactionCount)}</span>,
    },
    {
      key: "billed",
      header: isBuyer ? "Billed" : "Invoiced to us",
      align: "right",
      numeric: true,
      cell: (p) => <span className="text-ink">{money(p.totalPurchases, currency)}</span>,
    },
    {
      key: "settled",
      header: isBuyer ? "Received" : "Paid",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (p) => (
        <span className="text-profit-700">{money(p.totalPaid, currency)}</span>
      ),
    },
    {
      key: "balance",
      header: isBuyer ? "Owes us" : "We owe",
      align: "right",
      numeric: true,
      cell: (p) => (
        <span
          className={cn(
            "font-bold",
            Math.abs(p.totalOutstanding) < 0.005
              ? "text-faint"
              : p.totalOutstanding > 0
                ? "text-warn-700"
                : "text-brand-700",
          )}
        >
          {Math.abs(p.totalOutstanding) < 0.005
            ? "Settled"
            : money(Math.abs(p.totalOutstanding), currency)}
        </span>
      ),
    },
    {
      key: "archive",
      header: "",
      hideBelow: "xl",
      cell: (p) => <ArchivedBadge archived={p.isArchived} />,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label={isBuyer ? "Owed to us" : "Owed by us"}
          value={r.totalOutstanding}
          currency={currency}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          tone={r.totalOutstanding > 0.005 ? "danger" : "profit"}
          hint={`${qty(r.partyCount)} ${isBuyer ? "buyer" : "seller"}${
            r.partyCount === 1 ? "" : "s"
          } on file`}
        />
        <MoneyStat
          label={isBuyer ? "Billed" : "Invoiced to us"}
          value={r.totalBilled}
          currency={currency}
          icon={<Receipt className="h-4 w-4" aria-hidden />}
          tone="brand"
          direction="up"
        />
        <MoneyStat
          label={isBuyer ? "Received" : "Paid"}
          value={r.totalPaid}
          currency={currency}
          icon={<Banknote className="h-4 w-4" aria-hidden />}
          tone="profit"
          direction="down"
        />
        <StatCard
          label="Settled accounts"
          value={qty(r.rows.filter((p) => Math.abs(p.totalOutstanding) < 0.005).length)}
          icon={<HandCoins className="h-4 w-4" aria-hidden />}
          tone="neutral"
          hint="Nothing outstanding on these"
        />
      </div>
      <DataTable
        columns={columns}
        rows={r.rows}
        rowKey={(p) => p.id}
        footer={
          r.rows.length > 0 ? (
            <tr>
              <td>Totals</td>
              <td className="hidden lg:table-cell" />
              <td className="num">{money(r.totalBilled, currency)}</td>
              <td className="num hidden md:table-cell">{money(r.totalPaid, currency)}</td>
              <td className="num">{money(r.totalOutstanding, currency)}</td>
              <td className="hidden xl:table-cell" />
            </tr>
          ) : undefined
        }
        empty={
          <EmptyState
            icon={isBuyer ? <Users className="h-5 w-5" aria-hidden /> : <Building2 className="h-5 w-5" aria-hidden />}
            title={`No ${isBuyer ? "buyers" : "sellers"} on file`}
            message={
              isBuyer
                ? "Add a buyer or complete a sale, and the balance report fills in."
                : "Add a seller or record a purchase, and the balance report fills in."
            }
            action={
              <Link
                to={isBuyer ? "/buyers" : "/sellers"}
                className="btn btn-secondary btn-sm"
              >
                Go to {isBuyer ? "buyers" : "sellers"}
              </Link>
            }
          />
        }
      />
    </>
  );
}

/* ---- 7. payments -------------------------------------------------------- */

function PaymentsBody({ data, currency }: { data: AnyData; currency: string }) {
  const r = useSafe<{
    rows: Payment[];
    totalReceived: number;
    totalPaid: number;
    net: number;
    paymentCount: number;
    byMethod: { label: string; value: number; count: number }[];
  }>(data);

  const columns: Column<Payment>[] = [
    {
      key: "id",
      header: "Payment",
      width: "12rem",
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-bold text-brand-800">{p.paymentId}</p>
          <p className="truncate text-2xs text-muted">{displayDate(p.paymentDate)}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (p) => <span className="text-xs text-ink">{paymentLabel(p.paymentType)}</span>,
    },
    {
      key: "person",
      header: "Person",
      cell: (p) => <span className="block max-w-[16rem] truncate text-xs text-ink">{p.personName}</span>,
    },
    {
      key: "method",
      header: "Method",
      hideBelow: "md",
      cell: (p) => <span className="text-xs text-muted">{p.paymentMethod}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      numeric: true,
      cell: (p) => (
        <span className="font-bold text-ink">
          {p.status === "void" ? "-" : money(p.amount, currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "lg",
      cell: (p) => (
        <StatusBadge tone={p.status === "void" ? "neutral" : "info"}>
          {p.status === "void" ? "Reversed" : "Completed"}
        </StatusBadge>
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Received"
          value={r.totalReceived}
          currency={currency}
          icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
          tone="profit"
          direction="up"
          hint={`${qty(r.paymentCount)} payments`}
        />
        <MoneyStat
          label="Paid out"
          value={r.totalPaid}
          currency={currency}
          icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
          tone="brand"
          direction="down"
        />
        <MoneyStat
          label="Net"
          value={r.net}
          currency={currency}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          tone={r.net >= 0 ? "profit" : "danger"}
        />
        <StatCard
          label="Methods used"
          value={qty(r.byMethod.length)}
          icon={<Banknote className="h-4 w-4" aria-hidden />}
          tone="navy"
          hint={r.byMethod[0] ? `Most used: ${r.byMethod[0].label}` : "No payments yet"}
        />
      </div>
      {r.byMethod.length > 0 && (
        <div className="grid grid-cols-2 gap-2 border-b border-line p-4 sm:grid-cols-3 lg:grid-cols-5">
          {r.byMethod.map((m) => (
            <StatCard
              key={m.label}
              dense
              label={m.label}
              value={money(m.value, currency)}
              tone="neutral"
              hint={`${qty(m.count)} payment${m.count === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      )}
      <DataTable
        columns={columns}
        rows={r.rows}
        rowKey={(p) => p.id}
        empty={
          <EmptyState
            icon={<Banknote className="h-5 w-5" aria-hidden />}
            title="No payments in this period"
            message="Receive a payment from a buyer or pay a supplier and the report fills in."
          />
        }
      />
    </>
  );
}

/* ---- 8. coworkers ------------------------------------------------------- */

function CoworkersBody({ data, currency }: { data: AnyData; currency: string }) {
  const r = useSafe<{
    rows: Coworker[];
    transactions: CoworkerTransaction[];
    receivable: number;
    payable: number;
    net: number;
  }>(data);

  const columns: Column<Coworker>[] = [
    {
      key: "name",
      header: "Coworker",
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">{c.name}</p>
          {c.phone && <p className="truncate text-2xs text-muted">{c.phone}</p>}
        </div>
      ),
    },
    {
      key: "lent",
      header: "Lent",
      align: "right",
      numeric: true,
      cell: (c) => <span className="text-warn-700">{money(c.totalLent, currency)}</span>,
    },
    {
      key: "borrowed",
      header: "Borrowed",
      align: "right",
      numeric: true,
      hideBelow: "sm",
      cell: (c) => <span className="text-brand-700">{money(c.totalBorrowed, currency)}</span>,
    },
    {
      key: "repaid",
      header: "Repaid",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (c) => <span className="text-profit-700">{money(c.totalRepaid, currency)}</span>,
    },
    {
      key: "entries",
      header: "Entries",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (c) => <span className="text-muted">{qty(c.transactionCount)}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      numeric: true,
      cell: (c) => (
        <span
          className={cn(
            "font-bold",
            Math.abs(c.currentBalance) < 0.005
              ? "text-faint"
              : c.currentBalance > 0
                ? "text-warn-700"
                : "text-brand-700",
          )}
        >
          {Math.abs(c.currentBalance) < 0.005
            ? "Settled"
            : money(Math.abs(c.currentBalance), currency)}
        </span>
      ),
    },
  ];

  const txnColumns: Column<CoworkerTransaction>[] = [
    {
      key: "date",
      header: "Date",
      width: "9rem",
      cell: (t) => (
        <span className="whitespace-nowrap text-xs text-muted">{displayDate(t.txnDate)}</span>
      ),
    },
    {
      key: "who",
      header: "Coworker",
      cell: (t) => <span className="text-xs text-ink">{t.coworkerName}</span>,
    },
    {
      key: "kind",
      header: "Entry",
      cell: (t) => (
        <StatusBadge tone={t.kind === "LEND" ? "warn" : t.kind === "BORROW" ? "brand" : "profit"}>
          {coworkerLabel(t.kind)}
        </StatusBadge>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      hideBelow: "md",
      cell: (t) => (
        <span className="block max-w-[20rem] truncate text-xs text-muted">{t.notes || "-"}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      numeric: true,
      cell: (t) => <span className="font-semibold text-ink">{money(t.amount, currency)}</span>,
    },
    {
      key: "after",
      header: "Balance after",
      align: "right",
      numeric: true,
      cell: (t) => (
        <span className="font-semibold text-muted">{money(t.balanceAfter, currency)}</span>
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Owed to ZEUS"
          value={r.receivable}
          currency={currency}
          icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
          tone="warn"
        />
        <MoneyStat
          label="Owed by ZEUS"
          value={r.payable}
          currency={currency}
          icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
          tone="brand"
        />
        <MoneyStat
          label="Net"
          value={r.net}
          currency={currency}
          icon={<HandCoins className="h-4 w-4" aria-hidden />}
          tone={r.net >= 0 ? "profit" : "danger"}
        />
        <StatCard
          label="Coworkers"
          value={qty(r.rows.length)}
          icon={<UsersRound className="h-4 w-4" aria-hidden />}
          tone="navy"
          hint={`${qty(r.transactions.length)} entries in this period`}
        />
      </div>

      <div className="border-b border-line">
        <p className="px-4 pt-3 text-2xs font-bold tracking-wider text-muted uppercase">
          Balances by coworker
        </p>
        <DataTable
          columns={columns}
          rows={r.rows}
          rowKey={(c) => c.id}
          footer={
            r.rows.length > 0 ? (
              <tr>
                <td>Totals</td>
                <td className="num">
                  {money(r.rows.reduce((a, c) => a + c.totalLent, 0), currency)}
                </td>
                <td className="num hidden sm:table-cell">
                  {money(r.rows.reduce((a, c) => a + c.totalBorrowed, 0), currency)}
                </td>
                <td className="num hidden md:table-cell">
                  {money(r.rows.reduce((a, c) => a + c.totalRepaid, 0), currency)}
                </td>
                <td className="hidden lg:table-cell" />
                <td className="num">{money(r.net, currency)}</td>
              </tr>
            ) : undefined
          }
          empty={
            <EmptyState
              compact
              icon={<UsersRound className="h-5 w-5" aria-hidden />}
              title="No coworkers on the books"
              message="Add one from the Coworker Ledger and this report fills in."
              action={
                <Link to="/coworker-ledger" className="btn btn-secondary btn-sm">
                  Go to the ledger
                </Link>
              }
            />
          }
        />
      </div>

      <div>
        <p className="px-4 pt-3 text-2xs font-bold tracking-wider text-muted uppercase">
          Entries in the selected period
        </p>
        <DataTable
          columns={txnColumns}
          rows={r.transactions.slice(0, 200)}
          rowKey={(t) => t.id}
          empty={
            <EmptyState
              compact
              icon={<HandCoins className="h-5 w-5" aria-hidden />}
              title="No entries in this period"
              message="Lend, borrow or record a repayment and it appears here."
            />
          }
        />
        {r.transactions.length > 200 && (
          <p className="border-t border-line px-4 py-2.5 text-2xs text-faint">
            Showing the 200 most recent of {qty(r.transactions.length)} entries. Export for the
            complete history.
          </p>
        )}
      </div>
    </>
  );
}

/* ---- 9. stock movements ------------------------------------------------- */

function MovementsBody({ data, currency }: { data: AnyData; currency: string }) {
  const r = useSafe<{
    rows: StockMovement[];
    totalIn: number;
    totalOut: number;
    netChange: number;
    movementCount: number;
    byType: { label: string; value: number; count: number }[];
  }>(data);

  const columns: Column<StockMovement>[] = [
    {
      key: "when",
      header: "When",
      width: "9rem",
      cell: (m) => (
        <span className="whitespace-nowrap text-xs text-muted">{relativeDay(m.createdAt)}</span>
      ),
    },
    {
      key: "sku",
      header: "Item",
      width: "14rem",
      cell: (m) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-bold text-brand-800">{m.sku}</p>
          {m.referenceNumber && (
            <p className="truncate font-mono text-2xs text-muted">{m.referenceNumber}</p>
          )}
        </div>
      ),
    },
    {
      key: "type",
      header: "Cause",
      cell: (m) => (
        <StatusBadge tone={m.quantityChange >= 0 ? "profit" : "danger"}>
          {movementLabel(m.movementType)}
        </StatusBadge>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      hideBelow: "xl",
      cell: (m) => (
        <span className="block max-w-[18rem] truncate text-xs text-muted">{m.notes || "-"}</span>
      ),
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      numeric: true,
      cell: (m) => (
        <span className={cn("font-bold", m.quantityChange >= 0 ? "text-profit-700" : "text-danger-700")}>
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
          {qty(m.previousStock)} &rarr; <span className="font-bold text-ink">{qty(m.newStock)}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Units in"
          value={r.totalIn}
          currency={currency}
          icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
          tone="profit"
          direction="up"
        />
        <MoneyStat
          label="Units out"
          value={r.totalOut}
          currency={currency}
          icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
          tone="danger"
          direction="down"
        />
        <StatCard
          label="Net change"
          value={`${r.netChange >= 0 ? "+" : ""}${qty(r.netChange)}`}
          icon={<Coins className="h-4 w-4" aria-hidden />}
          tone={r.netChange >= 0 ? "profit" : "danger"}
          hint="Units added less units removed"
        />
        <StatCard
          label="Movements"
          value={qty(r.movementCount)}
          icon={<ArrowRight className="h-4 w-4" aria-hidden />}
          tone="navy"
          hint={`${qty(r.byType.length)} distinct causes`}
        />
      </div>
      {r.byType.length > 0 && (
        <div className="grid grid-cols-2 gap-2 border-b border-line p-4 sm:grid-cols-3 lg:grid-cols-5">
          {r.byType.map((t) => (
            <StatCard
              key={t.label}
              dense
              label={movementLabel(t.label)}
              value={`${qty(t.value)} units`}
              tone={t.value >= 0 ? "profit" : "danger"}
              hint={`${qty(t.count)} movement${t.count === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      )}
      <DataTable
        columns={columns}
        rows={r.rows.slice(0, 300)}
        rowKey={(m) => m.id}
        empty={
          <EmptyState
            icon={<Coins className="h-5 w-5" aria-hidden />}
            title="No stock movements in this period"
            message="Buying, selling, returning or adjusting stock all produce movements that land here."
          />
        }
      />
      {r.rows.length > 300 && (
        <p className="border-t border-line px-4 py-2.5 text-2xs text-faint">
          Showing the 300 most recent of {qty(r.rows.length)} movements. Export for the complete
          history.
        </p>
      )}
    </>
  );
}

/* ---- 10. returns -------------------------------------------------------- */

function ReturnsBody({ data, currency }: { data: AnyData; currency: string }) {
  const r = useSafe<{
    rows: ReturnDocRow[];
    totalSkus: number;
    totalUnits: number;
    totalCostValue: number;
    totalRetailValue: number;
  }>(data);

  const columns: Column<ReturnDocRow>[] = [
    {
      key: "number",
      header: "Return",
      width: "12rem",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-bold text-brand-800">{row.sku}</p>
          <p className="truncate text-2xs text-muted">{row.generation}</p>
        </div>
      ),
    },
    {
      key: "party",
      header: "Party",
      cell: (row) => (
        <span className="block max-w-[16rem] truncate text-xs text-ink">{row.category}</span>
      ),
    },
    {
      key: "units",
      header: "Units",
      align: "right",
      numeric: true,
      cell: (row) => <span className="font-semibold text-ink">{qty(row.quantity)}</span>,
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      numeric: true,
      cell: (row) => <span className="text-ink">{money(row.costValue, currency)}</span>,
    },
    {
      key: "refund",
      header: "Net after refund",
      align: "right",
      numeric: true,
      cell: (row) => <span className="text-profit-700">{money(row.retailValue, currency)}</span>,
    },
    {
      key: "direction",
      header: "Direction",
      hideBelow: "md",
      cell: (row) => (
        <StatusBadge tone={row.generation.includes("PURCHASE") ? "brand" : "warn"}>
          {row.generation.includes("PURCHASE") ? "Back to supplier" : "From buyer"}
        </StatusBadge>
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 xl:grid-cols-4">
        <MoneyStat
          label="Return documents"
          value={r.totalSkus}
          currency={currency}
          icon={<RotateCcw className="h-4 w-4" aria-hidden />}
          tone="navy"
          hint={`${qty(r.totalUnits)} units returned`}
        />
        <MoneyStat
          label="Value returned"
          value={r.totalCostValue}
          currency={currency}
          icon={<Package className="h-4 w-4" aria-hidden />}
          tone="warn"
          direction="down"
          hint="At the price of the original document"
        />
        <MoneyStat
          label="Net settled"
          value={r.totalRetailValue}
          currency={currency}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          tone="profit"
          hint="Value less any refund paid"
        />
        <StatCard
          label="Average size"
          value={
            r.totalSkus > 0 ? `${qty(Math.round(r.totalUnits / r.totalSkus))} units` : "0 units"
          }
          icon={<Coins className="h-4 w-4" aria-hidden />}
          tone="neutral"
          hint="Units per return document"
        />
      </div>
      <DataTable
        columns={columns}
        rows={r.rows}
        rowKey={(row, i) => `${row.sku}-${i}`}
        footer={
          r.rows.length > 0 ? (
            <tr>
              <td>Totals</td>
              <td />
              <td className="num">{qty(r.totalUnits)}</td>
              <td className="num">{money(r.totalCostValue, currency)}</td>
              <td className="num">{money(r.totalRetailValue, currency)}</td>
              <td className="hidden md:table-cell" />
            </tr>
          ) : undefined
        }
        empty={
          <EmptyState
            icon={<RotateCcw className="h-5 w-5" aria-hidden />}
            title="No returns in this period"
            message="When a buyer sends stock back or you send stock back to a supplier, the return document lands here."
          />
        }
      />
    </>
  );
}

/** `reports::returns` reuses the inventory row shape with repurposed fields. */
interface ReturnDocRow {
  sku: string;
  generation: string;
  category: string;
  quantity: number;
  costValue: number;
  retailValue: number;
}

/* ============================================================== exporters === */

/* eslint-disable @typescript-eslint/no-explicit-any */
function exportFor(
  key: ReportKey,
  data: AnyData,
  currency: string,
  filter: ReportFilter,
): ExportOptions<any> {
  const range =
    filter.from || filter.to
      ? `${filter.from || "the beginning"} to ${filter.to || "today"}`
      : "all dates";
  const base = {
    filename: `zeus-report-${key}`,
    subtitle: `Filter: ${range}`,
  };

  switch (key) {
    case "inventory": {
      const r = (data ?? { rows: [] as InventoryReportRow[], totalUnits: 0, totalCostValue: 0, totalRetailValue: 0, expectedProfit: 0 }) as {
        rows: InventoryReportRow[];
        totalUnits: number;
        totalCostValue: number;
        totalRetailValue: number;
        expectedProfit: number;
      };
      return {
        ...base,
        title: "Inventory valuation",
        meta: [
          { label: "SKUs", value: String(r.rows.length) },
          { label: "Units", value: qty(r.totalUnits) },
          { label: "At cost", value: money(r.totalCostValue, currency) },
          { label: "At retail", value: money(r.totalRetailValue, currency) },
          { label: "Potential profit", value: money(r.expectedProfit, currency) },
        ],
        columns: [
          { header: "SKU", value: (x: InventoryReportRow) => x.sku },
          { header: "Generation", value: (x: InventoryReportRow) => x.generation },
          { header: "Category", value: (x: InventoryReportRow) => x.category },
          { header: "Capacity", value: (x: InventoryReportRow) => x.capacity },
          { header: "Speed", value: (x: InventoryReportRow) => x.speed },
          { header: "Manufacturer", value: (x: InventoryReportRow) => x.manufacturer || "" },
          { header: "Location", value: (x: InventoryReportRow) => x.location || "" },
          { header: "Units", value: (x: InventoryReportRow) => x.quantity, numeric: true },
          { header: "Minimum", value: (x: InventoryReportRow) => x.minimumStock, numeric: true },
          { header: "Avg cost", value: (x: InventoryReportRow) => x.averageCost, numeric: true },
          { header: "Sell price", value: (x: InventoryReportRow) => x.sellingPrice, numeric: true },
          { header: "Stock value", value: (x: InventoryReportRow) => x.costValue, numeric: true },
          { header: "Retail value", value: (x: InventoryReportRow) => x.retailValue, numeric: true },
        ],
        rows: r.rows,
      };
    }
    case "purchases": {
      const r = data as {
        rows: Purchase[];
        total: number;
        paid: number;
        balance: number;
        totalUnits: number;
      };
      return {
        ...base,
        title: "Purchases report",
        meta: [
          { label: "Documents", value: String(r.rows.length) },
          { label: "Units", value: qty(r.totalUnits) },
          { label: "Total", value: money(r.total, currency) },
          { label: "Paid", value: money(r.paid, currency) },
          { label: "Balance", value: money(r.balance, currency) },
        ],
        columns: [
          { header: "Purchase", value: (x: Purchase) => x.purchaseNumber },
          { header: "Date", value: (x: Purchase) => x.purchaseDate },
          { header: "Seller", value: (x: Purchase) => x.sellerName },
          { header: "Units", value: (x: Purchase) => x.unitCount, numeric: true },
          { header: "Subtotal", value: (x: Purchase) => x.subtotal, numeric: true },
          { header: "Discount", value: (x: Purchase) => x.discount, numeric: true },
          { header: "Total", value: (x: Purchase) => x.total, numeric: true },
          { header: "Paid", value: (x: Purchase) => x.paid, numeric: true },
          { header: "Balance", value: (x: Purchase) => x.remaining, numeric: true },
          { header: "Status", value: (x: Purchase) => x.status },
        ],
        rows: r.rows,
      };
    }
    case "sales": {
      const r = data as {
        rows: Sale[];
        total: number;
        received: number;
        outstanding: number;
        totalCost: number;
        grossProfit: number;
      };
      return {
        ...base,
        title: "Sales report",
        meta: [
          { label: "Documents", value: String(r.rows.length) },
          { label: "Revenue", value: money(r.total, currency) },
          { label: "Cost", value: money(r.totalCost, currency) },
          { label: "Gross profit", value: money(r.grossProfit, currency) },
          { label: "Received", value: money(r.received, currency) },
          { label: "Outstanding", value: money(r.outstanding, currency) },
        ],
        columns: [
          { header: "Sale", value: (x: Sale) => x.saleNumber },
          { header: "Date", value: (x: Sale) => x.saleDate },
          { header: "Buyer", value: (x: Sale) => x.buyerName },
          { header: "Units", value: (x: Sale) => x.unitCount, numeric: true },
          { header: "Subtotal", value: (x: Sale) => x.subtotal, numeric: true },
          { header: "Discount", value: (x: Sale) => x.discount, numeric: true },
          { header: "Total", value: (x: Sale) => x.total, numeric: true },
          { header: "Cost", value: (x: Sale) => x.totalCost, numeric: true },
          { header: "Gross profit", value: (x: Sale) => x.grossProfit, numeric: true },
          { header: "Margin %", value: (x: Sale) => x.profitMargin, numeric: true },
          { header: "Received", value: (x: Sale) => x.received, numeric: true },
          { header: "Balance", value: (x: Sale) => x.remaining, numeric: true },
          { header: "Status", value: (x: Sale) => x.status },
        ],
        rows: r.rows,
      };
    }
    case "profit": {
      const r = data as {
        rows: ProfitRow[];
        salesTotal: number;
        salesCost: number;
        grossProfit: number;
        purchasesTotal: number;
        netCashFlow: number;
        averageMargin: number;
      };
      return {
        ...base,
        title: "Profit and margin report",
        meta: [
          { label: "Sales", value: money(r.salesTotal, currency) },
          { label: "Cost", value: money(r.salesCost, currency) },
          { label: "Gross profit", value: money(r.grossProfit, currency) },
          { label: "Average margin", value: percent(r.averageMargin) },
          { label: "Purchases", value: money(r.purchasesTotal, currency) },
          { label: "Net cash flow", value: money(r.netCashFlow, currency) },
        ],
        columns: [
          { header: "Period", value: (x: ProfitRow) => x.period },
          { header: "Net revenue", value: (x: ProfitRow) => x.salesTotal, numeric: true },
          { header: "Cost", value: (x: ProfitRow) => x.salesCost, numeric: true },
          { header: "Gross profit", value: (x: ProfitRow) => x.grossProfit, numeric: true },
          { header: "Margin %", value: (x: ProfitRow) => x.margin, numeric: true },
          { header: "Units sold", value: (x: ProfitRow) => x.unitsSold, numeric: true },
          { header: "Sales", value: (x: ProfitRow) => x.transactions, numeric: true },
        ],
        rows: r.rows,
      };
    }
    case "buyers":
    case "sellers": {
      const r = data as {
        rows: Party[];
        totalOutstanding: number;
        totalBilled: number;
        totalPaid: number;
      };
      const label = key === "buyers" ? "Buyer" : "Seller";
      return {
        ...base,
        title: `${label} balances report`,
        meta: [
          { label: `${label}s`, value: String(r.rows.length) },
          { label: "Billed", value: money(r.totalBilled, currency) },
          { label: key === "buyers" ? "Received" : "Paid", value: money(r.totalPaid, currency) },
          { label: "Outstanding", value: money(r.totalOutstanding, currency) },
        ],
        columns: [
          { header: "Code", value: (x: Party) => x.code },
          { header: label, value: (x: Party) => x.companyName },
          { header: "City", value: (x: Party) => x.city || "" },
          { header: "Phone", value: (x: Party) => x.phone || "" },
          { header: "Documents", value: (x: Party) => x.transactionCount, numeric: true },
          { header: "Billed", value: (x: Party) => x.totalPurchases, numeric: true },
          { header: key === "buyers" ? "Received" : "Paid", value: (x: Party) => x.totalPaid, numeric: true },
          { header: "Outstanding", value: (x: Party) => x.totalOutstanding, numeric: true },
        ],
        rows: r.rows,
      };
    }
    case "payments": {
      const r = data as {
        rows: Payment[];
        totalReceived: number;
        totalPaid: number;
        net: number;
      };
      return {
        ...base,
        title: "Payments report",
        meta: [
          { label: "Payments", value: String(r.rows.length) },
          { label: "Received", value: money(r.totalReceived, currency) },
          { label: "Paid", value: money(r.totalPaid, currency) },
          { label: "Net", value: money(r.net, currency) },
        ],
        columns: [
          { header: "Payment", value: (x: Payment) => x.paymentId },
          { header: "Date", value: (x: Payment) => x.paymentDate },
          { header: "Type", value: (x: Payment) => paymentLabel(x.paymentType) },
          { header: "Person type", value: (x: Payment) => x.personType },
          { header: "Person", value: (x: Payment) => x.personName },
          { header: "Method", value: (x: Payment) => x.paymentMethod },
          { header: "Amount", value: (x: Payment) => x.amount, numeric: true },
          { header: "Reference", value: (x: Payment) => x.reference || "" },
          { header: "Status", value: (x: Payment) => x.status },
        ],
        rows: r.rows,
      };
    }
    case "coworkers": {
      const r = data as {
        rows: Coworker[];
        transactions: CoworkerTransaction[];
        receivable: number;
        payable: number;
      };
      return {
        ...base,
        title: "Coworker ledger report",
        meta: [
          { label: "Coworkers", value: String(r.rows.length) },
          { label: "Owed to ZEUS", value: money(r.receivable, currency) },
          { label: "Owed by ZEUS", value: money(r.payable, currency) },
          { label: "Entries", value: String(r.transactions.length) },
        ],
        columns: [
          { header: "Date", value: (x: CoworkerTransaction) => x.txnDate },
          { header: "Coworker", value: (x: CoworkerTransaction) => x.coworkerName },
          { header: "Entry", value: (x: CoworkerTransaction) => coworkerLabel(x.kind) },
          { header: "Amount", value: (x: CoworkerTransaction) => x.amount, numeric: true },
          { header: "Balance after", value: (x: CoworkerTransaction) => x.balanceAfter, numeric: true },
          { header: "Method", value: (x: CoworkerTransaction) => x.method || "" },
          { header: "Notes", value: (x: CoworkerTransaction) => x.notes || "" },
        ],
        rows: r.transactions,
      };
    }
    case "movements": {
      const r = data as {
        rows: StockMovement[];
        totalIn: number;
        totalOut: number;
        netChange: number;
      };
      return {
        ...base,
        title: "Stock movement report",
        meta: [
          { label: "Movements", value: String(r.rows.length) },
          { label: "Units in", value: qty(r.totalIn) },
          { label: "Units out", value: qty(r.totalOut) },
          { label: "Net change", value: qty(r.netChange) },
        ],
        columns: [
          { header: "When", value: (x: StockMovement) => x.createdAt },
          { header: "SKU", value: (x: StockMovement) => x.sku },
          { header: "Movement", value: (x: StockMovement) => movementLabel(x.movementType) },
          { header: "Reference", value: (x: StockMovement) => x.referenceNumber || "" },
          { header: "Change", value: (x: StockMovement) => x.quantityChange, numeric: true },
          { header: "Previous stock", value: (x: StockMovement) => x.previousStock, numeric: true },
          { header: "New stock", value: (x: StockMovement) => x.newStock, numeric: true },
          { header: "Notes", value: (x: StockMovement) => x.notes || "" },
        ],
        rows: r.rows,
      };
    }
    case "returns": {
      const r = data as {
        rows: ReturnDocRow[];
        totalUnits: number;
        totalCostValue: number;
        totalRetailValue: number;
      };
      return {
        ...base,
        title: "Returns report",
        meta: [
          { label: "Return documents", value: String(r.rows.length) },
          { label: "Units", value: qty(r.totalUnits) },
          { label: "Value", value: money(r.totalCostValue, currency) },
          { label: "Net settled", value: money(r.totalRetailValue, currency) },
        ],
        columns: [
          { header: "Return", value: (x: ReturnDocRow) => x.sku },
          { header: "Type", value: (x: ReturnDocRow) => x.generation },
          { header: "Party", value: (x: ReturnDocRow) => x.category },
          { header: "Units", value: (x: ReturnDocRow) => x.quantity, numeric: true },
          { header: "Value", value: (x: ReturnDocRow) => x.costValue, numeric: true },
          { header: "Net after refund", value: (x: ReturnDocRow) => x.retailValue, numeric: true },
        ],
        rows: r.rows,
      };
    }
    default:
      return { ...base, title: "Report", columns: [], rows: [] };
  }
}