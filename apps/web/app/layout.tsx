import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { trace } from '@opentelemetry/api';
import BetterStackTag from '@/components/BetterStackTag';
import Nav from '@/components/Nav';
import RumIdentify from '@/components/RumIdentify';
import { currentUser } from '@/lib/user';

export const metadata: Metadata = {
  title: 'Brew & Bean - Better Stack demo shop',
  description: 'A deliberately breakable coffee shop used to evaluate Better Stack (Uptime, Telemetry, Errors, RUM).',
};
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const span = trace.getActiveSpan();
  const sc = span?.spanContext();
  // Lets the JS tag continue the server-side trace for the page load.
  const traceparent = sc && sc.traceId !== '00000000000000000000000000000000' ? `00-${sc.traceId}-${sc.spanId}-01` : undefined;
  // Read at request time on the server (not NEXT_PUBLIC_, so no rebuild is needed when the token changes)
  const tagToken = process.env.BS_JS_TAG_TOKEN;
  const environment = process.env.APP_ENV ?? 'demo';
  const release = process.env.APP_RELEASE ?? 'dev';

  return (
    <html lang="en">
      <head>
        {traceparent ? <meta name="traceparent" content={traceparent} /> : null}
        {tagToken ? <BetterStackTag token={tagToken} environment={environment} release={release} /> : null}
      </head>
      <body className="min-h-screen">
        <Nav user={user} />
        <RumIdentify user={user} />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs muted">
          bsdemo · release <span className="tag">{release}</span> · env <span className="tag">{environment}</span>
          {traceparent ? (
            <>
              {' '}· page trace <span className="tag">{sc?.traceId}</span>
            </>
          ) : null}
          {!tagToken ? <span className="ml-2 text-[#d29922]">JS tag not configured (BS_JS_TAG_TOKEN)</span> : null}
        </footer>
      </body>
    </html>
  );
}
