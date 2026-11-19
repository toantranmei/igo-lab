import { notFound } from 'next/navigation';
import SessionTab from '@/components/shell/SessionTab';

const TABS = ['line', 'inputs', 'framework', 'dictionary', 'audit'];

/** The Example mode (simulated seed, runs in the browser) on its own address, with all its features. */
export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!TABS.includes(tab)) notFound();
  return <SessionTab sessionId="example" tab={tab} />;
}
