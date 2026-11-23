import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Clock,
  RefreshCw,
  Send,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { KpiCard, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { callApi } from '../lib/apiClient';
import { createPurchaseRequest, makeDocNumber } from '../services/erpService';
import type {
  ErpModuleId,
  InventoryBatch,
  PackagingMaterial,
  Product,
  ProductionRun,
  RawMaterial,
  SalesOrder,
} from '../types/erp';
import type { DeterministicAiAnalytics } from '../utils/erpEngine';
import { formatPaisaToInr } from '../utils/money';

interface ServerAiInsightsResponse {
  aiPowered: boolean;
  modelUsed?: string;
  statusNotice?: string;
  deterministic: DeterministicAiAnalytics;
  executiveBrief?: {
    headline?: string;
    riskSummary?: string;
    prioritizedActions?: string[];
  } | null;
}

interface AiInsightsViewModel extends DeterministicAiAnalytics {
  mode: 'gemini' | 'deterministic';
  modelUsed?: string;
  executiveSummary: string;
  statusNotice?: string;
  prioritizedActions?: string[];
}

interface AiInsightsPageProps {
  products: Product[];
  rawMaterials: RawMaterial[];
  packagingMaterials: PackagingMaterial[];
  orders: SalesOrder[];
  productionRuns: ProductionRun[];
  batches: InventoryBatch[];
  onNavigate: (module: ErpModuleId) => void;
}

export function AiInsightsPage({
  products,
  rawMaterials,
  packagingMaterials,
  orders,
  productionRuns,
  batches,
  onNavigate,
}: AiInsightsPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('purchases');

  const [insights, setInsights] = useState<AiInsightsViewModel | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [createdPrIds, setCreatedPrIds] = useState<Record<string, boolean>>({});

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: 'user' | 'assistant'; text: string; mode?: string }>
  >([]);

  const fetchInsights = useCallback(async () => {
    setLoadingInsights(true);
    setErrorMsg(null);
    try {
      const res = await callApi<ServerAiInsightsResponse>('/api/ai/insights', 'POST', {
        todayIso: new Date().toISOString().slice(0, 10),
        products,
        rawMaterials,
        packagingMaterials,
        orders,
        productionRuns,
        batches,
      });

      const det = res.deterministic;
      const fallbackSummary =
        res.executiveBrief?.headline ||
        res.executiveBrief?.riskSummary ||
        `Analyzed ${det.demandForecasts.length} SKUs: ${det.reorderRecommendations.length} material reorder alert(s), ${det.nearExpiryAlerts.length} near-expiry batch alert(s), and ${det.unusualTransactions.length} production/order anomaly flag(s).`;

      setInsights({
        ...det,
        mode: res.aiPowered ? 'gemini' : 'deterministic',
        modelUsed: res.modelUsed,
        statusNotice: res.statusNotice,
        executiveSummary: fallbackSummary,
        prioritizedActions: res.executiveBrief?.prioritizedActions,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to compute AI insights.');
    } finally {
      setLoadingInsights(false);
    }
  }, [products, rawMaterials, packagingMaterials, orders, productionRuns, batches]);

  useEffect(() => {
    void fetchInsights();
  }, [fetchInsights]);

  const handleRaisePr = async (rec: DeterministicAiAnalytics['reorderRecommendations'][number]) => {
    if (!profile) return;
    const itemCost =
      rec.itemType === 'raw_material'
        ? rawMaterials.find((r) => r.id === rec.itemId)?.costPerUnitPaisa || 0
        : packagingMaterials.find((p) => p.id === rec.itemId)?.costPerUnitPaisa || 0;

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
          sourceType: 'low_stock',
          itemCategory: rec.itemType === 'packaging' ? 'packaging' : 'raw_material',
          itemId: rec.itemId,
          itemCode: rec.code,
          itemName: rec.name,
          unit: rec.unit,
          requestedQty: rec.suggestedOrderQty,
          estimatedUnitCostPaisa: itemCost,
          notes: `Auto-generated from Smart Reorder (${rec.urgency.toUpperCase()})`,
        }
      );
      setCreatedPrIds((prev) => ({ ...prev, [rec.itemId]: true }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to raise Purchase Request.');
    }
  };

  const handleAskAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setChatHistory((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');
    setAsking(true);
    try {
      const res = await callApi<{ aiPowered: boolean; modelUsed: string; answer: string }>(
        '/api/ai/assistant',
        'POST',
        {
          question: q,
          contextSummary: {
            todayIso: new Date().toISOString().slice(0, 10),
            products: products.map((p) => ({
              sku: p.sku,
              name: p.name,
              stock: p.currentStock,
              reorderLevel: p.reorderLevel,
              priceInr: (p.sellingPricePaisa / 100).toFixed(2),
            })),
            rawMaterials: rawMaterials.map((r) => ({
              code: r.code,
              name: r.name,
              stock: r.currentStock,
              reorderLevel: r.reorderLevel,
              unit: r.unit,
            })),
            packagingMaterials: packagingMaterials.map((p) => ({
              code: p.code,
              name: p.name,
              stock: p.currentStock,
              reorderLevel: p.reorderLevel,
              unit: p.unit,
            })),
            recentOrders: orders.slice(0, 15).map((o) => ({
              orderNumber: o.orderNumber,
              customerName: o.customerName,
              status: o.status,
              totalInr: (o.totalAmountPaisa / 100).toFixed(2),
            })),
            recentRuns: productionRuns.slice(0, 10).map((r) => ({
              batchNumber: r.batchNumber,
              productName: r.productName,
              plannedQty: r.plannedQty,
              actualOutputQty: r.actualOutputQty,
              wastageQty: r.wastageQty,
              varianceInr: (r.variancePaisa / 100).toFixed(2),
            })),
            activeBatches: batches
              .filter((b) => b.remainingQty > 0)
              .slice(0, 20)
              .map((b) => ({
                batchNumber: b.batchNumber,
                itemName: b.itemName,
                remainingQty: b.remainingQty,
                expiryDate: b.expiryDate,
                qcStatus: b.qcStatus,
              })),
          },
        }
      );
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', text: res.answer, mode: res.modelUsed },
      ]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: err instanceof Error ? err.message : 'Assistant request failed.',
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="AI Insights, Demand Forecasting & Operations Copilot"
        subtitle="Real-time server-side analytics combining FactoryFlow's statistical ERP engine and Gemini AI."
        actions={
          <button
            type="button"
            onClick={() => void fetchInsights()}
            disabled={loadingInsights}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loadingInsights ? 'animate-spin' : ''}`} />
            <span>{loadingInsights ? 'Analyzing...' : 'Refresh Analysis'}</span>
          </button>
        }
      />

      {errorMsg && (
        <div className="mb-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {insights && (
        <>
          <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#0F294A] text-white flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-slate-900">Executive Briefing</h2>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-medium rounded border ${
                      insights.mode === 'gemini'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {insights.mode === 'gemini'
                      ? `Live Gemini (${insights.modelUsed || 'gemini-4-hydrogen'})`
                      : 'Deterministic Statistical Engine'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-700">{insights.executiveSummary}</p>
                {insights.prioritizedActions && insights.prioritizedActions.length > 0 && (
                  <ul className="mt-2 list-disc list-inside text-xs text-slate-600 space-y-1">
                    {insights.prioritizedActions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                )}
                {insights.statusNotice && insights.mode !== 'gemini' && (
                  <p className="mt-1.5 text-xs text-slate-500">{insights.statusNotice}</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label="SKUs Forecasted"
              value={`${insights.demandForecasts.length}`}
              hint="30-day rolling demand projection"
              tone="navy"
            />
            <KpiCard
              label="Smart Reorder Alerts"
              value={`${insights.reorderRecommendations.length}`}
              hint="Raw & packaging below threshold"
              tone={insights.reorderRecommendations.length > 0 ? 'warning' : 'success'}
            />
            <KpiCard
              label="Near-Expiry / FEFO Flags"
              value={`${insights.nearExpiryAlerts.length}`}
              hint="Batches expiring within 30 days"
              tone={insights.nearExpiryAlerts.length > 0 ? 'danger' : 'success'}
            />
            <KpiCard
              label="Process & Order Anomalies"
              value={`${insights.unusualTransactions.length}`}
              hint="Wastage >= 5% or outlier orders"
              tone={insights.unusualTransactions.length > 0 ? 'danger' : 'success'}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            {/* Demand Forecasts */}
            <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#1A6FD4]" />
                <h2 className="text-base font-semibold text-slate-900">
                  30-Day SKU Demand Forecast & Production Plan
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left font-medium px-4 py-2.5">SKU & Product</th>
                      <th className="text-right font-medium px-4 py-2.5">Booked</th>
                      <th className="text-right font-medium px-4 py-2.5">Current Stock</th>
                      <th className="text-right font-medium px-4 py-2.5">30d Forecast</th>
                      <th className="text-right font-medium px-4 py-2.5">Produce Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {insights.demandForecasts.map((f) => (
                      <tr key={f.productId} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-900">{f.productName}</p>
                          <p className="text-xs text-slate-500">{f.rationale}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                          {f.historicalSoldQty}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                          {f.currentStock}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#0F294A]">
                          {f.projectedNext30DaysQty}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">
                          {f.recommendedProductionQty > 0 ? (
                            <span className="text-amber-700">+{f.recommendedProductionQty}</span>
                          ) : (
                            <span className="text-emerald-700">Sufficient</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Interactive Assistant */}
            <div className="bg-white border border-slate-200 rounded-xl flex flex-col h-[420px]">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#0F294A]" />
                <h2 className="text-base font-semibold text-slate-900">FactoryFlow Copilot</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                {chatHistory.length === 0 ? (
                  <div className="text-xs text-slate-500 space-y-2">
                    <p>Ask operational questions about your live inventory, batches, or orders:</p>
                    {[
                      'Which raw materials need immediate reorder?',
                      'Which batches are closest to expiry right now?',
                      'Summarize wastage and production variance risks.',
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => setQuestion(prompt)}
                        className="block w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-blue-300 text-slate-700 cursor-pointer"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : (
                  chatHistory.map((m, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg text-xs leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-[#0F294A] text-white ml-6'
                          : 'bg-white border border-slate-200 text-slate-800 mr-4'
                      }`}
                    >
                      <p className="whitespace-pre-line">{m.text}</p>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={handleAskAssistant} className="p-3 border-t border-slate-200 flex gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask about stock, expiry, orders..."
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <button
                  type="submit"
                  disabled={asking || !question.trim()}
                  className="px-3 py-2 bg-[#0F294A] text-white rounded-lg hover:bg-[#173B6C] disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>

          {/* Smart Reorder & Expiry/Anomaly Cards */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-amber-600" />
                  <h2 className="text-base font-semibold text-slate-900">
                    Smart Procurement Reorder Queue
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('purchases')}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  Open Procurement Hub
                </button>
              </div>
              {insights.reorderRecommendations.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">
                  All raw & packaging materials are comfortably above reorder levels.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {insights.reorderRecommendations.map((rec) => (
                    <div
                      key={rec.itemId}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-slate-900">{rec.name}</span>
                          <StatusTag
                            status={rec.urgency}
                            tone={rec.urgency === 'critical' ? 'danger' : 'warning'}
                          />
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          On Hand: {rec.currentStock} {rec.unit} · Reorder: {rec.reorderLevel}{' '}
                          {rec.unit} · Est. {formatPaisaToInr(rec.estimatedCostPaisa)}
                        </p>
                      </div>
                      {!readOnly && rec.itemType !== 'finished_good' && (
                        <button
                          type="button"
                          disabled={Boolean(createdPrIds[rec.itemId])}
                          onClick={() => void handleRaisePr(rec)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg disabled:bg-emerald-700 cursor-pointer whitespace-nowrap"
                        >
                          {createdPrIds[rec.itemId]
                            ? 'PR Created'
                            : `Raise PR (+${rec.suggestedOrderQty} ${rec.unit})`}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-red-600" />
                    <h2 className="text-base font-semibold text-slate-900">
                      FEFO Expiry Risk Queue
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('inventory')}
                    className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    View Batch Hub
                  </button>
                </div>
                {insights.nearExpiryAlerts.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">
                    No active batches within the 30-day expiry risk window.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {insights.nearExpiryAlerts.map((al) => (
                      <div key={al.batchId} className="p-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{al.itemName}</p>
                          <p className="text-xs font-mono text-slate-500">
                            Lot {al.batchNumber} · {al.remainingQty} {al.unit} · Exp {al.expiryDate}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 text-xs font-mono font-semibold rounded border ${
                            al.daysRemaining < 0 || al.daysRemaining <= 7
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {al.daysRemaining < 0 ? 'Expired' : `${al.daysRemaining}d left`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <h2 className="text-base font-semibold text-slate-900">
                    Unusual Transaction & Wastage Flags
                  </h2>
                </div>
                {insights.unusualTransactions.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">
                    No abnormal production wastage spikes or outlier sales tickets detected.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {insights.unusualTransactions.map((anom) => (
                      <div key={anom.id} className="p-4 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono font-semibold text-slate-700">
                            {anom.reference} · {anom.category.replace('_', ' ')}
                          </p>
                          <p className="text-xs text-slate-600 mt-1">{anom.description}</p>
                        </div>
                        <StatusTag
                          status={anom.severity}
                          tone={anom.severity === 'high' ? 'danger' : 'warning'}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
