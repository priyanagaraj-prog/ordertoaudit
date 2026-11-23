import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Play } from 'lucide-react';
import { EmptyState, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import {
  advanceProductionWipStage,
  completeProductionRunTransaction,
  createProductionRun,
  makeDocNumber,
} from '../services/erpService';
import type { Bom, CompanySetting, ProductionRun, WipStage } from '../types/erp';
import { calculateConsumptionVarianceBps, formatPctFromBps, roundQty } from '../utils/erpEngine';
import { formatPaisaToInr } from '../utils/money';

const WIP_SEQUENCE: WipStage[] = ['mixing', 'cooking', 'cooling', 'packaging', 'qc_pending'];

interface ProductionManagementPageProps {
  runs: ProductionRun[];
  boms: Bom[];
  company: CompanySetting | null;
}

export function ProductionManagementPage({
  runs,
  boms,
  company,
}: ProductionManagementPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('production');

  const [startModal, setStartModal] = useState(false);
  const [selectedBomId, setSelectedBomId] = useState('');
  const [plannedQty, setPlannedQty] = useState('100');

  const [completeRun, setCompleteRun] = useState<ProductionRun | null>(null);
  const [actualOutputQty, setActualOutputQty] = useState('');
  const [wastageQty, setWastageQty] = useState('0');
  const [wastageReason, setWastageReason] = useState('');
  const [rawOverrides, setRawOverrides] = useState<Record<string, string>>({});
  const [pkgOverrides, setPkgOverrides] = useState<
    Record<string, { goodQty: string; damagedQty: string }>
  >({});

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openStart = () => {
    setSelectedBomId(boms[0]?.id || '');
    setPlannedQty(String(boms[0]?.batchYieldQty || 100));
    setErrorMsg(null);
    setStartModal(true);
  };

  const openComplete = (run: ProductionRun) => {
    setCompleteRun(run);
    setActualOutputQty(String(run.plannedQty));
    setWastageQty('0');
    setWastageReason('');
    const rMap: Record<string, string> = {};
    run.rawMaterialsConsumed.forEach((m) => {
      rMap[m.itemId] = String(m.plannedQty);
    });
    const pMap: Record<string, { goodQty: string; damagedQty: string }> = {};
    run.packagingConsumed.forEach((p) => {
      pMap[p.itemId] = {
        goodQty: String(p.goodQty ?? p.plannedQty),
        damagedQty: String(p.damagedQty ?? 0),
      };
    });
    setRawOverrides(rMap);
    setPkgOverrides(pMap);
    setErrorMsg(null);
  };

  const handleAdvanceWip = async (run: ProductionRun) => {
    if (!profile) return;
    const currentStage = run.wipStage || 'mixing';
    const curIdx = WIP_SEQUENCE.indexOf(currentStage);
    const nextStage = curIdx >= 0 && curIdx < WIP_SEQUENCE.length - 1 ? WIP_SEQUENCE[curIdx + 1] : null;
    if (!nextStage) return;
    try {
      await advanceProductionWipStage(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        run.id,
        nextStage
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to advance WIP stage.');
    }
  };

  const handleStartBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const bom = boms.find((b) => b.id === selectedBomId);
    if (!bom) return;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const prefix = company?.batchPrefix || 'KHF-BCH';
      await createProductionRun(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        bom,
        Number(plannedQty),
        makeDocNumber(prefix)
      );
      setStartModal(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start production batch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !completeRun) return;
    const bom = boms.find((b) => b.id === completeRun.bomId);
    if (!bom) return;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await completeProductionRunTransaction(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        completeRun,
        bom,
        {
          actualOutputQty: Number(actualOutputQty),
          wastageQty: Number(wastageQty),
          wastageReason: wastageReason.trim(),
          rawMaterialsConsumed: Object.entries(rawOverrides).map(([itemId, val]) => ({
            itemId,
            actualQty: Number(val),
          })),
          packagingConsumed: Object.entries(pkgOverrides).map(([itemId, val]) => {
            const goodQty = Number(val.goodQty) || 0;
            const damagedQty = Number(val.damagedQty) || 0;
            return {
              itemId,
              goodQty,
              damagedQty,
              actualQty: roundQty(goodQty + damagedQty),
            };
          }),
        }
      );
      setCompleteRun(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to complete production batch.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Production & WIP Management"
        subtitle="Track shop-floor Work-in-Progress stages (Mixing -> Cooking -> Cooling -> Packaging -> QC), FEFO raw consumption, and wastage."
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={openStart}
              disabled={boms.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              <span>Start Production Batch</span>
            </button>
          )
        }
      />

      {errorMsg && !startModal && !completeRun && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {runs.length === 0 ? (
        <EmptyState
          title="No production runs recorded"
          description="Start a manufacturing batch using a defined Bill of Materials."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Batch No</th>
                  <th className="text-left font-medium px-4 py-3">Product SKU</th>
                  <th className="text-right font-medium px-4 py-3">Planned / Output</th>
                  <th className="text-right font-medium px-4 py-3">Yield Var</th>
                  <th className="text-right font-medium px-4 py-3">Wastage</th>
                  <th className="text-right font-medium px-4 py-3">Cost (Std / Actual)</th>
                  <th className="text-left font-medium px-4 py-3">WIP & QC Status</th>
                  {!readOnly && <th className="text-right font-medium px-4 py-3">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => {
                  const yieldVarBps =
                    run.status === 'completed'
                      ? calculateConsumptionVarianceBps(run.plannedQty, run.actualOutputQty)
                      : 0;
                  const damagedTotal = run.packagingConsumed.reduce(
                    (sum, p) => sum + (p.damagedQty || 0),
                    0
                  );
                  const stageIdx = WIP_SEQUENCE.indexOf(run.wipStage || 'mixing');
                  const nextWip =
                    run.status !== 'completed' && stageIdx >= 0 && stageIdx < WIP_SEQUENCE.length - 1
                      ? WIP_SEQUENCE[stageIdx + 1]
                      : null;

                  return (
                    <tr key={run.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-slate-900">{run.batchNumber}</p>
                        <p className="text-xs text-slate-500">{run.supervisorName}</p>
                        {run.linkedOrderNumber && (
                          <p className="text-[11px] font-mono text-blue-700 mt-0.5">
                            Order: {run.linkedOrderNumber}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{run.productName}</p>
                        <p className="text-xs font-mono text-slate-500">{run.productSku}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <span className="text-slate-600">{run.plannedQty}</span>
                        <span className="text-slate-400"> / </span>
                        <span className="font-semibold text-slate-900">{run.actualOutputQty}</span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                          run.status !== 'completed'
                            ? 'text-slate-400'
                            : yieldVarBps < 0
                            ? 'text-red-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {run.status === 'completed' ? formatPctFromBps(yieldVarBps) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-red-700">
                        <span>{run.wastageQty}</span>
                        {damagedTotal > 0 && (
                          <span className="block text-[11px] text-amber-700">
                            +{damagedTotal} pkg dmg
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                        <p className="text-slate-600">{formatPaisaToInr(run.standardCostPaisa)}</p>
                        <p className="font-semibold text-slate-900">
                          {run.status === 'completed'
                            ? formatPaisaToInr(run.actualTotalCostPaisa)
                            : 'WIP'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusTag status={run.wipStage || run.status} />
                          {run.qcStatus && (
                            <span className="text-[11px] font-mono text-slate-500">
                              QC: {run.qcStatus.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </td>
                      {!readOnly && (
                        <td className="px-4 py-3 text-right">
                          {run.status !== 'completed' && (
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              {nextWip && (
                                <button
                                  type="button"
                                  onClick={() => void handleAdvanceWip(run)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 cursor-pointer capitalize"
                                >
                                  <ArrowRight className="w-3 h-3" />
                                  <span>{nextWip.replace('_', ' ')}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openComplete(run)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#0F294A] rounded-md hover:bg-[#173B6C] cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Complete</span>
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Start Batch Modal */}
      <Modal
        open={startModal}
        onClose={() => setStartModal(false)}
        title="Start Manufacturing Batch"
      >
        <form onSubmit={handleStartBatch} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Select BOM Recipe
            </label>
            <select
              value={selectedBomId}
              onChange={(e) => {
                setSelectedBomId(e.target.value);
                const found = boms.find((b) => b.id === e.target.value);
                if (found) setPlannedQty(String(found.batchYieldQty));
              }}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              {boms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.productSku} — {b.productName} (Std Yield: {b.batchYieldQty} {b.batchUnit})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Planned Output Quantity
            </label>
            <input
              type="number"
              min="1"
              step="1"
              required
              value={plannedQty}
              onChange={(e) => setPlannedQty(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStartModal(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg hover:bg-[#173B6C] cursor-pointer"
            >
              {submitting ? 'Starting...' : 'Schedule & Start Batch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Complete Batch Modal */}
      <Modal
        open={Boolean(completeRun)}
        onClose={() => setCompleteRun(null)}
        title={`Complete Batch ${completeRun?.batchNumber || ''}`}
        maxWidth="max-w-3xl"
      >
        {completeRun && (
          <form onSubmit={handleCompleteBatch} className="space-y-4">
            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {errorMsg}
              </div>
            )}
            <p className="text-xs text-slate-600">
              Completing this batch atomically deducts actual raw materials and good + damaged
              packaging from inventory, credits finished goods stock, and records traceable ledger
              entries.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Actual Good Output Qty
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={actualOutputQty}
                  onChange={(e) => setActualOutputQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Output Shortfall / Wastage Qty
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={wastageQty}
                  onChange={(e) => setWastageQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Wastage Reason
              </label>
              <input
                type="text"
                value={wastageReason}
                onChange={(e) => setWastageReason(e.target.value)}
                placeholder="e.g., Moisture evaporation / pouch seal rejects"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  Actual Raw Materials Consumed
                </p>
                <div className="space-y-2">
                  {completeRun.rawMaterialsConsumed.map((rm) => (
                    <div key={rm.itemId} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-700 truncate">
                        {rm.name} ({rm.unit})
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={rawOverrides[rm.itemId] ?? String(rm.plannedQty)}
                        onChange={(e) =>
                          setRawOverrides((prev) => ({
                            ...prev,
                            [rm.itemId]: e.target.value,
                          }))
                        }
                        className="w-24 px-2 py-1 text-xs border border-slate-200 rounded bg-white font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  Actual Packaging (Good + Damaged)
                </p>
                <div className="space-y-3">
                  {completeRun.packagingConsumed.map((pm) => {
                    const entry = pkgOverrides[pm.itemId] ?? {
                      goodQty: String(pm.plannedQty),
                      damagedQty: '0',
                    };
                    const totalConsumed = roundQty(
                      (Number(entry.goodQty) || 0) + (Number(entry.damagedQty) || 0)
                    );
                    return (
                      <div key={pm.itemId} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-700 font-medium truncate">{pm.name}</span>
                          <span className="font-mono text-slate-500">
                            Total: {totalConsumed} {pm.unit}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-500">Good Used</label>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              value={entry.goodQty}
                              onChange={(e) =>
                                setPkgOverrides((prev) => ({
                                  ...prev,
                                  [pm.itemId]: { ...entry, goodQty: e.target.value },
                                }))
                              }
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-white font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-500">Damaged</label>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              value={entry.damagedQty}
                              onChange={(e) =>
                                setPkgOverrides((prev) => ({
                                  ...prev,
                                  [pm.itemId]: { ...entry, damagedQty: e.target.value },
                                }))
                              }
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-white font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCompleteRun(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg hover:bg-[#173B6C] cursor-pointer"
              >
                {submitting ? 'Completing...' : 'Complete Batch & Update Ledger'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
