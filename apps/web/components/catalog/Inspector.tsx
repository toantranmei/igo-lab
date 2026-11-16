'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { CatalogApi, CatProfile, CatRequirement, GraphModel } from '@cl/example';
import { GROUP_NAMES, NO_FORMULA, edgeDisplay, hasFormula, levelRange, num, pct, weightText, type CatLookup, type CatPick } from './model';

interface Props {
  catalog: CatalogApi;
  lk: CatLookup;
  /** Profiles in the current filter (requirements may be narrowed by group; weights untouched). */
  ps: CatProfile[];
  graph: GraphModel;
  pick: CatPick;
  group: string;
  onPick(pick: CatPick): void;
  onIndustry(id: string): void;
  onGroup(id: string): void;
}

const coreText = (q: CatRequirement) => (q.core ? 'Chính' : 'Hỗ trợ');

/** s = I × (m/N) × K, w = s/Σs and the core rule, with this requirement's numbers substituted. */
function Formula({ q, p, lk }: { q: CatRequirement; p: CatProfile; lk: CatLookup }) {
  if (!hasFormula(q)) {
    return (
      <div className="weight-equation" data-weight-formula="missing">
        <div className="label">PHÉP TÍNH TRÊN {p.id}</div>
        <p className="muted-box">{NO_FORMULA}</p>
      </div>
    );
  }
  const total = p.requirements.reduce((s, r) => s + (Number.isFinite(r.score) ? r.score : 0), 0);
  const seed = lk.seed ? ' seed' : '';
  return (
    <div className="weight-equation" data-weight-formula="ok">
      <div className="label">PHÉP TÍNH TRÊN {p.id}</div>
      <div className="formula">
        s = importance × (mentions / totalSources) × criticality
        <br />= {q.importance} × ({q.mentions}/{q.totalSources}) × {q.criticality} = {num(q.score)}
        <br />
        weight = s / Σs = {num(q.score)} / {num(total)} = {weightText(q)}
        <br />
        core = importance ≥ 4 OR criticality ≥ 4 → {q.importance} ≥ 4 OR {q.criticality} ≥ 4 = {coreText(q)}
      </div>
      <p>
        importance (I): mức quan trọng{seed} 1–5 · mentions/totalSources (m/N): số JD{seed} đề cập / tổng JD · criticality (K): mức nghiêm trọng{seed} 1–5.
      </p>
      <p>Đây là chỉ số ưu tiên do mô hình thiết kế, không phải xác suất đúng, độ tin cậy hay mức tác động nhân quả. Tổng w của một khung/ngành = 100%; lọc nhóm không đổi mẫu số.</p>
    </div>
  );
}

/** One requirement of one profile: industry, level, weight, source data and calculation. */
function RequirementDetail({ p, q, lk }: { p: CatProfile; q: CatRequirement; lk: CatLookup }) {
  const evidence = q.evidence ?? [];
  return (
    <div className="catalog-requirement" data-requirement={`${p.id}|${q.id}`}>
      <dl className="catalog-facts">
        <dt>Ngành</dt>
        <dd>{lk.sector(p.industry).name}</dd>
        <dt>Khung R</dt>
        <dd>
          {p.id}
          {p.version ? ' · v' + p.version : ''}
        </dd>
        <dt>Bậc yêu cầu</dt>
        <dd>{q.level}/5</dd>
        <dt>Trọng số</dt>
        <dd>{hasFormula(q) ? `${weightText(q)} · ${coreText(q)}` : NO_FORMULA}</dd>
      </dl>
      <Formula q={q} p={p} lk={lk} />
      <details>
        <summary>
          Dữ liệu nguồn: {evidence.length} nguồn{lk.seed ? ' seed' : ''} tạo ra m
        </summary>
        {evidence.length ? (
          <ul className="catalog-evidence">
            {evidence.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-box">Chưa có nguồn truy vết.</p>
        )}
        {hasFormula(q) && (
          <p>
            Tập nguồn có N={q.totalSources} JD; mỗi mã trên có nhãn năng lực {q.id}.
          </p>
        )}
      </details>
    </div>
  );
}

function Fallback() {
  return <p className="muted-box">Mục đang chọn không còn trong dữ liệu hiện tại. Chọn một nút hoặc đường nối khác.</p>;
}

export default function Inspector({ catalog, lk, ps, graph, pick, group, onPick, onIndustry, onGroup }: Props) {
  let body: ReactNode;

  if (pick.type === 'overview') {
    body = (
      <>
        <span className="eyebrow">TOÀN MẠNG ĐANG HIỂN THỊ</span>
        <h3>Tất cả năng lực và quan hệ</h3>
        <p>
          {new Set(ps.map((p) => p.role)).size} vai trò · {new Set(ps.flatMap((p) => p.requirements.map((q) => q.id))).size} năng lực · {ps.length} khung/ngành.
        </p>
        <p className="muted-box">Mỗi nút C chỉ xuất hiện một lần. Các đường nối nhiều vai trò vào cùng nút cho thấy phần dùng chung. Chọn nút hoặc đường nối để xem trọng số và bối cảnh; các nút còn lại vẫn được giữ trên mạng.</p>
        <div className="label">NHÓM NĂNG LỰC</div>
        {Object.entries(GROUP_NAMES).map(([k, n]) => (
          <button key={k} type="button" className="connection" data-overview-group={k} aria-pressed={group === k} onClick={() => onGroup(k)}>
            {k} · {n}
          </button>
        ))}
      </>
    );
  } else if (pick.type === 'competency') {
    const c = catalog.competencies.find((x) => x.id === pick.id);
    if (!c) body = <Fallback />;
    else {
      const s = catalog.summaries(ps, c.id);
      const related = ps.flatMap((p) => {
        const q = p.requirements.find((r) => r.id === c.id);
        return q ? [{ p, q }] : [];
      });
      body = (
        <>
          <span className="eyebrow">C · KHÁI NIỆM DÙNG CHUNG</span>
          <h3>{c.name}</h3>
          <span className="pill">
            ID {c.id} · {c.group} / {GROUP_NAMES[c.group] ?? c.group}
            {c.version ? ` · v${c.version}` : ''}
          </span>
          <p>{c.definition || 'Chưa có định nghĩa.'}</p>
          <div className="label">BẬC YÊU CẦU THEO R</div>
          <p>{related.length ? `Bậc ${levelRange(related.map((x) => x.q.level))} trên ${related.length} khung R trong bộ lọc (chi tiết từng khung ở dưới).` : 'Không có khung nào trong bộ lọc yêu cầu năng lực này.'}</p>
          <div className="label">
            PHẠM VI SỬ DỤNG · {s.roles.length} VAI TRÒ / {s.sectors.filter((x) => x.count).length} NGÀNH TRONG BỘ LỌC
          </div>
          {s.roles.map((x) => (
            <button key={x.role.id} type="button" className="connection" data-role={x.role.id} onClick={() => onPick({ type: 'role', id: x.role.id })}>
              {x.role.name}
              {x.role.grade ? ' · ' + x.role.grade : ''} · bậc {levelRange(x.levels)}
            </button>
          ))}
          <div className="label">LIÊN QUAN ĐẾN NGÀNH NÀO?</div>
          {s.sectors.map((x) => (
            <button key={x.industry.id} type="button" className="industry-meter" data-industry={x.industry.id} onClick={() => onIndustry(x.industry.id)}>
              <span>
                {x.industry.name}
                <small>
                  Độ phủ: {x.count}/{x.total} khung/ngành · w TB {pct(x.weight)}
                </small>
              </span>
              <i style={{ '--coverage': `${x.coverage * 100}%` } as CSSProperties} />
            </button>
          ))}
          <div className="label">KHUNG LIÊN QUAN ({related.length})</div>
          {related.map(({ p, q }) => (
            <button key={p.id} type="button" className="requirement-link" data-require={`${p.id}|${c.id}`} onClick={() => onPick({ type: 'profile', id: p.id, cid: c.id })}>
              <span>
                {lk.profileLabel(p)}
                <small>
                  {p.id} · {coreText(q)} · bậc {q.level}/5
                </small>
              </span>
              <b>{weightText(q)}</b>
            </button>
          ))}
          <p className="muted-box">Độ phủ = số khung/ngành có yêu cầu năng lực này / số khung/ngành thuộc ngành trong bộ lọc. w TB tính cả 0 của khung không yêu cầu; không phải độ quan trọng của toàn thị trường.</p>
        </>
      );
    }
  } else if (pick.type === 'role') {
    const rr = catalog.roles.find((r) => r.id === pick.id);
    if (!rr) body = <Fallback />;
    else {
      const pp = ps.filter((p) => p.role === rr.id);
      const reqEdges = graph.edges.filter((e) => e.kind === 'ROLE_COMPETENCY' && e.from === 'W:' + rr.id);
      body = (
        <>
          <span className="eyebrow">VỊ TRÍ CHUẨN W</span>
          <h3>{rr.name}</h3>
          <span className="pill">ID {rr.id}</span>
          <p>
            {lk.fam(rr.family).name}
            {rr.grade ? ' · ' + rr.grade : ''}
          </p>
          {(rr.contexts?.length || rr.skills?.length) ? (
            <div className="chips">
              {[...(rr.contexts ?? []), ...(rr.skills ?? [])].map((t, i) => (
                <span key={i} className="chip">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          <div className="label">BẬC YÊU CẦU THEO R · {reqEdges.length} NĂNG LỰC</div>
          {reqEdges.map((e) => {
            const cid = e.to.slice(2);
            const d = edgeDisplay(e, lk);
            return (
              <button key={e.id} type="button" className="requirement-link" data-edge={e.id} onClick={() => onPick({ type: 'edge', role: rr.id, cid })}>
                <span>
                  {lk.comp(cid).name}
                  <small>
                    {cid} · bậc {levelRange(e.levels ?? [])} · {e.profiles?.length ?? 0}/{pp.length} khung
                  </small>
                </span>
                <b>{d.short ?? '—'}</b>
              </button>
            );
          })}
          <div className="label">PHẠM VI SỬ DỤNG · CÙNG HỌ NGHỀ</div>
          <div className="chips">
            {catalog.roles
              .filter((r) => r.family === rr.family)
              .map((r) => (
                <button key={r.id} type="button" data-role={r.id} className="chip" aria-pressed={r.id === rr.id} onClick={() => onPick({ type: 'role', id: r.id })}>
                  {r.name}
                </button>
              ))}
          </div>
          <div className="label">KHUNG LIÊN QUAN · CÙNG VỊ TRÍ, KHÁC BỐI CẢNH NGÀNH</div>
          {pp.length === 0 && <p className="muted-box">Không có khung nào của vị trí này trong bộ lọc.</p>}
          {pp.map((p) => (
            <button key={p.id} type="button" className="connection" data-profile={p.id} onClick={() => onPick({ type: 'profile', id: p.id })}>
              {lk.sector(p.industry).name} → {p.id}
            </button>
          ))}
          <p className="muted-box">Một nút vị trí W; bối cảnh ngành được gắn trên R. Không nhân đôi khái niệm C cho từng ngành.</p>
        </>
      );
    }
  } else if (pick.type === 'family') {
    const f = catalog.families.find((x) => x.id === pick.id);
    if (!f) body = <Fallback />;
    else {
      const roles = catalog.roles.filter((r) => r.family === f.id);
      const pp = ps.filter((p) => roles.some((r) => r.id === p.role));
      body = (
        <>
          <span className="eyebrow">HỌ NGHỀ</span>
          <h3>{f.name}</h3>
          <span className="pill">ID {f.id}</span>
          {lk.seed && <p className="muted-box">Cách nhóm họ nghề và gán cấp ở bộ seed này là đề xuất minh họa theo nhiệm vụ/chức năng.</p>}
          <div className="label">PHẠM VI SỬ DỤNG · {roles.length} VỊ TRÍ</div>
          {roles.map((r) => (
            <button key={r.id} type="button" className="connection" data-role={r.id} onClick={() => onPick({ type: 'role', id: r.id })}>
              {r.name}
              {r.grade ? ' · ' + r.grade : ''}
            </button>
          ))}
          <div className="label">KHUNG LIÊN QUAN ({pp.length})</div>
          {pp.map((p) => (
            <button key={p.id} type="button" className="connection" data-profile={p.id} onClick={() => onPick({ type: 'profile', id: p.id })}>
              {lk.profileLabel(p)} → {p.id}
            </button>
          ))}
        </>
      );
    }
  } else if (pick.type === 'profile') {
    const p = lk.profile(pick.id);
    if (!p) body = <Fallback />;
    else {
      const r = lk.role(p.role);
      const qs = p.requirements.slice().sort((x, y) => (y.weight || 0) - (x.weight || 0));
      const q = pick.cid ? qs.find((x) => x.id === pick.cid) : undefined;
      const overrides = p.overrides ?? [];
      const derived = p.derivedFromRole ? lk.role(p.derivedFromRole).name : null;
      body = (
        <>
          <span className="eyebrow">R · KHUNG YÊU CẦU</span>
          <h3>{r.name}</h3>
          <p className="muted-box">
            {[lk.fam(r.family).name, r.grade, lk.sector(p.industry).name].filter(Boolean).join(' · ')}
            <br />
            {[p.id, p.type, lk.seed ? 'seed tổng hợp' : p.version ? 'v' + p.version : ''].filter(Boolean).join(' · ')}
          </p>
          <div className="label">GỐC / BIẾN THỂ / PHÁI SINH</div>
          <p className="muted-box">
            {p.industry === 'BASE'
              ? 'Gốc liên ngành, không gán ngành cụ thể.'
              : p.base
                ? `Biến thể đọc khung gốc ${p.base} rồi áp ${overrides.length} thay đổi đầu vào yêu cầu. Trọng số được tính lại sau khi áp thay đổi.`
                : 'Khung gắn ngành, không khai báo khung gốc.'}
            {derived ? ` Cùng họ với ${derived}; khác vị trí/cấp.` : ''}
          </p>
          {overrides.length > 0 && (
            <details>
              <summary>Các liên kết khác khung gốc</summary>
              <pre>{JSON.stringify(overrides, null, 2)}</pre>
            </details>
          )}
          <div className="label">NĂNG LỰC CHÍNH / HỖ TRỢ</div>
          <p className="muted-box">“Chính” khi I ≥ 4 hoặc K ≥ 4; quy tắc minh họa có thể kiểm tra, chưa phải kết luận đã đạt SOP. Bậc 1–5 là yêu cầu R, khác mã cấp nghề CV2/CV3/QL4.</p>
          {q && (
            <>
              <h3>
                {lk.comp(q.id).name} · {coreText(q)}
              </h3>
              <RequirementDetail p={p} q={q} lk={lk} />
            </>
          )}
          <div className="label">YÊU CẦU CỦA KHUNG NÀY</div>
          {qs
            .filter((x) => group === 'all' || lk.comp(x.id).group === group)
            .map((x) => (
              <button key={x.id} type="button" className="requirement-link" data-require={`${p.id}|${x.id}`} aria-pressed={x.id === pick.cid} onClick={() => onPick({ type: 'profile', id: p.id, cid: x.id })}>
                <span>
                  {lk.comp(x.id).name}
                  <small>
                    {lk.comp(x.id).group} · {coreText(x)} · bậc {x.level}/5
                  </small>
                </span>
                <b>{weightText(x)}</b>
              </button>
            ))}
        </>
      );
    }
  } else if (pick.type === 'edge') {
    const edge = graph.edges.find((e) => e.id === `WC:${pick.role}:${pick.cid}`);
    const all = ps.filter((p) => p.role === pick.role);
    const hits = all.flatMap((fp) => {
      const p = lk.profile(fp.id) ?? fp;
      const q = p.requirements.find((r) => r.id === pick.cid);
      return q ? [{ p, q }] : [];
    });
    const d = edge ? edgeDisplay(edge, lk) : null;
    body = (
      <>
        <span className="eyebrow">QUAN HỆ W → C · YÊU CẦU</span>
        <h3>
          {lk.role(pick.role).name} → {lk.comp(pick.cid).name}
        </h3>
        <span className="pill">
          {pick.role} → {pick.cid}
        </span>
        {!edge || hits.length === 0 ? (
          <p className="muted-box">Quan hệ này không có trong bộ lọc hiện tại.</p>
        ) : (
          <>
            <div className="label">TRỌNG SỐ CỦA ĐƯỜNG NỐI</div>
            {d?.short ? (
              <>
                <p>
                  Bậc {levelRange(hits.map((h) => h.q.level))} · trọng số trung bình <b>{d.short}</b>
                </p>
                <div className="formula" data-edge-formula>
                  w TB = Σ w / số khung của vai trò trong bộ lọc
                  <br />= ({hits.map((h) => pct(h.q.weight)).join(' + ')}
                  {all.length > hits.length ? ` + ${all.length - hits.length} × 0%` : ''}) / {all.length} = {d.short}
                </div>
                <p className="muted-box">Khung của vai trò không yêu cầu năng lực này được tính 0. Lọc không tính lại trọng số trong từng khung.</p>
              </>
            ) : (
              <p className="muted-box">{NO_FORMULA}</p>
            )}
            {hits.map(({ p, q }) => (
              <section key={p.id} className="catalog-edge-profile">
                <div className="label">{lk.sector(p.industry).name.toUpperCase()}</div>
                <RequirementDetail p={p} q={q} lk={lk} />
                <button type="button" className="connection" data-profile={p.id} onClick={() => onPick({ type: 'profile', id: p.id, cid: pick.cid })}>
                  Mở khung {p.id}
                </button>
              </section>
            ))}
          </>
        )}
      </>
    );
  } else {
    const c = lk.comp(pick.cid);
    const all = ps.filter((p) => p.industry === pick.industry);
    const rows = all.map((p) => ({ p, q: p.requirements.find((r) => r.id === pick.cid) }));
    const hits = rows.filter((r) => r.q);
    const configured = hits.every((r) => hasFormula(r.q));
    const mean = all.length ? hits.reduce((s, r) => s + (r.q?.weight || 0), 0) / all.length : 0;
    body = (
      <>
        <span className="eyebrow">Ô MA TRẬN · NĂNG LỰC × NGÀNH</span>
        <h3>
          {c.name} × {lk.sector(pick.industry).name}
        </h3>
        <span className="pill">
          {c.id} · {c.group} / {GROUP_NAMES[c.group] ?? c.group}
        </span>
        <p>
          {hits.length}/{all.length} khung có yêu cầu · w TB {configured ? pct(mean) : '—'}
        </p>
        {configured ? (
          hits.length > 0 && (
            <div className="formula" data-cell-formula>
              w TB = ({hits.map((r) => pct(r.q!.weight)).join(' + ')}
              {all.length > hits.length ? ` + ${all.length - hits.length} × 0%` : ''}) / {all.length} = {pct(mean)}
            </div>
          )
        ) : (
          <p className="muted-box">{NO_FORMULA}</p>
        )}
        <div className="label">CÁC KHUNG TRONG Ô ({all.length})</div>
        {rows.map(({ p, q }) =>
          q ? (
            <button key={p.id} type="button" className="requirement-link" data-require={`${p.id}|${c.id}`} onClick={() => onPick({ type: 'profile', id: p.id, cid: c.id })}>
              <span>
                {lk.role(p.role).name}
                <small>
                  {p.id} · {coreText(q)} · bậc {q.level}/5
                </small>
              </span>
              <b>{weightText(q)}</b>
            </button>
          ) : (
            <button key={p.id} type="button" className="requirement-link" data-profile={p.id} onClick={() => onPick({ type: 'profile', id: p.id })}>
              <span>
                {lk.role(p.role).name}
                <small>{p.id} · không yêu cầu năng lực này (tính 0)</small>
              </span>
              <b>—</b>
            </button>
          ),
        )}
        <button type="button" className="connection" data-competency={c.id} onClick={() => onPick({ type: 'competency', id: c.id })}>
          Xem năng lực {c.id}
        </button>
      </>
    );
  }

  return (
    <div className="catalog-inspector" data-pick={pick.type} role="region" aria-label="Chi tiết mục đang chọn">
      {body}
    </div>
  );
}
