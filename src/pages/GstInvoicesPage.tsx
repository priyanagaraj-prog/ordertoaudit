import React, { useMemo, useState } from 'react';
import { Download, Search, Truck, CreditCard } from 'lucide-react';
import { EmptyState, KpiCard, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import {
  createDispatchTransaction,
  makeDocNumber,
  recordPaymentTransaction,
} from '../services/erpService';
import type { CompanySetting, GstInvoice, Payment } from '../types/erp';
import { exportGstInvoicePdf } from '../utils/exportReports';
import { formatPaisaToInr, rupeeInputToPaisa } from '../utils/money';

interface GstInvoicesPageProps {
  invoices: GstInvoice[];
  company: CompanySetting | null;
}

export function GstInvoicesPage({ invoices, company }: GstInvoicesPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('gst_invoices');

  const [search, setSearch] = useState('');
  const [dispatchInv, setDispatchInv] = useState<GstInvoice | null>(null);
  const [paymentInv, setPaymentInv] = useState<GstInvoice | null>(null);

  const [transporterName, setTransporterName] = useState('Southern Cold-Chain Logistics');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');

  const [payAmountInr, setPayAmountInr] = useState('');
  const [payMode, setPayMode] = useState<Payment['paymentMode']>('NEFT');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const summary = useMemo(() => {
    const billed = invoices.reduce((s, i) => s + i.totalAmountPaisa, 0);
    const gst = invoices.reduce((s, i) => s + i.totalTaxPaisa, 0);
    const due = invoices.reduce((s, i) => s + i.balanceDuePaisa, 0);
    return { billed, gst, due };
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter(
      (i) =>
        !q ||
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.orderNumber.toLowerCase().includes(q) ||
        i.customerName.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !dispatchInv) return;
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
        dispatchInv,
        {
          dispatchNumber: makeDocNumber('DSP'),
          transporterName: transporterName.trim(),
          vehicleNumber: vehicleNumber.trim(),
          lrNumber: lrNumber.trim(),
        }
      );
      setDispatchInv(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to dispatch invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !paymentInv) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await recordPaymentTransaction(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        paymentInv,
        {
          receiptNumber: makeDocNumber('RCPT'),
          amountPaisa: rupeeInputToPaisa(payAmountInr),
          paymentMode: payMode,
          referenceNumber: payRef.trim(),
          paymentDate: payDate,
          notes: payNotes.trim(),
        }
      );
      setPaymentInv(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="GST Invoices"
        subtitle="CGST/SGST and IGST compliant tax invoices with PDF export and settlement status."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total Invoiced Value" value={formatPaisaToInr(summary.billed)} tone="navy" />
        <KpiCard label="Total Output GST" value={formatPaisaToInr(summary.gst)} />
        <KpiCard
          label="Receivables Balance"
          value={formatPaisaToInr(summary.due)}
          tone={summary.due > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice no, order no, customer..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No GST invoices issued yet"
          description="Convert a Sales Order into a GST Tax Invoice from the Sales Orders module."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Invoice</th>
                  <th className="text-left font-medium px-4 py-3">Customer</th>
                  <th className="text-right font-medium px-4 py-3">Taxable</th>
                  <th className="text-right font-medium px-4 py-3">CGST / SGST / IGST</th>
                  <th className="text-right font-medium px-4 py-3">Total</th>
                  <th className="text-right font-medium px-4 py-3">Balance Due</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-right font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-mono font-semibold text-slate-900">{inv.invoiceNumber}</p>
                      <p className="text-xs font-mono text-slate-500">
                        {inv.invoiceDate} · {inv.orderNumber}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{inv.customerName}</p>
                      <p className="text-xs font-mono text-slate-500">
                        {inv.customerGstin || 'Unregistered'} · State {inv.customerStateCode}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      {formatPaisaToInr(inv.subtotalPaisa)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-slate-600">
                      {inv.isInterState ? (
                        <span>IGST {formatPaisaToInr(inv.igstPaisa)}</span>
                      ) : (
                        <span>
                          C {formatPaisaToInr(inv.cgstPaisa)} + S {formatPaisaToInr(inv.sgstPaisa)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatPaisaToInr(inv.totalAmountPaisa)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-slate-800">
                      {formatPaisaToInr(inv.balanceDuePaisa)}
                    </td>
                    <td className="px-4 py-3 space-x-1.5">
                      <StatusTag status={inv.paymentStatus} />
                      <StatusTag status={inv.dispatchStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => exportGstInvoicePdf(inv, company)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                        {!readOnly && inv.dispatchStatus === 'pending' && (
                          <button
                            type="button"
                            onClick={() => {
                              setErrorMsg(null);
                              setDispatchInv(inv);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 cursor-pointer"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            <span>Dispatch</span>
                          </button>
                        )}
                        {!readOnly && inv.balanceDuePaisa > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setErrorMsg(null);
                              setPayAmountInr((inv.balanceDuePaisa / 100).toFixed(2));
                              setPaymentInv(inv);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#0F294A] rounded-md hover:bg-[#173B6C] cursor-pointer"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Pay</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dispatch Modal */}
      <Modal
        open={Boolean(dispatchInv)}
        onClose={() => setDispatchInv(null)}
        title={`Dispatch Invoice ${dispatchInv?.invoiceNumber || ''}`}
      >
        <form onSubmit={handleDispatchSubmit} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <p className="text-xs text-slate-600">
            Confirming dispatch will atomically deduct finished goods stock from inventory and
            append traceable <span className="font-mono">DISPATCH_OUT</span> entries to the Stock
            Ledger.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Transporter / Logistics Partner
            </label>
            <input
              type="text"
              required
              value={transporterName}
              onChange={(e) => setTransporterName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Vehicle Number
              </label>
              <input
                type="text"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="TN-37-CL-4821"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                LR / Waybill Number
              </label>
              <input
                type="text"
                value={lrNumber}
                onChange={(e) => setLrNumber(e.target.value)}
                placeholder="LR-99210"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDispatchInv(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg hover:bg-[#173B6C] cursor-pointer"
            >
              {submitting ? 'Dispatching...' : 'Confirm Dispatch & Deduct Stock'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Payment Modal */}
      <Modal
        open={Boolean(paymentInv)}
        onClose={() => setPaymentInv(null)}
        title={`Record Payment for ${paymentInv?.invoiceNumber || ''}`}
      >
        <form onSubmit={handlePaymentSubmit} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Amount Received (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={payAmountInr}
                onChange={(e) => setPayAmountInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Payment Mode
              </label>
              <select
                value={payMode}
                onChange={(e) => setPayMode(e.target.value as Payment['paymentMode'])}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                UTR / Reference No
              </label>
              <input
                type="text"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Payment Date
              </label>
              <input
                type="date"
                required
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <input
              type="text"
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setPaymentInv(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg hover:bg-[#173B6C] cursor-pointer"
            >
              {submitting ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
