import { currentUser } from '@/lib/user';
import Lab from './Lab';

export default async function LabPage() {
  const user = await currentUser();
  return <Lab user={user} />;
}
