'use client';
import Link from 'next/link';
import { SessionProvider, useSession } from '@/lib/session';
import Shell from './Shell';
import LiveShell from './LiveShell';
import GuideProvider from '@/components/guide/GuideProvider';
import ProductionScreen from '@/components/line/ProductionScreen';
import InputsScreen from '@/components/inputs/InputsScreen';
import FrameworkScreen from '@/components/framework/FrameworkScreen';
import DictionaryScreen from '@/components/dictionary/DictionaryScreen';
import AuditScreen from '@/components/audit/AuditScreen';
import LiveInputsPanel from '@/components/live/LiveInputsPanel';
import LiveReleasePanel from '@/components/live/LiveReleasePanel';
import RunScreen from '@/components/run/RunScreen';
import Affected from '@/components/run/Affected';
import { useState } from 'react';

/** Example (demo) screens: the original layout, unchanged. */
function DemoBody({ tab }: { tab: string }) {
  const { state } = useSession();
  if (!state) return <section className="tab active"><p className="dim">Đang tải phiên…</p></section>;
  return (
    <section className="tab active" id={tab}>
      {tab === 'line' && <ProductionScreen />}
      {tab === 'inputs' && <InputsScreen />}
      {tab === 'framework' && <FrameworkScreen />}
      {tab === 'dictionary' && <DictionaryScreen />}
      {tab === 'audit' && <AuditScreen />}
    </section>
  );
}

type ResultPart = 'changes' | 'framework' | 'affected' | 'audit';
const RESULT_TABS: [ResultPart, string][] = [
  ['changes', 'Thay đổi từ điển'],
  ['framework', 'Khung'],
  ['affected', 'Khung bị ảnh hưởng'],
  ['audit', 'Thẩm định và bài học'],
];
/** P3.11 "Kết quả và duyệt": four parts; /framework and /audit open the matching one. */
function Results({ part: initial }: { part: ResultPart }) {
  const [part, setPart] = useState<ResultPart>(initial);
  return (
    <>
      <div className="lv-tabs" role="tablist" style={{ margin: '0 0 14px', padding: 0 }}>
        {RESULT_TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={part === k} className={part === k ? 'on' : ''} data-result-tab={k} onClick={() => setPart(k)}>
            {l}
          </button>
        ))}
      </div>
      {part === 'changes' && <LiveReleasePanel />}
      {part === 'framework' && <FrameworkScreen />}
      {part === 'affected' && <Affected />}
      {part === 'audit' && (
        <>
          <AuditScreen />
          {/* the decision footer (reason, reject, accept and publish) closes the review screen */}
          <LiveReleasePanel />
        </>
      )}
    </>
  );
}

type InputPart = 'setup' | 'data' | 'lessons';
const INPUT_TABS: [InputPart, string][] = [
  ['setup', 'Thiết lập lượt mới'],
  ['data', 'Dữ liệu của lượt'],
  ['lessons', 'Bài học tự nạp'],
];
/** P3.10 "Đầu vào": three parts. */
function Inputs() {
  const { state } = useSession();
  const [part, setPart] = useState<InputPart>(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('doc') ? 'data' : 'setup');
  return (
    <>
      <div className="lv-tabs" role="tablist" style={{ margin: '0 0 14px', padding: 0 }}>
        {INPUT_TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={part === k} className={part === k ? 'on' : ''} data-input-tab={k} onClick={() => setPart(k)}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ display: part === 'setup' ? undefined : 'none' }}>
        <LiveInputsPanel />
      </div>
      {part === 'data' && <InputsScreen />}
      {part === 'lessons' && (
        <div className="lv-card" style={{ marginTop: 0 }} data-testid="lessons-tab">
          <h4>Bài học tự nạp</h4>
          {state?.lessons.length ? (
            <ul>
              {state.lessons.map((l) => (
                <li key={l.id}>
                  {l.text} <span className="lv-muted">· {l.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lv-empty">Chưa có phát hiện thẩm định nào.</p>
          )}
          <p className="lv-muted" style={{ fontSize: 12 }}>Phát hiện của thẩm định và lý do từ chối của các lượt trước cùng vị trí được nạp thẳng vào lượt sau (danh sách của lượt hiện tại ở tab Thiết lập lượt mới).</p>
        </div>
      )}
    </>
  );
}

function LiveBody({ tab }: { tab: string }) {
  const { state } = useSession();
  if (!state) return <p className="lv-empty">Đang tải phiên…</p>;
  const id = tab === 'results' ? 'framework' : tab;
  return (
    <section className="tab active" id={id}>
      {tab === 'run' && <RunScreen />}
      {tab === 'inputs' && <Inputs />}
      {tab === 'results' && <Results part="changes" />}
      {tab === 'framework' && <Results part="framework" />}
      {tab === 'audit' && <Results part="audit" />}
      {tab === 'dictionary' && <DictionaryScreen />}
    </section>
  );
}

export default function SessionTab({ sessionId, tab }: { sessionId: string; tab: string }) {
  return (
    <SessionProvider sessionId={sessionId}>
      <GuideProvider resume={sessionId === 'example' || tab === 'line'}>
        <Body sessionId={sessionId} tab={tab} />
      </GuideProvider>
    </SessionProvider>
  );
}

function Body({ sessionId, tab }: { sessionId: string; tab: string }) {
  const { source } = useSession();
  // The old production line stays reachable at /line until StepDetail fully replaces it (end of P0).
  if (source.mode === 'example' || tab === 'line')
    return (
      <Shell tab={tab}>
        {source.mode === 'example' ? (
          <DemoBody tab={tab} />
        ) : (
          <section className="tab active" id="line">
            <ProductionScreen />
          </section>
        )}
      </Shell>
    );
  void sessionId;
  return (
    <LiveShell tab={tab}>
      <LiveBody tab={tab} />
    </LiveShell>
  );
}
