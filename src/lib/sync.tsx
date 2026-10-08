/* ===========================================================================
   Sync provider - keeps the local mirror in step with the authoritative
   cloud ledger.
   ---------------------------------------------------------------------------
   * No cloud env vars  => every member is inert ("idle"), nothing subscribes.
   * Cloud configured   => a pull+apply cycle runs on login / app start, after
     every authorize (submit/decide), every 60s while signed in, and on
     realtime changes to the ledger (debounced). The status drives the
     AppShell pill: CONNECTED / SYNCING / OFFLINE / SYNC ERROR.

   The mirror is only ever a cache of cloud rows (C2L). Writes that change
   inventory or finalize documents happen server-side; sync only moves bytes
   from Supabase into the local mirror tables.
   =========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./auth";
import { cloudPullSync, cloudSubscribeLedger } from "./cloud";
import { cloudEnabled } from "./cloud-config";

export type SyncStatus = "idle" | "syncing" | "connected" | "offline" | "error";

export interface SyncState {
  /** Mirrors cloudEnabled() so the shell can hide the pill when unused. */
  cloud: boolean;
  status: SyncStatus;
  lastSync: string | null;
  error: string | null;
  /** Runs one pull+apply cycle. Resolves true when it completed without error. */
  syncNow: () => Promise<boolean>;
}

const SyncContext = createContext<SyncState | null>(null);

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}

const POLL_MS = 60_000;
const DEBOUNCE_MS = 2_000;

function isNetworkFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /network|fetch|offline|econn|timed out|unreachable/i.test(msg);
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { phase, cloud } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const rerunRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!cloudEnabled()) return false;
    if (syncingRef.current) {
      // A sync is already running - request one more pass when it completes so
      // a decision submitted mid-pull is not lost.
      rerunRef.current = true;
      return true;
    }
    syncingRef.current = true;
    setStatus("syncing");
    setError(null);
    try {
      await cloudPullSync();
      setStatus("connected");
      setLastSync(new Date().toISOString());
      const again = rerunRef.current;
      rerunRef.current = false;
      return !again;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e ?? "Sync failed."));
      setStatus(isNetworkFailure(e) ? "offline" : "error");
      return false;
    } finally {
      syncingRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        void syncNow();
      }
    }
  }, []);

  // Reset the pill when the app is not in cloud mode or the user signs out.
  useEffect(() => {
    if (!cloud || phase !== "signedIn") {
      setStatus("idle");
      setError(null);
      return;
    }
  }, [cloud, phase]);

  // Login / app start, periodic poll and realtime-triggered pull.
  useEffect(() => {
    if (!cloud || phase !== "signedIn") return;
    void syncNow();
    const poll = setInterval(() => void syncNow(), POLL_MS);
    const onLedgerChange = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void syncNow(), DEBOUNCE_MS);
    };
    const unsubscribe = cloudSubscribeLedger(onLedgerChange);
    return () => {
      clearInterval(poll);
      unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [cloud, phase, syncNow]);

  const value = useMemo<SyncState>(
    () => ({ cloud, status, lastSync, error, syncNow }),
    [cloud, status, lastSync, error, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}