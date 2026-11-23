import React, { useState } from 'react';
import { PageHeader, StatusTag } from '../components/ErpUi';
import { useAuth } from '../context/AuthContext';
import { updateUserRoleAndStatus } from '../services/erpService';
import { ROLE_LABELS, type UserProfile, type UserRole } from '../types/erp';

export function UserManagementPage({ users }: { users: UserProfile[] }) {
  const { profile } = useAuth();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRoleChange = async (
    target: UserProfile,
    newRole: UserRole,
    newStatus: 'active' | 'inactive'
  ) => {
    if (!profile) return;
    setSavingId(target.uid);
    setErrorMsg(null);
    try {
      await updateUserRoleAndStatus(
        {
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
        target.uid,
        {
          role: newRole,
          status: newStatus,
          department: target.department,
          phone: target.phone,
        }
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update user role.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="User Management & Role Authorization"
        subtitle="Assign organizational ERP roles and manage active access permissions. New Google sign-ins default to Salesman until elevated by the Owner."
      />

      {errorMsg && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left font-medium px-4 py-3">User</th>
                <th className="text-left font-medium px-4 py-3">Email</th>
                <th className="text-left font-medium px-4 py-3">Assigned Role</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Access Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isSelf = u.uid === profile?.uid;
                return (
                  <tr key={u.uid} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {u.displayName}
                      {isSelf && (
                        <span className="ml-2 text-xs text-blue-700">(You)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        disabled={savingId === u.uid || isSelf}
                        value={u.role}
                        onChange={(e) =>
                          handleRoleChange(u, e.target.value as UserRole, u.status)
                        }
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50"
                      >
                        {(Object.keys(ROLE_LABELS) as UserRole[]).map((roleKey) => (
                          <option key={roleKey} value={roleKey}>
                            {ROLE_LABELS[roleKey]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <StatusTag status={u.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        <button
                          type="button"
                          disabled={savingId === u.uid}
                          onClick={() =>
                            handleRoleChange(
                              u,
                              u.role,
                              u.status === 'active' ? 'inactive' : 'active'
                            )
                          }
                          className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                        >
                          {u.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
