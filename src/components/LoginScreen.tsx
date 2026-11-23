import React from 'react';
import { Factory, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const { signInWithGoogle, authError } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-2 shadow-sm">
        {/* Left Navy Brand Panel */}
        <div className="bg-[#0F294A] text-white p-8 md:p-10 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-2.5 text-blue-200 text-sm font-medium">
              <Factory className="w-5 h-5" />
              <span>South Indian Packaged Food Manufacturing</span>
            </div>
            <h1 className="mt-6 text-2xl md:text-3xl font-bold tracking-tight text-white">
              Order-to-Audit ERP
            </h1>
            <p className="mt-3 text-sm text-blue-100/90 leading-relaxed">
              Unified enterprise resource planning connecting field sales orders, GST billing,
              raw material and packaging inventory, Bill of Materials, batch production, costing
              variance, payments, and monthly audit reporting.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-white/15 space-y-2.5 text-xs text-blue-100/85">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-300 shrink-0" />
              <span>Role-based authorization across Owner, Admin, Sales, Production & Audit</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-300 shrink-0" />
              <span>Integer-paisa GST accounting & transactional stock ledger</span>
            </div>
          </div>
        </div>

        {/* Right Sign-In Panel */}
        <div className="p-8 md:p-10 flex flex-col justify-center">
          <h2 className="text-xl font-semibold text-slate-900">Sign in to your workspace</h2>
          <p className="mt-2 text-sm text-slate-600">
            Authenticate with your verified Google workspace account to access your assigned
            ERP modules.
          </p>

          {authError && (
            <div className="mt-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={signInWithGoogle}
            className="mt-6 w-full inline-flex items-center justify-center gap-3 px-5 py-3 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg transition-colors cursor-pointer"
          >
            <span>Continue with Google</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500">Supported Organizational Roles</p>
            <div className="mt-2.5 grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-slate-600">
              <span>Owner · Full Executive Access</span>
              <span>Admin · Orders, GST & Payments</span>
              <span>Salesman · Mobile Order Entry</span>
              <span>Supervisor · BOM & Production</span>
              <span className="col-span-2">Accountant / Auditor · Read-Only Audit & Exports</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
