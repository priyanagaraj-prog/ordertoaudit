import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { KpiCard, PageHeader, StatusTag } from '../components/ErpUi';
import type {
  AuditLog,
  CompanySetting,
  GstInvoice,
  InventoryBatch,
  PackagingMaterial,
  Payment,
  Product,
  ProductionRun,
  QcInspection,
  RawMaterial,
  StockMovement,
} from '../types/erp';
import { exportAuditExcelWorkbook, exportMonthlyAuditPdf } from '../utils/exportReports';
import { formatPaisaToInr } from '../utils/money';

interface ReportsAnalyticsPageProps {
  company: CompanySetting | null;
  invoices: GstInvoice[];
  payments: Payment[];
  productionRuns: ProductionRun[];
  products: Product[];
  rawMaterials: RawMaterial[];
  packagingMaterials: PackagingMaterial[];
  stockMovements: StockMovement[];
  auditLogs: AuditLog[];
  batches?: InventoryBatch[];
  qcInspections?: QcInspection[];
}

export function ReportsAnalyticsPage({
  company,
  invoices,
  payments,
  productionRuns,
  products,
  rawMaterials,
  packagingMaterials,
  stockMovements,
  auditLogs,
  batches = [],
  qcInspections = [],
}: ReportsAnalyticsPageProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((i) => set.add(i.invoiceDate.slice(0, 7)));
    payments.forEach((p) => set.add(p.paymentDate.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [invoices, payments]);

  const filteredInvoices = useMemo(
    () =>
      selectedMonth === 'all'
        ? invoices
        : invoices.filter((i) => i.invoiceDate.startsWith(selectedMonth)),
    [invoices, selectedMonth]
  );

  const filteredPayments = useMemo(
    () =>
      selectedMonth === 'all'
        ? payments
        : payments.filter((p) => p.paymentDate.startsWith(selectedMonth)),
    [payments, selectedMonth]
  );

  const metrics = useMemo(() => {
    const taxableSalesPaisa = filteredInvoices.reduce((s, i) => s + i.subtotalPaisa, 0);
    const cgstPaisa = filteredInvoices.reduce((s, i) => s + i.cgstPaisa, 0);
    const sgstPaisa = filteredInvoices.reduce((s, i) => s + i.sgstPaisa, 0);
    const igstPaisa = filteredInvoices.reduce((s, i) => s + i.igstPaisa, 0);
    const totalSalesPaisa = filteredInvoices.reduce((s, i) => s + i.totalAmountPaisa, 0);
    const collectionsPaisa = filteredPayments.reduce((s, p) => s + p.amountPaisa, 0);
    const closingStockPaisa =
      rawMaterials.reduce((s, m) => s + Math.round(m.currentStock * m.costPerUnitPaisa), 0) +
      packagingMaterials.reduce((s, m) => s + Math.round(m.currentStock * m.costPerUnitPaisa), 0) +
      products.reduce((s, p) => s + Math.round(p.currentStock * p.standardCostPaisa), 0);

    return {
      taxableSalesPaisa,
      cgstPaisa,
      sgstPaisa,
      igstPaisa,
      totalTaxPaisa: cgstPaisa + sgstPaisa + igstPaisa,
      totalSalesPaisa,
      collectionsPaisa,
      closingStockPaisa,
    };
  }, [filteredInvoices, filteredPayments, rawMaterials, packagingMaterials, products]);

  const monthLabel = selectedMonth === 'all' ? 'All Periods' : selectedMonth;

  const qcPassedCount = qcInspections.filter((q) => q.status === 'passed').length;
  const qcRejectedCount = qcInspections.filter((q) => q.status === 'rejected').length;
  const activeBatchCount = batches.filter((b) => b.remainingQty > 0).length;

  return (
    <div>
      <PageHeader
        title="Reports & Monthly Audit Center"
        subtitle="GST tax summaries, closing inventory valuation, batch QC compliance, production variance, and immutable audit logs."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white font-mono"
            >
              <option value="all">All Periods</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                exportMonthlyAuditPdf({
                  monthLabel,
                  company,
                  invoices: filteredInvoices,
                  payments: filteredPayments,
                  productionRuns,
                  products,
                  rawMaterials,
                  packagingMaterials,
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Export Audit PDF</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportAuditExcelWorkbook({
                  monthLabel,
                  invoices: filteredInvoices,
                  payments: filteredPayments,
                  productionRuns,
                  stockMovements,
                  auditLogs,
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export Excel Workbook</span>
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Taxable Sales"
          value={formatPaisaToInr(metrics.taxableSalesPaisa)}
          tone="navy"
        />
        <KpiCard
          label="Output GST Liability"
          value={formatPaisaToInr(metrics.totalTaxPaisa)}
          hint={`CGST ${formatPaisaToInr(metrics.cgstPaisa)} · SGST ${formatPaisaToInr(
            metrics.sgstPaisa
          )} · IGST ${formatPaisaToInr(metrics.igstPaisa)}`}
        />
        <KpiCard
          label="Payments Collected"
          value={formatPaisaToInr(metrics.collectionsPaisa)}
          tone="success"
        />
        <KpiCard
          label="Closing Inventory Valuation"
          value={formatPaisaToInr(metrics.closingStockPaisa)}
          hint="Raw + Packaging + Finished Goods"
        />
      </div>

      {/* GST Tax Summary Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">GST Output Tax Breakdown</h2>
          <span className="text-xs font-mono text-slate-500">
            Active Lots: {activeBatchCount} · QC Passed: {qcPassedCount} · QC Rejected:{' '}
            {qcRejectedCount}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-sm">
          <div className="p-4">
            <p className="text-xs text-slate-500">Taxable Value</p>
            <p className="mt-1 font-mono font-semibold text-slate-900">
              {formatPaisaToInr(metrics.taxableSalesPaisa)}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-slate-500">CGST Payable</p>
            <p className="mt-1 font-mono font-semibold text-slate-900">
              {formatPaisaToInr(metrics.cgstPaisa)}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-slate-500">SGST Payable</p>
            <p className="mt-1 font-mono font-semibold text-slate-900">
              {formatPaisaToInr(metrics.sgstPaisa)}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-slate-500">IGST Payable</p>
            <p className="mt-1 font-mono font-semibold text-slate-900">
              {formatPaisaToInr(metrics.igstPaisa)}
            </p>
          </div>
        </div>
      </div>

      {/* Immutable Audit Logs */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Compliance Audit Trail</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Append-only log of orders, invoices, dispatches, stock movements, and role changes
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">{auditLogs.length} events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left font-medium px-4 py-3">Action</th>
                <th className="text-left font-medium px-4 py-3">Entity</th>
                <th className="text-left font-medium px-4 py-3">Actor</th>
                <th className="text-left font-medium px-4 py-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.slice(0, 50).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <StatusTag status={log.action} tone="info" />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                    {log.entityType}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    <span className="font-medium text-slate-800">{log.actorEmail}</span>
                    <span className="block text-slate-400">{log.actorRole}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{log.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
