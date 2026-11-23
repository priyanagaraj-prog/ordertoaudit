import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Factory,
  PackageSearch,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  XCircle,
} from 'lucide-react';
import { EmptyState, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import {
  createProductionRun,
  createPurchaseRequest,
  createSalesOrder,
  generateGstInvoiceTransaction,
  makeDocNumber,
  updateSalesOrderStatus,
} from '../services/erpService';
import type {
  Bom,
  CompanySetting,
  Customer,
  PackagingMaterial,
  Product,
  RawMaterial,
  SalesOrder,
} from '../types/erp';
import {
  evaluateOrderFulfillmentPlan,
  evaluateStockAvailability,
} from '../utils/erpEngine';
import { computeLineTaxPaisa, formatGstBps, formatPaisaToInr } from '../utils/money';

interface SalesOrdersPageProps {
  orders: SalesOrder[];
  customers: Customer[];
  products: Product[];
  company: CompanySetting | null;
  boms?: Bom[];
  rawMaterials?: RawMaterial[];
  packagingMaterials?: PackagingMaterial[];
}

export function SalesOrdersPage({
  orders,
  customers,
  products,
  company,
  boms = [],
  rawMaterials = [],
  packagingMaterials = [],
}: SalesOrdersPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('sales_orders');
  const canBill = profile?.role === 'owner' || profile?.role === 'admin';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [draftLines, setDraftLines] = useState<Array<{ productId: string; quantity: string }>>([
    { productId: '', quantity: '10' },
  ]);

  // Order Approval / Reject & MRP Check Modal States
  const [rejectTarget, setRejectTarget] = useState<SalesOrder | null>(null);
  const [rejectReason, setRejectReason] = useState('Insufficient stock or credit limit hold');
  const [mrpOrder, setMrpOrder] = useState<SalesOrder | null>(null);

  const companyStateCode = company?.stateCode || '33';
  const selectedCustomer = customers.find((c) => c.id === customerId) || null;
  const isInterState = selectedCustomer ? selectedCustomer.stateCode !== companyStateCode : false;

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const draftShortages = useMemo(() => {
    return draftLines
      .map((line) => {
        const prod = productById.get(line.productId);
        const qty = Number(line.quantity);
        if (!prod || !Number.isFinite(qty) || qty <= 0) return null;
        const check = evaluateStockAvailability(qty, prod.currentStock);
        if (check.sufficient) return null;
        return {
          productName: prod.name,
          unit: prod.unit,
          ...check,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [draftLines, productById]);

  const previewSummary = useMemo(() => {
    let subtotalPaisa = 0;
    let totalTaxPaisa = 0;
    draftLines.forEach((line) => {
      const prod = productById.get(line.productId);
      const qty = Number(line.quantity);
      if (prod && qty > 0) {
        const calc = computeLineTaxPaisa(
          prod.sellingPricePaisa,
          qty,
          prod.gstBps,
          isInterState
        );
        subtotalPaisa += calc.lineSubtotalPaisa;
        totalTaxPaisa += calc.lineTaxPaisa;
      }
    });
    return {
      subtotalPaisa,
      totalTaxPaisa,
      totalAmountPaisa: subtotalPaisa + totalTaxPaisa,
    };
  }, [draftLines, productById, isInterState]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.salesmanName.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [orders, search, statusFilter]);

  const mrpPlan = useMemo(() => {
    if (!mrpOrder) return null;
    return evaluateOrderFulfillmentPlan({
      orderItems: mrpOrder.items,
      products,
      boms,
      rawMaterials,
      packagingMaterials,
    });
  }, [mrpOrder, products, boms, rawMaterials, packagingMaterials]);

  const handleOpenNewOrder = () => {
    setCustomerId(customers[0]?.id || '');
    setDraftLines([{ productId: products[0]?.id || '', quantity: '10' }]);
    setOrderDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedCustomer) return;

    const validItems = draftLines
      .map((line) => {
        const prod = productById.get(line.productId);
        const qty = Number(line.quantity);
        if (!prod || !Number.isFinite(qty) || qty <= 0) return null;
        return {
          productId: prod.id,
          sku: prod.sku,
          name: prod.name,
          hsnCode: prod.hsnCode,
          unit: prod.unit,
          quantity: qty,
          unitPricePaisa: prod.sellingPricePaisa,
          gstBps: prod.gstBps,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (validItems.length === 0) {
      setErrorMsg('Add at least one product with a positive quantity.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const prefix = company?.orderPrefix || 'KHF-ORD';
      await createSalesOrder(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        {
          customer: selectedCustomer,
          companyStateCode,
          orderNumber: makeDocNumber(prefix),
          orderDate,
          notes,
          items: validItems,
        }
      );
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create sales order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (order: SalesOrder, status: SalesOrder['status']) => {
    if (!profile) return;
    setErrorMsg(null);
    try {
      await updateSalesOrderStatus(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        order.id,
        status
      );
      setActionNotice(`Order ${order.orderNumber} updated to ${status.replace(/_/g, ' ')}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update order status.');
    }
  };

  const handleRejectOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !rejectTarget) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await updateSalesOrderStatus(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        rejectTarget.id,
        'rejected',
        { rejectionReason: rejectReason.trim() || 'Rejected by Merchant Operations' }
      );
      setActionNotice(`Rejected order ${rejectTarget.orderNumber}.`);
      setRejectTarget(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reject order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTriggerProductionFromMrp = async (
    order: SalesOrder,
    bomId: string,
    shortageQty: number
  ) => {
    if (!profile) return;
    const bom = boms.find((b) => b.id === bomId);
    if (!bom) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const actor = {
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
      };
      const runId = await createProductionRun(
        actor,
        bom,
        Math.ceil(shortageQty),
        makeDocNumber(company?.batchPrefix || 'KHF-BCH'),
        { orderId: order.id, orderNumber: order.orderNumber }
      );
      await updateSalesOrderStatus(actor, order.id, 'in_production', {
        linkedProductionRunId: runId,
      });
      setActionNotice(
        `Started production batch for ${bom.productName} (${Math.ceil(shortageQty)} units) linked to ${order.orderNumber}.`
      );
      setMrpOrder(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start linked production batch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePrFromShortage = async (
    order: SalesOrder,
    category: 'raw_material' | 'packaging',
    item: {
      itemId: string;
      code: string;
      name: string;
      unit: string;
      shortageQty: number;
      costPerUnitPaisa: number;
    }
  ) => {
    if (!profile) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createPurchaseRequest(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        {
          prNumber: makeDocNumber('PR'),
          sourceType: 'order_shortage',
          linkedOrderId: order.id,
          linkedOrderNumber: order.orderNumber,
          itemCategory: category,
          itemId: item.itemId,
          itemCode: item.code,
          itemName: item.name,
          unit: item.unit,
          requestedQty: Math.ceil(item.shortageQty * 1.25),
          estimatedUnitCostPaisa: item.costPerUnitPaisa,
          notes: `MRP shortfall for ${order.orderNumber} (${order.customerName})`,
        }
      );
      setActionNotice(
        `Raised Purchase Request for ${item.name} (+${Math.ceil(item.shortageQty * 1.25)} ${item.unit}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to raise purchase request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateInvoice = async (order: SalesOrder) => {
    if (!profile) return;
    const customer = customers.find((c) => c.id === order.customerId);
    if (!customer) {
      setErrorMsg('Customer record not found for invoicing.');
      return;
    }
    setErrorMsg(null);
    try {
      const prefix = company?.invoicePrefix || 'KHF-INV';
      await generateGstInvoiceTransaction(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        order,
        customer,
        companyStateCode,
        makeDocNumber(prefix)
      );
      setActionNotice(`Generated GST Tax Invoice for ${order.orderNumber}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate GST invoice.');
    }
  };

  const filterOptions = [
    'all',
    'awaiting_approval',
    'approved',
    'in_production',
    'ready_for_dispatch',
    'pending',
    'confirmed',
    'invoiced',
    'dispatched',
    'delivered',
    'rejected',
  ];

  return (
    <div>
      <PageHeader
        title="Order Management & MRP Fulfillment"
        subtitle={
          profile?.role === 'salesman'
            ? 'Mobile-ready field order entry and your personal sales history.'
            : 'Approve pending orders, verify finished & BOM raw stock (MRP), trigger production or PRs, and issue GST invoices.'
        }
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={handleOpenNewOrder}
              disabled={customers.length === 0 || products.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Sales Order</span>
            </button>
          )
        }
      />

      {errorMsg && !modalOpen && !mrpOrder && !rejectTarget && (
        <div className="mb-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {actionNotice && (
        <div className="mb-4 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center justify-between">
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-xs font-medium underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5 flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number, customer, salesman..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {filterOptions.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <EmptyState
          title="No sales orders match your filter"
          description="Create a new sales order to begin tracking dispatch and GST billing."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Order No</th>
                  <th className="text-left font-medium px-4 py-3">Date & Source</th>
                  <th className="text-left font-medium px-4 py-3">Customer</th>
                  <th className="text-left font-medium px-4 py-3">Items & Stock</th>
                  <th className="text-right font-medium px-4 py-3">Total (Incl. GST)</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  {canBill && <th className="text-right font-medium px-4 py-3">Workflow Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order) => {
                  const isUnfulfilled = [
                    'pending',
                    'awaiting_approval',
                    'approved',
                    'confirmed',
                    'in_production',
                    'ready_for_dispatch',
                  ].includes(order.status);

                  const itemShortages = isUnfulfilled
                    ? order.items
                        .map((it) => {
                          const prod = productById.get(it.productId);
                          if (!prod) return null;
                          const avail = evaluateStockAvailability(it.quantity, prod.currentStock);
                          return avail.sufficient ? null : { name: it.name, unit: it.unit, ...avail };
                        })
                        .filter((x): x is NonNullable<typeof x> => x !== null)
                    : [];

                  const canInvoiceNow =
                    ['pending', 'confirmed', 'approved', 'ready_for_dispatch'].includes(
                      order.status
                    ) && itemShortages.length === 0;

                  return (
                    <tr key={order.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-medium text-slate-900">
                        {order.orderNumber}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <p className="font-mono">{order.orderDate}</p>
                        <span className="text-slate-400">
                          {order.source === 'buyer_portal' ? 'Trade Order' : 'ERP Order'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{order.customerName}</p>
                        <p className="text-xs text-slate-500">
                          {order.salesmanName} · State {order.customerStateCode}
                        </p>
                        {order.rejectionReason && (
                          <p className="text-xs text-red-700 mt-0.5">
                            Reason: {order.rejectionReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-700 space-y-0.5">
                          {order.items.map((it, idx) => (
                            <p key={idx}>
                              {it.quantity} {it.unit} · {it.name}
                            </p>
                          ))}
                        </div>
                        {itemShortages.map((sh, idx) => (
                          <div
                            key={idx}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded"
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>
                              Insufficient stock: {sh.availableQty} avail, shortage {sh.shortageQty}{' '}
                              {sh.unit}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        <p>{formatPaisaToInr(order.totalAmountPaisa)}</p>
                        <p className="text-[11px] font-normal text-slate-500">
                          GST {formatPaisaToInr(order.totalTaxPaisa)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={order.status} />
                      </td>
                      {canBill && (
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end items-center gap-1.5">
                            {order.status === 'awaiting_approval' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateStatus(order, 'approved')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectTarget(order)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}

                            {order.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateStatus(order, 'confirmed')}
                                className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 cursor-pointer"
                              >
                                Confirm
                              </button>
                            )}

                            {isUnfulfilled && itemShortages.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setMrpOrder(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 cursor-pointer"
                              >
                                <PackageSearch className="w-3.5 h-3.5" />
                                <span>MRP & Produce</span>
                              </button>
                            )}

                            {['pending', 'confirmed', 'approved', 'ready_for_dispatch'].includes(
                              order.status
                            ) && (
                              <button
                                type="button"
                                onClick={() => void handleGenerateInvoice(order)}
                                disabled={!canInvoiceNow}
                                title={
                                  itemShortages.length > 0
                                    ? 'Insufficient finished stock — use MRP & Produce first'
                                    : 'Convert to GST Invoice'
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#0F294A] rounded-md hover:bg-[#173B6C] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                                <span>GST Invoice</span>
                              </button>
                            )}
                          </div>
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

      {/* Create Sales Order Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Sales Order"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleCreateOrder} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Customer Account
              </label>
              <select
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.businessName} ({c.city} · State {c.stateCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Order Date</label>
              <input
                type="date"
                required
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Order Line Items</label>
              <button
                type="button"
                onClick={() =>
                  setDraftLines((prev) => [
                    ...prev,
                    { productId: products[0]?.id || '', quantity: '10' },
                  ])
                }
                className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
              >
                + Add Product Row
              </button>
            </div>

            <div className="space-y-2.5">
              {draftLines.map((line, idx) => {
                const prod = productById.get(line.productId);
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <div className="sm:col-span-6">
                      <select
                        value={line.productId}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, productId: e.target.value } : l
                            )
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-md bg-white"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} (Stock: {p.currentStock} {p.unit} ·{' '}
                            {formatPaisaToInr(p.sellingPricePaisa)} · GST {formatGstBps(p.gstBps)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={(e) =>
                          setDraftLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, quantity: e.target.value } : l
                            )
                          )
                        }
                        placeholder="Qty"
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-md font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2 text-right text-xs font-mono text-slate-700">
                      {prod
                        ? formatPaisaToInr(
                            Math.round(prod.sellingPricePaisa * (Number(line.quantity) || 0))
                          )
                        : '₹0.00'}
                    </div>
                    <div className="sm:col-span-1 text-right">
                      {draftLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraftLines((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {draftShortages.length > 0 && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-red-800">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Insufficient Finished Stock Alert</span>
                </div>
                {draftShortages.map((sh, i) => (
                  <p key={i}>
                    <strong>{sh.productName}</strong>: Requested{' '}
                    <span className="font-mono">{sh.requestedQty}</span> {sh.unit}, Available{' '}
                    <span className="font-mono">{sh.availableQty}</span> {sh.unit} —{' '}
                    <span className="font-semibold text-red-700">
                      Shortage: {sh.shortageQty} {sh.unit}
                    </span>
                    . Order can be logged as pending backorder, but billing/dispatch will be blocked
                    until stock is replenished.
                  </p>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Delivery / Order Notes
            </label>
            <input
              type="text"
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Cold-chain morning dispatch requested"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
            <div className="text-slate-600">
              Tax Regime:{' '}
              <span className="font-semibold text-slate-900">
                {isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}
              </span>
            </div>
            <div className="flex flex-wrap gap-4 font-mono tabular-nums">
              <span>Sub: {formatPaisaToInr(previewSummary.subtotalPaisa)}</span>
              <span>GST: {formatPaisaToInr(previewSummary.totalTaxPaisa)}</span>
              <span className="font-bold text-[#0F294A]">
                Total: {formatPaisaToInr(previewSummary.totalAmountPaisa)}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Submitting...' : 'Submit Sales Order'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject Order Modal */}
      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={`Reject Order ${rejectTarget?.orderNumber || ''}`}
      >
        <form onSubmit={handleRejectOrder} className="space-y-4">
          <p className="text-xs text-slate-600">
            Provide an operational reason for rejecting this sales order.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Rejection Reason
            </label>
            <input
              type="text"
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setRejectTarget(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg cursor-pointer"
            >
              Confirm Reject
            </button>
          </div>
        </form>
      </Modal>

      {/* MRP & BOM Production / PR Check Modal */}
      <Modal
        open={Boolean(mrpOrder)}
        onClose={() => setMrpOrder(null)}
        title={`BOM & MRP Shortage Plan — ${mrpOrder?.orderNumber || ''}`}
        maxWidth="max-w-3xl"
      >
        {mrpOrder && mrpPlan && (
          <div className="space-y-4">
            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Finished Goods Shortages
              </p>
              {mrpPlan.fgShortages.map((fg) => (
                <div
                  key={fg.productId}
                  className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {fg.productName} ({fg.sku})
                    </p>
                    <p className="text-xs font-mono text-slate-600">
                      Requested {fg.requestedQty} · On Hand {fg.availableStock} ·{' '}
                      <span className="text-red-700 font-semibold">Shortage: {fg.shortageQty}</span>
                    </p>
                  </div>
                  {fg.bomId ? (
                    <button
                      type="button"
                      disabled={submitting || !fg.canProduceImmediately}
                      onClick={() =>
                        void handleTriggerProductionFromMrp(mrpOrder, fg.bomId!, fg.shortageQty)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg disabled:opacity-45 cursor-pointer"
                    >
                      <Factory className="w-3.5 h-3.5" />
                      <span>
                        {fg.canProduceImmediately
                          ? `Start Production (${Math.ceil(fg.shortageQty)} units)`
                          : 'Blocked by Raw Shortage'}
                      </span>
                    </button>
                  ) : (
                    <span className="text-xs text-red-700 font-medium">No BOM Defined</span>
                  )}
                </div>
              ))}
            </div>

            {(mrpPlan.rawMaterialShortages.length > 0 ||
              mrpPlan.packagingShortages.length > 0) && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
                  Upstream Raw Material & Packaging Shortfalls
                </p>
                {mrpPlan.rawMaterialShortages.map((rm) => (
                  <div
                    key={rm.itemId}
                    className="p-3 rounded-lg bg-red-50 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {rm.name} ({rm.code})
                      </p>
                      <p className="font-mono text-red-800">
                        Needed {rm.requiredQty} {rm.unit} · Available {rm.availableStock} · Short{' '}
                        {rm.shortageQty} {rm.unit}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        void handleCreatePrFromShortage(mrpOrder, 'raw_material', rm)
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F294A] rounded-lg cursor-pointer"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>Raise PR (+{Math.ceil(rm.shortageQty * 1.25)})</span>
                    </button>
                  </div>
                ))}
                {mrpPlan.packagingShortages.map((pm) => (
                  <div
                    key={pm.itemId}
                    className="p-3 rounded-lg bg-red-50 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {pm.name} ({pm.code})
                      </p>
                      <p className="font-mono text-red-800">
                        Needed {pm.requiredQty} {pm.unit} · Available {pm.availableStock} · Short{' '}
                        {pm.shortageQty} {pm.unit}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        void handleCreatePrFromShortage(mrpOrder, 'packaging', pm)
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F294A] rounded-lg cursor-pointer"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>Raise PR (+{Math.ceil(pm.shortageQty * 1.25)})</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
