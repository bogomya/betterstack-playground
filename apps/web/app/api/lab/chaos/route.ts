import { NextResponse } from 'next/server';
import { ordersApi } from '@/lib/api';

export async function PUT(request: Request) {
  const body = (await request.json()) as { service: string; key: string; value: string | null };
  const res = await ordersApi(`/admin/chaos/${encodeURIComponent(body.service)}`, { method: 'PUT', body: { key: body.key, value: body.value } });
  return NextResponse.json(res.data, { status: res.status });
}

export async function DELETE() {
  const res = await ordersApi('/admin/chaos', { method: 'DELETE' });
  return NextResponse.json(res.data, { status: res.status });
}
