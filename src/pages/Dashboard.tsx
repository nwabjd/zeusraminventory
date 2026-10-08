import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Building2,
  CreditCard,
  HandCoins,
  MinusCircle,
  Package,
  PlusCircle,
  Receipt,
  ShieldAlert,
  ShoppingCart,
  Tag,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import {
  cn,
  displayDate,
  money,
  movementLabel,
  paymentLabel,
  percent,
  qty,
  relativeDay,
} from "../lib/format";
import { useCurrency } from "../lib/app-context";
import { useAuth } from "../lib/auth";
import { isAdmin } from "../lib/approval";
import { useAsync } from "../lib/useAsync";
import { Button, IconButton, StatusBadge } from "../components/ui";
import { MoneyStat, PageHeader, PrimaryActionCard, SectionCard, StatCard } from "../components/ui/Cards";
import { DataTable } from "../components/ui/DataTable";
import { EmptyState, InlineError, SkeletonCards, SkeletonTable } from "../components/ui/Feedback";
import type { StockMovement } from "../lib/types";

/* ===========================================================================
   Dashboard
   ---------------------------------------------------------------------------
   The morning screen: what the shop is worth, what it owes and is owed, what is
   about to run out, and what happened in the last few days. BUY RAM and SELL
   RAM sit at the top because they are the two actions everything else feeds.
   =========================================================================== */

export interface DashboardProps {
  onBuy: () => void;
  onSell: () => void;
}

type Feed = "sales" | "purchases" | "payments" | "movements";

const FEED_TABS: { key: Feed; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "purchases", label: "Purchases" },
  { key: "payments", label: "Payments" },
  { key: "movements", label: "Stock" },
];

export default function Dashboard({ onBuy, onSell }: DashboardProps) {
  const currency = useCurrency();
  const navigate = useNavigate();
  const [feed, setFeed] = useState<Feed>("sales");

  const state = useAsync(() => api.dashboard(), []);
  const s = state.data;

  const reloadAll = () => state.reload();

  if (state.loading && !s) {
    return (
      <div className="page">
        <PageHeader
          title="Dashboard"
          subtitle="Live position across stock, money and people"
          icon={<Boxes className="h-5 w-5" aria-hidden />}
        />
        <SkeletonCards count={8} />
        <div className="card overflow-hidden">
          <SkeletonTable rows={6} columns={5} />
        </div>
      </div>
    );
  }

  if (state.error && !s) {
    return (
      <div className="page">
        <PageHeader
          title="Dashboard"
          subtitle="Live position across stock, money and people"
          icon={<Boxes className="h-5 w-5" aria-hidden />}
        />
        <InlineError message={state.error} onRetry={reloadAll} />
      </div>
    );
  }

  if (!s) return null;

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={`Live position across ${qty(s.totalSkus)} SKU${
          s.totalSkus === 1 ? "" : "s"
        } and ${qty(s.buyerCount)} buyer${s.buyerCount === 1 ? "" : "s"}`}
        icon={<Boxes className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button onClick={() => navigate("/reports")} icon={<BarChart3 className="h-4 w-4" aria-hidden />}>
              Reports
            </Button>
            <Button onClick={reloadAll} icon={<ArrowRight className="h-4 w-4" aria-hidden />}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="page-scroll space-y-4">
        {/* ---- the two actions the business runs on ---------------------- */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryActionCard
            tone="buy"
            label="Buy RAM"
            description="Bring stock in from a seller. Cost and stock update together."
            icon={<PlusCircle className="h-6 w-6" aria-hidden />}
            onClick={onBuy}
            shortcut="B"
          />
          <PrimaryActionCard
            tone="sell"
            label="Sell RAM"
            description="Send stock out to a buyer. Profit and margin are worked out live."
            icon={<MinusCircle className="h-6 w-6" aria-hidden />}
            onClick={onSell}
            shortcut="S"
          />
        </div>

        {/* ---- money position ------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MoneyStat
            label="Inventory at cost"
            value={s.totalInventoryCost}
            currency={currency}
            icon={<Package className="h-4 w-4" aria-hidden />}
            tone="navy"
            hint={`${qty(s.totalStock)} units on the shelf`}
            onClick={() => navigate("/inventory")}
          />
          <MoneyStat
            label="Retail value"
            value={s.estimatedSalesValue}
            currency={currency}
            icon={<Tag className="h-4 w-4" aria-hidden />}
            tone="brand"
            hint={`Potential profit ${money(s.potentialProfit, currency)}`}
            onClick={() => navigate("/inventory")}
          />
          <MoneyStat
            label="Sales this month"
            value={s.monthSales}
            currency={currency}
            direction="up"
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            tone="profit"
            hint={`Gross profit ${money(s.monthProfit, currency)} - ${percent(s.averageMargin)} margin`}
            onClick={() => navigate("/sales")}
          />
          <MoneyStat
            label="Bought this month"
            value={s.monthPurchases}
            currency={currency}
            direction="down"
            icon={<Receipt className="h-4 w-4" aria-hidden />}
            tone="warn"
            hint={`${qty(s.todayPurchaseCount)} purchase${
              s.todayPurchaseCount === 1 ? "" : "s"
            } today`}
            onClick={() => navigate("/purchases")}
          />
        </div>

        {/* ---- pending approvals (admins) -------------------------------- */}
        <CloudApprovalCard />

        {/* ---- today ----------------------------------------------------- */}
        <SectionCard
          title="Today"
          subtitle="What has already been traded"
          icon={<ArrowRight className="h-4 w-4" aria-hidden />}
          bodyClassName="p-3"
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              dense
              label="Sales value"
              value={money(s.todaySales, currency)}
              tone="profit"
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              hint={`${qty(s.todaySaleCount)} sale${s.todaySaleCount === 1 ? "" : "s"}`}
            />
            <StatCard
              dense
              label="Gross profit"
              value={money(s.todayProfit, currency)}
              tone={s.todayProfit >= 0 ? "profit" : "danger"}
              icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
              hint={s.todaySales > 0 ? percent((s.todayProfit / s.todaySales) * 100) : "No sales yet"}
            />
            <StatCard
              dense
              label="Purchase value"
              value={money(s.todayPurchases, currency)}
              tone="warn"
              icon={<Receipt className="h-4 w-4" aria-hidden />}
              hint={`${qty(s.todayPurchaseCount)} purchase${
                s.todayPurchaseCount === 1 ? "" : "s"
              }`}
            />
            <StatCard
              dense
              label="Needs attention"
              value={qty(s.lowStockCount + s.outOfStockCount)}
              tone={s.outOfStockCount > 0 ? "danger" : s.lowStockCount > 0 ? "warn" : "neutral"}
              icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
              hint={`${qty(s.outOfStockCount)} out of stock, ${qty(s.lowStockCount)} low`}
              onClick={() => navigate("/inventory?status=low")}
            />
          </div>
        </SectionCard>

        {/* ---- balances -------------------------------------------------- */}
        <SectionCard
          title="Who owes what"
          subtitle="Derived from every sale, purchase, payment and return"
          icon={<Wallet className="h-4 w-4" aria-hidden />}
          bodyClassName="grid grid-cols-1 gap-3 p-3 md:grid-cols-2"
        >
          <OwedPanel
            title="Owed to us"
            rows={[
              { label: "Buyer balances", value: s.buyerReceivable, route: "/buyers", icon: Users, tone: "warn" },
              { label: "Lent to coworkers", value: s.coworkerReceivable, route: "/coworker-ledger", icon: UsersRound, tone: "warn" },
            ]}
            currency={currency}
          />
          <OwedPanel
            title="Owed by us"
            rows={[
              { label: "Seller balances", value: s.sellerPayable, route: "/sellers", icon: Building2, tone: "brand" },
              { label: "Borrowed from coworkers", value: s.coworkerPayable, route: "/coworker-ledger", icon: HandCoins, tone: "brand" },
            ]}
            currency={currency}
          />
        </SectionCard>

        {/* ---- stock mix -------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SectionCard
            title="Stock by generation"
            subtitle={`${qty(s.totalStock)} units across ${qty(s.totalSkus)} SKUs`}
            icon={<BarChart3 className="h-4 w-4" aria-hidden />}
            actions={
              <Link to="/inventory" className="btn btn-ghost btn-xs">
                Open inventory
              </Link>
            }
            bodyClassName="p-3"
          >
            <ShareBars
              rows={s.inventoryByGeneration.map((x) => ({ label: x.label, value: x.value }))}
              onSelect={(label) => navigate(`/inventory?generation=${encodeURIComponent(label)}`)}
            />
          </SectionCard>

          <SectionCard
            title="Stock by category"
            subtitle="Where the money is tied up"
            icon={<BarChart3 className="h-4 w-4" aria-hidden />}
            bodyClassName="p-3"
          >
            <ShareBars
              rows={s.inventoryByCategory.map((x) => ({ label: x.label, value: x.value }))}
              onSelect={(label) => navigate(`/inventory?category=${encodeURIComponent(label)}`)}
            />
          </SectionCard>
        </div>

        {/* ---- low stock + shortcuts -------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Running low"
            subtitle={
              s.lowStockItems.length === 0
                ? "Everything is above its minimum"
                : `${qty(s.lowStockItems.length)} SKU${
                    s.lowStockItems.length === 1 ? "" : "s"
                  } at or below the reorder level`
            }
            icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
            className="xl:col-span-2"
            actions={
              <Link to="/inventory?status=low" className="btn btn-ghost btn-xs">
                See all
              </Link>
            }
            bodyClassName="overflow-x-auto"
          >
            {s.lowStockItems.length === 0 ? (
              <EmptyState
                compact
                icon={<Package className="h-5 w-5" aria-hidden />}
                title="Stock levels are healthy"
                message="No SKU has fallen to its reorder point. Buy RAM to top up when you need to."
                action={
                  <Button size="sm" variant="profit" onClick={onBuy}>
                    <PlusCircle className="h-4 w-4" aria-hidden />
                    Buy RAM
                  </Button>
                }
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th className="text-right">In stock</th>
                    <th className="text-right">Minimum</th>
                    <th className="text-right">Cost to reorder</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.lowStockItems.slice(0, 8).map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/inventory/${item.id}`)}
                    >
                      <td>
                        <p className="truncate font-mono text-xs font-bold text-brand-800">
                          {item.sku}
                        </p>
                        <p className="truncate text-2xs text-muted">
                          {item.generation} {item.category} {item.capacity} {item.speed}
                        </p>
                      </td>
                      <td className="num">
                        <span
                          className={cn(
                            "font-bold",
                            item.quantity <= 0 ? "text-danger-700" : "text-warn-700",
                          )}
                        >
                          {qty(item.quantity)}
                        </span>
                      </td>
                      <td className="num text-muted">{qty(item.minimumStock)}</td>
                      <td className="num text-ink">
                        {money(
                          Math.max(0, item.minimumStock - item.quantity) * item.averageCost,
                          currency,
                        )}
                      </td>
                      <td className="text-right">
                        <IconButton label={`Buy more ${item.sku}`} tone="brand" onClick={onBuy}>
                          <ShoppingCart className="h-4 w-4" aria-hidden />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>

          <SectionCard
            title="Directory"
            subtitle="People on the books"
            icon={<Users className="h-4 w-4" aria-hidden />}
            bodyClassName="space-y-2 p-3"
          >
            <ShortcutTile
              label="Buyers"
              detail={`${qty(s.buyerCount)} on the books`}
              icon={Users}
              onClick={() => navigate("/buyers")}
            />
            <ShortcutTile
              label="Sellers"
              detail={`${qty(s.sellerCount)} suppliers`}
              icon={Building2}
              onClick={() => navigate("/sellers")}
            />
            <ShortcutTile
              label="Coworker ledger"
              detail={`Net ${money(s.coworkerReceivable - s.coworkerPayable, currency)}`}
              icon={UsersRound}
              onClick={() => navigate("/coworker-ledger")}
            />
            <ShortcutTile
              label="Payments"
              detail="Every dirham in and out"
              icon={CreditCard}
              onClick={() => navigate("/payments")}
            />
            <ShortcutTile
              label="Reports"
              detail="Nine ready-made reports"
              icon={BarChart3}
              onClick={() => navigate("/reports")}
            />
          </SectionCard>
        </div>

        {/* ---- top buyers / sellers --------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <RankList
            title="Top buyers"
            subtitle="By value purchased"
            rows={s.topBuyers}
            currency={currency}
            onSelect={(label) => navigate(`/buyers?q=${encodeURIComponent(label)}`)}
            emptyMessage="No sales recorded yet. Complete a sale and buyers are ranked here."
          />
          <RankList
            title="Top suppliers"
            subtitle="By value purchased"
            rows={s.topSellers}
            currency={currency}
            onSelect={(label) => navigate(`/sellers?q=${encodeURIComponent(label)}`)}
            emptyMessage="No purchases recorded yet. Record a purchase and suppliers are ranked here."
          />
        </div>

        {/* ---- recent activity -------------------------------------------- */}
        <SectionCard
          title="Recent activity"
          subtitle="The last documents and movements"
          icon={<ArrowRight className="h-4 w-4" aria-hidden />}
          actions={
            <div className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
              {FEED_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFeed(tab.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-2xs font-bold transition-colors",
                    feed === tab.key
                      ? "bg-surface text-brand-700 shadow-[var(--shadow-card)]"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          }
          bodyClassName="overflow-x-auto"
        >
          {feed === "movements" ? (
            <DataTable<StockMovement>
              columns={[
                {
                  key: "when",
                  header: "When",
                  width: "7rem",
                  cell: (m) => (
                    <span className="whitespace-nowrap text-xs text-muted">
                      {relativeDay(m.createdAt)}
                    </span>
                  ),
                },
                {
                  key: "sku",
                  header: "Item",
                  cell: (m) => (
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-bold text-brand-800">
                        {m.sku}
                      </div>
                      {m.referenceNumber && (
                        <div className="truncate text-2xs text-muted">{m.referenceNumber}</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: "type",
                  header: "Movement",
                  cell: (m) => (
                    <StatusBadge tone={m.quantityChange >= 0 ? "profit" : "danger"}>
                      {movementLabel(m.movementType)}
                    </StatusBadge>
                  ),
                },
                {
                  key: "change",
                  header: "Change",
                  align: "right",
                  numeric: true,
                  cell: (m) => (
                    <span className={m.quantityChange >= 0 ? "text-profit-700" : "text-danger-700"}>
                      {m.quantityChange >= 0 ? "+" : ""}
                      {qty(m.quantityChange)}
                    </span>
                  ),
                },
                {
                  key: "stock",
                  header: "Stock",
                  align: "right",
                  numeric: true,
                  cell: (m) => (
                    <span className="whitespace-nowrap text-muted">
                      {qty(m.previousStock)} &rarr;{" "}
                      <span className="font-bold text-ink">{qty(m.newStock)}</span>
                    </span>
                  ),
                },
              ]}
              rows={s.recentMovements}
              rowKey={(m) => m.id}
              onRowClick={(m) => navigate(`/inventory/${m.ramItemId}`)}
              empty={
                <EmptyState
                  compact
                  icon={<Package className="h-5 w-5" aria-hidden />}
                  title="No stock movements yet"
                  message="Buying, selling, returning or adjusting stock all appear here."
                />
              }
            />
          ) : feed === "sales" ? (
            <DataTable
              columns={[
                { key: "number", header: "Sale", cell: (r) => <DocNumber>{r.saleNumber}</DocNumber>, hideBelow: "sm" },
                { key: "who", header: "Buyer", cell: (r) => r.buyerName },
                { key: "date", header: "Date", cell: (r) => <DocDate value={r.saleDate} />, hideBelow: "md" },
                { key: "total", header: "Total", align: "right", numeric: true, cell: (r) => <Money value={r.total} /> },
                {
                  key: "profit",
                  header: "Profit",
                  align: "right",
                  numeric: true,
                  cell: (r) => (
                    <span className={r.grossProfit >= 0 ? "text-profit-700" : "text-danger-700"}>
                      {money(r.grossProfit, currency)}
                    </span>
                  ),
                },
              ]}
              rows={s.recentSales}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/sales/${r.id}`)}
              empty={
                <EmptyState
                  compact
                  icon={<TrendingUp className="h-5 w-5" aria-hidden />}
                  title="No sales yet"
                  message="Sell RAM to record your first sale. Revenue, cost and profit are worked out for you."
                  action={
                    <Button size="sm" variant="danger" onClick={onSell}>
                      <MinusCircle className="h-4 w-4" aria-hidden />
                      Sell RAM
                    </Button>
                  }
                />
              }
            />
          ) : feed === "purchases" ? (
            <DataTable
              columns={[
                { key: "number", header: "Purchase", cell: (r) => <DocNumber>{r.purchaseNumber}</DocNumber>, hideBelow: "sm" },
                { key: "who", header: "Seller", cell: (r) => r.sellerName },
                { key: "date", header: "Date", cell: (r) => <DocDate value={r.purchaseDate} />, hideBelow: "md" },
                { key: "units", header: "Units", align: "right", numeric: true, cell: (r) => qty(r.unitCount) },
                { key: "total", header: "Total", align: "right", numeric: true, cell: (r) => <Money value={r.total} /> },
                {
                  key: "due",
                  header: "Due",
                  align: "right",
                  numeric: true,
                  cell: (r) => (
                    <span className={r.remaining > 0.005 ? "text-warn-700" : "text-profit-700"}>
                      {money(r.remaining, currency)}
                    </span>
                  ),
                },
              ]}
              rows={s.recentPurchases}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/purchases/${r.id}`)}
              empty={
                <EmptyState
                  compact
                  icon={<Receipt className="h-5 w-5" aria-hidden />}
                  title="No purchases yet"
                  message="Buy RAM to record your first purchase and raise your stock."
                  action={
                    <Button size="sm" variant="profit" onClick={onBuy}>
                      <PlusCircle className="h-4 w-4" aria-hidden />
                      Buy RAM
                    </Button>
                  }
                />
              }
            />
          ) : (
            <DataTable
              columns={[
                { key: "id", header: "Payment", cell: (r) => <DocNumber>{r.paymentId}</DocNumber>, hideBelow: "sm" },
                { key: "type", header: "Type", cell: (r) => paymentLabel(r.paymentType), hideBelow: "md" },
                { key: "who", header: "Person", cell: (r) => r.personName },
                { key: "date", header: "Date", cell: (r) => <DocDate value={r.paymentDate} />, hideBelow: "md" },
                {
                  key: "amount",
                  header: "Amount",
                  align: "right",
                  numeric: true,
                  cell: (r) => <Money value={r.amount} />,
                },
              ]}
              rows={s.recentPayments}
              rowKey={(r) => r.id}
              onRowClick={() => navigate("/payments")}
              empty={
                <EmptyState
                  compact
                  icon={<CreditCard className="h-5 w-5" aria-hidden />}
                  title="No payments recorded"
                  message="Receiving money from a buyer or paying a supplier will appear here."
                />
              }
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ================================================================ helpers === */

function DocNumber({ children }: { children: string }) {
  return <span className="font-mono text-xs font-bold text-brand-800">{children}</span>;
}

function DocDate({ value }: { value: string }) {
  return <span className="whitespace-nowrap text-xs text-muted">{displayDate(value)}</span>;
}

function Money({ value }: { value: number }) {
  const currency = useCurrency();
  return <span className="font-semibold text-ink">{money(value, currency)}</span>;
}

interface OwedRow {
  label: string;
  value: number;
  route: string;
  icon: typeof Users;
  tone?: "warn" | "brand";
}

function OwedPanel({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: OwedRow[];
  currency: string;
}) {
  const navigate = useNavigate();
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-2xs font-bold tracking-wider text-muted uppercase">{title}</p>
        <p className={cn("tnum text-lg font-bold", total > 0.005 ? "text-ink" : "text-faint")}>
          {money(total, currency)}
        </p>
      </div>
      <ul className="space-y-1">
        {rows.map((r) => {
          const RowIcon = r.icon;
          return (
            <li key={r.label}>
              <button
                type="button"
                onClick={() => navigate(r.route)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-canvas"
              >
                <RowIcon className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.label}</span>
                <span
                  className={cn(
                    "tnum shrink-0 text-xs font-bold",
                    r.value > 0.005 ? "text-ink" : "text-faint",
                  )}
                >
                  {r.value > 0.005 ? money(r.value, currency) : "Settled"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const BAR_CLASSES = [
  "bg-brand-600",
  "bg-profit-500",
  "bg-warn-500",
  "bg-navy-500",
  "bg-info-500",
];

/** Horizontal proportion bars - legible at 1280px without a chart library. */
function ShareBars({
  rows,
  onSelect,
}: {
  rows: { label: string; value: number }[];
  onSelect?: (label: string) => void;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Package className="h-5 w-5" aria-hidden />}
        title="No stock to break down"
        message="Buy RAM and the generation and category split appears here."
      />
    );
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => {
        const share = total > 0 ? (r.value / total) * 100 : 0;
        return (
          <li key={r.label}>
            <button
              type="button"
              onClick={() => onSelect?.(r.label)}
              disabled={!onSelect}
              className="w-full text-left disabled:cursor-default"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold text-ink">{r.label}</span>
                <span className="tnum shrink-0 text-2xs text-muted">
                  {qty(r.value)} units &middot; {share.toFixed(1)}%
                </span>
              </span>
              <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-canvas">
                <span
                  className={cn("block h-full rounded-full", BAR_CLASSES[i % BAR_CLASSES.length])}
                  style={{ width: `${Math.max(2, share)}%` }}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ShortcutTile({
  label,
  detail,
  icon: Icon,
  onClick,
}: {
  label: string;
  detail: string;
  icon: typeof Users;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{label}</span>
        <span className="block truncate text-2xs text-muted">{detail}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
    </button>
  );
}

interface RankRow {
  label: string;
  value: number;
  count: number;
}

function RankList({
  title,
  subtitle,
  rows,
  currency,
  onSelect,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  rows: RankRow[];
  currency: string;
  onSelect: (label: string) => void;
  emptyMessage: string;
}) {
  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      icon={<TrendingUp className="h-4 w-4" aria-hidden />}
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <EmptyState compact title="Nothing ranked yet" message={emptyMessage} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.label}>
              <button
                type="button"
                onClick={() => onSelect(r.label)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-50"
              >
                <span
                  className={cn(
                    "tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-2xs font-bold",
                    i === 0
                      ? "bg-brand-600 text-white"
                      : i === 1
                        ? "bg-brand-100 text-brand-700"
                        : i === 2
                          ? "bg-brand-50 text-brand-700"
                          : "bg-canvas text-faint",
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">{r.label}</span>
                  <span className="tnum block text-2xs text-muted">
                    {qty(r.count)} transaction{r.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="tnum shrink-0 text-sm font-bold text-ink">
                  {money(r.value, currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------- admin approval banner ---- */

function CloudApprovalCard() {
  const { profile, pendingCounts } = useAuth();
  if (!isAdmin(profile)) return null;
  const total = pendingCounts.sales + pendingCounts.purchases;
  if (total === 0) return null;
  return (
    <Link
      to="/approvals"
      className="group block rounded-xl border border-warn-500/40 bg-warn-50 p-4 transition-colors hover:bg-warn-100"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warn-600 text-white">
            <ShieldAlert className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold text-ink">APPROVALS ({total})</p>
            <p className="text-xs text-muted">
              {pendingCounts.sales} sale{pendingCounts.sales === 1 ? "" : "s"} ·{" "}
              {pendingCounts.purchases} purchase{pendingCounts.purchases === 1 ? "" : "s"} waiting
              for a decision
            </p>
          </div>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-warn-600 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
    </Link>
  );
}
