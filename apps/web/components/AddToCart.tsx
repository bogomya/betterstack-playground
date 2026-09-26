'use client';

import { useState } from 'react';
import { addToCart } from '@/lib/cart';
import { track } from '@/lib/rum';
import type { Product } from '@/lib/api';

export default function AddToCart({ product }: { product: Product }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      className={`btn ${added ? 'btn-ok' : 'btn-accent'}`}
      data-testid="add-to-cart"
      disabled={product.stock === 0}
      onClick={() => {
        addToCart({ productId: product.id, name: product.name, price_cents: product.price_cents, emoji: product.emoji });
        track('add-to-cart', { product_id: product.id, sku: product.sku, price_cents: product.price_cents });
        setAdded(true);
        setTimeout(() => setAdded(false), 1200);
      }}
    >
      {product.stock === 0 ? 'Sold out' : added ? 'Added ✓' : 'Add to cart'}
    </button>
  );
}
