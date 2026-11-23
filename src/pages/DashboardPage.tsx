import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  ClipboardCheck,
  Clock,
  Database,
  Plus,
  ShoppingBag,
  Sparkles,
  Warehouse,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, KpiCard, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { seedSouthIndianFoodWorkspace } from '../services/erpService';
import type {
  CompanySetting,
  ErpModuleId,
  GstInvoice,
  InventoryBatch,
  PackagingMaterial,
  Product,
  ProductionRun,
  PurchaseRequest,
  QcInspection,
  RawMaterial,
  SalesOrder,
} from '../types/erp';
import { roundQty } from '../utils/erpEngine';
import { formatPaisaToInr } from '../utils/money';

interface DashboardPageProps {
  company: CompanySetting | null;
  orders: SalesOrder[];
  invoices: GstInvoice[];
  products: Product[];
  rawMaterials: RawMaterial[];
  packagingMaterials: PackagingMaterial[];
  productionRuns: ProductionRun[];
  batches?: InventoryBatch[];
  inventory_batches?: InventoryBatch[];
  qcInspections?: QcInspection[];
  purchaseRequests?: PurchaseRequest[];
  onNavigate: (module: ErpModuleId) => void;
}

export function DashboardPage({
  company,
  orders,
  invoices,
  products,
  rawMaterials,
  packagingMaterials,
  productionRuns,
  batches = [],
  inventory_batches,
  qcInspections = [],
  purchaseRequests = [],
  onNavigate,
}: DashboardPageProps) {
  const effectiveBatches = inventory_batches ?? batches;
  const { profile, canViewModule } = useAuth();
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(todayIso);

  const metrics = useMemo(() => {
    const todaysOrders = orders.filter(
      (o) => o.orderDate === todayIso && o.status !== 'cancelled' && o.status !== 'rejected'
    );
    const pendingOrders = orders.filter((o) =>
      ['pending', 'awaiting_approval', 'approved', 'confirmed', 'in_production', 'ready_for_dispatch'].includes(
        o.status
      )
    );
    const awaitingApprovalCount = orders.filter((o) => o.status === 'awaiting_approval').length;

    const totalSalesPaisa =
      invoices.length > 0
        ? invoices.reduce((sum, inv) => sum + inv.totalAmountPaisa, 0)
        : orders
            .filter((o) => o.status !== 'cancelled' && o.status !== 'rejected')
            .reduce((sum, o) => sum + o.totalAmountPaisa, 0);

    const rawStockValuePaisa = rawMaterials.reduce(
      (sum, rm) => sum + Math.round(rm.currentStock * rm.costPerUnitPaisa),
      0
    );
    const rawTotalKg = roundQty(rawMaterials.reduce((sum, rm) => sum + rm.currentStock, 0));

    const fgStockValuePaisa = products.reduce(
      (sum, p) => sum + Math.round(p.currentStock * p.standardCostPaisa),
      0
    );
    const fgTotalUnits = roundQty(products.reduce((sum, p) => sum + p.currentStock, 0));

    const completedRuns = productionRuns.filter((r) => r.status === 'completed');
    const productionCompletedQty = completedRuns.reduce((sum, r) => sum + r.actualOutputQty, 0);
    const productionWastageQty = completedRuns.reduce((sum, r) => sum + r.wastageQty, 0);
    const totalAttemptedQty = productionCompletedQty + productionWastageQty;
    const wastageRatePct =
      totalAttemptedQty > 0
        ? ((productionWastageQty / totalAttemptedQty) * 100).toFixed(1)
        : '0.0';

    const outstandingPaisa = invoices.reduce((sum, inv) => sum + inv.balanceDuePaisa, 0);

    const expiringBatchAlerts = effectiveBatches
      .filter((b) => b.remainingQty > 0 && Boolean(b.expiryDate))
      .map((b) => {
        const expMs = Date.parse(b.expiryDate);
        const daysRemaining = Number.isNaN(expMs) ? 9999 : Math.ceil((expMs - todayMs) / 86400000);
        return {
          ...b,
          daysRemaining,
          valueAtRiskPaisa: Math.round(b.remainingQty * (b.unitCostPaisa || 0)),
        };
      })
      .filter((b) => b.daysRemaining <= 30)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const nearExpiryCount = expiringBatchAlerts.length;
    const expiredBatchCount = expiringBatchAlerts.filter((b) => b.daysRemaining < 0).length;
    const critical7dBatchCount = expiringBatchAlerts.filter(
      (b) => b.daysRemaining >= 0 && b.daysRemaining <= 7
    ).length;
    const warning30dBatchCount = expiringBatchAlerts.filter(
      (b) => b.daysRemaining > 7 && b.daysRemaining <= 30
    ).length;
    const expiryAtRiskValuePaisa = expiringBatchAlerts.reduce(
      (sum, b) => sum + b.valueAtRiskPaisa,
      0
    );

    const pendingQcCount = effectiveBatches.filter(
      (b) => b.remainingQty > 0 && (b.qcStatus === 'pending' || b.qcStatus === 'hold')
    ).length;

    const pendingPrCount = purchaseRequests.filter((pr) => pr.status === 'pending').length;

    const lowStockAlerts = [
      ...rawMaterials
        .filter((m) => m.currentStock <= m.reorderLevel)
        .map((m) => ({
          id: m.id,
          type: 'Raw Material',
          code: m.code,
          name: m.name,
          current: m.currentStock,
          reorder: m.reorderLevel,
          unit: m.unit,
          targetModule: 'raw_materials' as ErpModuleId,
        })),
      ...packagingMaterials
        .filter((p) => p.currentStock <= p.reorderLevel)
        .map((p) => ({
          id: p.id,
          type: 'Packaging',
          code: p.code,
          name: p.name,
          current: p.currentStock,
          reorder: p.reorderLevel,
          unit: p.unit,
          targetModule: 'packaging' as ErpModuleId,
        })),
      ...products
        .filter((p) => p.currentStock <= p.reorderLevel)
        .map((p) => ({
          id: p.id,
          type: 'Finished SKU',
          code: p.sku,
          name: p.name,
          current: p.currentStock,
          reorder: p.reorderLevel,
          unit: p.unit,
          targetModule: 'products' as ErpModuleId,
        })),
    ];

    return {
      todaysOrdersCount: todaysOrders.length,
      todaysOrdersPaisa: todaysOrders.reduce((s, o) => s + o.totalAmountPaisa, 0),
      totalSalesPaisa,
      pendingOrdersCount: pendingOrders.length,
      pendingOrdersPaisa: pendingOrders.reduce((s, o) => s + o.totalAmountPaisa, 0),
      awaitingApprovalCount,
      rawStockValuePaisa,
      rawTotalKg,
      fgStockValuePaisa,
      fgTotalUnits,
      productionCompletedQty,
      completedBatchesCount: completedRuns.length,
      productionWastageQty,
      wastageRatePct,
      outstandingPaisa,
      lowStockAlerts,
      nearExpiryCount,
      expiredBatchCount,
      critical7dBatchCount,
      warning30dBatchCount,
      expiryAtRiskValuePaisa,
      expiringBatchAlerts,
      pendingQcCount,
      pendingPrCount,
    };
  }, [
    orders,
    invoices,
    products,
    rawMaterials,
    packagingMaterials,
    productionRuns,
    effectiveBatches,
    purchaseRequests,
    todayIso,
    todayMs,
  ]);

  const monthlySalesChartData = useMemo(() => {
    const map = new Map<string, { month: string; salesInr: number; taxInr: number }>();
    const source =
      invoices.length > 0
        ? invoices
        : orders.filter((o) => o.status !== 'cancelled' && o.status !== 'rejected');
    source.forEach((doc) => {
      const dateStr = 'invoiceDate' in doc ? doc.invoiceDate : doc.orderDate;
      const monthKey = (dateStr || todayIso).slice(0, 7);
      const existing = map.get(monthKey) || { month: monthKey, salesInr: 0, taxInr: 0 };
      existing.salesInr += Math.round(doc.subtotalPaisa / 100);
      existing.taxInr += Math.round(doc.totalTaxPaisa / 100);
      map.set(monthKey, existing);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [invoices, orders, todayIso]);

  const productionPerformanceData = useMemo(() => {
    return productionRuns
      .slice(0, 8)
      .reverse()
      .map((r) => ({
        batch: r.batchNumber.replace('KHF-BCH-', ''),
        planned: r.plannedQty,
        actual: r.actualOutputQty,
        wastage: r.wastageQty,
      }));
  }, [productionRuns]);

  const isWorkspaceEmpty =
    products.length === 0 && rawMaterials.length === 0 && orders.length === 0;

  const handleSeedWorkspace = async () => {
    if (!profile) return;
    setSeeding(true);
    setSeedError(null);
    try {
      await seedSouthIndianFoodWorkspace({
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
      });
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Failed to initialize sample data.');
    } finally {
      setSeeding(false);
    }
  };

  if (isWorkspaceEmpty) {
    return (
      <div>
        <PageHeader
          title="Executive Operations Dashboard"
          subtitle="Real-time overview of orders, GST billing, manufacturing, quality control, and receivables."
        />
        {seedError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {seedError}
          </div>
        )}
        <EmptyState
          title="No manufacturing or sales records found yet"
          description={
            profile?.role === 'owner'
              ? 'Initialize the Kaveri Heritage Foods dataset (South Indian packaged batters, spice blends, millet mixes, BOMs, suppliers, batches, QC logs, and customer sales orders) or start adding records manually.'
              : 'Ask the Workspace Owner to initialize company masters, products, and raw materials.'
          }
          action={
            profile?.role === 'owner' ? (
              <button
                type="button"
                disabled={seeding}
                onClick={handleSeedWorkspace}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Database className="w-4 h-4" />
                <span>
                  {seeding
                    ? 'Initializing Firestore Workspace...'
                    : 'Initialize South Indian Food Manufacturing Workspace'}
                </span>
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Executive Operations Dashboard"
        subtitle={`${company?.legalName || 'Kaveri Heritage Foods Pvt. Ltd.'} · GSTIN ${company?.gstin || '33AABCK4821M1Z5'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {canViewModule('ai_insights') && (
              <button
                type="button"
                onClick={() => onNavigate('ai_insights')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#0F294A] bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 text-[#1A6FD4]" />
                <span>AI Insights</span>
              </button>
            )}
            {canViewModule('sales_orders') && profile?.role !== 'accountant' && (
              <button
                type="button"
                onClick={() => onNavigate('sales_orders')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>New Sales Order</span>
              </button>
            )}
            {canViewModule('reports') && (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Audit Reports</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            )}
          </div>
        }
      />

      {/* Pending Approval Orders Banner */}
      {metrics.awaitingApprovalCount > 0 && canViewModule('sales_orders') && (
        <div className="mb-5 p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <div className="text-sm text-amber-900">
              <strong>{metrics.awaitingApprovalCount} Pending Approval Order(s)</strong> awaiting
              management review and BOM / finished stock verification.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('sales_orders')}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer whitespace-nowrap"
          >
            Review & Approve Orders
          </button>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Today's Orders"
          value={`${metrics.todaysOrdersCount}`}
          hint={`${formatPaisaToInr(metrics.todaysOrdersPaisa)} booked today`}
          tone="navy"
        />
        <KpiCard
          label="Total Sales (Incl. GST)"
          value={formatPaisaToInr(metrics.totalSalesPaisa)}
          hint={`${invoices.length} GST invoices issued`}
          tone="navy"
        />
        <KpiCard
          label="Pending Orders"
          value={`${metrics.pendingOrdersCount}`}
          hint={`${formatPaisaToInr(metrics.pendingOrdersPaisa)} in pipeline`}
          tone={metrics.pendingOrdersCount > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Outstanding Payments"
          value={formatPaisaToInr(metrics.outstandingPaisa)}
          hint="Receivables due from customers"
          tone={metrics.outstandingPaisa > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Raw Material Stock"
          value={formatPaisaToInr(metrics.rawStockValuePaisa)}
          hint={`${metrics.rawTotalKg.toLocaleString('en-IN')} total units across ${rawMaterials.length} items`}
        />
        <KpiCard
          label="Finished Goods Stock"
          value={formatPaisaToInr(metrics.fgStockValuePaisa)}
          hint={`${metrics.fgTotalUnits.toLocaleString('en-IN')} packed units across ${products.length} SKUs`}
        />
        <KpiCard
          label="Production Completed"
          value={`${metrics.productionCompletedQty.toLocaleString('en-IN')} units`}
          hint={`${metrics.completedBatchesCount} batches completed`}
          tone="success"
        />
        <KpiCard
          label="Production Wastage"
          value={`${metrics.productionWastageQty.toLocaleString('en-IN')} units`}
          hint={`${metrics.wastageRatePct}% process wastage rate`}
          tone={Number(metrics.wastageRatePct) > 5 ? 'danger' : 'warning'}
        />
      </div>

      {/* Operational Health Strip (Food Traceability, QC & Procurement) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <button
          type="button"
          onClick={() => canViewModule('inventory') && onNavigate('inventory')}
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">FEFO Near-Expiry Lots</p>
              <p className="text-lg font-bold font-mono text-slate-900">
                {metrics.nearExpiryCount} batches
              </p>
            </div>
          </div>
          <Warehouse className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => canViewModule('quality_control') && onNavigate('quality_control')}
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-[#1A6FD4] flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Pending QC Lots / Reports</p>
              <p className="text-lg font-bold font-mono text-slate-900">
                {metrics.pendingQcCount} queued · {qcInspections.length} logged
              </p>
            </div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => canViewModule('purchases') && onNavigate('purchases')}
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-[#0F294A] flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Open Purchase Requests (PR)</p>
              <p className="text-lg font-bold font-mono text-slate-900">
                {metrics.pendingPrCount} awaiting PO
              </p>
            </div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">Monthly Sales & GST Trend</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Taxable sales value vs GST collected (INR)
            </p>
          </div>
          <div className="h-72 w-full">
            {monthlySalesChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                No sales data available for chart.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySalesChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip
                    formatter={(value: unknown) => `₹${Number(value).toLocaleString('en-IN')}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="salesInr"
                    name="Taxable Sales (INR)"
                    fill="#0F294A"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="taxInr"
                    name="GST Tax (INR)"
                    fill="#1A6FD4"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">Production Performance</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Planned batch target vs actual good output & wastage units
            </p>
          </div>
          <div className="h-72 w-full">
            {productionPerformanceData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                No production batches recorded yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productionPerformanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="batch" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="planned"
                    name="Planned Qty"
                    fill="#94A3B8"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="actual"
                    name="Actual Output"
                    fill="#0F294A"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar dataKey="wastage" name="Wastage" fill="#DC2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* 30-Day Inventory Batch Expiry Alert Summary */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Inventory Batch Expiry Alert Summary (Next 30 Days)
              </h2>
              <p className="text-xs text-slate-500">
                FEFO priority monitor across active raw materials, packaging, and finished food lots
              </p>
            </div>
          </div>
          {canViewModule('inventory') && (
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F294A] bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
            >
              <span>Open Batch &amp; FEFO Hub</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-slate-50/70 border-b border-slate-200">
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-medium text-slate-500">Expired Lots</p>
            <p
              className={`text-lg font-bold font-mono mt-0.5 ${
                metrics.expiredBatchCount > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {metrics.expiredBatchCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-medium text-slate-500">Critical (&le; 7 Days)</p>
            <p
              className={`text-lg font-bold font-mono mt-0.5 ${
                metrics.critical7dBatchCount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {metrics.critical7dBatchCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-medium text-slate-500">Near Expiry (8–30 Days)</p>
            <p
              className={`text-lg font-bold font-mono mt-0.5 ${
                metrics.warning30dBatchCount > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {metrics.warning30dBatchCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-medium text-slate-500">Inventory Value at Risk</p>
            <p className="text-lg font-bold font-mono text-slate-900 mt-0.5">
              {formatPaisaToInr(metrics.expiryAtRiskValuePaisa)}
            </p>
          </div>
        </div>

        {metrics.expiringBatchAlerts.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">
            No active inventory batches are expired or expiring within the next 30 days.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Batch / Lot #</th>
                  <th className="text-left font-medium px-4 py-2.5">Item &amp; Type</th>
                  <th className="text-right font-medium px-4 py-2.5">Remaining Qty</th>
                  <th className="text-left font-medium px-4 py-2.5">QC Status</th>
                  <th className="text-left font-medium px-4 py-2.5">Expiry Date</th>
                  <th className="text-right font-medium px-4 py-2.5">Urgency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.expiringBatchAlerts.slice(0, 6).map((batch) => {
                  const isExpired = batch.daysRemaining < 0;
                  const isCritical = batch.daysRemaining >= 0 && batch.daysRemaining <= 7;
                  return (
                    <tr
                      key={batch.id}
                      onClick={() => canViewModule('inventory') && onNavigate('inventory')}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                        {batch.batchNumber}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{batch.itemName}</p>
                        <p className="text-xs text-slate-500">
                          {batch.itemCode} · {batch.itemType.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                        {batch.remainingQty} {batch.unit}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusTag status={batch.qcStatus} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">{batch.expiryDate}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-mono font-semibold rounded border ${
                            isExpired || isCritical
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {isExpired
                            ? `Expired (${Math.abs(batch.daysRemaining)}d ago)`
                            : batch.daysRemaining === 0
                              ? 'Expires Today'
                              : `${batch.daysRemaining}d left`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {metrics.expiringBatchAlerts.length > 6 && (
              <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-600 flex items-center justify-between">
                <span>
                  Showing 6 of {metrics.expiringBatchAlerts.length} batches expiring within 30 days.
                </span>
                {canViewModule('inventory') && (
                  <button
                    type="button"
                    onClick={() => onNavigate('inventory')}
                    className="font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    View all in Batch Hub
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Low-Stock Alerts & Recent Orders */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h2 className="text-base font-semibold text-slate-900">Low-Stock Alerts</h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {metrics.lowStockAlerts.length} items below reorder level
            </span>
          </div>
          {metrics.lowStockAlerts.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              All raw materials, packaging items, and finished SKUs are above reorder levels.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Item</th>
                    <th className="text-left font-medium px-4 py-2.5">Category</th>
                    <th className="text-right font-medium px-4 py-2.5">Stock</th>
                    <th className="text-right font-medium px-4 py-2.5">Reorder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {metrics.lowStockAlerts.map((alert) => (
                    <tr
                      key={alert.id}
                      onClick={() =>
                        canViewModule(alert.targetModule) && onNavigate(alert.targetModule)
                      }
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{alert.name}</p>
                        <p className="text-xs font-mono text-slate-500">{alert.code}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{alert.type}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-red-700 font-semibold">
                        {alert.current} {alert.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {alert.reorder} {alert.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Recent Sales Orders</h2>
            {canViewModule('sales_orders') && (
              <button
                type="button"
                onClick={() => onNavigate('sales_orders')}
                className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
              >
                View All Orders
              </button>
            )}
          </div>
          {orders.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No sales orders recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Order</th>
                    <th className="text-left font-medium px-4 py-2.5">Customer</th>
                    <th className="text-right font-medium px-4 py-2.5">Amount</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.slice(0, 6).map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-mono font-medium text-slate-900">{ord.orderNumber}</p>
                        <p className="text-xs text-slate-500">{ord.orderDate}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{ord.customerName}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatPaisaToInr(ord.totalAmountPaisa)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusTag status={ord.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
