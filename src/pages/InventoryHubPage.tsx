import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Factory, GitBranch, Package, Search, ShieldAlert } from 'lucide-react';
import { EmptyState, KpiCard, PageHeader, StatusTag } from '../components/ErpUi';
import type {
  Dispatch,
  InventoryBatch,
  PackagingMaterial,
  Product,
  ProductionRun,
  RawMaterial,
  SalesOrder,
} from '../types/erp';
import { roundQty } from '../utils/erpEngine';
import { formatPaisaToInr } from '../utils/money';

type InventoryTab =
  | 'finished'
  | 'raw'
  | 'packaging'
  | 'wip'
  | 'batches'
  | 'recall';

interface InventoryHubPageProps {
  products: Product[];
  rawMaterials: RawMaterial[];
  packagingMaterials: PackagingMaterial[];
  batches: InventoryBatch[];
  productionRuns: ProductionRun[];
  orders: SalesOrder[];
  dispatches: Dispatch[];
}

export function InventoryHubPage({
  products,
  rawMaterials,
  packagingMaterials,
  batches,
  productionRuns,
  orders,
  dispatches,
}: InventoryHubPageProps) {
  const [tab, setTab] = useState<InventoryTab>('batches');
  const [search, setSearch] = useState('');
  const [recallQuery, setRecallQuery] = useState('');

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(todayIso);

  const metrics = useMemo(() => {
    const fgValue = products.reduce((s, p) => s + Math.round(p.currentStock * p.standardCostPaisa), 0);
    const rmValue = rawMaterials.reduce((s, r) => s + Math.round(r.currentStock * r.costPerUnitPaisa), 0);
    const pkgValue = packagingMaterials.reduce(
      (s, p) => s + Math.round(p.currentStock * p.costPerUnitPaisa),
      0
    );
    const wipRuns = productionRuns.filter((r) => r.status !== 'completed');
    const nearExpiry = batches.filter((b) => {
      if (b.remainingQty <= 0 || !b.expiryDate) return false;
      const days = Math.ceil((Date.parse(b.expiryDate) - todayMs) / 86400000);
      return days <= 30;
    });

    return {
      totalValPaisa: fgValue + rmValue + pkgValue,
      fgValue,
      rmValue,
      pkgValue,
      wipCount: wipRuns.length,
      nearExpiryCount: nearExpiry.length,
      activeLotsCount: batches.filter((b) => b.remainingQty > 0).length,
    };
  }, [products, rawMaterials, packagingMaterials, batches, productionRuns, todayMs]);

  const sortedBatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...batches]
      .filter(
        (b) =>
          !q ||
          b.batchNumber.toLowerCase().includes(q) ||
          b.itemName.toLowerCase().includes(q) ||
          b.itemCode.toLowerCase().includes(q) ||
          (b.supplierName || '').toLowerCase().includes(q)
      )
      .sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'));
  }, [batches, search]);

  const wipRuns = useMemo(
    () => productionRuns.filter((r) => r.status !== 'completed'),
    [productionRuns]
  );

  // Recall Traceability Graph Lookup (Forward & Backward across Raw Lot -> Production -> Finished Batch -> Dispatch/Order)
  const recallResults = useMemo(() => {
    const q = recallQuery.trim().toLowerCase();
    if (!q) return [];

    const matchedBatches = batches.filter(
      (b) =>
        b.batchNumber.toLowerCase().includes(q) ||
        b.lotCode.toLowerCase().includes(q) ||
        b.itemName.toLowerCase().includes(q) ||
        (b.rawBatchRefs || []).some((r) => r.toLowerCase().includes(q))
    );

    return matchedBatches.map((batch) => {
      // Find linked production run
      const linkedRun =
        batch.sourceType === 'production'
          ? productionRuns.find((r) => r.id === batch.sourceId || r.batchNumber === batch.batchNumber)
          : productionRuns.find((r) =>
              r.rawMaterialsConsumed.some((m) => m.batchNumber === batch.batchNumber)
            );

      // Find dispatches & orders carrying this batch (either FG batch directly or via produced batch)
      const targetBatchNo = linkedRun ? linkedRun.batchNumber : batch.batchNumber;
      const impactedDispatches = dispatches.filter((d) =>
        d.dispatchedItems.some((it) =>
          (it.batchAllocations || []).some((al) => al.batchNumber === targetBatchNo)
        )
      );
      const impactedOrders = orders.filter(
        (o) =>
          (o.allocatedBatches || []).some((al) => al.batchNumber === targetBatchNo) ||
          impactedDispatches.some((d) => d.orderId === o.id)
      );

      return {
        batch,
        linkedRun,
        impactedDispatches,
        impactedOrders,
      };
    });
  }, [recallQuery, batches, productionRuns, dispatches, orders]);

  const getExpiryBadge = (expiryDate: string) => {
    if (!expiryDate) return { label: 'No Expiry', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
    const days = Math.ceil((Date.parse(expiryDate) - todayMs) / 86400000);
    if (days < 0) {
      return {
        label: `Expired (${Math.abs(days)}d ago)`,
        cls: 'bg-red-50 text-red-700 border-red-200',
      };
    }
    if (days <= 7) {
      return {
        label: `Critical · ${days}d left`,
        cls: 'bg-red-50 text-red-700 border-red-200',
      };
    }
    if (days <= 30) {
      return {
        label: `Near Expiry · ${days}d left`,
        cls: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    }
    return {
      label: `Fresh · ${days}d left`,
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  };

  const tabs: Array<{ id: InventoryTab; label: string }> = [
    { id: 'batches', label: `Batch Lots & FEFO (${batches.length})` },
    { id: 'finished', label: `Finished Goods (${products.length})` },
    { id: 'raw', label: `Raw Materials (${rawMaterials.length})` },
    { id: 'packaging', label: `Packaging (${packagingMaterials.length})` },
    { id: 'wip', label: `WIP Floor (${wipRuns.length})` },
    { id: 'recall', label: 'Recall Traceability' },
  ];

  return (
    <div>
      <PageHeader
        title="Unified Inventory, FEFO & Food Traceability Hub"
        subtitle="Track Raw, Packaging, WIP, and Finished Goods by Lot/Batch, Expiry Date (FEFO), QC Status, and Recall Chain."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total Inventory Valuation"
          value={formatPaisaToInr(metrics.totalValPaisa)}
          hint={`FG ${formatPaisaToInr(metrics.fgValue)} · RM ${formatPaisaToInr(metrics.rmValue)}`}
          tone="navy"
        />
        <KpiCard
          label="Active Tracked Lots"
          value={`${metrics.activeLotsCount}`}
          hint="Sorted automatically by FEFO priority"
        />
        <KpiCard
          label="WIP Floor Batches"
          value={`${metrics.wipCount}`}
          hint="Currently in mixing, cooking, or packing"
          tone={metrics.wipCount > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Near-Expiry / Expired Lots"
          value={`${metrics.nearExpiryCount}`}
          hint="Within 30-day FEFO alert window"
          tone={metrics.nearExpiryCount > 0 ? 'danger' : 'success'}
        />
      </div>

      {/* Sub-navigation Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                tab === t.id
                  ? 'bg-[#0F294A] text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== 'recall' && (
          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter lot, SKU, or material..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg"
            />
          </div>
        )}
      </div>

      {/* Tab 1: Batch Lots & FEFO */}
      {tab === 'batches' && (
        sortedBatches.length === 0 ? (
          <EmptyState
            title="No inventory lots found"
            description="Lots are automatically registered on Purchase GRN receipts and Production Batch completions."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-blue-50/60 border-b border-slate-200 flex items-center gap-2 text-xs text-blue-900">
              <Clock className="w-4 h-4 text-blue-700 shrink-0" />
              <span>
                <strong>FEFO Enforcement:</strong> Dispatch & production transactions consume batches
                with the earliest <strong>Expiry Date</strong> first and automatically skip expired,
                held, or rejected lots.
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Batch / Lot Code</th>
                    <th className="text-left font-medium px-4 py-3">Item & Type</th>
                    <th className="text-left font-medium px-4 py-3">Mfg / Expiry</th>
                    <th className="text-left font-medium px-4 py-3">Shelf-Life Window</th>
                    <th className="text-right font-medium px-4 py-3">Remaining Qty</th>
                    <th className="text-left font-medium px-4 py-3">QC Status</th>
                    <th className="text-left font-medium px-4 py-3">Trace / Origin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedBatches.map((b) => {
                    const exp = getExpiryBadge(b.expiryDate);
                    return (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-mono font-semibold text-slate-900">{b.batchNumber}</p>
                          <p className="text-xs font-mono text-slate-500">{b.sourceType.toUpperCase()} {b.sourceRef || ''}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{b.itemName}</p>
                          <p className="text-xs font-mono text-slate-500">
                            {b.itemCode} · {b.itemType.replace('_', ' ')}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">
                          <p>Mfg: {b.mfgDate}</p>
                          <p className="font-semibold text-slate-900">Exp: {b.expiryDate}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border ${exp.cls}`}
                          >
                            {exp.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {roundQty(b.remainingQty)} / {b.initialQty} {b.unit}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={b.qcStatus} />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {b.supplierName && <p>Vendor: {b.supplierName}</p>}
                          {b.rawBatchRefs && b.rawBatchRefs.length > 0 && (
                            <p className="font-mono text-[11px] text-slate-500">
                              Inputs: {b.rawBatchRefs.join(', ')}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Tab 2: Finished Goods */}
      {tab === 'finished' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">SKU & Name</th>
                  <th className="text-left font-medium px-4 py-3">Shelf Life & Storage</th>
                  <th className="text-right font-medium px-4 py-3">On Hand</th>
                  <th className="text-right font-medium px-4 py-3">Reorder Level</th>
                  <th className="text-right font-medium px-4 py-3">Valuation (Std Cost)</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products
                  .filter(
                    (p) =>
                      !search.trim() ||
                      p.name.toLowerCase().includes(search.toLowerCase()) ||
                      p.sku.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((p) => {
                    const low = p.currentStock <= p.reorderLevel;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs font-mono text-slate-500">
                            {p.sku} · {p.packSize} · {p.category}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <p>{p.shelfLifeDays ? `${p.shelfLifeDays} days shelf life` : '90 days default'}</p>
                          <p className="text-slate-500">{p.storageTemp || 'Ambient Dry'}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                          {p.currentStock} {p.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                          {p.reorderLevel} {p.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-slate-900">
                          {formatPaisaToInr(Math.round(p.currentStock * p.standardCostPaisa))}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={low ? 'Low Stock' : 'In Stock'} tone={low ? 'danger' : 'success'} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Raw Materials */}
      {tab === 'raw' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Code & Ingredient</th>
                  <th className="text-left font-medium px-4 py-3">Primary Supplier</th>
                  <th className="text-right font-medium px-4 py-3">On Hand</th>
                  <th className="text-right font-medium px-4 py-3">Reorder Level</th>
                  <th className="text-right font-medium px-4 py-3">Weighted Cost</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rawMaterials
                  .filter(
                    (r) =>
                      !search.trim() ||
                      r.name.toLowerCase().includes(search.toLowerCase()) ||
                      r.code.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((r) => {
                    const low = r.currentStock <= r.reorderLevel;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{r.name}</p>
                          <p className="text-xs font-mono text-slate-500">
                            {r.code} · {r.category}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{r.supplierName || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                          {r.currentStock} {r.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                          {r.reorderLevel} {r.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900">
                          {formatPaisaToInr(r.costPerUnitPaisa)} / {r.unit}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={low ? 'Low Stock' : 'In Stock'} tone={low ? 'danger' : 'success'} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Packaging */}
      {tab === 'packaging' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Code & Packaging Material</th>
                  <th className="text-left font-medium px-4 py-3">Supplier</th>
                  <th className="text-right font-medium px-4 py-3">On Hand</th>
                  <th className="text-right font-medium px-4 py-3">Reorder Level</th>
                  <th className="text-right font-medium px-4 py-3">Unit Cost</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packagingMaterials
                  .filter(
                    (p) =>
                      !search.trim() ||
                      p.name.toLowerCase().includes(search.toLowerCase()) ||
                      p.code.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((p) => {
                    const low = p.currentStock <= p.reorderLevel;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs font-mono text-slate-500">
                            {p.code} · {p.materialType}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{p.supplierName || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                          {p.currentStock} {p.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                          {p.reorderLevel} {p.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900">
                          {formatPaisaToInr(p.costPerUnitPaisa)} / {p.unit}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={low ? 'Low Stock' : 'In Stock'} tone={low ? 'danger' : 'success'} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: WIP Floor Stock */}
      {tab === 'wip' && (
        wipRuns.length === 0 ? (
          <EmptyState
            title="No active Work-in-Progress batches"
            description="Start a manufacturing run from Production & WIP to monitor live shop-floor work in progress."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {wipRuns.map((run) => (
              <div key={run.id} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-bold text-[#0F294A]">{run.batchNumber}</p>
                    <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                      {run.productName}
                    </h3>
                    {run.linkedOrderNumber && (
                      <p className="text-xs text-blue-700 mt-0.5 font-mono">
                        Allocated to Order: {run.linkedOrderNumber}
                      </p>
                    )}
                  </div>
                  <StatusTag status={run.wipStage || run.status} />
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500">Target Output</p>
                    <p className="font-mono font-semibold text-slate-900">{run.plannedQty} units</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Standard WIP Value</p>
                    <p className="font-mono font-semibold text-slate-900">
                      {formatPaisaToInr(run.standardCostPaisa)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-700 mb-1">Committed Inputs:</p>
                  <p>
                    {run.rawMaterialsConsumed.map((m) => `${m.name}: ${m.plannedQty} ${m.unit}`).join(' · ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Tab 6: Recall Traceability */}
      {tab === 'recall' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  FSSAI Lot Recall & Forward/Backward Traceability
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Enter any Raw Material Lot Code, Finished Goods Batch Number, or SKU name to trace
                  supplier origin, factory run, and impacted B2B customer dispatches.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={recallQuery}
                  onChange={(e) => setRecallQuery(e.target.value)}
                  placeholder="Try searching KHF-BCH, LOT-RM, or Idli..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              {batches.slice(0, 3).map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => setRecallQuery(sample.batchNumber)}
                  className="px-3 py-2 text-xs font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Trace {sample.batchNumber}
                </button>
              ))}
            </div>
          </div>

          {recallQuery.trim() && recallResults.length === 0 && (
            <EmptyState
              title="No matching batch lineage found"
              description="Try another Batch Number, Lot Code, or product keyword."
            />
          )}

          {recallResults.map(({ batch, linkedRun, impactedDispatches, impactedOrders }) => (
            <div key={batch.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <GitBranch className="w-4 h-4 text-[#1A6FD4]" />
                  <span className="font-mono font-bold text-slate-900">{batch.batchNumber}</span>
                  <span className="text-sm font-medium text-slate-700">— {batch.itemName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusTag status={batch.qcStatus} />
                  <span className="text-xs font-mono text-slate-500">
                    Mfg {batch.mfgDate} · Exp {batch.expiryDate}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 mb-2">
                    <Package className="w-3.5 h-3.5 text-slate-500" />
                    <span>1. Upstream Origin / Raw Lots</span>
                  </div>
                  {batch.sourceType === 'grn' || batch.sourceType === 'opening' ? (
                    <p className="text-slate-600">
                      Vendor: <strong>{batch.supplierName || 'Internal Opening Lot'}</strong>
                      <br />
                      Ref: <span className="font-mono">{batch.sourceRef || batch.lotCode}</span>
                    </p>
                  ) : (
                    <p className="text-slate-600">
                      Consumed Raw Lots:{' '}
                      <span className="font-mono font-medium">
                        {batch.rawBatchRefs && batch.rawBatchRefs.length > 0
                          ? batch.rawBatchRefs.join(', ')
                          : 'Opening Stock Pool'}
                      </span>
                    </p>
                  )}
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 mb-2">
                    <Factory className="w-3.5 h-3.5 text-slate-500" />
                    <span>2. Factory Production Run</span>
                  </div>
                  {linkedRun ? (
                    <div className="text-slate-600 space-y-1">
                      <p>
                        Batch: <span className="font-mono font-semibold">{linkedRun.batchNumber}</span>
                      </p>
                      <p>
                        Output: {linkedRun.actualOutputQty} units · Supervisor: {linkedRun.supervisorName}
                      </p>
                    </div>
                  ) : (
                    <p className="text-slate-500">No linked production conversion yet.</p>
                  )}
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>3. Downstream Buyers & Dispatches</span>
                  </div>
                  {impactedDispatches.length === 0 && impactedOrders.length === 0 ? (
                    <p className="text-emerald-700 font-medium">
                      100% still inside warehouse ({batch.remainingQty} {batch.unit} remaining). Zero buyer exposure.
                    </p>
                  ) : (
                    <div className="space-y-1 text-slate-700">
                      {impactedDispatches.map((d) => (
                        <p key={d.id}>
                          <span className="font-mono font-semibold">{d.dispatchNumber}</span> →{' '}
                          {d.customerName} ({d.status})
                        </p>
                      ))}
                      {impactedOrders
                        .filter((o) => !impactedDispatches.some((d) => d.orderId === o.id))
                        .map((o) => (
                          <p key={o.id}>
                            <span className="font-mono font-semibold">{o.orderNumber}</span> →{' '}
                            {o.customerName}
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
