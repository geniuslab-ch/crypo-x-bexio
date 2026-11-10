import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/next';

export default async function Home() {
  redirect((await currentSession()) ? '/dashboard' : '/login');
}
