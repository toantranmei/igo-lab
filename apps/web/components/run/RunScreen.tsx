'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockId, StopAction } from '@cl/contract';
import { api } from '@/lib/live-source';
import { useSession } from '@/lib/session';
import StopBanner from './StopBanner';
import StepDetail, { type StepTab } from './StepDetail';
import RunHistory from './RunHistory';
import { dayTime, dur, hhmm, hhmmss, num, tokens, usd, type LogRows, type Overview, type OverviewStepT, type RunRow, type Usage } from './format';
import './run.css';

const ICON: Record<OverviewStepT['status'], [string, string]> = { idle: ['', ''], queued: ['run', '…'], running: ['run', '▸'], done: ['ok', '✓'], blocked: ['bad', '⊘'], failed: ['warn', '!'], stale: ['', '↺'] };

function gateText(s: OverviewStepT) {
  if (s.status === 'running' || s.status === 'queued') return <span className="lv-chip run">đang chạy</span>;
  if (s.status === 'failed') return <span className="lv-chip warn">chưa tới cổng</span>;
  if (!s.gates.length) return null;
  // gate ids are numbered per step (B1.G1, B2.G1…): show a count, the failing gate by name
  const bad = s.gates.find((g) => g.blocking);
  if (bad) return <span className="lv-chip bad" title={bad.name}>chặn · {bad.name}</span>;
  const pass = s.gates.filter((g) => g.status === 'PASS').length;
  const dev = s.gates.filter((g) => g.deviation).length;
  if (dev) return <span className="lv-chip warn" title={s.gates.filter((g) => g.deviation).map((g) => g.name).join('\n')}>{pass}/{s.gates.length} đạt · {dev} phiếu sai lệch</span>;
  const na = s.gates.filter((g) => g.status === 'NOT_APPLICABLE' || g.status === 'NOT_EVALUATED').length;
  return <span className={'lv-chip ' + (pass ? 'ok' : 'mute')} title={s.gates.map((g) => `${g.name}: ${g.status}`).join('\n')}>{pass}/{s.gates.length} cổng đạt{na ? ` · ${na} không áp dụng` : ''}</span>;
}
function subtitle(s: OverviewStepT) {
  if (s.status === 'running') {
    const live = s.substeps.find((x) => x.done + x.failed < x.total) ?? s.substeps.at(-1);
    return live ? (live.done + live.failed < live.total ? `${live.title}: ${live.done}/${live.total} lời gọi` : 'code đang tổng hợp kết quả') : 'đang tính (code)';
  }
  if (s.status === 'failed') return s.error ? `${s.error.code}: ${s.error.message}` : 'dừng';
  if (s.status === 'queued') return 'đang chờ worker';
  if (s.status === 'stale') return 'kết quả cũ: bước trước đã chạy lại';
  return s.status === 'idle' ? '' : `lần ${s.attempt_no}${s.cached ? ` · ${s.cached} lời gọi lấy từ đã lưu` : ''}`;
}

function readUrl() {
  if (typeof window === 'undefined') return {} as Record<string, string>;
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

/** "Lượt chạy" (spec P0.13): stop banner, six numbers, nine steps with live sub-steps. Old runs open read-only. */
export default function RunScreen() {
  const { sessionId, state, refresh, toast } = useSession();
  const init = useRef(readUrl());
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [runId, setRunId] = useState<string | null>(init.current.run ?? null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [log, setLog] = useState<LogRows>([]);
  const [logAll, setLogAll] = useState(false);
  const [block, setBlock] = useState<BlockId | null>((init.current.block as BlockId) ?? null);
  const [tab, setTab] = useState<StepTab>((init.current.tab as StepTab) ?? 'sub');
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Bumped after an action so polling restarts at once (and at the faster pace once the run moves). */
  const [kick, setKick] = useState(0);

  const loadRuns = useCallback(async () => {
    const r = await api<RunRow[]>(`/sessions/${sessionId}/runs`);
    setRuns(r);
    setRunId((cur) => cur ?? r[0]?.id ?? null);
  }, [sessionId]);
  useEffect(() => {
    void loadRuns().catch((e) => setErr(e.message));
  }, [loadRuns]);

  const load = useCallback(async () => {
    if (!runId) return;
    const [o, u, l] = await Promise.all([api<Overview>(`/runs/${runId}/overview`), api<Usage>(`/runs/${runId}/usage`), api<LogRows>(`/runs/${runId}/log?filter=${logAll ? 'all' : 'stops'}`)]);
    setOv(o);
    setUsage(u);
    setLog(l);
    setErr(null);
    return o.poll_ms;
  }, [runId, logAll]);
  // poll every 2 s while the run moves, every 30 s otherwise (plan P0 · G)
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      let next = 30000;
      try {
        next = (await load()) ?? 30000;
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
      if (alive) t = setTimeout(tick, next);
    };
    void tick();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [load, kick]);

  // keep the address in sync so a step or an old run can be linked to
  useEffect(() => {
    const q = new URLSearchParams();
    if (runId && runs && runId !== runs[0]?.id) q.set('run', runId);
    if (block) (q.set('block', block), q.set('tab', tab));
    const s = q.toString();
    window.history.replaceState(null, '', window.location.pathname + (s ? '?' + s : ''));
  }, [runId, runs, block, tab]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      await Promise.all([loadRuns(), refresh()]);
      setKick((k) => k + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onAction = (a: StopAction) => {
    if (!ov) return;
    const id = ov.run.id;
    if (a === 'OPEN_STEP') return setBlock(ov.stop?.block && ov.stop.block !== 'FAST' ? ov.stop.block : 'B0');
    if (a === 'RESUME' || a === 'RETRY') return void act(() => api(`/runs/${id}/resume`, { method: 'POST', json: {} }), 'Đã chạy tiếp. Phần đã xong được dùng lại từ kết quả đã lưu.');
    if (a === 'SCHEDULE') return void act(() => api(`/runs/${id}/schedule`, { method: 'POST', json: {} }), 'Đã hẹn giờ chạy tiếp.');
    if (a === 'ACCEPT_OVER') {
      if (!window.confirm(`Chạy tiếp ${ov.stop?.block ?? ''} và chấp nhận vượt ngưỡng?\n\n${ov.stop?.message ?? ''}\n\nViệc này có thể tốn nhiều token và được ghi lại kèm tên người xác nhận.`)) return;
      return void act(() => api(`/runs/${id}/resume`, { method: 'POST', json: { accept_over: true } }), 'Đã ghi xác nhận vượt ngưỡng và chạy tiếp.');
    }
  };

  if (runs && !runs.length)
    return (
      <div className="lv-card" style={{ marginTop: 0 }}>
        <h3 style={{ marginTop: 0 }}>Phiên chưa có lượt chạy</h3>
        <p className="lv-muted">Thêm JD và tạo lượt ở màn Đầu vào. Màn tạo lượt có ước tính số lời gọi và token trước khi chạy.</p>
        <Link className="lv-btn pri" href={`/s/${sessionId}/inputs`}>
          Tới Đầu vào
        </Link>
      </div>
    );
  if (!ov) return <div className="lv-empty">{err ? `Lỗi: ${err}` : 'Đang tải lượt…'}</div>;

  const m = ov.metrics;
  const readOnly = ov.run.read_only;
  const next = ov.steps.find((s) => s.status !== 'done');
  const canRun = !readOnly && !ov.auto.on && !ov.running && !!next && ov.stop?.code !== 'DONE' && !(ov.stop && ['QUOTA', 'BUDGET', 'ANOMALY', 'AI_ERROR', 'GATE'].includes(ov.stop.code));
  const stopped = ov.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
  return (
    <div id="run-screen" data-run={ov.run.run_no}>
      {ov.stop ? <StopBanner stop={ov.stop} sessionId={sessionId} readOnly={readOnly} busy={busy} onAction={onAction} /> : null}
      {!ov.stop && ov.breaker ? (
        <div className="lv-banner warn" role="status">
          <span className="ic">!</span>
          <div>
            <div className="t">Cầu dao AI đang ngắt ({ov.breaker.code})</div>
            <div className="small">
              {ov.breaker.message} Mở lại lúc {hhmm(ov.breaker.until)}. Không bước nào gọi AI được tới lúc đó.
            </div>
          </div>
        </div>
      ) : null}
      {readOnly ? (
        <div className="lv-banner run" role="status">
          <span className="ic">◷</span>
          <div>
            <div className="t">Lượt {ov.run.run_no} · chỉ đọc</div>
            <div className="small">{ov.run.current ? 'Lượt đã công bố.' : 'Đây là lượt cũ. Mọi bước và mọi lần chạy vẫn mở xem được; không chạy tiếp được.'}</div>
          </div>
          {!ov.run.current && runs?.[0] ? (
            <div className="acts">
              <button className="lv-btn" onClick={() => (setRunId(runs[0].id), setBlock(null))}>
                Về lượt hiện tại
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="lv-head">
        <div>
          <h2>
            Lượt {ov.run.run_no} · {state?.roleTitle ?? ''}
          </h2>
          <div className="muted">
            {ov.run.jd_count} JD · từ điển nền {ov.run.base_version_label} · tạo {dayTime(ov.run.created_at)}
            {ov.budget ? ` · trần ${tokens(ov.budget.run_tokens)} token (1,5 × ước tính)` : ''}
          </div>
        </div>
        <span className="lv-sp" />
        {runs && runs.length > 1 ? (
          <select aria-label="Chọn lượt" value={ov.run.id} onChange={(e) => (setRunId(e.target.value), setBlock(null))}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                Lượt {r.run_no}
                {r.id === runs[0].id ? ' (hiện tại)' : ''}
              </option>
            ))}
          </select>
        ) : null}
        <button className="lv-btn ghost" onClick={() => setHistory((h) => !h)} aria-expanded={history}>
          Lịch sử lượt
        </button>
        {ov.stop && !['DONE', 'PAUSED'].includes(ov.stop.code) ? null : ov.auto.on ? (
          <button className="lv-btn" id="run-pause" disabled={busy || readOnly} onClick={() => void act(() => api(`/runs/${ov.run.id}/pause`, { method: 'POST', json: {} }), 'Đã tạm dừng. Bước đang chạy sẽ chạy nốt.')}>
            ⏸ Tạm dừng
          </button>
        ) : (
          <button className="lv-btn pri" id="run-start" disabled={busy || !canRun || state?.aiReady?.ok === false} title={state?.aiReady?.ok === false ? state.aiReady.message : 'Chạy liên tục tới B8; dừng ở hồ sơ dự kiến để bạn duyệt'} onClick={() => void act(() => api(`/sessions/${sessionId}/auto`, { method: 'POST', json: { on: true } }), 'Đang chạy.')}>
            ▶ Chạy{next && next.block !== 'B0' ? ` từ ${next.block}` : ''}
          </button>
        )}
      </div>

      {history && runs ? (
        <div className="lv-card" style={{ marginTop: 0, marginBottom: 14 }}>
          <h4>Lịch sử lượt</h4>
          <RunHistory
            runs={runs}
            current={ov.run.id}
            onOpen={(id) => {
              setRunId(id);
              setBlock(null);
              setHistory(false);
            }}
          />
        </div>
      ) : null}

      <div className="lv-kpis" data-testid="kpis">
        <div>
          <b>
            {m.steps_done} / {m.steps_total}
          </b>
          <span>bước đã xong</span>
        </div>
        <div>
          <b>{dur(m.elapsed_ms)}</b>
          <span>thời gian chạy</span>
        </div>
        <button onClick={() => (setBlock(stopped?.block ?? ov.steps.find((s) => s.calls)?.block ?? 'B1'), setTab('calls'))}>
          <b>{num(m.calls)}</b>
          <span>
            lời gọi AI{m.failed ? ` · ${num(m.failed)} lỗi` : ''}
            {m.cached ? ` · ${num(m.cached)} đã lưu` : ''}
          </span>
        </button>
        <div title={`ghi đệm ${num(m.split.cache_write)} · đọc đệm ${num(m.split.cache_read)} · thường ${num(m.split.input)} · ra ${num(m.split.output)}`}>
          <b>{tokens(m.tokens)}</b>
          <span>token</span>
        </div>
        <button onClick={() => (setBlock(stopped?.block ?? ov.steps.find((s) => s.calls)?.block ?? 'B1'), setTab('calls'))}>
          <b>{usd(m.cost_usd)}</b>
          <span>quy đổi giá API</span>
        </button>
        <div title={m.quota.note}>
          <b style={{ color: m.quota.pct >= 80 ? 'var(--orange)' : undefined }}>≈ {m.quota.pct.toLocaleString('vi-VN')}%</b>
          <span>hạn mức 5 giờ (ước lượng)</span>
        </div>
      </div>

      <div className="lv-steps" role="table" aria-label="Các bước của lượt">
        <div className="lv-st head" role="row">
          <span />
          <span>BƯỚC</span>
          <span className="c-gate">CỔNG</span>
          <span className="r">THỜI GIAN</span>
          <span className="r c-calls">LỜI GỌI</span>
          <span className="r">CHI PHÍ</span>
        </div>
        {ov.steps.map((s) => {
          const [cls, ic] = ICON[s.status];
          const idle = s.status === 'idle';
          return (
            <div key={s.block} role="row" className={'lv-st' + (block === s.block ? ' sel' : '')} data-step={s.block} data-status={s.status} onClick={() => setBlock(s.block)}>
              <span className={'lv-ic ' + cls}>{ic}</span>
              <span className={'nm' + (idle ? ' faint' : '')}>
                <b>
                  {s.block} · {s.name}
                </b>
                <small>{subtitle(s)}</small>
                {s.crosscheck ? <small className="lv-xcheck" data-testid={`xcheck-${s.block}`}>Kiểm chéo: {s.crosscheck}</small> : null}
              </span>
              <span className="c-gate">{gateText(s)}</span>
              <span className={'r' + (idle ? ' faint' : '')}>{dur(s.duration_ms)}</span>
              <span className={'r c-calls' + (idle ? ' faint' : '')}>{s.calls || s.cached ? num(s.calls) + (s.estimate && s.status === 'running' ? ` / ${num(s.estimate.calls)}` : '') : '—'}</span>
              <span className={'r' + (idle ? ' faint' : '')}>{s.cost_usd ? usd(s.cost_usd) : '—'}</span>
              {(s.status === 'running' || s.status === 'failed') && s.substeps.length ? (
                <div className="lv-subs" data-testid={`substeps-${s.block}`}>
                  {s.substeps.map((x) => (
                    <div className="lv-subrow" key={x.task_id}>
                      <span>
                        {x.title} <span className="lv-muted">· AI {x.model}</span>
                      </span>
                      <div className={'lv-prog' + (x.failed ? ' bad' : x.done === x.total ? ' ok' : '')}>
                        <i style={{ width: `${x.total ? (100 * (x.done + x.failed)) / x.total : 0}%` }} />
                      </div>
                      <span className="r">
                        {x.done} / {x.total}
                        {x.cached ? ` · ${x.cached} đã lưu` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {block ? <StepDetail runId={ov.run.id} steps={ov.steps} block={block} tab={tab} usage={usage} onBlock={setBlock} onTab={setTab} onClose={() => setBlock(null)} /> : null}

      <div className="lv-card">
        <div className="lv-row" style={{ marginBottom: 6 }}>
          <h4 style={{ margin: 0 }}>Nhật ký lượt · {logAll ? 'tất cả' : 'dừng và lỗi'}</h4>
          <span className="lv-sp" />
          <button className="lv-btn ghost" onClick={() => setLogAll((x) => !x)}>
            {logAll ? 'Chỉ dừng và lỗi' : 'Xem tất cả'}
          </button>
        </div>
        {log.length ? (
          <div className="lv-scroll">
            <table className="lv-table" data-testid="run-log">
              <thead>
                <tr>
                  <th>Giờ</th>
                  <th>Sự kiện</th>
                  <th>Bước</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 60).map((e) => (
                  <tr key={e.seq}>
                    <td className="lv-mono">{hhmmss(e.time)}</td>
                    <td>
                      <span className={'lv-chip ' + (/STOP|BLOCKED|JOB_RESULT/.test(e.type) ? 'bad' : e.type === 'RUN_WARNING' || e.type === 'OVER_ACCEPTED' ? 'warn' : e.type === 'BLOCK_DONE' ? 'ok' : 'run')}>{e.type}</span>
                    </td>
                    <td>{e.block ?? '—'}</td>
                    <td>{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="lv-empty">{logAll ? 'Chưa có sự kiện.' : 'Chưa có lần dừng hay lỗi nào.'}</div>
        )}
      </div>
    </div>
  );
}
