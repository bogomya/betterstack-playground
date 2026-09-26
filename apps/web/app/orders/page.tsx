import OrdersList from './OrdersList';
import { currentUser } from '@/lib/user';

export default async function OrdersPage() {
  const user = await currentUser();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Orders for {user.name}</h1>
      <p className="muted mb-4 text-sm">
        Status moves from <span className="tag">paid</span> to <span className="tag">fulfilled</span> (or <span className="tag">failed</span>) when the BullMQ
        worker processes the job. Refreshes every 3 seconds.
      </p>
      <OrdersList />
    </div>
  );
}
