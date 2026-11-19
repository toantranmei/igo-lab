import { notFound, redirect } from 'next/navigation';
import SessionTab from '@/components/shell/SessionTab';

/** run · inputs · results · dictionary are the main screens; line, framework and audit are kept as addresses. */
const TABS = ['run', 'inputs', 'results', 'dictionary', 'line', 'framework', 'audit'];

export default async function Page({ params }: { params: Promise<{ session: string; tab: string }> }) {
  const { session, tab } = await params;
  if (session === 'example') redirect(`/demo/${tab === 'run' ? 'line' : tab === 'results' ? 'framework' : tab}`);
  // the dictionary belongs to the workspace, not to a session: its address is /dictionary
  if (tab === 'dictionary') redirect(`/dictionary?s=${encodeURIComponent(session)}`);
  if (!TABS.includes(tab)) notFound();
  return <SessionTab sessionId={session} tab={tab} />;
}
