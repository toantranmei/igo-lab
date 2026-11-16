'use client';
import { useEffect, useMemo, useState } from 'react';
import type { BlockId, GateResult, Lesson } from '@cl/contract';
import { useSession } from '@/lib/session';
import '@/components/knowledge/knowledge.css';

const LESSON_GROUPS: [Lesson['status'], string][] = [
  ['PENDING', 'Đang chờ'],
  ['SAFE', 'An toàn'],
  ['APPLIED', 'Đã áp dụng'],
  ['REJECTED', 'Bị loại'],
];
const GATE_LABEL: Record<GateResult['status'], string> = {
  PASS: '✓ PASS',
  FAIL: '× FAIL',
  NOT_EVALUATED: '○ NOT_EVALUATED',
  NOT_APPLICABLE: '– NOT_APPLICABLE',
};
const GATE_HINT: Record<GateResult['status'], string> = {
  PASS: 'Đạt',
  FAIL: 'Không đạt',
  NOT_EVALUATED: 'Chưa đánh giá',
  NOT_APPLICABLE: 'Không áp dụng',
};

function show(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

interface GateRows {
  id: BlockId;
  name: string;
  gates: GateResult[];
  error?: string;
}

export default function AuditScreen() {
  const { state, source, refresh, toast } = useSession();
  const [run, setRun] = useState<string>('');
  const [block, setBlock] = useState<string>('');
  const [gateRows, setGateRows] = useState<GateRows[] | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);

  // Reload gate results whenever a block changes state.
  const cardSig = state ? state.cards.map((c) => `${c.id}:${c.state}:${c.receipt}`).join('|') + `#${state.runNo}` : '';
  useEffect(() => {
    if (!state) return;
    let on = true;
    const active = state.cards.filter((c) => c.state !== 'idle');
    if (!active.length) {
      setGateRows([]);
      return;
    }
    Promise.all(
      active.map(async (c): Promise<GateRows> => {
        try {
          const d = await source.getDetail(c.id);
          return { id: c.id, name: c.name, gates: d.gates ?? [], error: d.error?.message };
        } catch (e) {
          return { id: c.id, name: c.name, gates: [], error: e instanceof Error ? e.message : String(e) };
        }
      }),
    ).then((rows) => on && setGateRows(rows));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardSig, source]);

  const logs = state?.logs ?? [];
  const runs = useMemo(() => [...new Set(logs.map((l) => l.run))].sort((a, b) => a - b), [logs]);
  const steps = useMemo(() => [...new Set(logs.map((l) => l.step))].filter(Boolean).sort(), [logs]);

  if (!state) return null;
  const isExample = source.mode === 'example';
  const runFilter = run === '' ? (runs.includes(state.runNo) ? state.runNo : null) : run === 'all' ? null : Number(run);
  const shown = logs.filter((l) => (runFilter == null || l.run === runFilter) && (!block || l.step === block)).slice().reverse();

  const audit = state.audit;
  const lessons = state.lessons;
  const hasPending = lessons.some((l) => l.status === 'PENDING');
  const canApprove = !!source.approveLessons && hasPending && !busy;

  const approve = async () => {
    if (!source.approveLessons) return;
    const r = reason.trim();
    if (!r) {
      setReasonError('Cần nhập lý do trước khi xác nhận An toàn.');
      document.getElementById('safe-reason')?.focus();
      return;
    }
    setReasonError('');
    setBusy(true);
    try {
      await source.approveLessons(r);
      setReason('');
      toast(isExample ? 'Đã ghi quyết định An toàn giả lập ngoài B0–B8.' : 'Đã ghi quyết định An toàn cho các lesson đang chờ.');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const nextRun = async () => {
    if (!source.startNextRun) return;
    setBusy(true);
    try {
      await source.startNextRun();
      toast(`Đã mở lượt ${String(state.runNo + 1).padStart(2, '0')}: giữ từ điển đã phát hành và nạp các lesson An toàn.`);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const nextLabel = `Bắt đầu lượt ${String(state.runNo + 1).padStart(2, '0')} →`;

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Audit và bài học</h2>
          <p>Audit biến lỗi thành kiểm soát. AU đọc log và đầu ra; không tự sửa rồi tự duyệt. Người quyết định An toàn nằm ngoài các block B.</p>
        </div>
        <span className="pill">{state.runLabel}</span>
      </div>

      {state.halted && (
        <div className="halt" id="stop-status" role="alert">
          <b>⛔ STOP — dây chuyền đang dừng.</b>
          {state.haltReasons.length ? (
            <ul className="au-list">
              {state.haltReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <div className="dim">Chưa ghi lý do dừng.</div>
          )}
          <div className="dim" style={{ marginTop: 8 }}>
            Luồng sửa lỗi vẫn được phép. Mở lại trong Dây chuyền sản xuất sau khi sự cố được xử lý.
          </div>
        </div>
      )}
      {!state.halted && (
        <p className="muted-box" id="stop-status">
          <span className="status-dot" />
          STOP: không kích hoạt · {state.statusText}
        </p>
      )}

      {/* AU report */}
      <div id="audit-content">
        {audit ? (
          <div className="record">
            <b>AU · {audit.findings.length} finding có căn cứ</b>
            <div className="label">PHẠM VI</div>
            <p>{audit.scope}</p>
            {audit.checks.length > 0 && (
              <>
                <div className="label">CÁC KIỂM TRA ĐÃ LÀM</div>
                <ul className="au-list">
                  {audit.checks.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="label">PHÁT HIỆN</div>
            {audit.findings.length ? (
              audit.findings.map((f) => (
                <div key={f.id} className="record" data-finding={f.id}>
                  <span className="pill au-sev">{f.severity}</span> <span className="pill">{f.type}</span> <code>{f.id}</code>
                  <p>{f.text}</p>
                  {(f.expected || f.observed) && (
                    <div className="before-after">
                      <div>
                        <div className="label">KỲ VỌNG</div>
                        <p>{f.expected || '—'}</p>
                      </div>
                      <div>
                        <div className="label">QUAN SÁT ĐƯỢC</div>
                        <p>{f.observed || '—'}</p>
                      </div>
                    </div>
                  )}
                  <div className="label">CĂN CỨ</div>
                  {f.evidence.length ? <code>{f.evidence.join(' → ')}</code> : <span className="dim">Không ghi căn cứ.</span>}
                  {f.lesson && (
                    <p>
                      Lesson liên quan: <a href={`#lesson-${f.lesson}`}>{f.lesson}</a>
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p>AU không ghi nhận phát hiện nào trong phạm vi đã kiểm.</p>
            )}
            <div className="label">GIỚI HẠN</div>
            {audit.limitations.length ? (
              <ul className="au-list">
                {audit.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : (
              <p>Không ghi giới hạn.</p>
            )}
            {audit.conclusions && audit.conclusions.length > 0 && (
              <>
                <div className="label">KẾT LUẬN</div>
                <ul className="au-list">
                  {audit.conclusions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className="empty">AU kiểm toán khi bản ứng viên hoàn tất tại B8.</div>
        )}
      </div>

      {/* Gates */}
      <div className="section-head" style={{ marginTop: 34 }}>
        <div>
          <h2>Kết quả cổng theo block</h2>
          <p>Giá trị thực tế so với tiêu chí của từng cổng. “Chưa đánh giá” và “Không áp dụng” không được tính là đạt.</p>
        </div>
      </div>
      <div id="audit-gates">
        {gateRows === null ? (
          <p className="dim">Đang tải kết quả cổng…</p>
        ) : gateRows.length === 0 ? (
          <div className="empty">Chưa có block nào chạy trong lượt này.</div>
        ) : (
          <div className="table-wrap scroll-x">
            <table className="au-gates">
              <thead>
                <tr>
                  <th>BLOCK</th>
                  <th>CỔNG</th>
                  <th>THỰC TẾ</th>
                  <th>TIÊU CHÍ</th>
                  <th>TRẠNG THÁI</th>
                  <th>LÝ DO</th>
                </tr>
              </thead>
              <tbody>
                {gateRows.flatMap((r) =>
                  r.gates.length
                    ? r.gates.map((g, i) => (
                        <tr key={r.id + ':' + g.gate_id + ':' + i} data-gate={g.gate_id}>
                          <td>{i === 0 ? r.id : ''}</td>
                          <td>
                            {g.name}
                            <small>
                              {g.gate_id}
                              {g.required ? '' : ' · không bắt buộc'}
                            </small>
                          </td>
                          <td>{show(g.actual)}</td>
                          <td>{g.criterion}</td>
                          <td>
                            <span className={`au-gate ${g.status}`} title={GATE_HINT[g.status]}>
                              {GATE_LABEL[g.status]}
                            </span>
                            <small>{GATE_HINT[g.status]}</small>
                          </td>
                          <td>{g.reason || (g.status === 'NOT_APPLICABLE' || g.status === 'NOT_EVALUATED' ? <span className="src-bad">Thiếu lý do</span> : '—')}</td>
                        </tr>
                      ))
                    : [
                        <tr key={r.id + ':none'}>
                          <td>{r.id}</td>
                          <td colSpan={5} className="dim">
                            {r.error ? `Không đọc được kết quả cổng: ${r.error}` : 'Block chưa có kết quả cổng.'}
                          </td>
                        </tr>,
                      ],
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lessons */}
      <div className="section-head" style={{ marginTop: 34 }}>
        <h2>Lesson cho vòng tiếp theo</h2>
      </div>
      <div id="lessons">
        {lessons.length ? (
          LESSON_GROUPS.map(([status, label]) => {
            const items = lessons.filter((l) => l.status === status);
            if (!items.length) return null;
            return (
              <section key={status} className="au-group" data-lesson-status={status}>
                <h3>
                  {label} <span className="pill">{items.length}</span>
                </h3>
                {items.map((l) => (
                  <div key={l.id} id={`lesson-${l.id}`} className={`record lesson ${l.status}${l.status === 'SAFE' || l.status === 'APPLIED' ? ' safe' : ''}`}>
                    <span className="pill">{label.toUpperCase()}</span>
                    <h3 style={{ margin: '10px 0 6px' }}>
                      {l.id} · {l.text}
                    </h3>
                    <p>
                      Phụ trách: {l.owner || '—'}
                      <br />
                      Kiểm soát: {l.control || 'chưa ghi'}
                      <br />
                      Test: {l.test || 'chưa ghi'}
                    </p>
                    {l.testResult && Object.keys(l.testResult).length > 0 ? (
                      <div className="chips">
                        {Object.entries(l.testResult).map(([k, ok]) => (
                          <span key={k} className="chip">
                            <span className={ok ? 'src-ok' : 'src-bad'}>{ok ? '✓' : '×'}</span> {k}: {ok ? 'đạt' : 'không đạt'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p>Kết quả test: chưa chạy.</p>
                    )}
                  </div>
                ))}
              </section>
            );
          })
        ) : (
          <div className="empty">Chưa có lesson. {isExample ? 'Chạy hết lượt 1 để AU tạo phát hiện.' : 'Lesson được tạo khi AU ghi nhận phát hiện ở B8.'}</div>
        )}
      </div>

      {source.approveLessons && (
        <label className="au-reason" htmlFor="safe-reason">
          Lý do xác nhận An toàn (bắt buộc)
          <input
            id="safe-reason"
            type="text"
            value={reason}
            disabled={!hasPending || busy}
            aria-invalid={!!reasonError}
            aria-describedby={reasonError ? 'safe-reason-error' : undefined}
            placeholder={hasPending ? 'Ví dụ: đã xem test của lesson, không ảnh hưởng block khác' : 'Không có lesson đang chờ'}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError('');
            }}
          />
          {reasonError && (
            <span id="safe-reason-error" className="src-bad" role="alert">
              {reasonError}
            </span>
          )}
        </label>
      )}
      <div className="actions">
        <button type="button" id="safe" disabled={!canApprove} onClick={approve}>
          Xác nhận lesson An toàn{isExample ? ' (giả lập người duyệt)' : ''}
        </button>
        {source.startNextRun && (
          <button type="button" id="round2" className="primary" disabled={!state.canStartNextRun || busy} onClick={nextRun}>
            {nextLabel}
          </button>
        )}
      </div>
      {state.nextRunHint && (
        <p className="au-hint" id="round2-hint">
          {state.nextRunHint}
        </p>
      )}

      {/* Event log */}
      <div className="event-section">
        <div className="section-head">
          <h2>Nhật ký theo lượt</h2>
          <span id="log-count" className="dim">
            {shown.length}/{logs.length} sự kiện
          </span>
        </div>
        <div className="au-filters">
          <label>
            Lượt
            <select id="log-run" value={runFilter == null ? 'all' : String(runFilter)} onChange={(e) => setRun(e.target.value)}>
              <option value="all">Tất cả</option>
              {runs.map((r) => (
                <option key={r} value={r}>
                  Lượt {String(r).padStart(2, '0')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Block
            <select id="log-block" value={block} onChange={(e) => setBlock(e.target.value)}>
              <option value="">Tất cả</option>
              {steps.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        {logs.length === 0 ? (
          <div className="empty">Chạy B0 để bắt đầu lưu dấu vết.</div>
        ) : shown.length === 0 ? (
          <div className="empty">Không có sự kiện nào khớp bộ lọc.</div>
        ) : (
          <div id="logs" className="au-logs" tabIndex={0} role="group" aria-label="Nhật ký sự kiện">
            {shown.map((l) => (
              <div key={`${l.run}:${l.seq}`} className="log au-log">
                <span>#{String(l.seq).padStart(3, '0')}</span>
                <span className="dim">L{l.run}</span>
                <span className={`tag${['HALT', 'BLOCK', 'STOP', 'ERROR', 'FAIL'].includes(l.type) ? ' warn' : ''}`}>{l.type}</span>
                <div>
                  <b style={{ fontWeight: 500 }}>{l.step}</b> · {l.summary}
                  <div className="dim" style={{ fontSize: 10 }}>
                    {l.time}
                  </div>
                  {l.payload != null && (
                    <details>
                      <summary>Dữ liệu sự kiện</summary>
                      <pre>{JSON.stringify(l.payload, null, 2)}</pre>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isExample && (
        <div className="sources">
          <h3>Cơ sở phương pháp</h3>
          <p>Ngưỡng của mô phỏng là giả định thiết kế, hiển thị trong từng block; chưa phải ngưỡng được kiểm định cho IGO.</p>
          <a href="https://aclanthology.org/2022.naacl-main.366/" target="_blank" rel="noopener">
            SkillSpan · trích xuất có bộ đối chiếu
          </a>
          <a href="https://aclanthology.org/2023.emnlp-main.398/" target="_blank" rel="noopener">
            ALCE · nguồn có thực sự hỗ trợ phát biểu?
          </a>
          <a href="https://www.w3.org/TR/prov-o/" target="_blank" rel="noopener">
            W3C PROV · truy vết dữ liệu và hoạt động
          </a>
          <a href="https://www.ncsc.gov.uk/blog-post/prompt-injection-is-not-sql-injection" target="_blank" rel="noopener">
            NCSC · kiểm soát quyền ngoài LLM
          </a>
        </div>
      )}
    </>
  );
}
