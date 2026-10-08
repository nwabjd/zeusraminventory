import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Eye, PlusCircle, RefreshCw, ShieldAlert, UserRound } from "lucide-react";
import {
  cloudAudit,
  cloudChangeRole,
  cloudInviteUser,
  cloudListProfiles,
  cloudSetUserStatus,
} from "../lib/cloud";
import { ROLE_LABEL, ROLE_SHORT } from "../lib/approval";
import { useAuth } from "../lib/auth";
import { displayDateTime } from "../lib/format";
import {
  Button,
  FormField,
  SelectField,
  TextInput,
  useToast,
  StatusBadge,
  EmptyState,
  InlineError,
} from "../components/ui";
import { DataTable, type Column } from "../components/ui/DataTable";
import { Modal } from "../components/ui/Modal";
import { PageHeader, SectionCard } from "../components/ui/Cards";
import type { CloudAuditEntry, ProfileRow, UserRole } from "../lib/cloud-types";
import { ConfirmDialog } from "../components/ui/Modal";

/* ===========================================================================
   USERS - administrator-only account management.
   ---------------------------------------------------------------------------
   Invite emails are records in `profiles` with role + status set; the Google
   identity is linked on first sign-in. An account cannot be deleted - it is
   deactivated, preserving its transaction history. The last active admin can
   never be deactivated or demoted (enforced on the server as well as here).
   =========================================================================== */

export default function Users() {
  const toast = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("sales_representative");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [confirmDeactivate, setConfirmDeactivate] = useState<ProfileRow | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);

  const [activity, setActivity] = useState<{ profile: ProfileRow; entries: CloudAuditEntry[] } | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setRows(await cloudListProfiles());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeAdmins = useMemo(
    () => rows.filter((p) => p.role === "admin" && p.status === "active"),
    [rows],
  );

  const isLastAdmin = (p: ProfileRow) =>
    p.role === "admin" && p.status === "active" && activeAdmins.length === 1;

  const doInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    try {
      await cloudInviteUser({ email, role: inviteRole, displayName: inviteName || undefined });
      toast.success("Account invited", `${email} can sign in with Google now.`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      await reload();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const changeStatus = async (p: ProfileRow, status: "active" | "inactive") => {
    setChangeBusy(true);
    try {
      await cloudSetUserStatus(p.id, status);
      toast.success(status === "active" ? "Account activated" : "Account deactivated", p.email);
      await reload();
    } catch (e) {
      toast.error("Could not change status", e instanceof Error ? e.message : String(e));
    } finally {
      setChangeBusy(false);
      setConfirmDeactivate(null);
    }
  };

  const changeRole = async (p: ProfileRow, role: UserRole) => {
    if (p.role === role) return;
    if (isLastAdmin(p)) {
      toast.error("Cannot demote", "You cannot demote the last active administrator.");
      return;
    }
    setChangeBusy(true);
    try {
      await cloudChangeRole(p.id, role);
      toast.success("Role changed", `${p.email} is now ${ROLE_LABEL[role]}.`);
      await reload();
    } catch (e) {
      toast.error("Could not change role", e instanceof Error ? e.message : String(e));
    } finally {
      setChangeBusy(false);
    }
  };

  const openActivity = async (p: ProfileRow) => {
    setActivity({ profile: p, entries: [] });
    setActivityBusy(true);
    try {
      const all = await cloudAudit(500);
      const entries = all.filter(
        (a) =>
          (a.actor_email ?? "").toLowerCase() === p.email.toLowerCase() ||
          (a.metadata &&
            typeof a.metadata === "object" &&
            "email" in a.metadata &&
            String(a.metadata.email).toLowerCase() === p.email.toLowerCase()),
      );
      setActivity({ profile: p, entries });
    } catch (e) {
      toast.error("Could not load activity", e instanceof Error ? e.message : String(e));
    } finally {
      setActivityBusy(false);
    }
  };

  const columns: Column<ProfileRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {p.display_name || (p.role ? ROLE_SHORT[p.role] : "Unprovisioned")}
            {p.auth_user_id === user?.id && <span className="ml-1.5 text-2xs text-faint">(you)</span>}
          </p>
          <p className="truncate text-2xs text-muted">
            {p.auth_user_id ? "Signed in with Google" : "Invited - waiting for first sign-in"}
          </p>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      cell: (p) => <span className="text-xs text-muted">{p.email}</span>,
    },
    {
      key: "role",
      header: "Role",
      cell: (p) => (
        <SelectField
          value={p.role ?? ""}
          disabled={!p.role || isLastAdmin(p) || changeBusy}
          onChange={(e) => void changeRole(p, e.target.value as UserRole)}
          aria-label={`Role for ${p.email}`}
          className="w-40"
          options={[
            { value: "", label: "Not set" },
            { value: "admin", label: "Administrator" },
            { value: "sales_representative", label: "Sales Representative" },
          ]}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <StatusBadge tone={p.status === "active" ? "profit" : p.status === "inactive" ? "danger" : "neutral"}>
          {p.status === "active" ? "Active" : p.status === "inactive" ? "Inactive" : "Pending"}
        </StatusBadge>
      ),
    },
    {
      key: "lastLogin",
      header: "Last Login",
      hideBelow: "md",
      cell: (p) => (
        <span className="text-xs text-muted">{p.last_login_at ? displayDateTime(p.last_login_at) : "Never"}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (p) => (
        <span className="flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" icon={<Activity className="h-3.5 w-3.5" aria-hidden />} onClick={() => void openActivity(p)}>
            Activity
          </Button>
          {p.role && p.status === "active" && p.auth_user_id !== user?.id && (
            <Button
              size="sm"
              variant="danger"
              disabled={isLastAdmin(p) || changeBusy}
              onClick={() => setConfirmDeactivate(p)}
            >
              Deactivate
            </Button>
          )}
          {p.role && p.status === "inactive" && (
            <Button size="sm" variant="profit" disabled={changeBusy} onClick={() => void changeStatus(p, "active")}>
              Activate
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Users"
        subtitle="Manage who can sign in and what they can do"
        icon={<UserRound className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button onClick={() => void reload()} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
              Refresh
            </Button>
            <Button variant="primary" icon={<PlusCircle className="h-4 w-4" aria-hidden />} onClick={() => setInviteOpen(true)}>
              Add Sales Representative
            </Button>
          </>
        }
      />

      <div className="page-scroll space-y-4">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <SectionCard title="Accounts" subtitle="Google sign-in is linked the first time an invited email authenticates">
          {loading ? (
            <div className="p-6 text-center text-xs text-muted">Loading accounts&hellip;</div>
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              empty={<EmptyState title="No accounts yet" message="Add a sales representative to open ZEUS to Google sign-in." />}
            />
          )}
        </SectionCard>

        <p className="flex items-start gap-1.5 px-1 text-2xs leading-relaxed text-faint">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-600" aria-hidden />
          Deactivating or demoting the last active administrator is refused both here and by the
          database, so ZEUS can never be locked out of its own administration.
        </p>
      </div>

      {/* Invite dialog */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        size="sm"
        title="Invite an account"
        subtitle="They sign in with Google on any device - no password is created"
        icon={<PlusCircle className="h-4 w-4" aria-hidden />}
        busy={inviteBusy}
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)} disabled={inviteBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void doInvite()} loading={inviteBusy}>
              Invite
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {inviteError && (
            <div role="alert" className="rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-medium text-danger-700">
              {inviteError}
            </div>
          )}
          <FormField label="Email" required hint="The Google account they will sign in with">
            <TextInput
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="sales@example.com"
              autoFocus
            />
          </FormField>
          <FormField label="Display name" hint="Optional - shown in ZEUS">
            <TextInput value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="e.g. Aisha" />
          </FormField>
          <FormField label="Role" required>
            <SelectField
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as UserRole)}
              options={[
                { value: "sales_representative", label: "Sales Representative" },
                { value: "admin", label: "Administrator" },
              ]}
            />
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeactivate !== null}
        title="Deactivate this account?"
        message={
          confirmDeactivate
            ? `${confirmDeactivate.email} will not be able to sign in to ZEUS. Their submitted transactions and history remain untouched - they can be activated again later.`
            : ""
        }
        confirmLabel="Deactivate"
        tone="danger"
        busy={changeBusy}
        onConfirm={() => confirmDeactivate && void changeStatus(confirmDeactivate, "inactive")}
        onCancel={() => setConfirmDeactivate(null)}
      />

      {/* Activity */}
      <Modal
        open={activity !== null}
        onClose={() => setActivity(null)}
        size="lg"
        title="User activity"
        subtitle={activity ? activity.profile.email : ""}
        icon={<Eye className="h-4 w-4" aria-hidden />}
        footer={<Button onClick={() => setActivity(null)}>Close</Button>}
      >
        {activityBusy ? (
          <div className="p-6 text-center text-xs text-muted">Loading activity&hellip;</div>
        ) : activity && activity.entries.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted">No recorded activity yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {activity?.entries.map((a) => (
                  <tr key={a.id}>
                    <td className="text-xs text-muted">{displayDateTime(a.created_at)}</td>
                    <td className="tnum text-xs font-semibold text-ink">{a.action}</td>
                    <td className="text-xs text-muted">{a.entity}</td>
                    <td className="max-w-[220px] truncate text-xs text-faint">
                      {a.metadata ? JSON.stringify(a.metadata) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}