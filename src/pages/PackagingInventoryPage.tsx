import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { EmptyState, KpiCard, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { createPackagingMaterial } from '../services/erpService';
import type { PackagingMaterial } from '../types/erp';
import { formatPaisaToInr, rupeeInputToPaisa } from '../utils/money';

export function PackagingInventoryPage({
  packagingMaterials,
}: {
  packagingMaterials: PackagingMaterial[];
}) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('packaging');

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [materialType, setMaterialType] = useState('Flexible Pouch');
  const [unit, setUnit] = useState('pcs');
  const [currentStock, setCurrentStock] = useState('500');
  const [reorderLevel, setReorderLevel] = useState('250');
  const [costInr, setCostInr] = useState('5.00');
  const [supplierName, setSupplierName] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packagingMaterials.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.materialType.toLowerCase().includes(q)
    );
  }, [packagingMaterials, search]);

  const totalValuePaisa = packagingMaterials.reduce(
    (s, p) => s + Math.round(p.currentStock * p.costPerUnitPaisa),
    0
  );
  const lowCount = packagingMaterials.filter((p) => p.currentStock <= p.reorderLevel).length;

  const openModal = () => {
    setCode(`PKG-${Math.floor(100 + Math.random() * 900)}`);
    setName('');
    setSupplierName('');
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createPackagingMaterial(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        {
          code: code.trim(),
          name: name.trim(),
          materialType: materialType.trim(),
          unit: unit.trim(),
          currentStock: Number(currentStock),
          reorderLevel: Number(reorderLevel),
          costPerUnitPaisa: rupeeInputToPaisa(costInr),
          supplierName: supplierName.trim(),
          status: 'active',
        }
      );
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save packaging material.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Packaging Inventory"
        subtitle="Food-grade pouches, printed cartons, glass bottles, and master shippers."
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={openModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Packaging Item</span>
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Packaging SKUs" value={`${packagingMaterials.length}`} />
        <KpiCard
          label="Packaging Valuation"
          value={formatPaisaToInr(totalValuePaisa)}
          tone="navy"
        />
        <KpiCard
          label="Low-Stock Alerts"
          value={`${lowCount}`}
          tone={lowCount > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search packaging code, name, type..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No packaging materials registered"
          description="Add pouches, cartons, or bottles consumed during production runs."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Packaging Item</th>
                  <th className="text-left font-medium px-4 py-3">Type & Supplier</th>
                  <th className="text-right font-medium px-4 py-3">Unit Cost</th>
                  <th className="text-right font-medium px-4 py-3">On Hand</th>
                  <th className="text-right font-medium px-4 py-3">Reorder Level</th>
                  <th className="text-right font-medium px-4 py-3">Valuation</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const low = p.currentStock <= p.reorderLevel;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs font-mono text-slate-500">{p.code}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{p.materialType}</p>
                        <p className="text-xs text-slate-500">{p.supplierName || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {formatPaisaToInr(p.costPerUnitPaisa)} / {p.unit}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                          low ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {p.currentStock} {p.unit}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                        {p.reorderLevel} {p.unit}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatPaisaToInr(Math.round(p.currentStock * p.costPerUnitPaisa))}
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={low ? 'Low Stock' : 'Healthy'} tone={low ? 'danger' : 'success'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Packaging Material">
        <form onSubmit={handleSave} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Code</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Material Type
              </label>
              <input
                type="text"
                required
                value={materialType}
                onChange={(e) => setMaterialType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Unit</label>
              <input
                type="text"
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Opening Stock
              </label>
              <input
                type="number"
                step="1"
                min="0"
                required
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reorder Level
              </label>
              <input
                type="number"
                step="1"
                min="0"
                required
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
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
                value={costInr}
                onChange={(e) => setCostInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier</label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
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
              {submitting ? 'Saving...' : 'Save Packaging'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
