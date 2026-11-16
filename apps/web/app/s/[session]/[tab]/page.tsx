import { notFound } from 'next/navigation';
import SessionTab from '@/components/shell/SessionTab';

const TABS = ['line', 'inputs', 'framework', 'dictionary', 'audit'];

export default async function Page({ params }: { params: Promise<{ session: string; tab: string }> }) {
  const { session, tab } = await params;
  if (!TABS.includes(tab)) notFound();
  return <SessionTab sessionId={session} tab={tab} />;
}
