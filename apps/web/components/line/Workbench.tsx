'use client';
import { useState } from 'react';
import { gateBlocks, type BlockCard, type BlockDetail, type BlockId, type DetailState, type GateResult, type SessionState } from '@cl/contract';
import { useGuide } from '@/lib/guide-api';
import { useSession } from '@/lib/session';
import { showValue } from '@/components/guide/DataView';
import BlockProgressView from './BlockProgress';
import ComputeTab from './ComputeTab';

type InspectMode = 'compute' | 'accept' | 'raw';
const MODES: [InspectMode, string][] = [
  ['compute', 'Phép tính & dữ liệu'],
  ['accept', 'Nghiệm thu & bàn giao'],
  ['raw', 'Bản ghi đầy đủ'],
];

const STATE_PILL: Record<DetailState, [string, string]> = {
  actual_pass: ['actual', 'KẾT QUẢ LƯỢT HIỆN TẠI · ĐẠT'],
  actual_blocked: ['halted', 'KẾT QUẢ LƯỢT HIỆN TẠI · CHẶN'],
  trial: ['actual', 'BẢN THỬ ĐÃ TẠO'],
  preview: ['preview', 'XEM TRƯỚC BẰNG SEED · CHƯA GHI VÀO LƯỢT CHẠY'],
  not_run: ['preview', 'CHƯA CHẠY · CHƯA CÓ KẾT QUẢ'],
  running: ['preview', 'ĐANG TÍNH…'],
  error: ['halted', 'LỖI · CHƯA CÓ KẾT QUẢ'],
};

const isActual = (s: DetailState) => s === 'actual_pass' || s === 'actual_blocked' || s === 'trial';

function PairList({ rows }: { rows: [string, string][] }) {
  return (
    <>
      {rows.map(([a, b], i) => (
        <div className="prod-pair" key={i}>
          <span>{a}</span>
          <b>{b}</b>
        </div>
      ))}
    </>
  );
}

function gateChip(g: GateResult): { cls: string; icon: string; note: string } {
  switch (g.status) {
    case 'PASS':
      return { cls: 'pass', icon: '✓', note: `${showValue(g.actual)} / ${g.criterion}` };
    case 'FAIL':
      return { cls: 'fail', icon: '⊘', note: `${showValue(g.actual)} / ${g.criterion}${g.reason ? ' · ' + g.reason : ''}` };
    case 'NOT_EVALUATED':
      return { cls: gateBlocks(g) ? 'fail' : 'pending', icon: '○', note: `chưa đánh giá · yêu cầu: ${g.criterion}` };
    default:
      return { cls: gateBlocks(g) ? 'fail' : 'na', icon: '–', note: `không áp dụng · ${g.reason ?? 'thiếu lý do'}` };
  }
}

function AcceptTab({ detail, id }: { detail: BlockDetail; id: BlockId }) {
  const actual = isActual(detail.state);
  const required = detail.gates.filter((g) => g.required);
  const ok = !detail.gates.some(gateBlocks);
  return (
    <div className="prod-accept">
      <div className="prod-section-label">TỪNG ĐIỀU KIỆN BẮT BUỘC · {actual ? 'KẾT QUẢ ĐÃ GHI' : 'KẾT QUẢ TÍNH TRƯỚC'}</div>
      {detail.gates.length ? (
        detail.gates.map((g) => {
          const v = gateChip(g);
          const blocks = gateBlocks(g);
          return (
            <div key={g.gate_id} className={'prod-rule ' + (v.cls === 'pass' ? 'pass' : blocks || g.status === 'FAIL' ? 'fail' : 'neutral')} data-gate-status={g.status}>
              <b>{v.icon}</b>
              <div>
                <strong>{g.name}</strong>
                <small>
                  {g.status === 'PASS'
                    ? 'Thỏa điều kiện'
                    : g.status === 'FAIL'
                      ? g.required
                        ? 'Không thỏa → khóa bàn giao'
                        : 'Không thỏa · không bắt buộc'
                      : g.status === 'NOT_EVALUATED'
                        ? 'chưa đánh giá' + (blocks ? ' → khóa bàn giao' : '')
                        : 'không áp dụng · ' + (g.reason ?? 'thiếu lý do → khóa bàn giao')}
                </small>
              </div>
              <div>
                <small>THỰC TẾ</small>
                <strong>{g.status === 'NOT_EVALUATED' || g.status === 'NOT_APPLICABLE' ? '—' : showValue(g.actual)}</strong>
              </div>
              <div>
                <small>YÊU CẦU</small>
                <strong>{g.criterion}</strong>
              </div>
            </div>
          );
        })
      ) : (
        <p>Block này chưa có điều kiện nghiệm thu được ghi.</p>
      )}
      <p>
        {id === 'FAST'
          ? 'Bản thử không thay thế các cổng B4–B8.'
          : required.length
            ? `G_${id.slice(1)} = ${required.map((g) => (gateBlocks(g) ? 0 : 1)).join(' ∧ ')} = ${ok ? '1 · đạt' : '0 · chặn'}.`
            : ''}{' '}
        {actual ? 'Kết quả này có trong log lượt đang chạy.' : 'Kết quả này chưa có trong log lượt đang chạy.'}
      </p>
    </div>
  );
}

interface Props {
  id: BlockId;
  card: BlockCard | undefined;
  detail: BlockDetail | null;
  detailError: string | null;
  state: SessionState;
  onSelect: (id: BlockId) => void;
}

export default function Workbench({ id, card, detail, detailError, state, onSelect }: Props) {
  const guide = useGuide();
  const { source, refresh, toast } = useSession();
  const live = source.mode === 'live';
  const [mode, setMode] = useState<InspectMode>('compute');
  const [equations, setEquations] = useState<Record<string, number>>({});
  const [records, setRecords] = useState<Record<string, string>>({});
  const [omitted, setOmitted] = useState<Record<string, string[]>>({});
  const [retrying, setRetrying] = useState(false);

  const i = id === 'FAST' ? -1 : Number(id.slice(1));
  const prev: BlockId = id === 'FAST' ? 'B3' : (`B${Math.max(0, i - 1)}` as BlockId);
  const next: BlockId = id === 'FAST' ? 'B4' : i < 8 ? (`B${i + 1}` as BlockId) : 'B0';
  const scenarioKey = String(state.runNo);
  const omittedNow = omitted[scenarioKey] ?? [];

  // The button always names the block it will really run (the reference mislabelled it).
  const pending = state.pending;
  const aiBlocked = live && state.aiReady?.ok === false;
  let run: { label: string; disabled: boolean; go: () => void };
  if (pending) run = { label: `◎ Tiếp tục ${pending.id}`, disabled: false, go: () => guide.reopenPending() };
  else if (id === 'FAST' && (state.fast.available || state.fast.done)) run = { label: 'Chạy nhánh giao thử', disabled: !state.fast.available || state.fast.done || state.halted || aiBlocked, go: () => void guide.startFast() };
  else if (state.completed || state.position > 8) run = { label: 'Lượt đã hoàn tất', disabled: true, go: () => undefined };
  else run = { label: `Chạy từng bước từ B${state.position}`, disabled: state.halted || aiBlocked, go: () => void guide.startNext() };

  const retry = async () => {
    setRetrying(true);
    try {
      await source.begin(id);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  };

  const pill = detail ? STATE_PILL[detail.state] : (['preview', 'ĐANG TẢI…'] as [string, string]);
  const blockedElsewhere = !!detail?.blockedAt && detail.blockedAt !== id;
  const hasBody = !!detail && !blockedElsewhere;
  const blocked = !!detail && (detail.state === 'actual_blocked' || detail.state === 'error' || (isActual(detail.state) && detail.gates.some(gateBlocks)));
  const target = detail?.handoffTarget?.replace(/^\s*→\s*/, '') ?? '';

  return (
    <section className="prod-workbench" aria-label={`Chi tiết block ${id}`} data-block={id} data-state={detail?.state}>
      <div className="prod-workhead">
        <div>
          <div className="eyebrow">
            MỞ BLOCK / {id} · {detail?.agent ?? card?.agent ?? ''}
          </div>
          <h2>{detail?.name ?? card?.name ?? id}</h2>
          <p>{detail ? (blockedElsewhere ? 'Block chưa được phép xử lý do cổng trước bị chặn.' : detail.method) : (detailError ?? 'Đang tải chi tiết block…')}</p>
        </div>
        <div>
          <span className={'prod-state ' + pill[0]}>{pill[1]}</span>
          <button type="button" id="prod-run" className="primary" disabled={run.disabled} onClick={run.go}>
            {run.label}
          </button>
        </div>
      </div>

      {detail?.state === 'preview' ? (
        <div className="prod-preview-note">
          Bảng dưới là kết quả tính thử trên bản sao của seed {state.runLabel.toLowerCase()}. Không thay đổi lõi, log, lesson hay tiến độ của bạn. Mỗi lần chạy chỉ thực hiện một block và mở phần diễn giải. Bạn xác nhận “Đã hiểu” trước khi sang block kế tiếp.
        </div>
      ) : detail?.state === 'not_run' && !blockedElsewhere ? (
        <div className="prod-preview-note">Block này chưa chạy trong lượt hiện tại. Mở card chỉ hiện mô tả, không tạo job và không gọi model. Bấm “{run.label}” để chạy.</div>
      ) : detail?.state === 'running' ? (
        <div className="prod-preview-note" role="status">
          Máy chủ đang xử lý block này; kết quả sẽ hiện khi job hoàn tất. Mỗi dòng dưới đây là một bước AI của block: số lời gọi đã xong trên tổng số đã phát.
          {state.cards.find((c) => c.id === id)?.progress ? <BlockProgressView progress={state.cards.find((c) => c.id === id)!.progress!} /> : null}
        </div>
      ) : null}

      {detail?.error ? (
        <div className="prod-error" role="alert">
          <b>Block {id} gặp lỗi.</b>
          <div className="prod-pair">
            <span>Mã lỗi</span>
            <b>
              <code>{detail.error.code}</code>
            </b>
          </div>
          <div className="prod-pair">
            <span>Thông báo</span>
            <b>{detail.error.message}</b>
          </div>
          {detail.error.attempt_id ? (
            <div className="prod-pair">
              <span>Lần thử</span>
              <b>
                <code>{detail.error.attempt_id}</code>
              </b>
            </div>
          ) : null}
          <button type="button" id="prod-retry" disabled={retrying} onClick={() => void retry()}>
            {retrying ? 'Đang gửi lại…' : 'Thử lại'}
          </button>
        </div>
      ) : null}

      {detail && hasBody ? (
        <>
          <div className="prod-io">
            <article>
              <div className="prod-section-label">01 / ĐẦU VÀO</div>
              <PairList rows={detail.input} />
            </article>
            <div className="prod-io-arrow" aria-hidden="true">
              →
            </div>
            <article className="prod-process">
              <div className="prod-section-label">02 / XỬ LÝ</div>
              {detail.flow.map((t, k) => (
                <div key={k}>
                  <b>{k + 1}</b>
                  {t}
                </div>
              ))}
            </article>
            <div className="prod-io-arrow" aria-hidden="true">
              →
            </div>
            <article>
              <div className="prod-section-label">03 / ĐẦU RA</div>
              <PairList rows={detail.output} />
            </article>
          </div>

          <div className="prod-checkstrip">
            {detail.gates.map((g) => {
              const v = gateChip(g);
              return (
                <span key={g.gate_id} className={v.cls} data-gate-status={g.status}>
                  <b>{v.icon}</b> {g.name} <em>{v.note}</em>
                </span>
              );
            })}
          </div>

          <div className="prod-worktabs" role="group" aria-label="Chế độ xem chi tiết">
            {MODES.map(([m, label]) => (
              <button type="button" key={m} data-prod-mode={m} aria-pressed={mode === m} className={mode === m ? 'chosen' : undefined} onClick={() => setMode(m)}>
                {label}
              </button>
            ))}
          </div>

          {mode === 'compute' ? (
            <ComputeTab
              detail={detail}
              live={live}
              equation={equations[id] ?? 0}
              onEquation={(k) => setEquations((e) => ({ ...e, [id]: k }))}
              recordId={records[id]}
              onRecord={(r) => setRecords((x) => ({ ...x, [id]: r }))}
              omitted={omittedNow}
              onToggleOmitted={(c) => setOmitted((o) => ({ ...o, [scenarioKey]: omittedNow.includes(c) ? omittedNow.filter((x) => x !== c) : [...omittedNow, c] }))}
            />
          ) : mode === 'accept' ? (
            <AcceptTab detail={detail} id={id} />
          ) : (
            <pre className="cl-pre prod-raw" tabIndex={0} aria-label={`Bản ghi đầy đủ của ${id}`}>
              {JSON.stringify(detail.raw ?? null, null, 2)}
            </pre>
          )}

          <div className="prod-handoff">
            <div>
              <b>04 / BÀN GIAO{target ? ` → ${target.toUpperCase()}` : ''}</b>
              <p>{detail.handoff}</p>
            </div>
            <span className={blocked ? 'bad' : undefined}>{blocked ? '⊘ BỊ KHÓA' : isActual(detail.state) ? '✓ ĐÃ TẠO OUTPUT' : '○ CHƯA BÀN GIAO'}</span>
          </div>
          {detail.notes.map((t, k) => (
            <div className="prod-caveat" key={k}>
              {t}
            </div>
          ))}
          {detail.computed_at ? <div className="prod-method-source">Đã tính lúc {formatTime(detail.computed_at)}</div> : null}
        </>
      ) : detail ? (
        <div className="empty">
          {detail.blockedAt ?? 'Cổng trước'} đang chặn. {id} không có đầu ra hợp lệ để tính. Chọn block bị chặn để xem điều kiện lỗi.
        </div>
      ) : detailError ? (
        <div className="empty">Không tải được chi tiết block: {detailError}</div>
      ) : (
        <div className="empty">Đang tải chi tiết {id}…</div>
      )}

      <div className="prod-footnav">
        <button type="button" data-prod-select={prev} onClick={() => onSelect(prev)}>
          ← {prev}
        </button>
        <span>{live ? 'Phiên Live · AI phán đoán ngữ nghĩa · code tính công thức và cổng' : 'Ngưỡng giả định · dữ liệu tổng hợp · không có model AI trực tiếp'}</span>
        <button type="button" data-prod-select={next} onClick={() => onSelect(next)}>
          {id !== 'FAST' && i === 8 ? 'B0 · đầu vòng' : next} →
        </button>
      </div>
    </section>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('vi-VN');
}
