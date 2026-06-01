/** Minimal user profile exposed to UI components. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: 'free' | 'pro';
}

/** Simplified auth session state for UI consumption. */
export interface AuthSession {
  user: AuthUser | null;
  isPending: boolean;
}

const _currentSession: AuthSession = { user: null, isPending: false };

/**
 * Initialize auth state. Call once at app startup before UI subscribes.
 */
export async function initAuthState(): Promise<void> {
  // Bypassed
}

/**
 * Subscribe to reactive auth state changes.
 * @returns Unsubscribe function.
 */
export function subscribeAuthState(callback: (state: AuthSession) => void): () => void {
  callback(_currentSession);
  return () => {};
}

/**
 * Synchronous snapshot of current auth state.
 */
export function getAuthState(): AuthSession {
  return _currentSession;
}
