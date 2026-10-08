import { useEffect, useMemo, useState } from "react";
import { Package, Save } from "lucide-react";
import { api } from "../../lib/api";
import { money } from "../../lib/format";
import { useCurrency } from "../../lib/app-context";
import { mergeValues, speedOptionsFor, useReferenceData } from "../../lib/reference-data";
import { CAPACITIES, CATEGORIES, CONDITIONS, DEFAULT_MANUFACTURERS, GENERATIONS, RAM_TYPES, RANKS } from "../../lib/constants";
import type { RamItem, RamItemInput } from "../../lib/types";
import {
  Button,
  Checkbox,
  CurrencyInput,
  FormField,
  QuantityInput,
  SelectField,
  TextArea,
  TextInput,
} from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { TransactionSummary } from "../ui/Cards";

/* ===========================================================================
   Full RAM item editor
   ---------------------------------------------------------------------------
   The quick-create dialog on the buy/sell screens covers the common case; this
   is the complete catalogue record, used from Inventory for both new items and
   edits. Quantity is *not* editable here - stock only ever moves through a
   purchase, a sale, a return or an explicit adjustment, so the item form points
   the operator at that instead of letting quantity drift from the ledger.
   =========================================================================== */

export interface RamItemDialogProps {
  open: boolean;
  editing?: RamItem | null;
  /** Pre-fills the form, e.g. from a partial search. */
  initial?: Partial<RamItemInput>;
  onClose: () => void;
  onSaved?: (item: RamItem) => void;
  /**
   * Alternative persistence path, used in cloud mode where the catalogue is
   * authoritative on the server (admin RPC + mirror refresh). Falls back to
   * the engine commands when omitted.
   */
  saveVia?: (payload: RamItemInput, editing: RamItem | null) => Promise<RamItem>;
}

interface Form {
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  ramType: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  condition: string;
  ecc: boolean;
  registered: boolean;
  rank: string;
  moduleCount: number;
  purchasePrice: number;
  sellingPrice: number;
  openingQuantity: number;
  minimumStock: number;
  location: string;
  notes: string;
}

const blank = (): Form => ({
  sku: "",
  generation: "DDR4",
  category: "PC",
  capacity: "",
  speed: "",
  ramType: "UDIMM",
  manufacturer: "",
  model: "",
  partNumber: "",
  condition: "New",
  ecc: false,
  registered: false,
  rank: "",
  moduleCount: 1,
  purchasePrice: 0,
  sellingPrice: 0,
  openingQuantity: 0,
  minimumStock: 5,
  location: "",
  notes: "",
});

const fromItem = (item: RamItem): Form => ({
  sku: item.sku,
  generation: item.generation,
  category: item.category,
  capacity: item.capacity,
  speed: item.speed,
  ramType: item.ramType ?? "",
  manufacturer: item.manufacturer ?? "",
  model: item.model ?? "",
  partNumber: item.partNumber ?? "",
  condition: item.condition ?? "",
  ecc: item.ecc,
  registered: item.registered,
  rank: item.rank ?? "",
  moduleCount: item.moduleCount || 1,
  purchasePrice: item.purchasePrice,
  sellingPrice: item.sellingPrice,
  openingQuantity: 0,
  minimumStock: item.minimumStock,
  location: item.location ?? "",
  notes: item.notes ?? "",
});

export function RamItemDialog({ open, editing, initial, onClose, onSaved, saveVia }: RamItemDialogProps) {
  const currency = useCurrency();
  const ref = useReferenceData();
  const [values, setValues] = useState<Form>(blank());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    if (editing) {
      setValues(fromItem(editing));
      return;
    }
    setValues({ ...blank(), ...initial } as Form);
  }, [open, editing, initial]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

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
    () => keepCurrent(CAPACITIES, values.capacity),
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
   * choice for the new generation, the selection is cleared so the form can
   * never submit an option the new parent rejects. Category deliberately does
   * not filter speeds - it is an independent spec.
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
    if (editing && values.sku.trim() && values.sku.trim() !== editing.sku) {
      next.sku = "The SKU cannot be changed once a transaction exists. Archive and add a new item instead.";
    }
    if (!values.capacity.trim()) next.capacity = "Capacity is required, e.g. 32 GB.";
    if (!values.speed.trim()) next.speed = "Speed is required, e.g. 2666V.";
    if (values.purchasePrice < 0) next.purchasePrice = "Purchase cost cannot be negative.";
    if (values.sellingPrice < 0) next.sellingPrice = "Selling price cannot be negative.";
    if (editing && values.purchasePrice > 0 && values.purchasePrice < editing.averageCost - 0.005) {
      next.purchasePrice = `Below the current weighted average cost of ${money(
        editing.averageCost,
        currency,
      )} - profit reporting would be wrong.`;
    }
    setErrors(next);
    if (Object.keys(next).length) {
      setServerError(null);
      return;
    }

    setBusy(true);
    setServerError(null);
    const payload: RamItemInput = {
      sku: values.sku.trim() || undefined,
      generation: values.generation,
      category: values.category,
      capacity: values.capacity.trim(),
      speed: values.speed.trim().toUpperCase(),
      ramType: values.ramType.trim() || undefined,
      manufacturer: values.manufacturer.trim() || undefined,
      model: values.model.trim() || undefined,
      partNumber: values.partNumber.trim() || undefined,
      condition: values.condition.trim() || undefined,
      ecc: values.ecc,
      registered: values.registered,
      rank: values.rank.trim() || undefined,
      moduleCount: Math.max(1, values.moduleCount),
      purchasePrice: values.purchasePrice,
      sellingPrice: values.sellingPrice,
      openingQuantity: editing ? 0 : Math.max(0, values.openingQuantity),
      minimumStock: Math.max(0, values.minimumStock),
      location: values.location.trim() || undefined,
      notes: values.notes.trim() || undefined,
    };
    try {
      const saved = saveVia
        ? await saveVia(payload, editing ?? null)
        : editing
          ? await api.updateRamItem(editing.id, payload)
          : await api.createRamItem(payload);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const expectedProfit = Math.max(0, values.sellingPrice - values.purchasePrice);

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={editing ? `Edit ${editing.sku}` : "Add RAM item"}
      subtitle={
        editing
          ? "Catalogue details only. Stock changes through purchases, sales, returns or adjustments."
          : "Creates a SKU in the catalogue. ZEUS generates the code from the generation, category, capacity and speed."
      }
      icon={<Package className="h-4 w-4" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={busy}
            icon={busy ? undefined : <Save className="h-4 w-4" aria-hidden />}
          >
            {editing ? "Save changes" : "Create item"}
          </Button>
        </>
      }
    >
      {serverError && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-xs leading-relaxed font-medium whitespace-pre-wrap text-danger-700"
        >
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
              disabled={Boolean(editing)}
            />
          </FormField>
          <FormField label="Category" required>
            <SelectField
              value={values.category}
              onChange={(e) => changeCategory(e.target.value)}
              options={categoryOptions.map((c) => ({ value: c, label: c }))}
              disabled={Boolean(editing)}
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
          <FormField label="Model">
            <TextInput
              value={values.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="M393A4G40AB2"
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
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label="Module type">
            <SelectField
              value={values.ramType}
              onChange={(e) => set("ramType", e.target.value)}
              placeholder="Any"
              options={RAM_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </FormField>
          <FormField label="Rank">
            <SelectField
              value={values.rank}
              onChange={(e) => set("rank", e.target.value)}
              placeholder="Any"
              options={RANKS.map((t) => ({ value: t, label: t }))}
            />
          </FormField>
          <FormField label="Modules per kit">
            <QuantityInput
              value={values.moduleCount}
              onValueChange={(v) => set("moduleCount", Math.max(1, Math.trunc(v)))}
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

        <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-[#fafbfd] p-3">
          <Checkbox label="ECC (error correcting)" checked={values.ecc} onCheckedChange={(v) => set("ecc", v)} />
          <Checkbox
            label="Registered / buffered"
            checked={values.registered}
            onCheckedChange={(v) => set("registered", v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label={`Purchase cost (${currency})`} error={errors.purchasePrice}>
            <CurrencyInput
              value={values.purchasePrice}
              onValueChange={(v) => set("purchasePrice", Math.max(0, v))}
              currency={currency}
              invalid={Boolean(errors.purchasePrice)}
            />
          </FormField>
          <FormField label={`Selling price (${currency})`} error={errors.sellingPrice}>
            <CurrencyInput
              value={values.sellingPrice}
              onValueChange={(v) => set("sellingPrice", Math.max(0, v))}
              currency={currency}
              invalid={Boolean(errors.sellingPrice)}
            />
          </FormField>
          <FormField label="Minimum stock" hint="Low-stock warning level">
            <QuantityInput
              value={values.minimumStock}
              onValueChange={(v) => set("minimumStock", Math.max(0, Math.trunc(v)))}
            />
          </FormField>
          {editing ? (
            <FormField label="In stock" hint="Change via a purchase, sale or adjustment">
              <TextInput value={`${editing.quantity} units`} readOnly disabled />
            </FormField>
          ) : (
            <FormField label="Opening quantity" hint="Only for stock already on the shelf">
              <QuantityInput
                value={values.openingQuantity}
                onValueChange={(v) => set("openingQuantity", Math.max(0, Math.trunc(v)))}
              />
            </FormField>
          )}
        </div>

        {!editing && (
          <FormField label="SKU" hint="Leave blank and ZEUS generates it, e.g. Z-D4-SER-32-2666V-0001">
            <TextInput
              value={values.sku}
              onChange={(e) => set("sku", e.target.value.toUpperCase())}
              placeholder="Auto-generated"
              invalid={Boolean(errors.sku)}
              className="font-mono"
            />
          </FormField>
        )}

        {editing && errors.sku && (
          <p className="rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-semibold text-danger-700">
            {errors.sku}
          </p>
        )}

        <FormField label="Notes">
          <TextArea
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Warranty, supplier, packaging details..."
          />
        </FormField>

        <TransactionSummary
          lines={[
            { label: "Unit margin", value: money(expectedProfit, currency) },
            {
              label: "Margin on selling price",
              value:
                values.sellingPrice > 0
                  ? `${((expectedProfit / values.sellingPrice) * 100).toFixed(1)}%`
                  : "-",
            },
            ...(editing
              ? [
                  {
                    label: "Weighted average cost (from the ledger)",
                    value: money(editing.averageCost, currency),
                    hint: "not editable - recalculated by purchases",
                  },
                  {
                    label: "Stock value at average cost",
                    value: money(editing.quantity * editing.averageCost, currency),
                  },
                ]
              : [
                  {
                    label: "Opening stock value",
                    value: money(values.openingQuantity * values.purchasePrice, currency),
                  },
                ]),
          ]}
        />
      </div>
    </Modal>
  );
}
