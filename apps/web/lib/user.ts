import { cookies } from 'next/headers';
import { findUser, type DemoUser } from '@bsdemo/shared/users';

export const USER_COOKIE = 'bs_user';
export const SESSION_COOKIE = 'bs_sid';

export async function currentUser(): Promise<DemoUser & { sessionId?: string }> {
  const jar = await cookies();
  const user = findUser(jar.get(USER_COOKIE)?.value);
  return { ...user, sessionId: jar.get(SESSION_COOKIE)?.value };
}
