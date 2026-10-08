import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from "lucide-react";
import { cn, paymentState, type PaymentState } from "../../lib/format";

/* ================================================================ badges === */

export type BadgeTone =
  | "neutral"
  | "brand"
  | "profit"
  | "danger"
  | "warn"
  | "info"
  | "navy";

export function StatusBadge({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("badge", `badge-${tone}`, className)}>
      {icon}
      {children}
    </span>
  );
}

const STATE_TONE: Record<PaymentState, BadgeTone> = {
  paid: "profit",
  partial: "warn",
  unpaid: "danger",
};

const STATE_LABEL: Record<PaymentState, string> = {
  paid: "Paid",
  partial: "Partial",
  unpaid: "Unpaid",
};

/** Settlement badge derived from amounts - documents only store a lifecycle. */
export function PaymentBadge({
  total,
  settled,
  voided,
}: {
  total: number;
  settled: number;
  voided?: boolean;
}) {
  if (voided) return <StatusBadge tone="neutral">Voided</StatusBadge>;
  const state = paymentState(total, settled);
  return <StatusBadge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</StatusBadge>;
}

export function StockBadge({
  quantity,
  minimum,
}: {
  quantity: number;
  minimum: number;
}) {
  if (quantity <= 0) return <StatusBadge tone="danger">Out of stock</StatusBadge>;
  if (quantity <= minimum) {
    return (
      <StatusBadge tone="warn">
        Low stock &middot; {quantity}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="profit">
      {quantity} in stock
    </StatusBadge>
  );
}

export function BalanceBadge({
  balance,
  owedByThem,
}: {
  balance: number;
  /** Buyers: positive means they owe us. Sellers: positive means we owe them. */
  owedByThem: boolean;
}) {
  const v = Math.abs(balance);
  if (v < 0.005) return <StatusBadge tone="neutral">Settled</StatusBadge>;
  return (
    <StatusBadge tone={owedByThem ? "warn" : "brand"}>
      {owedByThem ? "Owes us" : "We owe"}
    </StatusBadge>
  );
}

export function ArchivedBadge({ archived }: { archived: boolean }) {
  return archived ? <StatusBadge tone="neutral">Archived</StatusBadge> : null;
}

/* ============================================================== data table === */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  /** Hidden below this breakpoint to survive 1280x720. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Right-aligned, monospaced numerals. */
  numeric?: boolean;
}

const HIDE_CLASS: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  footer?: ReactNode;
  empty?: ReactNode;
  className?: string;
  /** Column to sort by; pair with `sortDirection`. */
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  dense?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  footer,
  empty,
  className,
  sortKey,
  sortDirection,
  onSort,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  /* Exactly one sort indicator: a single Lucide chevron whose direction
     mirrors the active sort. No text glyphs, no stacked icons. */
  const sortable = (key: string) => {
    if (!onSort || sortKey !== key) return null;
    const Icon = sortDirection === "asc" ? ChevronUp : ChevronDown;
    return (
      <span className="ml-1 inline-flex items-center text-brand-600">
        <Icon className="h-3 w-3" aria-hidden />
        <span className="sr-only">
          {sortDirection === "asc" ? "(ascending)" : "(descending)"}
        </span>
      </span>
    );
  };

  return (
    <div className={cn("table-wrap", className)}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  c.numeric && "text-right",
                  c.align === "center" && "text-center",
                  c.hideBelow && HIDE_CLASS[c.hideBelow],
                )}
              >
                {onSort ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={cn(
                      "inline-flex cursor-pointer items-center transition-colors hover:text-brand-700",
                      c.numeric && "flex-row-reverse",
                    )}
                  >
                    {c.header}
                    {sortable(c.key)}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey(row, i);
            return (
              <tr
                key={key}
                className={cn(
                  onRowClick && "cursor-pointer",
                  selectedKey === key && "row-selected",
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      c.numeric && "num",
                      c.align === "center" && "text-center",
                      c.hideBelow && HIDE_CLASS[c.hideBelow],
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

/* =========================================================== filter bar === */

export interface FilterField {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  width?: string;
}

export interface FilterBarProps {
  search?: ReactNode;
  fields?: FilterField[];
  children?: ReactNode;
  className?: string;
}

export function FilterBar({ search, fields = [], children, className }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = fields.filter((f) => f.value && f.value !== "all").length;

  return (
    <div className={cn("no-print", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search}
        {fields.slice(0, 3).map((f) => (
          <select
            key={f.key}
            value={f.value || "all"}
            onChange={(e) => f.onChange(e.target.value)}
            aria-label={f.label}
            style={f.width ? { width: f.width } : undefined}
            className={cn(
              "input h-9 w-auto min-w-[8.5rem] cursor-pointer text-xs",
              f.value && f.value !== "all" && "border-brand-400 bg-brand-50 text-brand-800",
            )}
          >
            <option value="all">{f.label}: All</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {fields.length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="btn btn-secondary btn-sm"
          >
            {expanded ? "Fewer filters" : `More filters${activeCount > 3 ? ` (${activeCount})` : ""}`}
          </button>
        )}
        {children}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => fields.forEach((f) => f.onChange("all"))}
            className="btn btn-ghost btn-sm"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>
      {expanded && fields.length > 3 && (
        <div className="anim-fade-in mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line-strong bg-[#fafbfd] p-2">
          {fields.slice(3).map((f) => (
            <select
              key={f.key}
              value={f.value || "all"}
              onChange={(e) => f.onChange(e.target.value)}
              aria-label={f.label}
              className={cn(
                "input h-9 w-auto min-w-[8.5rem] cursor-pointer text-xs",
                f.value && f.value !== "all" && "border-brand-400 bg-brand-50 text-brand-800",
              )}
            >
              <option value="all">{f.label}: All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ pagination === */

export interface PaginationProps {
  total: number;
  pageSize: number;
  page: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  label?: string;
}

export function Pagination({
  total,
  pageSize,
  page,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100, 200],
  label = "records",
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const window = useMemo(() => {
    const out: number[] = [];
    const start = Math.max(1, Math.min(page - 1, pages - 2));
    for (let i = start; i <= Math.min(pages, start + 2); i += 1) out.push(i);
    return out;
  }, [page, pages]);

  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
      <p className="tnum text-xs text-muted">
        Showing <span className="font-semibold text-ink">{from}</span>&ndash;
        <span className="font-semibold text-ink">{to}</span> of{" "}
        <span className="font-semibold text-ink">{total}</span> {label}
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
            className="input h-8 w-auto cursor-pointer py-0 pl-2 text-xs"
          >
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="btn btn-secondary btn-icon h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          {window.map((p, i) => (
            <span key={p} className="flex items-center">
              {i === 1 && window[0] > 1 && (
                <span className="px-1 text-xs text-faint">&hellip;</span>
              )}
              <button
                type="button"
                onClick={() => onPageChange(p)}
                className={cn(
                  "tnum h-8 min-w-8 rounded-[var(--radius-field)] px-1.5 text-xs font-semibold transition-colors",
                  p === page
                    ? "bg-brand-600 text-white"
                    : "text-muted hover:bg-brand-50 hover:text-brand-800",
                )}
              >
                {p}
              </button>
            </span>
          ))}
          {window[window.length - 1] < pages && (
            <>
              <span className="px-1 text-xs text-faint">&hellip;</span>
              <button
                type="button"
                onClick={() => onPageChange(pages)}
                className="tnum h-8 min-w-8 rounded-[var(--radius-field)] px-1.5 text-xs font-semibold text-muted transition-colors hover:bg-brand-50 hover:text-brand-800"
              >
                {pages}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pages}
            aria-label="Next page"
            className="btn btn-secondary btn-icon h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Slices an array for client-side pagination. */
export function usePagedRows<T>(rows: T[], pageSize: number, page: number) {
  return useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );
}
