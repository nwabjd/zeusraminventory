import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/format";

/* =============================================================== toasts === */

export type ToastTone = "success" | "error" | "info" | "warning" | "loading";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
  /** Loading toasts stay until they are updated or dismissed. */
  sticky?: boolean;
}

interface ToastApi {
  push: (t: Omit<Toast, "id">) => number;
  success: (title: string, detail?: string) => number;
  error: (title: string, detail?: string) => number;
  info: (title: string, detail?: string) => number;
  warning: (title: string, detail?: string) => number;
  loading: (title: string, detail?: string) => number;
  update: (id: number, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const TONE_STYLES: Record<ToastTone, { ring: string; icon: ReactNode }> = {
  success: {
    ring: "border-profit-500/40 bg-profit-50 text-profit-700",
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
  },
  error: {
    ring: "border-danger-500/40 bg-danger-50 text-danger-700",
    icon: <XCircle className="h-4 w-4" aria-hidden />,
  },
  warning: {
    ring: "border-warn-500/40 bg-warn-50 text-warn-700",
    icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
  },
  info: {
    ring: "border-brand-500/40 bg-brand-50 text-brand-700",
    icon: <Info className="h-4 w-4" aria-hidden />,
  },
  loading: {
    ring: "border-line-strong bg-surface text-muted",
    icon: <Loader2 className="spin h-4 w-4" aria-hidden />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const schedule = useCallback(
    (id: number, sticky: boolean) => {
      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing);
      if (sticky) return;
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), 4500),
      );
    },
    [dismiss],
  );

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      seq.current += 1;
      const id = seq.current;
      setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
      schedule(id, Boolean(t.sticky));
      return id;
    },
    [schedule],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (!patch.sticky) schedule(id, false);
    },
    [schedule],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      update,
      dismiss,
      success: (title, detail) => push({ tone: "success", title, detail }),
      error: (title, detail) => push({ tone: "error", title, detail, sticky: true }),
      info: (title, detail) => push({ tone: "info", title, detail }),
      warning: (title, detail) => push({ tone: "warning", title, detail }),
      loading: (title, detail) => push({ tone: "loading", title, detail, sticky: true }),
    }),
    [push, update, dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => window.clearTimeout(t));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="no-print pointer-events-none fixed top-3 right-3 z-[60] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2"
          role="status"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "anim-toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface p-3 shadow-[var(--shadow-raised)]",
                TONE_STYLES[t.tone].ring,
              )}
            >
              <span className="mt-0.5 shrink-0">{TONE_STYLES[t.tone].icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.detail && (
                  <p className="mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted">
                    {t.detail}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="-m-1 shrink-0 rounded p-1 text-faint transition-colors hover:bg-canvas hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/* ============================================================== feedback === */

export function LoadingState({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16", className)}>
      <Loader2 className="spin h-6 w-6 text-brand-500" aria-hidden />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

/** Table-shaped placeholder that matches the real column widths. */
export function SkeletonTable({
  rows = 6,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-3.5", c === 0 ? "w-40" : "flex-1")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-6 w-32" />
          <Skeleton className="mt-3 h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** Every list in ZEUS has one of these rather than a blank panel. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  secondaryAction,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {message && (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">{message}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export function InlineError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-danger-500/30 bg-danger-50 p-3",
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-danger-700">Something went wrong</p>
        <p className="mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-danger-700/85">
          {message}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-danger-500/40 bg-surface px-2 py-1 text-2xs font-bold text-danger-700 transition-colors hover:bg-danger-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}
