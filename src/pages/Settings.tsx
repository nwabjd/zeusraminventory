import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Building2,
  Check,
  Clock,
  Cpu,
  Database,
  Gauge,
  History,
  Keyboard,
  MapPin,
  Monitor,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Signal,
  Tag,
  Trash2,
  Wand2,
} from "lucide-react";
import { api } from "../lib/api";
import { shortcutLegend, useApp } from "../lib/app-context";
import { GENERATIONS, RAM_SPEEDS_BY_GENERATION } from "../lib/constants";
import { bytes, cn, displayDateTime, qty } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type {
  BackupEntry,
  BackupInfo,
  Generation,
  NamedValue,
  RamSpeed,
} from "../lib/types";
import {
  Button,
  ConfirmDialog,
  FormField,
  IconButton,
  InlineError,
  Modal,
  PageHeader,
  SectionCard,
  SelectField,
  Skeleton,
  StatusBadge,
  TextArea,
  TextInput,
  Toggle,
  useToast,
} from "../components/ui";

/* ===========================================================================
   Settings
   ---------------------------------------------------------------------------
   Business profile, money and locale, the master data that feeds every RAM
   form (categories, speeds, manufacturers, locations), the low-stock rule,
   backups, the database itself and keyboard shortcuts. Everything here is a
   real write against SQLite - there is nothing decorative on this screen.
   =========================================================================== */

const CURRENCIES = [
  "AED", "USD", "EUR", "GBP", "SAR", "QAR", "OMR", "KWD", "BHD", "INR", "PKR",
];

const TIMEZONES = [
  "Asia/Dubai", "Asia/Riyadh", "Asia/Karachi", "Asia/Kolkata", "Europe/London",
  "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC",
];

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];

const CATEGORY_OPTIONS = ["PC", "Laptop", "Server", "Workstation"];

const BACKUP_INTERVALS = [
  { value: "6", label: "Every 6 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Every 24 hours" },
  { value: "72", label: "Every 3 days" },
  { value: "168", label: "Every week" },
];

/** Named master-data groups, each with its own icon and one-line explanation. */
const NAMED_GROUPS: {
  kind: string;
  title: string;
  description: string;
  icon: typeof Tag;
  placeholder: string;
}[] = [
  {
    kind: "categories",
    title: "RAM categories",
    description: "PC, Laptop, Server and Workstation, plus anything else you trade in.",
    icon: Tag,
    placeholder: "e.g. Mini PC",
  },
  {
    kind: "manufacturers",
    title: "Manufacturers",
    description: "Brand names offered in the RAM item form and the inventory filter.",
    icon: Cpu,
    placeholder: "e.g. Silicon Power",
  },
  {
    kind: "locations",
    title: "Storage locations",
    description: "Where stock physically sits, used by the inventory location filter.",
    icon: MapPin,
    placeholder: "e.g. Shelf B2",
  },
];

/* ------------------------------------------------------------ speed rows -- */

interface SpeedDraft {
  id: string | null;
  speed: string;
  generation: string;
  category: string;
  description: string;
}

const EMPTY_SPEED: SpeedDraft = {
  id: null,
  speed: RAM_SPEEDS_BY_GENERATION.DDR4[0],
  generation: "DDR4",
  category: "PC",
  description: "",
};

/* --------------------------------------------------------- named value form */

interface NamedDraft {
  kind: string;
  id: string | null;
  name: string;
  description: string;
}

const EMPTY_NAMED: NamedDraft = {
  kind: "categories",
  id: null,
  name: "",
  description: "",
};

/* ================================================================ section === */

function SettingsSection({
  icon,
  title,
  description,
  children,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <SectionCard
      title={title}
      subtitle={description}
      icon={icon}
      actions={actions}
      bodyClassName="p-4"
    >
      {children}
    </SectionCard>
  );
}

/* ================================================================== page === */

export default function Settings() {
  const { settings, refreshSettings, refreshAll, version, databasePath } = useApp();
  const toast = useToast();

  const [profile, setProfile] = useState({
    business_name: settings.businessName,
    business_tagline: settings.businessTagline,
    business_address: settings.businessAddress,
    business_phone: settings.businessPhone,
    business_email: settings.businessEmail,
    business_trn: settings.businessTrn,
  });
  const [region, setRegion] = useState({
    currency: settings.currency,
    timezone: settings.timezone,
    date_format: settings.dateFormat,
    low_stock_default: settings.lowStockDefault,
  });
  const [appearance, setAppearance] = useState({
    theme: settings.theme,
    density: settings.density,
  });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingRegion, setSavingRegion] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);

  const [speedDraft, setSpeedDraft] = useState<SpeedDraft | null>(null);
  const [speedBusy, setSpeedBusy] = useState(false);
  const [speedError, setSpeedError] = useState<string | null>(null);
  const [speedDelete, setSpeedDelete] = useState<RamSpeed | null>(null);
  const [speedDeleting, setSpeedDeleting] = useState(false);

  const [namedDraft, setNamedDraft] = useState<NamedDraft | null>(null);
  const [namedBusy, setNamedBusy] = useState(false);
  const [namedError, setNamedError] = useState<string | null>(null);
  const [namedDelete, setNamedDelete] = useState<NamedValue | null>(null);
  const [namedDeleting, setNamedDeleting] = useState(false);

  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  const [clearing, setClearing] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const backup = useAsync(() => api.backupInfo(), [settings.revision]);
  const backups = useAsync(() => api.listBackups(), [settings.revision]);
  const speeds = useAsync(() => api.listSpeeds(), []);
  const categories = useAsync(() => api.listNamedValues("categories"), []);
  const manufacturers = useAsync(() => api.listNamedValues("manufacturers"), []);
  const locations = useAsync(() => api.listNamedValues("locations"), []);
  const demo = useAsync(() => api.demoSummary(), []);
  const isEmpty = useAsync(() => api.demoIsEmpty(), []);

  /* Local edits win until the app context refreshes, so a failed write never
     leaves the form showing something the database does not hold. */
  const [localBackup, setLocalBackup] = useState<BackupInfo | null>(null);
  const info = localBackup ?? backup.data;
  const entries = backups.data ?? [];

  const [autoBackup, setAutoBackup] = useState(settings.autoBackup !== "0");
  const [interval, setInterval] = useState(
    BACKUP_INTERVALS.some((b) => b.value === settings.backupIntervalHours)
      ? settings.backupIntervalHours
      : "24",
  );

  useEffect(() => {
    setAutoBackup(settings.autoBackup !== "0");
    setInterval(
      BACKUP_INTERVALS.some((b) => b.value === settings.backupIntervalHours)
        ? settings.backupIntervalHours
        : "24",
    );
  }, [settings.autoBackup, settings.backupIntervalHours]);

  const shortcuts = useMemo(() => shortcutLegend(), []);

  const profileDirty = useMemo(() => {
    return (
      profile.business_name !== settings.businessName ||
      profile.business_tagline !== settings.businessTagline ||
      profile.business_address !== settings.businessAddress ||
      profile.business_phone !== settings.businessPhone ||
      profile.business_email !== settings.businessEmail ||
      profile.business_trn !== settings.businessTrn
    );
  }, [profile, settings]);

  const regionDirty =
    region.currency !== settings.currency ||
    region.timezone !== settings.timezone ||
    region.date_format !== settings.dateFormat ||
    region.low_stock_default !== settings.lowStockDefault;

  const appearanceDirty =
    appearance.theme !== settings.theme || appearance.density !== settings.density;

  const save = useCallback(
    async (
      values: Record<string, string>,
      message: string,
      done: () => void,
      setter: (busy: boolean) => void,
    ) => {
      setter(true);
      try {
        await api.saveSettings(values);
        await refreshSettings();
        toast.success(message, "The change applies across every screen.");
        done();
      } catch (err) {
        toast.error("Could not save settings", err instanceof Error ? err.message : String(err));
      } finally {
        setter(false);
      }
    },
    [refreshSettings, toast],
  );

  const saveProfile = () =>
    save(
      profile,
      "Business profile saved",
      () => setProfileError(null),
      setSavingProfile,
    );

  const saveRegion = () => {
    if (!region.currency.trim()) {
      toast.error("Currency is required", "Pick the currency the business trades in.");
      return;
    }
    if (!/^\d+$/.test(region.low_stock_default.trim()) || Number(region.low_stock_default) < 0) {
      toast.error("Low-stock level must be a number", "Use 0 to disable the warning.");
      return;
    }
    void save(region, "Preferences saved", () => undefined, setSavingRegion);
  };

  const saveAppearance = () =>
    void save(appearance, "Appearance saved", () => undefined, setSavingAppearance);

  const saveBackupPolicy = () =>
    void save(
      { auto_backup: autoBackup ? "1" : "0", backup_interval_hours: interval },
      "Backup schedule saved",
      () => backups.reload(),
      setBackingUp,
    );

  /* ---- master data: speeds ---------------------------------------------- */

  const openSpeed = (row?: RamSpeed) => {
    setSpeedError(null);
    setSpeedDraft(
      row
        ? {
            id: row.id,
            speed: row.speed,
            generation: row.generation,
            category: row.category,
            description: row.description ?? "",
          }
        : { ...EMPTY_SPEED },
    );
  };

  const commitSpeed = async () => {
    const draft = speedDraft;
    if (!draft) return;
    if (!draft.speed.trim()) {
      setSpeedError("Pick the speed label from the ZEUS RAM speed matrix.");
      return;
    }
    if (!draft.generation.trim() || !draft.category.trim()) {
      setSpeedError("Both a generation and a category are required.");
      return;
    }
    setSpeedBusy(true);
    setSpeedError(null);
    try {
      await api.saveSpeed(
        draft.id,
        draft.speed.trim(),
        draft.generation,
        draft.category,
        draft.description.trim(),
      );
      setSpeedDraft(null);
      speeds.reload();
      toast.success(
        draft.id ? "Speed updated" : "Speed added",
        `${draft.speed} is now selectable on the RAM item form.`,
      );
    } catch (err) {
      setSpeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpeedBusy(false);
    }
  };

  const confirmSpeedDelete = async () => {
    const target = speedDelete;
    if (!target) return;
    setSpeedDeleting(true);
    try {
      await api.deleteSpeed(target.id);
      setSpeedDelete(null);
      speeds.reload();
      toast.success("Speed removed", `${target.speed} is no longer offered. Existing items keep it.`);
    } catch (err) {
      toast.error("Could not remove that speed", err instanceof Error ? err.message : String(err));
    } finally {
      setSpeedDeleting(false);
    }
  };

  /* ---- master data: named values ---------------------------------------- */

  const openNamed = (kind: string, row?: NamedValue) => {
    setNamedError(null);
    setNamedDraft(
      row
        ? { kind, id: row.id, name: row.name, description: row.description ?? "" }
        : { ...EMPTY_NAMED, kind },
    );
  };

  const commitNamed = async () => {
    const draft = namedDraft;
    if (!draft) return;
    if (!draft.name.trim()) {
      setNamedError("A name is required.");
      return;
    }
    setNamedBusy(true);
    setNamedError(null);
    try {
      await api.saveNamedValue(draft.kind, draft.id, draft.name.trim(), draft.description.trim());
      setNamedDraft(null);
      if (draft.kind === "categories") categories.reload();
      else if (draft.kind === "manufacturers") manufacturers.reload();
      else locations.reload();
      toast.success(
        draft.id ? "Entry updated" : "Entry added",
        `${draft.name.trim()} is now available in the RAM forms and filters.`,
      );
    } catch (err) {
      setNamedError(err instanceof Error ? err.message : String(err));
    } finally {
      setNamedBusy(false);
    }
  };

  const confirmNamedDelete = async () => {
    const target = namedDelete;
    if (!target) return;
    setNamedDeleting(true);
    try {
      await api.deleteNamedValue(target.kind, target.id);
      setNamedDelete(null);
      if (target.kind === "categories") categories.reload();
      else if (target.kind === "manufacturers") manufacturers.reload();
      else locations.reload();
      toast.success("Entry removed", `${target.name} is no longer offered in the forms.`);
    } catch (err) {
      toast.error("Could not remove that entry", err instanceof Error ? err.message : String(err));
    } finally {
      setNamedDeleting(false);
    }
  };

  /* ---- backup ------------------------------------------------------------ */

  const runBackup = async () => {
    setBackingUp(true);
    try {
      const result = await api.backupNow();
      setLocalBackup(result);
      backups.reload();
      await refreshSettings();
      toast.success("Backup created", result.lastBackupPath);
    } catch (err) {
      toast.error("Backup failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBackingUp(false);
    }
  };

  const runVerify = async (entry: BackupEntry) => {
    setVerifying(entry.path);
    try {
      await api.verifyBackup(entry.path);
      toast.success("Backup verified", `${entry.fileName} is a readable ZEUS database.`);
    } catch (err) {
      toast.error("That file cannot be restored", err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(null);
    }
  };

  const runRestore = async () => {
    const target = restoring;
    if (!target) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      await api.verifyBackup(target.path);
      const result = await api.restoreBackup(target.path);
      setRestoring(null);
      setLocalBackup(result);
      await refreshAll();
      backups.reload();
      speeds.reload();
      categories.reload();
      manufacturers.reload();
      locations.reload();
      demo.reload();
      isEmpty.reload();
      toast.success(
        "Backup restored",
        "The database now matches that backup. Every screen has been reloaded.",
      );
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoreBusy(false);
    }
  };

  /* ---- database ---------------------------------------------------------- */

  const runSeed = async () => {
    setSeeding(true);
    try {
      const summary = await api.loadDemoData();
      await refreshAll();
      demo.reload();
      isEmpty.reload();
      toast.success(
        "Sample data loaded",
        `${qty(summary.ramItems)} RAM items, ${qty(summary.sales)} sales and ${qty(
          summary.purchases,
        )} purchases to explore. Clear it any time from this screen.`,
      );
    } catch (err) {
      toast.error("Could not load sample data", err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  };

  const runClear = async () => {
    setClearBusy(true);
    try {
      await api.clearAllData();
      setClearing(false);
      setLocalBackup(null);
      await refreshAll();
      demo.reload();
      isEmpty.reload();
      backup.reload();
      toast.success("All records removed", "The database is empty and ready for your own data.");
    } catch (err) {
      toast.error("Could not clear the database", err instanceof Error ? err.message : String(err));
    } finally {
      setClearBusy(false);
    }
  };

  const demoRows = demo.data;

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Business details, master data, backups and how the app behaves"
        icon={<Gauge className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <StatusBadge tone="navy">Version {version || "1.0.0"}</StatusBadge>
            <StatusBadge tone={info?.available === false ? "warn" : "profit"}>
              {info?.available === false ? "Database unavailable" : "Database connected"}
            </StatusBadge>
          </>
        }
      />

      <div className="page-scroll space-y-4 pb-2">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* ---------------------------------------------- business profile -- */}
          <SettingsSection
            icon={<Building2 className="h-4 w-4" aria-hidden />}
            title="Business profile"
            description="Shown in the sidebar and on every printed document"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Save className="h-4 w-4" aria-hidden />}
                onClick={saveProfile}
                loading={savingProfile}
                disabled={!profileDirty}
              >
                Save
              </Button>
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Business name" required>
                  <TextInput
                    value={profile.business_name}
                    onChange={(e) => setProfile((p) => ({ ...p, business_name: e.target.value }))}
                    placeholder="ZEUS"
                    maxLength={60}
                  />
                </FormField>
                <FormField label="Tagline" hint="Appears under the name in the sidebar">
                  <TextInput
                    value={profile.business_tagline}
                    onChange={(e) => setProfile((p) => ({ ...p, business_tagline: e.target.value }))}
                    placeholder="RAM INVENTORY MANAGEMENT"
                    maxLength={60}
                  />
                </FormField>
                <FormField label="Phone">
                  <TextInput
                    value={profile.business_phone}
                    onChange={(e) => setProfile((p) => ({ ...p, business_phone: e.target.value }))}
                    placeholder="+971 4 000 0000"
                  />
                </FormField>
                <FormField label="TRN / VAT number">
                  <TextInput
                    value={profile.business_trn}
                    onChange={(e) => setProfile((p) => ({ ...p, business_trn: e.target.value }))}
                    placeholder="100000000000003"
                  />
                </FormField>
                <FormField label="Email">
                  <TextInput
                    type="email"
                    value={profile.business_email}
                    onChange={(e) => setProfile((p) => ({ ...p, business_email: e.target.value }))}
                    placeholder="sales@example.ae"
                  />
                </FormField>
                <FormField label="Address">
                  <TextInput
                    value={profile.business_address}
                    onChange={(e) => setProfile((p) => ({ ...p, business_address: e.target.value }))}
                    placeholder="Shop 12, Al Quoz, Dubai"
                  />
                </FormField>
              </div>
              {profileError && <InlineError message={profileError} />}
              <p className="text-2xs text-faint">
                Printed invoices and statements use this name, tagline, phone and TRN.
              </p>
            </div>
          </SettingsSection>

          {/* ------------------------------------------- money & locale ------ */}
          <SettingsSection
            icon={<Clock className="h-4 w-4" aria-hidden />}
            title="Currency, timezone and stock rules"
            description="Applies to every amount and warning in the app"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Save className="h-4 w-4" aria-hidden />}
                onClick={saveRegion}
                loading={savingRegion}
                disabled={!regionDirty}
              >
                Save
              </Button>
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Currency" required hint="Default AED">
                  <SelectField
                    value={region.currency}
                    onChange={(e) => setRegion((r) => ({ ...r, currency: e.target.value }))}
                    options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                  />
                </FormField>
                <FormField label="Timezone" hint="Used for document dates and backups">
                  <SelectField
                    value={region.timezone}
                    onChange={(e) => setRegion((r) => ({ ...r, timezone: e.target.value }))}
                    options={TIMEZONES.map((t) => ({ value: t, label: t.replace("/", " / ") }))}
                  />
                </FormField>
                <FormField label="Date format">
                  <SelectField
                    value={region.date_format}
                    onChange={(e) => setRegion((r) => ({ ...r, date_format: e.target.value }))}
                    options={DATE_FORMATS.map((d) => ({ value: d, label: d }))}
                  />
                </FormField>
                <FormField
                  label="Default low-stock level"
                  hint="Pre-filled on new RAM items"
                >
                  <TextInput
                    type="number"
                    min={0}
                    step={1}
                    value={region.low_stock_default}
                    onChange={(e) =>
                      setRegion((r) => ({ ...r, low_stock_default: e.target.value }))
                    }
                  />
                </FormField>
              </div>
              <div className="rounded-lg border border-line bg-[#fafbfd] p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                  Preview
                </p>
                <p className="tnum mt-1 text-sm font-semibold text-ink">
                  {region.currency} 1,250.00 &middot; {region.date_format} &middot; {region.timezone}
                </p>
              </div>
            </div>
          </SettingsSection>

          {/* -------------------------------------------------- categories -- */}
          <SettingsSection
            icon={<Tag className="h-4 w-4" aria-hidden />}
            title="RAM categories"
            description="The category list used by every RAM item and report filter"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={() => openNamed("categories")}
              >
                Add category
              </Button>
            }
          >
            <MasterDataList
              loading={categories.loading}
              error={categories.error}
              onRetry={categories.reload}
              rows={categories.data ?? []}
              emptyMessage="No custom categories yet. PC, Laptop, Server and Workstation always work."
              onEdit={(row) => openNamed("categories", row)}
              onDelete={setNamedDelete}
              builtin={CATEGORY_OPTIONS}
            />
          </SettingsSection>

          {/* ----------------------------------------------- manufacturers -- */}
          <SettingsSection
            icon={<Cpu className="h-4 w-4" aria-hidden />}
            title="Manufacturers"
            description="Brands offered in the RAM item form and the inventory filter"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={() => openNamed("manufacturers")}
              >
                Add manufacturer
              </Button>
            }
          >
            <MasterDataList
              loading={manufacturers.loading}
              error={manufacturers.error}
              onRetry={manufacturers.reload}
              rows={manufacturers.data ?? []}
              emptyMessage="No manufacturers saved. The RAM item form still accepts any brand name."
              onEdit={(row) => openNamed("manufacturers", row)}
              onDelete={setNamedDelete}
            />
          </SettingsSection>

          {/* --------------------------------------------------- locations -- */}
          <SettingsSection
            icon={<MapPin className="h-4 w-4" aria-hidden />}
            title="Storage locations"
            description="Where stock sits, filterable from Inventory"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={() => openNamed("locations")}
              >
                Add location
              </Button>
            }
          >
            <MasterDataList
              loading={locations.loading}
              error={locations.error}
              onRetry={locations.reload}
              rows={locations.data ?? []}
              emptyMessage="No locations saved. Use them to separate the warehouse from the shop floor."
              onEdit={(row) => openNamed("locations", row)}
              onDelete={setNamedDelete}
              builtin={["Main Warehouse", "Shop Floor"]}
            />
          </SettingsSection>

          {/* ------------------------------------------------------ speeds -- */}
          <SettingsSection
            icon={<Signal className="h-4 w-4" aria-hidden />}
            title="RAM speeds"
            description="DDR4 and DDR5 speed labels offered on the item form"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={() => openSpeed()}
              >
                Add speed
              </Button>
            }
          >
            <div className="space-y-3">
              {speeds.loading && !speeds.data ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : speeds.error ? (
                <InlineError message={speeds.error} onRetry={speeds.reload} />
              ) : (speeds.data ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong p-3 text-xs text-muted">
                  No speeds saved yet. The full DDR3, DDR4 and DDR5 speed matrix
                  is built in and always available.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {GENERATIONS.map((generation) => {
                    const rows = (speeds.data ?? []).filter((s) => s.generation === generation);
                    if (rows.length === 0) return null;
                    return (
                      <li key={generation} className="px-3 py-2">
                        <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                          {generation}
                        </p>
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {rows.map((s) => (
                            <li
                              key={s.id}
                              className="group flex items-center gap-1 rounded-full border border-line-strong bg-[#fafbfd] py-1 pr-1 pl-2.5 text-xs font-semibold text-ink"
                            >
                              <span className="tnum">{s.speed}</span>
                              <span className="text-2xs font-normal text-faint">{s.category}</span>
                              <IconButton
                                label={`Edit speed ${s.speed}`}
                                className="h-6 w-6"
                                onClick={() => openSpeed(s)}
                              >
                                <Pencil className="h-3 w-3" aria-hidden />
                              </IconButton>
                              <IconButton
                                label={`Remove speed ${s.speed}`}
                                tone="danger"
                                className="h-6 w-6"
                                onClick={() => setSpeedDelete(s)}
                              >
                                <Trash2 className="h-3 w-3" aria-hidden />
                              </IconButton>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-2xs text-faint">
                Removing a speed hides it from the form. Items already using it keep the value and
                still appear in inventory.
              </p>
            </div>
          </SettingsSection>
        </div>

        {/* --------------------------------------------------- backup ------- */}
        <SettingsSection
          icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
          title="Backup and restore"
          description="A consistent copy of the whole database, taken without closing the app"
          actions={
            <>
              <Button
                size="sm"
                icon={<RotateCcw className="h-4 w-4" aria-hidden />}
                onClick={runBackup}
                loading={backingUp}
              >
                Back up now
              </Button>
              <Button size="sm" onClick={() => { backups.reload(); backup.reload(); }}>
                Refresh
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-lg border border-line bg-[#fafbfd] p-3">
                  <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                    Last backup
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {info?.lastBackup ? displayDateTime(info.lastBackup) : "Never"}
                  </p>
                  {info?.lastBackupPath && (
                    <p
                      className="mt-0.5 truncate font-mono text-2xs text-faint"
                      title={info.lastBackupPath}
                    >
                      {info.lastBackupPath}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-line bg-[#fafbfd] p-3">
                  <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                    Backup folder
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-ink" title={info?.backupDir}>
                    {info?.backupDir ?? "Reading"}
                  </p>
                  <p className="mt-0.5 text-2xs text-faint">
                    Database size {bytes(info?.databaseSizeBytes)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-line p-3">
                <Toggle
                  checked={autoBackup}
                  onCheckedChange={setAutoBackup}
                  label="Automatic backup"
                  hint="Taken at startup once the interval below has elapsed"
                />
                <div className="mt-3">
                  <FormField label="Backup interval">
                    <SelectField
                      value={interval}
                      onChange={(e) => setInterval(e.target.value)}
                      disabled={!autoBackup}
                      options={BACKUP_INTERVALS}
                    />
                  </FormField>
                </div>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="primary"
                  icon={<Save className="h-4 w-4" aria-hidden />}
                  onClick={saveBackupPolicy}
                  loading={backingUp}
                >
                  Save schedule
                </Button>
              </div>
            </div>

            <div className="lg:col-span-2">
              <p className="mb-2 text-2xs font-bold tracking-wider text-muted uppercase">
                Saved backups ({qty(entries.length)})
              </p>
              {backups.loading && !backups.data ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : backups.error ? (
                <InlineError message={backups.error} onRetry={backups.reload} />
              ) : entries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line-strong p-4 text-center">
                  <p className="text-xs font-semibold text-ink">No backups on disk yet</p>
                  <p className="mt-1 text-xs text-muted">
                    Take the first one now, or turn on automatic backups so every startup is covered.
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="primary"
                    icon={<RotateCcw className="h-4 w-4" aria-hidden />}
                    onClick={runBackup}
                    loading={backingUp}
                  >
                    Back up now
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {entries.map((entry) => (
                    <li key={entry.path} className="flex items-center gap-3 px-3 py-2">
                      <Archive className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-semibold text-ink">
                          {entry.fileName}
                        </p>
                        <p className="truncate text-2xs text-faint">
                          {entry.createdAt ? displayDateTime(entry.createdAt) : "Date unknown"} &middot;{" "}
                          {bytes(entry.sizeBytes)}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        onClick={() => runVerify(entry)}
                        loading={verifying === entry.path}
                      >
                        Verify
                      </Button>
                      <Button
                        size="xs"
                        variant="warn-soft"
                        icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                        onClick={() => {
                          setRestoreError(null);
                          setRestoring(entry);
                        }}
                      >
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </SettingsSection>

        {/* --------------------------------------------------- database ----- */}
        <SettingsSection
          icon={<Database className="h-4 w-4" aria-hidden />}
          title="Database"
          description="One local SQLite file, with sample data for exploring the app"
          actions={
            <Button size="sm" onClick={() => void refreshAll()}>
              Reload app data
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-[#fafbfd] p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                  Database file
                </p>
                <p className="mt-1 font-mono text-xs break-all text-ink">{databasePath}</p>
                <p className="mt-1 text-2xs text-faint">
                  {bytes(info?.databaseSizeBytes)} on disk &middot; timezone {settings.timezone}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: "RAM items", value: demoRows?.ramItems },
                  { label: "Buyers", value: demoRows?.buyers },
                  { label: "Sellers", value: demoRows?.sellers },
                  { label: "Purchases", value: demoRows?.purchases },
                  { label: "Sales", value: demoRows?.sales },
                  { label: "Payments", value: demoRows?.payments },
                ].map((row) => (
                  <div key={row.label} className="rounded-lg border border-line px-3 py-2">
                    <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                      {row.label}
                    </p>
                    <p className="tnum mt-0.5 text-lg font-bold text-ink">
                      {demoRows ? qty(row.value ?? 0) : "-"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
                <div className="flex items-start gap-2.5">
                  <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-brand-800">Sample data</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-brand-800/85">
                      Load a small but complete business &mdash; RAM items, buyers, sellers, purchases,
                      sales, payments and coworker entries &mdash; so every screen can be reviewed
                      with realistic numbers. Clear it when you are ready to enter your own.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Wand2 className="h-4 w-4" aria-hidden />}
                        onClick={runSeed}
                        loading={seeding}
                        disabled={isEmpty.data === false}
                      >
                        {isEmpty.data === false ? "Data already present" : "Load sample data"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="h-4 w-4" aria-hidden />}
                        onClick={() => setClearing(true)}
                        disabled={isEmpty.data === true}
                      >
                        Clear all records
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-line p-3">
                <p className="text-2xs font-bold tracking-wider text-muted uppercase">
                  What is stored
                </p>
                <ul className="mt-1.5 space-y-1">
                  {[
                    "Inventory items with weighted average cost and every stock movement",
                    "Buyers, sellers and coworkers with running balances",
                    "Purchases, sales, returns, payments and their audit trail",
                    "The settings, master data and backups shown on this screen",
                  ].map((line) => (
                    <li key={line} className="flex gap-2 text-xs leading-relaxed text-muted">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-profit-600" aria-hidden />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-2xs text-faint">
                  Take a backup before clearing anything &mdash; restore puts it all back.
                </p>
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* -------------------------------------------------- appearance ---- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SettingsSection
            icon={<Palette className="h-4 w-4" aria-hidden />}
            title="Appearance"
            description="Density and theme used across the whole app"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Save className="h-4 w-4" aria-hidden />}
                onClick={saveAppearance}
                loading={savingAppearance}
                disabled={!appearanceDirty}
              >
                Save
              </Button>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Theme">
                <SelectField
                  value={appearance.theme}
                  onChange={(e) => setAppearance((a) => ({ ...a, theme: e.target.value }))}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </FormField>
              <FormField label="Row density">
                <SelectField
                  value={appearance.density}
                  onChange={(e) => setAppearance((a) => ({ ...a, density: e.target.value }))}
                  options={[
                    { value: "comfortable", label: "Comfortable" },
                    { value: "compact", label: "Compact" },
                  ]}
                />
              </FormField>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-[#fafbfd] p-3">
              <Monitor className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <p className="text-xs text-muted">
                ZEUS is designed for a desktop window of 1280&times;720 and larger. Tables hide their
                least important columns on the narrowest sizes rather than overlapping.
              </p>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={<Keyboard className="h-4 w-4" aria-hidden />}
            title="Keyboard shortcuts"
            description="Every shortcut works from anywhere except inside a text field"
          >
            <ul className="divide-y divide-line rounded-lg border border-line">
              {shortcuts.map(([keys, what]) => (
                <li key={keys} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="kbd shrink-0">{keys}</span>
                  <span className="text-xs text-muted">{what}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-start gap-1.5 text-2xs text-faint">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              B and S open the buy and sell workflows. Use them instead of reaching for the mouse.
            </p>
          </SettingsSection>
        </div>

        <p className="flex items-center gap-1.5 pb-1 text-2xs text-faint">
          <History className="h-3.5 w-3.5" aria-hidden />
          Settings changes are written to the audit log, so the trail shows who changed what and when.
        </p>
      </div>

      {/* ------------------------------------------------------ dialogs ---- */}

      <Modal
        open={speedDraft !== null}
        onClose={() => setSpeedDraft(null)}
        title={speedDraft?.id ? "Edit RAM speed" : "Add RAM speed"}
        subtitle="Becomes an option on the RAM item form straight away"
        icon={<Cpu className="h-4 w-4" aria-hidden />}
        size="sm"
        busy={speedBusy}
        footer={
          <>
            <Button onClick={() => setSpeedDraft(null)} disabled={speedBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commitSpeed} loading={speedBusy}>
              {speedDraft?.id ? "Save speed" : "Add speed"}
            </Button>
          </>
        }
      >
        {speedDraft && (
          <div className="space-y-3">
            <FormField
              label="Speed"
              required
              hint="Fixed to the ZEUS RAM speed matrix"
            >
              <SelectField
                value={speedDraft.speed}
                onChange={(e) =>
                  setSpeedDraft((s) => (s ? { ...s, speed: e.target.value } : s))
                }
                options={(RAM_SPEEDS_BY_GENERATION[speedDraft.generation as Generation] ?? []).map(
                  (value) => ({ value, label: value }),
                )}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Generation" required>
                <SelectField
                  value={speedDraft.generation}
                  onChange={(e) =>
                    setSpeedDraft((s) =>
                      s
                        ? {
                            ...s,
                            generation: e.target.value,
                            speed: RAM_SPEEDS_BY_GENERATION[e.target.value as Generation]?.includes(s.speed)
                              ? s.speed
                              : (RAM_SPEEDS_BY_GENERATION[e.target.value as Generation]?.[0] ?? s.speed),
                          }
                        : s,
                    )
                  }
                  options={GENERATIONS.map((g) => ({ value: g, label: g }))}
                />
              </FormField>
              <FormField label="Category" required>
                <SelectField
                  value={speedDraft.category}
                  onChange={(e) =>
                    setSpeedDraft((s) => (s ? { ...s, category: e.target.value } : s))
                  }
                  options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
                />
              </FormField>
            </div>
            <FormField label="Description">
              <TextArea
                rows={2}
                value={speedDraft.description}
                onChange={(e) =>
                  setSpeedDraft((s) => (s ? { ...s, description: e.target.value } : s))
                }
                placeholder="DDR4 RDIMM 2666V"
              />
            </FormField>
            {speedError && <InlineError message={speedError} />}
          </div>
        )}
      </Modal>

      <Modal
        open={namedDraft !== null}
        onClose={() => setNamedDraft(null)}
        title={
          namedDraft?.id
            ? "Edit entry"
            : `Add ${namedDraft?.kind.replace(/s$/, "") ?? "entry"}`
        }
        subtitle="Available immediately in the RAM forms and filters"
        icon={<Tag className="h-4 w-4" aria-hidden />}
        size="sm"
        busy={namedBusy}
        footer={
          <>
            <Button onClick={() => setNamedDraft(null)} disabled={namedBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commitNamed} loading={namedBusy}>
              {namedDraft?.id ? "Save changes" : "Add"}
            </Button>
          </>
        }
      >
        {namedDraft && (
          <div className="space-y-3">
            <FormField label="Name" required>
              <TextInput
                value={namedDraft.name}
                onChange={(e) =>
                  setNamedDraft((n) => (n ? { ...n, name: e.target.value } : n))
                }
                placeholder={
                  NAMED_GROUPS.find((g) => g.kind === namedDraft.kind)?.placeholder ?? "Name"
                }
                invalid={Boolean(namedError && !namedDraft.name.trim())}
              />
            </FormField>
            <FormField label="Description" hint="Optional note shown in the list">
              <TextArea
                rows={2}
                value={namedDraft.description}
                onChange={(e) =>
                  setNamedDraft((n) => (n ? { ...n, description: e.target.value } : n))
                }
                placeholder="Anything that helps at the counter"
              />
            </FormField>
            {namedError && <InlineError message={namedError} />}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={speedDelete !== null}
        title={`Remove ${speedDelete?.speed ?? "this speed"}`}
        tone="danger"
        icon={<Trash2 className="h-4 w-4" aria-hidden />}
        confirmLabel="Remove speed"
        busy={speedDeleting}
        message={
          <>
            <span className="mb-2 block">
              {speedDelete?.speed} will no longer be offered when creating or editing a RAM item.
            </span>
            <span className="block">
              Inventory already using this speed keeps it, so reports and stock levels stay correct.
            </span>
          </>
        }
        onConfirm={confirmSpeedDelete}
        onCancel={() => setSpeedDelete(null)}
      />

      <ConfirmDialog
        open={namedDelete !== null}
        title={`Remove ${namedDelete?.name ?? "this entry"}`}
        tone="danger"
        icon={<Trash2 className="h-4 w-4" aria-hidden />}
        confirmLabel="Remove entry"
        busy={namedDeleting}
        message={
          <>
            <span className="mb-2 block">
              {namedDelete?.name} will disappear from the forms and filters.
            </span>
            <span className="block">
              Existing records that already use this value are untouched.
            </span>
          </>
        }
        onConfirm={confirmNamedDelete}
        onCancel={() => setNamedDelete(null)}
      />

      <ConfirmDialog
        open={restoring !== null}
        title="Restore this backup"
        tone="warn"
        icon={<RotateCcw className="h-4 w-4" aria-hidden />}
        confirmLabel="Restore database"
        busy={restoreBusy}
        message={
          <>
            <span className="mb-2 block">
              The live database is replaced with{" "}
              <span className="font-mono text-xs">{restoring?.fileName}</span>. Everything recorded
              since that backup was taken is lost.
            </span>
            <span className="mb-2 block">
              The current database is copied aside first as a safety net, and the backup is verified
              as a readable ZEUS database before anything is replaced.
            </span>
            <span className="block">
              Every screen reloads automatically once the restore finishes.
            </span>
          </>
        }
        onConfirm={runRestore}
        onCancel={() => {
          setRestoring(null);
          setRestoreError(null);
        }}
      />

      <ConfirmDialog
        open={clearing}
        title="Clear every record"
        tone="danger"
        icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
        confirmLabel="Clear all records"
        busy={clearBusy}
        message={
          <>
            <span className="mb-2 block">
              Every RAM item, buyer, seller, coworker, purchase, sale, return and payment is
              permanently deleted. The database is left empty and ready for your own data.
            </span>
            <span className="block">
              Take a backup first if you might want any of this back &mdash; restoring a backup brings
              it all back in one step.
            </span>
          </>
        }
        onConfirm={runClear}
        onCancel={() => setClearing(false)}
      />

      {/* A failed restore must say why, not close the dialog silently. */}
      {restoreError && !restoring && (
        <div className="sr-only" role="alert">
          {restoreError}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- master data list */

function MasterDataList({
  rows,
  loading,
  error,
  onRetry,
  emptyMessage,
  onEdit,
  onDelete,
  builtin = [],
}: {
  rows: NamedValue[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyMessage: string;
  onEdit: (row: NamedValue) => void;
  onDelete: (row: NamedValue) => void;
  builtin?: string[];
}) {
  const builtinsNotSaved = useMemo(
    () => builtin.filter((b) => !rows.some((r) => r.name.toLowerCase() === b.toLowerCase())),
    [builtin, rows],
  );

  if (loading && rows.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (error) return <InlineError message={error} onRetry={onRetry} />;

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-3 text-xs text-muted">
          {emptyMessage}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex items-center gap-1 rounded-full border border-line-strong bg-[#fafbfd]",
                "py-1 pr-1 pl-2.5 text-xs font-semibold text-ink",
              )}
              title={row.description || row.name}
            >
              <span className="max-w-[12rem] truncate">{row.name}</span>
              <IconButton
                label={`Edit ${row.name}`}
                className="h-6 w-6"
                onClick={() => onEdit(row)}
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </IconButton>
              <IconButton
                label={`Remove ${row.name}`}
                tone="danger"
                className="h-6 w-6"
                onClick={() => onDelete(row)}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {builtinsNotSaved.length > 0 && (
        <div>
          <p className="mb-1.5 text-2xs font-bold tracking-wider text-muted uppercase">
            Always available
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {builtinsNotSaved.map((name) => (
              <li
                key={name}
                className="flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs font-semibold text-muted"
              >
                {name}
                <IconButton
                  label={`Add ${name} to your saved list`}
                  className="h-5 w-5"
                  onClick={() => onEdit({ id: "", name, description: "" } as NamedValue)}
                >
                  <Plus className="h-3 w-3" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-2xs text-faint">
            Built-in values work everywhere without being saved. Add one to rename it or give it a
            description.
          </p>
        </div>
      )}
    </div>
  );
}