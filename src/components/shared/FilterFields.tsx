import { cn } from "../../lib/format";

/* ===========================================================================
   Filter field primitives
   ---------------------------------------------------------------------------
   The secondary half of every FilterBar - a labelled select and a date box that
   match the primary bar's styling exactly, so the eight-filters-on-inventory
   screen looks deliberate rather than assembled.
   =========================================================================== */

/** A plain string, or a value/label pair when the label differs from the value. */
export type FilterOption = string | { value: string; label: string };

function toOption(o: FilterOption): { value: string; label: string } {
  return typeof o === "string" ? { value: o, label: o } : o;
}

export function LabelledSelect({
  label,
  value,
  options,
  onChange,
  className,
  allLabel,
}: {
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
  className?: string;
  /** Default text for the "no filter" option; defaults to "<label>: All". */
  allLabel?: string;
}) {
  const active = Boolean(value);
  return (
    <label className={cn("min-w-0", className)}>
      <span className="field-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          "input h-9 w-auto min-w-[8.5rem] cursor-pointer text-xs",
          active && "border-brand-400 bg-brand-50 text-brand-800",
        )}
      >
        <option value="">{allLabel ?? `${label}: All`}</option>
        {options.map((raw) => {
          const o = toOption(raw);
          return (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function DateField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("min-w-0", className)}>
      <span className="field-label">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          "input tnum h-9 text-xs",
          value && "border-brand-400 bg-brand-50 text-brand-800",
        )}
      />
    </label>
  );
}

/** Common date presets for the Reports and history filters. */
export function DatePresetBar({
  from,
  to,
  onChange,
  className,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  className?: string;
}) {
  const iso = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const today = new Date();
  const startOf = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return d;
  };

  const presets: { label: string; from: string; to: string }[] = [
    { label: "Today", from: iso(today), to: iso(today) },
    { label: "7 days", from: iso(startOf(6)), to: iso(today) },
    { label: "30 days", from: iso(startOf(29)), to: iso(today) },
    { label: "This month", from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) },
    { label: "This year", from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) },
    { label: "All time", from: "", to: "" },
  ];

  const current = presets.find(
    (p) => p.from === from && p.to === to,
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {presets.map((p) => {
        const active = current?.label === p.label;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange({ from: p.from, to: p.to })}
            className={cn(
              "rounded-full px-2.5 py-1 text-2xs font-bold transition-colors",
              active
                ? "bg-brand-600 text-white"
                : "bg-canvas text-muted hover:bg-brand-50 hover:text-brand-800",
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}