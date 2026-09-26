import { currentUser } from '@/lib/user';

/** A page with a 3 s server render: bad TTFB/LCP for the Web Vitals dashboard. */
export default async function SlowPage() {
  const user = await currentUser();
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 3000));
  return (
    <div className="panel mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Sorry {user.name}, that took a while</h1>
      <p className="muted mt-2 text-sm">Server render blocked for {Date.now() - started} ms on purpose. Compare TTFB/LCP for this URL in RUM → Web vitals.</p>
    </div>
  );
}
