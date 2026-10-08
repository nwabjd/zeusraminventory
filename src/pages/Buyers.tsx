import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Eye,
  FileSpreadsheet,
  FileText,
  MapPin,
  Pencil,
  PlusCircle,
  Printer,
  Receipt,
  Users,
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
   Buyers
   ---------------------------------------------------------------------------
   Everyone who buys RAM from the shop, with the number that matters: what they
   still owe. One screen to find them, and one click to open the profile where
   their transactions, payments and statement live.
   =========================================================================== */

export default function Buyers() {
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
    () => api.listBuyers(debouncedSearch, archived),
    [debouncedSearch, archived],
  );

  const all = state.data ?? [];

  const rows = useMemo(() => {
    let out = all;
    if (city) out = out.filter((b) => b.city === city);
    if (balance === "owing") out = out.filter((b) => b.currentBalance > 0.005);
    else if (balance === "settled") out = out.filter((b) => Math.abs(b.currentBalance) <= 0.005);
    else if (balance === "credit") out = out.filter((b) => b.currentBalance < -0.005);
    return out;
  }, [all, city, balance]);

  const [page, setPage] = usePage(rows, pageSize);
  const visible = usePagedRows(rows, pageSize, page);

  const totals = useMemo(() => {
    let billed = 0;
    let paid = 0;
    let due = 0;
    let owing = 0;
    rows.forEach((b) => {
      billed += b.totalPurchases;
      paid += b.totalPaid;
      due += b.totalOutstanding;
      if (b.currentBalance > 0.005) owing += 1;
    });
    return { billed, paid, due, owing, count: rows.length };
  }, [rows]);

  const cityOptions = useMemo(
    () =>
      Array.from(new Set(all.map((b) => b.city).filter((c): c is string => Boolean(c)))).sort((a, b) =>
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
    { header: "Code", value: (b) => b.code },
    { header: "Company", value: (b) => b.companyName },
    { header: "Contact", value: (b) => b.contactPerson || "" },
    { header: "Phone", value: (b) => b.phone || "" },
    { header: "City", value: (b) => b.city || "" },
    { header: "Transactions", value: (b) => b.transactionCount, numeric: true },
    { header: "Billed", value: (b) => b.totalPurchases, numeric: true },
    { header: "Paid", value: (b) => b.totalPaid, numeric: true },
    { header: "Outstanding", value: (b) => b.totalOutstanding, numeric: true },
    { header: "Balance", value: (b) => b.currentBalance, numeric: true },
    { header: "Last activity", value: (b) => b.lastActivity || "" },
  ];

  const exportOpts = (title: string, filename: string) => ({
    filename,
    title,
    subtitle: `${qty(rows.length)} buyers - ${money(totals.due, currency)} outstanding`,
    meta: [
      { label: "Billed", value: money(totals.billed, currency) },
      { label: "Paid", value: money(totals.paid, currency) },
      { label: "Outstanding", value: money(totals.due, currency) },
    ],
    columns: exportColumns,
    rows,
  });

  const columns: Column<Party>[] = [
    {
      key: "company",
      header: "Buyer",
      width: "18rem",
      cell: (b) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-2xs font-bold",
              avatarTone(b.companyName),
            )}
          >
            {initials(b.companyName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{b.companyName}</p>
            <p className="truncate font-mono text-2xs text-faint">{b.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (b) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-ink">{b.contactPerson || "-"}</p>
          <p className="truncate text-2xs text-faint">{b.phone || b.email || "-"}</p>
        </div>
      ),
      hideBelow: "lg",
    },
    {
      key: "city",
      header: "City",
      cell: (b) => (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          {b.city || "-"}
        </span>
      ),
      hideBelow: "xl",
    },
    {
      key: "transactions",
      header: "Sales",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (b) => <span className="text-muted">{qty(b.transactionCount)}</span>,
    },
    {
      key: "billed",
      header: "Billed",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (b) => <span className="text-muted">{money(b.totalPurchases, currency)}</span>,
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      numeric: true,
      hideBelow: "xl",
      cell: (b) => <span className="text-profit-700">{money(b.totalPaid, currency)}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      numeric: true,
      cell: (b) => (
        <div>
          <p
            className={cn(
              "font-bold",
              b.currentBalance > 0.005
                ? "text-warn-700"
                : b.currentBalance < -0.005
                  ? "text-brand-700"
                  : "text-profit-700",
            )}
          >
            {money(b.currentBalance, currency)}
          </p>
          <div className="mt-0.5 flex justify-end">
            <BalanceBadge balance={b.currentBalance} owedByThem />
          </div>
        </div>
      ),
    },
    {
      key: "activity",
      header: "Last activity",
      hideBelow: "xl",
      cell: (b) => <span className="text-2xs text-muted">{relativeDay(b.lastActivity)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "9rem",
      cell: (b) => (
        <div
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton
            label={`Open ${b.companyName}`}
            tone="brand"
            onClick={() => navigate(`/buyers/${b.id}`)}
          >
            <Eye className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Edit ${b.companyName}`}
            onClick={() => {
              setEditing(b);
              setFormOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={b.isArchived ? `Restore ${b.companyName}` : `Archive ${b.companyName}`}
            tone={b.isArchived ? "brand" : "danger"}
            onClick={() => {
              setArchiveError(null);
              setArchive(b);
            }}
          >
            {b.isArchived ? (
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
      await api.setBuyerArchived(target.id, !target.isArchived);
      toast.success(
        target.isArchived ? `${target.companyName} restored` : `${target.companyName} archived`,
        target.isArchived
          ? "The buyer is back in the active directory."
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
        title="Buyers"
        subtitle="Everyone who buys RAM from you, and what they still owe"
        icon={<Users className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              onClick={() => {
                exportCsv(exportOpts("Buyer directory", "zeus-buyers"));
                toast.success("Buyers exported", "CSV file downloaded.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
            <Button
              onClick={() => {
                exportExcel(exportOpts("Buyer directory", "zeus-buyers"));
                toast.success("Buyers exported", "Excel workbook downloaded.");
              }}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            >
              Excel
            </Button>
            <Button
              onClick={() => {
                const ok = exportPdf(exportOpts("Buyer directory", "zeus-buyers"));
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
              New buyer
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
                { value: "owing", label: "Owes us" },
                { value: "settled", label: "Settled" },
                { value: "credit", label: "In credit" },
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
            label="Buyers in view"
            value={qty(totals.count)}
            icon={<Users className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint={archived ? "Including archived" : "Active directory"}
          />
          <StatCard
            label="With an outstanding balance"
            value={qty(totals.owing)}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={totals.owing > 0 ? "warn" : "profit"}
            hint={totals.owing > 0 ? "Chase these first" : "Everyone is settled"}
          />
          <MoneyStat
            label="Billed to buyers"
            value={totals.billed}
            currency={currency}
            icon={<Receipt className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={`${money(totals.paid, currency)} received`}
          />
          <MoneyStat
            label="Outstanding"
            value={totals.due}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={totals.due > 0.005 ? "danger" : "profit"}
            hint={totals.due > 0.005 ? "Receive payments from the Payments screen" : "Nothing to collect"}
          />
        </div>

        <SectionCard
          title="Buyer directory"
          subtitle={`${qty(rows.length)} buyer${rows.length === 1 ? "" : "s"}${
            activeCount > 0 ? " matching your filters" : ""
          }`}
          icon={<Users className="h-4 w-4" aria-hidden />}
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
              rowKey={(b) => b.id}
              onRowClick={(b) => navigate(`/buyers/${b.id}`)}
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
                  icon={<Users className="h-5 w-5" aria-hidden />}
                  title={activeCount > 0 ? "No buyers match these filters" : "No buyers yet"}
                  message={
                    activeCount > 0
                      ? "Try a different city or balance filter, or clear the search."
                      : "Buyers are created automatically when you record a sale, or add one here first."
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
                        New buyer
                      </Button>
                    )
                  }
                  secondaryAction={
                    activeCount > 0 ? null : (
                      <Button size="sm" onClick={() => navigate("/sales")}>
                        Record a sale
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
              label="buyers"
            />
          )}
        </SectionCard>
      </div>

      <PartyFormDialog
        open={formOpen}
        kind="buyer"
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
              ? "The buyer profile has been saved."
              : `Buyer code ${saved.code} is ready to use.`,
          );
          state.reload();
        }}
      />

      <ReasonDialog
        open={archive !== null}
        title={
          archive?.isArchived
            ? `Restore ${archive?.companyName}`
            : `Archive ${archive?.companyName ?? "this buyer"}`
        }
        description={
          archive?.isArchived
            ? "The buyer returns to the active directory and can be picked in SELL RAM again."
            : "Archiving keeps every sale and payment this buyer is part of, but removes them from the pickers so they stop appearing in day-to-day work."
        }
        points={
          archive?.isArchived
            ? undefined
            : [
                `Outstanding balance stays as it is: ${money(archive?.totalOutstanding ?? 0, currency)}.`,
                "Their sales history and statement stay complete.",
                "You can restore them at any time.",
              ]
        }
        confirmLabel="Explain why this buyer is being archived"
        confirmLabelShort={archive?.isArchived ? "Restore buyer" : "Archive buyer"}
        busy={archiving}
        serverError={archiveError}
        placeholder="e.g. closed the account, moved to another supplier"
        onConfirm={confirmArchive}
        onCancel={() => setArchive(null)}
      />
    </div>
  );
}

