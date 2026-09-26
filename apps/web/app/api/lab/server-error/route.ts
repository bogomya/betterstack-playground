import { currentUser } from '@/lib/user';

/** Unhandled error inside a Next.js route handler -> 500, reported through instrumentation.ts onRequestError. */
export async function GET() {
  const user = await currentUser();
  const config: { featureFlags?: Record<string, boolean> } = {};
  // Deliberate bug: optional config is assumed to be present
  if (config.featureFlags!['new-checkout']) return Response.json({ ok: true });
  return Response.json({ ok: true, user: user.id });
}
