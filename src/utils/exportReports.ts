/**
 * PDF & Excel Export Generators for Order-to-Audit ERP.
 * Uses jsPDF + jspdf-autotable for formal GST Tax Invoices and Monthly Audit Reports,
 * and SheetJS (xlsx) for multi-sheet Audit & Ledger Excel workbooks.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type {
  AuditLog,
  CompanySetting,
  GstInvoice,
  Payment,
  ProductionRun,
  Product,
  RawMaterial,
  PackagingMaterial,
  StockMovement,
} from '../types/erp';
import { formatGstBps, paisaToDecimalString } from './money';

function pdfCurrency(paisa: number): string {
  return `INR ${paisaToDecimalString(paisa)}`;
}

/**
 * Generates and downloads a GST Tax Invoice PDF.
 */
export function exportGstInvoicePdf(invoice: GstInvoice, company: CompanySetting | null): void {
  const doc = new jsPDF();

  // Header
  doc.setFillColor(15, 41, 74); // Navy Blue
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(company?.companyName || 'Order-to-Audit ERP', 14, 13);
  doc.setFontSize(9);
  doc.text(`GSTIN: ${company?.gstin || '33AABCK4821M1Z5'} | State: ${company?.stateName || 'Tamil Nadu'} (${invoice.companyStateCode})`, 14, 20);
  doc.setFontSize(13);
  doc.text('TAX INVOICE', 196, 15, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, 14, 38);
  doc.text(`Order Ref: ${invoice.orderNumber}`, 14, 44);
  doc.text(`Invoice Date: ${invoice.invoiceDate}`, 14, 50);
  doc.text(`Due Date: ${invoice.dueDate}`, 14, 56);

  doc.text(`Bill To: ${invoice.customerName}`, 120, 38);
  doc.text(`Customer GSTIN: ${invoice.customerGstin || 'Unregistered'}`, 120, 44);
  doc.text(`Place of Supply: State Code ${invoice.customerStateCode}`, 120, 50);
  doc.text(`Tax Type: ${invoice.isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}`, 120, 56);

  autoTable(doc, {
    startY: 64,
    head: [['SKU', 'Item Description', 'HSN', 'Qty', 'Rate (INR)', 'Taxable', 'GST', 'Tax Amt', 'Total (INR)']],
    body: invoice.items.map((item) => [
      item.sku,
      item.name,
      item.hsnCode,
      `${item.quantity} ${item.unit}`,
      paisaToDecimalString(item.unitPricePaisa),
      paisaToDecimalString(item.lineSubtotalPaisa),
      formatGstBps(item.gstBps),
      paisaToDecimalString(item.lineTaxPaisa),
      paisaToDecimalString(item.lineTotalPaisa),
    ]),
    headStyles: { fillColor: [15, 41, 74], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    styles: { cellPadding: 2.5 },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 140;
  doc.setFontSize(10);
  doc.text(`Taxable Subtotal: ${pdfCurrency(invoice.subtotalPaisa)}`, 196, finalY + 12, { align: 'right' });
  if (invoice.isInterState) {
    doc.text(`IGST: ${pdfCurrency(invoice.igstPaisa)}`, 196, finalY + 18, { align: 'right' });
  } else {
    doc.text(`CGST: ${pdfCurrency(invoice.cgstPaisa)}`, 196, finalY + 18, { align: 'right' });
    doc.text(`SGST: ${pdfCurrency(invoice.sgstPaisa)}`, 196, finalY + 24, { align: 'right' });
  }
  doc.setFontSize(11);
  doc.text(`Grand Total: ${pdfCurrency(invoice.totalAmountPaisa)}`, 196, finalY + 32, { align: 'right' });
  doc.setFontSize(9);
  doc.text(`Paid: ${pdfCurrency(invoice.paidAmountPaisa)} | Balance Due: ${pdfCurrency(invoice.balanceDuePaisa)}`, 196, finalY + 39, { align: 'right' });

  doc.save(`${invoice.invoiceNumber}.pdf`);
}

/**
 * Exports a comprehensive Monthly Audit Report PDF.
 */
export function exportMonthlyAuditPdf(params: {
  monthLabel: string;
  company: CompanySetting | null;
  invoices: GstInvoice[];
  payments: Payment[];
  productionRuns: ProductionRun[];
  products: Product[];
  rawMaterials: RawMaterial[];
  packagingMaterials: PackagingMaterial[];
}): void {
  const { monthLabel, company, invoices, payments, productionRuns, products, rawMaterials, packagingMaterials } = params;
  const doc = new jsPDF();

  doc.setFillColor(15, 41, 74);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(`${company?.companyName || 'Order-to-Audit ERP'} — Monthly Audit Report`, 14, 12);
  doc.setFontSize(9);
  doc.text(`Audit Period: ${monthLabel} | GSTIN: ${company?.gstin || 'N/A'} | Generated: ${new Date().toISOString().slice(0, 10)}`, 14, 19);

  const totalSalesPaisa = invoices.reduce((s, i) => s + i.totalAmountPaisa, 0);
  const totalTaxPaisa = invoices.reduce((s, i) => s + i.totalTaxPaisa, 0);
  const totalCollectedPaisa = payments.reduce((s, p) => s + p.amountPaisa, 0);
  const totalOutstandingPaisa = invoices.reduce((s, i) => s + i.balanceDuePaisa, 0);
  const completedRuns = productionRuns.filter((r) => r.status === 'completed');
  const totalVariancePaisa = completedRuns.reduce((s, r) => s + r.variancePaisa, 0);
  const rawStockVal = rawMaterials.reduce((s, m) => s + Math.round(m.currentStock * m.costPerUnitPaisa), 0);
  const pkgStockVal = packagingMaterials.reduce((s, m) => s + Math.round(m.currentStock * m.costPerUnitPaisa), 0);
  const fgStockVal = products.reduce((s, p) => s + Math.round(p.currentStock * p.standardCostPaisa), 0);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.text('1. Executive Financial & Inventory Audit Summary', 14, 36);

  autoTable(doc, {
    startY: 40,
    head: [['Audit Metric', 'Value (INR)']],
    body: [
      ['Total Billed Sales (Incl. GST)', pdfCurrency(totalSalesPaisa)],
      ['Total GST Output Tax Liability', pdfCurrency(totalTaxPaisa)],
      ['Payments Collected in Period', pdfCurrency(totalCollectedPaisa)],
      ['Total Receivables Outstanding', pdfCurrency(totalOutstandingPaisa)],
      ['Net Production Cost Variance', pdfCurrency(totalVariancePaisa)],
      ['Closing Raw Material Valuation', pdfCurrency(rawStockVal)],
      ['Closing Packaging Valuation', pdfCurrency(pkgStockVal)],
      ['Closing Finished Goods Valuation', pdfCurrency(fgStockVal)],
    ],
    headStyles: { fillColor: [15, 41, 74], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });

  const y1 = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 110;
  doc.setFontSize(11);
  doc.text('2. GST Sales Register', 14, y1 + 10);

  autoTable(doc, {
    startY: y1 + 14,
    head: [['Invoice No', 'Date', 'Customer', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Status']],
    body: invoices.map((inv) => [
      inv.invoiceNumber,
      inv.invoiceDate,
      inv.customerName,
      paisaToDecimalString(inv.subtotalPaisa),
      paisaToDecimalString(inv.cgstPaisa),
      paisaToDecimalString(inv.sgstPaisa),
      paisaToDecimalString(inv.igstPaisa),
      paisaToDecimalString(inv.totalAmountPaisa),
      inv.paymentStatus.toUpperCase(),
    ]),
    headStyles: { fillColor: [15, 41, 74], fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5 },
  });

  doc.addPage();
  doc.setFontSize(11);
  doc.text('3. Production Costing & Variance Audit', 14, 18);

  autoTable(doc, {
    startY: 22,
    head: [['Batch', 'Product', 'Planned', 'Output', 'Wastage', 'Std Cost', 'Actual Cost', 'Variance']],
    body: completedRuns.map((run) => [
      run.batchNumber,
      run.productName,
      String(run.plannedQty),
      String(run.actualOutputQty),
      String(run.wastageQty),
      paisaToDecimalString(run.standardCostPaisa),
      paisaToDecimalString(run.actualTotalCostPaisa),
      paisaToDecimalString(run.variancePaisa),
    ]),
    headStyles: { fillColor: [15, 41, 74], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  });

  doc.save(`OrderToAudit_Monthly_Report_${monthLabel.replace(/\s+/g, '_')}.pdf`);
}

/**
 * Exports a Multi-Sheet Audit & Operations Excel Workbook (.xlsx).
 */
export function exportAuditExcelWorkbook(params: {
  monthLabel: string;
  invoices: GstInvoice[];
  payments: Payment[];
  productionRuns: ProductionRun[];
  stockMovements: StockMovement[];
  auditLogs: AuditLog[];
}): void {
  const wb = XLSX.utils.book_new();

  const salesSheet = XLSX.utils.json_to_sheet(
    params.invoices.map((i) => ({
      'Invoice Number': i.invoiceNumber,
      'Order Number': i.orderNumber,
      Date: i.invoiceDate,
      Customer: i.customerName,
      'Customer GSTIN': i.customerGstin || '',
      'Supply Type': i.isInterState ? 'Inter-State' : 'Intra-State',
      'Subtotal (INR)': Number(paisaToDecimalString(i.subtotalPaisa)),
      'CGST (INR)': Number(paisaToDecimalString(i.cgstPaisa)),
      'SGST (INR)': Number(paisaToDecimalString(i.sgstPaisa)),
      'IGST (INR)': Number(paisaToDecimalString(i.igstPaisa)),
      'Grand Total (INR)': Number(paisaToDecimalString(i.totalAmountPaisa)),
      'Paid (INR)': Number(paisaToDecimalString(i.paidAmountPaisa)),
      'Balance Due (INR)': Number(paisaToDecimalString(i.balanceDuePaisa)),
      'Payment Status': i.paymentStatus,
      'Dispatch Status': i.dispatchStatus,
    }))
  );
  XLSX.utils.book_append_sheet(wb, salesSheet, 'GST Sales Register');

  const prodSheet = XLSX.utils.json_to_sheet(
    params.productionRuns.map((r) => ({
      'Batch Number': r.batchNumber,
      SKU: r.productSku,
      Product: r.productName,
      Status: r.status,
      'Planned Qty': r.plannedQty,
      'Actual Output': r.actualOutputQty,
      'Wastage Qty': r.wastageQty,
      'Standard Cost (INR)': Number(paisaToDecimalString(r.standardCostPaisa)),
      'Actual Cost (INR)': Number(paisaToDecimalString(r.actualTotalCostPaisa)),
      'Variance (INR)': Number(paisaToDecimalString(r.variancePaisa)),
      'Completed At': r.completedAt || '',
    }))
  );
  XLSX.utils.book_append_sheet(wb, prodSheet, 'Production & Costing');

  const paymentSheet = XLSX.utils.json_to_sheet(
    params.payments.map((p) => ({
      'Receipt Number': p.receiptNumber,
      'Invoice Number': p.invoiceNumber,
      Customer: p.customerName,
      'Amount (INR)': Number(paisaToDecimalString(p.amountPaisa)),
      Mode: p.paymentMode,
      Reference: p.referenceNumber || '',
      'Payment Date': p.paymentDate,
    }))
  );
  XLSX.utils.book_append_sheet(wb, paymentSheet, 'Payments');

  const ledgerSheet = XLSX.utils.json_to_sheet(
    params.stockMovements.map((m) => ({
      'Item Type': m.itemType,
      Code: m.itemCode,
      Item: m.itemName,
      Movement: m.movementType,
      Unit: m.unit,
      'Before Qty': m.beforeQty,
      'Change Qty': m.changeQty,
      'After Qty': m.afterQty,
      'Total Value (INR)': Number(paisaToDecimalString(m.totalValuePaisa)),
      'Reference Type': m.refType,
      'Reference No': m.refNumber,
      Actor: m.actorName || m.actorUid,
    }))
  );
  XLSX.utils.book_append_sheet(wb, ledgerSheet, 'Stock Ledger');

  const auditSheet = XLSX.utils.json_to_sheet(
    params.auditLogs.map((a) => ({
      Action: a.action,
      Entity: a.entityType,
      'Entity ID': a.entityId,
      Actor: a.actorEmail,
      Role: a.actorRole,
      Summary: a.summary,
    }))
  );
  XLSX.utils.book_append_sheet(wb, auditSheet, 'Audit Trail');

  XLSX.writeFile(wb, `OrderToAudit_ERP_Audit_${params.monthLabel.replace(/\s+/g, '_')}.xlsx`);
}

/**
 * Exports filtered Stock Ledger rows to Excel.
 */
export function exportStockLedgerExcel(movements: StockMovement[]): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    movements.map((m) => ({
      'Item Type': m.itemType,
      Code: m.itemCode,
      'Item Name': m.itemName,
      'Movement Type': m.movementType,
      Unit: m.unit,
      'Before Qty': m.beforeQty,
      'Change Qty': m.changeQty,
      'After Qty': m.afterQty,
      'Unit Cost (INR)': Number(paisaToDecimalString(m.unitCostPaisa)),
      'Total Value (INR)': Number(paisaToDecimalString(m.totalValuePaisa)),
      'Ref Type': m.refType,
      'Ref No': m.refNumber,
      Actor: m.actorName || m.actorUid,
    }))
  );
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Movements');
  XLSX.writeFile(wb, `Stock_Ledger_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
