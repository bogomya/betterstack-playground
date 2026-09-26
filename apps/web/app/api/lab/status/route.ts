import { NextResponse } from 'next/server';
import { ordersApi } from '@/lib/api';

export async function GET() {
  const res = await ordersApi('/admin/status', { timeoutMs: 8000 });
  return NextResponse.json(res.data, { status: res.status });
}
