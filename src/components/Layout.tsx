import React, { useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Boxes,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Factory,
  FileSpreadsheet,
  FileText,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingBag,
  Sparkles,
  Truck,
  Users,
  UserCog,
  Warehouse,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, type ErpModuleId, type UserRole } from '../types/erp';

interface NavItem {
  id: ErpModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview & Intelligence',
    items: [
      { id: 'dashboard', label: 'Business Overview', icon: LayoutDashboard },
      { id: 'ai_insights', label: 'AI Insights & Copilot', icon: Sparkles },
    ],
  },
  {
    title: 'Sales & Fulfillment',
    items: [
      { id: 'sales_orders', label: 'Order Management', icon: ClipboardList },
      { id: 'customers', label: 'Customers & Distributors', icon: Users },
      { id: 'gst_invoices', label: 'GST Invoices', icon: FileText },
      { id: 'dispatch', label: 'Dispatch & FEFO', icon: Truck },
    ],
  },
  {
    title: 'Products & Inventory',
    items: [
      { id: 'products', label: 'Product Catalog', icon: Package },
      { id: 'inventory', label: 'Inventory & Batch Hub', icon: Warehouse },
      { id: 'raw_materials', label: 'Raw Materials', icon: Boxes },
      { id: 'packaging', label: 'Packaging Stock', icon: Layers },
    ],
  },
  {
    title: 'Manufacturing & QC',
    items: [
      { id: 'bom', label: 'BOM & Recipes', icon: BookOpen },
      { id: 'production', label: 'Production & WIP', icon: Factory },
      { id: 'quality_control', label: 'Quality Control (QC)', icon: ClipboardCheck },
      { id: 'costing', label: 'Costing & Variance', icon: Calculator },
    ],
  },
  {
    title: 'Procurement & Finance',
    items: [
      { id: 'purchases', label: 'Procurement Hub', icon: ShoppingBag },
      { id: 'payments', label: 'Payments & Receivables', icon: CreditCard },
      { id: 'stock_ledger', label: 'Stock Ledger', icon: FileSpreadsheet },
    ],
  },
  {
    title: 'Audit & Administration',
    items: [
      { id: 'reports', label: 'Reports & Audit Trail', icon: BarChart3 },
      { id: 'users', label: 'User Management', icon: UserCog },
      { id: 'settings', label: 'Settings & Benchmark', icon: Settings },
    ],
  },
];

interface LayoutProps {
  activeModule: ErpModuleId;
  onSelectModule: (id: ErpModuleId) => void;
  companyName?: string;
  pendingApprovalOrdersCount?: number;
  children: React.ReactNode;
}

export function Layout({
  activeModule,
  onSelectModule,
  companyName,
  pendingApprovalOrdersCount = 0,
  children,
}: LayoutProps) {
  const {
    profile,
    isDemoMode,
    switchDemoRole,
    exitToLanding,
    logout,
    canViewModule,
    isReadOnlyModule,
  } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeLabel =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeModule)?.label ||
    'Business Overview';

  const handleNav = (id: ErpModuleId) => {
    onSelectModule(id);
    setMobileOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0F294A] text-slate-100">
      <div className="px-5 py-4 border-b border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-bold tracking-tight text-white truncate">
              FactoryFlow ERP
            </p>
            <p className="text-xs text-blue-200/80 truncate mt-0.5">
              {companyName || 'Kaveri Heritage Foods Pvt. Ltd.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-blue-200 hover:bg-white/10"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => canViewModule(item.id));
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.title}>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-blue-200/60 mb-1.5">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeModule === item.id;
                  const showOrderBadge =
                    item.id === 'sales_orders' && pendingApprovalOrdersCount > 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNav(item.id)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-[#1A6FD4] text-white font-medium'
                          : 'text-slate-200/85 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {showOrderBadge && (
                        <span className="px-1.5 py-0.5 text-[11px] font-mono font-semibold bg-amber-400 text-slate-900 rounded">
                          {pendingApprovalOrdersCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 bg-[#0B1F3A] space-y-2.5">
        <div className="text-xs">
          <p className="font-semibold text-white truncate">
            {profile?.displayName || 'ERP Operator'}
          </p>
          <p className="text-blue-200/80 truncate mt-0.5">
            {profile ? `${ROLE_LABELS[profile.role]} Portal` : ''}
          </p>
        </div>

        {isDemoMode ? (
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-blue-200/70 mb-1">
              Switch Role Portal
            </label>
            <select
              value={profile?.role || 'owner'}
              onChange={(e) => void switchDemoRole(e.target.value as UserRole)}
              className="w-full px-2.5 py-1.5 text-xs rounded-md bg-white/10 text-white border border-white/15 focus:outline-none"
            >
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                <option key={r} value={r} className="text-slate-900">
                  {ROLE_LABELS[r]} Portal
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exitToLanding}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-blue-100 bg-white/10 hover:bg-white/15 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>All Portals</span>
          </button>
          {!isDemoMode && (
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center justify-center p-2 text-xs text-blue-100 bg-white/10 hover:bg-white/15 rounded-lg transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
                {profile ? `${ROLE_LABELS[profile.role]} Portal` : 'Kaveri Heritage Foods'}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 truncate">{activeLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 text-xs text-slate-600">
            {isDemoMode && (
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-medium border border-blue-200 whitespace-nowrap">
                Demo Mode
              </span>
            )}
            <span className="hidden md:inline whitespace-nowrap">
              {profile ? ROLE_LABELS[profile.role] : ''}
            </span>
            {isReadOnlyModule(activeModule) && (
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium border border-slate-200 whitespace-nowrap">
                Read-Only
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
