import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Boxes,
  Eye,
  FileSpreadsheet,
  FileText,
  Layers,
  Package,
  Pencil,
  PlusCircle,
  Printer,
  SlidersHorizontal,
  Tag,
  TriangleAlert,
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
import { cn, money, percent, qty, skuSummary } from "../lib/format";
import { useAsync, useDebounced, usePage } from "../lib/useAsync";
import { mergeValues, speedsFor, useReferenceData } from "../lib/reference-data";
import { CAPACITIES, CONDITIONS, INVENTORY_SORTS, STOCK_STATUS_FILTERS } from "../lib/constants";
import type { RamItem } from "../lib/types";
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  IconButton,
  InlineError,
  Pagination,
  PageHeader,
  ReasonDialog,
  SearchInput,
  SectionCard,
  SkeletonTable,
  StatCard,
  StatusBadge,
  StockBadge,
  usePagedRows,
  useToast,
  type Column,
} from "../components/ui";
import { RamItemDialog, StockAdjustDialog } from "../components/transactions";
import { LabelledSelect } from "../components/shared";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";

/* ===========================================================================
   Inventory
   ---------------------------------------------------------------------------
   The catalogue. Everything needed to answer "what do I hold, what is it
   worth, and what must I reorder" in one screen: nine filters, a sortable
   table, and per-row View / Edit / Adjust Stock / Archive.
   =========================================================================== */

interface Filters {
  search: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  manufacturer: string;
  condition: string;
  location: string;
  status: string;
  sort: string;
  archived: boolean;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  generation: "",
  category: "",
  capacity: "",
  speed: "",
  manufacturer: "",
  condition: "",
  location: "",
  status: "",
  sort: "sku_asc",
  archived: false,
};

const PAGE_SIZE = 25;

function stockLabel(item: RamItem): string {
  if (item.quantity <= 0) return "Out of stock";
  if (item.quantity <= item.minimumStock) return "Low stock";
  return "In stock";
}

export default function Inventory() {
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { cloud, profile } = useAuth();
  const { syncNow } = useSync();
  // In cloud mode the catalogue is authoritative on the server and only an
  // administrator can change/archive/adjust it. Sales reps keep read + request
  // workflows; the RPC also enforces this server-side.
  const canMutateCatalog = !cloud || isAdmin(profile);

  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    search: params.get("q") ?? "",
    generation: params.get("generation") ?? "",
    category: params.get("category") ?? "",
    status: params.get("status") ?? "",
  }));
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showFilters, setShowFilters] = useState(false);

  const [itemDialog, setItemDialog] = useState<{ open: boolean; editing: RamItem | null }>({
    open: false,
    editing: null,
  });
  const [adjust, setAdjust] = useState<{
    open: boolean;
    item: RamItem | null;
    direction: "INCREASE" | "DECREASE";
  }>({ open: false, item: null, direction: "INCREASE" });
  const [archive, setArchive] = useState<{ open: boolean; item: RamItem | null }>({
    open: false,
    item: null,
  });
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const refs = useReferenceData();
  const debouncedSearch = useDebounced(filters.search, 220);

  const state = useAsync(
    () =>
      api.listRamItems({
        search: debouncedSearch,
        generation: filters.generation,
        category: filters.category,
        capacity: filters.capacity,
        speed: filters.speed,
        manufacturer: filters.manufacturer,
        condition: filters.condition,
        location: filters.location,
        stockStatus: filters.status,
        includeArchived: filters.archived,
        sort: filters.sort,
      }),
    [
      debouncedSearch,
      filters.generation,
      filters.category,
      filters.capacity,
      filters.speed,
      filters.manufacturer,
      filters.condition,
      filters.location,
      filters.status,
      filters.sort,
      filters.archived,
      refs.loading,
    ],
  );

  const items = state.data ?? [];
  const [page, setPage, pages] = usePage(items, pageSize);
  const visible = usePagedRows(items, pageSize, page);

  /* ---- aggregates over the whole filtered set -------------------------- */
  const totals = useMemo(() => {
    let units = 0;
    let cost = 0;
    let retail = 0;
    let low = 0;
    let out = 0;
    items.forEach((i) => {
      units += i.quantity;
      cost += i.inventoryValue;
      retail += i.retailValue;
      if (i.quantity <= 0) out += 1;
      else if (i.quantity <= i.minimumStock) low += 1;
    });
    return { units, cost, retail, low, out, skus: items.length };
  }, [items]);

  const generationOptions = useMemo(
    () => mergeValues([], refs.usedGenerations, ["DDR3", "DDR4", "DDR5"]),
    [refs.usedGenerations],
  );
  const categoryOptions = useMemo(
    () => mergeValues(refs.named.categories, refs.usedCategories),
    [refs.named.categories, refs.usedCategories],
  );
  const capacityOptions = useMemo(
    () => mergeValues([], refs.usedCapacities, CAPACITIES),
    [refs.usedCapacities],
  );
  const speedOptions = useMemo(
    () => speedsFor(refs.speeds, filters.generation, refs.usedSpeeds),
    [refs.speeds, refs.usedSpeeds, filters.generation],
  );
  const manufacturerOptions = useMemo(
    () => mergeValues(refs.named.manufacturers, refs.usedManufacturers),
    [refs.named.manufacturers, refs.usedManufacturers],
  );
  const conditionOptions = useMemo(
    () => mergeValues(refs.named.conditions, refs.usedConditions, CONDITIONS),
    [refs.named.conditions, refs.usedConditions],
  );
  const locationOptions = useMemo(
    () => mergeValues(refs.named.locations, refs.usedLocations),
    [refs.named.locations, refs.usedLocations],
  );

  const set =
    (key: keyof Filters) =>
    (value: string): void =>
      setFilters((f) => ({ ...f, [key]: value === "all" ? "" : value }));

  const clearAll = () => setFilters(EMPTY_FILTERS);
  const activeCount = Object.entries(filters).filter(
    ([k, v]) => k !== "sort" && k !== "archived" && Boolean(v),
  ).length;

  /* ---- export payload -------------------------------------------------- */
  const exportColumns: ExportColumn<RamItem>[] = [
    { header: "SKU", value: (i) => i.sku },
    { header: "Description", value: (i) => skuSummary(i) },
    { header: "Manufacturer", value: (i) => i.manufacturer || "" },
    { header: "Part number", value: (i) => i.partNumber || "" },
    { header: "Condition", value: (i) => i.condition || "" },
    { header: "Location", value: (i) => i.location || "" },
    { header: "In stock", value: (i) => i.quantity, numeric: true },
    { header: "Reorder at", value: (i) => i.minimumStock, numeric: true },
    { header: "Avg cost", value: (i) => i.averageCost, numeric: true },
    { header: "Selling price", value: (i) => i.sellingPrice, numeric: true },
    { header: "Stock value", value: (i) => i.inventoryValue, numeric: true },
    { header: "Status", value: (i) => stockLabel(i) },
  ];

  const exportOpts = () => ({
    filename: "zeus-inventory",
    title: "Inventory valuation",
    subtitle: `${qty(totals.skus)} SKUs - ${qty(totals.units)} units`,
    meta: [
      { label: "Stock at cost", value: money(totals.cost, currency) },
      { label: "Retail value", value: money(totals.retail, currency) },
      { label: "Low stock", value: qty(totals.low) },
      { label: "Out of stock", value: qty(totals.out) },
    ],
    columns: exportColumns,
    rows: items,
  });

  const columns = useMemo<Column<RamItem>[]>(
    () => [
      {
        key: "sku",
        header: "SKU / Description",
        width: "17rem",
        cell: (i) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-bold text-brand-800">{i.sku}</p>
            <p className="truncate text-2xs text-muted">{skuSummary(i)}</p>
          </div>
        ),
      },
      {
        key: "manufacturer",
        header: "Maker",
        cell: (i) => (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ink">{i.manufacturer || "-"}</p>
            <p className="truncate text-2xs text-faint">{i.partNumber || i.model || ""}</p>
          </div>
        ),
        hideBelow: "lg",
      },
      {
        key: "quantity",
        header: "In stock",
        align: "right",
        numeric: true,
        cell: (i) => (
          <div>
            <p className="font-bold text-ink">{qty(i.quantity)}</p>
            <p className="text-2xs text-faint">min {qty(i.minimumStock)}</p>
          </div>
        ),
      },
      {
        key: "avg",
        header: "Avg cost",
        align: "right",
        numeric: true,
        hideBelow: "md",
        cell: (i) => <span className="text-muted">{money(i.averageCost, currency)}</span>,
      },
      {
        key: "sell",
        header: "Sell price",
        align: "right",
        numeric: true,
        hideBelow: "lg",
        cell: (i) => <span className="text-ink">{money(i.sellingPrice, currency)}</span>,
      },
      {
        key: "value",
        header: "Stock value",
        align: "right",
        numeric: true,
        cell: (i) => (
          <span className="font-semibold text-ink">{money(i.inventoryValue, currency)}</span>
        ),
      },
      {
        key: "location",
        header: "Location",
        cell: (i) => <span className="text-xs text-muted">{i.location || "-"}</span>,
        hideBelow: "xl",
      },
      {
        key: "status",
        header: "Status",
        cell: (i) => (
          <div className="flex flex-col items-start gap-1">
            <StockBadge quantity={i.quantity} minimum={i.minimumStock} />
            {i.isArchived && <StatusBadge tone="neutral">Archived</StatusBadge>}
          </div>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "9rem",
        cell: (i) => (
          <div
            className="flex items-center justify-end gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <IconButton
              label={`View ${i.sku}`}
              tone="brand"
              onClick={() => navigate(`/inventory/${i.id}`)}
            >
              <Eye className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              label={`Edit ${i.sku}`}
              tone="brand"
              disabled={!canMutateCatalog}
              title={canMutateCatalog ? undefined : "Only administrators can edit the catalogue"}
              onClick={() => setItemDialog({ open: true, editing: i })}
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              label={`Adjust stock for ${i.sku}`}
              tone="warn"
              disabled={!canMutateCatalog}
              title={canMutateCatalog ? undefined : "Only administrators can adjust stock"}
              onClick={() => setAdjust({ open: true, item: i, direction: "INCREASE" })}
            >
              <Layers className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              label={i.isArchived ? `Restore ${i.sku}` : `Archive ${i.sku}`}
              tone="danger"
              disabled={!canMutateCatalog}
              title={canMutateCatalog ? undefined : "Only administrators can archive items"}
              onClick={() => {
                setArchiveError(null);
                setArchive({ open: true, item: i });
              }}
            >
              {i.isArchived ? (
                <ArchiveRestore className="h-4 w-4" aria-hidden />
              ) : (
                <Archive className="h-4 w-4" aria-hidden />
              )}
            </IconButton>
          </div>
        ),
      },
    ],
    [currency, navigate],
  );

  const confirmArchive = async (reason: string) => {
    const item = archive.item;
    if (!item) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      if (cloud) {
        // Authoritative write to the server, then refresh the mirror so every
        // device sees the same archive state.
        const row = cloudCatalogRowFromItem(item, { is_archived: !item.isArchived });
        await cloudUpsertCatalog([row], false);
        await syncNow();
      } else {
        await api.setRamArchived(item.id, !item.isArchived);
      }
      toast.success(
        item.isArchived ? `${item.sku} restored` : `${item.sku} archived`,
        item.isArchived
          ? "The SKU is back in the active catalogue."
          : "Hidden from the working catalogue - its history is kept. " + reason,
      );
      setArchive({ open: false, item: null });
      state.reload();
      void refs.reload();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Inventory"
        subtitle="Every RAM SKU you hold, what it costs and what it is worth"
        icon={<Package className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              onClick={() => {
                exportCsv(exportOpts());
                toast.success("Inventory exported", "CSV opened in your default spreadsheet app.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
            <Button
              onClick={() => {
                exportExcel(exportOpts());
                toast.success("Inventory exported", "Excel workbook downloaded.");
              }}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            >
              Excel
            </Button>
            <Button
              onClick={() => {
                const ok = exportPdf(exportOpts());
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
              variant="primary"
              onClick={() => setItemDialog({ open: true, editing: null })}
              disabled={!canMutateCatalog}
              title={canMutateCatalog ? undefined : "Only administrators can add catalogue items"}
              icon={<PlusCircle className="h-4 w-4" aria-hidden />}
            >
              New RAM item
            </Button>
          </>
        }
      >
        <FilterBar
          search={
            <SearchInput
              value={filters.search}
              onValueChange={(v) => setFilters((f) => ({ ...f, search: v }))}
              placeholder="Search SKU, speed, part number, location..."
              className="w-full sm:w-80"
            />
          }
          fields={[
            {
              key: "generation",
              label: "Generation",
              value: filters.generation,
              options: generationOptions.map((v) => ({ value: v, label: v })),
              onChange: set("generation"),
            },
            {
              key: "category",
              label: "Category",
              value: filters.category,
              options: categoryOptions.map((v) => ({ value: v, label: v })),
              onChange: set("category"),
            },
            { key: "status", label: "Stock", value: filters.status, options: STOCK_STATUS_FILTERS, onChange: set("status") },
          ]}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "btn btn-sm",
                showFilters || activeCount > 3 ? "btn-primary" : "btn-secondary",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              All filters
            </button>
            <select
              value={filters.sort}
              onChange={(e) => set("sort")(e.target.value)}
              aria-label="Sort inventory"
              className="input h-9 w-auto min-w-[11rem] cursor-pointer text-xs"
            >
              {INVENTORY_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <Checkbox
              label="Show archived"
              checked={filters.archived}
              onCheckedChange={(v) => setFilters((f) => ({ ...f, archived: v }))}
            />
          </div>
        </FilterBar>

        {showFilters && (
          <div className="anim-fade-in card mt-2 grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
            <LabelledSelect
              label="Capacity"
              value={filters.capacity}
              options={capacityOptions}
              onChange={set("capacity")}
              className="min-w-0"
            />
            <LabelledSelect
              label="Speed"
              value={filters.speed}
              options={speedOptions}
              onChange={set("speed")}
              className="min-w-0"
            />
            <LabelledSelect
              label="Manufacturer"
              value={filters.manufacturer}
              options={manufacturerOptions}
              onChange={set("manufacturer")}
              className="min-w-0"
            />
            <LabelledSelect
              label="Condition"
              value={filters.condition}
              options={conditionOptions}
              onChange={set("condition")}
              className="min-w-0"
            />
            <LabelledSelect
              label="Location"
              value={filters.location}
              options={locationOptions}
              onChange={set("location")}
              className="col-span-2 min-w-0 md:col-span-1"
            />
          </div>
        )}
      </PageHeader>

      <div className="page-scroll space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label="SKUs in view"
            value={qty(totals.skus)}
            icon={<Package className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={filters.archived ? "Including archived" : "Active catalogue"}
          />
          <StatCard
            label="Units on the shelf"
            value={qty(totals.units)}
            icon={<Boxes className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint={`${money(totals.units > 0 ? totals.cost / totals.units : 0, currency)} average cost`}
          />
          <StatCard
            label="Stock value at cost"
            value={money(totals.cost, currency)}
            icon={<Tag className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={`Retail ${money(totals.retail, currency)}`}
          />
          <StatCard
            label="Needs reordering"
            value={qty(totals.low + totals.out)}
            icon={<TriangleAlert className="h-4 w-4" aria-hidden />}
            tone={totals.out > 0 ? "danger" : totals.low > 0 ? "warn" : "profit"}
            hint={`${qty(totals.out)} out of stock, ${qty(totals.low)} low`}
          />
        </div>

        <SectionCard
          title="Catalogue"
          subtitle={
            totals.cost > 0
              ? `${qty(totals.skus)} SKUs - ${money(totals.retail - totals.cost, currency)} potential profit (${percent(totals.retail > 0 ? ((totals.retail - totals.cost) / totals.retail) * 100 : 0)} margin)`
              : "Add a RAM item or buy stock to start the catalogue"
          }
          icon={<Package className="h-4 w-4" aria-hidden />}
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
              rowKey={(i) => i.id}
              onRowClick={(i) => navigate(`/inventory/${i.id}`)}
              footer={
                items.length > 0 ? (
                  <tr>
                    <td>
                      <span className="text-2xs tracking-wider text-muted uppercase">
                        {pageSize < items.length ? `Page ${page} of ${pages}` : "Total"}
                      </span>
                    </td>
                    <td className="hidden lg:table-cell" />
                    <td className="num">{qty(totals.units)}</td>
                    <td className="num hidden md:table-cell" />
                    <td className="num hidden lg:table-cell" />
                    <td className="num">{money(totals.cost, currency)}</td>
                    <td className="num hidden xl:table-cell" />
                    <td />
                    <td />
                  </tr>
                ) : undefined
              }
              empty={
                <EmptyState
                  icon={<Package className="h-5 w-5" aria-hidden />}
                  title={
                    activeCount > 0 ? "No RAM matches these filters" : "Your catalogue is empty"
                  }
                  message={
                    activeCount > 0
                      ? "Loosen a filter or clear the search to see more of the catalogue."
                      : "Add a RAM item to define your catalogue, then BUY RAM to bring stock in from a seller."
                  }
                  action={
                    activeCount > 0 ? (
                      <Button size="sm" onClick={clearAll}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<PlusCircle className="h-4 w-4" aria-hidden />}
                        onClick={() => setItemDialog({ open: true, editing: null })}
                      >
                        New RAM item
                      </Button>
                    )
                  }
                  secondaryAction={
                    activeCount > 0 ? null : (
                      <Button size="sm" onClick={() => navigate("/purchases")}>
                        Record a purchase
                      </Button>
                    )
                  }
                />
              }
            />
          )}
          {items.length > 0 && (
            <Pagination
              total={items.length}
              pageSize={pageSize}
              page={page}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              label="SKUs"
            />
          )}
        </SectionCard>
      </div>

      <RamItemDialog
        open={itemDialog.open}
        editing={itemDialog.editing}
        onClose={() => setItemDialog({ open: false, editing: null })}
        onSaved={() => {
          setItemDialog({ open: false, editing: null });
          state.reload();
          void refs.reload();
        }}
        saveVia={
          cloud
            ? async (payload, editing) =>
                cloudSaveCatalogItem(cloudCatalogRowFrom(payload, editing), syncNow, editing)
            : undefined
        }
      />

      <StockAdjustDialog
        open={adjust.open}
        item={adjust.item}
        defaultDirection={adjust.direction}
        onClose={() => setAdjust({ open: false, item: null, direction: "INCREASE" })}
        onCompleted={() => {
          setAdjust({ open: false, item: null, direction: "INCREASE" });
          state.reload();
        }}
        adjustVia={
          cloud
            ? async (input) => {
                const item = adjust.item;
                if (!item) throw new Error("No item selected.");
                const delta = input.adjustmentType === "INCREASE" ? input.quantity : -input.quantity;
                const source = await cloudAdjustStock(item.sku, delta, input.reason);
                await syncNow();
                const rows = await api.listRamItems({ search: item.sku, limit: 100 });
                const mirrored = rows.find((r) => r.sku === item.sku) ?? item;
                return {
                  item: mirrored,
                  adjustment: {
                    id: `cloud-adjust-${Date.now()}`,
                    ramItemId: item.id,
                    sku: item.sku,
                    adjustmentType: input.adjustmentType,
                    quantity: input.quantity,
                    previousStock: item.quantity,
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
        open={archive.open}
        title={
          archive.item?.isArchived
            ? `Restore ${archive.item.sku}`
            : `Archive ${archive.item?.sku ?? "this item"}`
        }
        description={
          archive.item?.isArchived
            ? "The SKU returns to the active catalogue and can be bought, sold and adjusted again."
            : "Archiving hides the SKU from the working catalogue. Every purchase, sale and movement it appears in is kept, and you can restore it at any time."
        }
        points={
          archive.item?.isArchived
            ? undefined
            : [
                `Stock on hand stays as it is: ${qty(archive.item?.quantity ?? 0)} units.`,
                "The SKU disappears from the BUY RAM and SELL RAM pickers.",
                "Reports and the item history remain complete.",
              ]
        }
        confirmLabel="Explain why this SKU is being archived"
        confirmLabelShort={archive.item?.isArchived ? "Restore SKU" : "Archive SKU"}
        busy={archiving}
        serverError={archiveError}
        placeholder="e.g. replaced by a newer DDR5 range"
        onConfirm={confirmArchive}
        onCancel={() => setArchive({ open: false, item: null })}
      />
    </div>
  );
}
