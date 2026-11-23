import React, { useMemo } from 'react';
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
import type { ProductionRun } from '../types/erp';
import { calculateConsumptionVarianceBps, formatPctFromBps } from '../utils/erpEngine';
import { formatPaisaToInr } from '../utils/money';

export function CostingVariancePage({ runs }: { runs: ProductionRun[] }) {
  const completedRuns = useMemo(() => runs.filter((r) => r.status === 'completed'), [runs]);

  const totals = useMemo(() => {
    const std = completedRuns.reduce((s, r) => s + r.standardCostPaisa, 0);
    const act = completedRuns.reduce((s, r) => s + r.actualTotalCostPaisa, 0);
    const variance = act - std;
    const totalWastage = completedRuns.reduce((s, r) => s + r.wastageQty, 0);
    const plannedTotal = completedRuns.reduce((s, r) => s + r.plannedQty, 0);
    const actualTotal = completedRuns.reduce((s, r) => s + r.actualOutputQty, 0);
    const overallYieldVarBps = calculateConsumptionVarianceBps(plannedTotal, actualTotal);
    return { std, act, variance, totalWastage, overallYieldVarBps };
  }, [completedRuns]);

  const chartData = useMemo(
    () =>
      completedRuns
        .slice(0, 8)
        .reverse()
        .map((r) => ({
          batch: r.batchNumber.replace('KHF-BCH-', ''),
          standardInr: Math.round(r.standardCostPaisa / 100),
          actualInr: Math.round(r.actualTotalCostPaisa / 100),
        })),
    [completedRuns]
  );

  const materialVarianceRows = useMemo(() => {
    const rows: Array<{
      batchNumber: string;
      category: string;
      name: string;
      unit: string;
      plannedQty: number;
      actualQty: number;
      damagedQty: number;
      varianceBps: number;
    }> = [];
    completedRuns.forEach((run) => {
      run.rawMaterialsConsumed.forEach((m) => {
        rows.push({
          batchNumber: run.batchNumber,
          category: 'Raw Material',
          name: m.name,
          unit: m.unit,
          plannedQty: m.plannedQty,
          actualQty: m.actualQty,
          damagedQty: 0,
          varianceBps: calculateConsumptionVarianceBps(m.plannedQty, m.actualQty),
        });
      });
      run.packagingConsumed.forEach((p) => {
        rows.push({
          batchNumber: run.batchNumber,
          category: 'Packaging',
          name: p.name,
          unit: p.unit,
          plannedQty: p.plannedQty,
          actualQty: p.actualQty,
          damagedQty: p.damagedQty || 0,
          varianceBps: calculateConsumptionVarianceBps(p.plannedQty, p.actualQty),
        });
      });
    });
    return rows;
  }, [completedRuns]);

  return (
    <div>
      <PageHeader
        title="Costing & Variance Analysis"
        subtitle="Compare BOM standard batch costs against actual raw material consumption, labor, overhead, and yield variance."
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Standard Cost" value={formatPaisaToInr(totals.std)} />
        <KpiCard label="Total Actual Cost" value={formatPaisaToInr(totals.act)} tone="navy" />
        <KpiCard
          label="Net Cost Variance"
          value={formatPaisaToInr(totals.variance)}
          hint={totals.variance > 0 ? 'Unfavorable (Over Std)' : 'Favorable (Under Std)'}
          tone={totals.variance > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Cumulative Yield Variance"
          value={completedRuns.length > 0 ? formatPctFromBps(totals.overallYieldVarBps) : '0%'}
          hint={`${totals.totalWastage} units shortfall/wastage`}
          tone={totals.overallYieldVarBps < 0 ? 'warning' : 'success'}
        />
      </div>

      {completedRuns.length === 0 ? (
        <EmptyState
          title="No completed production batches"
          description="Complete a production batch to compute actual unit costing, yield variance, and material variance."
        />
      ) : (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              Standard vs Actual Batch Cost (INR)
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Visualizes material & yield variance across recent completed batches
            </p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="batch" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip formatter={(v: unknown) => `₹${Number(v).toLocaleString('en-IN')}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="standardInr"
                    name="Standard Cost (INR)"
                    fill="#94A3B8"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="actualInr"
                    name="Actual Cost (INR)"
                    fill="#0F294A"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                Batch Cost & Yield Variance Summary
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Batch</th>
                    <th className="text-left font-medium px-4 py-3">Product</th>
                    <th className="text-right font-medium px-4 py-3">Plan / Actual</th>
                    <th className="text-right font-medium px-4 py-3">Yield Variance</th>
                    <th className="text-right font-medium px-4 py-3">Labor & Power</th>
                    <th className="text-right font-medium px-4 py-3">Std Cost</th>
                    <th className="text-right font-medium px-4 py-3">Actual Cost</th>
                    <th className="text-right font-medium px-4 py-3">Cost Variance</th>
                    <th className="text-left font-medium px-4 py-3">Assessment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {completedRuns.map((r) => {
                    const yieldVarBps = calculateConsumptionVarianceBps(
                      r.plannedQty,
                      r.actualOutputQty
                    );
                    const unfavorable = r.variancePaisa > 0 || yieldVarBps < 0;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                          {r.batchNumber}
                        </td>
                        <td className="px-4 py-3 text-slate-800">{r.productName}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                          {r.plannedQty} / <span className="font-semibold">{r.actualOutputQty}</span>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                            yieldVarBps < 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatPctFromBps(yieldVarBps)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                          {formatPaisaToInr(r.laborOverheadPaisa)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                          {formatPaisaToInr(r.standardCostPaisa)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-slate-900">
                          {formatPaisaToInr(r.actualTotalCostPaisa)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                            r.variancePaisa > 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {r.variancePaisa > 0 ? '+' : ''}
                          {formatPaisaToInr(r.variancePaisa)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag
                            status={unfavorable ? 'Variance Alert' : 'Favorable'}
                            tone={unfavorable ? 'danger' : 'success'}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                Material & Packaging Consumption Variance
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Batch</th>
                    <th className="text-left font-medium px-4 py-3">Type</th>
                    <th className="text-left font-medium px-4 py-3">Material</th>
                    <th className="text-right font-medium px-4 py-3">BOM Standard</th>
                    <th className="text-right font-medium px-4 py-3">Actual Issued</th>
                    <th className="text-right font-medium px-4 py-3">Damaged</th>
                    <th className="text-right font-medium px-4 py-3">Consumption Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {materialVarianceRows.map((row, idx) => (
                    <tr key={`${row.batchNumber}-${idx}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                        {row.batchNumber}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{row.category}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{row.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                        {row.plannedQty} {row.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium text-slate-900">
                        {row.actualQty} {row.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-amber-700">
                        {row.damagedQty > 0 ? `${row.damagedQty} ${row.unit}` : '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono font-semibold ${
                          row.varianceBps > 0
                            ? 'text-red-700'
                            : row.varianceBps < 0
                            ? 'text-emerald-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {formatPctFromBps(row.varianceBps)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
