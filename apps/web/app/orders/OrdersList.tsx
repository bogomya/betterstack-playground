'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/api';

interface Order {
  id: string;
  status: string;
  total_cents: number;
  failure_reason: string | null;
  trace_id: string | null;
  created_at: string;
  items: { name: string; qty: number }[];
}

const colors: Record<string, string> = { paid: 'text-[#d29922]', fulfilled: 'text-[#3fb950]', failed: 'text-[#f85149]', pending: 'muted' };

export default function OrdersList() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/orders', { cache: 'no-store' });
        const body = await res.json();
        if (!alive) return;
        if (res.ok) {
          setOrders(body.orders ?? []);
          setError(null);
        } else setError(`${res.status} ${body.error ?? ''}`);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (error) return <div className="panel p-4 text-sm text-[#f85149]">Could not load orders: {error}</div>;
  if (!orders) return <div className="muted text-sm">Loading…</div>;
  if (!orders.length) return <div className="panel p-4 text-sm muted">No orders yet.</div>;
  return (
    <div className="panel divide-y divide-[#1f2a37]">
      {orders.map((o) => (
        <div key={o.id} className="flex items-center gap-4 p-4 text-sm">
          <div className="w-44 shrink-0">
            <div className="font-mono text-xs">{o.id.slice(0, 8)}…</div>
            <div className="muted text-xs">{new Date(o.created_at).toLocaleTimeString()}</div>
          </div>
          <div className="flex-1">
            {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
            {o.failure_reason ? <div className="text-xs text-[#f85149]">{o.failure_reason}</div> : null}
          </div>
          <div className="w-20 text-right font-semibold">{money(o.total_cents)}</div>
          <div className={`w-20 text-right font-medium ${colors[o.status] ?? ''}`}>{o.status}</div>
        </div>
      ))}
    </div>
  );
}
