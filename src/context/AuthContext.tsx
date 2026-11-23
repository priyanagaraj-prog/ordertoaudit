import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { clearDemoSession, requestDemoSession } from '../lib/apiClient';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ROLE_ALLOWED_MODULES,
  ROLE_LABELS,
  type ErpModuleId,
  type PortalMode,
  type UserProfile,
  type UserRole,
} from '../types/erp';

const BOOTSTRAP_OWNER_EMAIL = 'nbpriya2006@gmail.com';
const PORTAL_STORAGE_KEY = 'factoryflow_portal_mode';
const DEMO_ROLE_STORAGE_KEY = 'factoryflow_demo_role';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  portalMode: PortalMode;
  isDemoMode: boolean;
  loading: boolean;
  authError: string | null;
  enterRolePortal: (role?: UserRole) => Promise<void>;
  switchDemoRole: (role: UserRole) => Promise<void>;
  exitToLanding: () => void;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  canViewModule: (moduleId: ErpModuleId) => boolean;
  isReadOnlyModule: (moduleId: ErpModuleId) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function makeDemoProfile(role: UserRole): UserProfile {
  return {
    id: `demo_${role}`,
    uid: `demo_${role}`,
    email: `${role}@kaveriheritage.erp`,
    displayName: `${ROLE_LABELS[role]} Workspace`,
    role,
    status: 'active',
    department: `${ROLE_LABELS[role]} Portal`,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseProfile, setFirebaseProfile] = useState<UserProfile | null>(null);
  const [portalMode, setPortalMode] = useState<PortalMode>(() => {
    const saved = sessionStorage.getItem(PORTAL_STORAGE_KEY);
    return saved === 'workspace' || saved === 'merchant' ? 'workspace' : 'landing';
  });
  const [demoRole, setDemoRole] = useState<UserRole>(() => {
    const saved = (sessionStorage.getItem(DEMO_ROLE_STORAGE_KEY) ||
      sessionStorage.getItem('factoryflow_demo_merchant_role')) as UserRole | null;
    return saved && saved in ROLE_LABELS ? saved : 'owner';
  });
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setFirebaseProfile(null);
        setLoading(false);
        return;
      }

      if (!user.emailVerified) {
        setAuthError('A verified Google email address is required for verified ERP accounts.');
        setFirebaseProfile(null);
        setLoading(false);
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const initialRole: UserRole =
            user.email?.toLowerCase() === BOOTSTRAP_OWNER_EMAIL
              ? 'owner'
              : 'salesman';
          await setDoc(userRef, {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || user.email?.split('@')[0] || 'ERP User',
            role: initialRole,
            status: 'active',
            department: initialRole === 'owner' ? 'Executive Management' : 'Field Sales',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        unsubProfile = onSnapshot(
          userRef,
          (docSnap) => {
            if (docSnap.exists()) {
              setFirebaseProfile({
                id: docSnap.id,
                ...(docSnap.data() as Omit<UserProfile, 'id'>),
              });
              setPortalMode('workspace');
              sessionStorage.setItem(PORTAL_STORAGE_KEY, 'workspace');
            }
            setLoading(false);
          },
          (error) => {
            handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
          }
        );
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to load user profile.');
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  // Ensure server-signed demonstration session token matches active role on reload
  useEffect(() => {
    if (firebaseUser) return;
    if (portalMode === 'workspace') {
      void requestDemoSession(demoRole).catch(() => {});
    }
  }, [firebaseUser, portalMode, demoRole]);

  const enterRolePortal = async (role: UserRole = 'owner') => {
    setAuthError(null);
    await requestDemoSession(role);
    setDemoRole(role);
    setPortalMode('workspace');
    sessionStorage.setItem(PORTAL_STORAGE_KEY, 'workspace');
    sessionStorage.setItem(DEMO_ROLE_STORAGE_KEY, role);
  };

  const switchDemoRole = async (role: UserRole) => {
    if (firebaseUser) return;
    await requestDemoSession(role);
    setDemoRole(role);
    sessionStorage.setItem(DEMO_ROLE_STORAGE_KEY, role);
  };

  const exitToLanding = () => {
    clearDemoSession();
    setPortalMode('landing');
    sessionStorage.setItem(PORTAL_STORAGE_KEY, 'landing');
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.');
    }
  };

  const logout = async () => {
    clearDemoSession();
    if (firebaseUser) {
      await signOut(auth);
    }
    setPortalMode('landing');
    sessionStorage.setItem(PORTAL_STORAGE_KEY, 'landing');
  };

  const isDemoMode = !firebaseUser;

  const activeProfile = useMemo<UserProfile | null>(() => {
    if (firebaseUser) return firebaseProfile;
    if (portalMode === 'workspace') return makeDemoProfile(demoRole);
    return null;
  }, [firebaseUser, firebaseProfile, portalMode, demoRole]);

  const canViewModule = (moduleId: ErpModuleId): boolean => {
    if (!activeProfile || activeProfile.status !== 'active') return false;
    if (isDemoMode && moduleId === 'users') {
      // User Management requires authenticated Firebase session because /users PII is locked down
      return false;
    }
    return ROLE_ALLOWED_MODULES[activeProfile.role].includes(moduleId);
  };

  const isReadOnlyModule = (moduleId: ErpModuleId): boolean => {
    if (!activeProfile) return true;
    const role = activeProfile.role;
    if (role === 'owner') return false;
    if (role === 'accountant') return true;
    if (role === 'salesman') {
      return !['sales_orders', 'customers'].includes(moduleId);
    }
    if (role === 'production_supervisor') {
      return ![
        'inventory',
        'raw_materials',
        'packaging',
        'bom',
        'production',
        'quality_control',
        'purchases',
      ].includes(moduleId);
    }
    if (role === 'admin') {
      return ['stock_ledger', 'reports', 'settings'].includes(moduleId);
    }
    return true;
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile: activeProfile,
        portalMode,
        isDemoMode,
        loading,
        authError,
        enterRolePortal,
        switchDemoRole,
        exitToLanding,
        signInWithGoogle,
        logout,
        canViewModule,
        isReadOnlyModule,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
