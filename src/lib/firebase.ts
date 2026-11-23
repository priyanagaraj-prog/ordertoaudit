import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * CRITICAL: Pass firebaseConfig.firestoreDatabaseId so Firestore connects
 * to the provisioned AI Studio Enterprise Firestore database instance.
 * In browser environments, route through the app's same-origin Express proxy
 * with forced XHR long-polling so cross-origin HTTP/3 QUIC, tracking-protection,
 * or buffering-proxy stalls never trigger 10-second WebChannel offline timeouts.
 */
const browserHost = typeof window !== 'undefined' ? window.location?.host : '';
const browserSettings = browserHost
  ? ({
      host: browserHost,
      ssl: window.location.protocol === 'https:',
      experimentalForceLongPolling: true,
      useFetchStreams: false,
      ignoreUndefinedProperties: true,
    } as Parameters<typeof initializeFirestore>[1] & { useFetchStreams?: boolean })
  : {
      ignoreUndefinedProperties: true,
    };

let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    browserSettings,
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = dbInstance;
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Recursively removes keys with `undefined` values before sending payloads to Firestore.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Validates Firestore connectivity on startup with one transient cold-start retry.
 */
async function testConnection(): Promise<void> {
  if (typeof window === 'undefined') return;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      return;
    } catch (error) {
      const isOffline =
        error instanceof Error && error.message.includes('the client is offline');
      if (!isOffline) {
        // Server responded (e.g. permission-denied on non-public test path), so connection is healthy
        return;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      console.error('Firestore connection failed: client is offline. Check Firebase configuration.');
    }
  }
}

void testConnection();
