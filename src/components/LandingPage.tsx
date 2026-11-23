import React, { useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Crown,
  Factory,
  FileCheck2,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PORTAL_DEFINITIONS, type UserRole } from '../types/erp';

const ROLE_ICONS: Record<UserRole, React.ComponentType<{ className?: string }>> = {
  owner: Crown,
  admin: Briefcase,
  production_supervisor: Factory,
  salesman: ClipboardList,
  accountant: FileCheck2,
};

export function LandingPage() {
  const { enterRolePortal, signInWithGoogle, authError } = useAuth();
  const [enteringRole, setEnteringRole] = useState<UserRole | 'google' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleEnterPortal = async (role: UserRole) => {
    setEnteringRole(role);
    setLocalError(null);
    try {
      await enterRolePortal(role);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to launch role portal.');
      setEnteringRole(null);
    }
  };

  const handleGoogleSignIn = async () => {
    setEnteringRole('google');
    setLocalError(null);
    try {
      await signInWithGoogle();
    } finally {
      setEnteringRole(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Enterprise Header */}
      <header className="bg-[#0F294A] text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <Factory className="w-4 h-4 text-blue-200" />
            </div>
            <span className="text-base font-bold tracking-tight whitespace-nowrap">
              FactoryFlow ERP
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm text-blue-100/90">
            <a href="#role-portals" className="hover:text-white transition-colors whitespace-nowrap">
              Role Portals
            </a>
            <a href="#access-matrix" className="hover:text-white transition-colors whitespace-nowrap">
              Access Governance
            </a>
          </nav>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={enteringRole !== null}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-white/10 hover:bg-white/15 border border-white/15 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            <span>Staff Google Sign-In</span>
          </button>
        </div>
      </header>

      {/* Main Welcome Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-10 sm:py-14">
        <div className="max-w-3xl mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Kaveri Heritage Foods Pvt. Ltd.
          </h1>
          <p className="mt-3 text-base text-slate-600 leading-relaxed">
            Select an organizational role portal to enter the FactoryFlow ERP workspace.
          </p>
        </div>

        {(authError || localError) && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {localError || authError}
          </div>
        )}

        {/* 5 Organizational Role Portals */}
        <section
          id="role-portals"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-10"
        >
          {PORTAL_DEFINITIONS.map((portal) => {
            const Icon = ROLE_ICONS[portal.role];
            const isEntering = enteringRole === portal.role;
            return (
              <div
                key={portal.role}
                className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between hover:border-[#0F294A]/40 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#0F294A] text-white flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
                      {portal.scopeSummary}
                    </span>
                  </div>

                  <h2 className="mt-4 text-lg font-bold text-slate-900">{portal.portalTitle}</h2>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{portal.subtitle}</p>

                  <ul className="mt-4 space-y-2 text-xs text-slate-700">
                    {portal.capabilities.map((cap, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#0F294A] shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{cap}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => void handleEnterPortal(portal.role)}
                    disabled={enteringRole !== null}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    <span>
                      {isEntering ? `Entering ${portal.portalTitle}...` : `Enter ${portal.portalTitle}`}
                    </span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        {/* Governance & Architecture Summary */}
        <section
          id="access-matrix"
          className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-slate-600"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-[#0F294A] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900">Role-Scoped Authorization</p>
              <p className="mt-1 leading-relaxed">
                Signed session tokens enforce module and API boundaries across Owner, Executive
                Officer, Merchant, Salesman, and read-only Auditor portals.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Factory className="w-4 h-4 text-[#0F294A] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900">ACID Stock &amp; Integer-Paisa GST</p>
              <p className="mt-1 leading-relaxed">
                Every order, BOM production batch, purchase GRN, and invoice executes in atomic
                Firestore transactions with exact integer-paisa GST arithmetic.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-[#0F294A] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900">FEFO Traceability &amp; Audit Trail</p>
              <p className="mt-1 leading-relaxed">
                Lot-level expiry prioritization, quality control gates, stock ledger traceability,
                and exportable PDF/Excel compliance statements.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
