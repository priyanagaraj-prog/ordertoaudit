import React, { useEffect, useMemo, useState } from 'react';
import { Database, PlayCircle, Save } from 'lucide-react';
import { PageHeader } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import {
  runMurukkuBenchmarkWorkspace,
  saveCompanySettings,
  seedSouthIndianFoodWorkspace,
} from '../services/erpService';
import {
  INDIAN_STATES,
  type CompanySetting,
  type GstInvoice,
  type PackagingMaterial,
  type Product,
  type ProductionRun,
  type RawMaterial,
  type SalesOrder,
} from '../types/erp';
import {
  calculateConsumptionVarianceBps,
  evaluateStockAvailability,
  formatPctFromBps,
} from '../utils/erpEngine';
import { formatPaisaToInr } from '../utils/money';

interface SettingsPageProps {
  company: CompanySetting | null;
  products?: Product[];
  rawMaterials?: RawMaterial[];
  packagingMaterials?: PackagingMaterial[];
  productionRuns?: ProductionRun[];
  invoices?: GstInvoice[];
  orders?: SalesOrder[];
}

export function SettingsPage({
  company,
  products = [],
  rawMaterials = [],
  packagingMaterials = [],
  productionRuns = [],
  invoices = [],
  orders = [],
}: SettingsPageProps) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('settings');

  const [companyName, setCompanyName] = useState('Kaveri Heritage Foods');
  const [legalName, setLegalName] = useState('Kaveri Heritage Foods Pvt. Ltd.');
  const [gstin, setGstin] = useState('33AABCK4821M1Z5');
  const [stateCode, setStateCode] = useState('33');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('KHF-INV');
  const [orderPrefix, setOrderPrefix] = useState('KHF-ORD');
  const [batchPrefix, setBatchPrefix] = useState('KHF-BCH');

  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [runningBenchmark, setRunningBenchmark] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (company) {
      setCompanyName(company.companyName);
      setLegalName(company.legalName);
      setGstin(company.gstin);
      setStateCode(company.stateCode);
      setAddress(company.address || '');
      setPhone(company.phone || '');
      setEmail(company.email || '');
      setInvoicePrefix(company.invoicePrefix || 'KHF-INV');
      setOrderPrefix(company.orderPrefix || 'KHF-ORD');
      setBatchPrefix(company.batchPrefix || 'KHF-BCH');
    }
  }, [company]);

  const liveBenchmarkAudit = useMemo(() => {
    const flour = rawMaterials.find((r) => r.id === 'rm_bm_flour');
    const oil = rawMaterials.find((r) => r.id === 'rm_bm_oil');
    const pouch = packagingMaterials.find((p) => p.id === 'pkg_bm_pouch');
    const murukku = products.find((p) => p.id === 'prod_bm_murukku');
    const latestRun = productionRuns.find(
      (r) => r.productId === 'prod_bm_murukku' && r.status === 'completed'
    );
    const latestRetailerAInv = invoices.find((i) => i.customerId === 'cust_bm_retailer_a');
    const latestDistBOrder = orders.find(
      (o) =>
        o.customerId === 'cust_bm_distributor_b' &&
        (o.status === 'pending' || o.status === 'confirmed')
    );

    if (!murukku && !flour && !latestRun) return null;

    const yieldVarBps = latestRun
      ? calculateConsumptionVarianceBps(latestRun.plannedQty, latestRun.actualOutputQty)
      : null;
    const oilLine = latestRun?.rawMaterialsConsumed.find((m) => m.itemId === 'rm_bm_oil');
    const oilVarBps = oilLine
      ? calculateConsumptionVarianceBps(oilLine.plannedQty, oilLine.actualQty)
      : null;
    const distBReqQty = latestDistBOrder?.items[0]?.quantity ?? 0;
    const distBAvail =
      latestDistBOrder && murukku
        ? evaluateStockAvailability(distBReqQty, murukku.currentStock)
        : null;

    return {
      flourStock: flour ? `${flour.currentStock} ${flour.unit}` : '—',
      oilStock: oil ? `${oil.currentStock} ${oil.unit}` : '—',
      pouchStock: pouch ? `${pouch.currentStock} ${pouch.unit}` : '—',
      finishedStock: murukku ? `${murukku.currentStock} ${murukku.unit}` : '—',
      yieldVar: yieldVarBps !== null ? formatPctFromBps(yieldVarBps) : '—',
      oilVar: oilVarBps !== null ? formatPctFromBps(oilVarBps) : '—',
      retailerAInvoice: latestRetailerAInv
        ? formatPaisaToInr(latestRetailerAInv.totalAmountPaisa)
        : '—',
      retailerAOutstanding: latestRetailerAInv
        ? formatPaisaToInr(latestRetailerAInv.balanceDuePaisa)
        : '—',
      distBShortage:
        distBAvail && !distBAvail.sufficient
          ? `${distBAvail.shortageQty} ${murukku?.unit || 'Packet'}`
          : distBAvail
          ? '0 (Sufficient)'
          : '—',
    };
  }, [rawMaterials, packagingMaterials, products, productionRuns, invoices, orders]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || readOnly) return;
    const stateObj = INDIAN_STATES.find((s) => s.code === stateCode) || {
      code: stateCode,
      name: 'Tamil Nadu',
    };

    setSaving(true);
    setMessage(null);
    setErrorMsg(null);
    try {
      await saveCompanySettings(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        {
          companyName: companyName.trim(),
          legalName: legalName.trim(),
          gstin: gstin.trim().toUpperCase(),
          stateCode: stateObj.code,
          stateName: stateObj.name,
          address: address.trim(),
          phone: phone.trim(),
          email: email.trim(),
          invoicePrefix: invoicePrefix.trim(),
          orderPrefix: orderPrefix.trim(),
          batchPrefix: batchPrefix.trim(),
        }
      );
      setMessage('Company profile and GST settings saved to Firestore.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleSeed = async () => {
    if (!profile || profile.role !== 'owner') return;
    setSeeding(true);
    setMessage(null);
    setErrorMsg(null);
    try {
      await seedSouthIndianFoodWorkspace({
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
      });
      setMessage('South Indian packaged food manufacturing workspace initialized successfully.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to seed workspace.');
    } finally {
      setSeeding(false);
    }
  };

  const handleRunBenchmark = async () => {
    if (!profile || profile.role !== 'owner') return;
    setRunningBenchmark(true);
    setMessage(null);
    setErrorMsg(null);
    try {
      await runMurukkuBenchmarkWorkspace({
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
      });
      setMessage(
        'Executed Murukku 200g benchmark transactions (Opening stock, Purchase, Production, GST Invoice, Dispatch, Payment, and Backorder shortage check) in Firestore.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to execute Murukku 200g benchmark scenario.'
      );
    } finally {
      setRunningBenchmark(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Company & GST Settings"
        subtitle="Configure manufacturing entity GSTIN, place-of-supply state code, and document prefixes."
      />

      {message && (
        <div className="mb-4 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleSave}
          className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">Organization & GST Profile</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Brand / Display Name
              </label>
              <input
                type="text"
                required
                disabled={readOnly}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Legal Entity Name
              </label>
              <input
                type="text"
                required
                disabled={readOnly}
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Company GSTIN (15-char)
              </label>
              <input
                type="text"
                required
                maxLength={15}
                minLength={15}
                disabled={readOnly}
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono uppercase disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Origin State (CGST/SGST Base)
              </label>
              <select
                disabled={readOnly}
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white disabled:bg-slate-50"
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                disabled={readOnly}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                disabled={readOnly}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Factory Address
            </label>
            <input
              type="text"
              disabled={readOnly}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 pt-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Order Prefix
              </label>
              <input
                type="text"
                disabled={readOnly}
                value={orderPrefix}
                onChange={(e) => setOrderPrefix(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Invoice Prefix
              </label>
              <input
                type="text"
                disabled={readOnly}
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Batch Prefix
              </label>
              <input
                type="text"
                disabled={readOnly}
                value={batchPrefix}
                onChange={(e) => setBatchPrefix(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
          </div>

          {!readOnly && (
            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Save Company Settings'}</span>
              </button>
            </div>
          )}
        </form>

        {profile?.role === 'owner' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-base font-semibold text-slate-900">
                South Indian Food Manufacturing Dataset
              </h2>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Populate realistic South Indian packaged food masters, BOMs, GST customers, and
                sample transactions in Cloud Firestore.
              </p>
              <button
                type="button"
                disabled={seeding || runningBenchmark}
                onClick={handleSeed}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer disabled:opacity-60"
              >
                <Database className="w-4 h-4" />
                <span>{seeding ? 'Populating Firestore...' : 'Load / Reset Sample Dataset'}</span>
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-base font-semibold text-slate-900">
                Murukku 200g Benchmark Scenario
              </h2>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Runs the full end-to-end transactional sequence in Cloud Firestore: opening stock,
                flour purchase, production batch with damaged pouches & overhead, Retailer A GST
                invoice + dispatch + payment, and Distributor B shortage order.
              </p>
              <button
                type="button"
                disabled={runningBenchmark || seeding}
                onClick={handleRunBenchmark}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                <PlayCircle className="w-4 h-4" />
                <span>
                  {runningBenchmark
                    ? 'Executing Live Transactions...'
                    : 'Run Benchmark Transactions'}
                </span>
              </button>

              {liveBenchmarkAudit && (
                <div className="mt-4 pt-4 border-t border-slate-200 space-y-1.5 text-xs">
                  <p className="font-semibold text-slate-800 mb-2">
                    Live Firestore Computed State
                  </p>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Closing Flour</span>
                    <span className="font-mono font-medium text-slate-900">
                      {liveBenchmarkAudit.flourStock}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Closing Cooking Oil</span>
                    <span className="font-mono font-medium text-slate-900">
                      {liveBenchmarkAudit.oilStock}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Closing Pouches</span>
                    <span className="font-mono font-medium text-slate-900">
                      {liveBenchmarkAudit.pouchStock}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Finished Murukku Stock</span>
                    <span className="font-mono font-medium text-slate-900">
                      {liveBenchmarkAudit.finishedStock}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Yield Variance</span>
                    <span className="font-mono font-medium text-red-700">
                      {liveBenchmarkAudit.yieldVar}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Oil Consumption Variance</span>
                    <span className="font-mono font-medium text-red-700">
                      {liveBenchmarkAudit.oilVar}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Retailer A Invoice</span>
                    <span className="font-mono font-medium text-slate-900">
                      {liveBenchmarkAudit.retailerAInvoice}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Retailer A Outstanding</span>
                    <span className="font-mono font-medium text-slate-900">
                      {liveBenchmarkAudit.retailerAOutstanding}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Distributor B Shortage</span>
                    <span className="font-mono font-medium text-red-700">
                      {liveBenchmarkAudit.distBShortage}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
