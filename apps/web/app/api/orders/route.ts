import { NextResponse } from 'next/server';
import { ordersApi } from '@/lib/api';
import { currentUser } from '@/lib/user';

export async function GET() {
  const user = await currentUser();
  const res = await ordersApi('/orders?limit=30', { user });
  return NextResponse.json(res.data, { status: res.status });
}
