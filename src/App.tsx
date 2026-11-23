/**
 * FactoryFlow ERP (Order-to-Audit ERP) — Root Application Entry & Portal Router
 */
import React, { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AiInsightsPage } from './pages/AiInsightsPage';
import { BomPage } from './pages/BomPage';
import { CostingVariancePage } from './pages/CostingVariancePage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { DispatchManagementPage } from './pages/DispatchManagementPage';
import { GstInvoicesPage } from './pages/GstInvoicesPage';
import { InventoryHubPage } from './pages/InventoryHubPage';
import { PackagingInventoryPage } from './pages/PackagingInventoryPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ProductionManagementPage } from './pages/ProductionManagementPage';
import { ProductsPage } from './pages/ProductsPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { QualityControlPage } from './pages/QualityControlPage';
import { RawMaterialsPage } from './pages/RawMaterialsPage';
import { ReportsAnalyticsPage } from './pages/ReportsAnalyticsPage';
import { SalesOrdersPage } from './pages/SalesOrdersPage';
import { SettingsPage } from './pages/SettingsPage';
import { StockLedgerPage } from './pages/StockLedgerPage';
import { UserManagementPage } from './pages/UserManagementPage';
import {
  subscribeCollection,
  subscribeCompanySettings,
  subscribeSalesOrders,
} from './services/erpService';
import {
  PORTAL_DEFINITIONS,
  type AuditLog,
  type Bom,
  type CompanySetting,
  type Customer,
  type Dispatch,
  type ErpModuleId,
  type GstInvoice,
  type InventoryBatch,
  type PackagingMaterial,
  type Payment,
  type Product,
  type ProductionRun,
  type Purchase,
  type PurchaseRequest,
  type QcInspection,
  type RawMaterial,
  type SalesOrder,
  type StockMovement,
  type Supplier,
  type UserProfile,
} from './types/erp';

function ErpWorkspace() {
  const { profile, canViewModule } = useAuth();
  const [activeModule, setActiveModule] = useState<ErpModuleId>(() => {
    const def = PORTAL_DEFINITIONS.find((p) => p.role === profile?.role);
    return def?.defaultModule || 'dashboard';
  });

  const [company, setCompany] = useState<CompanySetting | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [packagingMaterials, setPackagingMaterials] = useState<PackagingMaterial[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [productionRuns, setProductionRuns] = useState<ProductionRun[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [qcInspections, setQcInspections] = useState<QcInspection[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [invoices, setInvoices] = useState<GstInvoice[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!profile || profile.status !== 'active') return;

    const unsubs: Array<() => void> = [];

    unsubs.push(subscribeCompanySettings(setCompany));
    unsubs.push(subscribeCollection<Customer>('customers', setCustomers, 'businessName', 'asc'));
    unsubs.push(subscribeCollection<Product>('products', setProducts, 'name', 'asc'));
    unsubs.push(subscribeSalesOrders(profile.uid, profile.role, setOrders));

    if (profile.role !== 'salesman') {
      unsubs.push(
        subscribeCollection<RawMaterial>('raw_materials', setRawMaterials, 'name', 'asc')
      );
      unsubs.push(
        subscribeCollection<PackagingMaterial>(
          'packaging_materials',
          setPackagingMaterials,
          'name',
          'asc'
        )
      );
      unsubs.push(subscribeCollection<Bom>('boms', setBoms, 'productName', 'asc'));
      unsubs.push(subscribeCollection<Supplier>('suppliers', setSuppliers, 'name', 'asc'));
      unsubs.push(
        subscribeCollection<PurchaseRequest>(
          'purchase_requests',
          setPurchaseRequests,
          'createdAt',
          'desc'
        )
      );
      unsubs.push(subscribeCollection<Purchase>('purchases', setPurchases, 'createdAt', 'desc'));
      unsubs.push(
        subscribeCollection<ProductionRun>(
          'production_runs',
          setProductionRuns,
          'createdAt',
          'desc'
        )
      );
      unsubs.push(
        subscribeCollection<InventoryBatch>(
          'inventory_batches',
          setBatches,
          'expiryDate',
          'asc'
        )
      );
      unsubs.push(
        subscribeCollection<QcInspection>('qc_inspections', setQcInspections, 'createdAt', 'desc')
      );
      unsubs.push(subscribeCollection<GstInvoice>('invoices', setInvoices, 'createdAt', 'desc'));
      unsubs.push(subscribeCollection<Dispatch>('dispatches', setDispatches, 'createdAt', 'desc'));
      unsubs.push(subscribeCollection<Payment>('payments', setPayments, 'createdAt', 'desc'));
      unsubs.push(
        subscribeCollection<StockMovement>(
          'stock_movements',
          setStockMovements,
          'createdAt',
          'desc'
        )
      );
      unsubs.push(subscribeCollection<AuditLog>('audit_logs', setAuditLogs, 'createdAt', 'desc'));
    }

    if (profile.role === 'owner') {
      unsubs.push(subscribeCollection<UserProfile>('users', setUsers, 'displayName', 'asc'));
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const def = PORTAL_DEFINITIONS.find((p) => p.role === profile.role);
    setActiveModule(def?.defaultModule || 'dashboard');
  }, [profile?.role]);

  useEffect(() => {
    if (profile && !canViewModule(activeModule)) {
      const def = PORTAL_DEFINITIONS.find((p) => p.role === profile.role);
      setActiveModule(def && canViewModule(def.defaultModule) ? def.defaultModule : 'dashboard');
    }
  }, [profile, activeModule, canViewModule]);

  const pendingApprovalOrdersCount = orders.filter((o) => o.status === 'awaiting_approval').length;

  const renderModule = () => {
    if (!canViewModule(activeModule)) {
      return (
        <DashboardPage
          company={company}
          orders={orders}
          invoices={invoices}
          products={products}
          rawMaterials={rawMaterials}
          packagingMaterials={packagingMaterials}
          productionRuns={productionRuns}
          batches={batches}
          qcInspections={qcInspections}
          purchaseRequests={purchaseRequests}
          onNavigate={setActiveModule}
        />
      );
    }

    switch (activeModule) {
      case 'dashboard':
        return (
          <DashboardPage
            company={company}
            orders={orders}
            invoices={invoices}
            products={products}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
            productionRuns={productionRuns}
            batches={batches}
            qcInspections={qcInspections}
            purchaseRequests={purchaseRequests}
            onNavigate={setActiveModule}
          />
        );
      case 'ai_insights':
        return (
          <AiInsightsPage
            products={products}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
            orders={orders}
            productionRuns={productionRuns}
            batches={batches}
            onNavigate={setActiveModule}
          />
        );
      case 'sales_orders':
        return (
          <SalesOrdersPage
            orders={orders}
            customers={customers}
            products={products}
            company={company}
            boms={boms}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
          />
        );
      case 'customers':
        return <CustomersPage customers={customers} />;
      case 'products':
        return <ProductsPage products={products} />;
      case 'inventory':
        return (
          <InventoryHubPage
            products={products}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
            batches={batches}
            productionRuns={productionRuns}
            orders={orders}
            dispatches={dispatches}
          />
        );
      case 'gst_invoices':
        return <GstInvoicesPage invoices={invoices} company={company} />;
      case 'dispatch':
        return (
          <DispatchManagementPage
            dispatches={dispatches}
            invoices={invoices}
            products={products}
          />
        );
      case 'raw_materials':
        return <RawMaterialsPage rawMaterials={rawMaterials} />;
      case 'packaging':
        return <PackagingInventoryPage packagingMaterials={packagingMaterials} />;
      case 'bom':
        return (
          <BomPage
            boms={boms}
            products={products}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
          />
        );
      case 'production':
        return (
          <ProductionManagementPage
            runs={productionRuns}
            boms={boms}
            company={company}
          />
        );
      case 'quality_control':
        return <QualityControlPage batches={batches} qcInspections={qcInspections} />;
      case 'costing':
        return <CostingVariancePage runs={productionRuns} />;
      case 'purchases':
        return (
          <PurchasesPage
            purchases={purchases}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
            suppliers={suppliers}
            purchaseRequests={purchaseRequests}
          />
        );
      case 'payments':
        return (
          <PaymentsPage
            payments={payments}
            invoices={invoices}
            customers={customers}
          />
        );
      case 'stock_ledger':
        return <StockLedgerPage movements={stockMovements} />;
      case 'reports':
        return (
          <ReportsAnalyticsPage
            company={company}
            invoices={invoices}
            payments={payments}
            productionRuns={productionRuns}
            products={products}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
            stockMovements={stockMovements}
            auditLogs={auditLogs}
            batches={batches}
            qcInspections={qcInspections}
          />
        );
      case 'users':
        return <UserManagementPage users={users} />;
      case 'settings':
        return (
          <SettingsPage
            company={company}
            products={products}
            rawMaterials={rawMaterials}
            packagingMaterials={packagingMaterials}
            productionRuns={productionRuns}
            invoices={invoices}
            orders={orders}
          />
        );
    }
  };

  return (
    <Layout
      activeModule={activeModule}
      onSelectModule={setActiveModule}
      companyName={company?.companyName}
      pendingApprovalOrdersCount={pendingApprovalOrdersCount}
    >
      {renderModule()}
    </Layout>
  );
}

function AppRouter() {
  const { firebaseUser, profile, portalMode, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 text-sm text-slate-600">
          Loading FactoryFlow ERP workspace...
        </div>
      </div>
    );
  }

  if (firebaseUser && profile && profile.status !== 'active') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center">
          <h2 className="text-lg font-semibold text-slate-900">Account Deactivated</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your ERP access has been marked inactive by the Workspace Owner.
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-5 px-4 py-2 text-sm font-medium text-white bg-[#0F294A] rounded-lg cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (portalMode === 'workspace' && profile) {
    return <ErpWorkspace />;
  }

  return <LandingPage />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </ErrorBoundary>
  );
}
