import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, Loader2, Search, X } from "lucide-react";
import { cn, qty } from "../../lib/format";

/* ============================================================== buttons === */

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "profit"
  | "danger"
  | "danger-soft"
  | "warn-soft";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "xs" | "sm" | "md" | "lg";
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "btn",
        `btn-${variant}`,
        size === "xs" && "btn-xs",
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        block && "w-full",
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 className="spin h-4 w-4 shrink-0" aria-hidden />
      ) : (
        icon
      )}
      {children}
      {iconRight}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
  tone?: "default" | "profit" | "danger" | "warn" | "brand";
}

export function IconButton({
  label,
  variant = "ghost",
  tone,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "btn btn-icon",
        `btn-${variant}`,
        tone === "profit" && "text-profit-600 hover:!bg-profit-50",
        tone === "danger" && "text-danger-600 hover:!bg-danger-50",
        tone === "warn" && "text-warn-600 hover:!bg-warn-50",
        tone === "brand" && "text-brand-600 hover:!bg-brand-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* =============================================================== fields === */

export interface FieldProps {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({
  label,
  required,
  hint,
  error,
  htmlFor,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  // Associate the <label> with the control it wraps: the single child control is
  // cloned with a stable id and the label's htmlFor points at it, so screen
  // readers announce the name and clicking the text focuses the control.
  const child =
    Children.count(children) === 1 && isValidElement(children)
      ? (children as ReactElement<{ id?: string }>)
      : null;
  const childOwnId = typeof child?.props.id === "string" ? child.props.id : undefined;
  const id = htmlFor ?? childOwnId ?? autoId;
  const content = child && !childOwnId && !htmlFor ? cloneElement(child, { id }) : children;
  const labelTarget = child || htmlFor ? id : undefined;
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <label
          htmlFor={labelTarget}
          className={cn("field-label", required && "field-required")}
        >
          {label}
        </label>
      )}
      {content}
      {error ? (
        <p className="field-error">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ invalid, className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn("input", invalid && "input-invalid", className)}
        {...rest}
      />
    );
  },
);

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ invalid, className, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn("input resize-y", invalid && "input-invalid", className)}
        {...rest}
      />
    );
  },
);

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

export function SelectField({
  options,
  placeholder,
  invalid,
  className,
  ...rest
}: SelectFieldProps) {
  return (
    <select className={cn("input", invalid && "input-invalid", className)} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
  compact?: boolean;
}

export function SearchInput({
  value,
  onValueChange,
  onClear,
  compact,
  className,
  placeholder = "Search",
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn("input-group", compact ? "w-56" : "w-72", className)}>
      <Search className="input-group-icon h-4 w-4" aria-hidden />
      <input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="input"
        {...rest}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            onClear?.();
          }}
          title="Clear search"
          aria-label="Clear search"
          className="absolute right-1.5 rounded p-1 text-faint transition-colors hover:bg-canvas hover:text-ink"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export interface CurrencyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number;
  onValueChange: (value: number) => void;
  currency?: string;
  invalid?: boolean;
}

export function CurrencyInput({
  value,
  onValueChange,
  currency = "AED",
  invalid,
  className,
  ...rest
}: CurrencyInputProps) {
  return (
    <div className={cn("relative", className)}>
      <input
        type="number"
        step="0.01"
        min="0"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onValueChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className={cn("input tnum pr-12 text-right", invalid && "input-invalid")}
        {...rest}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-2xs font-bold text-faint">
        {currency}
      </span>
    </div>
  );
}

export interface QuantityInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number;
  onValueChange: (value: number) => void;
  invalid?: boolean;
  max?: number;
}

export function QuantityInput({
  value,
  onValueChange,
  invalid,
  max,
  className,
  ...rest
}: QuantityInputProps) {
  return (
    <div className={cn("relative", className)}>
      <input
        type="number"
        step="1"
        min="0"
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onValueChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className={cn("input tnum text-right", invalid && "input-invalid")}
        {...rest}
      />
    </div>
  );
}

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  hint?: string;
}

export function Checkbox({
  label,
  checked,
  onCheckedChange,
  hint,
  className,
  ...rest
}: CheckboxProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-field)] px-1 py-0.5",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-2xs text-faint">{hint}</span>}
      </span>
    </label>
  );
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-2xs text-faint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand-600" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            checked ? "left-[1.375rem]" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}

export function FormRow({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {children}
    </div>
  );
}

/** A number rendered in the app's tabular style - used across every table. */
export function Num({ children }: { children: ReactNode }) {
  return <span className="tnum">{children}</span>;
}

export function Qty({ value }: { value: number }) {
  return <span className="tnum">{qty(value)}</span>;
}
