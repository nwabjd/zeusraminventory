import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Package, Plus, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { cn, money, qty, skuSummary } from "../../lib/format";
import { CAPACITIES, CATEGORIES, CONDITIONS, DEFAULT_MANUFACTURERS, GENERATIONS } from "../../lib/constants";
import { mergeValues, speedOptionsFor, useReferenceData } from "../../lib/reference-data";
import { useCurrency } from "../../lib/app-context";
import type { RamItem } from "../../lib/types";
import { Button, Checkbox, CurrencyInput, FormField, QuantityInput, SelectField, TextInput } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { StatusBadge } from "../ui/DataTable";
import { EmptyState } from "../ui/Feedback";

/* ================================================== quick-create RAM item === */

export interface QuickItemResult {
  item: RamItem;
}

export interface QuickItemDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (item: RamItem) => void;
  /** Pre-fills the form, e.g. from a partial search on the buy/sell screen. */
  initial?: Partial<{
    generation: string;
    category: string;
    capacity: string;
    speed: string;
    manufacturer: string;
    partNumber: string;
    purchasePrice: number;
    sellingPrice: number;
  }>;
}

/**
 * "Add RAM item" without leaving the transaction screen.
 *
 * Validation lives in the Rust backend (`catalog::validate`), so this form only
 * catches the obvious UI-level problems and then defers to the server message.
 */
export function QuickItemDialog({ open, onClose, onCreated, initial }: QuickItemDialogProps) {
  const currency = useCurrency();
  const ref = useReferenceData();
  const [values, setValues] = useState({
    generation: "DDR4",
    category: "PC",
    capacity: "",
    speed: "",
    manufacturer: "",
    model: "",
    partNumber: "",
    condition: "New",
    purchasePrice: 0,
    sellingPrice: 0,
    minimumStock: 5,
    openingQuantity: 0,
    location: "",
    notes: "",
  });
  const [ecc, setEcc] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    setValues((v) => ({ ...v, ...initial }));
  }, [open, initial]);

  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  const categoryOptions = useMemo(
    () => mergeValues(ref.named.categories ?? [], ref.usedCategories, CATEGORIES),
    [ref.named.categories, ref.usedCategories],
  );
  const manufacturerOptions = useMemo(
    () => mergeValues(ref.named.manufacturers ?? [], ref.usedManufacturers, DEFAULT_MANUFACTURERS),
    [ref.named.manufacturers, ref.usedManufacturers],
  );
  const locationOptions = useMemo(
    () => mergeValues(ref.named.locations ?? [], ref.usedLocations),
    [ref.named.locations, ref.usedLocations],
  );
  const conditionOptions = useMemo(
    () => mergeValues(ref.named.conditions ?? [], [], CONDITIONS),
    [ref.named.conditions],
  );
  const speedOptions = useMemo(
    () => speedOptionsFor(ref.speeds, values.generation, values.category, values.speed),
    [ref.speeds, values.generation, values.category, values.speed],
  );
  /** Keep a pre-existing value visible even if it is not in the master list. */
  const keepCurrent = (list: string[], current: string | undefined) => {
    if (current && !list.includes(current)) return [current, ...list];
    return list;
  };
  const capacityOptions = useMemo(
    () => keepCurrent(CAPACITIES, values.capacity || undefined),
    [values.capacity],
  );
  const manufacturerChoices = useMemo(
    () => keepCurrent(manufacturerOptions, values.manufacturer || undefined),
    [manufacturerOptions, values.manufacturer],
  );
  const locationChoices = useMemo(
    () => keepCurrent(locationOptions, values.location || undefined),
    [locationOptions, values.location],
  );
  /**
   * Generation drives the speed list. If the current speed stops being a valid
   * choice for the new generation, the selection is cleared. Category does not
   * filter speeds - it is an independent spec.
   */
  const changeGeneration = (next: string) =>
    setValues((prev) => ({
      ...prev,
      generation: next,
      speed: speedOptionsFor(ref.speeds, next, prev.category).includes(prev.speed)
        ? prev.speed
        : "",
    }));
  const changeCategory = (next: string) =>
    setValues((prev) => ({
      ...prev,
      category: next,
      speed: speedOptionsFor(ref.speeds, prev.generation, next).includes(prev.speed)
        ? prev.speed
        : "",
    }));

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!values.capacity.trim()) next.capacity = "Capacity is required, e.g. 32 GB.";
    if (!values.speed.trim()) next.speed = "Speed is required, e.g. 2666V.";
    if (values.purchasePrice < 0) next.purchasePrice = "Cost cannot be negative.";
    if (values.sellingPrice < 0) next.sellingPrice = "Price cannot be negative.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setServerError(null);
    try {
      const created = await api.createRamItem({
        generation: values.generation,
        category: values.category,
        capacity: values.capacity.trim(),
        speed: values.speed.trim().toUpperCase(),
        manufacturer: values.manufacturer.trim() || null,
        model: values.model.trim() || null,
        partNumber: values.partNumber.trim() || null,
        condition: values.condition || null,
        ecc,
        registered,
        moduleCount: 1,
        purchasePrice: values.purchasePrice,
        sellingPrice: values.sellingPrice,
        openingQuantity: values.openingQuantity,
        minimumStock: values.minimumStock,
        location: values.location.trim() || null,
        notes: values.notes.trim() || null,
      });
      onCreated(created);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Add RAM item"
      subtitle="Creates a new SKU in the catalogue. The SKU code is generated for you."
      icon={<Package className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Create item
          </Button>
        </>
      }
    >
      {serverError && (
        <div className="mb-3 rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-medium whitespace-pre-wrap text-danger-700">
          {serverError}
        </div>
      )}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label="Generation" required>
            <SelectField
              value={values.generation}
              onChange={(e) => changeGeneration(e.target.value)}
              options={mergeValues([], ref.usedGenerations, GENERATIONS).map((g) => ({
                value: g,
                label: g,
              }))}
            />
          </FormField>
          <FormField label="Category" required>
            <SelectField
              value={values.category}
              onChange={(e) => changeCategory(e.target.value)}
              options={categoryOptions.map((c) => ({ value: c, label: c }))}
            />
          </FormField>
          <FormField label="Capacity" required error={errors.capacity}>
            <SelectField
              value={values.capacity}
              onChange={(e) => set("capacity", e.target.value)}
              placeholder="Select capacity"
              options={capacityOptions.map((c) => ({ value: c, label: c }))}
              invalid={Boolean(errors.capacity)}
            />
          </FormField>
          <FormField label="Speed" required error={errors.speed}>
            <SelectField
              value={values.speed}
              onChange={(e) => set("speed", e.target.value)}
              placeholder="Select speed"
              options={speedOptions.map((s) => ({ value: s, label: s }))}
              invalid={Boolean(errors.speed)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label="Manufacturer">
            <SelectField
              value={values.manufacturer}
              onChange={(e) => set("manufacturer", e.target.value)}
              placeholder="Not specified"
              options={manufacturerChoices.map((m) => ({ value: m, label: m }))}
            />
          </FormField>
          <FormField label="Part number">
            <TextInput
              value={values.partNumber}
              onChange={(e) => set("partNumber", e.target.value)}
              placeholder="M393A4G40AB2-266"
            />
          </FormField>
          <FormField label="Condition">
            <SelectField
              value={values.condition}
              onChange={(e) => set("condition", e.target.value)}
              options={conditionOptions.map((c) => ({ value: c, label: c }))}
            />
          </FormField>
          <FormField label="Location">
            <SelectField
              value={values.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="Not specified"
              options={locationChoices.map((l) => ({ value: l, label: l }))}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label={`Purchase cost (${currency})`}>
            <CurrencyInput
              value={values.purchasePrice}
              onValueChange={(v) => set("purchasePrice", v)}
              currency={currency}
            />
          </FormField>
          <FormField label={`Selling price (${currency})`}>
            <CurrencyInput
              value={values.sellingPrice}
              onValueChange={(v) => set("sellingPrice", v)}
              currency={currency}
            />
          </FormField>
          <FormField label="Minimum stock" hint="Low-stock warning level">
            <QuantityInput
              value={values.minimumStock}
              onValueChange={(v) => set("minimumStock", v)}
            />
          </FormField>
          <FormField label="Opening quantity" hint="Only for items already on the shelf">
            <QuantityInput
              value={values.openingQuantity}
              onValueChange={(v) => set("openingQuantity", v)}
            />
          </FormField>
        </div>

        <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-[#fafbfd] p-3">
          <Checkbox label="ECC (Error Correcting)" checked={ecc} onCheckedChange={setEcc} />
          <Checkbox
            label="Registered / Buffered"
            checked={registered}
            onCheckedChange={setRegistered}
          />
        </div>

        <FormField label="Notes">
          <TextInput
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Anything worth remembering about this module"
          />
        </FormField>
      </div>
    </Modal>
  );
}

/* ====================================================== inventory selector === */

export interface PickedLine {
  ramItemId: string;
  quantity: number;
  unitPrice: number;
}

export interface InventorySelectorProps {
  lines: PickedLine[];
  onChange: (lines: PickedLine[]) => void;
  /** SELL restricts the list to items with stock and caps each line. */
  mode: "buy" | "sell";
  currency: string;
  onQuickCreate?: (created: RamItem) => void;
  errors?: Record<string, string>;
}

/**
 * The instant-search item picker used by BUY RAM and SELL RAM.
 *
 * SELL shows live available stock per row, blocks lines above the available
 * quantity, and pre-fills the price from the item's selling price. The same rule
 * is re-checked by the backend on completion, so the block is not the only
 * guarantee.
 */
export function InventorySelector({
  lines,
  onChange,
  mode,
  currency,
  onQuickCreate,
  errors,
}: InventorySelectorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RamItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [stockById, setStockById] = useState<Record<string, RamItem>>({});

  const isSell = mode === "sell";

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchRamItems(q, isSell, isSell ? 60 : 40);
        if (!cancelled) setResults(res);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, isSell]);

  // Keep a live stock snapshot for the lines already on the document.
  useEffect(() => {
    if (!lines.length) {
      setStockById({});
      return;
    }
    let cancelled = false;
    void api
      .listRamItems({ includeArchived: false })
      .then((items) => {
        if (cancelled) return;
        const map: Record<string, RamItem> = {};
        items.forEach((i) => {
          map[i.id] = i;
        });
        setStockById(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lines]);

  const linesWithStock = useMemo(
    () =>
      lines.map((l) => {
        const item = stockById[l.ramItemId];
        const available = item?.quantity ?? 0;
        const otherLinesQty = lines
          .filter((x) => x.ramItemId === l.ramItemId)
          .reduce((a, x) => a + x.quantity, 0);
        return {
          ...l,
          item,
          available,
          lineAvailable: Math.max(0, available - (otherLinesQty - l.quantity)),
          over: isSell && l.quantity > Math.max(0, available - (otherLinesQty - l.quantity)),
        };
      }),
    [lines, stockById, isSell],
  );

  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const stockBlocked = isSell && linesWithStock.some((l) => l.over);

  const addLine = (item: RamItem) => {
    const existing = lines.findIndex((l) => l.ramItemId === item.id);
    const defaultPrice = isSell
      ? item.sellingPrice
      : item.purchasePrice > 0
        ? item.purchasePrice
        : item.averageCost;

    if (existing >= 0) {
      const next = [...lines];
      next[existing] = {
        ...next[existing],
        quantity: next[existing].quantity + 1,
        unitPrice: next[existing].unitPrice || defaultPrice,
      };
      onChange(next);
    } else {
      onChange([
        ...lines,
        { ramItemId: item.id, quantity: 1, unitPrice: defaultPrice },
      ]);
    }
    setQuery("");
  };

  const setLine = (index: number, patch: Partial<PickedLine>) => {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLine = (index: number) => onChange(lines.filter((_, i) => i !== index));

  const setAllQuantity = (ramItemId: string, quantity: number, price: number) => {
    if (quantity <= 0) return;
    onChange([...lines.filter((l) => l.ramItemId !== ramItemId), { ramItemId, quantity, unitPrice: price }]);
  };

  return (
    <div className="space-y-3">
      {/* ---- picker ---- */}
      <div className="rounded-lg border border-line">
        <div className="flex items-center gap-2 border-b border-line p-2">
          <div className="input-group flex-1">
            <Search className="input-group-icon h-4 w-4" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isSell
                  ? "Search in-stock RAM by SKU, capacity, speed, part number..."
                  : "Search RAM by SKU, capacity, speed, part number..."
              }
              className="input"
            />
          </div>
          {onQuickCreate && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => setQuickOpen(true)}
            >
              New item
            </Button>
          )}
        </div>

        <div className="max-h-56 overflow-y-auto">
          {loading ? (
            <p className="px-3 py-6 text-center text-xs text-muted">Searching&hellip;</p>
          ) : results.length === 0 ? (
            <EmptyState
              compact
              title={query ? `Nothing matches "${query}"` : isSell ? "No RAM in stock" : "No RAM items yet"}
              message={
                isSell
                  ? "There is nothing available to sell. Buy stock first, or adjust stock after a stock count."
                  : "Add the RAM item to the catalogue, then it can be purchased and sold."
              }
              action={
                onQuickCreate ? (
                  <Button variant="primary" size="sm" onClick={() => setQuickOpen(true)}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add RAM item
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {results.map((item) => {
                const onDoc = lines.some((l) => l.ramItemId === item.id);
                const out = isSell && item.quantity <= 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={out}
                      onClick={() => addLine(item)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        out ? "cursor-not-allowed opacity-50" : "hover:bg-brand-50",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-mono text-xs font-bold text-brand-800">
                            {item.sku}
                          </span>
                          {onDoc && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-profit-600" aria-hidden />
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {skuSummary(item)}
                          {item.manufacturer ? ` - ${item.manufacturer}` : ""}
                          {item.partNumber ? ` - ${item.partNumber}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="tnum block text-xs font-bold text-ink">
                          {money(isSell ? item.sellingPrice : item.purchasePrice, currency)}
                        </span>
                        <span
                          className={cn(
                            "tnum block text-2xs font-semibold",
                            out ? "text-danger-600" : "text-muted",
                          )}
                        >
                          {isSell ? `${item.quantity} available` : `${item.quantity} in stock`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ---- lines ---- */}
      {lines.length === 0 ? (
        <EmptyState
          compact
          icon={<Package className="h-5 w-5" aria-hidden />}
          title="No RAM added to this document yet"
          message={
            isSell
              ? "Search above and click a module to add it. Available stock is shown for every item."
              : "Search above and click a module to add it to this purchase."
          }
        />
      ) : (
        <div className="table-wrap rounded-lg border border-line">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Available</th>
                <th className="w-24 text-right">Qty</th>
                <th className="w-32 text-right">{isSell ? "Price" : "Cost"}</th>
                <th className="w-28 text-right">Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {linesWithStock.map((line, i) => (
                <tr key={line.ramItemId} className={cn(line.over && "bg-danger-50")}>
                  <td>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-bold text-brand-800">
                        {line.item?.sku ?? line.ramItemId}
                      </div>
                      <div className="truncate text-2xs text-muted">
                        {line.item ? skuSummary(line.item) : "Loading..."}
                      </div>
                    </div>
                  </td>
                  <td className="num">
                    {isSell ? (
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          line.over ? "text-danger-700" : "text-ink",
                        )}
                      >
                        {line.available}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">{line.available}</span>
                    )}
                  </td>
                  <td>
                    <QuantityInput
                      value={line.quantity}
                      onValueChange={(v) => setLine(i, { quantity: Math.max(0, Math.trunc(v)) })}
                      max={isSell ? line.lineAvailable : undefined}
                      invalid={line.over}
                      className="[&_input]:h-8"
                    />
                    {line.over && (
                      <p className="mt-0.5 flex items-center gap-1 text-2xs font-semibold text-danger-700">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Only {line.lineAvailable} available
                      </p>
                    )}
                  </td>
                  <td>
                    <CurrencyInput
                      value={line.unitPrice}
                      onValueChange={(v) => setLine(i, { unitPrice: Math.max(0, v) })}
                      currency={currency}
                      className="[&_input]:h-8"
                    />
                  </td>
                  <td className="num text-sm font-semibold text-ink">
                    {money(line.quantity * line.unitPrice, currency)}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      title={`Remove ${line.item?.sku ?? "item"}`}
                      aria-label={`Remove ${line.item?.sku ?? "item"}`}
                      className="rounded p-1 text-faint transition-colors hover:bg-danger-50 hover:text-danger-600"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right">
                  {lines.length} item{lines.length === 1 ? "" : "s"} &middot;{" "}
                  {lines.reduce((a, l) => a + l.quantity, 0)} unit
                  {lines.reduce((a, l) => a + l.quantity, 0) === 1 ? "" : "s"}
                </td>
                <td className="num text-sm" colSpan={2}>
                  {money(subtotal, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {stockBlocked && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger-500/30 bg-danger-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" aria-hidden />
          <div>
            <p className="text-xs font-bold text-danger-700">Insufficient stock</p>
            <p className="mt-0.5 text-xs leading-relaxed text-danger-700/85">
              One or more lines exceed the available quantity. Reduce the quantity, or remove the
              line. ZEUS will refuse this sale even if the button is pressed.
            </p>
          </div>
        </div>
      )}

      {errors?.items && (
        <p className="field-error">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {errors.items}
        </p>
      )}

      {onQuickCreate && (
        <QuickItemDialog
          open={quickOpen}
          onClose={() => setQuickOpen(false)}
          initial={{
            generation: query.match(/DDR[345]/i)?.[0]?.toUpperCase(),
            capacity: query.match(/\d+\s*GB/i)?.[0]?.toUpperCase().replace(/\s+/g, " "),
          }}
          onCreated={(created) => {
            setQuickOpen(false);
            if (mode === "sell") return;
            onQuickCreate(created);
            setAllQuantity(created.id, 1, created.purchasePrice || created.averageCost);
          }}
        />
      )}
    </div>
  );
}

/* ================================================ stock-availability panel === */

/**
 * The prominent AVAILABLE STOCK panel on the sell screen. It is deliberately
 * separate from the line table so the constraint is impossible to miss.
 */
export function AvailableStockPanel({
  lines,
  stockById,
}: {
  lines: PickedLine[];
  stockById: Record<string, RamItem>;
}) {
  const rows = lines.map((l) => {
    const item = stockById[l.ramItemId];
    const available = item?.quantity ?? 0;
    const otherQty = lines
      .filter((x) => x.ramItemId === l.ramItemId)
      .reduce((a, x) => a + x.quantity, 0);
    return {
      ...l,
      item,
      available,
      remaining: available - otherQty,
      sufficient: available - otherQty >= l.quantity,
    };
  });
  const blocked = rows.some((r) => !r.sufficient);

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-3",
        blocked ? "border-danger-500/50 bg-danger-50" : "border-profit-500/40 bg-profit-50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn(
            "flex items-center gap-2 text-xs font-bold tracking-wide uppercase",
            blocked ? "text-danger-700" : "text-profit-700",
          )}
        >
          {blocked ? (
            <AlertTriangle className="h-4 w-4" aria-hidden />
          ) : (
            <Check className="h-4 w-4" aria-hidden />
          )}
          Available stock
        </p>
        <StatusBadge tone={blocked ? "danger" : "profit"}>
          {blocked ? "Insufficient stock" : "Stock available"}
        </StatusBadge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.ramItemId}
            className="rounded-md border border-line bg-surface/80 p-2"
          >
            <p className="truncate font-mono text-2xs font-bold text-brand-800">
              {r.item?.sku ?? "..."}
            </p>
            <p className="tnum mt-0.5 text-xs font-bold text-ink">
              {r.item ? `${qty(r.item.quantity)} in stock` : "loading"}
            </p>
            <p
              className={cn(
                "tnum text-2xs font-semibold",
                r.sufficient ? "text-profit-700" : "text-danger-700",
              )}
            >
              After this sale: {qty(r.remaining)} left
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
