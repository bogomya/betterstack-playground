import { DEMO_USERS, GUEST_USER } from '@bsdemo/shared/users';
import { currentUser } from '@/lib/user';
import SwitchUser from './SwitchUser';

export default async function AccountPage() {
  const user = await currentUser();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Who are you today?</h1>
      <p className="muted mb-6 text-sm">
        Switching user re-identifies the RUM session (<code>betterstack(&apos;user&apos;, …)</code>) and changes the <code>x-user-*</code> headers sent to the
        backends, so logs, traces and errors carry the same identity end to end. Each persona has a built-in failure mode.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {[...DEMO_USERS, GUEST_USER].map((u) => (
          <SwitchUser key={u.id} user={u} active={u.id === user.id} />
        ))}
      </div>
    </div>
  );
}
