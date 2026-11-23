import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { EmptyState, Modal, PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { createCustomer, updateCustomer } from '../services/erpService';
import { INDIAN_STATES, type Customer } from '../types/erp';
import { formatPaisaToInr, rupeeInputToPaisa } from '../utils/money';

export function CustomersPage({ customers }: { customers: Customer[] }) {
  const { profile, isReadOnlyModule } = useAuth();
  const readOnly = isReadOnlyModule('customers');

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('33');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimitInr, setCreditLimitInr] = useState('200000');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter(
      (c) =>
        !q ||
        c.businessName.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.gstin || '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  const openCreate = () => {
    setEditing(null);
    setCode(`CUST-${Math.floor(100 + Math.random() * 900)}`);
    setBusinessName('');
    setContactName('');
    setPhone('');
    setEmail('');
    setGstin('');
    setStateCode('33');
    setCity('');
    setAddress('');
    setCreditLimitInr('200000');
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setCode(c.code);
    setBusinessName(c.businessName);
    setContactName(c.contactName);
    setPhone(c.phone);
    setEmail(c.email || '');
    setGstin(c.gstin || '');
    setStateCode(c.stateCode);
    setCity(c.city);
    setAddress(c.address || '');
    setCreditLimitInr(String(Math.round(c.creditLimitPaisa / 100)));
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const stateObj = INDIAN_STATES.find((s) => s.code === stateCode) || {
      code: stateCode,
      name: 'Tamil Nadu',
    };
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
        await updateCustomer(actor, editing.id, {
          businessName: businessName.trim(),
          contactName: contactName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          gstin: gstin.trim().toUpperCase(),
          stateCode: stateObj.code,
          stateName: stateObj.name,
          city: city.trim(),
          address: address.trim(),
          creditLimitPaisa: rupeeInputToPaisa(creditLimitInr),
        });
      } else {
        await createCustomer(actor, {
          code: code.trim(),
          businessName: businessName.trim(),
          contactName: contactName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          gstin: gstin.trim().toUpperCase(),
          stateCode: stateObj.code,
          stateName: stateObj.name,
          city: city.trim(),
          address: address.trim(),
          creditLimitPaisa: rupeeInputToPaisa(creditLimitInr),
          status: 'active',
        });
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const canEdit = profile?.role === 'owner' || profile?.role === 'admin';

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="B2B distributors, supermarkets, GST state codes, and credit receivables."
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#173B6C] rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Customer</span>
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
            placeholder="Search customer name, code, city, GSTIN..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No customers found"
          description="Add B2B wholesale buyers and retail chains to start booking sales orders."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Customer</th>
                  <th className="text-left font-medium px-4 py-3">GSTIN & State</th>
                  <th className="text-left font-medium px-4 py-3">Contact</th>
                  <th className="text-right font-medium px-4 py-3">Credit Limit</th>
                  <th className="text-right font-medium px-4 py-3">Outstanding</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  {canEdit && <th className="text-right font-medium px-4 py-3">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{c.businessName}</p>
                      <p className="text-xs font-mono text-slate-500">
                        {c.code} · {c.city}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-slate-800">
                        {c.gstin || 'Unregistered'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {c.stateName} ({c.stateCode})
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-800">{c.contactName}</p>
                      <p className="text-xs text-slate-500 font-mono">{c.phone}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      {formatPaisaToInr(c.creditLimitPaisa)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                        c.outstandingPaisa > 0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatPaisaToInr(c.outstandingPaisa)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusTag status={c.status} />
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Customer (${editing.code})` : 'Add Customer Account'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Customer Code
              </label>
              <input
                type="text"
                required
                disabled={Boolean(editing)}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Business Name
              </label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Contact Person
              </label>
              <input
                type="text"
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                GSTIN (Optional)
              </label>
              <input
                type="text"
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                placeholder="33AAACA8821D1Z9"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">State</label>
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Credit Limit (INR)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={creditLimitInr}
                onChange={(e) => setCreditLimitInr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Billing Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
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
              {submitting ? 'Saving...' : 'Save Customer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
