import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Building2,
  Eye,
  FileSpreadsheet,
  FileText,
  MapPin,
  Pencil,
  PlusCircle,
  Printer,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import { avatarTone, cn, initials, money, qty, relativeDay } from "../lib/format";
import { useAsync, useDebounced, usePage } from "../lib/useAsync";
import { PartyFormDialog } from "../components/transactions";
import type { Party } from "../lib/types";
import {
  BalanceBadge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  IconButton,
  InlineError,
  MoneyStat,
  PageHeader,
  Pagination,
  ReasonDialog,
  SearchInput,
  SectionCard,
  SkeletonTable,
  StatCard,
  usePagedRows,
  useToast,
  type Column,
} from "../components/ui";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";

/* ===========================================================================
   Sellers
   ---------------------------------------------------------------------------
   The suppliers RAM comes from, with what ZEUS still owes them. The mirror of
   the Buyers screen: same directory, opposite direction of money.
   =========================================================================== */

export default function Sellers() {
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [search, setSearch] = useState(params.get("q") ?? "");
  const [city, setCity] = useState(params.get("city") ?? "");
  const [balance, setBalance] = useState(params.get("balance") ?? "");
  const [archived, setArchived] = useState(false);
  const [pageSize, setPageSize] = useState(25);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [archive, setArchive] = useState<Party | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 220);

  const state = useAsync(
    () => api.listSellers(debouncedSearch, archived),
    [debouncedSearch, archived],
  );

  const all = state.data ?? [];

  const rows = useMemo(() => {
    let out = all;
    if (city) out = out.filter((s) => s.city === city);
    if (balance === "owing") out = out.filter((s) => s.currentBalance > 0.005);
    else if (balance === "settled") out = out.filter((s) => Math.abs(s.currentBalance) <= 0.005);
    else if (balance === "credit") out = out.filter((s) => s.currentBalance < -0.005);
    return out;
  }, [all, city, balance]);

  const [page, setPage] = usePage(rows, pageSize);
  const visible = usePagedRows(rows, pageSize, page);

  const totals = useMemo(() => {
    let billed = 0;
    let paid = 0;
    let due = 0;
    let owing = 0;
    rows.forEach((s) => {
      billed += s.totalPurchases;
      paid += s.totalPaid;
      due += s.totalOutstanding;
      if (s.currentBalance > 0.005) owing += 1;
    });
    return { billed, paid, due, owing, count: rows.length };
  }, [rows]);

  const cityOptions = useMemo(
    () =>
      Array.from(new Set(all.map((s) => s.city).filter((c): c is string => Boolean(c)))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [all],
  );

  const clearAll = () => {
    setSearch("");
    setCity("");
    setBalance("");
  };
  const activeCount = [search, city, balance].filter(Boolean).length;

  const exportColumns: ExportColumn<Party>[] = [
    { header: "Code", value: (s) => s.code },
    { header: "Company", value: (s) => s.companyName },
    { header: "Contact", value: (s) => s.contactPerson || "" },
    { header: "Phone", value: (s) => s.phone || "" },
    { header: "City", value: (s) => s.city || "" },
    { header: "Transactions", value: (s) => s.transactionCount, numeric: true },
    { header: "Billed", value: (s) => s.totalPurchases, numeric: true },
    { header: "Paid", value: (s) => s.totalPaid, numeric: true },
    { header: "Outstanding", value: (s) => s.totalOutstanding, numeric: true },
    { header: "Balance", value: (s) => s.currentBalance, numeric: true },
    { header: "Last activity", value: (s) => s.lastActivity || "" },
  ];

  const exportOpts = (title: string, filename: string) => ({
    filename,
    title,
    subtitle: `${qty(rows.length)} sellers - ${money(totals.due, currency)} payable`,
    meta: [
      { label: "Billed", value: money(totals.billed, currency) },
      { label: "Paid", value: money(totals.paid, currency) },
      { label: "Payable", value: money(totals.due, currency) },
    ],
    columns: exportColumns,
    rows,
  });

  const columns: Column<Party>[] = [
    {
      key: "company",
      header: "Seller",
      width: "18rem",
      cell: (s) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-2xs font-bold",
              avatarTone(s.companyName),
            )}
          >
            {initials(s.companyName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{s.companyName}</p>
            <p className="truncate font-mono text-2xs text-faint">{s.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-ink">{s.contactPerson || "-"}</p>
          <p className="truncate text-2xs text-faint">{s.phone || s.email || "-"}</p>
        </div>
      ),
      hideBelow: "lg",
    },
    {
      key: "city",
      header: "City",
      cell: (s) => (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          {s.city || "-"}
        </span>
      ),
      hideBelow: "xl",
    },
    {
      key: "transactions",
      header: "Orders",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (s) => <span className="text-muted">{qty(s.transactionCount)}</span>,
    },
    {
      key: "billed",
      header: "Billed",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (s) => <span className="text-muted">{money(s.totalPurchases, currency)}</span>,
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      numeric: true,
      hideBelow: "xl",
      cell: (s) => <span className="text-brand-700">{money(s.totalPaid, currency)}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      numeric: true,
      cell: (s) => (
        <div>
          <p
            className={cn(
              "font-bold",
              s.currentBalance > 0.005
                ? "text-brand-700"
                : s.currentBalance < -0.005
                  ? "text-warn-700"
                  : "text-profit-700",
            )}
          >
            {money(s.currentBalance, currency)}
          </p>
          <div className="mt-0.5 flex justify-end">
            <BalanceBadge balance={s.currentBalance} owedByThem={false} />
          </div>
        </div>
      ),
    },
    {
      key: "activity",
      header: "Last activity",
      hideBelow: "xl",
      cell: (s) => <span className="text-2xs text-muted">{relativeDay(s.lastActivity)}</span>,
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
          <IconButton
            label={`Open ${s.companyName}`}
            tone="brand"
            onClick={() => navigate(`/sellers/${s.id}`)}
          >
            <Eye className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Edit ${s.companyName}`}
            onClick={() => {
              setEditing(s);
              setFormOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={s.isArchived ? `Restore ${s.companyName}` : `Archive ${s.companyName}`}
            tone={s.isArchived ? "brand" : "danger"}
            onClick={() => {
              setArchiveError(null);
              setArchive(s);
            }}
          >
            {s.isArchived ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden />
            ) : (
              <Archive className="h-4 w-4" aria-hidden />
            )}
          </IconButton>
        </div>
      ),
    },
  ];

  const confirmArchive = async (reason: string) => {
    const target = archive;
    if (!target) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await api.setSellerArchived(target.id, !target.isArchived);
      toast.success(
        target.isArchived ? `${target.companyName} restored` : `${target.companyName} archived`,
        target.isArchived
          ? "The seller is back in the active directory."
          : `Hidden from the directory - their history is kept. ${reason}`,
      );
      setArchive(null);
      state.reload();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Sellers"
        subtitle="Suppliers you buy RAM from, and what ZEUS still owes them"
        icon={<Building2 className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              onClick={() => {
                exportCsv(exportOpts("Seller directory", "zeus-sellers"));
                toast.success("Sellers exported", "CSV file downloaded.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
            <Button
              onClick={() => {
                exportExcel(exportOpts("Seller directory", "zeus-sellers"));
                toast.success("Sellers exported", "Excel workbook downloaded.");
              }}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            >
              Excel
            </Button>
            <Button
              onClick={() => {
                const ok = exportPdf(exportOpts("Seller directory", "zeus-sellers"));
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
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              icon={<PlusCircle className="h-4 w-4" aria-hidden />}
            >
              New seller
            </Button>
          </>
        }
      >
        <FilterBar
          search={
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search company, contact, phone, code..."
              className="w-full sm:w-80"
            />
          }
          fields={[
            {
              key: "balance",
              label: "Balance",
              value: balance,
              options: [
                { value: "owing", label: "We owe" },
                { value: "settled", label: "Settled" },
                { value: "credit", label: "We are in credit" },
              ],
              onChange: setBalance,
            },
            {
              key: "city",
              label: "City",
              value: city,
              options: cityOptions.map((c) => ({ value: c, label: c })),
              onChange: setCity,
            },
          ]}
        >
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-brand-600"
            />
            Show archived
          </label>
        </FilterBar>
      </PageHeader>

      <div className="page-scroll space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label="Sellers in view"
            value={qty(totals.count)}
            icon={<Building2 className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint={archived ? "Including archived" : "Active directory"}
          />
          <StatCard
            label="Accounts to settle"
            value={qty(totals.owing)}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={totals.owing > 0 ? "warn" : "profit"}
            hint={totals.owing > 0 ? "Pay these from the Payments screen" : "Nothing owed"}
          />
          <MoneyStat
            label="Billed by suppliers"
            value={totals.billed}
            currency={currency}
            icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={`${money(totals.paid, currency)} already paid`}
          />
          <MoneyStat
            label="Payable"
            value={totals.due}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={totals.due > 0.005 ? "danger" : "profit"}
            hint={totals.due > 0.005 ? "Money going out" : "Nothing to pay"}
          />
        </div>

        <SectionCard
          title="Seller directory"
          subtitle={`${qty(rows.length)} seller${rows.length === 1 ? "" : "s"}${
            activeCount > 0 ? " matching your filters" : ""
          }`}
          icon={<Building2 className="h-4 w-4" aria-hidden />}
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
              onRowClick={(s) => navigate(`/sellers/${s.id}`)}
              footer={
                rows.length > 0 ? (
                  <tr>
                    <td>Totals</td>
                    <td className="hidden lg:table-cell" />
                    <td className="hidden xl:table-cell" />
                    <td className="num hidden md:table-cell">{qty(rows.length)}</td>
                    <td className="num hidden lg:table-cell">{money(totals.billed, currency)}</td>
                    <td className="num hidden xl:table-cell">{money(totals.paid, currency)}</td>
                    <td className="num">{money(totals.due, currency)}</td>
                    <td className="hidden xl:table-cell" />
                    <td />
                  </tr>
                ) : undefined
              }
              empty={
                <EmptyState
                  icon={<Building2 className="h-5 w-5" aria-hidden />}
                  title={activeCount > 0 ? "No sellers match these filters" : "No sellers yet"}
                  message={
                    activeCount > 0
                      ? "Try a different city or balance filter, or clear the search."
                      : "Sellers are created automatically when you record a purchase, or add one here first."
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
                        onClick={() => {
                          setEditing(null);
                          setFormOpen(true);
                        }}
                      >
                        New seller
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
              label="sellers"
            />
          )}
        </SectionCard>
      </div>

      <PartyFormDialog
        open={formOpen}
        kind="seller"
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={(saved) => {
          setFormOpen(false);
          setEditing(null);
          toast.success(
            editing ? `${saved.companyName} updated` : `${saved.companyName} added`,
            editing
              ? "The supplier profile has been saved."
              : `Supplier code ${saved.code} is ready to use.`,
          );
          state.reload();
        }}
      />

      <ReasonDialog
        open={archive !== null}
        title={
          archive?.isArchived
            ? `Restore ${archive?.companyName}`
            : `Archive ${archive?.companyName ?? "this seller"}`
        }
        description={
          archive?.isArchived
            ? "The supplier returns to the active directory and can be picked in BUY RAM again."
            : "Archiving keeps every purchase and payment this supplier is part of, but removes them from the pickers so they stop appearing in day-to-day work."
        }
        points={
          archive?.isArchived
            ? undefined
            : [
                `Amount still payable stays as it is: ${money(archive?.totalOutstanding ?? 0, currency)}.`,
                "Their purchase history and statement stay complete.",
                "You can restore them at any time.",
              ]
        }
        confirmLabel="Explain why this supplier is being archived"
        confirmLabelShort={archive?.isArchived ? "Restore seller" : "Archive seller"}
        busy={archiving}
        serverError={archiveError}
        placeholder="e.g. switched to a new distributor"
        onConfirm={confirmArchive}
        onCancel={() => setArchive(null)}
      />
    </div>
  );
}