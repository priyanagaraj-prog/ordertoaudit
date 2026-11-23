import React, { useState } from 'react';
import { Building2, ClipboardList, PackageCheck, Plus, ShoppingBag } from 'lucide-react';
import { EmptyState, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import {
  convertPrToPurchaseOrder,
  createPurchaseOrder,
  createPurchaseRequest,
  createSupplier,
  makeDocNumber,
  receivePurchaseTransaction,
} from '../services/erpService';
import {
  INDIAN_STATES,
  type PackagingMaterial,
  type Purchase,
  type PurchaseRequest,
  type RawMaterial,
  type Supplier,
} from '../types/erp';
import { formatPaisaToInr, rupeeInputToPaisa } from '../utils/money';

interface PurchasesPageProps {
  purchases: Purchase[];
  rawMaterials: RawMaterial[];
  packagingMaterials: PackagingMaterial[];
  suppliers?: Supplier[];
  purchaseRequests?: PurchaseRequest[];
}

export function PurchasesPage({
  purchases,
  rawMaterials,
  packagingMaterials,
  suppliers = [],
  purchaseRequests = [],
}: PurchasesPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('purchases');

  const [tab, setTab] = useState<'po' | 'pr' | 'suppliers'>('po');
  const [modalOpen, setModalOpen] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierGstin, setSupplierGstin] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [itemCategory, setItemCategory] = useState<'raw_material' | 'packaging'>('raw_material');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [qty, setQty] = useState('100');
  const [unitCostInr, setUnitCostInr] = useState('60.00');
  const [gstBps, setGstBps] = useState('500');

  // GRN Batch Receipt Modal
  const [grnPo, setGrnPo] = useState<Purchase | null>(null);
  const [grnInvoiceRef, setGrnInvoiceRef] = useState('');
  const [grnBatchNo, setGrnBatchNo] = useState('');
  const [grnMfgDate, setGrnMfgDate] = useState(new Date().toISOString().slice(0, 10));
  const [grnExpDate, setGrnExpDate] = useState(
    new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10)
  );

  // New PR Modal
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [prCat, setPrCat] = useState<'raw_material' | 'packaging'>('raw_material');
  const [prItemId, setPrItemId] = useState('');
  const [prQty, setPrQty] = useState('150');
  const [prNotes, setPrNotes] = useState('');

  // Convert PR -> PO Modal
  const [convertPrTarget, setConvertPrTarget] = useState<PurchaseRequest | null>(null);
  const [convertSupplierIdx, setConvertSupplierIdx] = useState('0');

  // New Supplier Modal
  const [supModalOpen, setSupModalOpen] = useState(false);
  const [supCode, setSupCode] = useState('');
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supGstin, setSupGstin] = useState('');
  const [supStateCode, setSupStateCode] = useState('33');
  const [supCategory, setSupCategory] = useState('Grains & Pulses');
  const [supLeadDays, setSupLeadDays] = useState('3');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openModal = () => {
    setItemCategory('raw_material');
    setSelectedItemId(rawMaterials[0]?.id || '');
    setSupplierName(suppliers[0]?.name || rawMaterials[0]?.supplierName || '');
    setSupplierGstin(suppliers[0]?.gstin || '');
    setInvoiceRef('');
    setQty('100');
    setUnitCostInr(
      rawMaterials[0] ? (rawMaterials[0].costPerUnitPaisa / 100).toFixed(2) : '60.00'
    );
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openGrnModal = (po: Purchase) => {
    setGrnPo(po);
    setGrnInvoiceRef(po.invoiceRef || `INV-${po.purchaseNumber}`);
    setGrnBatchNo(makeDocNumber('LOT-RM'));
    setGrnMfgDate(new Date().toISOString().slice(0, 10));
    setGrnExpDate(new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10));
    setErrorMsg(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const pool = itemCategory === 'raw_material' ? rawMaterials : packagingMaterials;
    const item = pool.find((x) => x.id === selectedItemId);
    if (!item) return;

    const quantity = Number(qty);
    const unitCostPaisa = rupeeInputToPaisa(unitCostInr);
    const gst = Number(gstBps);
    const subtotalPaisa = Math.round(quantity * unitCostPaisa);
    const totalTaxPaisa = Math.round((subtotalPaisa * gst) / 10000);
    const totalAmountPaisa = subtotalPaisa + totalTaxPaisa;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createPurchaseOrder(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        {
          purchaseNumber: makeDocNumber('PO'),
          supplierName: supplierName.trim(),
          supplierGstin: supplierGstin.trim().toUpperCase(),
          invoiceRef: invoiceRef.trim(),
          itemCategory,
          items: [
            {
              itemId: item.id,
              code: item.code,
              name: item.name,
              unit: item.unit,
              quantity,
              unitCostPaisa,
              gstBps: gst,
              lineTotalPaisa: totalAmountPaisa,
            },
          ],
          subtotalPaisa,
          totalTaxPaisa,
          totalAmountPaisa,
        }
      );
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create purchase order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !grnPo) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await receivePurchaseTransaction(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        grnPo.id,
        grnInvoiceRef.trim(),
        {
          grnNumber: makeDocNumber('GRN'),
          batchNumber: grnBatchNo.trim(),
          mfgDate: grnMfgDate,
          expiryDate: grnExpDate,
        }
      );
      setGrnPo(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to receive GRN.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const pool = prCat === 'raw_material' ? rawMaterials : packagingMaterials;
    const item = pool.find((x) => x.id === prItemId);
    if (!item) return;

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
          sourceType: 'manual',
          itemCategory: prCat,
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          unit: item.unit,
          requestedQty: Number(prQty),
          estimatedUnitCostPaisa: item.costPerUnitPaisa,
          notes: prNotes.trim(),
        }
      );
      setPrModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create PR.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConvertPr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !convertPrTarget) return;
    const sup = suppliers[Number(convertSupplierIdx)] || {
      name: 'Cauvery Agro Mills, Erode',
      gstin: '',
    };
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await convertPrToPurchaseOrder(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        convertPrTarget,
        { id: 'id' in sup ? sup.id : undefined, name: sup.name, gstin: sup.gstin }
      );
      setConvertPrTarget(null);
      setTab('po');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to convert PR to PO.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const st = INDIAN_STATES.find((s) => s.code === supStateCode) || INDIAN_STATES[0];
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createSupplier(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        {
          code: supCode.trim(),
          name: supName.trim(),
          contactPerson: supContact.trim(),
          phone: supPhone.trim(),
          gstin: supGstin.trim().toUpperCase(),
          stateCode: st.code,
          stateName: st.name,
          category: supCategory.trim(),
          leadTimeDays: Number(supLeadDays) || 3,
          status: 'active',
        }
      );
      setSupModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create supplier.');
    } finally {
      setSubmitting(false);
    }
  };

  const activePool = itemCategory === 'raw_material' ? rawMaterials : packagingMaterials;
  const activePrPool = prCat === 'raw_material' ? rawMaterials : packagingMaterials;

  return (
    <div>
      <PageHeader
        title="Procurement Hub (Suppliers, PR -> PO -> GRN)"
        subtitle="Manage approved raw/packaging vendors, raise Purchase Requests (PR), issue POs, and log batch/expiry Goods Receipt Notes (GRN)."
        actions={
          !readOnly && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPrCat('raw_material');
                  setPrItemId(rawMaterials[0]?.id || '');
                  setPrQty('150');
                  setPrNotes('');
                  setErrorMsg(null);
                  setPrModalOpen(true);
                }}
                disabled={rawMaterials.length === 0 && packagingMaterials.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#0F294A] bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                <ClipboardList className="w-4 h-4" />
                <span>New PR</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSupCode(`SUP-TN-${Math.floor(10 + Math.random() * 89)}`);
                  setSupName('');
                  setSupContact('');
                  setSupPhone('');
                  setSupGstin('');
                  setErrorMsg(null);
                  setSupModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#0F294A] bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                <Building2 className="w-4 h-4" />
                <span>Add Supplier</span>
              </button>
              <button
                type="button"
                onClick={openModal}
                disabled={rawMaterials.length === 0 && packagingMaterials.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>New PO</span>
              </button>
            </div>
          )
        }
      />

      {errorMsg && !modalOpen && !grnPo && !prModalOpen && !supModalOpen && !convertPrTarget && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Hub Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 mb-5 inline-flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setTab('po')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            tab === 'po' ? 'bg-[#0F294A] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Purchase Orders & GRN ({purchases.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('pr')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            tab === 'pr' ? 'bg-[#0F294A] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Purchase Requests ({purchaseRequests.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('suppliers')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            tab === 'suppliers' ? 'bg-[#0F294A] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Approved Suppliers ({suppliers.length})
        </button>
      </div>

      {/* Tab 1: Purchase Orders */}
      {tab === 'po' &&
        (purchases.length === 0 ? (
          <EmptyState
            title="No purchase orders recorded"
            description="Create a purchase order or convert an approved Purchase Request to replenish inventory."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">PO / GRN</th>
                    <th className="text-left font-medium px-4 py-3">Supplier</th>
                    <th className="text-left font-medium px-4 py-3">Items & Lot</th>
                    <th className="text-right font-medium px-4 py-3">Total (Incl. GST)</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                    {!readOnly && <th className="text-right font-medium px-4 py-3">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchases.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-slate-900">{po.purchaseNumber}</p>
                        <p className="text-xs font-mono text-slate-500">
                          {po.grnNumber ? `${po.grnNumber}` : po.itemCategory.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{po.supplierName}</p>
                        <p className="text-xs font-mono text-slate-500">
                          {po.invoiceRef || 'Pending Bill'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>
                          {po.items.map((it) => `${it.name} (${it.quantity} ${it.unit})`).join(', ')}
                        </p>
                        {po.batchNumber && (
                          <p className="font-mono text-[11px] text-emerald-700 mt-0.5">
                            Lot {po.batchNumber} · Exp {po.expiryDate || 'N/A'}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatPaisaToInr(po.totalAmountPaisa)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={po.status} />
                      </td>
                      {!readOnly && (
                        <td className="px-4 py-3 text-right">
                          {po.status === 'ordered' && (
                            <button
                              type="button"
                              onClick={() => openGrnModal(po)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#0F294A] rounded-md hover:bg-[#173B6C] cursor-pointer"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              <span>Receive GRN & Lot</span>
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
        ))}

      {/* Tab 2: Purchase Requests */}
      {tab === 'pr' &&
        (purchaseRequests.length === 0 ? (
          <EmptyState
            title="No open Purchase Requests"
            description="Raise a PR manually, from Order Management MRP shortages, or from AI Smart Reorder alerts."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">PR Number</th>
                    <th className="text-left font-medium px-4 py-3">Item & Category</th>
                    <th className="text-left font-medium px-4 py-3">Source / Linked Order</th>
                    <th className="text-right font-medium px-4 py-3">Requested Qty</th>
                    <th className="text-right font-medium px-4 py-3">Est. Value</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                    {!readOnly && <th className="text-right font-medium px-4 py-3">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseRequests.map((pr) => (
                    <tr key={pr.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {pr.prNumber}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{pr.itemName}</p>
                        <p className="text-xs font-mono text-slate-500">
                          {pr.itemCode} · {pr.itemCategory.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p className="capitalize">{pr.sourceType.replace('_', ' ')}</p>
                        {pr.linkedOrderNumber && (
                          <p className="font-mono text-blue-700">{pr.linkedOrderNumber}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                        {pr.requestedQty} {pr.unit}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {formatPaisaToInr(
                          Math.round(pr.requestedQty * pr.estimatedUnitCostPaisa)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={pr.status} />
                      </td>
                      {!readOnly && (
                        <td className="px-4 py-3 text-right">
                          {pr.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => {
                                setConvertPrTarget(pr);
                                setConvertSupplierIdx('0');
                                setErrorMsg(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#0F294A] rounded-md hover:bg-[#173B6C] cursor-pointer"
                            >
                              <ShoppingBag className="w-3.5 h-3.5" />
                              <span>Convert to PO</span>
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
        ))}

      {/* Tab 3: Suppliers Directory */}
      {tab === 'suppliers' &&
        (suppliers.length === 0 ? (
          <EmptyState
            title="No approved suppliers registered"
            description="Add raw material and packaging vendors with GSTIN and lead time metrics."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Code & Vendor</th>
                    <th className="text-left font-medium px-4 py-3">Category</th>
                    <th className="text-left font-medium px-4 py-3">Contact</th>
                    <th className="text-left font-medium px-4 py-3">GSTIN & State</th>
                    <th className="text-right font-medium px-4 py-3">Lead Time</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{s.name}</p>
                        <p className="text-xs font-mono text-slate-500">{s.code}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{s.category}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p className="font-medium text-slate-800">{s.contactPerson}</p>
                        <p className="font-mono">{s.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-700">
                        <p>{s.gstin || 'Unregistered'}</p>
                        <p className="text-slate-500">
                          {s.stateName} ({s.stateCode})
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {s.leadTimeDays} days
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* Create PO Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Create Purchase Order">
        <form onSubmit={handleCreate} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Item Category
              </label>
              <select
                value={itemCategory}
                onChange={(e) => {
                  const cat = e.target.value as 'raw_material' | 'packaging';
                  setItemCategory(cat);
                  const pool = cat === 'raw_material' ? rawMaterials : packagingMaterials;
                  setSelectedItemId(pool[0]?.id || '');
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="raw_material">Raw Material</option>
                <option value="packaging">Packaging Material</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Item</label>
              <select
                value={selectedItemId}
                onChange={(e) => {
                  setSelectedItemId(e.target.value);
                  const found = activePool.find((x) => x.id === e.target.value);
                  if (found) {
                    setUnitCostInr((found.costPerUnitPaisa / 100).toFixed(2));
                    if (found.supplierName) setSupplierName(found.supplierName);
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {activePool.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.code} — {it.name} ({it.unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier Name
              </label>
              <input
                type="text"
                required
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier Invoice Ref
              </label>
              <input
                type="text"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Unit Cost (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={unitCostInr}
                onChange={(e) => setUnitCostInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GST Rate</label>
              <select
                value={gstBps}
                onChange={(e) => setGstBps(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="0">0%</option>
                <option value="500">5%</option>
                <option value="1200">12%</option>
                <option value="1800">18%</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier GSTIN
              </label>
              <input
                type="text"
                maxLength={15}
                value={supplierGstin}
                onChange={(e) => setSupplierGstin(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono uppercase"
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
              {submitting ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </form>
      </Modal>

      {/* GRN Batch Receipt Modal */}
      <Modal
        open={Boolean(grnPo)}
        onClose={() => setGrnPo(null)}
        title={`Receive Stock (GRN & Lot Registration) — ${grnPo?.purchaseNumber || ''}`}
      >
        {grnPo && (
          <form onSubmit={handleReceiveGrn} className="space-y-4">
            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {errorMsg}
              </div>
            )}
            <p className="text-xs text-slate-600">
              Receiving this GRN credits stock, updates weighted-average unit cost, creates a
              trackable FEFO lot in <strong>Inventory Hub</strong>, and queues the lot for{' '}
              <strong>Quality Control</strong>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Supplier Invoice Ref
                </label>
                <input
                  type="text"
                  required
                  value={grnInvoiceRef}
                  onChange={(e) => setGrnInvoiceRef(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Lot / Batch Number
                </label>
                <input
                  type="text"
                  required
                  value={grnBatchNo}
                  onChange={(e) => setGrnBatchNo(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Manufacturing / Harvest Date
                </label>
                <input
                  type="date"
                  required
                  value={grnMfgDate}
                  onChange={(e) => setGrnMfgDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Expiry / Best-Before Date
                </label>
                <input
                  type="date"
                  required
                  value={grnExpDate}
                  onChange={(e) => setGrnExpDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setGrnPo(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
              >
                {submitting ? 'Posting GRN...' : 'Confirm GRN & Register Lot'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* New Purchase Request Modal */}
      <Modal
        open={prModalOpen}
        onClose={() => setPrModalOpen(false)}
        title="New Purchase Request (PR)"
      >
        <form onSubmit={handleCreatePr} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={prCat}
                onChange={(e) => {
                  const cat = e.target.value as 'raw_material' | 'packaging';
                  setPrCat(cat);
                  const pool = cat === 'raw_material' ? rawMaterials : packagingMaterials;
                  setPrItemId(pool[0]?.id || '');
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="raw_material">Raw Material</option>
                <option value="packaging">Packaging Material</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Material</label>
              <select
                value={prItemId}
                onChange={(e) => setPrItemId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {activePrPool.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.code} — {it.name} ({it.currentStock} {it.unit} avail)
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Requested Quantity
            </label>
            <input
              type="number"
              min="1"
              required
              value={prQty}
              onChange={(e) => setPrQty(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Justification / Notes
            </label>
            <input
              type="text"
              value={prNotes}
              onChange={(e) => setPrNotes(e.target.value)}
              placeholder="e.g., Restock ahead of festival surge"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setPrModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg cursor-pointer"
            >
              Submit Purchase Request
            </button>
          </div>
        </form>
      </Modal>

      {/* Convert PR to PO Modal */}
      <Modal
        open={Boolean(convertPrTarget)}
        onClose={() => setConvertPrTarget(null)}
        title={`Convert ${convertPrTarget?.prNumber || ''} to Purchase Order`}
      >
        {convertPrTarget && (
          <form onSubmit={handleConvertPr} className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <p className="font-semibold text-slate-900">{convertPrTarget.itemName}</p>
              <p className="font-mono text-slate-600 mt-0.5">
                Qty: {convertPrTarget.requestedQty} {convertPrTarget.unit} · Est. Unit Cost:{' '}
                {formatPaisaToInr(convertPrTarget.estimatedUnitCostPaisa)}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Select Approved Vendor
              </label>
              <select
                value={convertSupplierIdx}
                onChange={(e) => setConvertSupplierIdx(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {suppliers.length > 0 ? (
                  suppliers.map((s, idx) => (
                    <option key={s.id} value={String(idx)}>
                      {s.name} ({s.category} · Lead {s.leadTimeDays}d)
                    </option>
                  ))
                ) : (
                  <option value="0">Cauvery Agro Mills, Erode</option>
                )}
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConvertPrTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg cursor-pointer"
              >
                Create Purchase Order
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Supplier Modal */}
      <Modal
        open={supModalOpen}
        onClose={() => setSupModalOpen(false)}
        title="Register Approved Supplier"
      >
        <form onSubmit={handleCreateSupplier} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier Code
              </label>
              <input
                type="text"
                required
                value={supCode}
                onChange={(e) => setSupCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier Name
              </label>
              <input
                type="text"
                required
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Contact Person
              </label>
              <input
                type="text"
                required
                value={supContact}
                onChange={(e) => setSupContact(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                required
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GSTIN</label>
              <input
                type="text"
                maxLength={15}
                value={supGstin}
                onChange={(e) => setSupGstin(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">State</label>
              <select
                value={supStateCode}
                onChange={(e) => setSupStateCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <input
                type="text"
                required
                value={supCategory}
                onChange={(e) => setSupCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Lead Time (Days)
              </label>
              <input
                type="number"
                min="1"
                required
                value={supLeadDays}
                onChange={(e) => setSupLeadDays(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setSupModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] rounded-lg cursor-pointer"
            >
              Save Supplier
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
