'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { CatalogApi, GraphEdge, GraphNode } from '@cl/example';
import Compare from './Compare';
import Inspector from './Inspector';
import Matrix from './Matrix';
import Network2D from './Network2D';
import Network3D from './Network3D';
import { GROUP_NAMES, edgeDisplay, edgeParts, focusSets, makeLookup, type CatPick, type CatalogView } from './model';
import './catalog.css';

export type { CatalogView } from './model';

const VIEWS: [CatalogView, string][] = [
  ['network', 'Mạng 2D'],
  ['3d', 'Mạng node 3D'],
  ['matrix', 'Ma trận liên ngành'],
  ['compare', 'So sánh vai trò'],
];

export interface CatalogExplorerProps {
  catalog: CatalogApi;
  view: CatalogView;
  onViewChange?(v: CatalogView): void;
  showTabs?: boolean;
}

export default function CatalogExplorer({ catalog, view: viewProp, onViewChange, showTabs }: CatalogExplorerProps): JSX.Element {
  const seed = catalog.origin !== 'live';
  const lk = useMemo(() => makeLookup(catalog), [catalog]);

  // `view` is controlled by the parent when it passes onViewChange; otherwise the tabs drive a local copy.
  const [localView, setLocalView] = useState<CatalogView>(viewProp);
  useEffect(() => setLocalView(viewProp), [viewProp]);
  const view = onViewChange ? viewProp : localView;
  const changeView = (v: CatalogView) => {
    setLocalView(v);
    onViewChange?.(v);
  };

  const [family, setFamily] = useState('all');
  const [industry, setIndustry] = useState('all');
  const [group, setGroup] = useState('all');
  const [competencyState, setCompetency] = useState('C05');
  const [pick, setPick] = useState<CatPick>({ type: 'overview' });
  const [allNetwork, setAllNetwork] = useState(true);
  const [aId, setAId] = useState('R-PO-TECH');
  const [bId, setBId] = useState('R-DA-FIN');

  const allowed = useMemo(() => catalog.competencies.filter((c) => group === 'all' || c.group === group), [catalog, group]);
  const competency = allowed.some((c) => c.id === competencyState) ? competencyState : (allowed[0]?.id ?? '');

  // The single source for both network views: same filters → same profiles → same GraphModel.
  const ps = useMemo(() => catalog.filtered({ family, industry, group }), [catalog, family, industry, group]);
  const graph = useMemo(() => catalog.graph(ps), [catalog, ps]);
  const focus = useMemo(() => focusSets(graph, pick, lk), [graph, pick, lk]);

  const pickCompetency = (id: string): CatPick => (id ? { type: 'competency', id } : { type: 'overview' });

  const onNode = useCallback((n: GraphNode) => {
    setPick({ type: n.kind, id: n.key });
    if (n.kind === 'competency') setCompetency(n.key);
  }, []);
  const onEdge = useCallback((e: GraphEdge) => {
    const p = edgeParts(e);
    if (e.kind === 'FAMILY_ROLE' || !p.cid) setPick({ type: 'family', id: p.family ?? '' });
    else {
      setPick({ type: 'edge', role: p.role, cid: p.cid });
      setCompetency(p.cid);
    }
  }, []);
  const display = useCallback((e: GraphEdge) => edgeDisplay(e, lk), [lk]);
  const clearPick = useCallback(() => setPick({ type: 'overview' }), []);

  const onPick = (p: CatPick) => {
    setPick(p);
    if (p.type === 'competency') setCompetency(p.id);
    else if ((p.type === 'profile' || p.type === 'edge' || p.type === 'cell') && p.cid) setCompetency(p.cid);
  };

  const exportSeed = () => {
    const payload = { version: catalog.version, synthetic: true, families: catalog.families, roles: catalog.roles, industries: catalog.industries, competencies: catalog.competencies, profiles: catalog.profiles };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = 'competence-multi-role-seed.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const baseCount = catalog.profiles.filter((p) => p.industry === 'BASE').length;
  const empty = catalog.profiles.length === 0;
  const profileA = catalog.profiles.find((p) => p.id === aId) ?? catalog.profiles[0];
  const profileB = catalog.profiles.find((p) => p.id === bId) ?? catalog.profiles[1] ?? catalog.profiles[0];
  const roleCount = new Set(ps.map((p) => p.role)).size;
  const usedCount = new Set(ps.flatMap((p) => p.requirements.map((q) => q.id))).size;
  const wide = (view === 'network' && allNetwork) || view === '3d';

  let main: JSX.Element;
  if (view === 'compare') {
    main = profileA && profileB ? <Compare catalog={catalog} lk={lk} a={profileA} b={profileB} onA={setAId} onB={setBId} onRequire={(id, cid) => onPick({ type: 'profile', id, cid })} /> : <p className="muted-box catalog-empty">Cần ít nhất một khung để so sánh.</p>;
  } else if (ps.length === 0) {
    main = (
      <p className="muted-box catalog-empty" data-node-count={0} data-edge-count={0}>
        Không có khung nào khớp bộ lọc hiện tại. Bấm “Bỏ bộ lọc” để xem lại toàn bộ.
      </p>
    );
  } else if (view === 'network') {
    main = (
      <>
        <div className="catalog-visible">
          {allNetwork
            ? `TOÀN MẠNG · ${roleCount} vai trò · ${usedCount} năng lực · ${ps.length} khung/ngành`
            : `Đang xem quanh ${lk.comp(competency).name} · ${graph.edges.filter((e) => e.kind === 'ROLE_COMPETENCY' && e.to === 'C:' + competency).length} vai trò`}
        </div>
        <Network2D graph={graph} lk={lk} mode={allNetwork ? 'full' : 'ego'} cid={competency} pick={pick} focus={focus} onNode={onNode} onEdge={onEdge} />
      </>
    );
  } else if (view === '3d') {
    main = <Network3D graph={graph} focus={focus} edgeDisplay={display} onNode={onNode} onEdge={onEdge} onClear={clearPick} />;
  } else {
    main = <Matrix catalog={catalog} ps={ps} group={group} pick={pick} onCell={(cid, ind) => onPick({ type: 'cell', cid, industry: ind })} />;
  }

  return (
    <div className="catalog-explorer" data-cat-origin={seed ? 'seed' : 'live'} data-cat-current-view={view}>
      <div className="catalog-intro">
        <div>
          <span className="eyebrow">{seed ? 'SHARED COMPETENCY LIBRARY · SEED' : 'TỪ ĐIỂN ĐÃ CÔNG BỐ CỦA WORKSPACE'}</span>
          <h2>
            {catalog.roles.length} vị trí · {catalog.families.length} họ nghề · {catalog.industries.length} ngành
          </h2>
          <p>
            {seed
              ? `${baseCount} khung gốc liên ngành + ${catalog.profiles.length - baseCount} biến thể ngành. Ngành gắn trên R; C giữ một định nghĩa chung.`
              : `${catalog.profiles.length} khung R đã công bố · ${catalog.competencies.length} năng lực C${catalog.version ? ' · phiên bản ' + catalog.version : ''}. Ngành gắn trên R; C giữ một định nghĩa chung.`}
          </p>
        </div>
        {seed && (
          <button type="button" id="cat-export" onClick={exportSeed}>
            ↓ Xuất seed thư viện
          </button>
        )}
      </div>
      {seed && (
        <div className="catalog-disclaimer">
          Thư viện seed minh họa theo Chuẩn kiến trúc v1.1: họ nghề, cấp bậc, bối cảnh ngành, FND/LDR/PRO/MC. Tên họ nghề, gán cấp, yêu cầu và trọng số ở đây là giả định thiết kế, chưa qua quy trình sản xuất/kiểm định. Không thay đổi lõi của lượt Product Owner đang chạy; mã ngành nội bộ chưa ánh xạ VSIC.
        </div>
      )}
      {showTabs && (
        <div className="catalog-tabs" role="group" aria-label="Chế độ xem từ điển">
          {VIEWS.map(([id, title]) => (
            <button key={id} type="button" data-cat-view={id} className={view === id ? 'chosen' : undefined} aria-pressed={view === id} onClick={() => changeView(id)}>
              {title}
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <p className="muted-box catalog-empty" data-cat-empty>
          Từ điển chưa có khung nào được công bố.
        </p>
      ) : (
        <>
          {view !== 'compare' ? (
            <div className="catalog-filters">
              <label>
                Họ nghề
                <select
                  id="cat-family"
                  value={family}
                  onChange={(e) => {
                    setFamily(e.target.value);
                    setPick(pickCompetency(competency));
                  }}
                >
                  <option value="all">Tất cả họ nghề</option>
                  {catalog.families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ngành
                <select
                  id="cat-industry"
                  value={industry}
                  onChange={(e) => {
                    setIndustry(e.target.value);
                    setPick(pickCompetency(competency));
                  }}
                >
                  <option value="all">Tất cả ngành</option>
                  {catalog.industries.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nhóm năng lực
                <select
                  id="cat-group"
                  value={group}
                  onChange={(e) => {
                    const g = e.target.value;
                    const next = catalog.competencies.filter((c) => g === 'all' || c.group === g);
                    const cid = next.some((c) => c.id === competency) ? competency : (next[0]?.id ?? '');
                    setGroup(g);
                    setCompetency(cid);
                    setPick(pickCompetency(cid));
                  }}
                >
                  <option value="all">FND / LDR / PRO / MC</option>
                  {Object.entries(GROUP_NAMES).map(([id, n]) => (
                    <option key={id} value={id}>
                      {id} · {n}
                    </option>
                  ))}
                </select>
              </label>
              {(view === 'network' || view === '3d') && (
                <label>
                  Năng lực để khám phá
                  <select
                    id="cat-competency"
                    value={competency}
                    onChange={(e) => {
                      setCompetency(e.target.value);
                      setPick(pickCompetency(e.target.value));
                    }}
                  >
                    {allowed.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                id="cat-clear"
                onClick={() => {
                  setFamily('all');
                  setIndustry('all');
                  setGroup('all');
                  setPick(allNetwork ? { type: 'overview' } : pickCompetency(competencyState));
                }}
              >
                Bỏ bộ lọc
              </button>
              {view === 'network' && (
                <>
                  <button
                    type="button"
                    id="cat-focus"
                    aria-pressed={!allNetwork}
                    onClick={() => {
                      setPick(allNetwork ? pickCompetency(competency) : { type: 'overview' });
                      setAllNetwork(!allNetwork);
                    }}
                  >
                    {allNetwork ? 'Chỉ xem quanh năng lực chọn' : 'Mở toàn mạng'}
                  </button>
                  <button
                    type="button"
                    id="cat-overview"
                    onClick={() => {
                      setAllNetwork(true);
                      setPick({ type: 'overview' });
                    }}
                  >
                    Hiện tất cả quan hệ
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="muted-box">So sánh dùng hai khung đầy đủ; các bộ lọc của chế độ mạng/ma trận không áp dụng ở đây.</p>
          )}
          <div className={'catalog-layout' + (wide ? ' all-network' : '')}>
            <div>{main}</div>
            <Inspector
              catalog={catalog}
              lk={lk}
              ps={ps}
              graph={graph}
              pick={pick}
              group={group}
              onPick={onPick}
              onIndustry={(id) => {
                setIndustry(id);
                setPick(pickCompetency(competency));
              }}
              onGroup={(g) => {
                const next = catalog.competencies.filter((c) => c.group === g);
                if (!next.some((c) => c.id === competency)) setCompetency(next[0]?.id ?? '');
                setGroup(g);
                setPick({ type: 'overview' });
              }}
            />
          </div>
        </>
      )}

      <details className="catalog-method">
        <summary>Trọng số, độ phủ, bậc và “chính” khác nhau thế nào?</summary>
        <div className="before-after">
          <div>
            <h3>Trọng số ưu tiên trong R</h3>
            <p>
              s = I × (m/N) × K; w = s / Σs. Chỉ số thiết kế kết hợp tầm quan trọng, tần suất đề cập và hậu quả. Thang I/K là {seed ? 'seed ' : ''}1–5 nên phép nhân là giả định mô hình, không phải phép đo khoảng đã kiểm định.
              {seed ? '' : ' Khung chưa có đủ đầu vào I, m/N, K được ghi “Chưa cấu hình công thức trọng số” và không hiển thị số.'}
            </p>
            <h3>Bậc yêu cầu</h3>
            <p>Số thứ bậc 1–5 gắn với năng lực trong một khung/ngành. Không lấy trọng số để tự suy ra bậc.</p>
          </div>
          <div>
            <h3>Năng lực chính</h3>
            <p>
              Quy tắc{seed ? ' seed' : ''}: I ≥ 4 hoặc K ≥ 4. Yêu cầu hiếm nhưng hậu quả cao vẫn có thể là chính.{seed ? ' Chưa tuyên bố các khung mẫu đạt cổng SOP.' : ''}
            </p>
            <h3>Độ phủ ngành</h3>
            <p>
              Tỷ lệ khung/ngành trong bộ lọc có yêu cầu năng lực.{' '}
              {seed ? 'Chỉ phản ánh bộ seed, không đại diện thị trường. Phạm vi nhóm FND/LDR có đủ yêu cầu trên mọi profile; MC tối đa một mục mỗi profile.' : 'Chỉ phản ánh các khung đã công bố của workspace, không đại diện thị trường.'}
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
