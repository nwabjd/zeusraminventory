import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Button, FormField, TextArea } from "./Controls";
import { Modal } from "./Modal";

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Extra warning bullets shown above the field. */
  points?: string[];
  confirmLabel: string;
  confirmLabelShort?: string;
  busy?: boolean;
  serverError?: string | null;
  placeholder?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Destructive confirmations that need a written justification - voiding a
 * document, reversing a payment, restoring a backup, deleting a party.
 *
 * A reason is mandatory so the audit trail explains *why* a record changed, and
 * so the confirmation reads as a deliberate act rather than a mis-click.
 */
export function ReasonDialog({
  open,
  title,
  description,
  points,
  confirmLabel,
  confirmLabelShort = "Confirm",
  busy,
  serverError,
  placeholder,
  onConfirm,
  onCancel,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open]);

  const submit = () => {
    if (!reason.trim()) {
      setError("A reason is required so the audit trail explains the change.");
      return;
    }
    setError(null);
    onConfirm(reason.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      busy={busy}
      size="sm"
      title={title}
      icon={<Ban className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy}>
            {confirmLabelShort}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted">{description}</p>

        {points && points.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-line bg-[#fafbfd] p-3">
            {points.map((p) => (
              <li key={p} className="flex gap-2 text-xs leading-relaxed text-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-line-strong" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        )}

        {serverError && (
          <div
            role="alert"
            className="rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs leading-relaxed font-medium whitespace-pre-wrap text-danger-700"
          >
            {serverError}
          </div>
        )}

        <FormField label="Reason" required error={error ?? undefined} hint={`${confirmLabel}`}>
          <TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder ?? "Explain what happened and why"}
            invalid={Boolean(error)}
            autoFocus
          />
        </FormField>
      </div>
    </Modal>
  );
}
