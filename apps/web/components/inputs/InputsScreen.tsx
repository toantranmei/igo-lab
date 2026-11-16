'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { InputDoc, InputEvent, InputTask } from '@cl/contract';
import { downloadJson, useSession } from '@/lib/session';
import '@/components/knowledge/knowledge.css';

type Picked = { kind: 'jd'; item: InputDoc } | { kind: 'task'; item: InputTask } | { kind: 'event'; item: InputEvent };

const CLASS_LABEL: Record<string, string> = { HYPOTHESIS: 'GIẢ THUYẾT', SEED: 'SEED', REAL: 'THỰC' };

function classOfDoc(j: InputDoc): string {
  const c = (j.evidenceClass || '').toUpperCase();
  if (c in CLASS_LABEL) return c;
  if (c.includes('SYNTHETIC') || c.includes('SEED')) return 'SEED';
  if (c.includes('HYPOTH')) return 'HYPOTHESIS';
  if (c.includes('REAL')) return 'REAL';
  return j.synthetic ? 'SEED' : c ? 'OTHER' : 'REAL';
}

function EvidenceBadge({ cls, raw }: { cls: string; raw?: string }) {
  const known = cls in CLASS_LABEL;
  return (
    <span className={`ev-badge ${known ? cls : 'OTHER'}`} title={raw ? `Lớp bằng chứng: ${raw}` : undefined}>
      {known ? CLASS_LABEL[cls] : raw || cls}
    </span>
  );
}

function SourceStatus({ ok }: { ok: boolean }) {
  return ok ? <span className="src-ok">Nguồn truy được</span> : <span className="src-bad">⚠ Thiếu nguồn</span>;
}

function findPicked(id: string, jds: InputDoc[], tasks: InputTask[], events: InputEvent[]): Picked | null {
  // `document_id@version` and segment refs (`id@v#n`) resolve to their document.
  const base = id.split('#')[0];
  const bare = base.split('@')[0];
  const jd = jds.find((j) => j.id === id) ?? jds.find((j) => j.id === base) ?? jds.find((j) => j.id === bare || j.id.split('@')[0] === bare);
  if (jd) return { kind: 'jd', item: jd };
  const ev = events.find((e) => e.id === id) ?? events.find((e) => e.id === bare);
  if (ev) return { kind: 'event', item: ev };
  const task = tasks.find((t) => t.id === id);
  if (task) return { kind: 'task', item: task };
  return null;
}

export default function InputsScreen() {
  const { state, source, toast } = useSession();
  const params = useSearchParams();
  const wanted = params.get('doc');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const appliedDoc = useRef<string | null>(null);

  const jds = state?.inputs.jds ?? [];
  const tasks = state?.inputs.tasks ?? [];
  const events = state?.inputs.events ?? [];
  const ready = !!state;

  // Honour ?doc=<id> once the data is there (also when the link changes).
  useEffect(() => {
    if (!ready || !wanted || appliedDoc.current === wanted) return;
    appliedDoc.current = wanted;
    setPickedId(wanted);
    detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [ready, wanted]);

  if (!state) return null;
  const isExample = source.mode === 'example';
  const picked = pickedId ? findPicked(pickedId, jds, tasks, events) : null;
  const missing = pickedId && !picked ? pickedId : null;
  const selectedId = picked?.item.id ?? null;
  const realCount = events.filter((e) => e.evidenceClass === 'REAL').length + jds.filter((j) => classOfDoc(j) === 'REAL').length;
  const empty = !jds.length && !tasks.length && !events.length;

  const open = (id: string) => {
    setPickedId(id);
    if (typeof window !== 'undefined' && window.innerWidth < 1150) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const exportSeed = () => {
    const ex = source as unknown as { exportSeed?(): unknown };
    try {
      downloadJson(`product-owner-seed-${state.runNo}.json`, ex.exportSeed ? ex.exportSeed() : state.inputs);
      toast('Đã xuất seed của lượt ' + state.runNo + '.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Dữ liệu đầu vào</h2>
          <p>
            {isExample
              ? 'Dữ liệu seed có nguồn gốc rõ ràng. Mỗi địa chỉ seed:// chỉ trỏ đến bản ghi giả lập trong ứng dụng.'
              : 'Bộ JD, nhiệm vụ và sự kiện đã khóa cho lượt này. Mỗi bản ghi giữ nguồn, phiên bản và lớp bằng chứng.'}
            {state.inputs.label ? ` · ${state.inputs.label}` : ''}
          </p>
        </div>
        {isExample && (
          <button type="button" id="export-seed" onClick={exportSeed}>
            ↓ Xuất seed
          </button>
        )}
      </div>

      <div className="stats" id="data-stats">
        <div className="stat">
          <b>{jds.length}</b>
          <span>JD có bản ghi</span>
        </div>
        <div className="stat">
          <b>{events.length}</b>
          <span>{isExample ? 'Sự kiện tổng hợp' : 'Sự kiện'}</span>
        </div>
        <div className="stat">
          <b>{tasks.length}</b>
          <span>Nhiệm vụ trọng yếu</span>
        </div>
        <div className="stat">
          <b>{realCount}</b>
          <span>Bằng chứng thực tế đã thu</span>
        </div>
      </div>

      {empty ? (
        <div className="empty">
          Phiên này chưa có dữ liệu đầu vào.
          <br />
          {isExample ? 'Bấm “Bắt đầu lại” để nạp lại seed.' : 'Thêm JD ở phần phía trên và xác nhận bộ JD; nhiệm vụ và sự kiện xuất hiện sau khi B2 và B4 chạy.'}
        </div>
      ) : (
        <div className="in-layout">
          <div>
            <section className="in-list" aria-labelledby="in-jds">
              <h3 id="in-jds">JD · Yêu cầu công việc ({jds.length})</h3>
              <div id="jds">
                {jds.length ? (
                  jds.map((j) => (
                    <button key={j.id} type="button" className={`record in-record${selectedId === j.id ? ' kg-selected' : ''}`} data-doc={j.id} aria-pressed={selectedId === j.id} onClick={() => open(j.id)}>
                      <b>
                        {j.id} · {j.title || j.industry || 'JD'}
                      </b>
                      <EvidenceBadge cls={classOfDoc(j)} raw={j.evidenceClass} />
                      <span className="in-line">
                        {[j.industry, j.role, j.version != null ? `phiên bản ${j.version}` : null].filter(Boolean).join(' · ') || '—'}
                      </span>
                      <span className="in-line">
                        <code>{j.source || 'không có nguồn'}</code> · <SourceStatus ok={j.sourceOk} />
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty">Chưa có JD nào trong bộ dữ liệu của lượt này.</div>
                )}
              </div>
            </section>

            <section className="in-list" aria-labelledby="in-tasks">
              <h3 id="in-tasks">Nhiệm vụ ({tasks.length})</h3>
              <div id="tasks">
                {tasks.length ? (
                  tasks.map((t) => (
                    <button key={t.id} type="button" className={`record in-record${selectedId === t.id ? ' kg-selected' : ''}`} data-doc={t.id} aria-pressed={selectedId === t.id} onClick={() => open(t.id)}>
                      <b>
                        {t.id} · {t.name}
                      </b>
                      <span className="in-line">
                        Trọng số: {t.weight ?? 'chưa xác định'} · Nguồn: {t.refs.length ? t.refs.join(', ') : 'chưa ghi'}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty">Chưa có nhiệm vụ. {isExample ? '' : 'Nhiệm vụ được neo ở B2.'}</div>
                )}
              </div>
            </section>

            <section className="in-list" aria-labelledby="in-events">
              <h3 id="in-events">
                Sự kiện{isExample ? ' · Synthetic cases' : ''} ({events.length})
              </h3>
              <div id="events">
                {events.length ? (
                  events.map((e) => (
                    <button key={e.id} type="button" className={`record in-record${selectedId === e.id ? ' kg-selected' : ''}`} data-doc={e.id} aria-pressed={selectedId === e.id} onClick={() => open(e.id)}>
                      <b>
                        {e.id} · {e.label}
                      </b>
                      <EvidenceBadge cls={e.evidenceClass} />
                      <span className="in-line">{e.type}</span>
                      <span className="in-line">
                        <code>{e.source || 'không có nguồn'}</code>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty">Chưa có sự kiện. {isExample ? '' : 'Sự kiện được thu ở B4.'}</div>
                )}
              </div>
            </section>
          </div>

          <div className="in-detail" id="input-detail" ref={detailRef} aria-live="polite">
            {missing && (
              <p className="src-bad">
                Không tìm thấy bản ghi “{missing}” trong dữ liệu đầu vào của lượt đang xem. Bản ghi có thể thuộc lượt khác hoặc bộ mẫu.
              </p>
            )}
            {!picked && !missing && (
              <div className="graph-detail-empty">
                ↖ Chọn một bản ghi
                <div>Xem toàn văn, đoạn được dùng ở các bước sau, tình trạng nguồn và lớp bằng chứng.</div>
              </div>
            )}
            {picked?.kind === 'jd' && <DocDetail j={picked.item} />}
            {picked?.kind === 'task' && <TaskDetail t={picked.item} canOpen={(id) => !!findPicked(id, jds, [], events)} open={open} />}
            {picked?.kind === 'event' && <EventDetail e={picked.item} />}
          </div>
        </div>
      )}
    </>
  );
}

function DocDetail({ j }: { j: InputDoc }) {
  return (
    <>
      <span className="eyebrow">JD · BẢN GHI ĐẦU VÀO</span>
      <h3>
        {j.id} · {j.title || j.industry || 'JD'}
        <EvidenceBadge cls={classOfDoc(j)} raw={j.evidenceClass} />
      </h3>
      <dl className="in-meta">
        <dt>Nguồn</dt>
        <dd>
          <code>{j.source || '—'}</code>
        </dd>
        <dt>Tình trạng nguồn</dt>
        <dd>
          <SourceStatus ok={j.sourceOk} />
        </dd>
        <dt>Loại dữ liệu</dt>
        <dd>{j.synthetic ? 'Tổng hợp (synthetic) — không phải tài liệu thật' : 'Tài liệu thật do người dùng cung cấp'}</dd>
        <dt>Lớp bằng chứng</dt>
        <dd>{j.evidenceClass || '—'}</dd>
        {j.version != null && (
          <>
            <dt>Phiên bản</dt>
            <dd>{j.version}</dd>
          </>
        )}
        {j.origin && (
          <>
            <dt>Nguồn gốc</dt>
            <dd>{j.origin}</dd>
          </>
        )}
        {j.industry && (
          <>
            <dt>Ngành</dt>
            <dd>{j.industry}</dd>
          </>
        )}
        {j.role && (
          <>
            <dt>Vai trò</dt>
            <dd>{j.role}</dd>
          </>
        )}
        {j.meta.map(([k, v], i) => (
          <MetaRow key={k + i} k={k} v={v} />
        ))}
      </dl>
      <div className="label">TOÀN VĂN</div>
      <pre className="in-text" tabIndex={0}>
        {j.text || '(Bản ghi không có nội dung văn bản)'}
      </pre>
      <div className="label">ĐOẠN ĐƯỢC DÙNG Ở CÁC BƯỚC SAU ({j.usedPassages.length})</div>
      {j.usedPassages.length ? (
        j.usedPassages.map((p, i) => (
          <div key={i} className="in-passage">
            <span>{p.label}</span>
            <q>{p.text}</q>
          </div>
        ))
      ) : (
        <p className="dim">Chưa có đoạn nào được trích dùng. Các đoạn xuất hiện sau khi B3 mã hóa.</p>
      )}
    </>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function TaskDetail({ t, canOpen, open }: { t: InputTask; canOpen(id: string): boolean; open(id: string): void }) {
  return (
    <>
      <span className="eyebrow">NHIỆM VỤ</span>
      <h3>
        {t.id} · {t.name}
      </h3>
      <dl className="in-meta">
        <dt>Trọng số</dt>
        <dd>{t.weight ?? 'chưa xác định'}</dd>
      </dl>
      <div className="label">NGUỒN THAM CHIẾU ({t.refs.length})</div>
      {t.refs.length ? (
        <div className="chips">
          {t.refs.map((r) =>
            canOpen(r) ? (
              <button key={r} type="button" className="chip" onClick={() => open(r)}>
                {r} →
              </button>
            ) : (
              <span key={r} className="chip">
                {r}
              </span>
            ),
          )}
        </div>
      ) : (
        <p className="dim">Nhiệm vụ này chưa ghi nguồn tham chiếu.</p>
      )}
    </>
  );
}

function EventDetail({ e }: { e: InputEvent }) {
  return (
    <>
      <span className="eyebrow">SỰ KIỆN · {e.type}</span>
      <h3>
        {e.id} · {e.label}
        <EvidenceBadge cls={e.evidenceClass} />
      </h3>
      {e.evidenceClass === 'HYPOTHESIS' && <p className="kg-trial">GIẢ THUYẾT — sự kiện do AI đặt ra để kiểm, chưa phải bằng chứng quan sát được. Không dùng thay cho bằng chứng thực.</p>}
      <dl className="in-meta">
        <dt>Nguồn</dt>
        <dd>
          <code>{e.source || '—'}</code>
        </dd>
        <dt>Lớp bằng chứng</dt>
        <dd>
          {CLASS_LABEL[e.evidenceClass] ?? e.evidenceClass} ({e.evidenceClass})
        </dd>
      </dl>
      <div className="label">TÌNH HUỐNG</div>
      <p>{e.situation || <span className="dim">Không ghi</span>}</p>
      <div className="label">HÀNH ĐỘNG</div>
      <p>{e.action || <span className="dim">Không ghi</span>}</p>
      <div className="label">KẾT QUẢ</div>
      <p>{e.outcome || <span className="dim">Không ghi</span>}</p>
      <div className="label">RATING</div>
      <p>{e.ratings?.length ? e.ratings.join(' · ') : <span className="dim">Chưa có rating</span>}</p>
      <div className="label">CĂN CỨ CHẤM RATING</div>
      <p>{e.ratingBasis || <span className="dim">Không ghi căn cứ</span>}</p>
    </>
  );
}
