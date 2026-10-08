import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, Check, ChevronDown, Plus, Search, User, Users } from "lucide-react";
import { api } from "../../lib/api";
import { cn, avatarTone, initials, money } from "../../lib/format";
import { useCurrency } from "../../lib/app-context";
import type { Party } from "../../lib/types";
import { Button, FormField, TextInput } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/Feedback";

/* ================================================================= popup === */

interface PopupProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}

/** Anchored popover used by every selector - no native `<select>` anywhere. */
export function Popup({ open, onClose, children, className, align = "left" }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "anim-pop-in absolute top-full z-40 mt-1.5 max-h-80 w-full min-w-[16rem] overflow-hidden",
        "rounded-lg border border-line bg-surface shadow-[var(--shadow-pop)]",
        align === "right" && "right-0",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

/* ========================================================== party dialog === */

export interface PartyFormValues {
  companyName: string;
  contactPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  trnVat: string;
  notes: string;
}

export const emptyPartyForm = (): PartyFormValues => ({
  companyName: "",
  contactPerson: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  city: "",
  trnVat: "",
  notes: "",
});

export function PartyFormDialog({
  open,
  kind,
  editing,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: "buyer" | "seller";
  editing?: Party | null;
  initial?: Partial<PartyFormValues>;
  onClose: () => void;
  onSaved: (party: Party) => void;
}) {
  const [values, setValues] = useState<PartyFormValues>(emptyPartyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    setValues(
      editing
        ? {
            companyName: editing.companyName,
            contactPerson: editing.contactPerson ?? "",
            phone: editing.phone ?? "",
            whatsapp: editing.whatsapp ?? "",
            email: editing.email ?? "",
            address: editing.address ?? "",
            city: editing.city ?? "",
            trnVat: editing.trnVat ?? "",
            notes: editing.notes ?? "",
          }
        : { ...emptyPartyForm(), ...initial },
    );
  }, [open, editing, initial]);

  const set = (k: keyof PartyFormValues, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => (prev[k] ? { ...prev, [k]: "" } : prev));
  };

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!values.companyName.trim()) next.companyName = "Company name is required.";
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      next.email = "Enter a valid email address.";
    }
    if (values.phone && values.phone.replace(/\D/g, "").length < 7) {
      next.phone = "Enter a reachable phone number.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setServerError(null);
    try {
      const payload = {
        companyName: values.companyName.trim(),
        contactPerson: values.contactPerson.trim() || null,
        phone: values.phone.trim() || null,
        whatsapp: values.whatsapp.trim() || null,
        email: values.email.trim() || null,
        address: values.address.trim() || null,
        city: values.city.trim() || null,
        trnVat: values.trnVat.trim() || null,
        notes: values.notes.trim() || null,
      };
      const saved = editing
        ? kind === "buyer"
          ? await api.updateBuyer(editing.id, payload)
          : await api.updateSeller(editing.id, payload)
        : kind === "buyer"
          ? await api.createBuyer(payload)
          : await api.createSeller(payload);
      onSaved(saved);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const noun = kind === "buyer" ? "Buyer" : "Seller";

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={editing ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`}
      subtitle={
        editing
          ? `Update the details of ${editing.companyName}`
          : "Only the company name is required - fill in the rest as you learn it."
      }
      icon={kind === "buyer" ? <Users className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {editing ? "Save changes" : `Create ${noun.toLowerCase()}`}
          </Button>
        </>
      }
    >
      {serverError && (
        <div className="mb-3 rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-medium text-danger-700">
          {serverError}
        </div>
      )}
      <div className="space-y-3">
        <FormField label="Company name" required error={errors.companyName}>
          <TextInput
            value={values.companyName}
            onChange={(e) => set("companyName", e.target.value)}
            placeholder={kind === "buyer" ? "e.g. Sharjah Computer Trading" : "e.g. Dubai RAM Supplier"}
            invalid={Boolean(errors.companyName)}
            autoFocus
          />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Contact person">
            <TextInput
              value={values.contactPerson}
              onChange={(e) => set("contactPerson", e.target.value)}
              placeholder="Full name"
            />
          </FormField>
          <FormField label="City" error={undefined}>
            <TextInput
              value={values.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="Dubai"
            />
          </FormField>
          <FormField label="Phone" error={errors.phone}>
            <TextInput
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+971 50 000 0000"
              invalid={Boolean(errors.phone)}
            />
          </FormField>
          <FormField label="WhatsApp">
            <TextInput
              value={values.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
              placeholder="+971 50 000 0000"
            />
          </FormField>
          <FormField label="Email" error={errors.email}>
            <TextInput
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@company.ae"
              invalid={Boolean(errors.email)}
            />
          </FormField>
          <FormField label="TRN (VAT number)">
            <TextInput
              value={values.trnVat}
              onChange={(e) => set("trnVat", e.target.value)}
              placeholder="100123456700003"
            />
          </FormField>
        </div>
        <FormField label="Address">
          <TextInput
            value={values.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Street, building, area"
          />
        </FormField>
        <FormField label="Notes" hint="Anything worth remembering about this partner.">
          <TextInput
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Pays on Fridays, prefers WhatsApp..."
          />
        </FormField>
      </div>
    </Modal>
  );
}

/* ========================================================== party selector === */

export interface PartySelectorProps {
  kind: "buyer" | "seller";
  value: Party | null;
  onChange: (party: Party | null) => void;
  label?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  /** Party pre-filled when the user types a brand new name. */
  newPartyDefaults?: Partial<PartyFormValues>;
}

export function PartySelector({
  kind,
  value,
  onChange,
  label,
  required,
  error,
  disabled,
  newPartyDefaults,
}: PartySelectorProps) {
  const currency = useCurrency();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const noun = kind === "buyer" ? "buyer" : "seller";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const res = query.trim()
          ? kind === "buyer"
            ? await api.searchBuyers(query, 40)
            : await api.searchSellers(query, 40)
          : kind === "buyer"
            ? await api.listBuyers("", false)
            : await api.listSellers("", false);
        if (!cancelled) setParties(res);
      } catch {
        if (!cancelled) setParties([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const timer = window.setTimeout(load, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, kind]);

  useEffect(() => setHighlight(0), [query, parties.length]);

  const exactExists = useMemo(
    () => parties.some((p) => p.companyName.toLowerCase() === query.trim().toLowerCase()),
    [parties, query],
  );

  const Icon = kind === "buyer" ? Users : Building2;

  return (
    <div className="min-w-0">
      {label && (
        <label className={cn("field-label", required && "field-required")}>{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen((v) => !v);
            setQuery("");
          }}
          className={cn(
            "input flex w-full items-center gap-2 text-left",
            !value && "text-faint",
            error && "input-invalid",
            disabled && "cursor-not-allowed",
          )}
        >
          {value ? (
            <>
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-2xs font-bold",
                  avatarTone(value.companyName),
                )}
              >
                {initials(value.companyName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {value.companyName}
                </span>
                <span className="block truncate text-2xs text-muted">
                  {value.code}
                  {value.city ? ` - ${value.city}` : ""}
                  {Math.abs(value.currentBalance) > 0.005 &&
                    ` - ${value.currentBalance > 0 ? "owes " : "we owe "}${money(Math.abs(value.currentBalance), currency)}`}
                </span>
              </span>
            </>
          ) : (
            <>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 text-sm">Select {noun} or create one</span>
            </>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>

        {open && (
          <Popup
            open={open}
            onClose={() => setOpen(false)}
            className="min-w-full"
          >
            <div className="border-b border-line p-2">
              <div className="input-group">
                <Search className="input-group-icon h-3.5 w-3.5" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setHighlight((h) => Math.min(h + 1, parties.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setHighlight((h) => Math.max(h - 1, 0));
                    } else if (e.key === "Enter" && parties[highlight]) {
                      e.preventDefault();
                      onChange(parties[highlight]);
                      setOpen(false);
                    }
                  }}
                  placeholder={`Search ${noun}s by name, city, phone or code`}
                  className="input h-8 pl-7 text-xs"
                />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {loading ? (
                <p className="px-3 py-6 text-center text-xs text-muted">Loading&hellip;</p>
              ) : parties.length === 0 ? (
                <EmptyState
                  compact
                  title={query ? `No ${noun} matches "${query}"` : `No ${noun}s yet`}
                  message={
                    query
                      ? `Create "${query}" as a new ${noun}, or pick an existing one.`
                      : `Create your first ${noun} to start trading.`
                  }
                />
              ) : (
                <ul>
                  {parties.map((p, i) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => {
                          onChange(p);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                          i === highlight ? "bg-brand-50" : "hover:bg-canvas",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded text-2xs font-bold",
                            avatarTone(p.companyName),
                          )}
                        >
                          {initials(p.companyName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-ink">
                            {p.companyName}
                          </span>
                          <span className="block truncate text-2xs text-muted">
                            {[p.code, p.city, p.contactPerson].filter(Boolean).join(" - ")}
                          </span>
                        </span>
                        {Math.abs(p.currentBalance) > 0.005 ? (
                          <span
                            className={cn(
                              "tnum shrink-0 text-2xs font-bold",
                              p.currentBalance > 0 ? "text-warn-700" : "text-brand-700",
                            )}
                          >
                            {money(Math.abs(p.currentBalance), currency)}
                          </span>
                        ) : value?.id === p.id ? (
                          <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-line p-2">
              <Button
                variant="secondary"
                size="sm"
                block
                icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => {
                  setOpen(false);
                  setDialogOpen(true);
                }}
              >
                {query.trim() && !exactExists
                  ? `Create "${query.trim()}" as a new ${noun}`
                  : `+ New ${noun}`}
              </Button>
            </div>
          </Popup>
        )}
      </div>

      {error ? (
        <p className="field-error">{error}</p>
      ) : (
        value && (
          <p className="mt-1 text-2xs text-faint">
            {value.code}
            {value.contactPerson ? ` - ${value.contactPerson}` : ""}
            {value.phone ? ` - ${value.phone}` : ""}
          </p>
        )
      )}

      <PartyFormDialog
        open={dialogOpen}
        kind={kind}
        initial={{ companyName: query.trim(), ...newPartyDefaults }}
        onClose={() => setDialogOpen(false)}
        onSaved={(party) => {
          setDialogOpen(false);
          onChange(party);
          setQuery("");
        }}
      />
    </div>
  );
}

/* ======================================================= coworker selector === */

export function CoworkerSelector({
  value,
  onChange,
  label,
  required,
  error,
  disabled,
}: {
  value: { id: string; name: string; currentBalance: number } | null;
  onChange: (coworker: { id: string; name: string; currentBalance: number } | null) => void;
  label?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const currency = useCurrency();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; currentBalance: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.listCoworkers("", false);
        if (!cancelled) setRows(res);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <div className="min-w-0">
      {label && (
        <label className={cn("field-label", required && "field-required")}>{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen((v) => !v);
            setQuery("");
            setNewName("");
          }}
          className={cn(
            "input flex w-full items-center gap-2 text-left",
            !value && "text-faint",
            error && "input-invalid",
          )}
        >
          {value ? (
            <>
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-2xs font-bold",
                  avatarTone(value.name),
                )}
              >
                {initials(value.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{value.name}</span>
                <span className="block truncate text-2xs text-muted">
                  {Math.abs(value.currentBalance) < 0.005
                    ? "Settled"
                    : `${value.currentBalance > 0 ? "Owes us" : "We owe"} ${money(Math.abs(value.currentBalance), currency)}`}
                </span>
              </span>
            </>
          ) : (
            <>
              <User className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 text-sm">Select coworker or add one</span>
            </>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>

        {open && (
          <Popup open={open} onClose={() => setOpen(false)} className="min-w-full">
            <div className="border-b border-line p-2">
              <div className="input-group">
                <Search className="input-group-icon h-3.5 w-3.5" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search coworkers"
                  className="input h-8 pl-7 text-xs"
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {loading ? (
                <p className="px-3 py-6 text-center text-xs text-muted">Loading&hellip;</p>
              ) : filtered.length === 0 ? (
                <EmptyState compact title="No coworkers yet" message="Add one to open a ledger." />
              ) : (
                <ul>
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(c);
                          setOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-canvas"
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded text-2xs font-bold",
                            avatarTone(c.name),
                          )}
                        >
                          {initials(c.name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                          {c.name}
                        </span>
                        <span
                          className={cn(
                            "tnum shrink-0 text-2xs font-bold",
                            Math.abs(c.currentBalance) < 0.005
                              ? "text-faint"
                              : c.currentBalance > 0
                                ? "text-warn-700"
                                : "text-brand-700",
                          )}
                        >
                          {Math.abs(c.currentBalance) < 0.005
                            ? "Settled"
                            : money(Math.abs(c.currentBalance), currency)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-line p-2">
              {creating ? (
                <div className="flex items-center gap-1.5">
                  <TextInput
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Coworker name"
                    className="h-8 text-xs"
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter" || !newName.trim()) return;
                      setCreating(false);
                      try {
                        const created = await api.createCoworker(newName.trim());
                        onChange(created);
                        setOpen(false);
                      } catch {
                        /* surfaced by the caller's error handling */
                      }
                    }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      if (!newName.trim()) return;
                      setCreating(false);
                      try {
                        const created = await api.createCoworker(newName.trim());
                        onChange(created);
                        setOpen(false);
                      } catch {
                        setCreating(false);
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  block
                  icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => setCreating(true)}
                >
                  + New coworker
                </Button>
              )}
            </div>
          </Popup>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
