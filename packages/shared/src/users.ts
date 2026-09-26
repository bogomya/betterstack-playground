/**
 * Demo identities. The same set is used by the web app (RUM identify), the load generator
 * and the backends (user context on logs, traces and errors).
 *
 * Each user has a "personality" so that scenarios differ per user:
 *  - alice: everything works (good sessions)
 *  - bob:   his card is always declined by the payments service (handled business error)
 *  - carol: inventory is slow for her (latency, no errors)
 *  - dave:  his orders always fail asynchronously in the worker (async error)
 */
export interface DemoUser {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'pro' | 'enterprise';
  group: string;
  card: string;
  personality: 'good' | 'declined' | 'slow' | 'async-fail';
}

export const DEMO_USERS: DemoUser[] = [
  { id: 'u-alice', name: 'Alice Good', email: 'alice@example.com', plan: 'pro', group: 'Acme Coffee Co', card: '4242', personality: 'good' },
  { id: 'u-bob', name: 'Bob Declined', email: 'bob@example.com', plan: 'free', group: 'Bob\'s Garage', card: '4000', personality: 'declined' },
  { id: 'u-carol', name: 'Carol Slow', email: 'carol@example.com', plan: 'enterprise', group: 'Acme Coffee Co', card: '4242', personality: 'slow' },
  { id: 'u-dave', name: 'Dave Async', email: 'dave@example.com', plan: 'pro', group: 'Night Owls', card: '4242', personality: 'async-fail' },
];

export const GUEST_USER: DemoUser = {
  id: 'guest', name: 'Guest', email: '', plan: 'free', group: '', card: '4242', personality: 'good',
};

export function findUser(id: string | undefined | null): DemoUser {
  return DEMO_USERS.find((u) => u.id === id) ?? GUEST_USER;
}

/** Headers used to propagate the acting user between services (in addition to W3C traceparent). */
export const USER_HEADERS = {
  id: 'x-user-id',
  name: 'x-user-name',
  plan: 'x-user-plan',
  session: 'x-session-id',
} as const;

export function userHeaders(user: DemoUser, sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    [USER_HEADERS.id]: user.id,
    [USER_HEADERS.name]: user.name,
    [USER_HEADERS.plan]: user.plan,
  };
  if (sessionId) h[USER_HEADERS.session] = sessionId;
  return h;
}

export function userFromHeaders(headers: Record<string, unknown>): DemoUser & { sessionId?: string } {
  const id = String(headers[USER_HEADERS.id] ?? '') || undefined;
  const base = findUser(id);
  const sessionId = headers[USER_HEADERS.session] ? String(headers[USER_HEADERS.session]) : undefined;
  return { ...base, sessionId };
}
