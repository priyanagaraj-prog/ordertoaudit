import React from 'react';
import { X } from 'lucide-react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'navy' | 'success' | 'warning' | 'danger';
}) {
  const valueColor =
    tone === 'navy'
      ? 'text-[#0F294A]'
      : tone === 'success'
      ? 'text-emerald-700'
      : tone === 'warning'
      ? 'text-amber-700'
      : tone === 'danger'
      ? 'text-red-700'
      : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums ${valueColor}`}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-slate-500 truncate">{hint}</p>}
    </div>
  );
}

export function StatusTag({
  status,
  tone,
}: {
  status: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}) {
  const normalized = status.toLowerCase();
  const resolvedTone =
    tone ||
    ([
      'paid',
      'completed',
      'delivered',
      'active',
      'received',
      'passed',
      'approved',
      'in stock',
      'converted_to_po',
    ].includes(normalized)
      ? 'success'
      : [
          'invoiced',
          'dispatched',
          'in_progress',
          'in_production',
          'confirmed',
          'packed',
          'ready_for_dispatch',
          'mixing',
          'cooking',
          'cooling',
          'packaging',
        ].includes(normalized)
      ? 'info'
      : ['pending', 'awaiting_approval', 'partial', 'ordered', 'planned', 'hold', 'qc_pending'].includes(
          normalized
        )
      ? 'warning'
      : ['unpaid', 'cancelled', 'rejected', 'inactive', 'low stock', 'expired'].includes(
          normalized
        )
      ? 'danger'
      : 'neutral');

  const classes =
    resolvedTone === 'success'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : resolvedTone === 'info'
      ? 'bg-blue-50 text-blue-800 border-blue-200'
      : resolvedTone === 'warning'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : resolvedTone === 'danger'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border whitespace-nowrap capitalize ${classes}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div
        className={`bg-white border border-slate-200 rounded-xl w-full ${maxWidth} max-h-[90vh] flex flex-col shadow-lg`}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
