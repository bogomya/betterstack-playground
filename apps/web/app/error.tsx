'use client';

import { useEffect } from 'react';
import { track } from '@/lib/rum';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Error boundaries swallow render errors before window.onerror sees them, so report them explicitly.
    console.error('React error boundary caught:', error);
    track('react-error-boundary', { message: error.message, digest: error.digest });
    window.Sentry?.captureException?.(error);
  }, [error]);
  return (
    <div className="panel mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold text-[#f85149]">Something broke while rendering</h1>
      <pre className="mt-3">{error.message}</pre>
      <p className="muted mt-2 text-xs">digest {error.digest ?? 'n/a'}</p>
      <button className="btn mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
