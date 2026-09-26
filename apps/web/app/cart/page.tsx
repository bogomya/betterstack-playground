'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clearCart, readCart, writeCart, type CartItem } from '@/lib/cart';
import { money } from '@/lib/api';
import { track } from '@/lib/rum';

interface CheckoutResult {
  status: number;
  durationMs: number;
  data: { orderId?: string; status?: string; error?: string; message?: string; trace_id?: string; service?: string };
}

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  useEffect(() => setItems(readCart()), []);
  const total = items.reduce((s, i) => s + i.price_cents * i.qty, 0);

  async function checkout() {
    setBusy(true);
    setResult(null);
    track('checkout-started', { items: items.length, total_cents: total });
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, qty: i.qty })) }),
      });
      const body = (await res.json()) as CheckoutResult;
      setResult(body);
      if (body.status === 201) {
        clearCart();
        setItems([]);
        track('checkout-completed', { order_id: body.data.orderId, total_cents: total });
      } else {
        track('checkout-failed', { status: body.status, error: body.data.error });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold">Your cart</h1>
      {items.length === 0 ? (
        <div className="panel p-6 text-sm muted">
          Cart is empty. <Link href="/" className="underline">Go shopping</Link>.
        </div>
      ) : (
        <div className="panel divide-y divide-[#1f2a37]">
          {items.map((i) => (
            <div key={i.productId} className="flex items-center gap-3 p-4">
              <span className="text-2xl">{i.emoji}</span>
              <div className="flex-1">
                <div className="font-medium">{i.name}</div>
                <div className="muted text-xs">{money(i.price_cents)} each</div>
              </div>
              <input
                type="number"
                min={1}
                max={99}
                value={i.qty}
                className="w-16"
                onChange={(e) => {
                  const next = items.map((c) => (c.productId === i.productId ? { ...c, qty: Math.max(1, Number(e.target.value)) } : c));
                  writeCart(next);
                  setItems(next);
                }}
              />
              <button
                className="btn"
                onClick={() => {
                  const next = items.filter((c) => c.productId !== i.productId);
                  writeCart(next);
                  setItems(next);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between p-4">
            <span className="text-lg font-semibold">Total {money(total)}</span>
            <button className="btn btn-accent" data-testid="checkout" disabled={busy} onClick={checkout}>
              {busy ? 'Placing order…' : 'Checkout'}
            </button>
          </div>
        </div>
      )}
      {result ? (
        <div className={`panel mt-4 p-4 text-sm ${result.status === 201 ? 'border-[#26542f]' : 'border-[#7a2c31]'}`}>
          {result.status === 201 ? (
            <>
              ✅ Order <span className="tag">{result.data.orderId}</span> paid in {result.durationMs}ms. The worker fulfils it asynchronously; watch it on the{' '}
              <Link href="/orders" className="underline">orders page</Link>.
            </>
          ) : (
            <>
              ❌ Checkout failed with HTTP {result.status}: <b>{result.data.error}</b> {result.data.message}
              {result.data.service ? <span className="muted"> (failed in {result.data.service})</span> : null}
            </>
          )}
          {result.data.trace_id ? (
            <div className="muted mt-2">
              trace_id <span className="tag">{result.data.trace_id}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
