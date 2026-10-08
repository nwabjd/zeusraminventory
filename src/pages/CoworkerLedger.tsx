import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Phone,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  UsersRound,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import {
  avatarTone,
  cn,
  coworkerLabel,
  displayDate,
  initials,
  money,
  qty,
  relativeDay,
} from "../lib/format";
import { useAsync, useDebounced, usePage } from "../lib/useAsync";
import type { Coworker, CoworkerTransaction } from "../lib/types";
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
  PrimaryActionCard,
  ReasonDialog,
  SearchInput,
  SectionCard,
  SkeletonTable,
  StatCard,
  StatusBadge,
  TransactionSummary,
  usePagedRows,
  useToast,
  type Column,
} from "../components/ui";
import {
  CoworkerEntryDialog,
  CoworkerFormDialog,
  RecentEntries,
} from "../components/transactions";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";

/* ===========================================================================
   Coworker ledger
   ---------------------------------------------------------------------------
   Cash lent to and borrowed from the people who work with you, kept separate
   from buyers and sellers because nothing here is stock - it is the shop's own
   money. Three positions matter: what they owe you, what you owe them, and the
   net between them.
   =========================================================================== */

const PAGE_SIZE = 25;

type EntryKind = "LEND" | "BORROW" | "REPAYMENT";

export default function CoworkerLedger() {
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [range, setRange] = useState({ from: "", to: "" });

  const [entryKind, setEntryKind] = useState<EntryKind | null>(null);
  const [entryTarget, setEntryTarget] = useState<Coworker | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Coworker | null>(null);
  const [archiving, setArchiving] = useState<Coworker | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 220);

  const listState = useAsync(
    () => api.listCoworkers(debouncedSearch, showArchived),
    [debouncedSearch, showArchived],
  );
  const totalsState = useAsync(() => api.coworkerTotals(), []);
  const entriesState = useAsync(
    () => api.allCoworkerTransactions(range.from, range.to),
    [range.from, range.to],
  );

  const coworkers = listState.data ?? [];
  const entries = entriesState.data ?? [];
  const totals = totalsState.data;

  const [page, setPage] = usePage(coworkers, pageSize);
  const visible = usePagedRows(coworkers, pageSize, page);

  /* Derivation from the loaded rows so the cards can never disagree with the
     table underneath them; the backend totals are shown alongside as the
     authoritative figure. */
  const derived = useMemo(() => {
    let receivable = 0;
    let payable = 0;
    let settled = 0;
    let owed = 0;
    coworkers.forEach((c) => {
      if (c.currentBalance > 0.005) receivable += c.currentBalance;
      else if (c.currentBalance < -0.005) payable += -c.currentBalance;
      else settled += 1;
      if (Math.abs(c.currentBalance) > 0.005) owed += 1;
    });
    return {
      receivable,
      payable,
      net: receivable - payable,
      settled,
      owed,
    };
  }, [coworkers]);

  const openLend = (target?: Coworker | null) => {
    setEntryTarget(target ?? null);
    setEntryKind("LEND");
  };
  const openBorrow = (target?: Coworker | null) => {
    setEntryTarget(target ?? null);
    setEntryKind("BORROW");
  };
  const openRepayment = (target?: Coworker | null) => {
    setEntryTarget(target ?? null);
    setEntryKind("REPAYMENT");
  };

  const reloadAll = () => {
    listState.reload();
    totalsState.reload();
    entriesState.reload();
  };

  const onEntryCompleted = (txn: CoworkerTransaction) => {
    const what =
      txn.kind === "LEND"
        ? `${money(txn.amount, currency)} lent to ${txn.coworkerName}`
        : txn.kind === "BORROW"
          ? `${money(txn.amount, currency)} borrowed from ${txn.coworkerName}`
          : `${money(txn.amount, currency)} repaid by ${txn.coworkerName}`;
    toast.success("Ledger updated", `${what}. Balance is now ${money(txn.balanceAfter, currency)}.`);
    reloadAll();
  };

  const confirmArchive = async (reason: string) => {
    const target = archiving;
    if (!target) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await api.setCoworkerArchived(target.id, !target.isArchived);
      toast.success(
        target.isArchived ? `${target.name} restored` : `${target.name} archived`,
        target.isArchived
          ? "The record is active again and can be picked in the ledger forms."
          : `Hidden from the pickers - every entry is kept. ${reason}`,
      );
      setArchiving(null);
      reloadAll();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  };

  /* ---- tables ----------------------------------------------------------- */

  const coworkerColumns = useMemo<Column<Coworker>[]>(
    () => [
      {
        key: "name",
        header: "Coworker",
        cell: (c) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-2xs font-bold",
                avatarTone(c.name),
              )}
            >
              {initials(c.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
              {c.phone && (
                <p className="flex items-center gap-1 truncate text-2xs text-muted">
                  <Phone className="h-3 w-3 shrink-0" aria-hidden />
                  {c.phone}
                </p>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "balance",
        header: "Current balance",
        align: "right",
        numeric: true,
        cell: (c) =>
          Math.abs(c.currentBalance) < 0.005 ? (
            <span className="text-2xs font-semibold text-profit-700">Settled</span>
          ) : (
            <div className="text-right">
              <p
                className={cn(
                  "font-bold",
                  c.currentBalance > 0 ? "text-warn-700" : "text-brand-700",
                )}
              >
                {money(Math.abs(c.currentBalance), currency)}
              </p>
              <p className="text-2xs text-faint">
                {c.currentBalance > 0 ? "owes you" : "you owe them"}
              </p>
            </div>
          ),
      },
      {
        key: "lent",
        header: "Total lent",
        align: "right",
        numeric: true,
        hideBelow: "lg",
        cell: (c) => <span className="text-muted">{money(c.totalLent, currency)}</span>,
      },
      {
        key: "borrowed",
        header: "Total borrowed",
        align: "right",
        numeric: true,
        hideBelow: "lg",
        cell: (c) => <span className="text-muted">{money(c.totalBorrowed, currency)}</span>,
      },
      {
        key: "repaid",
        header: "Total repaid",
        align: "right",
        numeric: true,
        hideBelow: "xl",
        cell: (c) => <span className="text-profit-700">{money(c.totalRepaid, currency)}</span>,
      },
      {
        key: "entries",
        header: "Entries",
        align: "right",
        numeric: true,
        hideBelow: "md",
        cell: (c) => <span className="text-muted">{qty(c.transactionCount)}</span>,
      },
      {
        key: "last",
        header: "Last activity",
        hideBelow: "xl",
        cell: (c) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {c.lastActivity ? relativeDay(c.lastActivity) : "-"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "12rem",
        cell: (c) => (
          <div
            className="flex items-center justify-end gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <IconButton
              label={`Lend cash to ${c.name}`}
              tone="warn"
              onClick={() => openLend(c)}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              label={`Borrow cash from ${c.name}`}
              tone="brand"
              onClick={() => openBorrow(c)}
            >
              <ArrowDownLeft className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              label={`Record a repayment from ${c.name}`}
              tone="profit"
              disabled={Math.abs(c.currentBalance) < 0.005}
              onClick={() => openRepayment(c)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              label={`Edit ${c.name}`}
              onClick={() => {
                setEditing(c);
                setFormOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              label={c.isArchived ? `Restore ${c.name}` : `Archive ${c.name}`}
              tone="danger"
              onClick={() => {
                setArchiveError(null);
                setArchiving(c);
              }}
            >
              <Archive className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, openBorrow, openLend, openRepayment],
  );

  const entryColumns = useMemo<Column<CoworkerTransaction>[]>(
    () => [
      {
        key: "date",
        header: "Date",
        width: "8rem",
        cell: (t) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {displayDate(t.txnDate)}
          </span>
        ),
      },
      {
        key: "who",
        header: "Coworker",
        cell: (t) => (
          <button
            type="button"
            className="link block max-w-full truncate text-xs"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/coworker-ledger/${t.coworkerId}`);
            }}
          >
            {t.coworkerName}
          </button>
        ),
      },
      {
        key: "kind",
        header: "Entry",
        cell: (t) => (
          <StatusBadge
            tone={t.kind === "LEND" ? "warn" : t.kind === "BORROW" ? "brand" : "profit"}
          >
            {coworkerLabel(t.kind)}
          </StatusBadge>
        ),
      },
      {
        key: "notes",
        header: "Notes",
        hideBelow: "lg",
        cell: (t) => (
          <span className="block max-w-[18rem] truncate text-xs text-muted">
            {t.notes || "-"}
          </span>
        ),
      },
      {
        key: "method",
        header: "Method",
        hideBelow: "xl",
        cell: (t) => <span className="text-xs text-muted">{t.method || "-"}</span>,
      },
      {
        key: "amount",
        header: "Amount",
        align: "right",
        numeric: true,
        cell: (t) => (
          <span
            className={cn(
              "font-bold",
              t.kind === "LEND"
                ? "text-warn-700"
                : t.kind === "BORROW"
                  ? "text-brand-700"
                  : "text-profit-700",
            )}
          >
            {t.kind === "LEND" ? "+" : t.kind === "BORROW" ? "-" : ""}
            {money(t.amount, currency).replace("-", "")}
          </span>
        ),
      },
      {
        key: "after",
        header: "Balance after",
        align: "right",
        numeric: true,
        cell: (t) => (
          <span
            className={cn(
              "font-semibold",
              Math.abs(t.balanceAfter) < 0.005
                ? "text-profit-700"
                : t.balanceAfter > 0
                  ? "text-warn-700"
                  : "text-brand-700",
            )}
          >
            {Math.abs(t.balanceAfter) < 0.005
              ? "Settled"
              : money(Math.abs(t.balanceAfter), currency)}
          </span>
        ),
      },
    ],
    [currency, navigate],
  );

  const entryExportColumns: ExportColumn<CoworkerTransaction>[] = [
    { header: "Date", value: (t) => t.txnDate },
    { header: "Coworker", value: (t) => t.coworkerName },
    { header: "Entry", value: (t) => coworkerLabel(t.kind) },
    { header: "Amount", value: (t) => t.amount, numeric: true },
    { header: "Balance after", value: (t) => t.balanceAfter, numeric: true },
    { header: "Method", value: (t) => t.method || "" },
    { header: "Notes", value: (t) => t.notes || "" },
  ];

  const coworkerExportColumns: ExportColumn<Coworker>[] = [
    { header: "Name", value: (c) => c.name },
    { header: "Phone", value: (c) => c.phone || "" },
    {
      header: "Balance",
      value: (c) => c.currentBalance,
      numeric: true,
    },
    { header: "Direction", value: (c) =>
      Math.abs(c.currentBalance) < 0.005
        ? "Settled"
        : c.currentBalance > 0
          ? "Owes ZEUS"
          : "ZEUS owes them",
    },
    { header: "Total lent", value: (c) => c.totalLent, numeric: true },
    { header: "Total borrowed", value: (c) => c.totalBorrowed, numeric: true },
    { header: "Total repaid", value: (c) => c.totalRepaid, numeric: true },
    { header: "Entries", value: (c) => c.transactionCount, numeric: true },
  ];

  const exportEntries = (business: { name: string; tagline: string; phone: string; trn: string }) => ({
    filename: "zeus-coworker-ledger",
    title: "Coworker ledger",
    subtitle: `${qty(entries.length)} entries${range.from || range.to ? " in the selected period" : ""}`,
    meta: [
      { label: "Owed to ZEUS", value: money(totals?.receivable ?? 0, currency) },
      { label: "Owed by ZEUS", value: money(totals?.payable ?? 0, currency) },
      { label: "Net", value: money(totals?.net ?? 0, currency) },
    ],
    columns: entryExportColumns,
    rows: entries,
    business,
  });

  const header = (
    <PageHeader
      title="Coworker Ledger"
      subtitle={`${qty(totals?.coworkerCount ?? 0)} coworker${
        (totals?.coworkerCount ?? 0) === 1 ? "" : "s"
      } on the books - ${qty(totals?.transactionCount ?? 0)} entries recorded`}
      icon={<UsersRound className="h-5 w-5" aria-hidden />}
      actions={
        <>
          <Button
            onClick={() => {
              exportCsv({
                ...exportEntries({ name: "ZEUS", tagline: "", phone: "", trn: "" }),
              });
              toast.success("Ledger exported", "CSV file downloaded.");
            }}
            icon={<FileText className="h-4 w-4" aria-hidden />}
          >
            CSV
          </Button>
          <Button
            onClick={() => {
              exportExcel({
                ...exportEntries({ name: "ZEUS", tagline: "", phone: "", trn: "" }),
              });
              toast.success("Ledger exported", "Excel workbook downloaded.");
            }}
            icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
          >
            Excel
          </Button>
          <Button
            onClick={() => {
              const ok = exportPdf(
                exportEntries({ name: "ZEUS", tagline: "", phone: "", trn: "" }),
              );
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
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            icon={<Plus className="h-4 w-4" aria-hidden />}
          >
            Add coworker
          </Button>
        </>
      }
    />
  );

  if (listState.loading && !listState.data) {
    return (
      <div className="page">
        {header}
        <div className="page-scroll space-y-4">
          <div className="card">
            <SkeletonTable rows={6} columns={5} />
          </div>
        </div>
      </div>
    );
  }

  if (listState.error && !listState.data) {
    return (
      <div className="page">
        {header}
        <InlineError message={listState.error} onRetry={listState.reload} />
      </div>
    );
  }

  return (
    <div className="page">
      {header}

      <div className="page-scroll space-y-4">
        {/* ---- the three entry points ---------------------------------- */}
        <div className="flex flex-col gap-3 lg:flex-row">
          <PrimaryActionCard
            tone="buy"
            label="Lend cash"
            description="You hand money over. What they owe you goes up."
            icon={<ArrowUpRight className="h-6 w-6" aria-hidden />}
            onClick={() => openLend()}
          />
          <PrimaryActionCard
            tone="sell"
            label="Borrow cash"
            description="You take money. What you owe them goes up."
            icon={<ArrowDownLeft className="h-6 w-6" aria-hidden />}
            onClick={() => openBorrow()}
          />
          <PrimaryActionCard
            tone="buy"
            label="Record repayment"
            description="Cash comes back and settles part of the balance."
            icon={<RotateCcw className="h-6 w-6" aria-hidden />}
            onClick={() => openRepayment()}
          />
        </div>

        {/* ---- the three positions ------------------------------------- */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MoneyStat
            label="I am owed"
            value={totals?.receivable ?? derived.receivable}
            currency={currency}
            icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
            tone="warn"
            hint={`${qty(derived.owed)} coworker${derived.owed === 1 ? "" : "s"} carrying a balance`}
          />
          <MoneyStat
            label="I owe"
            value={totals?.payable ?? derived.payable}
            currency={currency}
            icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint="Money taken from the business by a coworker"
          />
          <MoneyStat
            label="Net position"
            value={totals?.net ?? derived.net}
            currency={currency}
            icon={<HandCoins className="h-4 w-4" aria-hidden />}
            tone={(totals?.net ?? derived.net) >= 0 ? "profit" : "danger"}
            hint={
              (totals?.net ?? derived.net) >= 0
                ? "The shop is net owed by its coworkers"
                : "The shop owes its coworkers more than it is owed"
            }
          />
        </div>

        <FilterBar
          search={
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search coworkers by name..."
              className="w-full sm:w-72"
            />
          }
        >
          <Button
            size="sm"
            variant={showArchived ? "primary" : "secondary"}
            onClick={() => setShowArchived((v) => !v)}
            icon={<Archive className="h-3.5 w-3.5" aria-hidden />}
          >
            {showArchived ? "Hiding active" : "Include archived"}
          </Button>
        </FilterBar>

        {/* ---- coworker table ------------------------------------------ */}
        <SectionCard
          title="Coworkers"
          subtitle={`${qty(coworkers.length)} record${coworkers.length === 1 ? "" : "s"}${
            debouncedSearch ? ` matching "${debouncedSearch}"` : ""
          }`}
          icon={<UsersRound className="h-4 w-4" aria-hidden />}
          bodyClassName="p-0"
          className="min-h-[16rem]"
          actions={
            <Button
              size="sm"
              onClick={() => {
                exportCsv({
                  filename: "zeus-coworkers",
                  title: "Coworker balances",
                  subtitle: `${qty(coworkers.length)} coworkers`,
                  meta: [
                    { label: "Owed to ZEUS", value: money(totals?.receivable ?? 0, currency) },
                    { label: "Owed by ZEUS", value: money(totals?.payable ?? 0, currency) },
                    { label: "Net", value: money(totals?.net ?? 0, currency) },
                  ],
                  columns: coworkerExportColumns,
                  rows: coworkers,
                });
                toast.success("Coworkers exported", "CSV file downloaded.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
          }
        >
          <DataTable
            columns={coworkerColumns}
            rows={visible}
            rowKey={(c) => c.id}
            onRowClick={(c) => navigate(`/coworker-ledger/${c.id}`)}
            footer={
              coworkers.length > 0 ? (
                <tr>
                  <td>Totals</td>
                  <td className="num">
                    {money(derived.receivable, currency)} owed to us
                  </td>
                  <td className="num hidden lg:table-cell">{money(0, currency)}</td>
                  <td className="num hidden lg:table-cell">{money(0, currency)}</td>
                  <td className="num hidden xl:table-cell" />
                  <td className="num hidden md:table-cell" />
                  <td className="hidden xl:table-cell" />
                  <td />
                </tr>
              ) : undefined
            }
            empty={
              <EmptyState
                icon={<UsersRound className="h-5 w-5" aria-hidden />}
                title={debouncedSearch ? "No coworkers match that search" : "No coworkers yet"}
                message={
                  debouncedSearch
                    ? "Try a different name, or clear the search to see everyone."
                    : "Add the people who work with you, then lend, borrow or record repayments against their own ledger."
                }
                action={
                  debouncedSearch ? (
                    <Button size="sm" onClick={() => setSearch("")}>
                      Clear search
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setEditing(null);
                        setFormOpen(true);
                      }}
                      icon={<Plus className="h-4 w-4" aria-hidden />}
                    >
                      Add coworker
                    </Button>
                  )
                }
              />
            }
          />
          {coworkers.length > 0 && (
            <Pagination
              total={coworkers.length}
              pageSize={pageSize}
              page={page}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              label="coworkers"
            />
          )}
        </SectionCard>

        {/* ---- all entries --------------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Every entry"
            subtitle={`${qty(entries.length)} movement${entries.length === 1 ? "" : "s"}${
              range.from || range.to ? " in the selected period" : " - all time"
            }`}
            icon={<HandCoins className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[16rem] xl:col-span-2"
            actions={
              <>
                <div className="flex items-end gap-2">
                  <input
                    type="date"
                    aria-label="From"
                    value={range.from}
                    onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                    className={cn(
                      "input tnum h-8 w-32 text-xs",
                      range.from && "border-brand-400 bg-brand-50 text-brand-800",
                    )}
                  />
                  <input
                    type="date"
                    aria-label="To"
                    value={range.to}
                    onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                    className={cn(
                      "input tnum h-8 w-32 text-xs",
                      range.to && "border-brand-400 bg-brand-50 text-brand-800",
                    )}
                  />
                </div>
                {(range.from || range.to) && (
                  <Button size="sm" variant="ghost" onClick={() => setRange({ from: "", to: "" })}>
                    All time
                  </Button>
                )}
              </>
            }
          >
            {entriesState.loading && !entriesState.data ? (
              <SkeletonTable rows={6} columns={5} />
            ) : entriesState.error ? (
              <div className="p-4">
                <InlineError message={entriesState.error} onRetry={entriesState.reload} />
              </div>
            ) : (
              <DataTable
                columns={entryColumns}
                rows={entries.slice(0, 60)}
                rowKey={(t) => t.id}
                onRowClick={(t) => navigate(`/coworker-ledger/${t.coworkerId}`)}
                empty={
                  <EmptyState
                    icon={<HandCoins className="h-5 w-5" aria-hidden />}
                    title="No entries yet"
                    message="Lend, borrow or record a repayment and the movement appears here with the balance it produced."
                    action={
                      <Button size="sm" variant="primary" onClick={() => openLend()}>
                        Lend cash
                      </Button>
                    }
                  />
                }
              />
            )}
            {entries.length > 60 && (
              <p className="border-t border-line px-4 py-2.5 text-2xs text-faint">
                Showing the 60 most recent of {qty(entries.length)} entries. Export to CSV for the
                complete history, or open a coworker for their full ledger.
              </p>
            )}
          </SectionCard>

          <div className="space-y-4">
            <SectionCard
              title="Settled coworkers"
              subtitle="Everyone with nothing outstanding"
              icon={<RotateCcw className="h-4 w-4" aria-hidden />}
              bodyClassName="p-3"
            >
              <StatCard
                dense
                label="Fully settled"
                value={qty(derived.settled)}
                tone={derived.settled > 0 ? "profit" : "neutral"}
                hint={
                  derived.settled > 0
                    ? "Nothing to chase - every dirham is back"
                    : "No coworker is fully settled yet"
                }
              />
              <div className="mt-3">
                <TransactionSummary
                  lines={[
                    {
                      label: "Owed to ZEUS",
                      value: money(totals?.receivable ?? 0, currency),
                      tone: "warn",
                    },
                    {
                      label: "Owed by ZEUS",
                      value: money(totals?.payable ?? 0, currency),
                      tone: "brand",
                    },
                    {
                      label: "Net",
                      value: money(totals?.net ?? 0, currency),
                      tone: (totals?.net ?? 0) >= 0 ? "profit" : "danger",
                      strong: true,
                    },
                  ]}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Recent activity"
              subtitle="The last movements on the ledger"
              icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
              bodyClassName="px-3 pb-3"
            >
              {entries.length === 0 ? (
                <EmptyState
                  compact
                  icon={<HandCoins className="h-5 w-5" aria-hidden />}
                  title="Nothing recorded yet"
                  message="The first entry opens a coworker's ledger."
                />
              ) : (
                <RecentEntries entries={entries.slice(0, 8)} currency={currency} />
              )}
            </SectionCard>

            <SectionCard
              title="How balances work"
              subtitle="The rule the backend enforces"
              icon={<HandCoins className="h-4 w-4" aria-hidden />}
              bodyClassName="p-3"
            >
              <ul className="space-y-1.5 text-2xs leading-relaxed text-muted">
                <li>
                  <span className="font-bold text-warn-700">Lend</span> adds to what they owe you.
                </li>
                <li>
                  <span className="font-bold text-brand-700">Borrow</span> adds to what you owe them.
                </li>
                <li>
                  <span className="font-bold text-profit-700">Repayment</span> moves the balance back
                  toward zero and can never exceed what is outstanding.
                </li>
                <li>A balance of zero means the account is closed.</li>
              </ul>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* ---- dialogs ------------------------------------------------------ */}

      <CoworkerEntryDialog
        open={entryKind !== null}
        kind={entryKind ?? "LEND"}
        coworker={entryTarget}
        onClose={() => {
          setEntryKind(null);
          setEntryTarget(null);
        }}
        onCompleted={onEntryCompleted}
      />

      <CoworkerFormDialog
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          toast.success(
            editing ? `${editing.name} updated` : "Coworker added",
            editing
              ? "Their details have been saved."
              : "They can now be picked in every ledger form.",
          );
          reloadAll();
        }}
      />

      <ReasonDialog
        open={archiving !== null}
        title={
          archiving
            ? `${archiving.isArchived ? "Restore" : "Archive"} ${archiving.name}`
            : "Archive coworker"
        }
        description={
          archiving?.isArchived
            ? `The coworker becomes active again and can be picked when you lend, borrow or record a repayment.`
            : "Archiving hides the coworker from the pickers. Their balance and every entry are kept exactly as they are."
        }
        points={
          archiving?.isArchived
            ? undefined
            : [
                `Balance stays as it is: ${
                  Math.abs(archiving?.currentBalance ?? 0) < 0.005
                    ? "settled"
                    : money(archiving?.currentBalance ?? 0, currency)
                }.`,
                "The full ledger stays readable on their profile.",
                "You can restore this record at any time.",
              ]
        }
        confirmLabel="Explain why this coworker is being archived"
        confirmLabelShort={archiving?.isArchived ? "Restore coworker" : "Archive coworker"}
        busy={archiveBusy}
        serverError={archiveError}
        placeholder="e.g. left the company"
        onConfirm={confirmArchive}
        onCancel={() => setArchiving(null)}
      />
    </div>
  );
}