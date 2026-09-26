'use client';

export interface CartItem {
  productId: number;
  qty: number;
  name: string;
  price_cents: number;
  emoji: string;
}

const KEY = 'bs_cart';

export function readCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new Event('bs-cart'));
  } catch {
    /* ignore */
  }
}

export function addToCart(item: Omit<CartItem, 'qty'>, qty = 1): CartItem[] {
  const cart = readCart();
  const existing = cart.find((c) => c.productId === item.productId);
  if (existing) existing.qty += qty;
  else cart.push({ ...item, qty });
  writeCart(cart);
  return cart;
}

export function clearCart(): void {
  writeCart([]);
}
