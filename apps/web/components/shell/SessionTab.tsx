'use client';
import { SessionProvider, useSession } from '@/lib/session';
import Shell from './Shell';
import GuideProvider from '@/components/guide/GuideProvider';
import ProductionScreen from '@/components/line/ProductionScreen';
import InputsScreen from '@/components/inputs/InputsScreen';
import FrameworkScreen from '@/components/framework/FrameworkScreen';
import DictionaryScreen from '@/components/dictionary/DictionaryScreen';
import AuditScreen from '@/components/audit/AuditScreen';
import LiveInputsPanel from '@/components/live/LiveInputsPanel';
import LiveReleasePanel from '@/components/live/LiveReleasePanel';

function Body({ tab }: { tab: string }) {
  const { state, source } = useSession();
  if (!state) return <section className="tab active"><p className="dim">Đang tải phiên…</p></section>;
  const live = source.mode === 'live';
  return (
    <section className="tab active" id={tab}>
      {tab === 'line' && <ProductionScreen />}
      {tab === 'inputs' && (
        <>
          {live && <LiveInputsPanel />}
          <InputsScreen />
        </>
      )}
      {tab === 'framework' && <FrameworkScreen />}
      {tab === 'dictionary' && <DictionaryScreen />}
      {tab === 'audit' && (
        <>
          {live && <LiveReleasePanel />}
          <AuditScreen />
        </>
      )}
    </section>
  );
}

export default function SessionTab({ sessionId, tab }: { sessionId: string; tab: string }) {
  return (
    <SessionProvider sessionId={sessionId}>
      <GuideProvider>
        <Shell tab={tab}>
          <Body tab={tab} />
        </Shell>
      </GuideProvider>
    </SessionProvider>
  );
}
