import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn, money } from "../../lib/format";

/* ============================================================ page header === */

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Rendered under the action row - e.g. a filter bar. */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("no-print shrink-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

/* ============================================================== stat card === */

export type StatTone = "brand" | "profit" | "danger" | "warn" | "neutral" | "navy";

const TONE_CHIP: Record<StatTone, string> = {
  brand: "bg-brand-50 text-brand-700",
  profit: "bg-profit-50 text-profit-700",
  danger: "bg-danger-50 text-danger-700",
  warn: "bg-warn-50 text-warn-700",
  neutral: "bg-canvas text-muted",
  navy: "bg-navy-900 text-navy-100",
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Rendered under the value in the card's own tone. */
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  onClick?: () => void;
  className?: string;
  dense?: boolean;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  onClick,
  className,
  dense,
}: StatCardProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "card flex w-full flex-col text-left transition-all",
        dense ? "p-3" : "p-4",
        onClick && "cursor-pointer hover:-translate-y-px hover:border-brand-300 hover:shadow-[var(--shadow-raised)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-bold tracking-wider text-muted uppercase">
          {label}
        </span>
        {icon && (
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", TONE_CHIP[tone])}>
            {icon}
          </span>
        )}
      </div>
      <div
        className={cn(
          "tnum mt-1.5 truncate font-bold text-ink",
          dense ? "text-lg" : "text-2xl",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-2xs text-faint">{hint}</div>}
    </Wrapper>
  );
}

/** A money stat that shows direction with an arrow instead of a colour alone. */
export function MoneyStat({
  label,
  value,
  currency,
  direction,
  hint,
  icon,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  currency?: string;
  direction?: "up" | "down" | "flat";
  hint?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  tone?: StatTone;
}) {
  const Arrow =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <StatCard
      label={label}
      value={money(value, currency)}
      tone={tone}
      icon={icon}
      onClick={onClick}
      hint={
        hint ?? (
          <span className="inline-flex items-center gap-1">
            {direction && direction !== "flat" && (
              <Arrow
                className={cn(
                  "h-3 w-3",
                  direction === "up" ? "text-profit-600" : "text-danger-600",
                )}
                aria-hidden
              />
            )}
            {direction === "up" ? "Money in" : direction === "down" ? "Money out" : "Net position"}
          </span>
        )
      }
    />
  );
}

/* ==================================================== primary action cards === */

export interface PrimaryActionProps {
  label: string;
  description: string;
  icon: ReactNode;
  tone: "buy" | "sell";
  onClick: () => void;
  shortcut?: string;
  disabled?: boolean;
}

export function PrimaryActionCard({
  label,
  description,
  icon,
  tone,
  onClick,
  shortcut,
  disabled,
}: PrimaryActionProps) {
  const buy = tone === "buy";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative flex flex-1 items-center gap-4 overflow-hidden rounded-[var(--radius-card)] p-4 text-left",
        "border transition-all duration-200",
        buy
          ? "border-profit-500/35 bg-gradient-to-br from-profit-50 via-surface to-surface hover:border-profit-500 hover:shadow-[var(--shadow-raised)]"
          : "border-danger-500/35 bg-gradient-to-br from-danger-50 via-surface to-surface hover:border-danger-500 hover:shadow-[var(--shadow-raised)]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-transform duration-200 group-hover:scale-105",
          buy ? "bg-profit-600" : "bg-danger-600",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-lg font-bold tracking-tight",
            buy ? "text-profit-700" : "text-danger-700",
          )}
        >
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">
          {description}
        </span>
      </span>
      {shortcut && <span className="kbd shrink-0">{shortcut}</span>}
    </button>
  );
}

/* =========================================================== section card === */

export function SectionCard({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
}) {
  return (
    <section className={cn("card flex min-h-0 flex-col", className)}>
      <div className="card-header shrink-0">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && <span className="shrink-0 text-brand-600">{icon}</span>}
          <div className="min-w-0">
            <h2 className="card-title truncate">{title}</h2>
            {subtitle && <p className="card-subtitle truncate">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
      {footer && (
        <div className="shrink-0 border-t border-line px-4 py-2.5">{footer}</div>
      )}
    </section>
  );
}

/* ======================================================== transaction sum === */

export interface SummaryLine {
  label: string;
  value: ReactNode;
  tone?: "default" | "profit" | "danger" | "brand" | "warn";
  hint?: ReactNode;
  strong?: boolean;
}

export function TransactionSummary({
  lines,
  className,
}: {
  lines: SummaryLine[];
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-line bg-[#fafbfd] p-3", className)}>
      <dl className="space-y-1.5">
        {lines.map((l) => (
          <div
            key={l.label}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="text-xs text-muted">
              {l.label}
              {l.hint && <span className="ml-1 text-faint">{l.hint}</span>}
            </dt>
            <dd
              className={cn(
                "tnum text-sm font-semibold",
                l.tone === "profit" && "text-profit-700",
                l.tone === "danger" && "text-danger-700",
                l.tone === "brand" && "text-brand-700",
                l.tone === "warn" && "text-warn-700",
                (!l.tone || l.tone === "default") && "text-ink",
                l.strong && "text-base",
              )}
            >
              {l.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ============================================================== trend chip === */

export function TrendChip({
  value,
  suffix = "%",
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "badge tnum",
        flat ? "badge-neutral" : up ? "badge-profit" : "badge-danger",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {flat ? "0" : up ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

/* ============================================================ label / value === */

export function DataList({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-2.5",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
      )}
    >
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-2xs font-bold tracking-wider text-muted uppercase">
            {i.label}
          </dt>
          <dd className="mt-0.5 truncate text-sm text-ink">{i.value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}
