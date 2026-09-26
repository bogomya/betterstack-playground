import Link from 'next/link';
import AddToCart from '@/components/AddToCart';
import { money, ordersApi, type Product } from '@/lib/api';
import { currentUser } from '@/lib/user';

export default async function ShopPage() {
  const user = await currentUser();
  const res = await ordersApi<{ products?: Product[]; error?: string; message?: string }>('/products', { user });
  const products = res.data?.products ?? [];

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fresh roasts &amp; gear</h1>
          <p className="muted text-sm">
            Hi {user.name}. Add something to the cart and check out; every step is traced, logged and error-tracked in Better Stack.
          </p>
        </div>
        <Link href="/lab" className="btn">
          🧪 Open the Chaos Lab
        </Link>
      </div>
      {res.status !== 200 ? (
        <div className="panel mb-6 p-4 text-sm text-[#f85149]">
          Catalogue unavailable (orders-api → inventory-api returned {res.status}: {res.data?.message ?? res.data?.error}). This is what a real
          outage looks like; check the trace and the Uptime monitors.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((p) => (
          <div key={p.id} className="panel flex flex-col gap-3 p-4">
            <Link href={`/product/${p.id}`} className="text-4xl">
              {p.emoji}
            </Link>
            <div>
              <Link href={`/product/${p.id}`} className="font-medium hover:underline">
                {p.name}
              </Link>
              <p className="muted text-xs">{p.description}</p>
            </div>
            <div className="mt-auto flex items-center justify-between">
              <span className="font-semibold">{money(p.price_cents)}</span>
              <span className={`text-xs ${p.stock < 5 ? 'text-[#d29922]' : 'muted'}`}>{p.stock} in stock</span>
            </div>
            <AddToCart product={p} />
          </div>
        ))}
      </div>
    </div>
  );
}
