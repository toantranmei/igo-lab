'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ChangeItem, DictView, ReleaseHistoryEntry, SessionState } from '@cl/contract';
import { dictionaryGraph, sampleTwoRunState, traceGraph, type KNode } from '@cl/example';
import { useSession } from '@/lib/session';
import { useCatalog } from '@/lib/catalog';
import CatalogExplorer from '@/components/catalog/CatalogExplorer';
import GraphView from '@/components/knowledge/GraphView';
import '@/components/knowledge/knowledge.css';

type DictTab = 'network2d' | 'network3d' | 'matrix' | 'compare' | 'trace' | 'versions' | 'raw';
const TABS: [DictTab, string][] = [
  ['network2d', 'Mạng 2D'],
  ['network3d', 'Mạng node 3D'],
  ['matrix', 'Ma trận liên ngành'],
  ['compare', 'So sánh vai trò'],
  ['trace', 'Truy vết nguồn'],
  ['versions', 'Phiên bản/diff'],
  ['raw', 'Dữ liệu chi tiết'],
];
const CATALOG_VIEW = { network2d: 'network', network3d: '3d', matrix: 'matrix', compare: 'compare' } as const;
type CatalogTab = keyof typeof CATALOG_VIEW;
const isCatalogTab = (t: DictTab): t is CatalogTab => t in CATALOG_VIEW;
const VIEW_TAB: Record<(typeof CATALOG_VIEW)[CatalogTab], CatalogTab> = { network: 'network2d', '3d': 'network3d', matrix: 'matrix', compare: 'compare' };

type RawBlock = 'W' | 'C' | 'R' | 'V' | 'G';
const RAW: RawBlock[] = ['W', 'C', 'R', 'V', 'G'];
const ACTION_LABEL: Record<string, string> = { ADD: 'thêm mới', UPDATE: 'cập nhật', REUSE: 'tái sử dụng', NEEDS_REVIEW: 'cần xem lại' };

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="stat visual-stat">
      <span>
        <b>{n}</b> {label}
      </span>
    </div>
  );
}

function changeName(h: ReleaseHistoryEntry, c: ChangeItem): string {
  return c.name || h.after.C.find((x) => x.id === c.id)?.name || c.after || c.id;
}

function Versions({ history }: { history: ReleaseHistoryEntry[] }) {
  const [sel, setSel] = useState<{ run: number; key: string } | null>(null);
  if (!history.length) return <div className="empty">Chưa có phiên bản phát hành. Hoàn tất B8 của một lượt để có bản phát hành đầu tiên.</div>;
  const keyOf = (c: ChangeItem, i: number) => `${c.entity}:${c.id}:${i}`;
  const h = sel ? history.find((x) => x.run === sel.run) ?? null : null;
  const change = h && sel ? h.changes.find((c, i) => keyOf(c, i) === sel.key) ?? null : null;
  return (
    <>
      <div className="version-timeline">
        {history.map((entry) => {
          const counts = (a: string) => entry.changes.filter((c) => c.action === a).length;
          const review = counts('NEEDS_REVIEW');
          return (
            <article key={entry.run + ':' + entry.toVersion} className="version-event">
              <span className="version-orb">{entry.toVersion}</span>
              <div>
                <div className="eyebrow">LƯỢT {entry.run} · G / AI REGISTRY</div>
                <h3>
                  Lõi v{entry.fromVersion} → v{entry.toVersion}
                </h3>
                <div className="change-counts">
                  {(['ADD', 'UPDATE', 'REUSE'] as const).map((a) => (
                    <span key={a}>
                      <b>{counts(a)}</b> {ACTION_LABEL[a]}
                    </span>
                  ))}
                  {review > 0 && (
                    <span>
                      <b>{review}</b> {ACTION_LABEL.NEEDS_REVIEW}
                    </span>
                  )}
                </div>
                <div className="change-tiles">
                  {entry.changes.map((c, i) => {
                    const k = keyOf(c, i);
                    const on = sel?.run === entry.run && sel.key === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        className={`change-tile ${c.action}${on ? ' kg-selected' : ''}`}
                        data-change-id={c.id}
                        data-change-version={entry.toVersion}
                        aria-pressed={on}
                        onClick={() => setSel({ run: entry.run, key: k })}
                      >
                        <span>
                          {c.id} · {c.action}
                        </span>
                        <strong>{changeName(entry, c)}</strong>
                      </button>
                    );
                  })}
                </div>
                {entry.receipt ? (
                  <dl className="kg-receipt">
                    <dt>Mã phát hành</dt>
                    <dd>{entry.receipt.release_id}</dd>
                    <dt>Hash</dt>
                    <dd>{entry.receipt.hash}</dd>
                    <dt>Người quyết định</dt>
                    <dd>
                      {entry.receipt.decided_by} · {entry.receipt.decided_at}
                    </dd>
                  </dl>
                ) : null}
                <p className="muted-box">Các khung cũ vẫn giữ yêu cầu và chỉ báo của phiên bản đã dùng. Mã năng lực C được tái sử dụng.</p>
              </div>
            </article>
          );
        })}
      </div>
      <div id="version-change-detail" className="record" aria-live="polite">
        {!h || !change ? (
          'Chọn một thay đổi để đối chiếu nội dung trước và sau.'
        ) : (
          <>
            <h3>
              {changeName(h, change)} · <span className={change.action}>{change.action}</span>{' '}
              <span className="pill">{change.action === 'REUSE' ? 'KẾ THỪA NGUYÊN BẢN' : change.action === 'ADD' ? 'MỚI TRONG LƯỢT NÀY' : change.action === 'UPDATE' ? 'ĐÃ THAY ĐỔI' : 'CẦN XEM LẠI'}</span>
            </h3>
            <div className="before-after">
              <div>
                <div className="label">TRƯỚC · v{h.fromVersion}</div>
                <p>{change.before ?? 'Chưa có phần tử này trong từ điển'}</p>
              </div>
              <div>
                <div className="label">SAU · v{h.toVersion}</div>
                <p>{change.after ?? 'Không còn trong từ điển'}</p>
              </div>
            </div>
            <div className="label">LÝ DO</div>
            <p>{change.reason || 'Không ghi lý do riêng cho thay đổi này.'}</p>
            <div className="label">VAI TRÒ / KHUNG BỊ ẢNH HƯỞNG</div>
            <p>{change.affected?.length ? change.affected.join(' · ') : 'Không có khung nào bị ảnh hưởng.'}</p>
            {h.receipt && (
              <>
                <div className="label">BIÊN NHẬN PHÁT HÀNH</div>
                <dl className="kg-receipt">
                  <dt>Mã phát hành</dt>
                  <dd>{h.receipt.release_id}</dd>
                  <dt>Hash</dt>
                  <dd>{h.receipt.hash}</dd>
                  <dt>Người quyết định</dt>
                  <dd>
                    {h.receipt.decided_by} · {h.receipt.decided_at}
                  </dd>
                </dl>
              </>
            )}
            <p className="muted-box">
              {change.action === 'REUSE'
                ? 'Tái sử dụng nguyên nội dung C. Yêu cầu R và nguồn bằng chứng có thể khác theo khung.'
                : 'G ghi lịch sử thay đổi; các kết quả đã ghim phiên bản không bị ghi đè.'}
            </p>
          </>
        )}
      </div>
    </>
  );
}

function Trace({ d, sessionId, initialCid, initialVersion }: { d: DictView; sessionId: string; initialCid: string; initialVersion: string }) {
  const [version, setVersion] = useState(initialVersion);
  const [cid, setCid] = useState(initialCid);
  const frames = d.R || [];
  const frame = frames.find((r) => r.version === version) ?? frames[frames.length - 1] ?? null;
  const comp = frame ? (frame.competencies.find((c) => c.id === cid) ?? frame.competencies[0] ?? null) : null;
  const graph = useMemo(() => (frame && comp ? traceGraph(d, comp.id, frame.version) : null), [d, frame, comp]);
  if (!frame) return <div className="empty">Chưa có yêu cầu R để truy vết. Hoàn tất B8 để có khung phát hành.</div>;
  const docHref = (id: string) => `/s/${sessionId}/inputs?doc=${encodeURIComponent(id)}`;
  const sources = graph?.nodes.filter((n) => n.kind === 'V') ?? [];
  const nodeLink = (n: KNode) => (n.kind === 'V' ? { href: docHref(String(n.detail.id ?? n.label)), label: 'Mở đúng bản ghi đầu vào →' } : null);
  return (
    <>
      <div className="graph-filters">
        <label>
          Khung
          <select id="trace-version" value={frame.version} onChange={(e) => setVersion(e.target.value)}>
            {frames.map((x) => (
              <option key={x.version} value={x.version}>
                {x.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Năng lực
          <select id="trace-competency" value={comp?.id ?? ''} onChange={(e) => setCid(e.target.value)}>
            {frame.competencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted-box">Nguồn → bước xử lý → yêu cầu → chỉ báo. Quan hệ này thể hiện căn cứ và hoạt động tạo ra kết quả, không chứng minh quan hệ nhân quả.</p>
      {graph && comp ? (
        <>
          <GraphView key={frame.version + ':' + comp.id} graph={graph} prefix="trace" nodeLink={nodeLink} emptyText="Chưa có quan hệ để truy vết cho năng lực này." />
          <div className="kg-sources">
            {sources.length ? (
              <>
                <span>Bản ghi nguồn ({sources.length}):</span>
                {sources.map((n) => {
                  const id = String(n.detail.id ?? n.label);
                  return (
                    <Link key={n.id} href={docHref(id)} data-source-doc={id}>
                      {id}
                    </Link>
                  );
                })}
              </>
            ) : (
              <span>Chưa có bản ghi nguồn V nào gắn với năng lực này trong phiên bản {frame.version}.</span>
            )}
          </div>
        </>
      ) : (
        <div className="empty">Khung phiên bản {frame.version} chưa có năng lực nào.</div>
      )}
    </>
  );
}

export default function DictionaryScreen() {
  const { state, source, sessionId } = useSession();
  const { catalog, origin, loading, showSeed, setShowSeed } = useCatalog();
  const params = useSearchParams();
  const startTab = params.get('dtab');
  const [tab, setTab] = useState<DictTab>(TABS.some(([t]) => t === startTab) ? (startTab as DictTab) : 'network2d');
  const [demo, setDemo] = useState(false);
  const [raw, setRaw] = useState<RawBlock>('C');

  const isExample = source.mode === 'example';
  const catalogTab = isCatalogTab(tab);
  const demoOn = demo && isExample && !catalogTab;
  const sample = useMemo<SessionState | null>(() => (demoOn ? sampleTwoRunState() : null), [demoOn]);
  const view = sample ?? state;
  const networkGraph = useMemo(() => (view ? dictionaryGraph(view.dictionary) : null), [view]);

  if (!state || !view) return null;
  const d = view.dictionary;
  const current = view.history.find((h) => h.run === view.runNo) ?? null;
  const reused = current ? current.changes.filter((c) => c.action === 'REUSE').length : 0;
  const seedShown = origin === 'seed';

  const pill = catalogTab ? (seedShown ? `THƯ VIỆN SEED · ${catalog.version}` : `TỪ ĐIỂN ĐÃ CÔNG BỐ · ${catalog.version}`) : `${demoOn ? 'MẪU · ' : ''}CORE v${d.version}`;
  const caption = catalogTab
    ? seedShown
      ? isExample
        ? 'THƯ VIỆN SEED NHIỀU VAI TRÒ · tách khỏi dữ liệu lượt chạy của phiên. Tất cả nguồn đều là dữ liệu tổng hợp.'
        : 'THƯ VIỆN SEED · chỉ để tham khảo — không phải từ điển của workspace và không được dùng làm bằng chứng.'
      : 'TỪ ĐIỂN ĐÃ CÔNG BỐ CỦA WORKSPACE · bản đã khóa cho lượt đang chạy.'
    : demoOn
      ? 'BẢN MINH HỌA RIÊNG · mô phỏng trọn 2 lượt từ seed, không thay đổi lượt đang chạy. Tất cả nguồn đều là dữ liệu tổng hợp.'
      : isExample
        ? 'DỮ LIỆU LÕI ĐANG CÓ · cập nhật trực tiếp theo tiến trình mô phỏng. Tất cả nguồn đều là dữ liệu tổng hợp.'
        : 'DỮ LIỆU LÕI CỦA PHIÊN · bản đã công bố và lịch sử phát hành của phiên này.';

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Từ điển và tái sử dụng</h2>
          <p>Một lần xây. Những lần sau kế thừa. W: nghề · C: năng lực · R: liên kết yêu cầu · V: bằng chứng · G: quản trị.</p>
        </div>
        <span className="pill" id="dict-version">
          {pill}
        </span>
      </div>

      <div id="dict-stats" className="stats">
        {catalogTab ? (
          <>
            <Stat n={catalog.roles.length} label="vị trí chuẩn W" />
            <Stat n={catalog.families.length} label="họ nghề" />
            <Stat n={catalog.competencies.length} label="năng lực chung C" />
            <Stat n={catalog.profiles.length} label="khung gốc / biến thể ngành" />
          </>
        ) : (
          <>
            <Stat n={d.C.length} label="năng lực chung C" />
            <Stat n={d.R.length} label="phiên bản khung R" />
            <Stat n={d.V.length} label="bản ghi bằng chứng V" />
            <Stat n={reused} label="tái sử dụng nguyên bản lượt này" />
          </>
        )}
      </div>

      <div className="kg-tabs" id="dict-tabs" role="tablist" aria-label="Góc nhìn từ điển">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" id={`dict-tab-${t}`} aria-selected={tab === t} aria-controls="dict-content" data-dict-tab={t} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div className="kg-bar">
        <div className="visual-caption" style={{ padding: 0 }}>
          {caption}
        </div>
        <div className="cl-row">
          {catalogTab && !isExample && (
            <label className="kg-switch">
              <input type="checkbox" role="switch" id="show-seed" checked={showSeed} onChange={(e) => setShowSeed(e.target.checked)} />
              Xem thư viện mẫu (seed)
            </label>
          )}
          {catalogTab && !isExample && seedShown && <span className="kg-seed">SEED · chỉ để tham khảo</span>}
          {!catalogTab && isExample && (
            <div className="visual-top" style={{ margin: 0 }}>
              <button type="button" data-demo aria-pressed={demo} className={demo ? 'chosen' : ''} onClick={() => setDemo((v) => !v)}>
                {demo ? '● Đang xem mẫu 2 lượt' : 'Xem mẫu đủ 2 lượt'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div id="dict-content" role="tabpanel" aria-labelledby={`dict-tab-${tab}`}>
        {isCatalogTab(tab) &&
          (loading ? (
            <div className="empty">Đang tải từ điển đã công bố…</div>
          ) : !seedShown && catalog.roles.length === 0 && catalog.competencies.length === 0 ? (
            <div className="empty">
              Workspace chưa có từ điển được công bố cho lượt này.
              <br />
              Hoàn tất B8 để công bố, hoặc bật “Xem thư viện mẫu (seed)” để tham khảo cấu trúc.
            </div>
          ) : (
            <CatalogExplorer catalog={catalog} view={CATALOG_VIEW[tab]} onViewChange={(v: (typeof CATALOG_VIEW)[CatalogTab]) => setTab(VIEW_TAB[v])} showTabs={false} />
          ))}

        {tab === 'trace' && <Trace key={demoOn ? 'demo' : 'live'} d={d} sessionId={sessionId} initialCid={params.get('c') ?? ''} initialVersion={params.get('v') ?? ''} />}

        {tab === 'versions' && (
          <>
            <Versions key={demoOn ? 'demo' : 'live'} history={view.history} />
            <div className="kg-sub">
              <h3>Mạng quan hệ W–R–C của phiên</h3>
              <p>
                <b>C là phần chung.</b> Mỗi mã năng lực chỉ có một nút; các khung/phiên bản R cùng tham chiếu. Bậc yêu cầu nằm trên liên kết R → C.
              </p>
            </div>
            {networkGraph && (
              <GraphView
                key={demoOn ? 'demo' : 'live'}
                graph={networkGraph}
                prefix="dict"
                emptyText="Chưa có quan hệ W–R–C. Hoàn tất B8 để ghi W, C và R vào từ điển của phiên."
              />
            )}
          </>
        )}

        {tab === 'raw' && (
          <>
            <div className="dict-tabs">
              {RAW.map((k) => (
                <button key={k} type="button" data-raw={k} aria-pressed={raw === k} className={raw === k ? 'active' : ''} onClick={() => setRaw(k)}>
                  {k} · {d[k].length}
                </button>
              ))}
            </div>
            <pre className="kg-raw" tabIndex={0} aria-label={`Dữ liệu ${raw}`}>
              {JSON.stringify(d[raw], null, 2)}
            </pre>
          </>
        )}
      </div>

      {!catalogTab && (
        <>
          <div className="section-head" style={{ marginTop: 34 }}>
            <h2>Biến động trong lần chạy</h2>
          </div>
          <div id="diff">
            {demoOn ? (
              <div className="muted-box">Đang xem mẫu: mở “Phiên bản/diff” để xem đầy đủ thay đổi của hai lượt mẫu.</div>
            ) : current?.changes.length ? (
              current.changes.map((c, i) => (
                <div key={c.entity + c.id + i} className="diff-row">
                  <span className={c.action}>{c.action}</span>
                  <span>{c.id}</span>
                  <div>
                    {c.after ?? c.name ?? ''}
                    {c.action === 'UPDATE' && c.before && (
                      <small className="dim">
                        <br />
                        Trước: {c.before}
                      </small>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">Chưa có thay đổi lõi trong lượt này.</div>
            )}
          </div>
        </>
      )}
    </>
  );
}
