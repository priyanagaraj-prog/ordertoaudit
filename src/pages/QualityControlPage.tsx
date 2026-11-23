import React, { useMemo, useState } from 'react';
import { ClipboardCheck, CheckCircle2, ShieldAlert } from 'lucide-react';
import { EmptyState, KpiCard, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { recordQcInspectionTransaction } from '../services/erpService';
import type { InventoryBatch, QcInspection, QcParameterCheck } from '../types/erp';

interface QualityControlPageProps {
  batches: InventoryBatch[];
  qcInspections: QcInspection[];
}

export function QualityControlPage({ batches, qcInspections }: QualityControlPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('quality_control');

  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [selectedBatch, setSelectedBatch] = useState<InventoryBatch | null>(null);
  const [status, setStatus] = useState<'passed' | 'hold' | 'rejected'>('passed');
  const [rejectedQty, setRejectedQty] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [moistureRes, setMoistureRes] = useState('< 8.5% (Within Spec)');
  const [sealRes, setSealRes] = useState('Air-tight Vacuum Verified');
  const [sensoryRes, setSensoryRes] = useState('Authentic Aroma & Color');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pendingQueue = useMemo(
    () =>
      batches.filter(
        (b) => b.remainingQty > 0 && (b.qcStatus === 'pending' || b.qcStatus === 'hold')
      ),
    [batches]
  );

  const stats = useMemo(() => {
    return {
      pending: batches.filter((b) => b.remainingQty > 0 && b.qcStatus === 'pending').length,
      passed: qcInspections.filter((q) => q.status === 'passed').length,
      hold: batches.filter((b) => b.remainingQty > 0 && b.qcStatus === 'hold').length,
      rejected: qcInspections.filter((q) => q.status === 'rejected').length,
    };
  }, [batches, qcInspections]);

  const openInspectModal = (b: InventoryBatch) => {
    setSelectedBatch(b);
    setStatus('passed');
    setRejectedQty('0');
    setRemarks('');
    setMoistureRes('< 8.5% (Within Spec)');
    setSealRes('Air-tight Vacuum Verified');
    setSensoryRes('Authentic Aroma & Color');
    setErrorMsg(null);
  };

  const handleSubmitInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedBatch) return;

    const rej = status === 'rejected' ? selectedBatch.remainingQty : Math.max(0, Number(rejectedQty) || 0);
    const inspected = selectedBatch.remainingQty;
    const passed = Math.max(0, inspected - rej);

    const parameters: QcParameterCheck[] = [
      { name: 'Moisture & Water Activity', result: moistureRes, passed: status !== 'rejected' },
      { name: 'Seal & Packaging Integrity', result: sealRes, passed: status !== 'rejected' },
      { name: 'Sensory / Aroma / Visual Purity', result: sensoryRes, passed: status !== 'rejected' },
    ];

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await recordQcInspectionTransaction(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        {
          inspectionType:
            selectedBatch.itemType === 'finished_good' ? 'finished_good' : 'raw_material',
          batch: selectedBatch,
          inspectedQty: inspected,
          passedQty: passed,
          rejectedQty: rej,
          status,
          parameters,
          remarks: remarks.trim(),
        }
      );
      setSelectedBatch(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save QC inspection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Quality Control (FSSAI & Batch QC)"
        subtitle="Inspect incoming Raw Material GRN lots and Completed Finished Goods batches before release to production or dispatch."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Pending QC Inspection"
          value={`${stats.pending}`}
          hint="Awaiting quality sign-off"
          tone={stats.pending > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Passed QC Releases"
          value={`${stats.passed}`}
          hint="Cleared for FEFO dispatch"
          tone="success"
        />
        <KpiCard
          label="Lots on Hold"
          value={`${stats.hold}`}
          hint="Quarantined pending re-test"
          tone={stats.hold > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Rejected Lots"
          value={`${stats.rejected}`}
          hint="Quarantined / written off stock"
          tone={stats.rejected > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-2 mb-5 inline-flex gap-1">
        <button
          type="button"
          onClick={() => setTab('queue')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            tab === 'queue' ? 'bg-[#0F294A] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Pending & Held QC Queue ({pendingQueue.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            tab === 'history' ? 'bg-[#0F294A] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Inspection History ({qcInspections.length})
        </button>
      </div>

      {tab === 'queue' && (
        pendingQueue.length === 0 ? (
          <EmptyState
            title="All active batches cleared QC"
            description="New GRN receipts and completed production batches automatically enter this inspection queue."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Lot / Batch No</th>
                    <th className="text-left font-medium px-4 py-3">Item</th>
                    <th className="text-left font-medium px-4 py-3">Origin</th>
                    <th className="text-right font-medium px-4 py-3">Lot Quantity</th>
                    <th className="text-left font-medium px-4 py-3">Expiry</th>
                    <th className="text-left font-medium px-4 py-3">QC Status</th>
                    {!readOnly && <th className="text-right font-medium px-4 py-3">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingQueue.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {b.batchNumber}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{b.itemName}</p>
                        <p className="text-xs font-mono text-slate-500">
                          {b.itemCode} · {b.itemType.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {b.sourceType.toUpperCase()} {b.sourceRef || ''}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                        {b.remainingQty} {b.unit}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{b.expiryDate}</td>
                      <td className="px-4 py-3">
                        <StatusTag status={b.qcStatus} />
                      </td>
                      {!readOnly && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openInspectModal(b)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-md cursor-pointer"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5" />
                            <span>Inspect Lot</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'history' && (
        qcInspections.length === 0 ? (
          <EmptyState
            title="No QC inspection reports logged"
            description="Completed inspection checklists for GRN materials and finished batches appear here."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">QC Report No</th>
                    <th className="text-left font-medium px-4 py-3">Item & Lot</th>
                    <th className="text-left font-medium px-4 py-3">Parameters Checked</th>
                    <th className="text-right font-medium px-4 py-3">Passed / Rejected</th>
                    <th className="text-left font-medium px-4 py-3">Inspector & Date</th>
                    <th className="text-left font-medium px-4 py-3">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {qcInspections.map((qc) => (
                    <tr key={qc.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {qc.qcNumber}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{qc.itemName}</p>
                        <p className="text-xs font-mono text-slate-500">
                          Lot {qc.batchNumber} · {qc.inspectionType.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 space-y-0.5">
                        {qc.parameters.map((p, idx) => (
                          <p key={idx}>
                            <span className="font-medium text-slate-800">{p.name}:</span> {p.result}
                          </p>
                        ))}
                        {qc.remarks && <p className="text-slate-500 italic">Note: {qc.remarks}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        <span className="text-emerald-700 font-semibold">{qc.passedQty} pass</span>
                        {qc.rejectedQty > 0 && (
                          <span className="block text-red-700 font-semibold">
                            {qc.rejectedQty} reject
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p className="font-medium text-slate-800">{qc.inspectorName}</p>
                        <p className="font-mono text-slate-500">{qc.inspectedDate}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={qc.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      <Modal
        open={Boolean(selectedBatch)}
        onClose={() => setSelectedBatch(null)}
        title={`Quality Control Inspection — ${selectedBatch?.batchNumber || ''}`}
      >
        {selectedBatch && (
          <form onSubmit={handleSubmitInspection} className="space-y-4">
            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {errorMsg}
              </div>
            )}
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{selectedBatch.itemName}</p>
                <p className="font-mono text-slate-500">
                  {selectedBatch.itemCode} · Lot {selectedBatch.batchNumber}
                </p>
              </div>
              <div className="text-right font-mono">
                <p className="font-semibold text-slate-900">
                  Qty: {selectedBatch.remainingQty} {selectedBatch.unit}
                </p>
                <p className="text-slate-500">Exp: {selectedBatch.expiryDate}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Moisture / Spec
                </label>
                <input
                  type="text"
                  value={moistureRes}
                  onChange={(e) => setMoistureRes(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Seal / Packaging
                </label>
                <input
                  type="text"
                  value={sealRes}
                  onChange={(e) => setSealRes(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Sensory / Aroma
                </label>
                <input
                  type="text"
                  value={sensoryRes}
                  onChange={(e) => setSensoryRes(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  QC Disposition Decision
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'passed' | 'hold' | 'rejected')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="passed">PASS — Release for Production / Dispatch</option>
                  <option value="hold">HOLD — Quarantine Pending Lab Retest</option>
                  <option value="rejected">REJECT — Quarantine & Deduct Full Lot</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Partial / Damaged Qty Rejected ({selectedBatch.unit})
                </label>
                <input
                  type="number"
                  min="0"
                  max={selectedBatch.remainingQty}
                  step="0.1"
                  disabled={status === 'rejected'}
                  value={status === 'rejected' ? String(selectedBatch.remainingQty) : rejectedQty}
                  onChange={(e) => setRejectedQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
                />
              </div>
            </div>

            {status === 'rejected' && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  Rejecting this batch atomically deducts {selectedBatch.remainingQty}{' '}
                  {selectedBatch.unit} from active warehouse stock and writes a{' '}
                  <strong>QC_REJECT</strong> Stock Ledger entry.
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Inspector Remarks
              </label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g., Batch acidity pH 4.6 verified within FSSAI norms"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{submitting ? 'Saving...' : 'Sign Off QC Inspection'}</span>
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
