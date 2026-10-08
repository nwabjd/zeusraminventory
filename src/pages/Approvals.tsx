import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Eye, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_SHORT,
  canDecideTransaction,
  payloadTotals,
  statusTone,
} from "../lib/approval";
import {
  cloudApprovalHistory,
  cloudFinalizeApproval,
  cloudListApprovals,
  cloudRejectApproval,
  cloudReleaseStaleLocks,
  cloudSubscribeQueue,
} from "../lib/cloud";
import { useCurrency, useApp } from "../lib/app-context";
import { useSync } from "../lib/sync";
import { cn, displayDate, displayDateTime, money, qty } from "../lib/format";
import { useToast, Button, EmptyState, InlineError, StatusBadge } from "../components/ui";
import type {
  ApprovalActionRow,
  ApprovalStatus,
  TransactionApproval,
} from "../lib/cloud-types";
import { ConfirmDialog, Modal } from "../components/ui/Modal";
import { ReasonDialog } from "../components/ui/ReasonDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { PageHeader, SectionCard } from "../components/ui/Cards";

/* ===========================================================================
   APPROVALS - administrator decision screen.
   ---------------------------------------------------------------------------
   Every sale and purchase request created anywhere lands here as
   PENDING_APPROVAL. Approving finalizes the request through the existing ZEUS
   ledger commands; rejecting records a reason the requester can see. The lock
   step makes double approval impossible even across two admin devices.
   =========================================================================== */

type Tab = "pending" | "approved" | "rejected";

const TAB_STATUS: Record<Tab, ApprovalStatus> = {
  pending: "pending_approval",
  approved: "approved",
  rejected: "rejected",
};

export default function Approvals() {
  const currency = useCurrency();
  const toast = useToast();
  const { refreshAll } = useApp();
  const { profile, pendingCounts } = useAuth();
  const { syncNow } = useSync();

  const [rows, setRows] = useState<TransactionApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pending");

  const [detail, setDetail] = useState<TransactionApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<ApprovalActionRow[] | null>(null);

  const [confirming, setConfirming] = useState<TransactionApproval | null>(null);
  const [rejecting, setRejecting] = useState<TransactionApproval | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const all = await cloudListApprovals();
      setRows(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return cloudSubscribeQueue(() => void reload());
  }, [reload]);

  const visible = useMemo(() => {
    return rows.filter((r) => r.status === TAB_STATUS[tab]);
  }, [rows, tab]);

  const pending = useMemo(() => rows.filter((r) => r.status === "pending_approval"), [rows]);
  const hasStaleLocks = pending.some((r) => r.lock_owner !== null);

  const openDetail = async (t: TransactionApproval) => {
    setDetail(t);
    setServerError(null);
    setActionLog(null);
    try {
      setActionLog(await cloudApprovalHistory(t.id));
    } catch {
      /* history is best-effort */
    }
  };

  const doApprove = async (t: TransactionApproval) => {
    setBusy(true);
    setServerError(null);
    try {
      // Single server-side, atomic RPC: re-validates role/status/ownership/
      // availability, decrements the authoritative inventory, writes the final
      // cloud document and only then marks the request APPROVED. No client-side
      // chain of writes can leave a half-applied decision.
      const outcome = await cloudFinalizeApproval(t.id);
      if (!outcome.ok) {
        toast.error("Not approved", outcome.error ?? "The request could not be approved.");
        await reload();
        return;
      }
      toast.success(
        "Request approved",
        outcome.alreadyProcessed
          ? "It was already decided by another administrator."
          : outcome.documentNumber
            ? `Document ${outcome.documentNumber} recorded.`
            : "The document has been recorded.",
      );
      await reload();
      setDetail(null);
      await syncNow(); // pull the finalized document + new quantities into the mirror
      await refreshAll();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const doReject = async (t: TransactionApproval, reason: string) => {
    setBusy(true);
    setServerError(null);
    try {
      // Server-side reject_approval RPC - idempotent, writes the audit trail.
      await cloudRejectApproval(t.id, reason);
      toast.success("Request rejected", "The requester can now see the reason.");
      await reload();
      setDetail(null);
      await syncNow();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setRejecting(null);
    }
  };

  const releaseStale = async () => {
    try {
      const n = await cloudReleaseStaleLocks(5);
      toast.success("Locks released", n > 0 ? `${n} stale lock(s) cleared.` : "No stale locks found.");
      await reload();
    } catch (e) {
      toast.error("Could not release locks", e instanceof Error ? e.message : String(e));
    }
  };

  const columns: Column<TransactionApproval>[] = [
    {
      key: "number",
      header: "Transaction",
      cell: (r) => (
        <div className="min-w-0">
          <p className="tnum text-sm font-semibold text-ink">{r.transaction_number}</p>
          <p className="text-2xs text-muted capitalize">{r.kind}</p>
        </div>
      ),
    },
    {
      key: "by",
      header: "Created By",
      hideBelow: "md",
      cell: (r) => <span className="text-xs text-muted">{r.requested_by_email}</span>,
    },
    {
      key: "party",
      header: "Customer / Supplier",
      cell: (r) => <span className="text-sm font-medium text-ink">{r.party_name}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      cell: (r) => <span className="text-sm font-semibold text-ink">{money(r.total_amount, currency)}</span>,
    },
    {
      key: "date",
      header: "Date",
      hideBelow: "lg",
      cell: (r) => <span className="text-xs text-muted">{displayDate(r.created_at)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge tone={statusTone(r.status)}>{APPROVAL_STATUS_SHORT[r.status]}</StatusBadge>,
    },
    {
      key: "actions",
      header: "Action",
      align: "right",
      cell: (r) => {
        const can = canDecideTransaction(profile, r).ok;
        return (
          <span className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" aria-hidden />} onClick={() => void openDetail(r)}>
              View
            </Button>
            {r.status === "pending_approval" && (
              <>
                <Button size="sm" variant="profit" disabled={!can || busy} onClick={() => setConfirming(r)}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" disabled={!can || busy} onClick={() => setRejecting(r)}>
                  Reject
                </Button>
              </>
            )}
          </span>
        );
      },
    },
  ];

  const split = (s: string) => {
    const sales = pending.filter((r) => r.kind === "sale");
    const purchases = pending.filter((r) => r.kind === "purchase");
    return s === "sales" ? sales : purchases;
  };

  const renderPending = (kind: "sales" | "purchases") => {
    const list = split(kind);
    const noun = kind === "sales" ? "sales" : "purchases";
    return (
      <SectionCard
        title={`Pending ${kind === "sales" ? "Sales" : "Purchases"}`}
        subtitle={`${qty(list.length)} request${list.length === 1 ? "" : "s"} waiting for a decision`}
        icon={kind === "sales" ? <ClipboardList className="h-4 w-4" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
        actions={
          list.length > 0 && hasStaleLocks ? (
            <Button size="sm" variant="ghost" onClick={() => void releaseStale()} title="Release approval locks left by crashed sessions">
              Release stuck locks
            </Button>
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={list}
          rowKey={(r) => r.id}
          onRowClick={(r) => void openDetail(r)}
          empty={<EmptyState title={`No pending ${noun} at the moment`} message="Everything has been decided. New requests from any device appear here live." />}
        />
      </SectionCard>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Approvals"
        subtitle={`${pendingCounts.sales} sales & ${pendingCounts.purchases} purchases awaiting a decision`}
        icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
        actions={
          <Button onClick={() => void reload()} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
            Refresh
          </Button>
        }
      />

      <div className="page-scroll space-y-4">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <div className="flex items-center gap-1 border-b border-line">
          {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-2 text-sm font-semibold transition-colors",
                tab === t ? "border-b-2 border-brand-600 text-ink" : "text-muted hover:text-ink",
              )}
            >
              {APPROVAL_STATUS_LABEL[TAB_STATUS[tab]]}
              <span className="ml-1.5 text-2xs text-faint">{rows.filter((r) => r.status === TAB_STATUS[tab]).length}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="card p-6 text-center text-xs text-muted">Loading approval queue&hellip;</div>
        ) : tab === "pending" ? (
          <div className="space-y-4">
            {renderPending("sales")}
            {renderPending("purchases")}
          </div>
        ) : (
          <SectionCard
            title={tab === "approved" ? "Approved transactions" : "Rejected transactions"}
            subtitle="Full decision history - requests cannot be edited or deleted"
          >
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              onRowClick={(r) => void openDetail(r)}
              empty={<EmptyState title="Nothing here yet" message="Decisions appear here and are never wiped." />}
            />
          </SectionCard>
        )}
      </div>

      {/* View detail */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        size="xl"
        title={detail ? detail.transaction_number : ""}
        subtitle={detail ? `${detail.kind === "sale" ? "Sale" : "Purchase"} request · status ${APPROVAL_STATUS_LABEL[detail.status]}` : ""}
        icon={<Eye className="h-4 w-4" aria-hidden />}
        busy={busy}
        footer={
          detail?.status === "pending_approval" ? (
            <span className="flex w-full items-center justify-between gap-2">
              <Button onClick={() => setDetail(null)} disabled={busy}>
                Close
              </Button>
              <span className="flex items-center gap-2">
                <Button variant="danger" disabled={!canDecideTransaction(profile, detail).ok || busy} onClick={() => setRejecting(detail)}>
                  Reject
                </Button>
                <Button variant="profit" disabled={!canDecideTransaction(profile, detail).ok || busy} onClick={() => setConfirming(detail)}>
                  Approve
                </Button>
              </span>
            </span>
          ) : (
            <Button onClick={() => setDetail(null)} disabled={busy}>
              Close
            </Button>
          )
        }
      >
        {serverError && (
          <div role="alert" className="mb-3 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-xs font-medium whitespace-pre-wrap text-danger-700">
            {serverError}
          </div>
        )}
        {detail && <ApprovalDetail approval={detail} actionLog={actionLog} />}
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        title="Approve this request?"
        message={
          confirming
            ? `Approving ${confirming.transaction_number} runs the existing ZEUS ledger logic on this device: stock, balances and profit update immediately, and the document number is recorded against the request.`
            : ""
        }
        confirmLabel="Approve"
        tone="brand"
        busy={busy}
        onConfirm={() => confirming && void doApprove(confirming)}
        onCancel={() => setConfirming(null)}
      />

      <ReasonDialog
        open={rejecting !== null}
        title="Reject request"
        description={
          rejecting
            ? `Rejecting ${rejecting.transaction_number}. The requester will see the reason below.`
            : ""
        }
        confirmLabel="The reason is saved to the audit trail."
        confirmLabelShort="Reject request"
        placeholder="e.g. Customer price not approved."
        busy={busy}
        serverError={serverError}
        onConfirm={(reason) => rejecting && void doReject(rejecting, reason)}
        onCancel={() => setRejecting(null)}
      />

      </div>
  );
}

function ApprovalDetail({
  approval: a,
  actionLog,
}: {
  approval: TransactionApproval;
  actionLog: ApprovalActionRow[] | null;
}) {
  const currency = useCurrency();
  const totals = payloadTotals(a.payload);
  const lines = a.payload.items;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Info label="Requested by" value={a.requested_by_email} />
        <Info label={a.kind === "sale" ? "Customer" : "Supplier"} value={a.party_name} />
        <Info label="Date" value={a.payload.date} />
        <Info label="Status" value={APPROVAL_STATUS_LABEL[a.status]} />
      </div>

      <div>
        <p className="mb-1.5 text-2xs font-bold tracking-[0.12em] text-muted uppercase">Lines</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Spec</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit price</th>
                <th className="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="tnum text-sm font-semibold text-ink">{l.sku}</td>
                  <td className="text-xs text-muted">
                    {[l.generation, l.capacity, l.speed, l.category].filter(Boolean).join(" · ")}
                  </td>
                  <td className="text-right">{qty(l.quantity)}</td>
                  <td className="text-right">{money(l.unitPrice, currency)}</td>
                  <td className="text-right">{money(l.quantity * l.unitPrice, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-col items-end gap-0.5 text-xs">
          {a.payload.discount > 0 && (
            <span className="text-muted">
              Discount &minus; {money(a.payload.discount, currency)}
            </span>
          )}
          <span className="text-sm font-bold text-ink">
            Total {money(totals.total, currency)}
          </span>
          <span className="text-2xs text-faint">
            {a.payload.payment > 0 ? `Paid on request: ${money(a.payload.payment, currency)}` : "No payment on request"} ·{" "}
            {a.payload.method}
          </span>
        </div>
      </div>

      {a.payload.notes && <Info label="Notes" value={a.payload.notes} wide />}

      {a.rejection_reason && (
        <div className="rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-xs leading-relaxed text-danger-700">
          <p className="font-bold">Rejection reason</p>
          <p className="mt-0.5 whitespace-pre-wrap">{a.rejection_reason}</p>
        </div>
      )}

      {a.final_document_number && (
        <div className="rounded-lg border border-profit-500/30 bg-profit-50 p-3 text-xs text-profit-700">
          <p className="font-bold">Finalized</p>
          <p className="mt-0.5">
            Approved by {a.decided_by_email} on {a.decided_at ? displayDate(a.decided_at) : "—"} · Document{" "}
            <span className="tnum font-semibold">{a.final_document_number}</span>
          </p>
        </div>
      )}

      {actionLog && actionLog.length > 0 && (
        <div>
          <p className="mb-1.5 text-2xs font-bold tracking-[0.12em] text-muted uppercase">History</p>
          <ol className="space-y-1.5">
            {actionLog.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-xs text-muted">
                {s.action === "submitted" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />}
                {s.action === "approved" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-profit-600" aria-hidden />}
                {s.action === "rejected" && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-600" aria-hidden />}
                <span className="min-w-0">
                  <span className="font-semibold capitalize">{s.action}</span> by {s.actor_email} ·{" "}
                  {displayDateTime(s.created_at)}
                  {s.reason ? <span className="text-faint"> — “{s.reason}”</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <p className="text-2xs font-bold tracking-[0.1em] text-faint uppercase">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-ink" title={value}>
        {value}
      </p>
    </div>
  );
}