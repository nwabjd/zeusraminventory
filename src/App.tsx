import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { AppProvider, useApp } from "./lib/app-context";
import { AuthProvider, useAuth } from "./lib/auth";
import { SyncProvider } from "./lib/sync";
import { isAdmin } from "./lib/approval";
import { Button, ToastProvider, useToast } from "./components/ui";
import { AppShell } from "./components/layout/AppShell";
import { TransactionDialog, type TransactionMode } from "./components/transactions";
import { AccountBlocked, LoginScreen } from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import InventoryDetail from "./pages/InventoryDetail";
import Purchases from "./pages/Purchases";
import PurchaseDetail from "./pages/PurchaseDetail";
import Sales from "./pages/Sales";
import SaleDetail from "./pages/SaleDetail";
import Buyers from "./pages/Buyers";
import Sellers from "./pages/Sellers";
import { PartyDetail } from "./pages/PartyDetail";
import Payments from "./pages/Payments";
import CoworkerLedger from "./pages/CoworkerLedger";
import CoworkerDetail from "./pages/CoworkerDetail";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Approvals from "./pages/Approvals";
import Users from "./pages/Users";
import AuditLog from "./pages/AuditLog";
import MyTransactions from "./pages/MyTransactions";

/* ===========================================================================
   ZEUS - RAM inventory management
   ---------------------------------------------------------------------------
   BUY RAM and SELL RAM are opened from a single dialog mounted here, so the
   keyboard shortcut, the top bar and every page button all drive the same
   workflow. A completed document refreshes the data the app context caches so
   every screen reflects it immediately.

   When the cloud layer is configured, this same workspace only renders for an
   authenticated, provisioned account - and BUY/SELL become approval requests.
   =========================================================================== */

/** Splash shown while the signed-in session is being restored. */
function CloudSplash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[var(--shadow-raised)]">
        <Loader2 className="spin h-6 w-6" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-ink">Starting ZEUS</p>
      <p className="text-xs text-muted">Restoring your session</p>
    </div>
  );
}

/**
 * Cloud gate. Without a configured cloud the app is entirely unchanged. With
 * one configured, the local database (and its data) is not even opened until a
 * provisioned, active account signs in.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const { cloud, phase, profile } = useAuth();
  if (!cloud) return <>{children}</>;
  if (phase === "boot") return <CloudSplash />;
  if (phase === "signedOut") return <LoginScreen />;
  if (!profile || !profile.role) return <AccountBlocked reason="not-authorized" />;
  if (profile.status !== "active") return <AccountBlocked reason="inactive" />;
  return <>{children}</>;
}

/** Route guard: the backend enforces the same rule, this just avoids the flash. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (!isAdmin(profile)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** Splash / failure state shown until the database has been opened. */
function Bootstrap({ children }: { children: ReactNode }) {
  const { ready, error, retry } = useApp();

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-6">
        <div className="card w-full max-w-md p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-50 text-danger-600">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-ink">ZEUS cannot open the database</h1>
              <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-muted">{error}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                The business data lives in a single local file. Close any other copy of ZEUS, make
                sure its folder is writable, then try again. Nothing has been changed.
              </p>
              <Button
                className="mt-3"
                variant="primary"
                icon={<RefreshCw className="h-4 w-4" aria-hidden />}
                onClick={retry}
              >
                Try again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[var(--shadow-raised)]">
          <Loader2 className="spin h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm font-semibold text-ink">Starting ZEUS</p>
        <p className="text-xs text-muted">Opening the local database and checking for backups</p>
      </div>
    );
  }

  return <>{children}</>;
}

/** Routes plus the global BUY / SELL workflow. */
function Workspace() {
  const [transaction, setTransaction] = useState<TransactionMode | null>(null);
  const { refreshAll } = useApp();
  const toast = useToast();

  const openBuy = useCallback(() => setTransaction("buy"), []);
  const openSell = useCallback(() => setTransaction("sell"), []);

  /* Every page renders inside the same shell; only the three screens that need
     the buy/sell callbacks receive them. */
  const screen = (element: ReactElement) => (
    <AppShell onBuy={openBuy} onSell={openSell}>
      {element}
    </AppShell>
  );

  return (
    <>
      <Routes>
        <Route path="/" element={screen(<Dashboard onBuy={openBuy} onSell={openSell} />)} />
        <Route path="/inventory" element={screen(<Inventory />)} />
        <Route path="/inventory/:id" element={screen(<InventoryDetail />)} />
        <Route path="/purchases" element={screen(<Purchases onBuy={openBuy} />)} />
        <Route path="/purchases/:id" element={screen(<PurchaseDetail />)} />
        <Route path="/sales" element={screen(<Sales onSell={openSell} />)} />
        <Route path="/sales/:id" element={screen(<SaleDetail />)} />
        <Route path="/buyers" element={screen(<Buyers />)} />
        <Route path="/buyers/:id" element={screen(<PartyDetail kind="buyer" />)} />
        <Route path="/sellers" element={screen(<Sellers />)} />
        <Route path="/sellers/:id" element={screen(<PartyDetail kind="seller" />)} />
        <Route path="/payments" element={screen(<Payments />)} />
        <Route path="/coworker-ledger" element={screen(<CoworkerLedger />)} />
        <Route path="/coworker-ledger/:id" element={screen(<CoworkerDetail />)} />
        <Route path="/reports" element={screen(<Reports />)} />
        <Route path="/settings" element={screen(<Settings />)} />
        <Route path="/my-transactions" element={screen(<MyTransactions />)} />
        <Route path="/approvals" element={screen(<RequireAdmin><Approvals /></RequireAdmin>)} />
        <Route path="/users" element={screen(<RequireAdmin><Users /></RequireAdmin>)} />
        <Route path="/audit" element={screen(<RequireAdmin><AuditLog /></RequireAdmin>)} />
        <Route
          path="*"
          element={screen(
            <div className="page">
              <div className="page-scroll flex items-center justify-center">
                <div className="card max-w-md p-5 text-center">
                  <h1 className="text-base font-bold text-ink">That screen does not exist</h1>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    The address you followed is not part of ZEUS. Use the navigation on the left to
                    get back to the dashboard.
                  </p>
                </div>
              </div>
            </div>,
          )}
        />
      </Routes>

      {/* One dialog drives both workflows, opened from anywhere in the app. */}
      <TransactionDialog
        open={transaction !== null}
        mode={transaction ?? "buy"}
        onClose={() => setTransaction(null)}
        onCompleted={(doc) => {
          const was = transaction;
          setTransaction(null);
          void refreshAll();
          if (!doc) {
            toast.success(
              was === "buy" ? "Purchase submitted for approval" : "Sale submitted for approval",
              "An administrator must approve it before any stock changes.",
            );
            return;
          }
          toast.success(
            was === "buy" ? "Purchase recorded" : "Sale recorded",
            "Stock, balances and profit have all been updated.",
          );
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ToastProvider>
          <AuthGate>
            <SyncProvider>
              <AppProvider>
                <Bootstrap>
                  <Workspace />
                </Bootstrap>
              </AppProvider>
            </SyncProvider>
          </AuthGate>
        </ToastProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}