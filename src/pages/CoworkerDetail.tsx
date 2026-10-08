import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Phone,
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
  displayDateTime,
  initials,
  money,
  qty,
} from "../lib/format";
import { useAsync, usePage } from "../lib/useAsync";
import type { CoworkerTransaction } from "../lib/types";
import {
  ArchivedBadge,
  Button,
  DataList,
  DataTable,
  EmptyState,
  InlineError,
  LoadingState,
  MoneyStat,
  PageHeader,
  Pagination,
  PrimaryActionCard,
  ReasonDialog,
  SectionCard,
  StatCard,
  StatusBadge,
  TransactionSummary,
  usePagedRows,
  useToast,
  type Column,
} from "../components/ui";
import { CoworkerEntryDialog, CoworkerFormDialog } from "../components/transactions";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";

/* ===========================================================================
   Coworker profile
   ---------------------------------------------------------------------------
   One person's cash ledger: who they are, every lend / borrow / repayment with
   the balance each one produced, a printable statement, and the three actions
   that move the number.
   =========================================================================== */

const PAGE_SIZE = 25;

type Tab = "ledger" | "statement";

export default function CoworkerDetail() {
  const { id = "" } = useParams();
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("ledger");
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [range, setRange] = useState({ from: "", to: "" });

  const [entryKind, setEntryKind] = useState<"LEND" | "BORROW" | "REPAYMENT" | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const personState = useAsync(() => api.getCoworker(id), [id], { skip: !id });
  const entriesState = useAsync(
    () => api.coworkerTransactions(id, range.from, range.to),
    [id, range.from, range.to],
    { skip: !id },
  );

  const person = personState.data;
  const entries = entriesState.data ?? [];

  /* ---- figures come from the ledger, oldest first ------------------------ */
  const oldestFirst = useMemo(
    () => [...entries].sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.createdAt.localeCompare(b.createdAt)),
    [entries],
  );

  const stats = useMemo(() => {
    let lent = 0;
    let borrowed = 0;
    let repaid = 0;
    oldestFirst.forEach((t) => {
      if (t.kind === "LEND") lent += t.amount;
      else if (t.kind === "BORROW") borrowed += t.amount;
      else repaid += t.amount;
    });
    return { lent, borrowed, repaid, count: oldestFirst.length };
  }, [oldestFirst]);

  const [page, setPage] = usePage(oldestFirst, pageSize);
  const visible = usePagedRows(oldestFirst, pageSize, page);

  const reloadAll = () => {
    personState.reload();
    entriesState.reload();
  };

  const balance = person?.currentBalance ?? 0;
  const owedToUs = balance > 0.005;
  const settled = Math.abs(balance) < 0.005;

  /* ---- statement: debits are what we handed over, credits what came back -- */
  const statement = useMemo(() => {
    let running = 0;
    const lines = oldestFirst.map((t) => {
      const debit = t.kind === "LEND" ? t.amount : 0;
      const credit = t.kind === "REPAYMENT" || t.kind === "BORROW" ? t.amount : 0;
      running = Math.round((running + debit - credit) * 100) / 100;
      return {
        id: t.id,
        date: t.txnDate,
        reference: `${coworkerLabel(t.kind)} ${money(t.amount, currency)}`,
        description: t.notes || coworkerLabel(t.kind),
        debit,
        credit,
        balance: running,
      };
    });
    const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
    const totalCredit = lines.reduce((a, l) => a + l.credit, 0);
    return { lines, totalDebit, totalCredit, closing: running };
  }, [oldestFirst, currency]);

  const confirmArchive = async (reason: string) => {
    if (!person) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await api.setCoworkerArchived(person.id, !person.isArchived);
      toast.success(
        person.isArchived ? `${person.name} restored` : `${person.name} archived`,
        person.isArchived
          ? "The record is active again and appears in the pickers."
          : `Hidden from the pickers - the ledger is untouched. ${reason}`,
      );
      setArchiveOpen(false);
      personState.reload();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  };

  const columns: Column<CoworkerTransaction>[] = [
    {
      key: "date",
      header: "Date",
      width: "9rem",
      cell: (t) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">{displayDate(t.txnDate)}</p>
          <p className="truncate text-2xs text-faint">{displayDateTime(t.createdAt)}</p>
        </div>
      ),
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
      cell: (t) => (
        <span className="block max-w-[22rem] truncate text-xs text-muted">{t.notes || "-"}</span>
      ),
    },
    {
      key: "method",
      header: "Method",
      hideBelow: "md",
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
  ];

  const exportColumns: ExportColumn<CoworkerTransaction>[] = [
    { header: "Date", value: (t) => t.txnDate },
    { header: "Entry", value: (t) => coworkerLabel(t.kind) },
    { header: "Amount", value: (t) => t.amount, numeric: true },
    { header: "Balance after", value: (t) => t.balanceAfter, numeric: true },
    { header: "Method", value: (t) => t.method || "" },
    { header: "Notes", value: (t) => t.notes || "" },
  ];

  const exportOpts = () => ({
    filename: person ? `zeus-coworker-${person.name.replace(/\s+/g, "-").toLowerCase()}` : "zeus-coworker",
    title: person ? `Coworker ledger - ${person.name}` : "Coworker ledger",
    subtitle: `${qty(stats.count)} entr${stats.count === 1 ? "y" : "ies"}${
      range.from || range.to ? " in the selected period" : " - all time"
    }`,
    meta: [
      { label: "Closing balance", value: money(balance, currency) },
      { label: "Total lent", value: money(stats.lent, currency) },
      { label: "Total borrowed", value: money(stats.borrowed, currency) },
      { label: "Total repaid", value: money(stats.repaid, currency) },
    ],
    columns: exportColumns,
    rows: oldestFirst,
  });

  const header = (
    <PageHeader
      title={person?.name ?? "Coworker"}
      subtitle={
        person
          ? `${settled ? "Settled - nothing outstanding" : owedToUs ? "Owes you " : "You owe "}${money(
              Math.abs(balance),
              currency,
            )}${person.phone ? ` - ${person.phone}` : ""}${person.isArchived ? " - archived" : ""}`
          : "Loading"
      }
      icon={<UsersRound className="h-5 w-5" aria-hidden />}
      actions={
        <>
          <Button
            onClick={() => navigate("/coworker-ledger")}
            icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
          >
            All coworkers
          </Button>
          <Button
            onClick={() => {
              setFormOpen(true);
            }}
          >
            Edit details
          </Button>
          <Button
            variant="danger-soft"
            icon={<Archive className="h-4 w-4" aria-hidden />}
            onClick={() => {
              setArchiveError(null);
              setArchiveOpen(true);
            }}
          >
            {person?.isArchived ? "Restore" : "Archive"}
          </Button>
        </>
      }
    />
  );

  if (personState.loading && !person) {
    return (
      <div className="page">
        {header}
        <LoadingState label="Loading coworker" />
      </div>
    );
  }

  if (personState.error && !person) {
    return (
      <div className="page">
        {header}
        <InlineError message={personState.error} onRetry={personState.reload} />
      </div>
    );
  }

  if (!person) return null;

  return (
    <div className="page">
      {header}

      <div className="page-scroll space-y-4">
        {/* ---- the three movements ------------------------------------- */}
        <div className="flex flex-col gap-3 lg:flex-row">
          <PrimaryActionCard
            tone="buy"
            label="Lend cash"
            description={`Hand ${person.name} money. Their balance grows.`}
            icon={<ArrowUpRight className="h-6 w-6" aria-hidden />}
            onClick={() => setEntryKind("LEND")}
          />
          <PrimaryActionCard
            tone="sell"
            label="Borrow cash"
            description={`Take money from ${person.name}. You owe more.`}
            icon={<ArrowDownLeft className="h-6 w-6" aria-hidden />}
            onClick={() => setEntryKind("BORROW")}
          />
          <PrimaryActionCard
            tone="buy"
            label="Record repayment"
            description={
              settled
                ? "Nothing is outstanding on this ledger."
                : `Settle up to ${money(Math.abs(balance), currency)}.`
            }
            icon={<RotateCcw className="h-6 w-6" aria-hidden />}
            disabled={settled}
            onClick={() => setEntryKind("REPAYMENT")}
          />
        </div>

        {/* ---- the numbers --------------------------------------------- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MoneyStat
            label={owedToUs ? "Owed to you" : "You owe"}
            value={Math.abs(balance)}
            currency={currency}
            icon={<HandCoins className="h-4 w-4" aria-hidden />}
            tone={settled ? "profit" : owedToUs ? "warn" : "brand"}
            hint={
              settled
                ? "The account is closed"
                : owedToUs
                  ? "Collect it when you can"
                  : "Settle it as soon as practical"
            }
          />
          <MoneyStat
            label="Total lent"
            value={stats.lent}
            currency={currency}
            icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
            tone="warn"
            direction="up"
          />
          <MoneyStat
            label="Total borrowed"
            value={stats.borrowed}
            currency={currency}
            icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
            tone="brand"
            direction="down"
          />
          <MoneyStat
            label="Total repaid"
            value={stats.repaid}
            currency={currency}
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            tone="profit"
            direction="up"
            hint={`${qty(stats.count)} entr${stats.count === 1 ? "y" : "ies"} on this ledger`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* ---- person ------------------------------------------------ */}
          <SectionCard
            title="Details"
            subtitle="Who this is and how to reach them"
            icon={<Phone className="h-4 w-4" aria-hidden />}
            bodyClassName="p-4"
          >
            <div className="mb-3 flex items-center gap-3">
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
                  avatarTone(person.name),
                )}
              >
                {initials(person.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-ink">{person.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <ArchivedBadge archived={person.isArchived} />
                  <StatusBadge tone={settled ? "profit" : owedToUs ? "warn" : "brand"}>
                    {settled ? "Settled" : owedToUs ? "Owes you" : "You owe"}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <DataList
              columns={1}
              items={[
                {
                  label: "Phone",
                  value: person.phone ? (
                    <a className="link" href={`tel:${person.phone.replace(/\s+/g, "")}`}>
                      {person.phone}
                    </a>
                  ) : (
                    "-"
                  ),
                },
                { label: "Entries", value: qty(person.transactionCount) },
                { label: "Last activity", value: displayDate(person.lastActivity) },
                { label: "Added", value: displayDate(person.createdAt) },
                { label: "Updated", value: displayDateTime(person.updatedAt) },
              ]}
            />

            {person.notes && (
              <p className="mt-3 rounded-lg border border-line bg-canvas p-2.5 text-xs leading-relaxed text-muted">
                {person.notes}
              </p>
            )}
          </SectionCard>

          {/* ---- how the balance was built ---------------------------- */}
          <SectionCard
            title="Balance breakdown"
            subtitle="Lent and borrowed, less everything repaid"
            icon={<HandCoins className="h-4 w-4" aria-hidden />}
            bodyClassName="p-4"
          >
            <TransactionSummary
              lines={[
                { label: "Total lent", value: money(stats.lent, currency), tone: "warn" },
                { label: "Total borrowed", value: `- ${money(stats.borrowed, currency)}`, tone: "brand" },
                { label: "Total repaid", value: `- ${money(stats.repaid, currency)}`, tone: "profit" },
                {
                  label: "Current balance",
                  value: money(balance, currency),
                  hint: settled ? "settled" : owedToUs ? "they owe you" : "you owe them",
                  tone: settled ? "profit" : owedToUs ? "warn" : "brand",
                  strong: true,
                },
              ]}
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard
                dense
                label="Entries"
                value={qty(stats.count)}
                tone="navy"
                hint={`${qty(stats.lent > 0 ? 1 : 0)} lend${
                  stats.lent > 0 ? "" : "s"
                } recorded`}
              />
              <StatCard
                dense
                label="Status"
                value={settled ? "Closed" : owedToUs ? "Receivable" : "Payable"}
                tone={settled ? "profit" : owedToUs ? "warn" : "brand"}
                hint={
                  settled
                    ? "Nothing to chase"
                    : owedToUs
                      ? "Money coming back"
                      : "Money going out"
                }
              />
            </div>
          </SectionCard>

          {/* ---- quick actions ----------------------------------------- */}
          <SectionCard
            title="Recent entries"
            subtitle={`The last movements${
              range.from || range.to ? " in the selected period" : ""
            }`}
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            actions={
              <Button size="sm" onClick={() => setTab("statement")}>
                Statement
              </Button>
            }
          >
            {oldestFirst.length === 0 ? (
              <EmptyState
                compact
                icon={<HandCoins className="h-5 w-5" aria-hidden />}
                title="No entries on this ledger"
                message={`Lend cash to ${person.name} or record a repayment and the balance appears here.`}
                action={
                  <Button size="sm" variant="primary" onClick={() => setEntryKind("LEND")}>
                    Lend cash
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {[...oldestFirst].reverse().slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <StatusBadge
                      tone={
                        t.kind === "LEND" ? "warn" : t.kind === "BORROW" ? "brand" : "profit"
                      }
                    >
                      {coworkerLabel(t.kind)}
                    </StatusBadge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-ink">{t.notes || coworkerLabel(t.kind)}</p>
                      <p className="truncate text-2xs text-faint">{displayDate(t.txnDate)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tnum text-sm font-bold text-ink">
                        {money(t.amount, currency)}
                      </p>
                      <p
                        className={cn(
                          "tnum text-2xs",
                          Math.abs(t.balanceAfter) < 0.005
                            ? "text-profit-700"
                            : t.balanceAfter > 0
                              ? "text-warn-700"
                              : "text-brand-700",
                        )}
                      >
                        {Math.abs(t.balanceAfter) < 0.005
                          ? "Settled"
                          : `${money(Math.abs(t.balanceAfter), currency)} after`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* ---- ledger / statement tabs --------------------------------- */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div role="tablist" aria-label="Coworker ledger sections" className="flex gap-1">
            {(
              [
                { key: "ledger", label: "Ledger" },
                { key: "statement", label: "Statement" },
              ] as { key: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  tab === t.key
                    ? "bg-brand-600 text-white"
                    : "bg-canvas text-muted hover:bg-brand-50 hover:text-brand-800",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "ledger" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="From"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className={cn(
                  "input tnum h-9 w-36 text-xs",
                  range.from && "border-brand-400 bg-brand-50 text-brand-800",
                )}
              />
              <input
                type="date"
                aria-label="To"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className={cn(
                  "input tnum h-9 w-36 text-xs",
                  range.to && "border-brand-400 bg-brand-50 text-brand-800",
                )}
              />
              {(range.from || range.to) && (
                <Button size="sm" variant="ghost" onClick={() => setRange({ from: "", to: "" })}>
                  All time
                </Button>
              )}
            </div>
          )}
        </div>

        {tab === "ledger" ? (
          <SectionCard
            title={`${person.name}'s ledger`}
            subtitle={`${qty(oldestFirst.length)} entr${oldestFirst.length === 1 ? "y" : "ies"}, oldest first`}
            icon={<HandCoins className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[18rem]"
            actions={
              <>
                <Button
                  size="sm"
                  icon={<FileText className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    exportCsv(exportOpts());
                    toast.success("Ledger exported", "CSV file downloaded.");
                  }}
                >
                  CSV
                </Button>
                <Button
                  size="sm"
                  icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    exportExcel(exportOpts());
                    toast.success("Ledger exported", "Excel workbook downloaded.");
                  }}
                >
                  Excel
                </Button>
                <Button
                  size="sm"
                  icon={<Printer className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    const ok = exportPdf(exportOpts());
                    toast[ok ? "info" : "error"](
                      ok ? "Print dialog opened" : "Print dialog blocked",
                      ok
                        ? "Choose 'Microsoft Print to PDF' to save a PDF."
                        : "Allow pop-ups for this app, then try again.",
                    );
                  }}
                >
                  PDF
                </Button>
              </>
            }
          >
            {entriesState.loading && !entriesState.data ? (
              <LoadingState label="Loading ledger" />
            ) : entriesState.error ? (
              <div className="p-4">
                <InlineError message={entriesState.error} onRetry={entriesState.reload} />
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={visible}
                rowKey={(t) => t.id}
                footer={
                  oldestFirst.length > 0 ? (
                    <tr>
                      <td>Totals</td>
                      <td />
                      <td />
                      <td className="hidden md:table-cell" />
                      <td className="num">{money(stats.lent + stats.borrowed + stats.repaid, currency)}</td>
                      <td className="num">{money(balance, currency)}</td>
                    </tr>
                  ) : undefined
                }
                empty={
                  <EmptyState
                    icon={<HandCoins className="h-5 w-5" aria-hidden />}
                    title="Nothing on this ledger yet"
                    message={`Use the buttons above to lend cash, borrow from ${person.name}, or record a repayment. Every movement keeps the balance it produced.`}
                    action={
                      <Button size="sm" variant="primary" onClick={() => setEntryKind("LEND")}>
                        Lend cash
                      </Button>
                    }
                  />
                }
              />
            )}
            {oldestFirst.length > 0 && (
              <Pagination
                total={oldestFirst.length}
                pageSize={pageSize}
                page={page}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
                label="entries"
              />
            )}
          </SectionCard>
        ) : (
          <SectionCard
            title="Statement of account"
            subtitle="What was handed over, what came back, and the running balance"
            icon={<FileText className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[18rem]"
            actions={
              <>
                <Button
                  size="sm"
                  icon={<FileText className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    exportCsv({
                      filename: `zeus-coworker-statement-${person.name.replace(/\s+/g, "-").toLowerCase()}`,
                      title: `Coworker statement - ${person.name}`,
                      subtitle: `${qty(statement.lines.length)} lines`,
                      meta: [
                        { label: "Lent", value: money(statement.totalDebit, currency) },
                        { label: "Returned", value: money(statement.totalCredit, currency) },
                        { label: "Closing", value: money(statement.closing, currency) },
                      ],
                      columns: [
                        { header: "Date", value: (l) => l.date },
                        { header: "Reference", value: (l) => l.reference },
                        { header: "Description", value: (l) => l.description },
                        { header: "Lent", value: (l) => l.debit, numeric: true },
                        { header: "Returned", value: (l) => l.credit, numeric: true },
                        { header: "Balance", value: (l) => l.balance, numeric: true },
                      ],
                      rows: statement.lines,
                    });
                    toast.success("Statement exported", "CSV file downloaded.");
                  }}
                >
                  CSV
                </Button>
                <Button
                  size="sm"
                  icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    exportExcel({
                      filename: `zeus-coworker-statement-${person.name.replace(/\s+/g, "-").toLowerCase()}`,
                      title: `Coworker statement - ${person.name}`,
                      columns: [
                        { header: "Date", value: (l) => l.date },
                        { header: "Reference", value: (l) => l.reference },
                        { header: "Description", value: (l) => l.description },
                        { header: "Lent", value: (l) => l.debit, numeric: true },
                        { header: "Returned", value: (l) => l.credit, numeric: true },
                        { header: "Balance", value: (l) => l.balance, numeric: true },
                      ],
                      rows: statement.lines,
                    });
                    toast.success("Statement exported", "Excel workbook downloaded.");
                  }}
                >
                  Excel
                </Button>
                <Button
                  size="sm"
                  icon={<Printer className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    const ok = exportPdf({
                      filename: `zeus-coworker-statement-${person.name.replace(/\s+/g, "-").toLowerCase()}`,
                      title: `Coworker statement - ${person.name}`,
                      subtitle: `${qty(statement.lines.length)} lines - closing ${money(statement.closing, currency)}`,
                      meta: [
                        { label: "Lent", value: money(statement.totalDebit, currency) },
                        { label: "Returned", value: money(statement.totalCredit, currency) },
                        { label: "Closing", value: money(statement.closing, currency) },
                      ],
                      columns: [
                        { header: "Date", value: (l) => l.date },
                        { header: "Reference", value: (l) => l.reference },
                        { header: "Description", value: (l) => l.description },
                        { header: "Lent", value: (l) => l.debit, numeric: true },
                        { header: "Returned", value: (l) => l.credit, numeric: true },
                        { header: "Balance", value: (l) => l.balance, numeric: true },
                      ],
                      rows: statement.lines,
                    });
                    toast[ok ? "info" : "error"](
                      ok ? "Print dialog opened" : "Print dialog blocked",
                      ok
                        ? "Choose 'Microsoft Print to PDF' to save a PDF."
                        : "Allow pop-ups for this app, then try again.",
                    );
                  }}
                >
                  PDF
                </Button>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 border-b border-line p-4 md:grid-cols-4">
              <StatCard
                dense
                label="Total lent"
                value={money(statement.totalDebit, currency)}
                tone="warn"
              />
              <StatCard
                dense
                label="Total returned"
                value={money(statement.totalCredit, currency)}
                tone="profit"
                hint="Repayments and cash borrowed"
              />
              <StatCard
                dense
                label="Lines"
                value={qty(statement.lines.length)}
                tone="navy"
              />
              <StatCard
                dense
                label="Closing"
                value={money(statement.closing, currency)}
                tone={Math.abs(statement.closing) < 0.005 ? "profit" : "danger"}
                hint={
                  Math.abs(statement.closing) < 0.005
                    ? "Settled"
                    : statement.closing > 0
                      ? "They owe you"
                      : "You owe them"
                }
              />
            </div>
            <DataTable
              columns={[
                {
                  key: "date",
                  header: "Date",
                  width: "9rem",
                  cell: (l) => (
                    <span className="tnum text-xs text-muted">{displayDate(l.date)}</span>
                  ),
                },
                {
                  key: "reference",
                  header: "Reference",
                  width: "13rem",
                  cell: (l) => (
                    <span className="font-mono text-xs font-bold text-brand-800">
                      {l.reference}
                    </span>
                  ),
                },
                {
                  key: "description",
                  header: "Description",
                  cell: (l) => <span className="text-xs text-ink">{l.description}</span>,
                },
                {
                  key: "lent",
                  header: "Lent",
                  align: "right",
                  numeric: true,
                  cell: (l) => (
                    <span className={l.debit > 0 ? "text-ink" : "text-faint"}>
                      {l.debit > 0 ? money(l.debit, currency) : "-"}
                    </span>
                  ),
                },
                {
                  key: "returned",
                  header: "Returned",
                  align: "right",
                  numeric: true,
                  cell: (l) => (
                    <span className={l.credit > 0 ? "text-profit-700" : "text-faint"}>
                      {l.credit > 0 ? money(l.credit, currency) : "-"}
                    </span>
                  ),
                },
                {
                  key: "balance",
                  header: "Balance",
                  align: "right",
                  numeric: true,
                  cell: (l) => (
                    <span className="font-semibold text-ink">{money(l.balance, currency)}</span>
                  ),
                },
              ]}
              rows={statement.lines}
              rowKey={(l) => l.id}
              footer={
                statement.lines.length > 0 ? (
                  <tr>
                    <td colSpan={3}>Totals</td>
                    <td className="num">{money(statement.totalDebit, currency)}</td>
                    <td className="num">{money(statement.totalCredit, currency)}</td>
                    <td className="num">{money(statement.closing, currency)}</td>
                  </tr>
                ) : undefined
              }
              empty={
                <EmptyState
                  icon={<FileText className="h-5 w-5" aria-hidden />}
                  title="Nothing in this period"
                  message="Pick a wider date range, or record an entry to build the statement."
                  action={
                    (range.from || range.to) && (
                      <Button size="sm" onClick={() => setRange({ from: "", to: "" })}>
                        Show all time
                      </Button>
                    )
                  }
                />
              }
            />
          </SectionCard>
        )}
      </div>

      <CoworkerEntryDialog
        open={entryKind !== null}
        kind={entryKind ?? "LEND"}
        coworker={person}
        onClose={() => setEntryKind(null)}
        onCompleted={() => {
          setEntryKind(null);
          toast.success("Ledger updated", `The balance for ${person.name} has been recalculated.`);
          reloadAll();
        }}
      />

      <CoworkerFormDialog
        open={formOpen}
        editing={person}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          toast.success(`${person.name} updated`, "Their details have been saved.");
          personState.reload();
        }}
      />

      <ReasonDialog
        open={archiveOpen}
        title={person.isArchived ? `Restore ${person.name}` : `Archive ${person.name}`}
        description={
          person.isArchived
            ? `The coworker becomes active again and can be picked when you lend, borrow or record a repayment.`
            : "Archiving hides the coworker from the pickers. Their balance and every entry on the ledger are kept exactly as they are."
        }
        points={
          person.isArchived
            ? undefined
            : [
                `Balance stays as it is: ${
                  settled ? "settled" : money(balance, currency)
                }.`,
                "The full ledger stays readable on this page.",
                "You can restore this record at any time.",
              ]
        }
        confirmLabel="Explain why this coworker is being archived"
        confirmLabelShort={person.isArchived ? "Restore coworker" : "Archive coworker"}
        busy={archiveBusy}
        serverError={archiveError}
        placeholder="e.g. left the company"
        onConfirm={confirmArchive}
        onCancel={() => setArchiveOpen(false)}
      />
    </div>
  );
}