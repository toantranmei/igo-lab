'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAIN_BLOCK_IDS, type BlockDetail, type BlockId } from '@cl/contract';
import { api } from '@/lib/live-source';
import { showValue } from '@/components/guide/DataView';
import ComputeTab from '@/components/line/ComputeTab';
import DataFlow from './DataFlow';
import { REASON_TEXT, STATUS_TEXT, dur, hhmm, hhmmss, num, statusChip, tokens, usd, type Attempts, type CalcRows, type Calls, type OverviewStepT, type Tech, type TraceRows, type Usage } from './format';

export type StepTab = 'flow' | 'sub' | 'viz' | 'calls' | 'att' | 'tech';
const TABS: [StepTab, string][] = [
  ['flow', 'Diễn biến dữ liệu ▶'],
  ['sub', 'Bước con'],
  ['viz', 'Kết quả và biểu đồ'],
  ['calls', 'Lời gọi AI'],
  ['att', 'Các lần chạy'],
  ['tech', 'Kỹ thuật'],
];

/** Polls `fn` every `ms` while `on`; returns the latest value. */
function usePoll<T>(key: string | null, fn: () => Promise<T>, ms: number | null): [T | null, string | null] {
  const [v, setV] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setV(null);
    setErr(null);
    const load = () =>
      fnRef
        .current()
        .then((x) => alive && (setV(x), setErr(null)))
        .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    void load();
    const t = ms ? setInterval(load, ms) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [key, ms]);
  return [v, err];
}

function SubSteps({ attemptId, running, step }: { attemptId: string; running: boolean; step: OverviewStepT }) {
  // beats are appended while the block runs: fetch only what is new
  const [beats, setBeats] = useState<TraceRows['beats']>([]);
  const next = useRef(-1);
  useEffect(() => {
    let alive = true;
    next.current = -1;
    setBeats([]);
    const load = async () => {
      const r = await api<TraceRows>(`/attempts/${attemptId}/trace?since=${next.current}`).catch(() => null);
      if (!alive || !r) return;
      if (r.beats.length) {
        next.current = r.next;
        setBeats((b) => [...b, ...r.beats]);
      }
    };
    void load();
    const t = running ? setInterval(load, 2000) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [attemptId, running]);
  const [calc] = usePoll<CalcRows>(attemptId, () => api(`/attempts/${attemptId}/calc`), running ? 4000 : null);
  const [sub, setSub] = useState<string>('');
  const rows = (calc?.rows ?? []).filter((r) => !sub || r.substep === sub);
  return (
    <div className="lv-g3" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
      <div>
        {step.substeps.length ? (
          <div className="lv-card" style={{ marginTop: 0 }}>
            <h4>Lời gọi AI theo bước con</h4>
            {step.substeps.map((s) => (
              <div className="lv-subrow" key={s.task_id}>
                <span>
                  {s.title} <span className="lv-muted">· {s.model}</span>
                </span>
                <div className={'lv-prog' + (s.failed ? ' bad' : s.done === s.total ? ' ok' : '')}>
                  <i style={{ width: `${s.total ? (100 * (s.done + s.failed)) / s.total : 0}%` }} />
                </div>
                <span className="r lv-muted" style={{ textAlign: 'right' }}>
                  {s.done}/{s.total}
                  {s.failed ? ` · ${s.failed} lỗi` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="lv-tl" data-testid="beats" style={{ marginTop: 12 }}>
          {beats.length ? null : <div className="lv-empty">{running ? 'Đang chờ nhịp đầu tiên của bước…' : 'Bước chưa ghi nhịp nào.'}</div>}
          {beats.map((b) => (
            <div key={b.seq} className={'lv-beat ' + b.kind}>
              <div className="k">
                {hhmmss(b.at)} · {b.kind}
                {b.source !== 'CODE' ? ` · AI ${typeof b.source === 'object' ? b.source.task_id : ''}` : ' · code'}
              </div>
              <div>{b.title}</div>
              {b.explanation ? <div className="lv-muted" style={{ fontSize: 12 }}>{b.explanation}</div> : null}
              {b.formula ? <div className="f">{b.formula}</div> : null}
              {b.substitution ? <div className="s">{b.substitution}</div> : null}
              {b.gate ? <div className={b.gate.status === 'PASS' ? 'cl-ok' : 'cl-warn'}>{b.gate.status}</div> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="lv-card" style={{ marginTop: 0 }}>
        <h4>Bản ghi phép tính</h4>
        {calc?.substeps.length ? (
          <div className="lv-row" style={{ marginBottom: 8 }}>
            <select aria-label="Bước con" value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="">Mọi phép tính ({calc.rows.length})</option>
              {calc.substeps.map((x) => (
                <option key={x.substep} value={x.substep}>
                  {x.substep} ({x.n})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {!rows.length ? <div className="lv-empty">Chưa có phép tính nào được ghi cho bước này.</div> : null}
        <div className="lv-scroll" style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table className="lv-table" data-testid="calc-table">
            <tbody>
              {rows.slice(0, 400).map((r) => (
                <tr key={r.seq}>
                  <td>
                    <div className="lv-mono">{r.item_ref ?? '—'}</div>
                    <div className="lv-muted" style={{ fontSize: 11 }}>
                      {r.substep}
                      {r.seat ? ` · ${r.seat}` : ''}
                    </div>
                  </td>
                  <td>
                    <div className="lv-mono" style={{ color: 'var(--accent)' }}>{r.formula}</div>
                    <div className="lv-mono">vào {JSON.stringify(r.inputs)}</div>
                    {r.output != null ? <div className="lv-mono">ra {JSON.stringify(r.output)}</div> : null}
                    {r.decision ? <div>→ {r.decision}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CallsTab({ attemptId, usage, block }: { attemptId: string; usage: Usage | null; block: BlockId }) {
  const [task, setTask] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<'cost' | 'time' | 'tokens'>('cost');
  const q = new URLSearchParams({ ...(task ? { task } : {}), ...(status ? { status } : {}), sort }).toString();
  const [calls, err] = usePoll<Calls>(`${attemptId}?${q}`, () => api(`/attempts/${attemptId}/calls?${q}`), null);
  const [pick, setPick] = useState<string | null>(null);
  const b = usage?.blocks.find((x) => x.block === block);
  const tot = b ? b.input + b.cache_write + b.cache_read : 0;
  const maxCost = Math.max(0.0001, ...(usage?.tasks ?? []).map((x) => x.cost_usd));
  const csv = () => {
    const head = ['gio', 'tac_vu', 'trang_thai', 'so_lan', 'input', 'ghi_dem', 'doc_dem', 'ra', 'giay', 'usd', 'loi'];
    const lines = (calls?.rows ?? []).map((r) => [r.started_at, r.task_id, r.status, r.count, r.input, r.cache_write, r.cache_read, r.output, ((r.duration_ms ?? 0) / 1000).toFixed(1), r.cost_usd.toFixed(4), JSON.stringify(r.error ?? '')].join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `loi-goi-${block}-${attemptId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const sel = calls?.rows.find((r) => r.id === pick);
  return (
    <>
      <div className="lv-g3">
        <div className="lv-card" style={{ marginTop: 0 }}>
          <h4>Token đầu vào · bước này</h4>
          {b && tot ? (
            <>
              <div className="lv-costbar" data-testid="token-split">
                <i style={{ flex: b.cache_write, background: '#e9b77b' }} />
                <i style={{ flex: b.cache_read, background: '#72d9b1' }} />
                <i style={{ flex: b.input, background: '#9cafff' }} />
              </div>
              <div style={{ fontSize: 12 }}>
                <div>
                  <span className="lv-sw" style={{ background: '#e9b77b' }} />
                  Ghi bộ đệm {num(b.cache_write)} (giá ×2 với bộ đệm 1 giờ)
                </div>
                <div>
                  <span className="lv-sw" style={{ background: '#72d9b1' }} />
                  Đọc bộ đệm {num(b.cache_read)} (giá ×0,1)
                </div>
                <div>
                  <span className="lv-sw" style={{ background: '#9cafff' }} />
                  Thường {num(b.input)} · ra {num(b.output)}
                </div>
              </div>
            </>
          ) : (
            <div className="lv-empty">Bước này chưa có lời gọi AI mới.</div>
          )}
        </div>
        <div className="lv-card" style={{ marginTop: 0 }}>
          <h4>Tiền theo tác vụ, cả lượt</h4>
          {(usage?.tasks ?? []).slice(0, 6).map((x) => (
            <div className="lv-hbar" key={x.block + x.task_id}>
              <span>
                {x.block} · {x.task_id}
              </span>
              <div className="tr">
                <i style={{ width: `${(100 * x.cost_usd) / maxCost}%` }} />
              </div>
              <span className="v">{usd(x.cost_usd)}</span>
            </div>
          ))}
          {usage && !usage.tasks.length ? <div className="lv-empty">Chưa có lời gọi.</div> : null}
        </div>
        <div className="lv-card" style={{ marginTop: 0 }}>
          <h4>Trạng thái · bước này</h4>
          <table className="lv-table">
            <tbody>
              {(calls?.tasks ?? []).map((x) => (
                <tr key={x.task_id}>
                  <td>{x.task_id}</td>
                  <td className="n">
                    <span className="lv-chip ok">{x.calls - x.failed} xong</span>
                  </td>
                  <td className="n">{x.failed ? <span className="lv-chip bad">{x.failed} lỗi</span> : null}</td>
                  <td className="n">
                    <span className="lv-chip mute">{x.cached} đã lưu</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="lv-row" style={{ marginBottom: 8 }}>
        <select aria-label="Tác vụ" value={task} onChange={(e) => setTask(e.target.value)}>
          <option value="">Mọi tác vụ</option>
          {(calls?.tasks ?? []).map((x) => (
            <option key={x.task_id}>{x.task_id}</option>
          ))}
        </select>
        <select aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Sắp xếp" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="cost">Sắp theo chi phí</option>
          <option value="tokens">Sắp theo token</option>
          <option value="time">Sắp theo giờ</option>
        </select>
        <span className="lv-sp" />
        <button className="lv-btn ghost" onClick={csv} disabled={!calls?.rows.length}>
          Xuất CSV
        </button>
      </div>
      {err ? <div className="cl-err">{err}</div> : null}
      <div className="lv-scroll">
        <table className="lv-table" data-testid="calls-table">
          <thead>
            <tr>
              <th>Giờ</th>
              <th>Tác vụ</th>
              <th className="n">Ghi đệm</th>
              <th className="n">Đọc đệm</th>
              <th className="n">Thường</th>
              <th className="n">Ra</th>
              <th className="n">Giây</th>
              <th className="n">USD</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {(calls?.rows ?? []).map((r) => (
              <tr key={r.id} className={'click' + (pick === r.id ? ' selr' : '')} onClick={() => setPick(r.id)}>
                <td className="lv-mono">{hhmmss(r.started_at)}</td>
                <td>
                  {r.task_id}
                  {r.count > 1 ? <b> · {r.count} lời gọi gộp</b> : null}
                </td>
                <td className="n">{num(r.cache_write)}</td>
                <td className="n">{num(r.cache_read)}</td>
                <td className="n">{num(r.input)}</td>
                <td className="n">{num(r.output)}</td>
                <td className="n">{r.duration_ms == null ? '—' : (r.duration_ms / 1000).toFixed(1)}</td>
                <td className="n">{r.cost_usd ? r.cost_usd.toFixed(3) : '—'}</td>
                <td>
                  <span className={'lv-chip ' + statusChip(r.status)}>{STATUS_TEXT[r.status] ?? r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {calls && !calls.rows.length ? <div className="lv-empty">Không có lời gọi nào khớp bộ lọc.</div> : null}
      {sel ? (
        <div className="lv-card">
          <h4>Lời gọi {sel.id}</h4>
          <div className="lv-mono lv-muted">
            {sel.model} · {sel.effort} · task_key {sel.task_key.slice(0, 16)}…
          </div>
          {sel.error ? <div className="lv-pre" style={{ marginTop: 8 }}>{sel.error}</div> : <div className="lv-muted" style={{ marginTop: 8, fontSize: 12 }}>Đầu vào và đầu ra của lời gọi nằm trong kết quả đã lưu theo task_key; tab Kỹ thuật có dữ liệu thô của cả bước.</div>}
        </div>
      ) : null}
    </>
  );
}

function AttemptsTab({ runId, block, current, onPick }: { runId: string; block: BlockId; current: string | null; onPick: (id: string) => void }) {
  const [rows] = usePoll<Attempts>(`${runId}/${block}`, () => api(`/runs/${runId}/blocks/${block}/attempts`), null);
  if (!rows) return <div className="lv-empty">Đang tải…</div>;
  if (!rows.length) return <div className="lv-empty">Bước này chưa chạy lần nào trong lượt.</div>;
  return (
    <div className="lv-scroll">
      <table className="lv-table" data-testid="attempts-table">
        <thead>
          <tr>
            <th>Lần</th>
            <th>Bắt đầu</th>
            <th>Kết thúc</th>
            <th className="n">Thời gian</th>
            <th className="n">Lời gọi</th>
            <th className="n">Đã lưu</th>
            <th className="n">USD</th>
            <th>Kết quả</th>
            <th>Lý do chạy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={'click' + (a.id === current ? ' selr' : '')} onClick={() => onPick(a.id)}>
              <td>
                {a.attempt_no}
                {a.current ? ' · hiện tại' : ''}
              </td>
              <td className="lv-mono">{hhmm(a.started_at)}</td>
              <td className="lv-mono">{hhmm(a.finished_at)}</td>
              <td className="n">{dur(a.duration_ms)}</td>
              <td className="n">{num(a.calls)}</td>
              <td className="n">{num(a.cached)}</td>
              <td className="n">{a.cost_usd ? a.cost_usd.toFixed(2) : '—'}</td>
              <td>
                <span className={'lv-chip ' + (a.status === 'DONE' ? 'ok' : a.status === 'FAILED' ? 'bad' : a.status === 'RUNNING' || a.status === 'QUEUED' ? 'run' : 'warn')}>{a.status === 'DONE' ? 'xong' : a.status === 'FAILED' ? `dừng · ${a.error?.code ?? ''}` : a.status === 'STALE' ? 'cũ' : a.status.toLowerCase()}</span>
              </td>
              <td>
                {REASON_TEXT[a.reason] ?? a.reason}
                {a.accept_over ? ` · chấp nhận vượt (${a.accept_over.by})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TechTab({ attemptId }: { attemptId: string }) {
  const [tech, err] = usePoll<Tech>(attemptId, () => api(`/attempts/${attemptId}/tech`), null);
  if (err) return <div className="cl-err">{err}</div>;
  if (!tech) return <div className="lv-empty">Đang tải…</div>;
  return (
    <table className="lv-table">
      <tbody>
        <tr>
          <td>Mã lần chạy</td>
          <td className="lv-mono">
            {tech.attempt_id} · {tech.block} lần {tech.attempt_no}
          </td>
        </tr>
        <tr>
          <td>Tác vụ AI</td>
          <td className="lv-mono">{(tech.tasks as any[]).map((x) => `${x.task_id} (${x.model}, ${x.effort}) ×${x.calls}${x.cached ? `, ${x.cached} đã lưu` : ''}`).join(' · ') || 'chỉ code'}</td>
        </tr>
        <tr>
          <td>Mã băm đầu vào / đầu ra</td>
          <td className="lv-mono">
            in {tech.input_hash?.slice(0, 12) ?? '—'} · out {tech.output_hash?.slice(0, 12) ?? '—'}
          </td>
        </tr>
        <tr>
          <td>Phiên bản</td>
          <td className="lv-mono">{Object.entries(tech.versions).map(([k, v]) => `${k} ${v ?? '—'}`).join(' · ')}</td>
        </tr>
        <tr>
          <td>Tùy chọn</td>
          <td className="lv-mono">{JSON.stringify(tech.options)}</td>
        </tr>
        {tech.error ? (
          <tr>
            <td>Lỗi</td>
            <td className="lv-pre">{JSON.stringify(tech.error, null, 2)}</td>
          </tr>
        ) : null}
        <tr>
          <td>Dữ liệu thô</td>
          <td>
            <div className="lv-pre">{showValue(tech.raw)}</div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** P2.5: the selected set of B5 and the indicators by level of B6, from the attempt's own output. */
function ResultTables({ detail }: { detail: BlockDetail }) {
  const raw = (detail.raw ?? {}) as any;
  const name = (id: string) => detail.rows.find((r) => r.id === id || r.id.startsWith(id))?.name ?? id;
  if (detail.id === 'B5' && Array.isArray(raw.scores))
    return (
      <div className="lv-card" style={{ marginTop: 0 }}>
        <h4>Tập năng lực và ba ghế chấm</h4>
        <div className="lv-scroll">
          <table className="lv-table" data-testid="b5-set">
            <thead>
              <tr>
                <th>Năng lực</th>
                <th>Phiếu quan trọng</th>
                <th className="n">x̄</th>
                <th className="n">s²</th>
                <th className="n">r_wg</th>
                <th className="n">x̄ phân biệt</th>
                <th className="n">S(c)</th>
                <th className="n">Bậc</th>
                <th>Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {(raw.scores as any[]).map((x) => (
                <tr key={x.competency_id} className={x.core ? 'selr' : ''}>
                  <td>{name(x.competency_id)}</td>
                  <td className="lv-mono">{x.votes.map((v: any) => v.importance ?? '—').join(', ')}</td>
                  <td className="n">{x.mean_importance}</td>
                  <td className="n">{x.variance}</td>
                  <td className="n">{x.rwg}</td>
                  <td className="n">{x.mean_discrimination}</td>
                  <td className="n">{x.S}</td>
                  <td className="n">{x.level ?? '—'}</td>
                  <td>
                    <span className={'lv-chip ' + (x.core ? 'ok' : x.keep ? 'mute' : 'bad')}>{x.core ? 'lõi' : x.keep ? 'giữ, ngoài lõi' : 'loại'}</span>
                    {x.reasons?.length ? <span className="lv-muted" style={{ fontSize: 11 }}> {x.reasons.join('; ')}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  if (detail.id === 'B6' && Array.isArray(raw.indicators)) {
    const comps = [...new Set((raw.indicators as any[]).map((x) => x.competency_id))];
    return (
      <div className="lv-card" style={{ marginTop: 0 }}>
        <h4>Chỉ báo theo bậc · Fleiss κ lớp {raw.fleiss?.kappa ?? '—'}</h4>
        <div className="lv-scroll">
          <table className="lv-table" data-testid="b6-levels">
            <thead>
              <tr>
                <th>Năng lực</th>
                <th>Lớp</th>
                <th>Bậc 1</th>
                <th>Bậc 3</th>
                <th>Bậc 5</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((c) => (
                <tr key={c}>
                  <td>{detail.rows.find((r) => r.id.startsWith(`${c}#`))?.detail?.split(' · ')[0] ?? c}</td>
                  <td>{raw.classes?.[c] || '—'}</td>
                  {['1', '3', '5'].map((L) => (
                    <td key={L}>
                      {(raw.indicators as any[]).filter((x) => x.competency_id === c && x.level === L).map((x) => (
                        <div key={x.key} style={{ fontSize: 12, marginBottom: 4 }}>
                          {x.statement} <span className="lv-muted">· {x.correct}/{x.non_abstain}{x.round > 1 ? ' · viết lại' : ''}</span>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return null;
}

function VizTab({ attemptId }: { attemptId: string }) {
  const [detail, err] = usePoll<BlockDetail>(attemptId, () => api(`/attempts/${attemptId}/detail`), null);
  const [eq, setEq] = useState(0);
  const [rec, setRec] = useState<string | undefined>();
  const [omit, setOmit] = useState<string[]>([]);
  if (err) return <div className="cl-err">{err}</div>;
  if (!detail) return <div className="lv-empty">Đang tải…</div>;
  if (detail.state === 'running') return <div className="lv-empty">Bước đang chạy; kết quả hiện khi xong. Xem tab Bước con để theo dõi.</div>;
  if (detail.state === 'error') return <div className="cl-warn">Lần chạy này dừng trước khi có kết quả: {detail.error?.code} · {detail.error?.message}</div>;
  return (
    <div className="prod-workbench" style={{ border: 0, padding: 0, background: 'none' }}>
      <div className="lv-g3">
        {[...detail.input.map(([k, v]) => ['Vào · ' + k, v]), ...detail.output.map(([k, v]) => ['Ra · ' + k, v])].map(([k, v]) => (
          <div key={k} className="lv-card" style={{ marginTop: 0, padding: '9px 12px' }}>
            <div className="lv-muted" style={{ fontSize: 11 }}>{k}</div>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <ResultTables detail={detail} />
      <ComputeTab detail={detail} live equation={eq} onEquation={setEq} recordId={rec} onRecord={setRec} omitted={omit} onToggleOmitted={(c) => setOmit((o) => (o.includes(c) ? o.filter((x) => x !== c) : [...o, c]))} />
      {detail.gates.length ? (
        <div className="lv-card">
          <h4>Cổng</h4>
          <table className="lv-table">
            <tbody>
              {detail.gates.map((g) => (
                <tr key={g.gate_id}>
                  <td className="lv-mono">{g.gate_id}</td>
                  <td>{g.name}</td>
                  <td>{g.criterion}</td>
                  <td>{typeof g.actual === 'string' ? g.actual : JSON.stringify(g.actual)}</td>
                  <td>
                    <span className={'lv-chip ' + (g.status === 'PASS' && !g.deviation ? 'ok' : g.status === 'PASS' ? 'warn' : g.status === 'FAIL' ? 'bad' : 'mute')} title={g.deviation ? `${g.deviation.reason} Rủi ro: ${g.deviation.risk}` : g.reason}>
                      {g.status === 'PASS' ? (g.deviation ? 'đạt · phiếu sai lệch' : 'đạt') : g.status === 'NOT_APPLICABLE' ? 'không áp dụng' : g.status === 'FAIL' ? 'chưa đạt' : 'chưa đánh giá'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {detail.notes.length ? <ul className="lv-muted" style={{ fontSize: 12 }}>{detail.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </div>
  );
}

/** "Chi tiết một bước": pick a step (B0–B8), then one of five tabs. Old attempts open from "Các lần chạy". */
export default function StepDetail({ runId, steps, block, tab, usage, onBlock, onTab, onClose }: { runId: string; steps: OverviewStepT[]; block: BlockId; tab: StepTab; usage: Usage | null; onBlock: (b: BlockId) => void; onTab: (t: StepTab) => void; onClose: () => void }) {
  const step = steps.find((s) => s.block === block)!;
  const [attemptId, setAttemptId] = useState<string | null>(step.attempt_id);
  useEffect(() => setAttemptId(step.attempt_id), [step.attempt_id, block]);
  const running = step.status === 'running' || step.status === 'queued';
  const viewingCurrent = attemptId === step.attempt_id;
  const chips = useMemo(() => step.gates.map((g) => ({ k: g.gate_id, cls: g.status === 'PASS' && !g.deviation ? 'ok' : g.status === 'PASS' ? 'warn' : g.blocking ? 'bad' : 'mute', t: `${g.name}: ${g.status === 'PASS' ? (g.deviation ? 'đạt bằng phiếu sai lệch' : 'đạt') : g.status === 'NOT_APPLICABLE' ? 'không áp dụng' : g.status === 'FAIL' ? 'chưa đạt' : 'chưa đánh giá'}` })), [step.gates]);
  return (
    <div className="lv-card" id="step-detail" data-block={block}>
      <div className="lv-row" style={{ marginBottom: 10 }}>
        <button className="lv-btn ghost" onClick={onClose}>
          ← Đóng
        </button>
        <div className="lv-bsel" role="tablist" aria-label="Chọn bước">
          {MAIN_BLOCK_IDS.map((b) => (
            <button key={b} className={b === block ? 'on' : ''} onClick={() => onBlock(b)}>
              {b}
            </button>
          ))}
        </div>
      </div>
      <div className="lv-row">
        <h3 style={{ margin: 0 }}>
          {block} · {step.name}
        </h3>
        {chips.map((c) => (
          <span key={c.k} className={'lv-chip ' + c.cls}>
            {c.t}
          </span>
        ))}
        {!viewingCurrent && attemptId ? (
          <span className="lv-chip warn">
            đang xem lần chạy cũ ·{' '}
            <button className="lv-btn ghost" style={{ padding: '0 6px' }} onClick={() => setAttemptId(step.attempt_id)}>
              về lần hiện tại
            </button>
          </span>
        ) : null}
      </div>
      <div className="lv-muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
        {step.started_at ? `Bắt đầu ${hhmmss(step.started_at)}` : 'Chưa chạy'}
        {step.finished_at ? ` · xong ${hhmmss(step.finished_at)}` : ''}
        {step.duration_ms != null ? ` · ${dur(step.duration_ms)}` : ''} · {num(step.calls)} lời gọi mới, {num(step.cached)} lấy từ đã lưu · {tokens(step.tokens)} token · {usd(step.cost_usd)}
        {step.estimate ? ` · ước tính ${num(step.estimate.calls)} lời gọi, ${tokens(step.estimate.tokens)} token` : ''}
        {step.budget_tokens ? ` · trần ${tokens(step.budget_tokens)} token` : ''}
      </div>
      {step.error && viewingCurrent ? <div className="cl-warn" style={{ marginBottom: 8 }}>{step.error.code}: {step.error.message}</div> : null}
      <div className="lv-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} data-tab={k} onClick={() => onTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {!attemptId ? (
        tab === 'att' ? (
          <AttemptsTab runId={runId} block={block} current={attemptId} onPick={setAttemptId} />
        ) : (
          <div className="lv-empty">Bước chưa chạy trong lượt này. Mở bước không tạo job và không gọi AI.</div>
        )
      ) : tab === 'flow' ? (
        <DataFlow attemptId={attemptId} />
      ) : tab === 'sub' ? (
        <SubSteps attemptId={attemptId} running={running && viewingCurrent} step={step} />
      ) : tab === 'viz' ? (
        <VizTab attemptId={attemptId} />
      ) : tab === 'calls' ? (
        <CallsTab attemptId={attemptId} usage={usage} block={block} />
      ) : tab === 'att' ? (
        <AttemptsTab runId={runId} block={block} current={attemptId} onPick={(id) => (setAttemptId(id), onTab('sub'))} />
      ) : (
        <TechTab attemptId={attemptId} />
      )}
    </div>
  );
}
