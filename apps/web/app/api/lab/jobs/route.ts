import { NextResponse } from 'next/server';
import { ordersApi } from '@/lib/api';

export async function POST(request: Request) {
  const body = (await request.json()) as { job: 'cpu-burn' | 'memory-hog'; seconds?: number; mb?: number };
  const res = await ordersApi(`/admin/jobs/${body.job}`, { method: 'POST', body });
  return NextResponse.json(res.data, { status: res.status });
}
