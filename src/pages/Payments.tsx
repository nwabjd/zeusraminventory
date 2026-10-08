import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CreditCard,
  Eye,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Printer,
  RotateCcw,
  UsersRound,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { useCurrency } from "../lib/app-context";
import {
  cn,
  displayDate,
  money,
  paymentLabel,
  personLabel,
  qty,
} from "../lib/format";
import { useAsync, useDebounced, usePage } from "../lib/useAsync";
import { PAYMENT_METHODS } from "../lib/constants";
import type { Payment } from "../lib/types";
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
import { CoworkerPaymentDialog, PaymentDialog } from "../components/transactions";
import { DateField, DatePresetBar } from "../components/shared";
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "../lib/export";

/* ===========================================================================
   Payments
   ---------------------------------------------------------------------------
   One ledger for every rupee that moves: money in from buyers, money out to
   suppliers, and the coworker side of the business. Three entry points, one
   register, and a running net position so the operator can see the month at a
   glance before opening the reports.
   =========================================================================== */

interface Filters {
  search: string;
  paymentType: string;
  personType: string;
  method: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  paymentType: "",
  personType: "",
  method: "",
  status: "",
  from: "",
  to: "",
};

const TYPE_OPTIONS = [
  { value: "RECEIVE_FROM_BUYER", label: "Received from buyer" },
  { value: "PAY_SELLER", label: "Paid to seller" },
  { value: "COWORKER_LEND", label: "Lent to coworker" },
  { value: "COWORKER_BORROW", label: "Borrowed from coworker" },
  { value: "COWORKER_RECEIVE", label: "Coworker repayment" },
  { value: "COWORKER_REPAY", label: "Repaid coworker" },
];

const PERSON_TYPE_OPTIONS = [
  { value: "buyer", label: "Buyers" },
  { value: "seller", label: "Sellers" },
  { value: "coworker", label: "Coworkers" },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "void", label: "Voided" },
];

const PAGE_SIZE = 25;

/** Payments that bring cash in vs. payments that take cash out. */
const INFLOW_TYPES = new Set(["RECEIVE_FROM_BUYER", "COWORKER_RECEIVE"]);
const OUTFLOW_TYPES = new Set([
  "PAY_SELLER",
  "COWORKER_LEND",
  "COWORKER_BORROW",
  "COWORKER_REPAY",
]);

export default function Payments() {
  const currency = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showFilters, setShowFilters] = useState(false);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [coworkerOpen, setCoworkerOpen] = useState(false);
  const [reverse, setReverse] = useState<Payment | null>(null);
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(filters.search, 220);

  const state = useAsync(
    () =>
      api.listPayments({
        search: debouncedSearch,
        paymentType: filters.paymentType,
        personType: filters.personType,
        method: filters.method,
        status: filters.status,
        from: filters.from,
        to: filters.to,
      }),
    [
      debouncedSearch,
      filters.paymentType,
      filters.personType,
      filters.method,
      filters.status,
      filters.from,
      filters.to,
    ],
  );

  const totalsState = useAsync(
    () =>
      api.paymentTotals(
        filters.from,
        filters.to,
        filters.paymentType || undefined,
      ),
    [filters.from, filters.to, filters.paymentType],
  );

  const all = state.data ?? [];
  const [page, setPage] = usePage(all, pageSize);
  const visible = usePagedRows(all, pageSize, page);

  /* Derived from the visible rows so the cards always agree with the table. */
  const summary = useMemo(() => {
    let received = 0;
    let paid = 0;
    let voided = 0;
    all.forEach((p) => {
      if (p.status === "void") {
        voided += 1;
        return;
      }
      if (INFLOW_TYPES.has(p.paymentType)) received += p.amount;
      else if (OUTFLOW_TYPES.has(p.paymentType)) paid += p.amount;
    });
    return { received, paid, net: received - paid, voided, count: all.length };
  }, [all]);

  const byMethod = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    all.forEach((p) => {
      if (p.status === "void") return;
      const row = map.get(p.paymentMethod) ?? { count: 0, total: 0 };
      row.count += 1;
      row.total += p.amount;
      map.set(p.paymentMethod, row);
    });
    return Array.from(map.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [all]);

  const maxMethod = useMemo(
    () => byMethod.reduce((m, r) => Math.max(m, r.total), 0),
    [byMethod],
  );

  const set =
    (key: keyof Filters) =>
    (value: string): void =>
      setFilters((f) => ({ ...f, [key]: value === "all" ? "" : value }));

  const clearAll = () => setFilters(EMPTY_FILTERS);
  const activeCount = Object.values(filters).filter(Boolean).length;

  const reloadAll = () => {
    state.reload();
    totalsState.reload();
  };

  const exportColumns: ExportColumn<Payment>[] = [
    { header: "Payment", value: (p) => p.paymentId },
    { header: "Date", value: (p) => p.paymentDate },
    { header: "Type", value: (p) => paymentLabel(p.paymentType) },
    { header: "Person type", value: (p) => personLabel(p.personType) },
    { header: "Person", value: (p) => p.personName },
    { header: "Amount", value: (p) => p.amount, numeric: true },
    { header: "Method", value: (p) => p.paymentMethod },
    { header: "Reference", value: (p) => p.reference || "" },
    { header: "Status", value: (p) => (p.status === "void" ? "Reversed" : "Completed") },
    { header: "Notes", value: (p) => p.notes || "" },
  ];

  const exportOpts = () => ({
    filename: "zeus-payments",
    title: "Payment ledger",
    subtitle: `${qty(summary.count)} payments - net ${money(summary.net, currency)}`,
    meta: [
      { label: "Received", value: money(summary.received, currency) },
      { label: "Paid out", value: money(summary.paid, currency) },
      { label: "Net", value: money(summary.net, currency) },
      { label: "From", value: filters.from || "Any date" },
      { label: "To", value: filters.to || "Today" },
    ],
    columns: exportColumns,
    rows: all,
  });

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
      cell: (p) => (
        <StatusBadge
          tone={
            p.status === "void"
              ? "neutral"
              : INFLOW_TYPES.has(p.paymentType)
                ? "profit"
                : "brand"
          }
        >
          {paymentLabel(p.paymentType)}
        </StatusBadge>
      ),
    },
    {
      key: "person",
      header: "Person",
      cell: (p) => (
        <div className="min-w-0">
          <button
            type="button"
            className="link block max-w-full truncate text-xs"
            onClick={(e) => {
              e.stopPropagation();
              if (p.personType === "coworker" && p.personId) {
                navigate(`/coworker-ledger/${p.personId}`);
              } else if (p.personType === "buyer" && p.personId) {
                navigate(`/buyers/${p.personId}`);
              } else if (p.personType === "seller" && p.personId) {
                navigate(`/sellers/${p.personId}`);
              }
            }}
          >
            {p.personName}
          </button>
          <p className="truncate text-2xs text-faint">{personLabel(p.personType)}</p>
        </div>
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
              : INFLOW_TYPES.has(p.paymentType)
                ? "text-profit-700"
                : "text-brand-700",
          )}
        >
          {INFLOW_TYPES.has(p.paymentType) ? "+" : "-"}
          {money(p.amount, currency).replace("-", "")}
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
    {
      key: "actions",
      header: "",
      align: "right",
      width: "6rem",
      cell: (p) => (
        <div
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton
            label={
              p.personType === "coworker" && p.personId
                ? `Open the ledger for ${p.personName}`
                : `Open ${p.personName}`
            }
            tone="brand"
            onClick={() => {
              if (p.personType === "coworker" && p.personId) navigate(`/coworker-ledger/${p.personId}`);
              else if (p.personType === "buyer" && p.personId) navigate(`/buyers/${p.personId}`);
              else if (p.personType === "seller" && p.personId) navigate(`/sellers/${p.personId}`);
              else navigate("/payments");
            }}
          >
            <Eye className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Reverse ${p.paymentId}`}
            tone="danger"
            disabled={p.status === "void"}
            onClick={() => {
              setReverseError(null);
              setReverse(p);
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      ),
    },
  ];

  const confirmReverse = async (reason: string) => {
    const target = reverse;
    if (!target) return;
    setReversing(true);
    setReverseError(null);
    try {
      await api.reversePayment(target.id, reason);
      toast.success(
        `${target.paymentId} reversed`,
        "The amount has been put back on the account balance and the ledger records why.",
      );
      setReverse(null);
      reloadAll();
    } catch (err) {
      setReverseError(err instanceof Error ? err.message : String(err));
    } finally {
      setReversing(false);
    }
  };

  const done = (what: string) => {
    toast.success(what, "The balance has been updated and the ledger refreshed.");
    reloadAll();
  };

  return (
    <div className="page">
      <PageHeader
        title="Payments"
        subtitle="Every payment in and out, with the running net position"
        icon={<CreditCard className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              onClick={() => {
                exportCsv(exportOpts());
                toast.success("Payments exported", "CSV file downloaded.");
              }}
              icon={<FileText className="h-4 w-4" aria-hidden />}
            >
              CSV
            </Button>
            <Button
              onClick={() => {
                exportExcel(exportOpts());
                toast.success("Payments exported", "Excel workbook downloaded.");
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
            <Button variant="primary" onClick={() => setPayOpen(true)} icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}>
              Pay seller
            </Button>
            <Button variant="profit" onClick={() => setReceiveOpen(true)} icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}>
              Receive payment
            </Button>
          </>
        }
      >
        <FilterBar
          search={
            <SearchInput
              value={filters.search}
              onValueChange={(v) => setFilters((f) => ({ ...f, search: v }))}
              placeholder="Search payment number, person, reference..."
              className="w-full sm:w-80"
            />
          }
          fields={[
            { key: "paymentType", label: "Type", value: filters.paymentType, options: TYPE_OPTIONS, onChange: set("paymentType") },
            { key: "personType", label: "Person", value: filters.personType, options: PERSON_TYPE_OPTIONS, onChange: set("personType") },
            { key: "method", label: "Method", value: filters.method, options: PAYMENT_METHODS.map((m) => ({ value: m, label: m })), onChange: set("method") },
            { key: "status", label: "Status", value: filters.status, options: PAYMENT_STATUS_OPTIONS, onChange: set("status") },
          ]}
        >
          <Button
            size="sm"
            variant={showFilters ? "primary" : "secondary"}
            onClick={() => setShowFilters((v) => !v)}
          >
            Dates
          </Button>
        </FilterBar>

        {showFilters && (
          <div className="anim-fade-in card mt-2 grid grid-cols-2 items-end gap-3 p-3 md:grid-cols-4">
            <DateField label="From" value={filters.from} onChange={set("from")} />
            <DateField label="To" value={filters.to} onChange={set("to")} />
            <DatePresetBar
              from={filters.from}
              to={filters.to}
              onChange={({ from, to }) => setFilters((f) => ({ ...f, from, to }))}
              className="col-span-2 md:col-span-2"
            />
          </div>
        )}
      </PageHeader>

      <div className="page-scroll space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label="Money in"
            value={summary.received}
            currency={currency}
            icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
            tone="profit"
            direction="up"
            hint="From buyers and coworker repayments"
          />
          <MoneyStat
            label="Money out"
            value={summary.paid}
            currency={currency}
            icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
            tone="warn"
            direction="down"
            hint="To sellers and coworkers"
          />
          <MoneyStat
            label="Net position"
            value={summary.net}
            currency={currency}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone={summary.net >= 0 ? "profit" : "danger"}
            hint={summary.net >= 0 ? "Cash positive in this period" : "More went out than came in"}
          />
          <StatCard
            label="Payments in view"
            value={qty(summary.count)}
            icon={<CreditCard className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={
              summary.voided > 0
                ? `${qty(summary.voided)} reversed and excluded`
                : "Nothing reversed in this view"
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Entry points"
            subtitle="The three payment flows, each one a single form"
            icon={<CreditCard className="h-4 w-4" aria-hidden />}
            className="xl:col-span-1"
            bodyClassName="p-3"
          >
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setReceiveOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg border border-profit-500/30 bg-profit-50 p-3 text-left transition-colors hover:border-profit-500"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-profit-600 text-white">
                  <ArrowDownLeft className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-profit-700">Receive payment</span>
                  <span className="block text-2xs text-muted">
                    Money from a buyer, reducing what they owe
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setPayOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg border border-brand-500/30 bg-brand-50 p-3 text-left transition-colors hover:border-brand-500"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-brand-700">Pay seller</span>
                  <span className="block text-2xs text-muted">
                    Money to a supplier, reducing what you owe
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setCoworkerOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg border border-line-strong bg-canvas p-3 text-left transition-colors hover:border-navy-400"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-900 text-white">
                  <UsersRound className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-navy-900">Coworker payment</span>
                  <span className="block text-2xs text-muted">
                    Lend, borrow or take a repayment
                  </span>
                </span>
              </button>

              <div className="pt-1">
                <TransactionSummary
                  lines={[
                    {
                      label: "Backend totals",
                      value: totalsState.data
                        ? money(totalsState.data[0], currency)
                        : "Reading",
                      hint: "received",
                    },
                    {
                      label: "Paid to sellers",
                      value: totalsState.data ? money(totalsState.data[1], currency) : "-",
                    },
                    {
                      label: "Net",
                      value: totalsState.data ? money(totalsState.data[2], currency) : "-",
                      tone: (totalsState.data?.[2] ?? 0) >= 0 ? "profit" : "danger",
                      strong: true,
                    },
                  ]}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Payment ledger"
            subtitle={`${qty(all.length)} payment${all.length === 1 ? "" : "s"}${
              activeCount > 0 ? " matching your filters" : ""
            }`}
            icon={<CreditCard className="h-4 w-4" aria-hidden />}
            bodyClassName="p-0"
            className="min-h-[18rem] xl:col-span-2"
          >
            {state.loading && !state.data ? (
              <SkeletonTable rows={8} columns={6} />
            ) : state.error ? (
              <div className="p-4">
                <InlineError message={state.error} onRetry={state.reload} />
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={visible}
                rowKey={(p) => p.id}
                footer={
                  all.length > 0 ? (
                    <tr>
                      <td>Totals</td>
                      <td />
                      <td />
                      <td className="hidden md:table-cell" />
                      <td className="num">
                        {money(summary.received, currency)} in / {money(summary.paid, currency)} out
                      </td>
                      <td className="hidden lg:table-cell" />
                      <td />
                    </tr>
                  ) : undefined
                }
                empty={
                  <EmptyState
                    icon={<CreditCard className="h-5 w-5" aria-hidden />}
                    title={activeCount > 0 ? "No payments match these filters" : "No payments yet"}
                    message={
                      activeCount > 0
                        ? "Widen the date range or clear a filter to see more of the ledger."
                        : "Record the first receipt from a buyer or payment to a supplier and balances update straight away."
                    }
                    action={
                      activeCount > 0 ? (
                        <Button size="sm" onClick={clearAll}>
                          Clear filters
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="profit"
                          onClick={() => setReceiveOpen(true)}
                          icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
                        >
                          Receive payment
                        </Button>
                      )
                    }
                    secondaryAction={
                      activeCount > 0 ? null : (
                        <Button size="sm" onClick={() => setPayOpen(true)}>
                          Pay a seller
                        </Button>
                      )
                    }
                  />
                }
              />
            )}
            {all.length > 0 && (
              <Pagination
                total={all.length}
                pageSize={pageSize}
                page={page}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
                label="payments"
              />
            )}
          </SectionCard>
        </div>

        {byMethod.length > 0 && (
          <SectionCard
            title="Where the money moves"
            subtitle="Totals by payment method for the current filter"
            icon={<HandCoins className="h-4 w-4" aria-hidden />}
            bodyClassName="p-3"
          >
            <ul className="space-y-2">
              {byMethod.map((m) => (
                <li key={m.method} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs font-semibold text-ink">
                    {m.method}
                  </span>
                  <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-canvas">
                    <span
                      className="block h-full rounded-full bg-brand-500"
                      style={{
                        width: `${maxMethod > 0 ? Math.max(3, (m.total / maxMethod) * 100) : 0}%`,
                      }}
                    />
                  </span>
                  <span className="tnum w-24 shrink-0 text-right text-xs font-bold text-ink">
                    {money(m.total, currency)}
                  </span>
                  <span className="tnum w-10 shrink-0 text-right text-2xs text-faint">
                    {qty(m.count)}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      <PaymentDialog
        open={receiveOpen}
        mode="receive"
        onClose={() => setReceiveOpen(false)}
        onCompleted={() => {
          setReceiveOpen(false);
          done("Payment received");
        }}
      />

      <PaymentDialog
        open={payOpen}
        mode="pay"
        onClose={() => setPayOpen(false)}
        onCompleted={() => {
          setPayOpen(false);
          done("Payment recorded");
        }}
      />

      <CoworkerPaymentDialog
        open={coworkerOpen}
        onClose={() => setCoworkerOpen(false)}
        onCompleted={() => {
          setCoworkerOpen(false);
          done("Coworker payment recorded");
        }}
      />

      <ReasonDialog
        open={reverse !== null}
        title={`Reverse ${reverse?.paymentId ?? "this payment"}`}
        description="Reversing is for a payment that was recorded in error - the wrong person, the wrong amount, or a duplicate entry. The amount goes back onto the account balance in the opposite direction."
        points={[
          `${money(reverse?.amount ?? 0, currency)} will be added back to ${
            reverse?.personName ?? "the account"
          }.`,
          "The payment stays in the ledger marked as reversed, with your reason recorded.",
          "To correct a genuine part payment, record a new payment instead.",
        ]}
        confirmLabel="Explain why this payment is being reversed"
        confirmLabelShort="Reverse payment"
        busy={reversing}
        serverError={reverseError}
        placeholder="e.g. entered against the wrong buyer"
        onConfirm={confirmReverse}
        onCancel={() => setReverse(null)}
      />

      {summary.voided > 0 && (
        <p className="no-print flex items-center gap-1.5 text-2xs text-warn-700">
          <Ban className="h-3.5 w-3.5" aria-hidden />
          {qty(summary.voided)} reversed payment{summary.voided === 1 ? "" : "s"} excluded from the
          totals above.
        </p>
      )}
    </div>
  );
}