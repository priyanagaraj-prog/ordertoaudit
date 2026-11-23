import { auth } from './firebase';
import type { UserRole } from '../types/erp';

const DEMO_TOKEN_KEY = 'factoryflow_demo_token';
const DEMO_ROLE_KEY = 'factoryflow_demo_role';

export async function requestDemoSession(role: UserRole = 'owner'): Promise<string> {
  const res = await fetch('/api/demo/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portal: 'workspace', role }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(data.error || 'Failed to establish FactoryFlow demonstration session.');
  }
  sessionStorage.setItem(DEMO_TOKEN_KEY, data.token);
  sessionStorage.setItem(DEMO_ROLE_KEY, role);
  return data.token;
}

export function clearDemoSession(): void {
  sessionStorage.removeItem(DEMO_TOKEN_KEY);
  sessionStorage.removeItem(DEMO_ROLE_KEY);
}

/**
 * Calls backend /api/* endpoints using either the signed-in Firebase ID token
 * or the signed Demonstration Mode role session token.
 */
export async function callApi<TResponse>(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: unknown
): Promise<TResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  } else {
    let demoToken = sessionStorage.getItem(DEMO_TOKEN_KEY);
    if (!demoToken) {
      const savedRole = (sessionStorage.getItem(DEMO_ROLE_KEY) as UserRole | null) || 'owner';
      demoToken = await requestDemoSession(savedRole);
    }
    headers['X-FactoryFlow-Session'] = demoToken;
  }

  const res = await fetch(endpoint, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as TResponse;
}
