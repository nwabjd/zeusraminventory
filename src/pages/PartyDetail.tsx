import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Ban,
  Building2,
  FileSpreadsheet,
  FileText,
  Pencil,
  Phone,
  Printer,
  Receipt,
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
  paymentLabel,
  percent,
  qty,
} from "../lib/format";
import { useAsync, usePage } from "../lib/useAsync";
import { DateField, DatePresetBar } from "../components/shared";
import type { Party, Payment, Purchase, Sale, Statement, StatementLine } from "../lib/types";
import {
  ArchivedBadge,
  BalanceBadge,
  Button,
  DataList,
  DataTable,
  EmptyState,
  IconButton,
  InlineError,
  LoadingState,
  MoneyStat,
  PageHeader,
  Pagination,
  PaymentBadge,
  ReasonDialog,
  SectionCard,
  StatCard,
  StatusBadge,
  TransactionSummary,
  usePagedRows,
  useToast,
  type Column,
} from "../components/ui";
import { PartyFormDialog, PaymentDialog, ReturnDialog } from "../components/transactions";
import {
  exportCsv,
  exportExcel,
  exportPdf,
  type ExportColumn,
  type ExportOptions,
} from "../lib/export";

/* ===========================================================================
   Party profile
   ---------------------------------------------------------------------------
   One component drives both the buyer and the seller profile because the five
   sections are identical - who they are, what documents exist, what was paid,
   where the balance stands, and a printable statement. Only the document type
   and the direction of the money differ, and those are handled by `kind` plus
   the sign of every figure taken straight from the database.
   =========================================================================== */

export type PartyKind = "buyer" | "seller";
type Tab = "overview" | "transactions" | "payments" | "balance" | "statement";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "transactions", label: "Transactions" },
  { key: "payments", label: "Payments" },
  { key: "balance", label: "Balance" },
  { key: "statement", label: "Statement" },
];

const PAGE_SIZE = 25;

function TabBar({ tab, onChange, noun }: { tab: Tab; onChange: (t: Tab) => void; noun: string }) {
  return (
    <div role="tablist" aria-label={`${noun} sections`} className="flex flex-wrap gap-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={tab === t.key}
          onClick={() => onChange(t.key)}
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
  );
}

export function PartyDetail({ kind }: { kind: PartyKind }) {
  const { id = "" } = useParams();
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();

  const isBuyer = kind === "buyer";
  const noun = isBuyer ? "buyer" : "seller";
  const base = isBuyer ? "/buyers" : "/sellers";
  const docNoun = isBuyer ? "Sale" : "Purchase";
  const docPlural = isBuyer ? "sales" : "purchases";
  const docRoute = isBuyer ? "/sales" : "/purchases";
  const Icon = isBuyer ? Users : Building2;

  const [tab, setTab] = useState<Tab>("overview");
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [range, setRange] = useState({ from: "", to: "" });

  const [editing, setEditing] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [returnTarget, setReturnTarget] = useState<Sale | null>(null);

  const partyState = useAsync(
    () => (isBuyer ? api.getBuyer(id) : api.getSeller(id)),
    [id, isBuyer],
  );

  const salesState = useAsync(
    () => (isBuyer ? api.listSales({ buyerId: id }) : Promise.resolve<Sale[]>([])),
    [id, isBuyer],
    { skip: !isBuyer || !id },
  );

  const purchasesState = useAsync(
    () => (isBuyer ? Promise.resolve<Purchase[]>([]) : api.listPurchases({ sellerId: id })),
    [id, isBuyer],
    { skip: isBuyer || !id },
  );

  const paymentsState = useAsync(
    () => api.listPayments({ personType: kind, personId: id, from: range.from, to: range.to }),
    [id, kind, range.from, range.to],
    { skip: !id },
  );

  const statementState = useAsync(
    () => (isBuyer ? api.buyerStatement(id, range.from, range.to) : api.sellerStatement(id, range.from, range.to)),
    [id, isBuyer, range.from, range.to],
    { skip: !id },
  );

  const party = partyState.data;
  const statement = statementState.data;

  /* ---- every figure below comes from the database, never recomputed here -- */

  const docs = useMemo<(Sale | Purchase)[]>(
    () => (isBuyer ? (salesState.data ?? []) : (purchasesState.data ?? [])),
    [isBuyer, salesState.data, purchasesState.data],
  );

  const totals = useMemo(() => {
    let billed = 0;
    let settled = 0;
    let units = 0;
    let voided = 0;
    let profit = 0;
    let marginSum = 0;
    let marginCount = 0;
    docs.forEach((d) => {
      if (d.status === "void") {
        voided += 1;
        return;
      }
      billed += d.total;
      settled += isBuyer ? (d as Sale).received : (d as Purchase).paid;
      units += d.unitCount;
      if (isBuyer) {
        const s = d as Sale;
        profit += s.grossProfit;
        if (s.total > 0) {
          marginSum += s.profitMargin;
          marginCount += 1;
        }
      }
    });
    return {
      billed,
      settled,
      units,
      voided,
      profit,
      avgMargin: marginCount > 0 ? marginSum / marginCount : 0,
      count: docs.length,
    };
  }, [docs, isBuyer]);

  const payTotals = useMemo(() => {
    let total = 0;
    let reversed = 0;
    (paymentsState.data ?? []).forEach((p: Payment) => {
      if (p.status === "void") {
        reversed += p.amount;
        return;
      }
      total += p.amount;
    });
    return { total, reversed };
  }, [paymentsState.data]);

  const [docPage, setDocPage] = usePage(docs, pageSize);
  const visibleDocs = usePagedRows(docs, pageSize, docPage);

  const [payPage, setPayPage] = usePage(paymentsState.data ?? [], pageSize);
  const visiblePayments = usePagedRows(paymentsState.data ?? [], pageSize, payPage);

  const openDocs = useMemo(
    () => docs.filter((d) => d.status !== "void" && d.remaining > 0.005),
    [docs],
  );

  const reloadAll = () => {
    partyState.reload();
    if (isBuyer) void salesState.reload();
    else void purchasesState.reload();
    void paymentsState.reload();
    void statementState.reload();
  };

  /* ---- tables ----------------------------------------------------------- */

  const docColumns = useMemo<Column<Sale | Purchase>[]>(() => {
    const base: Column<Sale | Purchase>[] = [
      {
        key: "number",
        header: docNoun,
        width: "12rem",
        cell: (d) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-bold text-brand-800">
              {"saleNumber" in d ? d.saleNumber : d.purchaseNumber}
            </p>
            <p className="truncate text-2xs text-muted">
              {displayDate("saleDate" in d ? d.saleDate : d.purchaseDate)}
            </p>
          </div>
        ),
      },
      {
        key: "units",
        header: "Units",
        align: "right",
        numeric: true,
        hideBelow: "md",
        cell: (d) => <span className="text-muted">{qty(d.unitCount)}</span>,
      },
      {
        key: "total",
        header: "Total",
        align: "right",
        numeric: true,
        cell: (d) => <span className="font-semibold text-ink">{money(d.total, currency)}</span>,
      },
    ];

    if (isBuyer) {
      base.push({
        key: "cost",
        header: "Cost",
        align: "right",
        numeric: true,
        hideBelow: "lg",
        cell: (d) => <span className="text-muted">{money((d as Sale).totalCost, currency)}</span>,
      });
      base.push({
        key: "profit",
        header: "Profit",
        align: "right",
        numeric: true,
        cell: (d) => {
          const p = (d as Sale).grossProfit;
          return (
            <span className={cn("font-semibold", p >= 0 ? "text-profit-700" : "text-danger-700")}>
              {money(p, currency)}
            </span>
          );
        },
      });
    } else {
      base.push({
        key: "paid",
        header: "Paid",
        align: "right",
        numeric: true,
        hideBelow: "lg",
        cell: (d) => <span className="text-brand-700">{money((d as Purchase).paid, currency)}</span>,
      });
    }

    base.push({
      key: "balance",
      header: "Balance",
      align: "right",
      numeric: true,
      cell: (d) => (
        <span className={cn(d.remaining > 0.005 ? "font-semibold text-warn-700" : "text-profit-700")}>
          {d.status === "void" ? "-" : money(d.remaining, currency)}
        </span>
      ),
    });
    base.push({
      key: "status",
      header: "Status",
      cell: (d) => (
        <PaymentBadge
          total={d.total}
          settled={"received" in d ? d.received : d.paid}
          voided={d.status === "void"}
        />
      ),
    });
    base.push({
      key: "actions",
      header: "",
      align: "right",
      width: "6rem",
      cell: (d) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton
            label={`Open ${"saleNumber" in d ? d.saleNumber : d.purchaseNumber}`}
            tone="brand"
            onClick={() => navigate(`${docRoute}/${d.id}`)}
          >
            <Receipt className="h-4 w-4" aria-hidden />
          </IconButton>
          {isBuyer && (
            <IconButton
              label={`Return goods from ${(d as Sale).saleNumber}`}
              tone="warn"
              disabled={d.status === "void" || d.unitCount <= 0}
              onClick={() => setReturnTarget(d as Sale)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </IconButton>
          )}
        </div>
      ),
    });

    return base;
  }, [currency, docNoun, docRoute, isBuyer, navigate]);

  const paymentColumns = useMemo<Column<Payment>[]>(
    () => [
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
        cell: (p) => (
          <StatusBadge tone={p.status === "void" ? "neutral" : isBuyer ? "profit" : "brand"}>
            {paymentLabel(p.paymentType)}
          </StatusBadge>
        ),
      },
      {
        key: "method",
        header: "Method",
        hideBelow: "md",
        cell: (p) => (
          <div className="min-w-0">
            <p className="truncate text-xs text-ink">{p.paymentMethod}</p>
            {p.reference && <p className="truncate font-mono text-2xs text-faint">{p.reference}</p>}
          </div>
        ),
      },
      {
        key: "amount",
        header: "Amount",
        align: "right",
        numeric: true,
        cell: (p) => (
          <span
            className={cn(
              "font-bold",
              p.status === "void"
                ? "text-faint line-through"
                : isBuyer
                  ? "text-profit-700"
                  : "text-brand-700",
            )}
          >
            {isBuyer ? "+" : "-"}
            {money(p.amount, currency).replace("-", "")}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        cell: (p) => (
          <StatusBadge tone={p.status === "void" ? "neutral" : "info"}>
            {p.status === "void" ? "Reversed" : "Completed"}
          </StatusBadge>
        ),
      },
    ],
    [currency, isBuyer],
  );

  const statementColumns: Column<StatementLine>[] = [
    {
      key: "date",
      header: "Date",
      width: "8rem",
      cell: (l) => <span className="tnum text-xs text-muted">{displayDate(l.date)}</span>,
    },
    {
      key: "reference",
      header: "Reference",
      width: "12rem",
      cell: (l) => <span className="font-mono text-xs font-bold text-brand-800">{l.reference}</span>,
    },
    {
      key: "description",
      header: "Description",
      cell: (l) => <span className="text-xs text-ink">{l.description}</span>,
    },
    {
      key: "debit",
      header: "Debit",
      align: "right",
      numeric: true,
      cell: (l) => (
        <span className={l.debit > 0 ? "text-ink" : "text-faint"}>
          {l.debit > 0 ? money(l.debit, currency) : "-"}
        </span>
      ),
    },
    {
      key: "credit",
      header: "Credit",
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
      cell: (l) => <span className="font-semibold text-ink">{money(l.balance, currency)}</span>,
    },
  ];

  const docExportColumns: ExportColumn<Sale | Purchase>[] = isBuyer
    ? [
        { header: "Sale", value: (d) => ("saleNumber" in d ? d.saleNumber : "") },
        { header: "Date", value: (d) => ("saleDate" in d ? d.saleDate : "") },
        { header: "Units", value: (d) => d.unitCount, numeric: true },
        { header: "Total", value: (d) => d.total, numeric: true },
        { header: "Received", value: (d) => ("received" in d ? d.received : 0), numeric: true },
        { header: "Balance", value: (d) => d.remaining, numeric: true },
        { header: "Cost", value: (d) => ("totalCost" in d ? d.totalCost : 0), numeric: true },
        { header: "Profit", value: (d) => ("grossProfit" in d ? d.grossProfit : 0), numeric: true },
      ]
    : [
        { header: "Purchase", value: (d) => ("purchaseNumber" in d ? d.purchaseNumber : "") },
        { header: "Date", value: (d) => ("purchaseDate" in d ? d.purchaseDate : "") },
        { header: "Units", value: (d) => d.unitCount, numeric: true },
        { header: "Total", value: (d) => d.total, numeric: true },
        { header: "Paid", value: (d) => ("paid" in d ? d.paid : 0), numeric: true },
        { header: "Balance", value: (d) => d.remaining, numeric: true },
      ];

  const paymentExportColumns: ExportColumn<Payment>[] = [
    { header: "Payment", value: (p) => p.paymentId },
    { header: "Date", value: (p) => p.paymentDate },
    { header: "Type", value: (p) => paymentLabel(p.paymentType) },
    { header: "Method", value: (p) => p.paymentMethod },
    { header: "Reference", value: (p) => p.reference || "" },
    { header: "Amount", value: (p) => p.amount, numeric: true },
    { header: "Status", value: (p) => (p.status === "void" ? "Reversed" : "Completed") },
  ];

  /* ---- actions ---------------------------------------------------------- */

  const confirmArchive = async (reason: string) => {
    if (!party) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      if (isBuyer) await api.setBuyerArchived(party.id, !party.isArchived);
      else await api.setSellerArchived(party.id, !party.isArchived);
      toast.success(
        party.isArchived ? `${party.companyName} restored` : `${party.companyName} archived`,
        party.isArchived
          ? "The record is active again and appears in the pickers."
          : `Hidden from the pickers - all history kept. ${reason}`,
      );
      setArchiveOpen(false);
      partyState.reload();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  };

  const header = (
    <PageHeader
      title={party?.companyName ?? docNoun}
      subtitle={
        party
          ? `${party.code} - ${party.city || "No city on file"}${party.isArchived ? " - archived" : ""}`
          : "Loading"
      }
      icon={<Icon className="h-5 w-5" aria-hidden />}
      actions={
        <>
          <Button
            onClick={() => navigate(base)}
            icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
          >
            {isBuyer ? "All buyers" : "All sellers"}
          </Button>
          <Button onClick={() => setEditing(true)} icon={<Pencil className="h-4 w-4" aria-hidden />}>
            Edit
          </Button>
          <Button
            variant="danger-soft"
            onClick={() => {
              setArchiveError(null);
              setArchiveOpen(true);
            }}
            icon={<Archive className="h-4 w-4" aria-hidden />}
          >
            {party?.isArchived ? "Restore" : "Archive"}
          </Button>
          <Button
            variant={isBuyer ? "profit" : "primary"}
            onClick={() => setPaying(true)}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            disabled={!party || Math.abs(party.currentBalance) <= 0.005}
          >
            {isBuyer ? "Receive payment" : "Pay this supplier"}
          </Button>
        </>
      }
    />
  );

  if (partyState.loading && !party) {
    return (
      <div className="page">
        {header}
        <LoadingState label={`Loading ${noun}`} />
      </div>
    );
  }

  if (partyState.error && !party) {
    return (
      <div className="page">
        {header}
        <InlineError message={partyState.error} onRetry={partyState.reload} />
      </div>
    );
  }

  if (!party) return null;

  const owed = Math.max(0, party.currentBalance);
  const credit = Math.max(0, -party.currentBalance);

  return (
    <div className="page">
      {header}

      <div className="page-scroll space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label={isBuyer ? "Billed" : "Billed by supplier"}
            value={totals.billed}
            currency={currency}
            icon={<Receipt className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={`${qty(totals.count)} ${docNoun.toLowerCase()}${totals.count === 1 ? "" : "s"}, ${qty(totals.units)} units`}
          />
          <MoneyStat
            label={isBuyer ? "Received" : "Paid"}
            value={totals.settled}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone="profit"
            direction={isBuyer ? "up" : "down"}
            hint={`${money(payTotals.total, currency)} in payments`}
          />
          <MoneyStat
            label={isBuyer ? "Outstanding" : "Payable"}
            value={owed}
            currency={currency}
            icon={isBuyer ? <Wallet className="h-4 w-4" aria-hidden /> : <Ban className="h-4 w-4" aria-hidden />}
            tone={owed > 0.005 ? "danger" : "profit"}
            hint={
              owed > 0.005
                ? isBuyer
                  ? "Collect from this buyer"
                  : "Money going out"
                : credit > 0.005
                  ? "In credit"
                  : "Fully settled"
            }
          />
          {isBuyer ? (
            <StatCard
              label="Gross profit"
              value={money(totals.profit, currency)}
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              tone={totals.profit >= 0 ? "profit" : "danger"}
              hint={`Average margin ${percent(totals.avgMargin)}`}
            />
          ) : (
            <StatCard
              label="Units bought"
              value={qty(totals.units)}
              icon={<Building2 className="h-4 w-4" aria-hidden />}
              tone="brand"
              hint={totals.voided > 0 ? `${qty(totals.voided)} voided excluded` : "No voids"}
            />
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <TabBar tab={tab} onChange={setTab} noun={noun} />
          <div className="flex items-end gap-2">
            <DateField
              label="From"
              value={range.from}
              onChange={(from) => setRange((r) => ({ ...r, from }))}
              className="w-36"
            />
            <DateField
              label="To"
              value={range.to}
              onChange={(to) => setRange((r) => ({ ...r, to }))}
              className="w-36"
            />
          </div>
        </div>

        {/* ---------------------------------------------------- overview -- */}
        {tab === "overview" && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SectionCard
              title="Contact"
              subtitle="How to reach them"
              icon={<Phone className="h-4 w-4" aria-hidden />}
              bodyClassName="p-4"
            >
              <DataList
                columns={1}
                items={[
                  { label: "Company", value: party.companyName },
                  { label: "Contact person", value: party.contactPerson },
                  {
                    label: "Phone",
                    value: party.phone ? (
                      <a className="link" href={`tel:${party.phone.replace(/\s+/g, "")}`}>
                        {party.phone}
                      </a>
                    ) : (
                      "-"
                    ),
                  },
                  {
                    label: "WhatsApp",
                    value: party.whatsapp ? (
                      <a
                        className="link"
                        href={`https://wa.me/${party.whatsapp.replace(/[^\d]/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {party.whatsapp}
                      </a>
                    ) : (
                      "-"
                    ),
                  },
                  {
                    label: "Email",
                    value: party.email ? (
                      <a className="link" href={`mailto:${party.email}`}>
                        {party.email}
                      </a>
                    ) : (
                      "-"
                    ),
                  },
                  { label: "Address", value: party.address },
                  { label: "City", value: party.city },
                  { label: "TRN / VAT", value: party.trnVat },
                ]}
              />
              {party.notes && (
                <p className="mt-3 rounded-lg border border-line bg-canvas p-2.5 text-xs leading-relaxed text-muted">
                  {party.notes}
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Account"
              subtitle="Position and history"
              icon={<Wallet className="h-4 w-4" aria-hidden />}
              bodyClassName="p-4"
            >
              <TransactionSummary
                lines={[
                  { label: "Opening balance", value: money(party.openingBalance, currency) },
                  { label: "Billed", value: money(totals.billed, currency) },
                  {
                    label: isBuyer ? "Received" : "Paid",
                    value: `${isBuyer ? "" : "- "}${money(totals.settled, currency)}`,
                    tone: "profit",
                  },
                  {
                    label: "Current balance",
                    value: money(party.currentBalance, currency),
                    hint: owed > 0.005 ? (isBuyer ? "owes you" : "you owe") : credit > 0.005 ? "in credit" : "settled",
                    tone: owed > 0.005 ? "danger" : credit > 0.005 ? "warn" : "profit",
                    strong: true,
                  },
                ]}
              />
              <div className="mt-3">
                <DataList
                  items={[
                    { label: `Total ${docNoun.toLowerCase()}s`, value: qty(party.transactionCount) },
                    { label: "Voided", value: qty(totals.voided) },
                    { label: isBuyer ? "Units bought" : "Units bought", value: qty(totals.units) },
                    { label: "Created", value: displayDate(party.createdAt) },
                    { label: "Last activity", value: displayDate(party.lastActivity) },
                    { label: "Last updated", value: displayDateTime(party.updatedAt) },
                  ]}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <BalanceBadge balance={party.currentBalance} owedByThem={isBuyer} />
                <ArchivedBadge archived={party.isArchived} />
                <span className="text-2xs text-faint">
                  {totals.voided > 0
                    ? `${qty(totals.voided)} voided document(s) excluded from every total`
                    : "No voided documents"}
                </span>
              </div>
            </SectionCard>

            <SectionCard
              title={`Recent ${docPlural}`}
              subtitle="The last documents on this account"
              icon={<Receipt className="h-4 w-4" aria-hidden />}
              bodyClassName="p-0"
            >
              {docs.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Receipt className="h-5 w-5" aria-hidden />}
                  title={`No ${docPlural} yet`}
                  message={`Record a ${docNoun.toLowerCase()} and it will appear here.`}
                  action={
                    <Button size="sm" onClick={() => navigate(docRoute)}>
                      Go to {docPlural}
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-line">
                  {docs.slice(0, 8).map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`${docRoute}/${d.id}`)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs font-bold text-brand-800">
                            {"saleNumber" in d ? d.saleNumber : d.purchaseNumber}
                          </p>
                          <p className="truncate text-2xs text-muted">
                            {displayDate("saleDate" in d ? d.saleDate : d.purchaseDate)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tnum text-sm font-semibold text-ink">{money(d.total, currency)}</p>
                          <p
                            className={cn(
                              "tnum text-2xs",
                              d.remaining > 0.005 ? "text-warn-700" : "text-profit-700",
                            )}
                          >
                            {d.remaining > 0.005 ? `${money(d.remaining, currency)} due` : "Settled"}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        )}

        {/* ----------------------------------------------- transactions -- */}
        {tab === "transactions" && (
          <SectionCard
            title={isBuyer ? "Sales history" : "Purchase history"}
            subtitle={`${qty(totals.count)} ${docNoun.toLowerCase()}${totals.count === 1 ? "" : "s"} on this account`}
            icon={<Receipt className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[18rem]"
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    exportCsv({
                      filename: `zeus-${noun}-${party.code}-${docPlural}`,
                      title: `${isBuyer ? "Sales" : "Purchases"} - ${party.companyName}`,
                      subtitle: `${qty(totals.count)} documents - ${money(totals.billed, currency)} billed`,
                      meta: [
                        { label: "Settled", value: money(totals.settled, currency) },
                        { label: "Balance", value: money(party.currentBalance, currency) },
                      ],
                      columns: docExportColumns,
                      rows: docs,
                    });
                    toast.success("Exported", "CSV file downloaded.");
                  }}
                  icon={<FileText className="h-4 w-4" aria-hidden />}
                >
                  CSV
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    exportExcel({
                      filename: `zeus-${noun}-${party.code}-${docPlural}`,
                      title: `${isBuyer ? "Sales" : "Purchases"} - ${party.companyName}`,
                      columns: docExportColumns,
                      rows: docs,
                    });
                    toast.success("Exported", "Excel workbook downloaded.");
                  }}
                  icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
                >
                  Excel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const ok = exportPdf({
                      filename: `zeus-${noun}-${party.code}-${docPlural}`,
                      title: `${isBuyer ? "Sales" : "Purchases"} - ${party.companyName}`,
                      columns: docExportColumns,
                      rows: docs,
                    });
                    toast[ok ? "info" : "error"](
                      ok ? "Print dialog opened" : "Print dialog blocked",
                      ok ? "Choose 'Microsoft Print to PDF'." : "Allow pop-ups for this app.",
                    );
                  }}
                  icon={<Printer className="h-4 w-4" aria-hidden />}
                >
                  PDF
                </Button>
              </>
            }
          >
            {docs.length === 0 ? (
              <EmptyState
                icon={<Receipt className="h-5 w-5" aria-hidden />}
                title={`No ${docPlural} on this account yet`}
                message={`Record a ${docNoun.toLowerCase()} and the document, its cost and its settlement state appear here.`}
                action={
                  <Button
                    size="sm"
                    variant={isBuyer ? "danger" : "profit"}
                    onClick={() => navigate(docRoute)}
                  >
                    Go to {docPlural}
                  </Button>
                }
              />
            ) : (
              <DataTable
                columns={docColumns}
                rows={visibleDocs}
                rowKey={(d) => d.id}
                onRowClick={(d) => navigate(`${docRoute}/${d.id}`)}
                footer={
                  <tr>
                    <td>Totals</td>
                    <td className="num hidden md:table-cell">{qty(totals.units)}</td>
                    <td className="num">{money(totals.billed, currency)}</td>
                    <td className="num hidden lg:table-cell" />
                    <td className="num hidden lg:table-cell" />
                    <td className="num">{money(openDocs.reduce((a, d) => a + d.remaining, 0), currency)}</td>
                    <td />
                    <td />
                  </tr>
                }
              />
            )}
            {docs.length > 0 && (
              <Pagination
                total={docs.length}
                pageSize={pageSize}
                page={docPage}
                onPageChange={setDocPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setDocPage(1);
                }}
                label={docPlural}
              />
            )}
          </SectionCard>
        )}

        {/* ---------------------------------------------------- payments -- */}
        {tab === "payments" && (
          <SectionCard
            title={isBuyer ? "Payments received" : "Payments made"}
            subtitle={
              range.from || range.to
                ? "Within the selected date range"
                : "Every payment on this account"
            }
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[18rem]"
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    exportCsv({
                      filename: `zeus-${noun}-${party.code}-payments`,
                      title: `Payments - ${party.companyName}`,
                      subtitle: `${qty((paymentsState.data ?? []).length)} payments`,
                      meta: [{ label: "Total", value: money(payTotals.total, currency) }],
                      columns: paymentExportColumns,
                      rows: paymentsState.data ?? [],
                    });
                    toast.success("Exported", "CSV file downloaded.");
                  }}
                  icon={<FileText className="h-4 w-4" aria-hidden />}
                >
                  CSV
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    exportExcel({
                      filename: `zeus-${noun}-${party.code}-payments`,
                      title: `Payments - ${party.companyName}`,
                      columns: paymentExportColumns,
                      rows: paymentsState.data ?? [],
                    });
                    toast.success("Exported", "Excel workbook downloaded.");
                  }}
                  icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
                >
                  Excel
                </Button>
                <Button
                  size="sm"
                  variant={isBuyer ? "profit" : "primary"}
                  onClick={() => setPaying(true)}
                  icon={<Wallet className="h-4 w-4" aria-hidden />}
                >
                  {isBuyer ? "Record receipt" : "Record payment"}
                </Button>
              </>
            }
          >
            {paymentsState.loading && !paymentsState.data ? (
              <LoadingState label="Loading payments" />
            ) : paymentsState.error ? (
              <div className="p-4">
                <InlineError message={paymentsState.error} onRetry={paymentsState.reload} />
              </div>
            ) : (
              <DataTable
                columns={paymentColumns}
                rows={visiblePayments}
                rowKey={(p) => p.id}
                footer={
                  (paymentsState.data ?? []).length > 0 ? (
                    <tr>
                      <td>Totals</td>
                      <td />
                      <td className="hidden md:table-cell" />
                      <td className="num">{money(payTotals.total, currency)}</td>
                      <td />
                    </tr>
                  ) : undefined
                }
                empty={
                  <EmptyState
                    icon={<Wallet className="h-5 w-5" aria-hidden />}
                    title="No payments recorded"
                    message={
                      isBuyer
                        ? "When this buyer pays, record it here and their outstanding balance falls."
                        : "When you pay this supplier, record it here and what you owe falls."
                    }
                    action={
                      <Button
                        size="sm"
                        variant={isBuyer ? "profit" : "primary"}
                        onClick={() => setPaying(true)}
                      >
                        {isBuyer ? "Record a receipt" : "Record a payment"}
                      </Button>
                    }
                  />
                }
              />
            )}
            {(paymentsState.data ?? []).length > 0 && (
              <Pagination
                total={(paymentsState.data ?? []).length}
                pageSize={pageSize}
                page={payPage}
                onPageChange={setPayPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPayPage(1);
                }}
                label="payments"
              />
            )}
          </SectionCard>
        )}

        {/* ----------------------------------------------------- balance -- */}
        {tab === "balance" && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SectionCard
              title="How the balance was built"
              subtitle={
                isBuyer
                  ? "Everything billed to the buyer, less everything received"
                  : "Everything the supplier billed you, less everything you paid"
              }
              icon={<Wallet className="h-4 w-4" aria-hidden />}
              bodyClassName="p-4"
            >
              <TransactionSummary
                lines={[
                  { label: "Opening balance", value: money(party.openingBalance, currency) },
                  { label: "Billed", value: money(totals.billed, currency) },
                  {
                    label: isBuyer ? "Received" : "Paid",
                    value: `${isBuyer ? "" : "- "}${money(totals.settled, currency)}`,
                    tone: "profit",
                  },
                  {
                    label: "Balance now",
                    value: money(party.currentBalance, currency),
                    tone: owed > 0.005 ? "danger" : credit > 0.005 ? "warn" : "profit",
                    strong: true,
                  },
                ]}
              />
              <div className="mt-3">
                <DataList
                  items={[
                    { label: "Lifetime billed", value: money(party.totalPurchases, currency) },
                    { label: "Lifetime settled", value: money(party.totalPaid, currency) },
                    { label: "Lifetime outstanding", value: money(party.totalOutstanding, currency) },
                    { label: "Documents", value: qty(party.transactionCount) },
                    { label: "Last activity", value: displayDate(party.lastActivity) },
                  ]}
                />
              </div>
            </SectionCard>

            <SectionCard
              title={isBuyer ? "Open invoices" : "Open orders"}
              subtitle={`${qty(openDocs.length)} document${openDocs.length === 1 ? "" : "s"} still carrying a balance`}
              icon={<Receipt className="h-4 w-4" aria-hidden />}
              bodyClassName="p-0"
            >
              <DataTable
                columns={[
                  {
                    key: "ref",
                    header: docNoun,
                    cell: (d: Sale | Purchase) => (
                      <button
                        type="button"
                        className="link font-mono text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`${docRoute}/${d.id}`);
                        }}
                      >
                        {"saleNumber" in d ? d.saleNumber : d.purchaseNumber}
                      </button>
                    ),
                  },
                  {
                    key: "date",
                    header: "Date",
                    hideBelow: "md",
                    cell: (d: Sale | Purchase) => (
                      <span className="text-xs text-muted">
                        {displayDate("saleDate" in d ? d.saleDate : d.purchaseDate)}
                      </span>
                    ),
                  },
                  {
                    key: "total",
                    header: "Total",
                    align: "right",
                    numeric: true,
                    cell: (d: Sale | Purchase) => <span className="text-ink">{money(d.total, currency)}</span>,
                  },
                  {
                    key: "remaining",
                    header: "Balance",
                    align: "right",
                    numeric: true,
                    cell: (d: Sale | Purchase) => (
                      <span className="font-semibold text-warn-700">{money(d.remaining, currency)}</span>
                    ),
                  },
                ]}
                rows={openDocs}
                rowKey={(d) => d.id}
                onRowClick={(d) => navigate(`${docRoute}/${d.id}`)}
                footer={
                  openDocs.length > 0 ? (
                    <tr>
                      <td>Totals</td>
                      <td className="hidden md:table-cell" />
                      <td className="num">{money(openDocs.reduce((a, d) => a + d.total, 0), currency)}</td>
                      <td className="num">
                        {money(openDocs.reduce((a, d) => a + d.remaining, 0), currency)}
                      </td>
                    </tr>
                  ) : undefined
                }
                empty={
                  <EmptyState
                    compact
                    icon={<Receipt className="h-5 w-5" aria-hidden />}
                    title="Nothing outstanding"
                    message={`Every ${docNoun.toLowerCase()} on this account is settled in full.`}
                  />
                }
              />
            </SectionCard>
          </div>
        )}

        {/* --------------------------------------------------- statement -- */}
        {tab === "statement" && (
          <SectionCard
            title="Statement of account"
            subtitle={`Running balance from every ${docNoun.toLowerCase()}, payment and return${
              range.from || range.to ? " in the selected range" : " - all time"
            }`}
            icon={<FileText className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[18rem]"
            actions={
              <>
                <DatePresetBar from={range.from} to={range.to} onChange={setRange} />
                <Button
                  size="sm"
                  onClick={() => {
                    exportCsv(statementExport(party, statement, currency));
                    toast.success("Statement exported", "CSV file downloaded.");
                  }}
                  icon={<FileText className="h-4 w-4" aria-hidden />}
                >
                  CSV
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    exportExcel(statementExport(party, statement, currency));
                    toast.success("Statement exported", "Excel workbook downloaded.");
                  }}
                  icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
                >
                  Excel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const ok = exportPdf(statementExport(party, statement, currency));
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
              </>
            }
          >
            {statementState.loading && !statement ? (
              <LoadingState label="Building statement" />
            ) : statementState.error ? (
              <div className="p-4">
                <InlineError message={statementState.error} onRetry={statementState.reload} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 border-b border-line p-4 md:grid-cols-4">
                  <StatCard
                    dense
                    label="Opening"
                    value={money(statement?.openingBalance ?? 0, currency)}
                    tone="neutral"
                  />
                  <StatCard
                    dense
                    label="Total debits"
                    value={money(statement?.totalDebit ?? 0, currency)}
                    tone="warn"
                    hint={isBuyer ? "Invoiced to them" : "Invoiced to you"}
                  />
                  <StatCard
                    dense
                    label="Total credits"
                    value={money(statement?.totalCredit ?? 0, currency)}
                    tone="profit"
                    hint="Received, paid and returned"
                  />
                  <StatCard
                    dense
                    label="Closing"
                    value={money(statement?.closingBalance ?? 0, currency)}
                    tone={(statement?.closingBalance ?? 0) > 0.005 ? "danger" : "profit"}
                    hint={isBuyer ? "Payable by them" : "Payable by ZEUS"}
                  />
                </div>
                <DataTable
                  columns={statementColumns}
                  rows={statement?.lines ?? []}
                  rowKey={(l, i) => `${l.reference}-${l.date}-${i}`}
                  footer={
                    (statement?.lines.length ?? 0) > 0 ? (
                      <tr>
                        <td colSpan={3}>Totals</td>
                        <td className="num">{money(statement?.totalDebit ?? 0, currency)}</td>
                        <td className="num">{money(statement?.totalCredit ?? 0, currency)}</td>
                        <td className="num">{money(statement?.closingBalance ?? 0, currency)}</td>
                      </tr>
                    ) : undefined
                  }
                  empty={
                    <EmptyState
                      icon={<FileText className="h-5 w-5" aria-hidden />}
                      title="No movement in this period"
                      message="Pick a wider date range, or record a document to build the statement."
                      action={
                        <Button size="sm" onClick={() => setRange({ from: "", to: "" })}>
                          Show all time
                        </Button>
                      }
                    />
                  }
                />
              </>
            )}
          </SectionCard>
        )}
      </div>

      <PartyFormDialog
        open={editing}
        kind={kind}
        editing={party}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          toast.success(`${noun === "buyer" ? "Buyer" : "Seller"} updated`, `${party.companyName} has been saved.`);
          partyState.reload();
        }}
      />

      <PaymentDialog
        open={paying}
        mode={isBuyer ? "receive" : "pay"}
        onClose={() => setPaying(false)}
        onCompleted={() => {
          setPaying(false);
          toast.success(
            isBuyer ? "Payment received" : "Payment recorded",
            "The account balance has been updated.",
          );
          reloadAll();
        }}
      />

      <ReturnDialog
        open={returnTarget !== null}
        mode="sale"
        reference={returnTarget}
        onClose={() => setReturnTarget(null)}
        onCompleted={() => {
          setReturnTarget(null);
          toast.success("Return recorded", "Stock is back in the catalogue and the balance adjusted.");
          reloadAll();
        }}
      />

      <ReasonDialog
        open={archiveOpen}
        title={party.isArchived ? `Restore ${party.companyName}` : `Archive ${party.companyName}`}
        description={
          party.isArchived
            ? `The ${noun} becomes active again and can be picked in ${isBuyer ? "SELL RAM" : "BUY RAM"}.`
            : `Archiving hides the ${noun} from the pickers. Every document, payment and statement line is kept.`
        }
        points={
          party.isArchived
            ? undefined
            : [
                `Balance stays as it is: ${money(party.currentBalance, currency)}.`,
                "History and statements remain complete.",
                "You can restore this record at any time.",
              ]
        }
        confirmLabel={`Explain why this ${noun} is being archived`}
        confirmLabelShort={party.isArchived ? `Restore ${noun}` : `Archive ${noun}`}
        busy={archiveBusy}
        serverError={archiveError}
        placeholder={isBuyer ? "e.g. no longer trading with us" : "e.g. switched distributor"}
        onConfirm={confirmArchive}
        onCancel={() => setArchiveOpen(false)}
      />
    </div>
  );
}

function statementExport(
  party: Party,
  statement: Statement | null,
  currency: string,
): ExportOptions<StatementLine> {
  return {
    filename: `zeus-statement-${party.code}`,
    title: `Statement - ${party.companyName}`,
    subtitle: statement
      ? `${qty(statement.lines.length)} lines - closing ${money(statement.closingBalance, currency)}`
      : "No movement in this period",
    meta: [
      { label: "Code", value: party.code },
      { label: "Opening", value: money(statement?.openingBalance ?? 0, currency) },
      { label: "Debits", value: money(statement?.totalDebit ?? 0, currency) },
      { label: "Credits", value: money(statement?.totalCredit ?? 0, currency) },
      { label: "Closing", value: money(statement?.closingBalance ?? 0, currency) },
    ],
    columns: [
      { header: "Date", value: (l: StatementLine) => l.date },
      { header: "Reference", value: (l: StatementLine) => l.reference },
      { header: "Description", value: (l: StatementLine) => l.description },
      { header: "Debit", value: (l: StatementLine) => l.debit, numeric: true },
      { header: "Credit", value: (l: StatementLine) => l.credit, numeric: true },
      { header: "Balance", value: (l: StatementLine) => l.balance, numeric: true },
    ],
    rows: statement?.lines ?? [],
  };
}