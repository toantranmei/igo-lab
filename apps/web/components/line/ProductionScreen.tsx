'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { BlockCard, BlockDetail, BlockId, CardState, LogEntry, SessionState } from '@cl/contract';
import { useGuide } from '@/lib/guide-api';
import { useSession } from '@/lib/session';
import BlockProgressView from './BlockProgress';
import Workbench from './Workbench';
import './line.css';

const LANE_1: BlockId[] = ['B0', 'B1', 'B2', 'B3'];
const LANE_2: BlockId[] = ['B4', 'B5', 'B6', 'B7', 'B8'];

const STATUS_TEXT: Record<CardState, string> = {
  awaiting_view: 'CHỜ ĐÃ HIỂU',
  pass: '✓ ĐẠT',
  blocked: '⊘ CHẶN',
  idle: 'CHƯA CHẠY',
  running: 'ĐANG TÍNH',
  needs_input: 'CẦN BỔ SUNG',
  error: 'LỖI',
  stale: 'CẦN CHẠY LẠI',
};
const STATUS_CLASS: Partial<Record<CardState, string>> = { pass: 'done', blocked: 'blocked', error: 'blocked', awaiting_view: 'awaiting', running: 'running', needs_input: 'attention', stale: 'attention' };
/** Card states that have a computed trace to look at (Live never previews a block that has not run). */
const HAS_RUN: CardState[] = ['pass', 'blocked', 'awaiting_view', 'stale'];

/** "claude-sonnet-4-5-20250929" → "sonnet-4-5". */
const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/@.*$/, '');

function Badges({ card }: { card: BlockCard }) {
  if (card.badge.kind === 'CODE') return <span className="cl-badge code">Code</span>;
  const tasks = card.badge.tasks ?? [];
  if (!tasks.length) return <span className="cl-badge ai">AI</span>;
  return (
    <>
      {tasks.map((t) => (
        <span className="cl-badge ai" key={t.task_id} title={t.task_id}>
          AI · {shortModel(t.model)} · {t.effort}
        </span>
      ))}
    </>
  );
}

function Node({ card, selected, onSelect }: { card: BlockCard; selected: boolean; onSelect: (id: BlockId) => void }) {
  return (
    <button type="button" className={`prod-node ${selected ? 'chosen' : ''} ${STATUS_CLASS[card.state] ?? ''}`} data-prod-select={card.id} data-state={card.state} aria-pressed={selected} onClick={() => onSelect(card.id)}>
      <div>
        <b>{card.id}</b>
        <span>{STATUS_TEXT[card.state]}</span>
      </div>
      <strong>{card.name}</strong>
      <small>{card.agent}</small>
      <span className="prod-badges">
        <Badges card={card} />
      </span>
      <div className="prod-receipt">{card.receipt}</div>
      {card.progress ? <BlockProgressView progress={card.progress} compact /> : null}
      <em>{card.artifact}</em>
    </button>
  );
}

function Lane({ ids, state, selected, onSelect }: { ids: BlockId[]; state: SessionState; selected: BlockId; onSelect: (id: BlockId) => void }) {
  const cards = ids.map((id) => state.cards.find((c) => c.id === id)).filter((c): c is BlockCard => !!c);
  return (
    <div className="prod-line scroll-x">
      {cards.map((c, i) => (
        <Fragment key={c.id}>
          <Node card={c} selected={selected === c.id} onSelect={onSelect} />
          {i < cards.length - 1 ? (
            <span className="prod-arrow" aria-hidden="true">
              →
            </span>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

function Logs({ logs }: { logs: LogEntry[] }) {
  const shown = [...logs].sort((a, b) => b.seq - a.seq).slice(0, 16);
  return (
    <div className="event-section">
      <div className="section-head">
        <h2>Nhật ký bàn giao</h2>
        <span id="log-count">{logs.length} sự kiện</span>
      </div>
      <div id="logs">
        {shown.length ? (
          shown.map((l) => (
            <div className="log" key={`${l.run}-${l.seq}`}>
              <span>#{String(l.seq).padStart(3, '0')}</span>
              <span className={'tag' + (['HALT', 'BLOCK', 'FAIL', 'ERROR'].includes(l.type) ? ' warn' : '')}>{l.type}</span>
              <div>
                {l.step} · {l.summary}
              </div>
            </div>
          ))
        ) : (
          <div className="empty">Chạy B0 để bắt đầu lưu dấu vết.</div>
        )}
      </div>
    </div>
  );
}

export default function ProductionScreen() {
  const { source, state } = useSession();
  const guide = useGuide();
  const live = source.mode === 'live';
  const pendingId = state?.pending?.id ?? null;
  const [selected, setSelected] = useState<BlockId>(pendingId ?? 'B0');
  const [detail, setDetail] = useState<BlockDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Starting (or resuming) a block puts it on the workbench, like the reference.
  useEffect(() => {
    if (pendingId) setSelected(pendingId);
  }, [pendingId]);
  // Deep link: ?block=B3 opens that block on the workbench; the choice is mirrored back into the URL.
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('block');
    if (b && /^(B[0-8]|FAST)$/.test(b) && !pendingId) setSelected(b as BlockId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('block') === selected) return;
    url.searchParams.set('block', selected);
    window.history.replaceState(window.history.state, '', url);
  }, [selected]);

  // Reading a detail never creates a job; it is re-read whenever the session state changes.
  useEffect(() => {
    let alive = true;
    source
      .getDetail(selected)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setDetailError(null);
      })
      .catch((e: unknown) => {
        if (alive) setDetailError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [source, selected, state]);

  const select = useCallback(
    (id: BlockId) => {
      if (!state) return;
      if (state.pending) {
        guide.reopenPending();
        return;
      }
      setSelected(id);
      if (!live) {
        guide.openPreview(id);
        return;
      }
      // Live: opening a card must never start work; only blocks that already ran have beats to replay.
      const ran = id === 'FAST' ? state.fast.done : HAS_RUN.includes(state.cards.find((c) => c.id === id)?.state ?? 'idle');
      if (ran) guide.openPreview(id);
    },
    [state, guide, live],
  );

  if (!state) return null;
  const fastCard = state.cards.find((c) => c.id === 'FAST');
  const summary = state.fast.summary || (state.fast.done ? 'Bản thử đã tạo' : 'Có thể xem trước / giao thử sau B3');
  const current = detail && detail.id === selected ? detail : null;

  return (
    <div id="production-board">
      <div className="prod-command">
        <span>
          <b>A0</b> phân việc &amp; khóa snapshot <i>→</i> <b>AI B0–B8</b> sản xuất <i>→</i> <b>AQ</b> kiểm cổng / dừng
        </span>
        <small>Đọc được nội bộ; đầu vào và quyền ghi bị kiểm soát khi chạy.</small>
      </div>
      <div className="prod-map">
        <div className="prod-lane-label">
          01 / CHUẨN BỊ CHUNG <span>Hợp đồng → dữ liệu → nhiệm vụ → khái niệm</span>
        </div>
        <Lane ids={LANE_1} state={state} selected={selected} onSelect={select} />
        <div className="prod-branch-link">
          ↓ B3 chia nhánh theo mục đích <span>Nhánh đầy đủ vẫn đọc dữ liệu B1/B2/B3; không chỉ nhận output liền trước.</span>
        </div>
        <div className="prod-quick-lane">
          <button type="button" className={selected === 'FAST' ? 'chosen' : undefined} data-prod-select="FAST" data-state={fastCard?.state ?? (state.fast.done ? 'pass' : 'idle')} aria-pressed={selected === 'FAST'} onClick={() => select('FAST')}>
            <b>↗ GIAO NHANH</b>
            <span>A6/A8 soạn nháp → AU kiểm phạm vi → trial → pilot V</span>
            <small>
              {summary}
              {summary.includes('không ghi lõi') ? '' : ' · không ghi lõi W/C/R'}
              {fastCard ? (
                <>
                  {' '}
                  <Badges card={fastCard} />
                </>
              ) : null}
            </small>
          </button>
          <span>↘ V → B4 lượt sau</span>
        </div>
        <div className="prod-lane-label">
          02 / KIỂM CHỨNG ĐẦY ĐỦ <span>Căn cứ → chọn → chỉ báo → kiểm → phiên bản</span>
        </div>
        <Lane ids={LANE_2} state={state} selected={selected} onSelect={select} />
        <div className="prod-memory">
          <b>↶ AU sau khung ứng viên</b>
          <span>Finding có bằng chứng → lesson → quyết định an toàn ngoài B → A0/AQ nạp lượt sau → B3 tránh lặp lỗi</span>
        </div>
      </div>

      <Workbench id={selected} card={state.cards.find((c) => c.id === selected)} detail={current} detailError={current ? null : detailError} state={state} onSelect={select} />

      <Logs logs={state.logs} />
    </div>
  );
}
