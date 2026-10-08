import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/format";
import { Button, IconButton } from "./Controls";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[min(1400px,calc(100vw-3rem))]",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  size?: ModalSize;
  /** Footer buttons; when omitted the modal has no footer strip. */
  footer?: ReactNode;
  children: ReactNode;
  /** Disable closing via backdrop / Escape while a write is in flight. */
  busy?: boolean;
  bodyClassName?: string;
}

/**
 * The single modal in the app.
 *
 * Rendered in a portal, scroll-locked, Escape-closable and focus-trapped by
 * virtue of the first focusable control receiving focus. Used by every form and
 * confirmation so dialog behaviour is identical everywhere - the app never
 * falls back to the browser's `alert()` / `confirm()`.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  size = "md",
  footer,
  children,
  busy,
  bodyClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]), select, textarea, button",
      );
      focusable?.focus();
    }, 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(timer);
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="anim-fade-in absolute inset-0 bg-navy-950/45 backdrop-blur-[2px]"
        onClick={() => !busy && onClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          "anim-pop-in relative flex max-h-[calc(100vh-3rem)] w-full flex-col overflow-hidden",
          "rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]",
          SIZES[size],
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          {icon && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} disabled={busy}>
            <X className="h-4 w-4" aria-hidden />
          </IconButton>
        </header>

        <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-[#fafbfd] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "brand" | "danger" | "warn";
  icon?: ReactNode;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Every destructive action routes through this - never `window.confirm`. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "brand",
  icon,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      busy={busy}
      icon={icon}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : tone === "warn" ? "warn-soft" : "primary"}
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
    </Modal>
  );
}
