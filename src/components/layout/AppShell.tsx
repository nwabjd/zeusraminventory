import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  CreditCard,
  Database,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MinusCircle,
  Package,
  PlusCircle,
  RefreshCw,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  TrendingUp,
  UserCog,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { cn, displayDate, displayDateTime } from "../../lib/format";
import { api } from "../../lib/api";
import { useApp } from "../../lib/app-context";
import { useAuth } from "../../lib/auth";
import { useSync } from "../../lib/sync";
import { ROLE_SHORT, isAdmin } from "../../lib/approval";
import type { UserRole } from "../../lib/cloud-types";
import type { SearchHit } from "../../lib/types";
import { Button } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { StatusBadge } from "../ui/DataTable";

/* ================================================================== nav === */

interface NavEntry {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  hotkey: string;
}

const NAV: { group: string; items: NavEntry[] }[] = [
  {
    group: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, hotkey: "D" },
      { to: "/inventory", label: "Inventory", icon: Package, hotkey: "I" },
    ],
  },
  {
    group: "Trading",
    items: [
      { to: "/purchases", label: "Purchases", icon: ShoppingCart, hotkey: "P" },
      { to: "/sales", label: "Sales", icon: TrendingUp, hotkey: "L" },
      { to: "/payments", label: "Payments", icon: CreditCard, hotkey: "M" },
    ],
  },
  {
    group: "Directory",
    items: [
      { to: "/buyers", label: "Buyers", icon: Users, hotkey: "B" },
      { to: "/sellers", label: "Sellers", icon: Building2, hotkey: "U" },
      { to: "/coworker-ledger", label: "Coworker Ledger", icon: UsersRound, hotkey: "C" },
    ],
  },
  {
    group: "Analysis",
    items: [
      { to: "/reports", label: "Reports", icon: BarChart3, hotkey: "R" },
      { to: "/settings", label: "Settings", icon: SettingsIcon, hotkey: "," },
    ],
  },
];

/** Admin-only screens. */
const ADMIN_GROUP: { group: string; items: NavEntry[] } = {
  group: "Administration",
  items: [
    { to: "/approvals", label: "Approvals", icon: ClipboardCheck, hotkey: "" },
    { to: "/users", label: "Users", icon: UserCog, hotkey: "" },
    { to: "/audit", label: "Audit Log", icon: ScrollText, hotkey: "" },
  ],
};

/** Sales-representative additions. */
const REP_TRADING_ITEM: NavEntry = {
  to: "/my-transactions",
  label: "My Transactions",
  icon: Inbox,
  hotkey: "",
};

/**
 * Navigation is a projection of the signed-in role: the UI reacts to what the
 * signed-in account may do, while the backend policies are the real boundary.
 */
function navFor(role: UserRole | null | undefined): { group: string; items: NavEntry[] }[] {
  if (role === "admin") return [...NAV, ADMIN_GROUP];
  if (role === "sales_representative") {
    return NAV.map((section) =>
      section.group === "Trading"
        ? { ...section, items: [REP_TRADING_ITEM, ...section.items] }
        : section,
    );
  }
  return [...NAV];
}

/* ============================================================== sidebar === */

function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" fill="#2551eb" />
      <rect x="9" y="7" width="14" height="18" rx="2.5" fill="#ffffff" opacity="0.14" />
      <rect
        x="11.5"
        y="10"
        width="9"
        height="12"
        rx="1.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.6"
      />
      <path
        d="M13 13.2h6M13 16h6M13 18.8h3.4"
        stroke="#ffffff"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 5.2l1.75 3.05L21 9.05l-2.4 2.35.57 3.3L16 13.05l-3.17 1.65.57-3.3L11 9.05l3.25-.8L16 5.2z"
        fill="#34d399"
      />
    </svg>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { settings, version, databasePath } = useApp();
  const { profile, pendingCounts, cloud } = useAuth();
  const entries = navFor(profile?.role ?? null);
  const admin = isAdmin(profile);
  const pendingTotal = pendingCounts.sales + pendingCounts.purchases;

  return (
    <div className="flex h-full min-h-0 flex-col bg-navy-900 text-navy-100">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-navy-700 px-4 py-3.5">
        <BrandMark className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-bold tracking-[0.18em] text-white">
            {settings.businessName}
          </p>
          <p className="truncate text-2xs font-semibold tracking-[0.12em] text-navy-300 uppercase">
            {settings.businessTagline}
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
        {entries.map((section) => (
          <div key={section.group} className="mb-4 last:mb-0">
            <p className="px-2.5 pb-1.5 text-2xs font-bold tracking-[0.14em] text-navy-400 uppercase">
              {section.group}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-brand-600 text-white shadow-[0_1px_2px_0_rgb(0_0_0_/_0.25)]"
                          : "text-navy-200 hover:bg-navy-800 hover:text-white",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            "absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-300 transition-opacity",
                            isActive ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden
                        />
                        <item.icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isActive ? "text-white" : "text-navy-400 group-hover:text-navy-200",
                          )}
                          aria-hidden
                        />
                        <span className="truncate">{item.label}</span>
                        {admin && item.to === "/approvals" && pendingTotal > 0 && (
                          <span className="badge badge-danger ml-auto shrink-0" title={`${pendingTotal} pending request(s)`}>
                            {pendingTotal}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {cloud && profile && <ProfileBar />}

      <div className="shrink-0 border-t border-navy-700 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-2xs text-navy-400">
          <Database className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate" title={databasePath}>
            {databasePath ? databasePath.split(/[\\/]/).pop() : "Local database"}
          </span>
        </div>
        <p className="mt-0.5 pl-6 text-2xs text-navy-500">Version {version || "1.0.0"}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------- signed-in identity pill ---- */

function ProfileBar() {
  const { profile, signOut } = useAuth();
  const { cloud, status, lastSync, error, syncNow } = useSync();
  const initials = (profile?.display_name || profile?.email || "?")
    .slice(0, 2)
    .toUpperCase();

  const syncLabel =
    status === "connected" ? "Cloud · connected" : status === "syncing" ? "Cloud · syncing" : status === "offline" ? "Cloud · offline" : status === "error" ? "Cloud · sync error" : "Cloud";
  const syncTone =
    status === "connected"
      ? "bg-emerald-400"
      : status === "syncing"
        ? "bg-amber-300 animate-pulse"
        : status === "offline"
          ? "bg-sky-400"
          : status === "error"
            ? "bg-danger-400"
            : "bg-navy-500";
  const updatedHint = status === "error" && error
    ? "Tap to retry"
    : lastSync
      ? `Updated ${timeAgo(lastSync)}`
      : "Not synced yet";

  return (
    <div className="shrink-0 border-t border-navy-700 px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">
            {profile?.display_name || profile?.email?.split("@")[0] || "ZEUS user"}
          </p>
          <p className="truncate text-2xs text-navy-400">{profile?.email}</p>
        </div>
      </div>
      {cloud && (
        <button
          type="button"
          onClick={() => void syncNow()}
          title={error || "Pull latest from the cloud ledger"}
          className="mt-2 flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left hover:bg-navy-800"
        >
          <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-navy-300">
            <span className={`h-1.5 w-1.5 rounded-full ${syncTone}`} aria-hidden />
            {syncLabel}
          </span>
          <span className="truncate text-2xs text-navy-500">{updatedHint}</span>
        </button>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusBadge tone={profile?.role === "admin" ? "brand" : "profit"}>
          {profile?.role ? ROLE_SHORT[profile.role] : "—"}
        </StatusBadge>
        <Button
          size="sm"
          variant="ghost"
          className="!text-navy-300 hover:!text-white"
          icon={<LogOut className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ============================================================= global search === */

const KIND_ICON: Record<string, typeof Package> = {
  inventory: Package,
  buyer: Users,
  seller: Building2,
  purchase: ShoppingCart,
  sale: TrendingUp,
  payment: CreditCard,
};

function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.globalSearch(q, 14);
        if (!cancelled) setHits(res);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setBusy(false);
    };
  }, [query]);

  const go = (hit: SearchHit) => {
    onClose();
    setQuery("");
    navigateRef.current(hit.route);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Search everything"
      subtitle="SKUs, buyers, sellers, purchases, sales and payments"
      size="lg"
      bodyClassName="!p-0"
    >
      <div className="border-b border-line p-3">
        <div className="input-group">
          <Search className="input-group-icon h-4 w-4" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type at least two characters - e.g. 2666V, Sharjah, PUR-2026..."
            className="input h-10 pl-8"
          />
          {busy && <RefreshCw className="spin absolute right-3 h-4 w-4 text-faint" aria-hidden />}
        </div>
      </div>
      <div className="max-h-[26rem] overflow-y-auto">
        {query.trim().length < 2 ? (
          <p className="px-4 py-8 text-center text-xs text-muted">
            Start typing to search across the whole business.
          </p>
        ) : hits.length === 0 && !busy ? (
          <p className="px-4 py-8 text-center text-xs text-muted">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {hits.map((hit) => {
              const Icon = KIND_ICON[hit.kind] ?? Package;
              return (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-brand-600">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {hit.title}
                      </span>
                      <span className="block truncate text-2xs text-muted">{hit.subtitle}</span>
                    </span>
                    {hit.meta && (
                      <span className="tnum shrink-0 text-xs font-semibold text-ink">
                        {hit.meta}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* ================================================================ top bar === */

interface TopBarProps {
  onOpenSearch: () => void;
  onBuy: () => void;
  onSell: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

function TopBar({
  onOpenSearch,
  onBuy,
  onSell,
  onToggleSidebar,
  sidebarOpen,
}: TopBarProps) {
  const { settings, autoBackupNote } = useApp();
  const location = useLocation();

  const crumbs = location.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleSidebar}
        title={sidebarOpen ? "Hide navigation" : "Show navigation"}
        aria-label={sidebarOpen ? "Hide navigation" : "Show navigation"}
        className="lg:hidden"
      >
        {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-xs sm:flex">
        <span className="font-semibold text-muted">{settings.businessName}</span>
        {crumbs.map((c, i) => (
          <span key={c} className="flex min-w-0 items-center gap-1.5">
            <span className="text-line-strong">/</span>
            <span
              className={cn(
                "truncate",
                i === crumbs.length - 1 ? "font-semibold text-ink" : "text-muted",
              )}
            >
              {c}
            </span>
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {autoBackupNote && (
          <StatusBadge tone="info" className="hidden xl:inline-flex">
            Auto-backup saved
          </StatusBadge>
        )}

        <button
          type="button"
          onClick={onOpenSearch}
          className="input-group hidden w-56 md:flex"
          title="Search (press / )"
        >
          <Search className="input-group-icon h-4 w-4" aria-hidden />
          <span className="input h-9 cursor-text justify-start pl-8 text-xs text-faint">
            Search everything
          </span>
          <span className="kbd pointer-events-none absolute right-1.5">/</span>
        </button>

        <Button
          variant="ghost"
          size="sm"
          className="md:hidden"
          onClick={onOpenSearch}
          aria-label="Search"
        >
          <Search className="h-4 w-4" aria-hidden />
        </Button>

        <div className="mx-0.5 h-6 w-px bg-line" aria-hidden />

        <Button variant="profit" size="sm" onClick={onBuy}>
          <PlusCircle className="h-4 w-4" aria-hidden />
          Buy RAM
        </Button>
        <Button variant="danger" size="sm" onClick={onSell}>
          <MinusCircle className="h-4 w-4" aria-hidden />
          Sell RAM
        </Button>
      </div>
    </header>
  );
}

/* ============================================================== app shell === */

export interface AppShellProps {
  /** Opens the BUY RAM workflow from anywhere in the app. */
  onBuy: () => void;
  /** Opens the SELL RAM workflow from anywhere in the app. */
  onSell: () => void;
  children?: ReactNode;
}

/**
 * The persistent frame: dark navy sidebar, light canvas, white content.
 * BUY RAM and SELL RAM live in the top bar so they are one click from any
 * screen - the two actions the business runs on.
 */
export function AppShell({ onBuy, onSell, children }: AppShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let chord = false;
    let chordTimer = 0;
    const onKey = (e: KeyboardEvent) => {
      // Held-down keys auto-repeat; only the first press may trigger a hotkey.
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;
      // Global hotkeys stay silent while a dialog has focus so typing inside a
      // modal can never flip the page behind it.
      if (target && target.closest('[role="dialog"], [aria-modal="true"]')) return;

      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (key === "g") {
        chord = true;
        window.clearTimeout(chordTimer);
        chordTimer = window.setTimeout(() => {
          chord = false;
        }, 1200);
        return;
      }
      if (chord) {
        chord = false;
        const all = navFor(profile?.role ?? null).flatMap((s) => s.items);
        const hit = all.find((i) => i.hotkey && i.hotkey.toLowerCase() === key);
        if (hit) {
          e.preventDefault();
          navigate(hit.to);
        }
        return;
      }
      if (key === "b") {
        e.preventDefault();
        onBuy();
      } else if (key === "s") {
        e.preventDefault();
        onSell();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(chordTimer);
    };
  }, [navigate, onBuy, onSell, profile]);

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      {/* Fixed sidebar: 248px is comfortable at 1280x720 and 1920x1080 alike. */}
      <aside className="hidden w-[248px] shrink-0 lg:block">
        <SidebarContent />
      </aside>

      {/* Overlay sidebar for narrow windows. */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="anim-fade-in absolute inset-0 bg-navy-950/50"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <div className="anim-slide-in-right absolute inset-y-0 left-0 w-[264px] shadow-[var(--shadow-pop)]">
            <SidebarContent onNavigate={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenSearch={() => setSearchOpen(true)}
          onBuy={onBuy}
          onSell={onSell}
        />
        <main className="print-area min-h-0 flex-1 overflow-hidden">
          {children ?? <Outlet />}
        </main>
        <StatusBar />
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

/** Footer strip used by pages that need the database path / backup state. */
export function StatusBar({ children }: { children?: ReactNode }) {
  const { settings, databasePath } = useApp();
  return (
    <div className="no-print flex shrink-0 items-center justify-between gap-4 border-t border-line bg-surface px-4 py-1.5 text-2xs text-faint">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate" title={databasePath}>
          {databasePath}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {children}
        <span>
          {settings.currency} &middot; {settings.timezone}
        </span>
        <span>&middot; Last backup {settings.lastBackup ? displayDateTime(settings.lastBackup) : "never"}</span>
      </div>
    </div>
  );
}

export { displayDate };
