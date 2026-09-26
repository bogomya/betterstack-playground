import Link from 'next/link';
import { notFound } from 'next/navigation';
import AddToCart from '@/components/AddToCart';
import { money, ordersApi, type Product } from '@/lib/api';
import { currentUser } from '@/lib/user';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const res = await ordersApi<{ products?: Product[] }>('/products', { user });
  const product = res.data?.products?.find((p) => String(p.id) === id);
  if (!product) notFound();

  return (
    <div className="panel mx-auto max-w-2xl p-6">
      <Link href="/" className="muted text-sm">
        ← back to shop
      </Link>
      <div className="mt-4 flex gap-6">
        <div className="text-7xl">{product.emoji}</div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          <p className="muted mt-1">{product.description}</p>
          <p className="mt-4 text-xl font-semibold">{money(product.price_cents)}</p>
          <p className="muted text-sm">
            SKU {product.sku} · {product.stock} in stock
          </p>
          <div className="mt-4">
            <AddToCart product={product} />
          </div>
        </div>
      </div>
    </div>
  );
}
