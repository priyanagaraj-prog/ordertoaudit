import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { EmptyState, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { createProduct, updateProduct } from '../services/erpService';
import type { Product } from '../types/erp';
import { formatGstBps, formatPaisaToInr, rupeeInputToPaisa } from '../utils/money';
import { resolveProductImage } from '../utils/productImages';

export function ProductsPage({ products }: { products: Product[] }) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'admin';
  const canCreate = canEdit || profile?.role === 'production_supervisor';

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Fresh Batters');
  const [hsnCode, setHsnCode] = useState('21069099');
  const [unit, setUnit] = useState('Pouch');
  const [packSize, setPackSize] = useState('1 kg');
  const [gstBps, setGstBps] = useState('500');
  const [sellingPriceInr, setSellingPriceInr] = useState('75.00');
  const [standardCostInr, setStandardCostInr] = useState('44.00');
  const [currentStock, setCurrentStock] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('100');
  const [shelfLifeDays, setShelfLifeDays] = useState('90');
  const [storageTemp, setStorageTemp] = useState('Cool & Dry < 25°C');
  const [description, setDescription] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.hsnCode.includes(q)
    );
  }, [products, search]);

  const openCreate = () => {
    setEditing(null);
    setSku(`KHF-SKU-${Math.floor(10 + Math.random() * 89)}`);
    setName('');
    setCategory('Spice Blends');
    setHsnCode('09109100');
    setUnit('Box');
    setPackSize('200 g');
    setGstBps('500');
    setSellingPriceInr('95.00');
    setStandardCostInr('50.00');
    setCurrentStock('0');
    setReorderLevel('100');
    setShelfLifeDays('180');
    setStorageTemp('Cool & Dry < 25°C');
    setDescription('');
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setSku(p.sku);
    setName(p.name);
    setCategory(p.category);
    setHsnCode(p.hsnCode);
    setUnit(p.unit);
    setPackSize(p.packSize);
    setGstBps(String(p.gstBps));
    setSellingPriceInr((p.sellingPricePaisa / 100).toFixed(2));
    setStandardCostInr((p.standardCostPaisa / 100).toFixed(2));
    setCurrentStock(String(p.currentStock));
    setReorderLevel(String(p.reorderLevel));
    setShelfLifeDays(String(p.shelfLifeDays || 90));
    setStorageTemp(p.storageTemp || 'Cool & Dry < 25°C');
    setDescription(p.description || '');
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const actor = {
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
      };
      if (editing) {
        await updateProduct(actor, editing.id, {
          name: name.trim(),
          category: category.trim(),
          hsnCode: hsnCode.trim(),
          unit: unit.trim(),
          packSize: packSize.trim(),
          gstBps: Number(gstBps),
          sellingPricePaisa: rupeeInputToPaisa(sellingPriceInr),
          standardCostPaisa: rupeeInputToPaisa(standardCostInr),
          reorderLevel: Number(reorderLevel),
          shelfLifeDays: Number(shelfLifeDays) || 90,
          storageTemp: storageTemp.trim(),
          description: description.trim(),
        });
      } else {
        await createProduct(actor, {
          sku: sku.trim(),
          name: name.trim(),
          category: category.trim(),
          hsnCode: hsnCode.trim(),
          unit: unit.trim(),
          packSize: packSize.trim(),
          gstBps: Number(gstBps),
          sellingPricePaisa: rupeeInputToPaisa(sellingPriceInr),
          standardCostPaisa: rupeeInputToPaisa(standardCostInr),
          currentStock: Number(currentStock),
          reorderLevel: Number(reorderLevel),
          shelfLifeDays: Number(shelfLifeDays) || 90,
          storageTemp: storageTemp.trim(),
          description: description.trim(),
          imageUrl: resolveProductImage(sku.trim()),
          fssaiLicense: 'FSSAI 12422003001841',
          status: 'active',
        });
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Product Catalog (Finished Goods SKUs)"
        subtitle="Packaged South Indian food SKUs, HSN codes, GST rates, shelf-life specs, and finished stock synced across sales, BOM, and dispatch modules."
        actions={
          canCreate && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product SKU</span>
            </button>
          )
        }
      />

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, product name, HSN code..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No products registered"
          description="Add finished food SKUs with HSN codes and GST rates."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Product & SKU</th>
                  <th className="text-left font-medium px-4 py-3">HSN & GST</th>
                  <th className="text-left font-medium px-4 py-3">Shelf Life & Storage</th>
                  <th className="text-right font-medium px-4 py-3">Selling Price</th>
                  <th className="text-right font-medium px-4 py-3">Std Cost</th>
                  <th className="text-right font-medium px-4 py-3">Stock</th>
                  <th className="text-left font-medium px-4 py-3">Availability</th>
                  {canEdit && <th className="text-right font-medium px-4 py-3">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const low = p.currentStock <= p.reorderLevel;
                  const imgSrc = resolveProductImage(p.sku, p.imageUrl);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={imgSrc}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{p.name}</p>
                            <p className="text-xs font-mono text-slate-500">
                              {p.sku} · {p.packSize} {p.unit} · {p.category}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {p.hsnCode} · {formatGstBps(p.gstBps)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p className="font-medium text-slate-800">
                          {p.shelfLifeDays ? `${p.shelfLifeDays} days` : '90 days'}
                        </p>
                        <p className="text-slate-500">{p.storageTemp || 'Ambient Dry'}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatPaisaToInr(p.sellingPricePaisa)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                        {formatPaisaToInr(p.standardCostPaisa)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                          low ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {p.currentStock} {p.unit}
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag
                          status={low ? 'Low Stock' : 'In Stock'}
                          tone={low ? 'danger' : 'success'}
                        />
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                          >
                            Edit
                          </button>
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Product (${editing.sku})` : 'New Finished Product SKU'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">SKU Code</label>
              <input
                type="text"
                required
                disabled={Boolean(editing)}
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Product Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <input
                type="text"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">HSN Code</label>
              <input
                type="text"
                required
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
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
              <label className="block text-xs font-medium text-slate-700 mb-1">Pack Size</label>
              <input
                type="text"
                required
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GST Rate</label>
              <select
                value={gstBps}
                onChange={(e) => setGstBps(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="0">0% (Exempt)</option>
                <option value="500">5% GST</option>
                <option value="1200">12% GST</option>
                <option value="1800">18% GST</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Selling Price (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={sellingPriceInr}
                onChange={(e) => setSellingPriceInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Standard Cost (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={standardCostInr}
                onChange={(e) => setStandardCostInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Reorder Level</label>
              <input
                type="number"
                min="0"
                required
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Shelf Life (Days)
              </label>
              <input
                type="number"
                min="1"
                value={shelfLifeDays}
                onChange={(e) => setShelfLifeDays(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Storage Condition
              </label>
              <input
                type="text"
                value={storageTemp}
                onChange={(e) => setStorageTemp(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            {!editing && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Opening Stock
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={currentStock}
                  onChange={(e) => setCurrentStock(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Product Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              {submitting ? 'Saving...' : 'Save Product'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
