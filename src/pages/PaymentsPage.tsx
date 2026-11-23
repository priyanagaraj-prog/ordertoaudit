import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { EmptyState, KpiCard, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { makeDocNumber, recordPaymentTransaction } from '../services/erpService';
import type { Customer, GstInvoice, Payment } from '../types/erp';
import { formatPaisaToInr, rupeeInputToPaisa } from '../utils/money';

export function PaymentsPage({
  payments,
  invoices,
  customers,
}: {
  payments: Payment[];
  invoices: GstInvoice[];
  customers: Customer[];
}) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('payments');

  const openInvoices = invoices.filter((i) => i.balanceDuePaisa > 0);
  const [modalOpen, setModalOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [amountInr, setAmountInr] = useState('');
  const [paymentMode, setPaymentMode] = useState<Payment['paymentMode']>('NEFT');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const totals = useMemo(() => {
    const collected = payments.reduce((s, p) => s + p.amountPaisa, 0);
    const outstanding = invoices.reduce((s, i) => s + i.balanceDuePaisa, 0);
    return { collected, outstanding };
  }, [payments, invoices]);

  const openModal = () => {
    const first = openInvoices[0];
    setInvoiceId(first?.id || '');
    setAmountInr(first ? (first.balanceDuePaisa / 100).toFixed(2) : '');
    setReferenceNumber('');
    setNotes('');
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;

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
        inv,
        {
          receiptNumber: makeDocNumber('RCPT'),
          amountPaisa: rupeeInputToPaisa(amountInr),
          paymentMode,
          referenceNumber: referenceNumber.trim(),
          paymentDate,
          notes: notes.trim(),
        }
      );
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Payments & Outstanding"
        subtitle="Customer receipt settlements, payment mode tracking, and real-time receivables balances."
        actions={
          !readOnly &&
          openInvoices.length > 0 && (
            <button
              type="button"
              onClick={openModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Record Payment Receipt</span>
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Total Collected"
          value={formatPaisaToInr(totals.collected)}
          tone="success"
        />
        <KpiCard
          label="Total Outstanding Due"
          value={formatPaisaToInr(totals.outstanding)}
          tone={totals.outstanding > 0 ? 'danger' : 'success'}
        />
        <KpiCard label="Open Unpaid/Partial Invoices" value={`${openInvoices.length}`} />
      </div>

      {/* Customer Outstanding Summary */}
      {customers.some((c) => c.outstandingPaisa > 0) && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Customer Receivables Breakdown
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Customer</th>
                  <th className="text-right font-medium px-4 py-2.5">Credit Limit</th>
                  <th className="text-right font-medium px-4 py-2.5">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers
                  .filter((c) => c.outstandingPaisa > 0)
                  .map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {c.businessName}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {formatPaisaToInr(c.creditLimitPaisa)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-red-700">
                        {formatPaisaToInr(c.outstandingPaisa)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payments.length === 0 ? (
        <EmptyState
          title="No payment receipts recorded"
          description="Record a customer payment against an open GST invoice."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Payment Receipts Ledger</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Receipt No</th>
                  <th className="text-left font-medium px-4 py-3">Date</th>
                  <th className="text-left font-medium px-4 py-3">Invoice</th>
                  <th className="text-left font-medium px-4 py-3">Customer</th>
                  <th className="text-left font-medium px-4 py-3">Mode & Ref</th>
                  <th className="text-right font-medium px-4 py-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                      {p.receiptNumber}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {p.paymentDate}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {p.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{p.customerName}</td>
                    <td className="px-4 py-3">
                      <StatusTag status={p.paymentMode} tone="info" />
                      {p.referenceNumber && (
                        <span className="ml-2 font-mono text-xs text-slate-500">
                          {p.referenceNumber}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                      {formatPaisaToInr(p.amountPaisa)}
                    </td>
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
        title="Record Customer Payment"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Open GST Invoice
            </label>
            <select
              value={invoiceId}
              onChange={(e) => {
                setInvoiceId(e.target.value);
                const found = openInvoices.find((i) => i.id === e.target.value);
                if (found) setAmountInr((found.balanceDuePaisa / 100).toFixed(2));
              }}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              {openInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNumber} — {i.customerName} (Due:{' '}
                  {formatPaisaToInr(i.balanceDuePaisa)})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Amount (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountInr}
                onChange={(e) => setAmountInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as Payment['paymentMode'])}
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
                Reference / UTR
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
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
              {submitting ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
