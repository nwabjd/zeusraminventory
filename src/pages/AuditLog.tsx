import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { cloudAudit } from "../lib/cloud";
import { displayDateTime } from "../lib/format";
import { useToast, Button, EmptyState, InlineError, SelectField } from "../components/ui";
import { DataTable, type Column } from "../components/ui/DataTable";
import { PageHeader, SectionCard } from "../components/ui/Cards";
import type { CloudAuditEntry } from "../lib/cloud-types";

/* ===========================================================================
   AUDIT LOG - the cloud-side, actor-aware trail.
   Login/logout, request submissions, approvals/rejections and user management
   are immutable here. Inventory events stay on the local audit_log; the two
   are reconciled in the reports pipeline.
   =========================================================================== */

export default function AuditLog() {
  const toast = useToast();
  const [rows, setRows] = useState<CloudAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string>("");

  const reload = useCallback(async () => {
    try {
      setError(null);
      setRows(await cloudAudit(500));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error("Could not load the audit log", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(
    () => (action ? rows.filter((r) => r.action === action) : rows),
    [rows, action],
  );

  const actions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.action))).sort(),
    [rows],
  );

  const columns: Column<CloudAuditEntry>[] = [
    {
      key: "when",
      header: "When",
      cell: (r) => <span className="text-xs text-muted">{displayDateTime(r.created_at)}</span>,
    },
    {
      key: "actor",
      header: "Actor",
      cell: (r) => <span className="text-xs font-medium text-ink">{r.actor_email ?? "—"}</span>,
    },
    {
      key: "action",
      header: "Action",
      cell: (r) => <span className="tnum text-xs font-bold text-ink">{r.action}</span>,
    },
    {
      key: "entity",
      header: "Entity",
      cell: (r) => <span className="text-xs text-muted">{r.entity}</span>,
    },
    {
      key: "entityId",
      header: "Entity ID",
      hideBelow: "md",
      cell: (r) => <span className="tnum text-xs text-faint">{r.entity_id ?? "—"}</span>,
    },
    {
      key: "details",
      header: "Details",
      hideBelow: "lg",
      cell: (r) => (
        <span className="max-w-[260px] truncate text-xs text-faint">
          {r.metadata ? JSON.stringify(r.metadata) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Audit Log"
        subtitle="Every decision and account change, recorded with who did it and when"
        icon={<ScrollText className="h-5 w-5" aria-hidden />}
        actions={
          <Button onClick={() => void reload()} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
            Refresh
          </Button>
        }
      />

      <div className="page-scroll space-y-4">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <SectionCard
          title="Recent events"
          subtitle="Immutable - nothing here can be edited or deleted"
          actions={
            <SelectField
              value={action}
              onChange={(e) => setAction(e.target.value)}
              aria-label="Filter by action"
              className="w-56"
              options={[
                { value: "", label: "All actions" },
                ...actions.map((a) => ({ value: a, label: a })),
              ]}
            />
          }
        >
          {loading ? (
            <div className="p-6 text-center text-xs text-muted">Loading audit trail&hellip;</div>
          ) : (
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No events recorded" message="Logins, requests and decisions will appear here." />}
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}