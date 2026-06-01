import type { Clerk } from '@clerk/clerk-js';

type ClerkInstance = Clerk;

export async function initClerk(): Promise<void> {
  return Promise.resolve();
}

export function scheduleClerkLoad(): void {
  // No-op: Auth is disabled
}

export function getClerk(): ClerkInstance | null {
  return null;
}

export function openSignIn(): void {
  // No-op: Auth is disabled
}

export function openSignUp(): void {
  // No-op: Auth is disabled
}

export function getClerkUserCreatedAt(): number | null {
  return null;
}

export async function signOut(): Promise<void> {
  return Promise.resolve();
}

export function clearClerkTokenCache(): void {
  // No-op: Auth is disabled
}

export async function getClerkToken(): Promise<string | null> {
  return Promise.resolve(null);
}

export function getCurrentClerkUser(): { id: string; name: string; email: string; image: string | null; plan: 'free' | 'pro' } | null {
  return null;
}

export function subscribeClerk(callback: () => void): () => void {
  // Call once to trigger state check callbacks, then return a no-op detacher
  setTimeout(callback, 0);
  return () => {};
}

export function mountUserButton(_el: HTMLDivElement): () => void {
  // No-op: Auth is disabled
  return () => {};
}
