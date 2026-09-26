'use client';

import { useSearchParams } from 'next/navigation';

/** Throws during client render -> caught by app/error.tsx (React error boundary). */
export default function BoomPage() {
  const params = useSearchParams();
  const items: { name: string }[] | undefined = params.get('safe') ? [{ name: 'ok' }] : undefined;
  // Deliberate bug: reading a property of undefined during render
  return <div className="panel p-6">Rendering {items![0].name}</div>;
}
