'use client';

import type { CatalogApi, CatComparison, CatProfile, CatRequirement } from '@cl/example';
import { hasFormula, pct, weightText, type CatLookup } from './model';

interface Props {
  catalog: CatalogApi;
  lk: CatLookup;
  a: CatProfile;
  b: CatProfile;
  onA(id: string): void;
  onB(id: string): void;
  onRequire(profileId: string, cid: string): void;
}

type Row = CatComparison['rows'][number];

const signed = (n: number, digits: number) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(digits);

export default function Compare({ catalog, lk, a, b, onA, onB, onRequire }: Props) {
  const x = catalog.compare(a, b);
  const groups: { key: string; title: string; rows: Row[] }[] = [
    { key: 'shared', title: 'NĂNG LỰC CHUNG', rows: x.rows.filter((r) => r.a && r.b) },
    { key: 'only-a', title: 'CHỈ CÓ Ở KHUNG A', rows: x.rows.filter((r) => r.a && !r.b) },
    { key: 'only-b', title: 'CHỈ CÓ Ở KHUNG B', rows: x.rows.filter((r) => !r.a && r.b) },
  ];

  const side = (p: CatProfile, q: CatRequirement | undefined, cid: string) =>
    q ? (
      <button type="button" data-require={`${p.id}|${cid}`} onClick={() => onRequire(p.id, cid)}>
        {weightText(q)} · {q.level}/5
      </button>
    ) : (
      '—'
    );

  return (
    <div className="catalog-compare" data-shared={x.shared} data-jaccard={x.jaccard ?? ''}>
      <div className="compare-selectors">
        <label>
          Khung A
          <select id="cat-a" value={a.id} onChange={(e) => onA(e.target.value)}>
            {catalog.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {lk.profileLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Khung B
          <select id="cat-b" value={b.id} onChange={(e) => onB(e.target.value)}>
            {catalog.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {lk.profileLabel(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="compare-summary">
        <b>{x.shared}</b> năng lực chung{' '}
        <span>
          Jaccard có trọng số: <b data-jaccard-text>{x.jaccard === null ? 'Không tính được' : pct(x.jaccard)}</b>
        </span>
      </div>
      <div className="formula">Jw(A,B) = Σ min(wAc,wBc) / Σ max(wAc,wBc)</div>
      <p className="muted-box">
        Đo độ chồng lấn của hai danh sách yêu cầu{lk.seed ? ' seed' : ''}. Không phải độ phù hợp ứng viên, khả năng chuyển nghề hay độ giống nhau về hiệu suất.
        {x.jaccard === null ? ' Mẫu số Σ max bằng 0 (chưa có trọng số) nên không tính được.' : ''}
      </p>
      <div className="table-wrap scroll-x">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">NĂNG LỰC</th>
              <th scope="col">KHUNG A · w / bậc</th>
              <th scope="col">KHUNG B · w / bậc</th>
              <th scope="col">CHÊNH BẬC (B − A)</th>
              <th scope="col">CHÊNH TRỌNG SỐ (B − A)</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key} data-compare-group={g.key}>
              <tr className="compare-group">
                <th scope="colgroup" colSpan={5}>
                  {g.title} · {g.rows.length}
                </th>
              </tr>
              {g.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted-box">
                    Không có.
                  </td>
                </tr>
              )}
              {g.rows.map((r) => {
                const both = r.a && r.b;
                const weighable = both && hasFormula(r.a) && hasFormula(r.b);
                return (
                  <tr key={r.competency.id}>
                    <td>
                      {r.competency.name}
                      <small>
                        {r.competency.group} · {r.competency.id}
                      </small>
                    </td>
                    <td>{side(a, r.a, r.competency.id)}</td>
                    <td>{side(b, r.b, r.competency.id)}</td>
                    <td>{both ? signed(r.b!.level - r.a!.level, 0) + ' bậc' : '—'}</td>
                    <td>{weighable ? signed((r.b!.weight - r.a!.weight) * 100, 1) + ' điểm %' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
