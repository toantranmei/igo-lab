'use client';
import { Fragment } from 'react';
import type { BlockDetail, BlockVisual, RecordRow } from '@cl/contract';
import { showValue } from '@/components/guide/DataView';

type B5Visual = Extract<BlockVisual, { kind: 'b5' }>;

const pct = (x: number) => Number((100 * x).toFixed(1)) + '%';

/** "Bỏ một C thì nhiệm vụ nào mất căn cứ?" — a private what-if table; never changes B5's output. */
function CoverageSandbox({ visual, omitted, onToggle }: { visual: B5Visual; omitted: string[]; onToggle: (c: string) => void }) {
  const chosen = new Set(visual.competencies.filter((c) => !omitted.includes(c.id)).map((c) => c.id));
  const covered = (taskId: string) => (visual.links[taskId] ?? []).some((c) => chosen.has(c));
  const den = visual.tasks.reduce((a, t) => a + t.weight, 0);
  const num = visual.tasks.filter((t) => covered(t.id)).reduce((a, t) => a + t.weight, 0);
  const missed = visual.tasks.filter((t) => !covered(t.id));
  const computable = den > 0;
  return (
    <div className="prod-scenario">
      <div>
        <b>THỬ TƯ DUY NGƯỢC · Bỏ một C thì nhiệm vụ nào mất căn cứ?</b>
        <p>Chọn để bỏ / thêm C trong bảng tính riêng. Không đổi đầu ra B5 hoặc cổng nghiệm thu đã chạy.</p>
      </div>
      <div className="prod-scenario-options">
        {visual.competencies.map((c) => {
          const off = omitted.includes(c.id);
          return (
            <button type="button" key={c.id} data-prod-scenario={c.id} aria-pressed={!off} title={c.name} className={off ? 'excluded' : 'included'} onClick={() => onToggle(c.id)}>
              {off ? '−' : '✓'} {c.id}
            </button>
          );
        })}
      </div>
      <div className={'prod-scenario-result' + (!computable || missed.length ? ' risk' : '')} role="status" data-testid="coverage-result">
        <strong>
          <span data-testid="coverage-numerator">{num}</span> / <span data-testid="coverage-denominator">{den}</span> = <span data-testid="coverage-percent">{computable ? pct(num / den) : 'Không tính được'}</span>
        </strong>
        <span>
          {!computable
            ? 'Mẫu số bằng 0: không có trọng số nhiệm vụ để tính bao phủ.'
            : missed.length
              ? 'KHÔNG ĐẠT 100% · Mất: ' + missed.map((t) => `${t.id} (w=${t.weight})`).join(', ')
              : 'ĐẠT điều kiện bao phủ trong kịch bản thử'}
        </span>
      </div>
    </div>
  );
}

function Matrix({ visual, omitted, onPick }: { visual: B5Visual; omitted: string[]; onPick: (c: string) => void }) {
  return (
    <div className="prod-table-scroll scroll-x">
      <table className="prod-matrix">
        <caption>Ma trận aₜc · cột mờ = C bị bỏ trong kịch bản thử; chọn C để soi bản ghi</caption>
        <thead>
          <tr>
            <th scope="col">Nhiệm vụ / wₜ</th>
            {visual.competencies.map((c) => (
              <th key={c.id} scope="col">
                <button type="button" data-prod-record={c.id} title={c.name} onClick={() => onPick(c.id)}>
                  {c.id}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visual.tasks.map((t) => (
            <tr key={t.id}>
              <td>
                {t.id} · {t.name} <b>w={t.weight}</b>
              </td>
              {visual.competencies.map((c) => {
                const linked = (visual.links[t.id] ?? []).includes(c.id);
                const off = omitted.includes(c.id);
                return (
                  <td key={c.id} className={off ? 'omitted' : linked ? 'linked' : undefined}>
                    {linked ? (off ? '×' : '1') : '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Visual({ visual, omitted, onToggle, onPick }: { visual: BlockVisual; omitted: string[]; onToggle: (c: string) => void; onPick: (id: string) => void }) {
  if (visual.kind === 'b5')
    return (
      <>
        <CoverageSandbox visual={visual} omitted={omitted} onToggle={onToggle} />
        <Matrix visual={visual} omitted={omitted} onPick={onPick} />
      </>
    );
  if (visual.kind === 'b3') {
    const aliases = visual.candidates.filter((c) => c.alias).length;
    return (
      <div className="prod-transform scroll-x">
        <div>
          <b>{visual.jdCount} JD</b>
          <span>nhãn kỹ năng → mã concept</span>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <b>{visual.candidates.length} ứng viên C</b>
          <span>{aliases} alias dư</span>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <b>{visual.unique} concept duy nhất</b>
          <span>{aliases ? 'alias được gộp ở bước sau' : 'không còn alias trùng'}</span>
        </div>
      </div>
    );
  }
  if (visual.kind === 'b7') {
    const ok = visual.coverageOk && visual.gates.every((g) => g.pass);
    return (
      <div className="prod-gate-chain scroll-x">
        {visual.gates.map((g) => (
          <Fragment key={g.id}>
            <span className={g.pass ? undefined : 'bad'}>
              {g.id}
              <b>{g.pass ? '✓' : '×'}</b>
            </span>
            <i aria-hidden="true">∧</i>
          </Fragment>
        ))}
        <span className={visual.coverageOk ? undefined : 'bad'}>
          Coverage
          <b>{visual.coverageOk ? '✓' : '×'}</b>
        </span>
        <i aria-hidden="true">→</i>
        <strong className={ok ? undefined : 'bad'}>B7 {ok ? 'ĐẠT' : 'CHẶN'}</strong>
      </div>
    );
  }
  const kinds = ['ADD', 'UPDATE', 'REUSE'] as const;
  return (
    <div className="prod-diff-vis">
      {kinds.map((k) => {
        const hits = visual.changes.filter((c) => c.action === k);
        return (
          <div key={k}>
            <span className={k}>{k}</span>
            <b>{hits.length}</b>
            <p>{hits.map((c) => c.id).join(' · ') || 'Không có'}</p>
          </div>
        );
      })}
    </div>
  );
}

const isNumberList = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number');

/** Generic record payload: key/value, arrays as chips, ratings with the median marked, votes. */
function RecordData({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data))
    return (
      <div className="prod-trace-chips">
        {data.map((x, i) => (
          <span key={i}>{showValue(x)}</span>
        ))}
      </div>
    );
  if (typeof data !== 'object') return <p>{showValue(data)}</p>;
  const { ratings, votes, ...rest } = data as Record<string, unknown>;
  const sorted = isNumberList(ratings) ? [...ratings].sort((a, b) => a - b) : null;
  const mid = sorted ? [Math.floor((sorted.length - 1) / 2), Math.floor(sorted.length / 2)] : [];
  const level = rest.level;
  return (
    <>
      {sorted ? (
        <div className="prod-ratings" data-testid="record-ratings">
          {sorted.map((v, i) => (
            <span key={i} className={mid.includes(i) ? 'median' : undefined}>
              {v}
              <small>{mid.includes(i) ? 'MEDIAN' : 'rating'}</small>
            </span>
          ))}
          {typeof level === 'number' || typeof level === 'string' ? <b>→ R bậc {level}</b> : null}
        </div>
      ) : ratings !== undefined ? (
        <div className="prod-pair">
          <span>ratings</span>
          <b>{showValue(ratings)}</b>
        </div>
      ) : null}
      {Array.isArray(votes) ? (
        <div className="prod-votes" data-testid="record-votes">
          {votes.map((v, i) => (
            <span key={i}>
              Phiếu {i + 1}
              <b>{showValue(v)}</b>
            </span>
          ))}
        </div>
      ) : votes !== undefined ? (
        <div className="prod-pair">
          <span>votes</span>
          <b>{showValue(votes)}</b>
        </div>
      ) : null}
      <div className="prod-record-fields">
        {Object.entries(rest)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => (
            <div className="prod-pair" key={k}>
              <span>{k}</span>
              {Array.isArray(v) ? (
                v.length ? (
                  <div className="prod-trace-chips">
                    {v.map((x, i) => (
                      <span key={i}>{showValue(x)}</span>
                    ))}
                  </div>
                ) : (
                  <b>∅</b>
                )
              ) : (
                <b>{showValue(v)}</b>
              )}
            </div>
          ))}
      </div>
    </>
  );
}

interface Props {
  detail: BlockDetail;
  equation: number;
  onEquation: (k: number) => void;
  recordId: string | undefined;
  onRecord: (id: string) => void;
  omitted: string[];
  onToggleOmitted: (c: string) => void;
  live: boolean;
}

export default function ComputeTab({ detail, equation, onEquation, recordId, onRecord, omitted, onToggleOmitted, live }: Props) {
  const eq = Math.max(0, Math.min(equation, detail.calc.length - 1));
  const calc = detail.calc[eq];
  const pick: RecordRow | undefined = detail.rows.find((r) => r.id === recordId) ?? detail.rows[0];
  /** Matrix headers carry a competency id; rows may be labelled "C1 · name". */
  const pickByPrefix = (id: string) => {
    const row = detail.rows.find((r) => r.id === id) ?? detail.rows.find((r) => r.id.split(' · ')[0] === id);
    if (row) onRecord(row.id);
  };
  return (
    <>
      {detail.visual ? <Visual visual={detail.visual} omitted={omitted} onToggle={onToggleOmitted} onPick={pickByPrefix} /> : null}
      <div className="prod-calc-layout">
        <article className="prod-calculator">
          <div className="prod-section-label">BẢNG TÍNH · CHỌN PHÉP KIỂM</div>
          {calc ? (
            <>
              <div className="prod-equation-tabs">
                {detail.calc.map((x, k) => (
                  <button type="button" key={k} data-prod-equation={k} aria-pressed={k === eq} className={k === eq ? 'chosen' : undefined} onClick={() => onEquation(k)}>
                    {x.label}
                  </button>
                ))}
              </div>
              <div className="prod-math scroll-x">{calc.formula}</div>
              <div className="prod-substitution">
                <small>{live ? 'THAY DỮ LIỆU CỦA PHIÊN VÀO CÔNG THỨC' : 'THAY DỮ LIỆU SEED VÀO CÔNG THỨC'}</small>
                <strong>{calc.substitution}</strong>
              </div>
              <p className="prod-math-definition">{calc.meaning}</p>
            </>
          ) : (
            <p className="prod-math-definition">Block này chưa có phép tính để hiển thị.</p>
          )}
        </article>
        <article className="prod-records">
          <div className="prod-section-label">BẢN GHI THAM GIA PHÉP TÍNH</div>
          {detail.rows.length && pick ? (
            <>
              <div className="prod-record-list">
                {detail.rows.map((r) => (
                  <button type="button" key={r.id} data-prod-record={r.id} aria-pressed={pick.id === r.id} className={(pick.id === r.id ? 'chosen ' : '') + (r.bad ? 'bad-record' : '')} onClick={() => onRecord(r.id)}>
                    <span>
                      <b>{r.id}</b> {r.name}
                    </span>
                    <em>{r.value}</em>
                  </button>
                ))}
              </div>
              <div className="prod-record-detail">
                <b>
                  {pick.id} · {pick.name}
                </b>
                <p>{pick.detail}</p>
                <RecordData data={pick.data} />
              </div>
            </>
          ) : (
            <p>Đầu vào là cấu hình có phiên bản; xem các trường trong ô đầu vào và bản ghi đầy đủ.</p>
          )}
        </article>
      </div>
    </>
  );
}
