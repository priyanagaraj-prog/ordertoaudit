import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import { EmptyState, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import {
  createDispatchTransaction,
  makeDocNumber,
  markDispatchDelivered,
} from '../services/erpService';
import type { Dispatch, GstInvoice, Product } from '../types/erp';
import { evaluateStockAvailability } from '../utils/erpEngine';

export function DispatchManagementPage({
  dispatches,
  invoices,
  products = [],
}: {
  dispatches: Dispatch[];
  invoices: GstInvoice[];
  products?: Product[];
}) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('dispatch');

  const pendingInvoices = invoices.filter((i) => i.dispatchStatus === 'pending');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedInvId, setSelectedInvId] = useState('');
  const [transporterName, setTransporterName] = useState('Southern Cold-Chain Logistics');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedInvoice = pendingInvoices.find((i) => i.id === selectedInvId) || null;
  const selectedShortages = useMemo(() => {
    if (!selectedInvoice || products.length === 0) return [];
    return selectedInvoice.items
      .map((item) => {
        const prod = products.find((p) => p.id === item.productId);
        if (!prod) return null;
        const avail = evaluateStockAvailability(item.quantity, prod.currentStock);
        return avail.sufficient ? null : { name: item.name, unit: item.unit, ...avail };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [selectedInvoice, products]);

  const openModal = () => {
    setSelectedInvId(pendingInvoices[0]?.id || '');
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const inv = invoices.find((i) => i.id === selectedInvId);
    if (!inv) return;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createDispatchTransaction(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        inv,
        {
          dispatchNumber: makeDocNumber('DSP'),
          transporterName: transporterName.trim(),
          vehicleNumber: vehicleNumber.trim(),
          lrNumber: lrNumber.trim(),
        }
      );
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create dispatch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelivered = async (d: Dispatch) => {
    if (!profile) return;
    try {
      await markDispatchDelivered(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        d.id
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to mark delivered.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Dispatch Management"
        subtitle="Track outbound logistics, vehicle/LR details, and transactional finished goods stock deductions."
        actions={
          !readOnly &&
          pendingInvoices.length > 0 && (
            <button
              type="button"
              onClick={openModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Dispatch ({pendingInvoices.length} Pending)</span>
            </button>
          )
        }
      />

      {errorMsg && !modalOpen && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {dispatches.length === 0 ? (
        <EmptyState
          title="No dispatches created yet"
          description="Generate a GST Invoice first, then dispatch goods to deduct finished stock."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Dispatch No</th>
                  <th className="text-left font-medium px-4 py-3">Invoice / Order</th>
                  <th className="text-left font-medium px-4 py-3">Customer</th>
                  <th className="text-left font-medium px-4 py-3">Transporter & Vehicle</th>
                  <th className="text-left font-medium px-4 py-3">Items</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  {!readOnly && <th className="text-right font-medium px-4 py-3">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dispatches.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                      {d.dispatchNumber}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {d.invoiceNumber}
                      <span className="block text-slate-400">{d.orderNumber}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-medium">{d.customerName}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <p>{d.transporterName}</p>
                      <p className="text-xs font-mono text-slate-500">
                        {d.vehicleNumber || 'N/A'} · {d.lrNumber || 'No LR'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 space-y-0.5">
                      {d.dispatchedItems.map((it, idx) => (
                        <div key={idx}>
                          <p>
                            {it.quantity} {it.unit} {it.sku}
                          </p>
                          {it.batchAllocations && it.batchAllocations.length > 0 && (
                            <p className="font-mono text-[11px] text-blue-700">
                              FEFO:{' '}
                              {it.batchAllocations
                                .map((a) => `${a.batchNumber} (${a.quantity}, exp ${a.expiryDate})`)
                                .join('; ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3">
                      <StatusTag status={d.status} />
                    </td>
                    {!readOnly && (
                      <td className="px-4 py-3 text-right">
                        {d.status !== 'delivered' && (
                          <button
                            type="button"
                            onClick={() => handleDelivered(d)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Mark Delivered</span>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Dispatch Pending GST Invoice"
      >
        <form onSubmit={handleDispatch} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Pending Invoice
            </label>
            <select
              value={selectedInvId}
              onChange={(e) => setSelectedInvId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              {pendingInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — {inv.customerName}
                </option>
              ))}
            </select>
          </div>
          {selectedShortages.length > 0 && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Insufficient Finished Stock</span>
              </div>
              {selectedShortages.map((sh, idx) => (
                <p key={idx}>
                  {sh.name}: Requested {sh.requestedQty} {sh.unit}, Available {sh.availableQty}{' '}
                  {sh.unit} (Shortage: {sh.shortageQty} {sh.unit})
                </p>
              ))}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Transporter Name
            </label>
            <input
              type="text"
              required
              value={transporterName}
              onChange={(e) => setTransporterName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Vehicle No
              </label>
              <input
                type="text"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">LR No</label>
              <input
                type="text"
                value={lrNumber}
                onChange={(e) => setLrNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg hover:bg-[#173B6C] cursor-pointer"
            >
              {submitting ? 'Dispatching...' : 'Dispatch & Deduct Stock'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
