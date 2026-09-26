import { NextResponse } from 'next/server';
import { ordersApi } from '@/lib/api';

export async function GET() {
  const res = await ordersApi('/admin/loadgen');
  return NextResponse.json(res.data, { status: res.status });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const res = await ordersApi('/admin/loadgen', { method: 'PUT', body });
  return NextResponse.json(res.data, { status: res.status });
}
