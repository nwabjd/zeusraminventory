import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Inbox, RefreshCw } from "lucide-react";
import {
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_SHORT,
  payloadTotals,
  statusTone,
} from "../lib/approval";
import { cloudListMyApprovals, cloudSubscribeQueue } from "../lib/cloud";
import { useCurrency } from "../lib/app-context";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { cn, displayDate, displayDateTime, money, qty } from "../lib/format";
import { Button, EmptyState, InlineError, StatusBadge } from "../components/ui";
import type { TransactionApproval } from "../lib/cloud-types";
import { DataTable, type Column } from "../components/ui/DataTable";
import { Modal } from "../components/ui/Modal";
import { PageHeader, SectionCard } from "../components/ui/Cards";

/* ===========================================================================
   MY TRANSACTIONS - what a sales representative submitted and where it is.
   The approval workflow is visible here: PENDING / APPROVED / REJECTED plus
   the rejection reason, decided by whom, and the finalized document number.
   =========================================================================== */

type Tab = "all" | "pending_approval" | "approved" | "rejected";

export default function MyTransactions() {
  const currency = useCurrency();
  const { cloud } = useAuth();
  const [rows, setRows] = useState<TransactionApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [detail, setDetail] = useState<TransactionApproval | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setOffline(false);
      setRows(await cloudListMyApprovals());
    } catch (e) {
      // Offline / Realtime unavailable: fall back to the local mirror so the
      // rep still sees what they submitted. The rows never claim to be
      // live - a banner states they are the last synchronized copy.
      if (cloud) {
        try {
          const cached = await api.listCloudCachedApprovals();
          setRows(cached);
          setOffline(true);
          return;
        } catch {
          /* fall through to the error */
        }
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cloud]);

  useEffect(() => {
    void reload();
    return cloudSubscribeQueue(() => void reload());
  }, [reload]);

  const visible = useMemo(
    () => (tab === "all" ? rows : rows.filter((r) => r.status === tab)),
    [rows, tab],
  );

  const columns: Column<TransactionApproval>[] = [
    {
      key: "number",
      header: "Request",
      cell: (r) => (
        <div className="min-w-0">
          <p className="tnum text-sm font-semibold text-ink">{r.transaction_number}</p>
          <p className="text-2xs text-muted capitalize">{r.kind}</p>
        </div>
      ),
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
      cell: (r) => <span className="tnum text-sm font-semibold text-ink">{money(r.total_amount, currency)}</span>,
    },
    {
      key: "submitted",
      header: "Submitted",
      hideBelow: "md",
      cell: (r) => <span className="text-xs text-muted">{displayDate(r.created_at)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge tone={statusTone(r.status)}>{APPROVAL_STATUS_SHORT[r.status]}</StatusBadge>,
    },
    {
      key: "decision",
      header: "Decision",
      hideBelow: "lg",
      cell: (r) => {
        if (r.status === "pending_approval") {
          return r.lock_owner ? (
            <span className="text-xs text-faint">Under review&hellip;</span>
          ) : (
            <span className="text-xs text-faint">Waiting for an administrator</span>
          );
        }
        return (
          <div className="min-w-0 max-w-[220px]">
            <p className="truncate text-xs font-medium text-ink" title={r.decided_by_email ?? ""}>
              {r.decided_by_email ?? "—"}
            </p>
            {r.status === "rejected" && r.rejection_reason && (
              <p className="truncate text-2xs text-danger-600" title={r.rejection_reason}>
                {r.rejection_reason}
              </p>
            )}
            {r.status === "approved" && r.final_document_number && (
              <p className="tnum text-2xs text-profit-600">{r.final_document_number}</p>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" aria-hidden />} onClick={() => setDetail(r)}>
          View
        </Button>
      ),
    },
  ];

  const counts = useMemo(
    () => ({
      all: rows.length,
      pending_approval: rows.filter((r) => r.status === "pending_approval").length,
      approved: rows.filter((r) => r.status === "approved").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    }),
    [rows],
  );

  return (
    <div className="page">
      <PageHeader
        title="My Transactions"
        subtitle="Requests you submitted, and what an administrator decided"
        icon={<Inbox className="h-5 w-5" aria-hidden />}
        actions={
          <Button onClick={() => void reload()} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
            Refresh
          </Button>
        }
      />

      <div className="page-scroll space-y-4">
        {error && <InlineError message={error} onRetry={() => void reload()} />}
        {offline && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-50 px-4 py-2.5 text-xs leading-relaxed text-sky-800"
          >
            <span className="font-semibold">Offline copy</span>
            <span className="min-w-0 flex-1">
              The live cloud queue could not be reached, so this is the last synchronized copy. It
              refreshes automatically when you are back online.
            </span>
            <button type="button" className="link font-semibold" onClick={() => void reload()}>
              Retry now
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1 border-b border-line">
          {(["all", "pending_approval", "approved", "rejected"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-2 text-sm font-semibold transition-colors",
                tab === t ? "border-b-2 border-brand-600 text-ink" : "text-muted hover:text-ink",
              )}
            >
              {t === "all" ? "All" : APPROVAL_STATUS_LABEL[t as keyof typeof APPROVAL_STATUS_LABEL]}
              <span className="ml-1.5 text-2xs text-faint">{counts[t]}</span>
            </button>
          ))}
        </div>

        <SectionCard
          title="Submitted requests"
          subtitle="Your sales and purchases wait for admin approval before any stock moves"
        >
          {loading ? (
            <div className="p-6 text-center text-xs text-muted">Loading your transactions&hellip;</div>
          ) : (
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              onRowClick={(r) => setDetail(r)}
              empty={
                <EmptyState
                  title="No requests yet"
                  message="When you BUY RAM or SELL RAM, the document is submitted here for approval instead of hitting the ledger directly."
                />
              }
            />
          )}
        </SectionCard>
      </div>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        size="md"
        title={detail ? detail.transaction_number : ""}
        subtitle={detail ? `${detail.kind === "sale" ? "Sale" : "Purchase"} request` : ""}
        icon={<Eye className="h-4 w-4" aria-hidden />}
        footer={<Button onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <DetailField label="Status" value={APPROVAL_STATUS_LABEL[detail.status]} />
              <DetailField label={detail.kind === "sale" ? "Customer" : "Supplier"} value={detail.party_name} />
              <DetailField label="Submitted" value={displayDateTime(detail.created_at)} />
              <DetailField label="Amount" value={money(payloadTotals(detail.payload).total, currency)} />
            </div>

            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="mb-1.5 text-2xs font-bold tracking-[0.1em] text-faint uppercase">Lines · {qty(payloadTotals(detail.payload).unitCount)} units</p>
              <ul className="space-y-1">
                {detail.payload.items.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="tnum font-semibold text-ink">{l.sku}</span>
                      <span className="ml-1.5 text-muted">
                        {[l.generation, l.capacity, l.speed].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-muted">
                      {qty(l.quantity)} × {money(l.unitPrice, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {detail.status === "rejected" && detail.rejection_reason && (
              <div className="rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-xs text-danger-700">
                <p className="font-bold">Rejected</p>
                <p className="mt-0.5">Reason: {detail.rejection_reason}</p>
                <p className="mt-1 text-danger-600/80">Decided by {detail.decided_by_email ?? "an administrator"} on {detail.decided_at ? displayDateTime(detail.decided_at) : "—"}.</p>
              </div>
            )}

            {detail.status === "approved" && (
              <div className="rounded-lg border border-profit-500/30 bg-profit-50 p-3 text-xs text-profit-700">
                <p className="font-bold">Approved</p>
                <p className="mt-0.5">
                  Stock has been updated under document{" "}
                  <span className="tnum font-semibold">{detail.final_document_number ?? "(recorded on the approving device)"}</span>.
                </p>
              </div>
            )}

            {detail.status === "pending_approval" && (
              <p className="text-xs leading-relaxed text-muted">
                This request is waiting for an administrator. No stock has moved yet.
                {detail.lock_owner ? " It is currently under review." : ""}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs font-bold tracking-[0.1em] text-faint uppercase">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-ink">{value}</p>
    </div>
  );
}