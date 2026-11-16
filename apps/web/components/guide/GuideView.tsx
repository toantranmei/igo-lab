'use client';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { TRACE_KIND_LABEL, diffDraft, gateBlocks, type BlockTrace, type GateResult, type TraceEvent } from '@cl/contract';
import DataView, { showValue } from './DataView';
import { PHASES, type MobilePane, type ViewerActions, type ViewerState } from './types';

interface Props {
  viewer: ViewerState;
  actions: ViewerActions;
  auto: boolean;
  speed: number;
  live: boolean;
  runLabel: string;
  fallbackName: string;
  retrying: boolean;
}

const PANES: { id: MobilePane; label: (n: number) => string }[] = [
  { id: 'seed', label: () => 'Seed' },
  { id: 'calc', label: () => 'Phép tính' },
  { id: 'output', label: (n) => `Output nháp (${n})` },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('vi-VN');
}

/** Wraps every number of the substitution in <mark>, like the reference. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+(?:[.,]\d+)?%?)/).map((t, k) => (k % 2 ? <mark key={k}>{t}</mark> : t))}
    </>
  );
}

function sourceLabel(e: TraceEvent): string {
  if (e.source === 'CODE') return 'Code tính';
  return ['AI', e.source.task_id, e.source.model, e.source.effort].filter(Boolean).join(' · ');
}

function metricValue(v: unknown): string {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return String(Number(v));
  return showValue(v);
}

function Metrics({ event }: { event: TraceEvent }) {
  const keys = [...new Set([...Object.keys(event.before), ...Object.keys(event.after)])];
  if (!keys.length) return <p className="trace-empty">Chưa khởi tạo biến. Bấm Tiếp theo để đưa bản ghi đầu tiên vào phép tính.</p>;
  return (
    <div className="trace-metrics" data-testid="guide-metrics">
      <div className="trace-minihead">
        <span>BIẾN / BỘ ĐẾM</span>
        <span>TRƯỚC</span>
        <span>SAU NHỊP NÀY</span>
      </div>
      {keys.map((k) => {
        const before = event.before[k];
        const after = event.after[k];
        const changed = JSON.stringify(before) !== JSON.stringify(after);
        return (
          <div key={k} className={changed ? 'changed' : undefined}>
            <span>{k.replaceAll('_', ' ')}</span>
            <b>{metricValue(before)}</b>
            <strong>{metricValue(after)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function gateView(g: GateResult): { cls: string; icon: string; text: string } {
  const pair = `${showValue(g.actual)} / ${g.criterion}`;
  switch (g.status) {
    case 'PASS':
      return { cls: 'pass', icon: '✓', text: `${pair} · ĐẠT` };
    case 'FAIL':
      return { cls: 'fail', icon: '⊘', text: `${pair} · KHÔNG ĐẠT${g.required ? ' → chặn bàn giao' : ''}${g.reason ? ' · ' + g.reason : ''}` };
    case 'NOT_EVALUATED':
      return { cls: gateBlocks(g) ? 'fail' : 'skipped', icon: '○', text: `chưa đánh giá · yêu cầu: ${g.criterion}${gateBlocks(g) ? ' → chặn bàn giao' : ''}` };
    default:
      return { cls: gateBlocks(g) ? 'fail' : 'skipped', icon: '–', text: `không áp dụng · ${g.reason ?? 'thiếu lý do → chặn bàn giao'}` };
  }
}

function Acceptance({ trace, cursor }: { trace: BlockTrace; cursor: number }) {
  const event = trace.events[cursor];
  if (PHASES.indexOf(event.kind) < 2) return null;
  const done = event.kind === 'HANDOFF' ? trace.gates.length : trace.events.slice(0, cursor + 1).filter((x) => x.kind === 'GATE').length;
  if (!trace.gates.length) return null;
  return (
    <div className="trace-criteria" data-testid="guide-gates">
      {trace.gates.map((g, i) => {
        if (i >= done)
          return (
            <div key={g.gate_id} className="waiting" data-gate-status="WAITING">
              <b>○</b>
              <span>{g.name}</span>
              <small>Chưa kiểm · yêu cầu: {g.criterion}</small>
            </div>
          );
        const v = gateView(g);
        return (
          <div key={g.gate_id} className={v.cls} data-gate-status={g.status}>
            <b>{v.icon}</b>
            <span>{g.name}</span>
            <small>{v.text}</small>
          </div>
        );
      })}
    </div>
  );
}

function SeedPane({ viewer, event, actions, live }: { viewer: ViewerState; event: TraceEvent; actions: ViewerActions; live: boolean }) {
  const trace = viewer.trace!;
  const records = useMemo(() => {
    const used = new Set<string>([...trace.input_keys, ...trace.events.flatMap((x) => x.record_refs)]);
    const hit = trace.records.filter((r) => used.has(r.key));
    return hit.length ? hit : trace.records;
  }, [trace]);
  const keys = useMemo(() => new Set(trace.records.map((r) => r.key)), [trace]);
  const current = records.find((r) => r.key === viewer.recordKey) ?? trace.records.find((r) => r.key === viewer.recordKey) ?? records[0];
  return (
    <section className="trace-seed" id="trace-pane-seed" aria-label="Bản ghi đầu vào">
      <div className="trace-panel-title">
        <b>{live ? '1 / BẢN GHI ĐANG DÙNG' : '1 / SEED THỰC TẾ'}</b>
        <button type="button" id="trace-toggle-records" aria-expanded={viewer.showAll} onClick={actions.toggleRecords}>
          {viewer.showAll ? 'Thu gọn' : `Tất cả ${records.length} bản ghi`}
        </button>
      </div>
      <div className={'trace-record-picker' + (viewer.showAll ? ' expanded' : '')}>
        {records.map((r) => {
          const chosen = current?.key === r.key;
          const used = event.record_refs.includes(r.key);
          return (
            <button type="button" key={r.key} data-trace-record={r.key} data-used={used} aria-pressed={chosen} className={(chosen ? 'chosen ' : '') + (used ? 'used' : '')} onClick={() => actions.pickRecord(r.key)}>
              {r.label}
            </button>
          );
        })}
      </div>
      {current ? (
        <>
          <div className="trace-source-title">
            {current.label} <span>{event.record_refs.includes(current.key) ? '↗ Đang dùng ở nhịp này' : 'Đang xem bản ghi khác'}</span>
          </div>
          <div className="trace-seed-data">
            <DataView value={current.data} recordKeys={keys} onPickRecord={actions.pickRecord} />
          </div>
        </>
      ) : (
        <p className="trace-empty">Chưa có bản ghi</p>
      )}
    </section>
  );
}

function OutputPane({ trace, cursor }: { trace: BlockTrace; cursor: number }) {
  const event = trace.events[cursor];
  const listRef = useRef<HTMLDivElement>(null);
  const changes = useMemo(() => diffDraft(cursor ? trace.events[cursor - 1].draft : [], event.draft), [trace, cursor, event]);
  useEffect(() => {
    const list = listRef.current;
    const hot = list?.querySelector<HTMLElement>('.added,.updated');
    if (list && hot) list.scrollTop = Math.max(0, hot.offsetTop - list.offsetTop - 15);
  }, [trace, cursor]);
  return (
    <section className="trace-output" id="trace-pane-output" aria-label="Output nháp" data-testid="guide-draft">
      <div className="trace-panel-title">
        <b>3 / OUTPUT {event.kind === 'HANDOFF' ? 'BÀN GIAO' : 'ĐANG HÌNH THÀNH'}</b>
        <span>{event.draft.length} phần tử</span>
      </div>
      {event.delta ? <div className="trace-delta">{event.delta}</div> : null}
      {changes.length ? (
        <div className="trace-output-list" ref={listRef}>
          {changes.map((c) => (
            <article key={c.id} className={c.op === 'ADD' ? 'added' : c.op === 'CHANGE' ? 'updated' : undefined} data-draft-op={c.op}>
              <div>
                <b>{c.id}</b>
                <span>{c.op === 'ADD' ? '+ THÊM' : c.op === 'CHANGE' ? '↻ ĐỔI' : 'GIỮ'}</span>
              </div>
              {c.op === 'CHANGE' ? <p className="trace-old">Trước: {c.before}</p> : null}
              <p>{c.value}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="trace-empty-output">
          ∅
          <p>
            Đầu ra nháp đang rỗng.
            <br />
            Mỗi nhịp sẽ thêm hoặc cập nhật phần tử tại đây.
          </p>
        </div>
      )}
    </section>
  );
}

export default function GuideView({ viewer, actions, auto, speed, live, runLabel, fallbackName, retrying }: Props) {
  const { trace, detail, cursor, preview } = viewer;
  const bodyRef = useRef<HTMLDivElement>(null);
  const events = trace?.events ?? [];
  const event: TraceEvent | undefined = events[cursor];
  const phase = event ? PHASES.indexOf(event.kind) : -1;

  // A new phase starts from the top of the scroll area (reference behaviour).
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [phase, viewer.token]);

  const name = detail?.name || fallbackName;
  const eyebrow = preview
    ? live
      ? 'XEM LẠI DIỄN TIẾN · KHÔNG GHI DỮ LIỆU'
      : 'XEM TRƯỚC TRÊN BẢN SAO SEED'
    : viewer.committed
      ? 'XEM LẠI DIỄN TIẾN · OUTPUT ĐÃ GHI'
      : 'TÍNH TỪNG BẢN GHI · CHỈ GHI KHI BÀN GIAO';

  const header = (
    <header className="guide-header">
      <div>
        <div className="eyebrow">
          {eyebrow}
          {runLabel ? ` / ${runLabel.toUpperCase()}` : ''}
        </div>
        <h2 id="guide-title">
          {viewer.id} · {name}
        </h2>
      </div>
      <div className="trace-header-actions">
        {!live ? (
          <button type="button" id="guide-reset" onClick={actions.reset}>
            ↶ Bắt đầu lại seed
          </button>
        ) : null}
        <button type="button" id="guide-close" aria-label="Đóng ngăn và giữ tiến độ" onClick={actions.close}>
          ×
        </button>
      </div>
    </header>
  );

  if (!trace || !event) {
    const err = detail?.error;
    return (
      <div className="guide-shell">
        {header}
        <div className="guide-body trace-body" ref={bodyRef}>
          {err ? (
            <div className="trace-error" role="alert" data-testid="guide-error">
              <b>Block {viewer.id} gặp lỗi khi tính.</b>
              <dl>
                <dt>Mã lỗi</dt>
                <dd>
                  <code>{err.code}</code>
                </dd>
                <dt>Thông báo</dt>
                <dd>{err.message}</dd>
                {err.attempt_id ? (
                  <>
                    <dt>Lần thử</dt>
                    <dd>
                      <code>{err.attempt_id}</code>
                    </dd>
                  </>
                ) : null}
              </dl>
              {!preview ? (
                <button type="button" id="guide-retry" className="primary" disabled={retrying} onClick={actions.retry}>
                  {retrying ? 'Đang gửi lại…' : 'Thử lại'}
                </button>
              ) : null}
            </div>
          ) : viewer.loadError ? (
            <div className="trace-error" role="alert" data-testid="guide-error">
              <b>Không tải được diễn tiến.</b>
              <p>{viewer.loadError}</p>
              <button type="button" id="guide-retry" onClick={actions.retry} disabled={retrying}>
                Thử lại
              </button>
            </div>
          ) : viewer.waiting === 'empty' ? (
            <div className="trace-waiting" data-testid="guide-empty">
              <b>Chưa có diễn tiến để xem.</b>
              <p>{detail?.blockedAt ? `${detail.blockedAt} đang chặn; ${viewer.id} không có đầu ra hợp lệ để tính.` : `${viewer.id} chưa chạy. Mở card không tạo job; bấm “Tiến 1 bước” để chạy block này.`}</p>
            </div>
          ) : (
            <div className="trace-waiting" role="status" data-testid="guide-computing">
              <i aria-hidden="true" />
              <b>Đang tính…</b>
              <p>{viewer.waiting === 'computing' ? 'Máy chủ đang tính block này. Ngăn sẽ tự hiện diễn tiến khi có kết quả; bạn có thể đóng và mở lại sau.' : 'Đang tải diễn tiến của block.'}</p>
            </div>
          )}
        </div>
        <footer className="guide-footer">
          <div>
            <span>Tiến độ được giữ lại khi đóng ngăn</span>
          </div>
          <div>
            <button type="button" id="guide-dismiss" onClick={actions.close}>
              Đóng
            </button>
          </div>
        </footer>
      </div>
    );
  }

  const last = cursor === events.length - 1;
  const blocked = trace.gates.some(gateBlocks);
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = PANES.findIndex((p) => p.id === viewer.pane);
    const to = PANES[(i + (e.key === 'ArrowRight' ? 1 : PANES.length - 1)) % PANES.length];
    actions.setPane(to.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-trace-pane="${to.id}"]`)?.focus({ preventScroll: true });
  };

  return (
    <div className="guide-shell">
      {header}
      <div className="guide-run-strip">
        <span role="status">
          {auto ? '▶ Tự động' : '☝ Thủ công · bấm Tiếp theo'}{' '}
          <b>
            <span data-testid="guide-beat">
              Nhịp {cursor + 1}/{events.length}
            </span>
          </b>
        </span>
        <div>
          <button type="button" id="guide-auto" aria-pressed={auto} disabled={last && !auto} onClick={actions.toggleAuto}>
            {auto ? 'Ⅱ Dừng tự động' : '▶ Tự động'}
          </button>
          {auto ? (
            <button type="button" id="guide-speed" aria-label={`Tốc độ ${speed}×`} onClick={actions.toggleSpeed}>
              {speed}×
            </button>
          ) : null}
        </div>
      </div>
      <nav className="guide-rail" aria-label="Bốn giai đoạn của block">
        {PHASES.map((kind, k) => {
          const first = events.findIndex((x) => x.kind === kind);
          const available = first >= 0 && first <= viewer.furthest;
          return (
            <button type="button" key={kind} data-guide-stage={kind} disabled={!available} aria-current={phase === k ? 'step' : undefined} className={phase === k ? 'current' : k < phase ? 'done' : undefined} onClick={() => actions.stage(kind)}>
              <b>{k < phase ? '✓' : '0' + (k + 1)}</b>
              <span>{TRACE_KIND_LABEL[kind]}</span>
            </button>
          );
        })}
      </nav>
      <div className="guide-body trace-body" ref={bodyRef} data-cursor={cursor} data-phase={event.kind} data-complete={last}>
        <div className="trace-step-title">
          <span>
            NHỊP {cursor + 1} · {TRACE_KIND_LABEL[event.kind].toUpperCase()}
          </span>
          <h3>{event.title}</h3>
          {event.explanation ? <p>{event.explanation}</p> : null}
          <div className="trace-step-meta">
            <span className={'cl-badge ' + (event.source === 'CODE' ? 'code' : 'ai')} data-testid="guide-source">
              {sourceLabel(event)}
            </span>
            {live ? (
              <span className="trace-computed" data-testid="guide-computed-at">
                Đã tính lúc {formatTime(event.computed_at || trace.computed_at)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="trace-mobile-tabs" role="tablist" aria-label="Ba ngăn của nhịp" onKeyDown={onTabKey}>
          {PANES.map((p) => (
            <button type="button" key={p.id} role="tab" id={`trace-tab-${p.id}`} data-trace-pane={p.id} aria-selected={viewer.pane === p.id} aria-controls={`trace-pane-${p.id}`} tabIndex={viewer.pane === p.id ? 0 : -1} onClick={() => actions.setPane(p.id)}>
              {p.label(event.draft.length)}
            </button>
          ))}
        </div>
        <div className="trace-workspace" data-mobile-pane={viewer.pane}>
          <SeedPane viewer={viewer} event={event} actions={actions} live={live} />
          <section className="trace-calculation" id="trace-pane-calc" aria-label="Phép tính">
            <div className="trace-panel-title">
              <b>2 / CÔNG THỨC &amp; GIÁ TRỊ TRUNG GIAN</b>
              <span>{sourceLabel(event)}</span>
            </div>
            <div className="guide-equation">
              <small>CÔNG THỨC</small>
              <strong data-testid="guide-formula">{event.formula ?? '—'}</strong>
            </div>
            <div className="guide-numbers resolved">
              <small>DỮ LIỆU ĐANG ĐƯỢC THAY VÀO</small>
              <strong data-testid="guide-substitution">{event.substitution ? <Marked text={event.substitution} /> : '—'}</strong>
              {event.denominator ? (
                <p className="trace-denominator" data-testid="guide-denominator">
                  Mẫu số = <mark>{event.denominator.value}</mark> · {event.denominator.note}
                  {event.denominator.value === 0 ? ' · Không tính được' : ''}
                </p>
              ) : null}
            </div>
            <Metrics event={event} />
            <div className="trace-mobile-delta">
              {event.delta ? `${event.delta} · ` : ''}
              {event.draft.length} phần tử output nháp{' '}
              <button type="button" onClick={() => actions.setPane('output')}>
                Xem thay đổi →
              </button>
            </div>
            <Acceptance trace={trace} cursor={cursor} />
            {last ? (
              <>
                <div className={'trace-commit-state' + (blocked ? ' blocked' : '')} data-testid="guide-commit-state">
                  {preview ? 'Xem trước: không ghi dữ liệu' : viewer.committed ? '✓ Đã ghi đúng một lần vào lượt đang chạy' : 'Chưa ghi output'}
                  {blocked ? ' · ⊘ Cổng bắt buộc chưa đạt: block vẫn bị chặn sau khi bấm Đã hiểu.' : ''}
                </div>
                <div className="guide-handoff">
                  <small>{blocked ? 'CHẶN BÀN GIAO' : 'CHUYỂN SANG ĐÂU?'}</small>
                  <p>{detail?.handoff || '—'}</p>
                </div>
              </>
            ) : null}
          </section>
          <OutputPane trace={trace} cursor={cursor} />
        </div>
        {last ? (
          <details className="trace-final-record">
            <summary>Đầu ra đầy đủ vừa tính của {viewer.id}</summary>
            <DataView value={trace.expected} />
          </details>
        ) : null}
        <details className="trace-history">
          <summary>Nhật ký {cursor} phép xử lý đã đi qua</summary>
          {cursor ? (
            events.slice(1, cursor + 1).map((x, i) => (
              <button type="button" key={i} data-trace-jump={i + 1} onClick={() => actions.jump(i + 1)}>
                <b>
                  {i + 1}. {x.title}
                </b>
                <span>{x.substitution ?? ''}</span>
              </button>
            ))
          ) : (
            <p>Chưa thực hiện phép tính.</p>
          )}
        </details>
      </div>
      <footer className="guide-footer">
        <div>
          <span>{last ? 'Đã đi hết diễn tiến của block' : auto ? 'Đang tự đọc từng bản ghi' : 'Mỗi lần bấm = một lần cập nhật dữ liệu'}</span>
          <small>{last ? 'Đã hiểu chỉ mở khóa phần xem, không đổi kết quả cổng.' : 'Các ô đổi được tô sáng; output nháp chưa phải bản đã phát hành.'}</small>
        </div>
        <div>
          <button type="button" id="guide-back" disabled={!cursor} onClick={actions.back}>
            ← Trước
          </button>
          <button type="button" id="guide-replay" onClick={actions.replay}>
            ↶ Xem lại
          </button>
          {last ? (
            <button type="button" id="guide-understood" className="primary" onClick={actions.understood}>
              {preview ? 'Đã xem · đóng' : 'Đã hiểu · đóng block'} ✓
            </button>
          ) : (
            <button type="button" id="guide-next" className={'primary' + (auto ? '' : ' manual-next-pulse')} onClick={actions.next}>
              Tiếp theo: {events[cursor + 1].title} →
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
