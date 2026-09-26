import { NextResponse } from 'next/server';
import { findUser } from '@bsdemo/shared/users';
import { SESSION_COOKIE, USER_COOKIE } from '@/lib/user';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const user = findUser(body.id);
  const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name } });
  res.cookies.set(USER_COOKIE, user.id, { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' });
  // new backend session id on every switch
  res.cookies.set(SESSION_COOKIE, `s-${Math.random().toString(36).slice(2, 10)}`, { path: '/', maxAge: 1800, sameSite: 'lax' });
  return res;
}
