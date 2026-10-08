import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";

export interface AppSettings {
  businessName: string;
  businessTagline: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  businessTrn: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  lowStockDefault: string;
  theme: string;
  density: string;
  autoBackup: string;
  backupIntervalHours: string;
  backupDir: string;
  lastBackup: string;
  lastBackupPath: string;
  /** Bumped whenever settings change so every screen re-reads them. */
  revision: number;
}

interface AppState {
  ready: boolean;
  error: string | null;
  settings: AppSettings;
  version: string;
  databasePath: string;
  autoBackupNote: string;
  currency: string;
  business: { name: string; tagline: string; phone: string; trn: string };
  refreshSettings: () => Promise<void>;
  refreshAll: () => Promise<void>;
  retry: () => void;
}

const FALLBACK: AppSettings = {
  businessName: "ZEUS",
  businessTagline: "RAM INVENTORY MANAGEMENT",
  businessAddress: "",
  businessPhone: "",
  businessEmail: "",
  businessTrn: "",
  currency: "AED",
  timezone: "Asia/Dubai",
  dateFormat: "DD/MM/YYYY",
  lowStockDefault: "5",
  theme: "light",
  density: "comfortable",
  autoBackup: "1",
  backupIntervalHours: "24",
  backupDir: "",
  lastBackup: "",
  lastBackupPath: "",
  revision: 0,
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

/** Shorthand for the currency code, which every money formatter needs. */
export function useCurrency(): string {
  return useApp().currency;
}

function mapSettings(raw: Record<string, string>, revision: number): AppSettings {
  return {
    ...FALLBACK,
    businessName: raw.business_name || FALLBACK.businessName,
    businessTagline: raw.business_tagline || FALLBACK.businessTagline,
    businessAddress: raw.business_address || "",
    businessPhone: raw.business_phone || "",
    businessEmail: raw.business_email || "",
    businessTrn: raw.business_trn || "",
    currency: raw.currency || FALLBACK.currency,
    timezone: raw.timezone || FALLBACK.timezone,
    dateFormat: raw.date_format || FALLBACK.dateFormat,
    lowStockDefault: raw.low_stock_default || FALLBACK.lowStockDefault,
    theme: raw.theme || FALLBACK.theme,
    density: raw.density || FALLBACK.density,
    autoBackup: raw.auto_backup ?? FALLBACK.autoBackup,
    backupIntervalHours: raw.backup_interval_hours || FALLBACK.backupIntervalHours,
    backupDir: raw.backup_dir || "",
    lastBackup: raw.last_backup || "",
    lastBackupPath: raw.last_backup_path || "",
    revision,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(FALLBACK);
  const [version, setVersion] = useState("");
  const [databasePath, setDatabasePath] = useState("");
  const [autoBackupNote, setAutoBackupNote] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useMemo(
    () => async () => {
      try {
        const info = await api.bootstrap();
        setSettings(mapSettings(info.settings, Date.now()));
        setVersion(info.version);
        setDatabasePath(info.databasePath);
        setAutoBackupNote(info.autoBackup || "");
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setReady(true);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const refreshSettings = useMemo(
    () => async () => {
      try {
        const raw = await api.appSettings();
        setSettings((prev) => mapSettings(raw, prev.revision + 1));
      } catch {
        /* A settings refresh failure must never break the screen. */
      }
    },
    [],
  );

  const value = useMemo<AppState>(
    () => ({
      ready,
      error,
      settings,
      version,
      databasePath,
      autoBackupNote,
      currency: settings.currency,
      business: {
        name: settings.businessName,
        tagline: settings.businessTagline,
        phone: settings.businessPhone,
        trn: settings.businessTrn,
      },
      refreshSettings,
      refreshAll: load,
      retry: () => setAttempt((a) => a + 1),
    }),
    [ready, error, settings, version, databasePath, autoBackupNote, refreshSettings, load],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/* =========================================================== keyboard help === */

const GLOBAL_SHORTCUTS: Record<string, string> = {
  b: "BUY RAM",
  s: "SELL RAM",
  "/": "Search everything",
  "g then d": "Dashboard",
  "g then i": "Inventory",
  "g then p": "Purchases",
  "g then l": "Sales",
  "g then b": "Buyers",
  "g then u": "Sellers",
  "g then m": "Payments",
  "g then c": "Coworker Ledger",
  "g then r": "Reports",
  "g then ,": "Settings",
};

export function shortcutLegend(): [string, string][] {
  return Object.entries(GLOBAL_SHORTCUTS);
}
