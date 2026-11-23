import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { EmptyState, Modal, PageHeader } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { saveBom } from '../services/erpService';
import type { Bom, PackagingMaterial, Product, RawMaterial } from '../types/erp';
import { formatPaisaToInr, rupeeInputToPaisa } from '../utils/money';

interface BomPageProps {
  boms: Bom[];
  products: Product[];
  rawMaterials: RawMaterial[];
  packagingMaterials: PackagingMaterial[];
}

export function BomPage({
  boms,
  products,
  rawMaterials,
  packagingMaterials,
}: BomPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('bom');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBomId, setEditingBomId] = useState<string | null>(null);
  const [productId, setProductId] = useState('');
  const [batchYieldQty, setBatchYieldQty] = useState('100');
  const [laborInr, setLaborInr] = useState('850.00');
  const [overheadInr, setOverheadInr] = useState('450.00');
  const [notes, setNotes] = useState('');
  const [rawItems, setRawItems] = useState<Array<{ itemId: string; qtyPerBatch: string }>>([]);
  const [pkgItems, setPkgItems] = useState<Array<{ itemId: string; qtyPerBatch: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openCreate = () => {
    setEditingBomId(null);
    setProductId(products[0]?.id || '');
    setBatchYieldQty('100');
    setLaborInr('850.00');
    setOverheadInr('450.00');
    setNotes('');
    setRawItems(rawMaterials[0] ? [{ itemId: rawMaterials[0].id, qtyPerBatch: '20' }] : []);
    setPkgItems(
      packagingMaterials[0] ? [{ itemId: packagingMaterials[0].id, qtyPerBatch: '100' }] : []
    );
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEdit = (bom: Bom) => {
    setEditingBomId(bom.id);
    setProductId(bom.productId);
    setBatchYieldQty(String(bom.batchYieldQty));
    setLaborInr((bom.standardLaborCostPaisa / 100).toFixed(2));
    setOverheadInr((bom.standardOverheadPaisa / 100).toFixed(2));
    setNotes(bom.notes || '');
    setRawItems(
      bom.rawMaterialItems.map((m) => ({
        itemId: m.itemId,
        qtyPerBatch: String(m.qtyPerBatch),
      }))
    );
    setPkgItems(
      bom.packagingItems.map((p) => ({
        itemId: p.itemId,
        qtyPerBatch: String(p.qtyPerBatch),
      }))
    );
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    const mappedRaw = rawItems
      .map((r) => {
        const rm = rawMaterials.find((x) => x.id === r.itemId);
        const qty = Number(r.qtyPerBatch);
        if (!rm || qty <= 0) return null;
        return {
          itemId: rm.id,
          code: rm.code,
          name: rm.name,
          unit: rm.unit,
          qtyPerBatch: qty,
          costPerUnitPaisa: rm.costPerUnitPaisa,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (mappedRaw.length === 0) {
      setErrorMsg('At least one raw material with a positive quantity is required.');
      return;
    }

    const mappedPkg = pkgItems
      .map((p) => {
        const pm = packagingMaterials.find((x) => x.id === p.itemId);
        const qty = Number(p.qtyPerBatch);
        if (!pm || qty <= 0) return null;
        return {
          itemId: pm.id,
          code: pm.code,
          name: pm.name,
          unit: pm.unit,
          qtyPerBatch: qty,
          costPerUnitPaisa: pm.costPerUnitPaisa,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await saveBom(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        editingBomId,
        {
          productId: prod.id,
          productSku: prod.sku,
          productName: prod.name,
          batchYieldQty: Number(batchYieldQty),
          batchUnit: prod.unit,
          standardLaborCostPaisa: rupeeInputToPaisa(laborInr),
          standardOverheadPaisa: rupeeInputToPaisa(overheadInr),
          rawMaterialItems: mappedRaw,
          packagingItems: mappedPkg,
          notes: notes.trim(),
        }
      );
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save BOM.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Bill of Materials (BOM)"
        subtitle="Standardized South Indian food recipes, packaging ratios, and batch labor/overhead standards."
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={openCreate}
              disabled={products.length === 0 || rawMaterials.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Create BOM</span>
            </button>
          )
        }
      />

      {boms.length === 0 ? (
        <EmptyState
          title="No Bills of Materials defined"
          description="Create a BOM recipe linking raw ingredients and packaging to a finished product SKU."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {boms.map((bom) => {
            const rawCostPaisa = bom.rawMaterialItems.reduce(
              (s, i) => s + Math.round(i.qtyPerBatch * i.costPerUnitPaisa),
              0
            );
            const pkgCostPaisa = bom.packagingItems.reduce(
              (s, i) => s + Math.round(i.qtyPerBatch * i.costPerUnitPaisa),
              0
            );
            const totalBatchCostPaisa =
              rawCostPaisa + pkgCostPaisa + bom.standardLaborCostPaisa + bom.standardOverheadPaisa;
            const unitStdCostPaisa =
              bom.batchYieldQty > 0 ? Math.round(totalBatchCostPaisa / bom.batchYieldQty) : 0;

            return (
              <div key={bom.id} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <p className="text-xs font-mono text-slate-500">{bom.productSku}</p>
                    <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                      {bom.productName}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Standard Batch Yield:{' '}
                      <span className="font-mono font-medium text-slate-800">
                        {bom.batchYieldQty} {bom.batchUnit}
                      </span>{' '}
                      · Std Unit Cost:{' '}
                      <span className="font-mono font-semibold text-[#0F294A]">
                        {formatPaisaToInr(unitStdCostPaisa)}
                      </span>
                    </p>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => openEdit(bom)}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer shrink-0"
                    >
                      Edit Recipe
                    </button>
                  )}
                </div>

                <div className="mt-4 space-y-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-700 mb-1.5">Raw Materials</p>
                    <div className="space-y-1">
                      {bom.rawMaterialItems.map((rm) => (
                        <div
                          key={rm.itemId}
                          className="flex justify-between text-slate-600 font-mono"
                        >
                          <span className="font-sans text-slate-700">
                            {rm.name} ({rm.qtyPerBatch} {rm.unit})
                          </span>
                          <span>
                            {formatPaisaToInr(Math.round(rm.qtyPerBatch * rm.costPerUnitPaisa))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {bom.packagingItems.length > 0 && (
                    <div>
                      <p className="font-semibold text-slate-700 mb-1.5">Packaging</p>
                      <div className="space-y-1">
                        {bom.packagingItems.map((pm) => (
                          <div
                            key={pm.itemId}
                            className="flex justify-between text-slate-600 font-mono"
                          >
                            <span className="font-sans text-slate-700">
                              {pm.name} ({pm.qtyPerBatch} {pm.unit})
                            </span>
                            <span>
                              {formatPaisaToInr(Math.round(pm.qtyPerBatch * pm.costPerUnitPaisa))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2.5 border-t border-slate-100 flex justify-between text-slate-700">
                    <span>Labor + Overhead</span>
                    <span className="font-mono">
                      {formatPaisaToInr(bom.standardLaborCostPaisa + bom.standardOverheadPaisa)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold text-slate-900">
                    <span>Total Standard Batch Cost</span>
                    <span className="font-mono">{formatPaisaToInr(totalBatchCostPaisa)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingBomId ? 'Update Bill of Materials' : 'Create Bill of Materials'}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Finished Product SKU
              </label>
              <select
                disabled={Boolean(editingBomId)}
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white disabled:bg-slate-50"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Standard Batch Yield Qty
              </label>
              <input
                type="number"
                min="1"
                step="1"
                required
                value={batchYieldQty}
                onChange={(e) => setBatchYieldQty(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Standard Labor Cost / Batch (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={laborInr}
                onChange={(e) => setLaborInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Standard Overhead / Batch (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={overheadInr}
                onChange={(e) => setOverheadInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700">Raw Material Inputs</label>
              <button
                type="button"
                onClick={() =>
                  setRawItems((prev) => [
                    ...prev,
                    { itemId: rawMaterials[0]?.id || '', qtyPerBatch: '10' },
                  ])
                }
                className="text-xs text-blue-700 hover:underline cursor-pointer"
              >
                + Add Raw Material
              </button>
            </div>
            <div className="space-y-2">
              {rawItems.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={row.itemId}
                    onChange={(e) =>
                      setRawItems((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, itemId: e.target.value } : r))
                      )
                    }
                    className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {rawMaterials.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {rm.name} ({rm.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={row.qtyPerBatch}
                    onChange={(e) =>
                      setRawItems((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, qtyPerBatch: e.target.value } : r))
                      )
                    }
                    className="w-28 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                  {rawItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRawItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700">Packaging Inputs</label>
              <button
                type="button"
                onClick={() =>
                  setPkgItems((prev) => [
                    ...prev,
                    { itemId: packagingMaterials[0]?.id || '', qtyPerBatch: '100' },
                  ])
                }
                className="text-xs text-blue-700 hover:underline cursor-pointer"
              >
                + Add Packaging
              </button>
            </div>
            <div className="space-y-2">
              {pkgItems.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={row.itemId}
                    onChange={(e) =>
                      setPkgItems((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, itemId: e.target.value } : r))
                      )
                    }
                    className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {packagingMaterials.map((pm) => (
                      <option key={pm.id} value={pm.id}>
                        {pm.name} ({pm.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={row.qtyPerBatch}
                    onChange={(e) =>
                      setPkgItems((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, qtyPerBatch: e.target.value } : r))
                      )
                    }
                    className="w-28 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setPkgItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Process Notes
            </label>
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
              {submitting ? 'Saving...' : 'Save BOM'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
