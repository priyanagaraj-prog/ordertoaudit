import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { EmptyState, PageHeader, StatusTag } from '../components/ErpUi';
import type { StockMovement } from '../types/erp';
import { exportStockLedgerExcel } from '../utils/exportReports';
import { formatPaisaToInr } from '../utils/money';

export function StockLedgerPage({ movements }: { movements: StockMovement[] }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | StockMovement['itemType']>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter((m) => {
      const matchesType = typeFilter === 'all' || m.itemType === typeFilter;
      const matchesSearch =
        !q ||
        m.itemName.toLowerCase().includes(q) ||
        m.itemCode.toLowerCase().includes(q) ||
        m.refNumber.toLowerCase().includes(q) ||
        m.movementType.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [movements, search, typeFilter]);

  return (
    <div>
      <PageHeader
        title="Traceable Stock Ledger"
        subtitle="Immutable, transaction-backed audit trail of every inward, production, wastage, and dispatch stock movement."
        actions={
          movements.length > 0 && (
            <button
              type="button"
              onClick={() => exportStockLedgerExcel(filtered)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Excel</span>
            </button>
          )
        }
      />

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row gap-3 justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, code, PO/Batch/Dispatch ref..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {[
            { id: 'all', label: 'All Items' },
            { id: 'raw_material', label: 'Raw Materials' },
            { id: 'packaging', label: 'Packaging' },
            { id: 'finished_good', label: 'Finished Goods' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTypeFilter(tab.id as typeof typeFilter)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                typeFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No stock movements recorded"
          description="Stock ledger entries are automatically written during Purchase GRNs, Production completions, and Dispatches."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Item</th>
                  <th className="text-left font-medium px-4 py-3">Movement</th>
                  <th className="text-right font-medium px-4 py-3">Before</th>
                  <th className="text-right font-medium px-4 py-3">Change</th>
                  <th className="text-right font-medium px-4 py-3">After</th>
                  <th className="text-right font-medium px-4 py-3">Value</th>
                  <th className="text-left font-medium px-4 py-3">Reference</th>
                  <th className="text-left font-medium px-4 py-3">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => {
                  const isIn = m.changeQty > 0;
                  const tone =
                    m.movementType === 'PRODUCTION_WASTAGE'
                      ? 'warning'
                      : isIn
                      ? 'success'
                      : 'info';
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{m.itemName}</p>
                        <p className="text-xs font-mono text-slate-500">
                          {m.itemCode} · {m.itemType.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={m.movementType} tone={tone} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                        {m.beforeQty} {m.unit}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                          m.changeQty > 0
                            ? 'text-emerald-700'
                            : m.changeQty < 0
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {m.changeQty > 0 ? `+${m.changeQty}` : m.changeQty} {m.unit}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-slate-900">
                        {m.afterQty} {m.unit}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {formatPaisaToInr(m.totalValuePaisa)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {m.refNumber}
                        <span className="block text-slate-400">{m.refType}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {m.actorName || m.actorUid}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
