/* ===========================================================================
   Presentation helpers.
   ---------------------------------------------------------------------------
   The pure functions in here (payment state, margin, totals) are unit-tested by
   `src/lib/format.test.ts` because every screen depends on them agreeing with
   what the Rust backend stores.
   =========================================================================== */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ---------------------------------------------------------------- money -- */

export const DEFAULT_CURRENCY = "AED";

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `AED 1,250.00` - the single money formatter used everywhere. */
export function money(amount: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  const n = Number.isFinite(amount as number) ? (amount as number) : 0;
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${currency} ${group(Math.abs(rounded).toFixed(2))}`;
}

/** Bare number, e.g. for table cells that already show the currency in the header. */
export function amount(value: number | null | undefined): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0;
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${group(Math.abs(rounded).toFixed(2))}`;
}

export function qty(value: number | null | undefined): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0;
  return group(String(Math.trunc(n)));
}

/** `12.5` -> `12.5%`. The backend stores margins as percentages. */
export function percent(value: number | null | undefined, digits = 1): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0;
  return `${n.toFixed(digits)}%`;
}

/* ----------------------------------------------------------------- date -- */

/** `2026-03-01` -> `01/03/2026`. Handles `YYYY-MM-DD HH:MM:SS` too. */
export function displayDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = value.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return value;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** `2026-03-01 14:22:05` -> `01/03/2026 14:22`. */
export function displayDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = displayDate(value);
  const time = value.includes(" ") ? value.slice(11, 16) : "";
  return time ? `${d} ${time}` : d;
}

/** "Today" / "Yesterday" / a date, for the activity feeds. */
export function relativeDay(value: string | null | undefined): string {
  if (!value) return "-";
  const iso = value.slice(0, 10);
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const nowIso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yIso = `${yesterday.getFullYear()}-${p(yesterday.getMonth() + 1)}-${p(yesterday.getDate())}`;
  if (iso === nowIso) return "Today";
  if (iso === yIso) return "Yesterday";
  return displayDate(iso);
}

export function currentYear(): number {
  return new Date().getFullYear();
}

export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function bytes(size: number | null | undefined): string {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* --------------------------------------------------- document derivations -- */

export type PaymentState = "paid" | "partial" | "unpaid";

/**
 * Payment state is *derived*, never stored.
 *
 * `purchases.status` / `sales.status` only carry the lifecycle
 * (`completed` | `void`), so the UI must work out settlement from the amounts.
 */
export function paymentState(total: number, settled: number): PaymentState {
  if (total <= 0) return "paid";
  if (settled <= 0.005) return "unpaid";
  if (settled >= total - 0.005) return "paid";
  return "partial";
}

export function remainingOf(total: number, settled: number): number {
  return Math.max(0, Math.round((total - settled) * 100) / 100);
}

/** Margin as a percentage of revenue. */
export function marginPercent(revenue: number, cost: number): number {
  if (revenue <= 0) return 0;
  return Math.round(((revenue - cost) / revenue) * 1000) / 10;
}

export function grossProfit(revenue: number, cost: number): number {
  return Math.round((revenue - cost) * 100) / 100;
}

/* ---------------------------------------------------------------- stock -- */

export type StockTone = "profit" | "warn" | "danger" | "neutral";

export function stockTone(
  quantity: number,
  minimum: number,
): { tone: StockTone; label: string } {
  if (quantity <= 0) return { tone: "danger", label: "Out of stock" };
  if (quantity <= minimum) return { tone: "warn", label: "Low stock" };
  return { tone: "profit", label: "In stock" };
}

/* --------------------------------------------------------------- labels -- */

export const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  ADJUSTMENT_IN: "Stock increase",
  ADJUSTMENT_OUT: "Stock decrease",
  SALE_RETURN: "Sale return",
  PURCHASE_RETURN: "Purchase return",
  INITIAL: "Opening stock",
};

export function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type.replace(/_/g, " ").toLowerCase();
}

export const PAYMENT_LABELS: Record<string, string> = {
  RECEIVE_FROM_BUYER: "Received from buyer",
  PAY_SELLER: "Paid to seller",
  COWORKER_LEND: "Lent to coworker",
  COWORKER_BORROW: "Borrowed from coworker",
  COWORKER_RECEIVE: "Coworker repayment",
  COWORKER_REPAY: "Repaid coworker",
};

export function paymentLabel(type: string): string {
  return PAYMENT_LABELS[type] ?? type;
}

export const PERSON_LABELS: Record<string, string> = {
  buyer: "Buyer",
  seller: "Seller",
  coworker: "Coworker",
};

export function personLabel(type: string): string {
  return PERSON_LABELS[type] ?? type;
}

export const COWORKER_LABELS: Record<string, string> = {
  LEND: "Lent",
  BORROW: "Borrowed",
  REPAYMENT: "Repayment",
};

export function coworkerLabel(kind: string): string {
  return COWORKER_LABELS[kind] ?? kind;
}

/** `Z-D4-SER-32-2666V-0001` -> `DDR4 Server 32 GB 2666V`. */
export function skuSummary(item: {
  generation?: string;
  category?: string;
  capacity?: string;
  speed?: string;
}): string {
  return [item.generation, item.category, item.capacity, item.speed]
    .filter(Boolean)
    .join(" ");
}

/** Sign-aware balance wording, so a card never shows an ambiguous number. */
export function balanceDirection(balance: number, owedByThem: boolean): string {
  const v = Math.abs(balance);
  if (v < 0.005) return "Settled";
  return owedByThem ? "Owes you" : "You owe";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Deterministic avatar tint so the same party always looks the same. */
export function avatarTone(seed: string): string {
  const tones = [
    "bg-brand-100 text-brand-700",
    "bg-profit-100 text-profit-700",
    "bg-warn-100 text-warn-700",
    "bg-info-50 text-info-700",
    "bg-navy-100 text-navy-700",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return tones[h % tones.length];
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}
